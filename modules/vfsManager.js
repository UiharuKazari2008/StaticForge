const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vfsDatabase = require('./vfsDatabase');
const {
    VfsSystemProvider,
    getSystemSegmentDisplayLabel,
    resolveSystemSegmentInput
} = require('./vfsSystemProvider');

const VFS_SYSTEM_IDS = {
    SYSTEM: '@system',
    WORKSPACES: '@workspaces',
    DESKTOP: '@desktop',
    PICTURES: '@pictures',
    REFERENCES: '@references',
    NOTES: '@notes',
    SCRAPS: '@scraps',
    TRASH: '@trash'
};

const ROOT_RESERVED_NAMES = ['System', 'Workspaces'];
const WORKSPACE_RESERVED_NAMES = ['Desktop', 'Pictures', 'References', 'Notes', 'Scraps', 'Trash'];

const WORKSPACE_SYSTEM_FOLDERS = [
    { id: VFS_SYSTEM_IDS.DESKTOP, name: 'Desktop', icon: 'fas fa-desktop' },
    { id: VFS_SYSTEM_IDS.PICTURES, name: 'Pictures', icon: 'fas fa-image' },
    { id: VFS_SYSTEM_IDS.REFERENCES, name: 'References', icon: 'fas fa-swatchbook' },
    { id: VFS_SYSTEM_IDS.NOTES, name: 'Notes', icon: 'fas fa-notebook' },
    { id: VFS_SYSTEM_IDS.SCRAPS, name: 'Scraps', icon: 'fas fa-bin-recycle' },
    { id: VFS_SYSTEM_IDS.TRASH, name: 'Trash', icon: 'fas fa-trash-can' }
];

const ROOT_SYSTEM_FOLDERS = [
    { id: VFS_SYSTEM_IDS.SYSTEM, name: 'System', icon: 'fas fa-cog' },
    { id: VFS_SYSTEM_IDS.WORKSPACES, name: 'Workspaces', icon: 'fas fa-planet-ringed' }
];

class VfsManager {
    constructor(globalResources) {
        this.globalResources = globalResources;
        this._pathStatsCache = new Map();
        this._pathStatsCacheTtlMs = 3000;
        this._systemProvider = new VfsSystemProvider(globalResources);
    }

    getSystemProvider() {
        return this._systemProvider;
    }

    invalidatePathStatsCache() {
        this._pathStatsCache.clear();
    }

    getDb() {
        return this.globalResources.getVfsDatabase();
    }

    normalizePath(vfsPath) {
        if (!vfsPath || vfsPath === '/') return '/';
        let p = vfsPath.trim();
        if (!p.startsWith('/')) p = '/' + p;
        if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
        return p;
    }

    parsePath(vfsPath) {
        const normalized = this.normalizePath(vfsPath);
        if (normalized === '/') {
            return { type: 'root', path: '/' };
        }
        const parts = normalized.split('/').filter(Boolean);
        if (parts[0] === 'System') {
            return { type: 'system', path: normalized, systemId: VFS_SYSTEM_IDS.SYSTEM };
        }
        if (parts[0] === 'Workspaces') {
            if (parts.length === 1) {
                return { type: 'workspaces-list', path: normalized };
            }
            const workspaceId = parts[1];
            if (parts.length === 2) {
                return { type: 'workspace-home', path: normalized, workspaceId };
            }
            const systemFolder = parts[2];
            const reserved = WORKSPACE_SYSTEM_FOLDERS.find(f => f.name === systemFolder);
            if (reserved && parts.length === 3) {
                return { type: 'system-folder', path: normalized, workspaceId, systemId: reserved.id, systemName: reserved.name };
            }
            if (parts[2] === 'Desktop' && parts.length > 3) {
                const folderId = parts[3];
                if (parts.length === 4) {
                    return { type: 'desktop-folder', path: normalized, workspaceId, folderId };
                }
                return { type: 'user-folder', path: normalized, workspaceId, folderId: parts[parts.length - 1], parentChain: parts.slice(3) };
            }
            if (reserved && parts.length > 3) {
                throw new Error('Cannot navigate into system folder subpaths');
            }
            const folderId = parts[2];
            return { type: 'user-folder', path: normalized, workspaceId, folderId, parentChain: parts.slice(2) };
        }
        // Root-scoped user folders: /{folderId} or /{folderId}/...
        if (parts.length >= 1) {
            const folderId = parts[parts.length - 1];
            return { type: 'root-user-folder', path: normalized, folderId, parentChain: parts };
        }
        throw new Error(`Invalid VFS path: ${vfsPath}`);
    }

    getParentPath(vfsPath) {
        const normalized = this.normalizePath(vfsPath);
        if (normalized === '/') return null;
        const parts = normalized.split('/').filter(Boolean);
        parts.pop();
        return parts.length === 0 ? '/' : '/' + parts.join('/');
    }

    isReservedFolderName(name, context) {
        const n = (name || '').trim();
        if (context === 'root') return ROOT_RESERVED_NAMES.some(r => r.toLowerCase() === n.toLowerCase());
        if (context === 'workspace-home') return WORKSPACE_RESERVED_NAMES.some(r => r.toLowerCase() === n.toLowerCase());
        return false;
    }

    rootSystemNavPath(folderId) {
        if (folderId === VFS_SYSTEM_IDS.WORKSPACES) return '/Workspaces';
        if (folderId === VFS_SYSTEM_IDS.SYSTEM) return '/System';
        return null;
    }

    folderNavPath(parentPath, folderId) {
        const base = this.normalizePath(parentPath);
        if (base === '/') return `/${folderId}`;
        return `${base}/${folderId}`;
    }

    _getDesktopVfsFolderIds(workspaceId) {
        const { shortcuts } = this.globalResources.getWorkspaceManager().getDesktopShortcuts(workspaceId);
        const ids = new Set();
        for (const s of shortcuts || []) {
            if (s.type === 'folder' && s.data?.vfsFolderId) {
                ids.add(s.data.vfsFolderId);
            }
        }
        return ids;
    }

    _isHiddenSurfaceFolder(folder) {
        return folder && folder.name === 'Shortcuts';
    }

    _isTrashSystemName(systemName) {
        return systemName === 'Trash';
    }

    _parseTrashPayload(trashItem) {
        if (!trashItem?.payload_json) return {};
        try {
            return JSON.parse(trashItem.payload_json);
        } catch (_) {
            return {};
        }
    }

    _trashItemIcon(itemKind) {
        switch (itemKind) {
            case 'vfs-folder': return 'fas fa-folder';
            case 'user-file': return 'fas fa-file';
            case 'image': return 'fas fa-file-image';
            case 'scrap': return 'fas fa-bin-recycle';
            case 'reference': return 'fas fa-swatchbook';
            case 'vibe': return 'nai-vibe-transfer';
            case 'note': return 'fas fa-file-lines';
            default: return 'fas fa-file';
        }
    }

    _trashRecordToItem(trashItem, extra = {}) {
        const payload = this._parseTrashPayload(trashItem);
        const itemKind = trashItem.item_kind;
        const isFolder = itemKind === 'vfs-folder';
        return {
            id: trashItem.id,
            trashItemId: trashItem.id,
            name: trashItem.display_name || trashItem.target_id,
            kind: isFolder ? 'folder' : 'file',
            targetKind: itemKind,
            targetId: trashItem.target_id,
            icon: this._trashItemIcon(itemKind),
            system: false,
            protected: false,
            importable: false,
            isTrashItem: true,
            originalPath: trashItem.original_path,
            deletedAt: trashItem.deleted_at,
            modifiedAt: trashItem.deleted_at,
            size: payload.size || 0,
            mimeType: payload.mimeType || null,
            previewImageFilename: payload.previewImageFilename || null,
            previewHash: payload.previewHash || null,
            noteIcon: payload.noteIcon || null,
            noteColor: payload.noteColor || null,
            refType: payload.refType || null,
            workspaceId: trashItem.workspace_id,
            ...extra
        };
    }

    async _getSurfaceEntryItems(scope, workspaceId) {
        const folders = await vfsDatabase.getFoldersByParent(scope, workspaceId, null);
        const surfaceFolder = folders.find(f => this._isHiddenSurfaceFolder(f));
        if (!surfaceFolder) return [];
        const entries = await vfsDatabase.getEntriesByFolder(surfaceFolder.id);
        const items = [];
        for (const e of entries) {
            items.push(await this._hydrateEntry(e, { workspaceId }));
        }
        return items;
    }

    _entryToItem(entry, extra = {}) {
        if (entry.target_kind === 'desktop-shortcut' && entry.entry_meta) {
            const meta = this._parseEntryMetaJson(entry.entry_meta);
            if (meta?.type) {
                const wsId = extra.workspaceId || meta.workspaceId || null;
                const item = this._shortcutToItem({
                    id: entry.id,
                    name: entry.display_name || meta.name || 'Shortcut',
                    type: meta.type,
                    data: meta.data || {}
                }, wsId);
                return {
                    ...item,
                    id: entry.id,
                    name: entry.display_name || meta.name || item.name,
                    isDesktopShortcut: false,
                    isShortcut: true,
                    isVfsShortcutEntry: true,
                    targetKind: 'desktop-shortcut',
                    targetId: entry.target_id,
                    modifiedAt: entry.created_at,
                    workspaceId: wsId
                };
            }
        }
        return {
            id: entry.id,
            name: entry.display_name || entry.target_id,
            kind: 'file',
            targetKind: entry.target_kind,
            targetId: entry.target_id,
            icon: 'fas fa-link',
            system: false,
            protected: false,
            importable: false,
            size: 0,
            modifiedAt: entry.created_at,
            isShortcut: true,
            ...extra,
            ...this._virtualSurfaceFieldsFromEntry(entry, extra.workspaceId)
        };
    }

    _virtualSurfaceFieldsFromEntry(entry, workspaceId) {
        const kind = entry.target_kind;
        const targetId = entry.target_id;
        const name = entry.display_name || targetId;
        switch (kind) {
            case 'image':
                return {
                    previewImageFilename: targetId,
                    icon: 'fas fa-file-image',
                    workspaceId
                };
            case 'scrap':
                return {
                    previewImageFilename: targetId,
                    icon: 'fas fa-bin-recycle',
                    workspaceId
                };
            case 'reference':
                return {
                    previewHash: targetId,
                    refType: 'base',
                    icon: 'fas fa-swatchbook',
                    workspaceId
                };
            case 'vibe':
                return {
                    previewHash: targetId,
                    refType: 'vibe',
                    icon: 'nai-vibe-transfer',
                    workspaceId
                };
            case 'note':
                return {
                    icon: 'fas fa-file-lines',
                    noteIcon: 'fas fa-file-lines',
                    noteColor: '#ffc107',
                    workspaceId
                };
            default:
                return kind === 'user-file' ? { isUserFileLink: true, workspaceId } : {};
        }
    }

    async _hydrateEntry(entry, extra = {}) {
        if (entry.target_kind === 'desktop-shortcut' && entry.entry_meta) {
            return this._entryToItem(entry, extra);
        }
        if (entry.target_kind === 'user-file') {
            const file = await vfsDatabase.getUserFileById(entry.target_id);
            if (file) {
                const fileItem = this.makeFileItem(file, { workspaceId: extra.workspaceId });
                return {
                    ...fileItem,
                    id: entry.id,
                    name: entry.display_name || fileItem.name,
                    isShortcut: true,
                    isUserFileLink: true,
                    modifiedAt: entry.created_at || fileItem.modifiedAt
                };
            }
        }
        return this._entryToItem(entry, extra);
    }

    _parseEntryMetaJson(raw) {
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    _serializeShortcutEntryMeta(shortcut, workspaceId = null) {
        return JSON.stringify({
            type: shortcut.type,
            name: shortcut.name,
            data: shortcut.data || {},
            workspaceId,
            originalShortcutId: shortcut.id || null
        });
    }

    async _resolveLiveDesktopShortcut(ref, workspaceId) {
        if (ref.shortcutType && ref.shortcutData) {
            return {
                type: ref.shortcutType,
                name: ref.name,
                data: ref.shortcutData,
                id: ref.shortcutId || ref.id
            };
        }
        const wsId = workspaceId || ref.workspaceId;
        if (!wsId) throw new Error('Workspace required for desktop shortcut');
        const sid = ref.shortcutId || ref.id;
        const { shortcuts } = this.globalResources.getWorkspaceManager().getDesktopShortcuts(wsId);
        const sc = (shortcuts || []).find(s => s.id === sid);
        if (!sc) throw new Error(`Desktop shortcut not found: ${ref.name || sid}`);
        return sc;
    }

    async _createShortcutEntryFromPayload(payload, folderId, workspaceId) {
        const targetId = payload.id || vfsDatabase.generateId();
        return vfsDatabase.createEntry({
            folderId,
            targetKind: 'desktop-shortcut',
            targetId,
            displayName: payload.name,
            entryMeta: this._serializeShortcutEntryMeta(payload, workspaceId)
        });
    }

    async _loadShortcutEntryRef(ref) {
        const entryId = ref.vfsEntryId || (ref.isVfsShortcutEntry ? ref.id : null)
            || (ref.targetKind === 'desktop-shortcut' && ref.isShortcut ? ref.id : null);
        if (!entryId) return null;
        const entry = await vfsDatabase.getEntryById(entryId);
        if (!entry || entry.target_kind !== 'desktop-shortcut') return null;
        const meta = this._parseEntryMetaJson(entry.entry_meta);
        if (!meta?.type) return null;
        return {
            entry,
            payload: {
                type: meta.type,
                name: entry.display_name || meta.name,
                data: meta.data || {},
                id: meta.originalShortcutId || entry.target_id
            }
        };
    }

    async _importEntryToDesktop(ref, location, removeEntry = true) {
        const wsId = ref.workspaceId || location.workspaceId;
        if (!wsId) throw new Error('Workspace required to restore shortcut to Desktop');

        let payload;
        const loaded = await this._loadShortcutEntryRef(ref);
        if (loaded) {
            payload = loaded.payload;
        } else if (ref.shortcutType && ref.shortcutData) {
            payload = {
                type: ref.shortcutType,
                name: ref.name,
                data: ref.shortcutData,
                id: ref.shortcutId || ref.id
            };
        } else {
            throw new Error('Shortcut data not found');
        }

        const wm = this.globalResources.getWorkspaceManager();
        const result = wm.addDesktopShortcut(wsId, {
            name: payload.name,
            type: payload.type,
            data: payload.data || {},
            folderId: location.folderId ?? null
        });

        if (removeEntry && loaded?.entry) {
            await vfsDatabase.deleteEntry(loaded.entry.id);
        }

        return result;
    }

    async _createVirtualSurfaceEntry(ref, targetPath) {
        const entryFolderId = await this._resolveEntryFolderId(targetPath);
        return vfsDatabase.createEntry({
            folderId: entryFolderId,
            targetKind: ref.targetKind,
            targetId: ref.targetId,
            displayName: ref.name
        });
    }

    async _removeVirtualSurfaceFromSource(ref) {
        const wsId = ref.workspaceId;
        if (!wsId) return;
        const wm = this.globalResources.getWorkspaceManager();
        const refDb = this.globalResources.getReferenceMetadataDatabase();
        switch (ref.targetKind) {
            case 'image':
                wm.removeFromWorkspaceArray('files', [ref.targetId], wsId);
                break;
            case 'scrap':
                wm.removeFromWorkspaceArray('scraps', [ref.targetId], wsId);
                break;
            case 'reference':
                refDb.removeReferenceFromWorkspace(ref.targetId, wsId);
                break;
            case 'vibe':
                refDb.removeVibeFromWorkspace(ref.targetId, wsId);
                break;
            case 'note': {
                const notesDb = this.globalResources.getNotesDatabase();
                const note = await notesDb.getNote(ref.targetId);
                if (note) {
                    const meta = { ...(note.metadata || {}), vfsHidden: true };
                    await notesDb.updateNote(ref.targetId, { metadata: meta });
                }
                break;
            }
            default:
                break;
        }
    }

    _noteHasDesktopShortcut(noteId, excludeShortcutId = null) {
        if (!noteId) return false;
        const wm = this.globalResources.getWorkspaceManager();
        const desktopConfig = this.globalResources.getWorkspaceDesktopConfig() || {};
        for (const wsId of Object.keys(desktopConfig)) {
            const { shortcuts } = wm.getDesktopShortcuts(wsId);
            if ((shortcuts || []).some(s => {
                if (excludeShortcutId && s.id === excludeShortcutId) return false;
                return s.type === 'note' && s.data?.noteId === noteId;
            })) {
                return true;
            }
        }
        return false;
    }

    async restoreNoteIfLastSurfaceReference(noteId, { excludeEntryId = null, excludeShortcutId = null } = {}) {
        if (!noteId) return;

        const remaining = await vfsDatabase.countEntriesByTarget('note', noteId, excludeEntryId);
        if (remaining > 0) return;
        if (this._noteHasDesktopShortcut(noteId, excludeShortcutId)) return;

        const notesDb = this.globalResources.getNotesDatabase();
        if (!notesDb) return;
        const note = await notesDb.getNote(noteId);
        if (!note || !note.metadata?.vfsHidden) return;

        const meta = { ...(note.metadata || {}) };
        delete meta.vfsHidden;
        await notesDb.updateNote(noteId, { metadata: meta });
    }

    async _restoreNoteIfLastVfsEntry(entry) {
        if (!entry || entry.target_kind !== 'note') return;
        await this.restoreNoteIfLastSurfaceReference(entry.target_id, { excludeEntryId: entry.id });
    }

    async deleteEntryById(entryId) {
        const entry = await vfsDatabase.getEntryById(entryId);
        if (entry) {
            await this._restoreNoteIfLastVfsEntry(entry);
        }
        return vfsDatabase.deleteEntry(entryId);
    }

    _isVirtualSurfaceKind(kind) {
        return ['image', 'scrap', 'reference', 'vibe', 'note'].includes(kind);
    }

    async _copyUserFileRef(ref, targetPath, copyMode = 'duplicate') {
        if (copyMode === 'shortcut') {
            const entryFolderId = await this._resolveEntryFolderId(targetPath);
            return vfsDatabase.createEntry({
                folderId: entryFolderId,
                targetKind: 'user-file',
                targetId: ref.targetId,
                displayName: ref.name
            });
        }
        const src = await vfsDatabase.getUserFileById(ref.targetId);
        if (!src) throw new Error(`File not found: ${ref.name || ref.targetId}`);
        const fileLocation = this.resolveLocationFromPath(targetPath);
        return vfsDatabase.createUserFile({
            contentHash: src.content_hash,
            originalName: src.original_name,
            mimeType: src.mime_type,
            size: src.size,
            scope: fileLocation.scope,
            workspaceId: fileLocation.scope === 'workspace' ? fileLocation.workspaceId : null,
            folderId: fileLocation.folderId,
            previewPath: src.preview_path
        });
    }

    _isStoredShortcutRef(ref) {
        return !!(ref.isVfsShortcutEntry || ref.vfsEntryId
            || (ref.isShortcut && ref.targetKind === 'desktop-shortcut' && !ref.isDesktopShortcut));
    }

    _isLiveDesktopShortcutRef(ref) {
        if (this._isStoredShortcutRef(ref)) return false;
        return !!(ref.isDesktopShortcut || ref.shortcutId);
    }

    _isLiveDesktopFolderShortcutRef(ref) {
        if (!this._isLiveDesktopShortcutRef(ref)) return false;
        return ref.shortcutType === 'folder'
            || !!(ref.shortcutData?.vfsFolderId)
            || (ref.targetKind === 'vfs-folder' && ref.isDesktopShortcut);
    }

    async _resolveFolderShortcutVfsId(ref, workspaceId) {
        if (ref.targetKind === 'vfs-folder' && ref.targetId) return ref.targetId;
        if (ref.shortcutData?.vfsFolderId) return ref.shortcutData.vfsFolderId;
        if (this._isStoredShortcutRef(ref)) {
            const loaded = await this._loadShortcutEntryRef(ref);
            if (loaded?.payload?.type === 'folder') {
                return loaded.payload.data?.vfsFolderId || loaded.payload.id;
            }
        }
        if (this._isLiveDesktopShortcutRef(ref)) {
            const sc = await this._resolveLiveDesktopShortcut(ref, workspaceId);
            if (sc.type === 'folder') return sc.data?.vfsFolderId || sc.id;
        }
        return null;
    }

    async _isFolderShortcutRef(ref, workspaceId) {
        if (this._isLiveDesktopFolderShortcutRef(ref)) return true;
        if (ref.shortcutType === 'folder') return true;
        if (this._isStoredShortcutRef(ref)) {
            const loaded = await this._loadShortcutEntryRef(ref);
            return loaded?.payload?.type === 'folder';
        }
        return false;
    }

    _promoteFolderToDesktopShortcut(wm, workspaceId, vfsFolderId, name, parentFolderId = null) {
        const { shortcuts } = wm.getDesktopShortcuts(workspaceId);
        const existing = (shortcuts || []).find(s =>
            s.type === 'folder' && s.data?.vfsFolderId === vfsFolderId
        );
        if (existing) {
            wm.updateDesktopShortcut(workspaceId, existing.id, { folderId: parentFolderId ?? null });
            return existing;
        }
        const result = wm.addDesktopShortcut(workspaceId, {
            name: name || 'Folder',
            type: 'folder',
            folderId: parentFolderId ?? null,
            data: { vfsFolderId: vfsFolderId }
        });
        return result.shortcut;
    }

    _shortcutWorkspaceId(ref, targetWsId) {
        return ref.workspaceId || targetWsId;
    }

    _isCrossWorkspaceMove(ref, targetWsId) {
        const sourceWsId = ref.workspaceId;
        return !!(sourceWsId && targetWsId && sourceWsId !== targetWsId);
    }

    async _folderTreeHasUserFiles(folderId) {
        const folder = await vfsDatabase.getFolderById(folderId);
        if (!folder) return false;

        const files = await vfsDatabase.getUserFilesByLocation(folder.scope, folder.workspace_id, folderId);
        if (files.length > 0) return true;

        const entries = await vfsDatabase.getEntriesByFolder(folderId);
        if (entries.some(e => e.target_kind === 'user-file')) return true;

        const childIds = await vfsDatabase.getChildFolderIds(folderId);
        for (const childId of childIds) {
            if (await this._folderTreeHasUserFiles(childId)) return true;
        }
        return false;
    }

    async folderTreeHasUserFiles(folderIds) {
        const ids = [...new Set((folderIds || []).filter(Boolean))];
        for (const folderId of ids) {
            if (await this._folderTreeHasUserFiles(folderId)) return true;
        }
        return false;
    }

    async _transferFolderShortcutCrossWorkspace(ref, targetPath, location, wm, targetWsId, {
        copy = false,
        copyMode = 'duplicate',
        isDesktopTarget = false,
        isDesktopRoot = false
    } = {}) {
        const sourceWsId = ref.workspaceId;
        const vfsFolderId = await this._resolveFolderShortcutVfsId(ref, sourceWsId);
        if (!vfsFolderId) throw new Error(`Folder shortcut not found: ${ref.name || ref.id}`);

        let resultFolderId = vfsFolderId;
        let resultName = ref.name;

        if (copy) {
            const copied = await this._copyFolder(vfsFolderId, targetPath, copyMode);
            resultFolderId = copied.id;
            resultName = copied.name;
        } else {
            if (this._isLiveDesktopFolderShortcutRef(ref)) {
                wm.removeDesktopShortcut(sourceWsId, ref.shortcutId || ref.id);
            } else if (this._isStoredShortcutRef(ref)) {
                await vfsDatabase.deleteEntry(ref.vfsEntryId || ref.id);
            }
            const moved = await this._moveFolder(vfsFolderId, targetPath);
            resultName = moved.name || resultName;
        }

        if (isDesktopTarget) {
            return this._promoteFolderToDesktopShortcut(
                wm,
                targetWsId,
                resultFolderId,
                resultName,
                isDesktopRoot ? null : (location.folderId ?? null)
            );
        }

        const folder = await vfsDatabase.getFolderById(resultFolderId);
        return this.makeFolderItem(folder, { workspaceId: targetWsId });
    }

    async _getOrCreateSurfaceFolder(scope, workspaceId) {
        const folders = await vfsDatabase.getFoldersByParent(scope, workspaceId, null);
        const existing = folders.find(f => this._isHiddenSurfaceFolder(f));
        if (existing) return existing;
        return vfsDatabase.createFolder({
            scope,
            workspaceId: scope === 'workspace' ? workspaceId : null,
            name: 'Shortcuts',
            parentId: null
        });
    }

    makeSystemFolderItem(folder, extra = {}) {
        return {
            id: folder.id,
            name: folder.name,
            kind: 'folder',
            targetKind: 'system-folder',
            targetId: folder.id,
            icon: folder.icon || 'fas fa-folder',
            system: true,
            protected: true,
            importable: false,
            size: 0,
            modifiedAt: null,
            ...extra
        };
    }

    makeFolderItem(folder, extra = {}) {
        return {
            id: folder.id,
            name: folder.name,
            kind: 'folder',
            targetKind: 'vfs-folder',
            targetId: folder.id,
            icon: 'fas fa-folder',
            system: false,
            protected: false,
            importable: true,
            size: 0,
            modifiedAt: folder.updated_at || folder.created_at,
            ...extra
        };
    }

    makeFileItem(file, extra = {}) {
        const isImage = (file.mime_type || '').startsWith('image/');
        return {
            id: file.id,
            name: file.original_name,
            kind: 'file',
            targetKind: 'user-file',
            targetId: file.id,
            mimeType: file.mime_type,
            icon: isImage ? 'fas fa-file-image' : 'fas fa-file',
            system: false,
            protected: false,
            importable: false,
            size: file.size,
            modifiedAt: file.updated_at || file.created_at,
            previewFileId: file.preview_path ? file.id : (isImage ? file.id : null),
            ...extra
        };
    }

    _assertWritableContainerPath(parsed, actionLabel = 'modify') {
        if (parsed.type === 'workspaces-list') {
            throw new Error(`Cannot ${actionLabel} the Workspaces folder`);
        }
        if (parsed.type === 'system') {
            throw new Error(`Cannot ${actionLabel} the System folder`);
        }
    }

    sortItems(items, sortField = 'name', sortDirection = 'asc') {
        const dir = sortDirection === 'desc' ? -1 : 1;
        const folders = items.filter(i => i.kind === 'folder');
        const files = items.filter(i => i.kind !== 'folder');
        const sortFn = (a, b) => {
            let av, bv;
            switch (sortField) {
                case 'workspaceOrder':
                    av = a.workspaceOrder ?? 0;
                    bv = b.workspaceOrder ?? 0;
                    break;
                case 'date':
                    av = a.modifiedAt || 0;
                    bv = b.modifiedAt || 0;
                    break;
                case 'type':
                    av = (a.mimeType || a.targetKind || a.kind || '').toLowerCase();
                    bv = (b.mimeType || b.targetKind || b.kind || '').toLowerCase();
                    break;
                case 'size':
                    av = a.size || 0;
                    bv = b.size || 0;
                    break;
                default:
                    av = (a.name || '').toLowerCase();
                    bv = (b.name || '').toLowerCase();
            }
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
        };
        folders.sort(sortFn);
        files.sort(sortFn);
        return [...folders, ...files];
    }

    filterItems(items, search) {
        if (!search || search.length < 1) return items;
        const q = search.toLowerCase();
        return items.filter(i => (i.name || '').toLowerCase().includes(q));
    }

    paginateItems(items, offset = 0, limit = 150) {
        const totalCount = items.length;
        const slice = items.slice(offset, offset + limit);
        return {
            items: slice,
            totalCount,
            hasMore: offset + limit < totalCount
        };
    }

    _getWorkspaceStatsFromCache(workspaceId) {
        const ws = this.globalResources.getWorkspaceManager().getWorkspaces()[workspaceId];
        if (!ws) return null;
        const sysInfo = this.globalResources.getSystemInfoCache();
        if (!sysInfo?.workspaces) return null;
        return sysInfo.workspaces.find(w =>
            w.workspaceId === workspaceId || w.name === (ws.name || workspaceId)
        ) || null;
    }

    _desktopShortcutOriginalLocation(item) {
        switch (item.shortcutType) {
            case 'image': return 'Pictures';
            case 'reference': return 'References';
            case 'note': return 'Notes';
            case 'folder': return 'Desktop';
            default: return null;
        }
    }

    _findImageOwnerWorkspaceId(filename) {
        if (!filename) return null;
        const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
        for (const [id, ws] of Object.entries(workspaces)) {
            if (ws.files?.includes(filename) || ws.scraps?.includes(filename) || ws.pinned?.includes(filename)) {
                return id;
            }
        }
        return null;
    }

    _resolveShortcutTargetWorkspaceId(item, ctx) {
        const fallback = item.workspaceId || ctx.workspaceId || null;

        if (item.isDesktopShortcut) {
            switch (item.shortcutType) {
                case 'image': {
                    const fn = item.previewImageFilename || item.targetId || item.shortcutData?.filename;
                    return this._findImageOwnerWorkspaceId(fn) || fallback;
                }
                case 'reference':
                    return item.shortcutData?.workspaceId || fallback;
                case 'note':
                case 'folder':
                case 'wiki-page':
                case 'static-wiki-page':
                    return fallback;
                default:
                    return fallback;
            }
        }

        switch (item.targetKind) {
            case 'image':
            case 'scrap': {
                const fn = item.previewImageFilename || item.targetId;
                return this._findImageOwnerWorkspaceId(fn) || fallback;
            }
            case 'reference':
            case 'vibe':
                return item.shortcutData?.workspaceId || fallback;
            case 'note':
                return fallback;
            default:
                return fallback;
        }
    }

    _wikiDocumentTypeLabelFromString(raw) {
        const s = String(raw || '').trim();
        if (!s) return null;
        if (/^edtx:\/\//i.test(s)) return 'DTEXT Document';
        if (/^rdf:\/\//i.test(s)) return 'Rich Text Document';
        if (/^dsap:\/\//i.test(s)) return 'DreamScape Portable Executable';
        const ext = s.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)?.[1]?.toLowerCase();
        if (ext === 'edtx' || ext === 'dtxt') return 'DTEXT Document';
        if (ext === 'rdf') return 'Rich Text Document';
        if (ext === 'dsap') return 'DreamScape Portable Executable';
        return null;
    }

    _getWikiShortcutTypeLabel(item) {
        const data = item.shortcutData || {};
        const candidates = [
            data.url,
            data.address,
            data.dsapUrl,
            data.pseudoUrl,
            data.pageId,
            item.name
        ];
        for (const raw of candidates) {
            const label = this._wikiDocumentTypeLabelFromString(raw);
            if (label) return label;
        }
        return 'Grimoire Document';
    }

    _isWikiDocumentShortcut(item) {
        const t = item.shortcutType;
        return t === 'wiki-page' || t === 'static-wiki-page';
    }

    _getItemTypeLabel(item) {
        const isShortcut = !!(item.isShortcut || item.isDesktopShortcut);
        const shortcutSuffix = isShortcut ? ' Shortcut' : '';

        if (item.targetKind === 'workspace') return 'Workspace';
        if (item.targetKind === 'system-file') return 'System File';
        if (item.targetKind === 'system-folder' || (item.system && item.kind === 'folder')) return 'System Folder';
        if (item.targetKind === 'vfs-folder') return isShortcut ? 'Folder Shortcut' : 'Folder';
        if (item.targetKind === 'user-file') {
            const isImage = (item.mimeType || '').startsWith('image/');
            if (isShortcut) return isImage ? 'VFS Image Shortcut' : 'VFS File Shortcut';
            return isImage ? 'VFS Image' : 'VFS File';
        }
        if (item.targetKind === 'image') return `Workspace Image${shortcutSuffix}`;
        if (item.targetKind === 'scrap') return `Scrap Image${shortcutSuffix}`;
        if (item.targetKind === 'reference') return `Reference Image${shortcutSuffix}`;
        if (item.targetKind === 'vibe') return `Vibe Reference${shortcutSuffix}`;
        if (item.targetKind === 'note') return `Note${shortcutSuffix}`;
        if (item.targetKind === 'desktop-shortcut') {
            if (this._isWikiDocumentShortcut(item)) return this._getWikiShortcutTypeLabel(item);
            return 'Desktop Shortcut';
        }
        if (item.kind === 'folder') return 'Folder';
        return 'File';
    }

    async _folderDisplayLabel(folderId) {
        const folder = await vfsDatabase.getFolderById(folderId);
        if (!folder) return null;
        const parts = [folder.name];
        let parentId = folder.parent_id;
        while (parentId) {
            const parent = await vfsDatabase.getFolderById(parentId);
            if (!parent || this._isHiddenSurfaceFolder(parent)) break;
            parts.unshift(parent.name);
            parentId = parent.parent_id;
        }
        return parts.join('/');
    }

    async _resolveNativeTargetLocation(targetKind, targetId, workspaceId, ctx) {
        const ws = ctx.ws || (workspaceId
            ? this.globalResources.getWorkspaceManager().getWorkspaces()[workspaceId]
            : null);
        switch (targetKind) {
            case 'image':
                if (ws?.files?.includes(targetId)) return 'Pictures';
                return ws?.name || null;
            case 'scrap':
                if (ws?.scraps?.includes(targetId)) return 'Scraps';
                return ws?.name || null;
            case 'reference':
            case 'vibe':
                return 'References';
            case 'note':
                return 'Notes';
            case 'user-file': {
                const file = await vfsDatabase.getUserFileById(targetId);
                if (!file) return null;
                if (!file.folder_id) {
                    return file.scope === 'root' ? 'Root' : (ws?.name || workspaceId || null);
                }
                let label = ctx.folderLabelMap.get(file.folder_id);
                if (!label) {
                    label = await this._folderDisplayLabel(file.folder_id);
                    ctx.folderLabelMap.set(file.folder_id, label);
                }
                return label;
            }
            default:
                return null;
        }
    }

    async _resolveShortcutOriginalLocation(item, ctx) {
        if (item.isDesktopShortcut) {
            return this._desktopShortcutOriginalLocation(item);
        }
        return this._resolveNativeTargetLocation(
            item.targetKind,
            item.targetId,
            item.workspaceId || ctx.workspaceId,
            ctx
        );
    }

    _lookupItemSizeBytes(item, ctx) {
        if (item.targetKind === 'workspace') {
            const stats = ctx.workspaceStatsById.get(item.targetId);
            return stats?.diskUsageBytes || 0;
        }
        if (item.targetKind === 'image' || item.targetKind === 'scrap') {
            const fn = item.previewImageFilename || item.targetId;
            if (fn && ctx.imageSizeMap.has(fn)) return ctx.imageSizeMap.get(fn);
        }
        if (item.targetKind === 'reference' || item.targetKind === 'vibe') {
            const hash = item.previewHash || item.targetId;
            if (hash && ctx.refSizeMap.has(hash)) return ctx.refSizeMap.get(hash);
        }
        if (item.targetKind === 'note' && ctx.noteSizeMap.has(item.targetId)) {
            return ctx.noteSizeMap.get(item.targetId);
        }
        return item.size || 0;
    }

    _applyItemMetadata(item, ctx) {
        let sizeBytes = item.sizeBytes ?? item.size ?? 0;
        if (item.targetKind === 'workspace') {
            sizeBytes = ctx.workspaceStatsById.get(item.targetId)?.diskUsageBytes || 0;
        } else if (!sizeBytes) {
            sizeBytes = this._lookupItemSizeBytes(item, ctx);
        }

        const typeLabel = this._getItemTypeLabel(item);
        let originalLocation = null;
        if (item.isShortcut || item.isDesktopShortcut) {
            if (item.isDesktopShortcut) {
                originalLocation = this._desktopShortcutOriginalLocation(item);
            } else {
                const key = `${item.targetKind}:${item.targetId}`;
                originalLocation = ctx.targetLocationMap.get(key) ?? null;
            }
            if (originalLocation) {
                const shortcutWs = item.workspaceId || ctx.workspaceId;
                const targetWs = this._resolveShortcutTargetWorkspaceId(item, ctx);
                if (shortcutWs && targetWs && shortcutWs === targetWs) {
                    originalLocation = null;
                }
            }
        }

        return {
            ...item,
            size: sizeBytes,
            sizeBytes,
            typeLabel,
            originalLocation
        };
    }

    async _buildListMetadataContext(items, parsed) {
        const ctx = {
            imageSizeMap: new Map(),
            refSizeMap: new Map(),
            noteSizeMap: new Map(),
            targetLocationMap: new Map(),
            workspaceStatsById: new Map(),
            folderLabelMap: new Map(),
            workspaceId: parsed.workspaceId || null,
            ws: null
        };

        if (parsed.type === 'workspaces-list') {
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            for (const [id] of Object.entries(workspaces)) {
                const stats = this._getWorkspaceStatsFromCache(id);
                if (stats) ctx.workspaceStatsById.set(id, stats);
            }
            return ctx;
        }

        if (ctx.workspaceId) {
            ctx.ws = this.globalResources.getWorkspaceManager().getWorkspaces()[ctx.workspaceId] || null;
        }

        const imageFilenames = new Set();
        const refHashes = new Set();
        const noteIds = new Set();

        for (const item of items) {
            if (item.size > 0) continue;
            if (item.targetKind === 'image' || item.targetKind === 'scrap') {
                const fn = item.previewImageFilename || item.targetId;
                if (fn) imageFilenames.add(fn);
            } else if (item.targetKind === 'reference' || item.targetKind === 'vibe') {
                const hash = item.previewHash || item.targetId;
                if (hash) refHashes.add(hash);
            } else if (item.targetKind === 'note') {
                noteIds.add(item.targetId);
            } else if (item.shortcutType === 'image' && item.shortcutData?.filename) {
                imageFilenames.add(item.shortcutData.filename);
            } else if (item.shortcutType === 'reference' && item.shortcutData?.hash) {
                refHashes.add(item.shortcutData.hash);
            }
        }

        if (imageFilenames.size) {
            const imagesPath = this.globalResources.getPath('images');
            await Promise.all([...imageFilenames].map(async (fn) => {
                try {
                    const st = await fs.promises.stat(path.join(imagesPath, fn));
                    ctx.imageSizeMap.set(fn, st.size);
                } catch (_) {
                    ctx.imageSizeMap.set(fn, 0);
                }
            }));
        }

        if (refHashes.size) {
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            const cacheMap = refDb.getFileCacheForReferences([...refHashes]);
            for (const hash of refHashes) {
                ctx.refSizeMap.set(hash, cacheMap[hash]?.size || 0);
            }
        }

        if (noteIds.size && ctx.workspaceId) {
            const notesDb = this.globalResources.getNotesDatabase();
            const notes = await notesDb.getNotesByWorkspace(ctx.workspaceId);
            for (const n of notes || []) {
                if (noteIds.has(n.id)) ctx.noteSizeMap.set(n.id, (n.content || '').length);
            }
        }

        const shortcutItems = items.filter(i => i.isShortcut || i.isDesktopShortcut);
        const locationKeys = new Set();
        for (const item of shortcutItems) {
            if (item.isDesktopShortcut) continue;
            locationKeys.add(`${item.targetKind}:${item.targetId}`);
        }
        for (const key of locationKeys) {
            const item = shortcutItems.find(i => `${i.targetKind}:${i.targetId}` === key);
            if (!item) continue;
            const loc = await this._resolveShortcutOriginalLocation(item, ctx);
            ctx.targetLocationMap.set(key, loc);
        }

        return ctx;
    }

    async _enrichListItemsMetadata(items, parsed) {
        if (!items.length) return items;
        const ctx = await this._buildListMetadataContext(items, parsed);
        return items.map(item => this._applyItemMetadata(item, ctx));
    }

    async listDirectory(vfsPath, options = {}) {
        const {
            offset = 0,
            limit = 300,
            sortField = 'name',
            sortDirection = 'asc',
            search = ''
        } = options;

        const parsed = this.parsePath(vfsPath);
        let items = [];
        let totalSizeBytes = 0;
        let emptyMessage = null;

        switch (parsed.type) {
            case 'root':
                items = ROOT_SYSTEM_FOLDERS.map(f => this.makeSystemFolderItem(f, {
                    navPath: this.rootSystemNavPath(f.id)
                }));
                {
                    const folders = await vfsDatabase.getFoldersByParent('root', null, null);
                    const visibleFolders = folders.filter(f => !this._isHiddenSurfaceFolder(f));
                    const files = await vfsDatabase.getUserFilesByLocation('root', null, null);
                    const surfaceEntries = await this._getSurfaceEntryItems('root', null);
                    items.push(...visibleFolders.map(f => this.makeFolderItem(f, { navPath: this.folderNavPath('/', f.id) })));
                    items.push(...surfaceEntries);
                    items.push(...files.map(f => this.makeFileItem(f)));
                    const stats = await vfsDatabase.getUserFileStats('root', null, null);
                    totalSizeBytes = stats.totalSize;
                }
                break;

            case 'system':
                items = await this._systemProvider.listDirectory(this._getSystemPathSegments(parsed));
                totalSizeBytes = items.reduce((s, i) => s + (i.size || 0), 0);
                break;

            case 'workspaces-list': {
                const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
                let listTotalBytes = 0;
                items = Object.entries(workspaces).map(([id, ws]) => {
                    const cached = this._getWorkspaceStatsFromCache(id);
                    const sizeBytes = cached?.diskUsageBytes || 0;
                    listTotalBytes += sizeBytes;
                    return {
                        id: `ws-${id}`,
                        name: ws.name || id,
                        kind: 'folder',
                        targetKind: 'workspace',
                        targetId: id,
                        navPath: `/Workspaces/${id}`,
                        icon: 'fas fa-planet-ringed',
                        system: true,
                        protected: true,
                        importable: false,
                        color: ws.color,
                        workspaceOrder: ws.sort ?? 0,
                        isDefault: !!ws.isDefault,
                        size: sizeBytes,
                        sizeBytes,
                        modifiedAt: null
                    };
                });
                totalSizeBytes = listTotalBytes;
                break;
            }

            case 'workspace-home': {
                const wsBase = `/Workspaces/${parsed.workspaceId}`;
                items = WORKSPACE_SYSTEM_FOLDERS.map(f => this.makeSystemFolderItem(f, {
                    navPath: `${wsBase}/${f.name}`,
                    workspaceId: parsed.workspaceId
                }));
                const desktopFolderIds = this._getDesktopVfsFolderIds(parsed.workspaceId);
                const folders = (await vfsDatabase.getFoldersByParent('workspace', parsed.workspaceId, null))
                    .filter(f => !this._isHiddenSurfaceFolder(f) && !desktopFolderIds.has(f.id));
                const files = await vfsDatabase.getUserFilesByLocation('workspace', parsed.workspaceId, null);
                const surfaceEntries = await this._getSurfaceEntryItems('workspace', parsed.workspaceId);
                items.push(...folders.map(f => this.makeFolderItem(f, {
                    navPath: this.folderNavPath(wsBase, f.id),
                    workspaceId: parsed.workspaceId
                })));
                items.push(...surfaceEntries);
                items.push(...files.map(f => this.makeFileItem(f, { workspaceId: parsed.workspaceId })));
                const stats = await vfsDatabase.getUserFileStats('workspace', parsed.workspaceId, null);
                totalSizeBytes = stats.totalSize;
                break;
            }

            case 'system-folder':
                items = await this._listSystemFolder(parsed, search);
                totalSizeBytes = items.reduce((s, i) => s + (i.size || 0), 0);
                break;

            case 'desktop-folder':
                items = await this._listDesktopFolder(parsed);
                totalSizeBytes = items.reduce((s, i) => s + (i.size || 0), 0);
                break;

            case 'user-folder':
            case 'root-user-folder':
                items = await this._listUserFolder(parsed);
                totalSizeBytes = items.reduce((s, i) => s + (i.size || 0), 0);
                break;

            default:
                throw new Error(`Unsupported path type: ${parsed.type}`);
        }

        items = await this._enrichListItemsMetadata(items, parsed);

        items = this.filterItems(items, search);
        let listSortField = sortField;
        let listSortDirection = sortDirection;
        if (parsed.type === 'workspaces-list' && sortField === 'name') {
            listSortField = 'workspaceOrder';
            listSortDirection = 'asc';
        }
        items = this.sortItems(items, listSortField, listSortDirection);
        const totalCount = items.length;
        totalSizeBytes = totalSizeBytes || items.reduce((s, i) => s + (i.size || 0), 0);
        const page = this.paginateItems(items, offset, limit);

        return {
            path: parsed.path,
            items: page.items,
            totalCount,
            totalSizeBytes,
            hasMore: page.hasMore,
            emptyMessage
        };
    }

    async _listSystemFolder(parsed, search) {
        const { workspaceId, systemName } = parsed;
        const ws = this.globalResources.getWorkspaceManager().getWorkspaces()[workspaceId];
        if (!ws) throw new Error('Workspace not found');

        if (this._isTrashSystemName(systemName)) {
            const trashRows = await vfsDatabase.getTrashItemsByWorkspace(workspaceId);
            let items = trashRows.map(t => this._trashRecordToItem(t, { workspaceId }));
            if (search && search.length >= 2) {
                const q = search.toLowerCase();
                items = items.filter(i => (i.name || '').toLowerCase().includes(q));
            }
            return items;
        }

        const trashedTargets = await vfsDatabase.getTrashedTargetIdSet(
            workspaceId,
            ['image', 'scrap', 'reference', 'vibe', 'note']
        );

        switch (systemName) {
            case 'Desktop': {
                const { shortcuts } = this.globalResources.getWorkspaceManager().getDesktopShortcuts(workspaceId);
                const rootShortcuts = (shortcuts || []).filter(s => !s.folderId);
                // Use shortcut metadata for everything (including folder shortcuts) so items carry
                // shortcutType/isDesktopShortcut. This ensures delete paths use deleteFolderShortcut
                // (removing both shortcut record and vfs folder) and explorer context menus are consistent.
                return rootShortcuts.map(s => this._shortcutToItem(s, workspaceId));
            }
            case 'Pictures': {
                const files = ws.files || [];
                const imagesPath = this.globalResources.getPath('images');
                let filenames = [...files].filter(f => !trashedTargets.has(`image:${f}`));
                if (search && search.length >= 2) {
                    const q = search.toLowerCase();
                    filenames = filenames.filter(f => f.toLowerCase().includes(q));
                }
                return filenames.map(filename => {
                    let size = 0;
                    let mtime = null;
                    try {
                        const fp = path.join(imagesPath, filename);
                        if (fs.existsSync(fp)) {
                            const st = fs.statSync(fp);
                            size = st.size;
                            mtime = Math.floor(st.mtimeMs / 1000);
                        }
                    } catch (_) { /* skip */ }
                    const baseName = path.basename(filename, path.extname(filename));
                    return {
                        id: `img-${filename}`,
                        name: filename,
                        kind: 'file',
                        targetKind: 'image',
                        targetId: filename,
                        mimeType: 'image/png',
                        icon: 'fas fa-file-image',
                        system: false,
                        protected: false,
                        importable: false,
                        size,
                        modifiedAt: mtime,
                        previewImageFilename: filename,
                        workspaceId
                    };
                });
            }
            case 'References': {
                const refDb = this.globalResources.getReferenceMetadataDatabase();
                const refHashes = refDb.getWorkspaceReferences(workspaceId);
                const cacheFilesMap = refDb.getFileCacheForReferences(refHashes);
                const vibeRows = refDb.getWorkspaceVibesListLight(workspaceId);
                const items = [];
                for (const hash of refHashes) {
                    if (trashedTargets.has(`reference:${hash}`)) continue;
                    const r = cacheFilesMap[hash];
                    const displayName = r?.metadata?.displayName || hash;
                    items.push({
                        id: `ref-${hash}`,
                        name: displayName,
                        kind: 'file',
                        targetKind: 'reference',
                        targetId: hash,
                        mimeType: 'image/png',
                        icon: 'fas fa-swatchbook',
                        system: false,
                        protected: false,
                        importable: false,
                        size: r?.size || 0,
                        modifiedAt: r?.cachedAt || null,
                        previewHash: hash,
                        refType: 'base',
                        workspaceId
                    });
                }
                for (const row of vibeRows) {
                    const vibeId = row.vibe_id;
                    if (trashedTargets.has(`vibe:${vibeId}`)) continue;
                    items.push({
                        id: `vibe-${vibeId}`,
                        name: row.display_name || vibeId,
                        kind: 'file',
                        targetKind: 'vibe',
                        targetId: vibeId,
                        mimeType: 'image/png',
                        icon: 'nai-vibe-transfer',
                        refType: 'vibe',
                        system: false,
                        protected: false,
                        importable: false,
                        size: 0,
                        modifiedAt: row.updated_at || row.created_at || null,
                        previewHash: row.preview_hash || vibeId,
                        workspaceId
                    });
                }
                if (search && search.length >= 2) {
                    const q = search.toLowerCase();
                    return items.filter(i => (i.name || '').toLowerCase().includes(q));
                }
                return items;
            }
            case 'Notes': {
                const notesDb = this.globalResources.getNotesDatabase();
                const notes = await notesDb.getNotesByWorkspace(workspaceId);
                return (notes || [])
                    .filter(n => !n.metadata?.vfsHidden && !trashedTargets.has(`note:${n.id}`))
                    .map(n => ({
                    id: `note-${n.id}`,
                    name: n.name,
                    kind: 'file',
                    targetKind: 'note',
                    targetId: n.id,
                    mimeType: 'text/plain',
                    icon: n.icon || 'fas fa-file-lines',
                    noteIcon: n.icon || 'fas fa-file-lines',
                    noteColor: n.color || '#ffc107',
                    system: false,
                    protected: false,
                    importable: false,
                    size: (n.content || '').length,
                    modifiedAt: n.updated_at,
                    workspaceId
                }));
            }
            case 'Scraps': {
                const scraps = (ws.scraps || []).filter(f => !trashedTargets.has(`scrap:${f}`));
                const imagesPath = this.globalResources.getPath('images');
                return scraps.map(filename => {
                    let size = 0;
                    let mtime = null;
                    try {
                        const fp = path.join(imagesPath, filename);
                        if (fs.existsSync(fp)) {
                            const st = fs.statSync(fp);
                            size = st.size;
                            mtime = Math.floor(st.mtimeMs / 1000);
                        }
                    } catch (_) { /* skip */ }
                    return {
                        id: `scrap-${filename}`,
                        name: filename,
                        kind: 'file',
                        targetKind: 'scrap',
                        targetId: filename,
                        mimeType: 'image/png',
                        icon: 'fas fa-bin-recycle',
                        system: false,
                        protected: false,
                        importable: false,
                        size,
                        modifiedAt: mtime,
                        previewImageFilename: filename,
                        workspaceId
                    };
                });
            }
            default:
                return [];
        }
    }

    _shortcutToItem(shortcut, workspaceId = null) {
        const data = shortcut.data || {};
        const base = {
            id: shortcut.id,
            name: shortcut.name,
            shortcutType: shortcut.type,
            shortcutData: data,
            isDesktopShortcut: true,
            system: false,
            protected: false,
            importable: false,
            size: 0,
            modifiedAt: shortcut.updatedAt ? Math.floor(new Date(shortcut.updatedAt).getTime() / 1000) : null,
            workspaceId
        };

        switch (shortcut.type) {
            case 'folder': {
                const vfsFolderId = data.vfsFolderId || shortcut.id;
                return {
                    ...base,
                    kind: 'folder',
                    targetKind: 'vfs-folder',
                    targetId: vfsFolderId,
                    navPath: workspaceId ? `/Workspaces/${workspaceId}/Desktop/${vfsFolderId}` : null,
                    icon: 'fas fa-folder'
                };
            }
            case 'image':
                return {
                    ...base,
                    kind: 'file',
                    targetKind: 'image',
                    targetId: data.filename,
                    previewImageFilename: data.filename,
                    galleryPreview: data.preview || null,
                    icon: 'fas fa-image'
                };
            case 'reference': {
                const refType = data.refType || 'base';
                let icon = 'nai-img2img';
                if (refType === 'vibe') icon = 'nai-vibe-transfer';
                else if (refType === 'character') icon = 'nai-precise-reference';
                return {
                    ...base,
                    kind: 'file',
                    targetKind: 'reference',
                    targetId: data.hash,
                    previewHash: data.hash,
                    previewCachePreview: data.preview || null,
                    icon
                };
            }
            case 'note':
                return {
                    ...base,
                    kind: 'file',
                    targetKind: 'note',
                    targetId: data.noteId,
                    icon: data.icon || 'fas fa-file-lines',
                    noteIcon: data.icon || 'fas fa-file-lines',
                    noteColor: data.color || '#ffc107'
                };
            case 'preset':
                return {
                    ...base,
                    kind: 'file',
                    targetKind: 'desktop-shortcut',
                    targetId: shortcut.id,
                    icon: 'fas fa-file-prescription'
                };
            case 'applet':
                return {
                    ...base,
                    kind: 'file',
                    targetKind: 'desktop-shortcut',
                    targetId: shortcut.id,
                    icon: data.icon || 'fas fa-window'
                };
            case 'request':
                return {
                    ...base,
                    kind: 'file',
                    targetKind: 'desktop-shortcut',
                    targetId: shortcut.id,
                    previewDataUrl: data.preview ? `data:image/png;base64,${data.preview}` : null,
                    icon: 'fas fa-image'
                };
            case 'wiki-page':
                return {
                    ...base,
                    kind: 'file',
                    targetKind: 'desktop-shortcut',
                    targetId: shortcut.id,
                    icon: 'fas fa-book'
                };
            case 'static-wiki-page':
                return {
                    ...base,
                    kind: 'file',
                    targetKind: 'desktop-shortcut',
                    targetId: shortcut.id,
                    icon: 'fas fa-book-open'
                };
            case 'nax-tag':
                return {
                    ...base,
                    kind: 'file',
                    targetKind: 'desktop-shortcut',
                    targetId: shortcut.id,
                    icon: 'fas fa-tag'
                };
            case 'bracket-generation':
                return {
                    ...base,
                    kind: 'file',
                    targetKind: 'desktop-shortcut',
                    targetId: shortcut.id,
                    icon: 'fas fa-layer-group'
                };
            default:
                return {
                    ...base,
                    kind: 'file',
                    targetKind: 'desktop-shortcut',
                    targetId: shortcut.id,
                    icon: 'fas fa-link'
                };
        }
    }

    async _listDesktopFolder(parsed) {
        const folderId = parsed.folderId;
        const folder = await vfsDatabase.getFolderById(folderId);
        if (!folder) throw new Error('Folder not found');

        const { shortcuts } = this.globalResources.getWorkspaceManager().getDesktopShortcuts(parsed.workspaceId);
        const inFolder = (shortcuts || []).filter(s => s.folderId === folderId);

        const subfolders = await vfsDatabase.getFoldersByParent('workspace', parsed.workspaceId, folderId);
        const entries = await vfsDatabase.getEntriesByFolder(folderId);
        const files = await vfsDatabase.getUserFilesByLocation('workspace', parsed.workspaceId, folderId);

        const items = [
            ...subfolders.map(f => this.makeFolderItem(f, {
                navPath: this.folderNavPath(parsed.path, f.id),
                workspaceId: parsed.workspaceId
            })),
            ...files.map(f => this.makeFileItem(f, { workspaceId: parsed.workspaceId })),
            ...inFolder.map(s => this._shortcutToItem(s, parsed.workspaceId))
        ];

        for (const entry of entries) {
            items.push(await this._hydrateEntry(entry, { workspaceId: parsed.workspaceId }));
        }

        return items;
    }

    async _listUserFolder(parsed) {
        const folderId = parsed.folderId;
        const folder = await vfsDatabase.getFolderById(folderId);
        if (!folder) throw new Error('Folder not found');

        const subfolders = await vfsDatabase.getFoldersByParent(folder.scope, folder.workspace_id, folderId);
        const entries = await vfsDatabase.getEntriesByFolder(folderId);
        const files = await vfsDatabase.getUserFilesByLocation(folder.scope, folder.workspace_id, folderId);

        const items = [
            ...subfolders.map(f => this.makeFolderItem(f, {
                navPath: this.folderNavPath(parsed.path, f.id),
                workspaceId: folder.workspace_id
            })),
            ...files.map(f => this.makeFileItem(f, { workspaceId: folder.workspace_id }))
        ];

        for (const entry of entries) {
            items.push(await this._hydrateEntry(entry, { workspaceId: folder.workspace_id }));
        }

        return items;
    }

    _buildDisplayPathFromSegments(segments) {
        if (!segments || segments.length === 0) return '/';
        return '/' + segments.map(s => s.label).join('/');
    }

    _matchReservedSystemFolder(name) {
        return WORKSPACE_RESERVED_NAMES.find(n => n.toLowerCase() === (name || '').toLowerCase()) || null;
    }

    _resolveWorkspaceId(segment, workspaces) {
        if (!segment) return null;
        if (workspaces[segment]) return segment;
        const match = Object.entries(workspaces).find(([, ws]) =>
            (ws.name || '').toLowerCase() === segment.toLowerCase()
        );
        return match ? match[0] : null;
    }

    async _findWorkspaceFolderByName(workspaceId, parentId, name, options = {}) {
        const folders = await vfsDatabase.getFoldersByParent('workspace', workspaceId, parentId);
        const desktopIds = this._getDesktopVfsFolderIds(workspaceId);
        const needle = (name || '').toLowerCase();
        return folders.find(f => {
            if (this._isHiddenSurfaceFolder(f)) return false;
            if (options.desktopOnly && !desktopIds.has(f.id)) return false;
            if (options.excludeDesktop && desktopIds.has(f.id)) return false;
            return (f.name || '').toLowerCase() === needle;
        }) || null;
    }

    async getPathDisplayInfo(vfsPath) {
        const normalized = this.normalizePath(vfsPath);
        const wm = this.globalResources.getWorkspaceManager();
        const segments = [];

        if (normalized === '/') {
            return { displayName: 'Root', displayPath: '/', segments: [{ label: 'Root', canonical: '/' }] };
        }

        const parts = normalized.split('/').filter(Boolean);

        if (parts[0] === 'System') {
            const segments = [{ label: 'System', canonical: '/System' }];
            let canonical = '/System';
            for (let i = 1; i < parts.length; i++) {
                const seg = parts[i];
                canonical = `${canonical}/${seg}`;
                const label = i === 1 ? getSystemSegmentDisplayLabel(seg) : seg;
                segments.push({ label, canonical });
            }
            const last = segments[segments.length - 1];
            return {
                displayName: last.label,
                displayPath: this._buildDisplayPathFromSegments(segments),
                segments
            };
        }

        if (parts[0] === 'Workspaces') {
            let canonical = '/Workspaces';
            segments.push({ label: 'Workspaces', canonical });

            if (parts.length === 1) {
                return { displayName: 'Workspaces', displayPath: '/Workspaces', segments };
            }

            const wsId = parts[1];
            const ws = wm.getWorkspaces()[wsId];
            canonical = `/Workspaces/${wsId}`;
            segments.push({ label: ws?.name || wsId, canonical });

            if (parts.length === 2) {
                return {
                    displayName: ws?.name || wsId,
                    displayPath: this._buildDisplayPathFromSegments(segments),
                    segments
                };
            }

            let i = 2;
            while (i < parts.length) {
                const seg = parts[i];
                canonical = `${canonical}/${seg}`;
                const reserved = i === 2 ? this._matchReservedSystemFolder(seg) : null;

                if (reserved) {
                    segments.push({ label: reserved, canonical });
                    i++;
                    if (reserved === 'Desktop') {
                        let parentId = null;
                        while (i < parts.length) {
                            const fid = parts[i];
                            canonical = `${canonical}/${fid}`;
                            const folder = await vfsDatabase.getFolderById(fid);
                            segments.push({ label: folder?.name || fid, canonical });
                            parentId = folder?.id || null;
                            i++;
                        }
                    }
                    continue;
                }

                const folder = await vfsDatabase.getFolderById(seg);
                segments.push({ label: folder?.name || seg, canonical });
                i++;
            }

            const last = segments[segments.length - 1];
            return {
                displayName: last.label,
                displayPath: this._buildDisplayPathFromSegments(segments),
                segments
            };
        }

        let canonical = '';
        for (const seg of parts) {
            canonical = canonical ? `${canonical}/${seg}` : `/${seg}`;
            const folder = await vfsDatabase.getFolderById(seg);
            segments.push({ label: folder?.name || seg, canonical });
        }
        const last = segments[segments.length - 1];
        return {
            displayName: last.label,
            displayPath: this._buildDisplayPathFromSegments(segments),
            segments
        };
    }

    _normalizeSystemPath(vfsPath) {
        const normalized = this.normalizePath(vfsPath);
        const parts = normalized.split('/').filter(Boolean);
        if (parts[0] !== 'System') return normalized;
        if (parts.length === 1) return '/System';
        parts[1] = resolveSystemSegmentInput(parts[1]);
        return '/' + parts.join('/');
    }

    async _assertSystemPathListable(vfsPath) {
        const normalized = this._normalizeSystemPath(vfsPath);
        if (normalized === '/System') return normalized;
        const segments = this._getSystemPathSegments({ path: normalized });
        await this._systemProvider.listDirectory(segments);
        return normalized;
    }

    async resolvePathInput(input) {
        const trimmed = (input || '').trim();
        if (!trimmed || trimmed === '/') return '/';

        try {
            let canonical = this.normalizePath(trimmed);
            if (canonical.split('/').filter(Boolean)[0] === 'System') {
                return await this._assertSystemPathListable(canonical);
            }
            this.parsePath(canonical);
            return canonical;
        } catch (_) { /* resolve friendly path */ }

        let parts = trimmed.replace(/^\/+/, '').split('/').filter(Boolean);
        const wm = this.globalResources.getWorkspaceManager();
        const workspaces = wm.getWorkspaces();
        let canonical = '';
        let i = 0;

        if (parts[0]?.toLowerCase() === 'system') {
            return await this._assertSystemPathListable('/' + parts.join('/'));
        }

        if (parts[0]?.toLowerCase() !== 'workspaces') {
            let parentId = null;
            for (; i < parts.length; i++) {
                const folders = await vfsDatabase.getFoldersByParent('root', null, parentId);
                const match = folders.find(f =>
                    !this._isHiddenSurfaceFolder(f) &&
                    (f.name || '').toLowerCase() === parts[i].toLowerCase()
                );
                if (!match) throw new Error(`Path not found: ${parts[i]}`);
                canonical = canonical ? `${canonical}/${match.id}` : `/${match.id}`;
                parentId = match.id;
            }
            return this.normalizePath(canonical);
        }

        i = 1;
        if (!parts[i]) return '/Workspaces';
        const wsId = this._resolveWorkspaceId(parts[i], workspaces);
        if (!wsId) throw new Error(`Workspace not found: ${parts[i]}`);
        canonical = `/Workspaces/${wsId}`;
        i++;

        let parentId = null;
        let onDesktop = false;

        while (i < parts.length) {
            const seg = parts[i];
            const reserved = !onDesktop && parentId === null
                ? this._matchReservedSystemFolder(seg)
                : null;

            if (reserved) {
                canonical = `${canonical}/${reserved}`;
                if (reserved === 'Desktop') onDesktop = true;
                else onDesktop = false;
                parentId = null;
                i++;
                continue;
            }

            const match = onDesktop
                ? await this._findWorkspaceFolderByName(wsId, parentId, seg, { desktopOnly: parentId === null })
                : await this._findWorkspaceFolderByName(wsId, parentId, seg, { excludeDesktop: parentId === null });

            if (!match) throw new Error(`Folder not found: ${seg}`);
            canonical = `${canonical}/${match.id}`;
            parentId = match.id;
            i++;
        }

        return this.normalizePath(canonical);
    }

    async _findHiddenSurfaceFolderId(scope, workspaceId) {
        const folders = await vfsDatabase.getFoldersByParent(scope, workspaceId, null);
        const surface = folders.find(f => this._isHiddenSurfaceFolder(f));
        return surface?.id || null;
    }

    async _sumImageFilenamesSize(filenames) {
        if (!filenames?.length) return 0;
        const imagesPath = this.globalResources.getPath('images');
        const batchSize = 64;
        let total = 0;
        for (let i = 0; i < filenames.length; i += batchSize) {
            const batch = filenames.slice(i, i + batchSize);
            const sizes = await Promise.all(batch.map(async (filename) => {
                try {
                    const st = await fs.promises.stat(path.join(imagesPath, filename));
                    return st.size;
                } catch (_) {
                    return 0;
                }
            }));
            total += sizes.reduce((sum, size) => sum + size, 0);
        }
        return total;
    }

    async _getRootPathStats() {
        const surfaceFolderId = await this._findHiddenSurfaceFolderId('root', null);
        const [folderCount, fileStats, surfaceEntryCount, linkedStats] = await Promise.all([
            vfsDatabase.getFolderCountByParent('root', null, null, { excludeHiddenSurface: true }),
            vfsDatabase.getUserFileStats('root', null, null),
            surfaceFolderId ? vfsDatabase.getEntryCountByFolder(surfaceFolderId) : 0,
            surfaceFolderId ? vfsDatabase.getLinkedUserFileStatsByFolder(surfaceFolderId) : { totalSize: 0 }
        ]);
        return {
            itemCount: ROOT_SYSTEM_FOLDERS.length + folderCount + surfaceEntryCount + fileStats.count,
            totalSizeBytes: fileStats.totalSize + (linkedStats.totalSize || 0)
        };
    }

    async _getWorkspaceHomePathStats(workspaceId) {
        const desktopFolderIds = [...this._getDesktopVfsFolderIds(workspaceId)];
        const surfaceFolderId = await this._findHiddenSurfaceFolderId('workspace', workspaceId);
        const wsStats = this._getWorkspaceStatsFromCache(workspaceId);
        const [folderCount, fileStats, surfaceEntryCount, linkedStats] = await Promise.all([
            vfsDatabase.getFolderCountByParent('workspace', workspaceId, null, {
                excludeHiddenSurface: true,
                excludeIds: desktopFolderIds
            }),
            vfsDatabase.getUserFileStats('workspace', workspaceId, null),
            surfaceFolderId ? vfsDatabase.getEntryCountByFolder(surfaceFolderId) : 0,
            surfaceFolderId ? vfsDatabase.getLinkedUserFileStatsByFolder(surfaceFolderId) : { totalSize: 0 }
        ]);
        const vfsBytes = fileStats.totalSize + (linkedStats.totalSize || 0);
        const workspaceImageBytes = wsStats?.diskUsageBytes || 0;
        return {
            itemCount: WORKSPACE_SYSTEM_FOLDERS.length + folderCount + surfaceEntryCount + fileStats.count,
            totalSizeBytes: Math.max(vfsBytes, workspaceImageBytes)
        };
    }

    async _getUserFolderPathStats(parsed) {
        const folder = await vfsDatabase.getFolderById(parsed.folderId);
        if (!folder) throw new Error('Folder not found');

        const [folderCount, entryCount, fileStats, linkedStats] = await Promise.all([
            vfsDatabase.getFolderCountByParent(folder.scope, folder.workspace_id, parsed.folderId),
            vfsDatabase.getEntryCountByFolder(parsed.folderId),
            vfsDatabase.getUserFileStats(folder.scope, folder.workspace_id, parsed.folderId),
            vfsDatabase.getLinkedUserFileStatsByFolder(parsed.folderId)
        ]);

        return {
            itemCount: folderCount + entryCount + fileStats.count,
            totalSizeBytes: fileStats.totalSize + linkedStats.totalSize
        };
    }

    async _getDesktopFolderPathStats(parsed) {
        const { shortcuts } = this.globalResources.getWorkspaceManager().getDesktopShortcuts(parsed.workspaceId);
        const shortcutCount = (shortcuts || []).filter(s => s.folderId === parsed.folderId).length;
        const [folderCount, entryCount, fileStats, linkedStats] = await Promise.all([
            vfsDatabase.getFolderCountByParent('workspace', parsed.workspaceId, parsed.folderId),
            vfsDatabase.getEntryCountByFolder(parsed.folderId),
            vfsDatabase.getUserFileStats('workspace', parsed.workspaceId, parsed.folderId),
            vfsDatabase.getLinkedUserFileStatsByFolder(parsed.folderId)
        ]);

        return {
            itemCount: folderCount + entryCount + fileStats.count + shortcutCount,
            totalSizeBytes: fileStats.totalSize + linkedStats.totalSize
        };
    }

    _getSystemPathSegments(parsed) {
        const parts = parsed.path.split('/').filter(Boolean);
        return parts[0] === 'System' ? parts.slice(1) : [];
    }

    _getSystemPathStats(parsed) {
        return this._systemProvider.getPathStats(this._getSystemPathSegments(parsed));
    }

    async _getSystemFolderPathStats(parsed) {
        const { workspaceId, systemName } = parsed;
        const ws = this.globalResources.getWorkspaceManager().getWorkspaces()[workspaceId];
        if (!ws) throw new Error('Workspace not found');

        switch (systemName) {
            case 'Desktop': {
                const { shortcuts } = this.globalResources.getWorkspaceManager().getDesktopShortcuts(workspaceId);
                const rootShortcuts = (shortcuts || []).filter(s => !s.folderId);
                return { itemCount: rootShortcuts.length, totalSizeBytes: 0 };
            }
            case 'Pictures': {
                const files = ws.files || [];
                return {
                    itemCount: files.length,
                    totalSizeBytes: await this._sumImageFilenamesSize(files)
                };
            }
            case 'References': {
                const refDb = this.globalResources.getReferenceMetadataDatabase();
                const refHashes = refDb.getWorkspaceReferences(workspaceId);
                const vibeRows = refDb.getWorkspaceVibesListLight(workspaceId);
                const cacheFilesMap = refDb.getFileCacheForReferences(refHashes);
                let totalSizeBytes = 0;
                for (const hash of refHashes) {
                    totalSizeBytes += cacheFilesMap[hash]?.size || 0;
                }
                return {
                    itemCount: refHashes.length + vibeRows.length,
                    totalSizeBytes
                };
            }
            case 'Notes': {
                const notesDb = this.globalResources.getNotesDatabase();
                const notes = await notesDb.getNotesByWorkspace(workspaceId);
                return {
                    itemCount: (notes || []).length,
                    totalSizeBytes: (notes || []).reduce((sum, n) => sum + (n.content || '').length, 0)
                };
            }
            case 'Scraps': {
                const scraps = ws.scraps || [];
                return {
                    itemCount: scraps.length,
                    totalSizeBytes: await this._sumImageFilenamesSize(scraps)
                };
            }
            case 'Trash': {
                const trashRows = await vfsDatabase.getTrashItemsByWorkspace(workspaceId);
                return { itemCount: trashRows.length, totalSizeBytes: 0 };
            }
            default:
                return { itemCount: 0, totalSizeBytes: 0 };
        }
    }

    async _computePathListingStats(parsed) {
        switch (parsed.type) {
            case 'root':
                return this._getRootPathStats();
            case 'system':
                return this._getSystemPathStats(parsed);
            case 'workspaces-list': {
                const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
                let totalSizeBytes = 0;
                for (const id of Object.keys(workspaces)) {
                    totalSizeBytes += this._getWorkspaceStatsFromCache(id)?.diskUsageBytes || 0;
                }
                return { itemCount: Object.keys(workspaces).length, totalSizeBytes };
            }
            case 'workspace-home':
                return this._getWorkspaceHomePathStats(parsed.workspaceId);
            case 'system-folder':
                return this._getSystemFolderPathStats(parsed);
            case 'desktop-folder':
                return this._getDesktopFolderPathStats(parsed);
            case 'user-folder':
            case 'root-user-folder':
                return this._getUserFolderPathStats(parsed);
            default:
                throw new Error(`Unsupported path type: ${parsed.type}`);
        }
    }

    async getPathStats(vfsPath) {
        const normalized = this.normalizePath(vfsPath);
        const cached = this._pathStatsCache.get(normalized);
        if (cached && Date.now() - cached.at < this._pathStatsCacheTtlMs) {
            return cached.stats;
        }

        const parsed = this.parsePath(vfsPath);
        const [display, listingStats] = await Promise.all([
            this.getPathDisplayInfo(vfsPath),
            this._computePathListingStats(parsed)
        ]);
        const stats = {
            path: vfsPath,
            displayName: display.displayName,
            displayPath: display.displayPath,
            itemCount: listingStats.itemCount,
            totalSizeBytes: listingStats.totalSizeBytes,
            selectedCount: 0
        };

        if (parsed.type === 'workspace-home' && parsed.workspaceId) {
            const wsInfo = this._getWorkspaceStatsFromCache(parsed.workspaceId);
            if (wsInfo) {
                stats.workspaceStats = wsInfo;
            }
        }

        if (parsed.type === 'root' && this.globalResources.getSystemInfoCache()?.disk) {
            stats.disk = this.globalResources.getSystemInfoCache().disk;
        }

        this._pathStatsCache.set(normalized, { stats, at: Date.now() });
        return stats;
    }

    async createFolderAtPath(vfsPath, name) {
        const parsed = this.parsePath(vfsPath);
        this._assertWritableContainerPath(parsed, 'create folders in');
        if (parsed.type === 'system-folder' && this._isTrashSystemName(parsed.systemName)) {
            throw new Error('Cannot create folders in Trash');
        }
        const trimmed = (name || '').trim();
        if (!trimmed) throw new Error('Folder name is required');

        if (parsed.type === 'root') {
            if (this.isReservedFolderName(trimmed, 'root')) throw new Error('Reserved folder name');
            return vfsDatabase.createFolder({ scope: 'root', name: trimmed, parentId: null });
        }
        if (parsed.type === 'workspace-home') {
            if (this.isReservedFolderName(trimmed, 'workspace-home')) throw new Error('Reserved folder name');
            return vfsDatabase.createFolder({ scope: 'workspace', workspaceId: parsed.workspaceId, name: trimmed, parentId: null });
        }
        if (parsed.type === 'user-folder' || parsed.type === 'desktop-folder') {
            const parent = await vfsDatabase.getFolderById(parsed.folderId);
            if (!parent) throw new Error('Parent folder not found');
            return vfsDatabase.createFolder({
                scope: parent.scope,
                workspaceId: parent.workspace_id,
                parentId: parent.id,
                name: trimmed
            });
        }
        throw new Error('Cannot create folder at this location');
    }

    async renameFolderAtPath(folderId, name) {
        const folder = await vfsDatabase.getFolderById(folderId);
        if (!folder) throw new Error('Folder not found');
        const context = folder.scope === 'root' ? 'root' : 'workspace-home';
        if (this.isReservedFolderName(name, context)) throw new Error('Reserved folder name');
        return vfsDatabase.renameFolder(folderId, name.trim());
    }

    async deleteFolderById(folderId) {
        const folder = await vfsDatabase.getFolderById(folderId);
        if (!folder) throw new Error('Folder not found');
        if (this._isHiddenSurfaceFolder(folder)) throw new Error('Cannot delete system folder');

        const childIds = await vfsDatabase.getChildFolderIds(folderId);
        for (const childId of childIds) {
            await this.deleteFolderById(childId);
        }

        const entries = await vfsDatabase.getEntriesByFolder(folderId);
        for (const entry of entries) {
            await this._deleteEntryWithAssets(entry, folder.workspace_id);
        }

        const files = await vfsDatabase.getUserFilesByLocation(folder.scope, folder.workspace_id, folderId);
        for (const file of files) {
            const contentHash = file.content_hash;
            await vfsDatabase.deleteUserFile(file.id);
            await this._gcContentBlobIfUnreferenced(contentHash);
        }

        return vfsDatabase.deleteFolderRow(folderId);
    }

    async _gcContentBlobIfUnreferenced(contentHash) {
        if (!contentHash) return;
        const remaining = await vfsDatabase.countUserFilesByContentHash(contentHash);
        if (remaining > 0) return;
        const blobPath = this.getFileBlobPath(contentHash);
        if (fs.existsSync(blobPath)) {
            try { fs.unlinkSync(blobPath); } catch (_) { /* ignore */ }
        }
        const previewPath = this.getFilePreviewPath(`${contentHash}.webp`);
        if (previewPath && fs.existsSync(previewPath)) {
            try { fs.unlinkSync(previewPath); } catch (_) { /* ignore */ }
        }
    }

    async _deleteEntryWithAssets(entry, workspaceId) {
        const kind = entry.target_kind;
        if (kind === 'desktop-shortcut' || kind === 'user-file') {
            await vfsDatabase.deleteEntry(entry.id);
            return;
        }
        if (this._isVirtualSurfaceKind(kind)) {
            await this._deleteVirtualSurfaceAsset({
                targetKind: kind,
                targetId: entry.target_id,
                workspaceId
            });
        }
        await vfsDatabase.deleteEntry(entry.id);
    }

    async _deleteVirtualSurfaceAsset(ref) {
        const wsId = ref.workspaceId;
        if (!wsId) return;
        const wm = this.globalResources.getWorkspaceManager();
        const refDb = this.globalResources.getReferenceMetadataDatabase();
        switch (ref.targetKind) {
            case 'image':
                wm.removeFromWorkspaceArray('files', [ref.targetId], wsId);
                break;
            case 'scrap':
                wm.removeFromWorkspaceArray('scraps', [ref.targetId], wsId);
                break;
            case 'reference':
                refDb.removeReferenceFromWorkspace(ref.targetId, wsId);
                break;
            case 'vibe':
                refDb.removeVibeFromWorkspace(ref.targetId, wsId);
                break;
            case 'note': {
                const notesDb = this.globalResources.getNotesDatabase();
                if (notesDb) await notesDb.deleteNote(ref.targetId);
                break;
            }
            default:
                break;
        }
    }

    async _wouldCreateFolderCycle(folderId, targetParentId) {
        if (!targetParentId) return false;
        if (targetParentId === folderId) return true;
        const descendants = await vfsDatabase.collectDescendantFolderIds(folderId);
        return descendants.includes(targetParentId);
    }

    async _moveFolder(folderId, targetPath) {
        const folder = await vfsDatabase.getFolderById(folderId);
        if (!folder) throw new Error('Folder not found');
        if (this._isHiddenSurfaceFolder(folder)) throw new Error('Cannot move system folder');

        const location = this.resolveLocationFromPath(targetPath);
        const targetParentId = location.folderId || null;

        if (await this._wouldCreateFolderCycle(folderId, targetParentId)) {
            throw new Error('Cannot move folder into itself or a subfolder');
        }

        const descendantIds = await vfsDatabase.collectDescendantFolderIds(folderId);
        const allFolderIds = [folderId, ...descendantIds];
        const wsId = location.scope === 'workspace' ? location.workspaceId : null;

        await vfsDatabase.updateFolder(folderId, {
            parent_id: targetParentId,
            scope: location.scope,
            workspace_id: wsId
        });

        for (const id of descendantIds) {
            await vfsDatabase.updateFolder(id, {
                scope: location.scope,
                workspace_id: wsId
            });
        }

        await vfsDatabase.updateUserFilesInFolders(allFolderIds, location.scope, wsId);
        return vfsDatabase.getFolderById(folderId);
    }

    async _copyFolderContents(srcFolderId, destFolderId, location, copyMode, wsId) {
        const srcFolder = await vfsDatabase.getFolderById(srcFolderId);
        if (!srcFolder) throw new Error('Source folder not found');

        const files = await vfsDatabase.getUserFilesByLocation(srcFolder.scope, srcFolder.workspace_id, srcFolderId);
        for (const file of files) {
            if (copyMode === 'shortcut') {
                await vfsDatabase.createEntry({
                    folderId: destFolderId,
                    targetKind: 'user-file',
                    targetId: file.id,
                    displayName: file.original_name
                });
            } else {
                await vfsDatabase.createUserFile({
                    contentHash: file.content_hash,
                    originalName: file.original_name,
                    mimeType: file.mime_type,
                    size: file.size,
                    scope: location.scope,
                    workspaceId: location.scope === 'workspace' ? location.workspaceId : null,
                    folderId: destFolderId,
                    previewPath: file.preview_path
                });
            }
        }

        const entries = await vfsDatabase.getEntriesByFolder(srcFolderId);
        for (const entry of entries) {
            if (entry.target_kind === 'desktop-shortcut' && entry.entry_meta) {
                const meta = this._parseEntryMetaJson(entry.entry_meta);
                if (meta?.type) {
                    await this._createShortcutEntryFromPayload(
                        { type: meta.type, name: entry.display_name || meta.name, data: meta.data || {}, id: meta.originalShortcutId || entry.target_id },
                        destFolderId,
                        wsId || srcFolder.workspace_id
                    );
                }
                continue;
            }
            if (entry.target_kind === 'user-file') {
                if (copyMode === 'shortcut') {
                    await vfsDatabase.createEntry({
                        folderId: destFolderId,
                        targetKind: 'user-file',
                        targetId: entry.target_id,
                        displayName: entry.display_name
                    });
                } else {
                    await this._copyUserFileRef(
                        { targetId: entry.target_id, name: entry.display_name, targetKind: 'user-file' },
                        this._folderPathFromLocation(location, destFolderId),
                        copyMode
                    );
                }
                continue;
            }
            if (this._isVirtualSurfaceKind(entry.target_kind)) {
                await vfsDatabase.createEntry({
                    folderId: destFolderId,
                    targetKind: entry.target_kind,
                    targetId: entry.target_id,
                    displayName: entry.display_name
                });
                continue;
            }
            await vfsDatabase.createEntry({
                folderId: destFolderId,
                targetKind: entry.target_kind,
                targetId: entry.target_id,
                displayName: entry.display_name,
                entryMeta: entry.entry_meta
            });
        }

        const childIds = await vfsDatabase.getChildFolderIds(srcFolderId);
        for (const childId of childIds) {
            const child = await vfsDatabase.getFolderById(childId);
            if (!child || this._isHiddenSurfaceFolder(child)) continue;
            const newChild = await vfsDatabase.createFolder({
                scope: location.scope,
                workspaceId: location.scope === 'workspace' ? location.workspaceId : null,
                parentId: destFolderId,
                name: child.name
            });
            await this._copyFolderContents(childId, newChild.id, location, copyMode, wsId);
        }
    }

    _folderPathFromLocation(location, folderId) {
        if (location.scope === 'root') {
            return folderId ? `/${folderId}` : '/';
        }
        const wsBase = `/Workspaces/${location.workspaceId}`;
        if (!folderId) return wsBase;
        return `${wsBase}/${folderId}`;
    }

    async _copyFolder(folderId, targetPath, copyMode = 'duplicate') {
        const folder = await vfsDatabase.getFolderById(folderId);
        if (!folder) throw new Error('Folder not found');
        if (this._isHiddenSurfaceFolder(folder)) throw new Error('Cannot copy system folder');

        const location = this.resolveLocationFromPath(targetPath);
        const wsId = location.scope === 'workspace' ? location.workspaceId : null;
        const newFolder = await vfsDatabase.createFolder({
            scope: location.scope,
            workspaceId: wsId,
            parentId: location.folderId || null,
            name: folder.name
        });

        await this._copyFolderContents(folderId, newFolder.id, location, copyMode, wsId);
        return newFolder;
    }

    async saveUserFileBuffer(buffer, { originalName, mimeType, scope, workspaceId, folderId }) {
        const hash = crypto.createHash('md5').update(buffer).digest('hex');
        const userFilesPath = this.globalResources.getPath('userFiles');
        if (!fs.existsSync(userFilesPath)) {
            fs.mkdirSync(userFilesPath, { recursive: true });
        }
        const blobPath = path.join(userFilesPath, hash);
        if (!fs.existsSync(blobPath)) {
            fs.writeFileSync(blobPath, buffer);
        }
        let previewPath = null;
        if ((mimeType || '').startsWith('image/')) {
            try {
                const sharp = require('sharp');
                const previewDir = path.join(userFilesPath, 'previews');
                if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });
                const previewFile = path.join(previewDir, `${hash}.webp`);
                await sharp(buffer).resize(512, 512, { fit: 'inside' }).webp().toFile(previewFile);
                previewPath = `${hash}.webp`;
            } catch (_) { /* preview optional */ }
        }
        return vfsDatabase.createUserFile({
            contentHash: hash,
            originalName: originalName || 'file',
            mimeType: mimeType || 'application/octet-stream',
            size: buffer.length,
            scope,
            workspaceId: scope === 'workspace' ? workspaceId : null,
            folderId: folderId || null,
            previewPath
        });
    }

    getFileBlobPath(contentHash) {
        return path.join(this.globalResources.getPath('userFiles'), contentHash);
    }

    getFilePreviewPath(previewPath) {
        if (!previewPath) return null;
        return path.join(this.globalResources.getPath('userFiles'), 'previews', previewPath);
    }

    resolveLocationFromPath(vfsPath) {
        const parsed = this.parsePath(vfsPath);
        this._assertWritableContainerPath(parsed, 'upload to');
        if (parsed.type === 'system-folder' && this._isTrashSystemName(parsed.systemName)) {
            throw new Error('Cannot modify Trash');
        }
        if (parsed.type === 'root') return { scope: 'root', workspaceId: null, folderId: null };
        if (parsed.type === 'root-user-folder') {
            return { scope: 'root', workspaceId: null, folderId: parsed.folderId };
        }
        if (parsed.type === 'workspace-home') return { scope: 'workspace', workspaceId: parsed.workspaceId, folderId: null };
        if (parsed.type === 'system-folder' && parsed.systemName === 'Desktop') {
            return { scope: 'workspace', workspaceId: parsed.workspaceId, folderId: null };
        }
        if (parsed.type === 'user-folder' || parsed.type === 'desktop-folder') {
            return { scope: 'workspace', workspaceId: parsed.workspaceId, folderId: parsed.folderId };
        }
        throw new Error(`Cannot move items to "${vfsPath}" (${parsed.type})`);
    }

    _describeMoveFailure(ref, targetPath) {
        const name = ref.name || ref.id || 'item';
        const kind = ref.targetKind || ref.kind || 'unknown';
        if (kind === 'image' || kind === 'scrap') {
            return `"${name}" is a workspace gallery file and cannot be moved. Use Add to Desktop or copy instead.`;
        }
        if (kind === 'reference' || kind === 'vibe') {
            return `"${name}" is a reference cache item and cannot be moved. Use Add to Desktop or Manage References instead.`;
        }
        if (kind === 'note') {
            return `"${name}" cannot be moved from the Notes folder to this location.`;
        }
        if (kind === 'vfs-folder') {
            return `Cannot move folder "${name}" to "${targetPath}".`;
        }
        return `Cannot move "${name}" (${kind}) to "${targetPath}".`;
    }

    _resolveDesktopShortcutMove(ref, location) {
        const wsId = ref.workspaceId || location.workspaceId;
        if (!wsId) return null;
        const { shortcuts } = this.globalResources.getWorkspaceManager().getDesktopShortcuts(wsId);
        if (!shortcuts?.length) return null;

        const sid = ref.shortcutId || ref.id;
        if (sid && shortcuts.some(s => s.id === sid)) {
            return { wsId, shortcutId: sid };
        }

        const fn = ref.targetId || ref.name;
        const byImage = shortcuts.find(s =>
            s.type === 'image' && (s.data?.filename === fn || s.name === fn)
        );
        if (byImage) return { wsId, shortcutId: byImage.id };

        const byRef = shortcuts.find(s =>
            (s.type === 'reference' || s.type === 'vibe')
            && (s.data?.hash === ref.targetId || s.name === ref.name)
        );
        if (byRef) return { wsId, shortcutId: byRef.id };

        const byNote = shortcuts.find(s =>
            s.type === 'note' && (s.data?.noteId === ref.targetId || s.id === sid)
        );
        if (byNote) return { wsId, shortcutId: byNote.id };

        const byFolder = shortcuts.find(s =>
            s.type === 'folder' && (
                s.id === sid
                || s.data?.vfsFolderId === ref.targetId
                || s.data?.vfsFolderId === ref.id
            )
        );
        if (byFolder) return { wsId, shortcutId: byFolder.id };

        if (ref.shortcutType) {
            const byType = shortcuts.find(s => s.id === sid || s.name === ref.name);
            if (byType) return { wsId, shortcutId: byType.id };
        }

        return null;
    }

    _isDesktopTargetPath(parsed) {
        return parsed.type === 'desktop-folder'
            || (parsed.type === 'system-folder' && parsed.systemName === 'Desktop');
    }

    async _resolveEntryFolderId(targetPath) {
        const parsed = this.parsePath(targetPath);
        this._assertWritableContainerPath(parsed, 'paste into');
        if (parsed.type === 'user-folder' || parsed.type === 'desktop-folder') {
            return parsed.folderId;
        }
        if (parsed.type === 'workspace-home') {
            const surfaceFolder = await this._getOrCreateSurfaceFolder('workspace', parsed.workspaceId);
            return surfaceFolder.id;
        }
        if (parsed.type === 'root') {
            const surfaceFolder = await this._getOrCreateSurfaceFolder('root', null);
            return surfaceFolder.id;
        }
        if (parsed.type === 'root-user-folder') {
            return parsed.folderId;
        }
        if (this._isDesktopTargetPath(parsed)) {
            throw new Error('Use move to Desktop to restore shortcuts to the desktop surface.');
        }
        throw new Error(`Cannot paste items to "${targetPath}" (${parsed.type})`);
    }

    async moveItems(itemRefs, targetPath) {
        const parsed = this.parsePath(targetPath);
        const isDesktopTarget = this._isDesktopTargetPath(parsed);
        const location = this.resolveLocationFromPath(targetPath);
        const results = [];
        const wm = this.globalResources.getWorkspaceManager();
        const wsId = location.workspaceId || parsed.workspaceId || null;
        const isDesktopRoot = parsed.type === 'system-folder' && parsed.systemName === 'Desktop';

        for (const ref of itemRefs) {
            const sourceWsId = this._shortcutWorkspaceId(ref, wsId);
            const isFolderShortcut = await this._isFolderShortcutRef(ref, sourceWsId);

            if (this._isCrossWorkspaceMove(ref, wsId)) {
                if (isFolderShortcut) {
                    results.push(await this._transferFolderShortcutCrossWorkspace(
                        ref, targetPath, location, wm, wsId,
                        { copy: false, isDesktopTarget, isDesktopRoot }
                    ));
                    continue;
                }
                throw new Error(
                    'Cross-workspace move is only supported for folder shortcuts. '
                    + 'Use Move to Workspace on the desktop for other item types.'
                );
            }

            if (isDesktopTarget) {
                if (this._isStoredShortcutRef(ref)) {
                    if (isFolderShortcut) {
                        const vfsFolderId = await this._resolveFolderShortcutVfsId(ref, sourceWsId);
                        if (vfsFolderId) await this._moveFolder(vfsFolderId, targetPath);
                    }
                    results.push(await this._importEntryToDesktop(ref, location, true));
                    continue;
                }
                if (isFolderShortcut && this._isLiveDesktopFolderShortcutRef(ref)) {
                    const vfsFolderId = await this._resolveFolderShortcutVfsId(ref, sourceWsId);
                    if (isDesktopRoot && vfsFolderId) {
                        results.push(this._promoteFolderToDesktopShortcut(
                            wm, sourceWsId, vfsFolderId, ref.name, null
                        ));
                    } else {
                        wm.updateDesktopShortcut(sourceWsId, ref.shortcutId || ref.id, {
                            folderId: location.folderId ?? null
                        });
                        results.push(ref);
                    }
                    continue;
                }
                const desktopMove = this._resolveDesktopShortcutMove(ref, location);
                if (desktopMove) {
                    wm.updateDesktopShortcut(desktopMove.wsId, desktopMove.shortcutId, {
                        folderId: location.folderId ?? null
                    });
                    results.push(ref);
                    continue;
                }
                if (this._isLiveDesktopShortcutRef(ref)) {
                    wm.updateDesktopShortcut(sourceWsId, ref.shortcutId || ref.id, {
                        folderId: location.folderId ?? null
                    });
                    results.push(ref);
                    continue;
                }
                if (ref.targetKind === 'vfs-folder' && !this._isLiveDesktopShortcutRef(ref)) {
                    const vfsFolderId = ref.targetId || ref.id;
                    const moved = await this._moveFolder(vfsFolderId, targetPath);
                    if (isDesktopRoot) {
                        results.push(this._promoteFolderToDesktopShortcut(
                            wm, sourceWsId, vfsFolderId, ref.name || moved.name, null
                        ));
                    } else {
                        results.push(this.makeFolderItem(moved, { workspaceId: sourceWsId }));
                    }
                    continue;
                }
            }

            if (isFolderShortcut && this._isLiveDesktopFolderShortcutRef(ref)) {
                const vfsFolderId = await this._resolveFolderShortcutVfsId(ref, sourceWsId);
                const moved = await this._moveFolder(vfsFolderId, targetPath);
                wm.removeDesktopShortcut(sourceWsId, ref.shortcutId || ref.id);
                results.push(this.makeFolderItem(moved, { workspaceId: sourceWsId }));
                continue;
            }

            if (isFolderShortcut && this._isStoredShortcutRef(ref)) {
                const vfsFolderId = await this._resolveFolderShortcutVfsId(ref, sourceWsId);
                const moved = await this._moveFolder(vfsFolderId, targetPath);
                const entryId = ref.vfsEntryId || ref.id;
                await vfsDatabase.deleteEntry(entryId);
                results.push(this.makeFolderItem(moved, { workspaceId: sourceWsId }));
                continue;
            }

            if (this._isLiveDesktopShortcutRef(ref)) {
                const shortcut = await this._resolveLiveDesktopShortcut(ref, sourceWsId);
                const entryFolderId = await this._resolveEntryFolderId(targetPath);
                const entry = await this._createShortcutEntryFromPayload(
                    shortcut,
                    entryFolderId,
                    sourceWsId
                );
                wm.removeDesktopShortcut(sourceWsId, shortcut.id);
                results.push(entry);
                continue;
            }

            if (this._isStoredShortcutRef(ref)) {
                const entryFolderId = await this._resolveEntryFolderId(targetPath);
                const entryId = ref.vfsEntryId || ref.id;
                await vfsDatabase.moveEntry(entryId, entryFolderId);
                results.push(ref);
                continue;
            }

            if (ref.targetKind === 'user-file') {
                await vfsDatabase.updateUserFile(ref.targetId, {
                    folder_id: location.folderId,
                    scope: location.scope,
                    workspace_id: location.scope === 'workspace' ? location.workspaceId : null
                });
                results.push(ref);
            } else if (ref.targetKind === 'vfs-folder') {
                const moved = await this._moveFolder(ref.targetId || ref.id, targetPath);
                results.push(this.makeFolderItem(moved, { workspaceId: sourceWsId }));
            } else if (this._isVirtualSurfaceKind(ref.targetKind)) {
                const entry = await this._createVirtualSurfaceEntry(ref, targetPath);
                await this._removeVirtualSurfaceFromSource(ref);
                results.push(entry);
            } else if (ref.isShortcut || ref.targetKind === 'vfs-entry') {
                const entryFolderId = await this._resolveEntryFolderId(targetPath);
                await vfsDatabase.moveEntry(ref.id, entryFolderId);
                results.push(ref);
            } else {
                throw new Error(this._describeMoveFailure(ref, targetPath));
            }
        }
        return results;
    }

    async copyItems(itemRefs, targetPath, options = {}) {
        const userFileCopyMode = options.userFileCopyMode === 'shortcut' ? 'shortcut' : 'duplicate';
        const parsed = this.parsePath(targetPath);
        const isDesktopTarget = this._isDesktopTargetPath(parsed);
        const location = isDesktopTarget ? this.resolveLocationFromPath(targetPath) : null;
        const wsId = location?.workspaceId || parsed.workspaceId || null;
        const wm = this.globalResources.getWorkspaceManager();
        const isDesktopRoot = parsed.type === 'system-folder' && parsed.systemName === 'Desktop';
        const results = [];

        for (const ref of itemRefs) {
            const sourceWsId = this._shortcutWorkspaceId(ref, wsId);
            const isFolderShortcut = await this._isFolderShortcutRef(ref, sourceWsId);

            if (this._isCrossWorkspaceMove(ref, wsId)) {
                if (isFolderShortcut) {
                    results.push(await this._transferFolderShortcutCrossWorkspace(
                        ref, targetPath, location, wm, wsId,
                        {
                            copy: true,
                            copyMode: userFileCopyMode,
                            isDesktopTarget,
                            isDesktopRoot
                        }
                    ));
                    continue;
                }
                throw new Error(
                    'Cross-workspace copy is only supported for folder shortcuts. '
                    + 'Use Move to Workspace on the desktop for other item types.'
                );
            }

            if (isDesktopTarget) {
                if (this._isStoredShortcutRef(ref) && !isFolderShortcut) {
                    results.push(await this._importEntryToDesktop(ref, location, false));
                    continue;
                }
                if (this._isLiveDesktopShortcutRef(ref) && !isFolderShortcut) {
                    results.push(await this._importEntryToDesktop(ref, location, false));
                    continue;
                }
            }

            if (isFolderShortcut) {
                const vfsFolderId = await this._resolveFolderShortcutVfsId(ref, sourceWsId);
                if (!vfsFolderId) throw new Error(`Folder shortcut not found: ${ref.name || ref.id}`);
                const copied = await this._copyFolder(vfsFolderId, targetPath, userFileCopyMode);
                if (isDesktopTarget) {
                    results.push(this._promoteFolderToDesktopShortcut(
                        wm,
                        sourceWsId,
                        copied.id,
                        copied.name,
                        isDesktopRoot ? null : (location.folderId ?? null)
                    ));
                } else {
                    results.push(this.makeFolderItem(copied, { workspaceId: sourceWsId }));
                }
                continue;
            }

            if (isDesktopTarget && ref.targetKind === 'vfs-folder' && !this._isLiveDesktopShortcutRef(ref)) {
                const copied = await this._copyFolder(ref.targetId || ref.id, targetPath, userFileCopyMode);
                if (isDesktopRoot) {
                    results.push(this._promoteFolderToDesktopShortcut(
                        wm, sourceWsId, copied.id, copied.name, null
                    ));
                } else {
                    results.push(this.makeFolderItem(copied, { workspaceId: sourceWsId }));
                }
                continue;
            }

            if (this._isLiveDesktopShortcutRef(ref)) {
                const shortcut = await this._resolveLiveDesktopShortcut(ref, sourceWsId);
                const entryFolderId = await this._resolveEntryFolderId(targetPath);
                results.push(await this._createShortcutEntryFromPayload(
                    shortcut,
                    entryFolderId,
                    sourceWsId
                ));
                continue;
            }

            if (this._isStoredShortcutRef(ref)) {
                const loaded = await this._loadShortcutEntryRef(ref);
                if (!loaded) throw new Error(`Shortcut not found: ${ref.name || ref.id}`);
                const entryFolderId = await this._resolveEntryFolderId(targetPath);
                results.push(await this._createShortcutEntryFromPayload(
                    loaded.payload,
                    entryFolderId,
                    sourceWsId
                ));
                continue;
            }

            if (ref.targetKind === 'user-file') {
                results.push(await this._copyUserFileRef(ref, targetPath, userFileCopyMode));
            } else if (ref.targetKind === 'vfs-folder') {
                const copied = await this._copyFolder(ref.targetId || ref.id, targetPath, userFileCopyMode);
                results.push(this.makeFolderItem(copied, { workspaceId: copied.workspace_id }));
            } else if (this._isVirtualSurfaceKind(ref.targetKind)) {
                results.push(await this._createVirtualSurfaceEntry(ref, targetPath));
            } else {
                const entryFolderId = await this._resolveEntryFolderId(targetPath);
                const entry = await vfsDatabase.createEntry({
                    folderId: entryFolderId,
                    targetKind: ref.targetKind,
                    targetId: ref.targetId,
                    displayName: ref.name
                });
                results.push(entry);
            }
        }
        return results;
    }

    async renameShortcutEntry(entryId, name) {
        const trimmed = (name || '').trim();
        if (!trimmed) throw new Error('Name is required');
        const entry = await vfsDatabase.getEntryById(entryId);
        if (!entry || entry.target_kind !== 'desktop-shortcut') {
            throw new Error('Shortcut entry not found');
        }
        const meta = this._parseEntryMetaJson(entry.entry_meta) || {};
        meta.name = trimmed;
        return vfsDatabase.updateEntry(entryId, {
            display_name: trimmed,
            entry_meta: JSON.stringify(meta)
        });
    }

    async renameEntry(entryId, name) {
        const trimmed = (name || '').trim();
        if (!trimmed) throw new Error('Name is required');
        const entry = await vfsDatabase.getEntryById(entryId);
        if (!entry) throw new Error('Entry not found');
        return vfsDatabase.updateEntry(entryId, { display_name: trimmed });
    }

    buildItemPreviewUrl(item, vfsPathUuid) {
        if (item.previewDataUrl) {
            return item.previewDataUrl;
        }
        if (item.galleryPreview) {
            return `/previews/${encodeURIComponent(item.galleryPreview)}`;
        }
        if (item.previewCachePreview) {
            return `/cache/preview/${item.previewCachePreview}`;
        }
        if (item.previewImageFilename) {
            return `/images/${encodeURIComponent(item.previewImageFilename)}`;
        }
        if (item.previewHash) {
            return `/cache/preview/${item.previewHash}.webp`;
        }
        if (vfsPathUuid && item.previewFileId) {
            return `/${vfsPathUuid}/previews/${item.previewFileId}`;
        }
        return null;
    }

    async readSystemFile(systemFileKey, options = {}) {
        return this._systemProvider.readFile(systemFileKey, options);
    }

    resolveSystemFileDownload(systemFileKey) {
        return this._systemProvider.resolveDownloadableFile(systemFileKey);
    }

    encodeSystemFileKey(systemFileKey) {
        return this._systemProvider.encodeSystemFileKey(systemFileKey);
    }

    decodeSystemFileKey(encoded) {
        return this._systemProvider.decodeSystemFileKey(encoded);
    }

    _resolveTrashWorkspaceId(sourcePath, itemRef) {
        try {
            const parsed = this.parsePath(sourcePath || '/');
            if (parsed.workspaceId) return parsed.workspaceId;
        } catch (_) { /* fall through */ }
        return itemRef?.workspaceId || null;
    }

    _isTrashableItemRef(ref) {
        if (!ref || ref.isShortcut || ref.isUserFileLink || ref.isVfsShortcutEntry || ref.vfsEntryId) {
            return false;
        }
        if (ref.isDesktopShortcut || ref.shortcutId || ref.shortcutType) return false;
        const kind = ref.targetKind || ref.kind;
        return ['vfs-folder', 'user-file', 'image', 'scrap', 'reference', 'vibe', 'note'].includes(kind);
    }

    async _hideVirtualSurfaceAsset(ref) {
        return this._removeVirtualSurfaceFromSource(ref);
    }

    async _restoreVirtualSurfaceAsset(ref) {
        const wsId = ref.workspaceId;
        if (!wsId) return;
        const wm = this.globalResources.getWorkspaceManager();
        const refDb = this.globalResources.getReferenceMetadataDatabase();
        switch (ref.targetKind) {
            case 'image':
                wm.addToWorkspaceArray('files', [ref.targetId], wsId);
                break;
            case 'scrap':
                wm.addToWorkspaceArray('scraps', [ref.targetId], wsId);
                break;
            case 'reference':
                refDb.addReferenceToWorkspace(ref.targetId, wsId);
                break;
            case 'vibe':
                refDb.addVibeToWorkspace(ref.targetId, wsId);
                break;
            case 'note': {
                const notesDb = this.globalResources.getNotesDatabase();
                const note = notesDb ? await notesDb.getNote(ref.targetId) : null;
                if (note) {
                    const meta = { ...(note.metadata || {}) };
                    delete meta.vfsHidden;
                    await notesDb.updateNote(ref.targetId, { metadata: meta });
                }
                break;
            }
            default:
                break;
        }
    }

    async _trashFolder(folderId, sourcePath, workspaceId) {
        const folder = await vfsDatabase.getFolderById(folderId);
        if (!folder || folder.trashed_at) throw new Error('Folder not found');
        if (this._isHiddenSurfaceFolder(folder)) throw new Error('Cannot move system folder to trash');

        const now = Math.floor(Date.now() / 1000);
        const descendantIds = await vfsDatabase.collectDescendantFolderIds(folderId);
        const allFolderIds = [folderId, ...descendantIds];

        await vfsDatabase.markFoldersTrashed(allFolderIds, now);
        await vfsDatabase.markUserFilesTrashedInFolders(allFolderIds, now);

        const trashItem = await vfsDatabase.createTrashItem({
            workspaceId,
            itemKind: 'vfs-folder',
            targetId: folderId,
            displayName: folder.name,
            originalPath: sourcePath,
            payloadJson: JSON.stringify({
                scope: folder.scope,
                parentId: folder.parent_id,
                descendantFolderIds: descendantIds
            })
        });

        this.invalidatePathStatsCache();
        return this._trashRecordToItem(trashItem, { workspaceId, size: 0 });
    }

    async _trashUserFile(fileId, sourcePath, workspaceId) {
        const file = await vfsDatabase.getUserFileById(fileId);
        if (!file || file.trashed_at) throw new Error('File not found');

        const now = Math.floor(Date.now() / 1000);
        await vfsDatabase.markUserFileTrashed(fileId, now);

        const trashItem = await vfsDatabase.createTrashItem({
            workspaceId,
            itemKind: 'user-file',
            targetId: fileId,
            displayName: file.original_name,
            originalPath: sourcePath,
            payloadJson: JSON.stringify({
                scope: file.scope,
                folderId: file.folder_id,
                mimeType: file.mime_type,
                size: file.size
            })
        });

        this.invalidatePathStatsCache();
        return this._trashRecordToItem(trashItem, {
            workspaceId,
            size: file.size,
            mimeType: file.mime_type
        });
    }

    async _trashVirtualSurfaceItem(ref, sourcePath, workspaceId) {
        const kind = ref.targetKind;
        const targetId = ref.targetId;
        if (!kind || !targetId) throw new Error('Invalid item for trash');

        if (await vfsDatabase.isTargetInTrash(workspaceId, kind, targetId)) {
            throw new Error('Item is already in trash');
        }

        await this._hideVirtualSurfaceAsset({ targetKind: kind, targetId, workspaceId });

        const payload = {
            previewImageFilename: ref.previewImageFilename || null,
            previewHash: ref.previewHash || null,
            noteIcon: ref.noteIcon || null,
            noteColor: ref.noteColor || null,
            refType: ref.refType || null,
            size: ref.size || 0,
            mimeType: ref.mimeType || null
        };

        const trashItem = await vfsDatabase.createTrashItem({
            workspaceId,
            itemKind: kind,
            targetId,
            displayName: ref.name || targetId,
            originalPath: sourcePath,
            payloadJson: JSON.stringify(payload)
        });

        this.invalidatePathStatsCache();
        return this._trashRecordToItem(trashItem, { workspaceId, ...payload });
    }

    async moveItemsToTrash(itemRefs, sourcePath) {
        const workspaceId = this._resolveTrashWorkspaceId(sourcePath, itemRefs?.[0]);
        if (!workspaceId) throw new Error('Workspace required for trash');

        const results = [];
        for (const ref of itemRefs || []) {
            if (!this._isTrashableItemRef(ref)) {
                throw new Error(`"${ref.name || ref.id}" cannot be moved to trash`);
            }
            const kind = ref.targetKind || ref.kind;
            if (kind === 'vfs-folder') {
                results.push(await this._trashFolder(ref.targetId || ref.id, sourcePath, workspaceId));
            } else if (kind === 'user-file') {
                results.push(await this._trashUserFile(ref.targetId || ref.id, sourcePath, workspaceId));
            } else if (this._isVirtualSurfaceKind(kind)) {
                results.push(await this._trashVirtualSurfaceItem(ref, sourcePath, workspaceId));
            } else {
                throw new Error(`Cannot move ${kind} to trash`);
            }
        }
        return results;
    }

    async restoreFromTrash(trashItemId) {
        const trashItem = await vfsDatabase.getTrashItemById(trashItemId);
        if (!trashItem) throw new Error('Trash item not found');

        const workspaceId = trashItem.workspace_id;
        const payload = this._parseTrashPayload(trashItem);

        switch (trashItem.item_kind) {
            case 'vfs-folder': {
                const folderId = trashItem.target_id;
                const folder = await vfsDatabase.getFolderById(folderId);
                if (!folder) throw new Error('Trashed folder no longer exists');
                const descendantIds = payload.descendantFolderIds || [];
                const allFolderIds = [folderId, ...descendantIds];
                await vfsDatabase.clearFolderTrashed(allFolderIds);
                await vfsDatabase.clearUserFilesTrashedInFolders(allFolderIds);
                if (payload.parentId !== folder.parent_id) {
                    await vfsDatabase.updateFolder(folderId, { parent_id: payload.parentId ?? null });
                }
                break;
            }
            case 'user-file': {
                await vfsDatabase.clearUserFileTrashed(trashItem.target_id);
                const file = await vfsDatabase.getUserFileById(trashItem.target_id);
                if (file && payload.folderId !== undefined && file.folder_id !== payload.folderId) {
                    await vfsDatabase.updateUserFile(trashItem.target_id, { folder_id: payload.folderId });
                }
                break;
            }
            default:
                if (this._isVirtualSurfaceKind(trashItem.item_kind)) {
                    await this._restoreVirtualSurfaceAsset({
                        targetKind: trashItem.item_kind,
                        targetId: trashItem.target_id,
                        workspaceId
                    });
                } else {
                    throw new Error(`Cannot restore ${trashItem.item_kind}`);
                }
        }

        await vfsDatabase.deleteTrashItem(trashItemId);
        this.invalidatePathStatsCache();
        return { success: true, workspaceId, originalPath: trashItem.original_path };
    }

    async _permanentlyDeleteTrashRecord(trashItem) {
        if (!trashItem) throw new Error('Trash item not found');
        const workspaceId = trashItem.workspace_id;
        const payload = this._parseTrashPayload(trashItem);

        switch (trashItem.item_kind) {
            case 'vfs-folder': {
                const folderId = trashItem.target_id;
                const folder = await vfsDatabase.getFolderById(folderId);
                if (folder) {
                    await vfsDatabase.clearFolderTrashed([folderId, ...(payload.descendantFolderIds || [])]);
                    await this.deleteFolderById(folderId);
                }
                break;
            }
            case 'user-file': {
                const file = await vfsDatabase.getUserFileById(trashItem.target_id);
                if (file) {
                    await vfsDatabase.clearUserFileTrashed(trashItem.target_id);
                    const contentHash = file.content_hash;
                    await vfsDatabase.deleteUserFile(trashItem.target_id);
                    await this._gcContentBlobIfUnreferenced(contentHash);
                }
                break;
            }
            default:
                if (this._isVirtualSurfaceKind(trashItem.item_kind)) {
                    await this._deleteVirtualSurfaceAsset({
                        targetKind: trashItem.item_kind,
                        targetId: trashItem.target_id,
                        workspaceId
                    });
                } else {
                    throw new Error(`Cannot permanently delete ${trashItem.item_kind}`);
                }
        }

        await vfsDatabase.deleteTrashItem(trashItem.id);
        this.invalidatePathStatsCache();
        return { success: true };
    }

    async permanentlyDeleteTrashItem(trashItemId) {
        const trashItem = await vfsDatabase.getTrashItemById(trashItemId);
        return this._permanentlyDeleteTrashRecord(trashItem);
    }

    async permanentlyDeleteItems(itemRefs, sourcePath) {
        const results = [];
        for (const ref of itemRefs || []) {
            if (ref.isTrashItem || ref.trashItemId) {
                results.push(await this.permanentlyDeleteTrashItem(ref.trashItemId || ref.id));
                continue;
            }
            if (this._isTrashableItemRef(ref)) {
                results.push(await this._permanentlyDeleteNativeItem(ref, sourcePath));
                continue;
            }
            results.push(await this._permanentlyDeleteShortcutOrEntry(ref, sourcePath));
        }
        return results;
    }

    async _permanentlyDeleteNativeItem(ref, sourcePath) {
        const workspaceId = this._resolveTrashWorkspaceId(sourcePath, ref);
        const kind = ref.targetKind || ref.kind;

        if (kind === 'vfs-folder') {
            await this.deleteFolderById(ref.targetId || ref.id);
            return { success: true, kind };
        }
        if (kind === 'user-file') {
            const file = await vfsDatabase.getUserFileById(ref.targetId || ref.id);
            if (!file) throw new Error('File not found');
            const contentHash = file.content_hash;
            await vfsDatabase.deleteUserFile(file.id);
            await this._gcContentBlobIfUnreferenced(contentHash);
            return { success: true, kind };
        }
        if (this._isVirtualSurfaceKind(kind)) {
            await this._deleteVirtualSurfaceAsset({
                targetKind: kind,
                targetId: ref.targetId,
                workspaceId
            });
            return { success: true, kind };
        }
        throw new Error(`Cannot permanently delete ${kind}`);
    }

    async _permanentlyDeleteShortcutOrEntry(ref) {
        if (ref.isVfsShortcutEntry || ref.vfsEntryId) {
            const entryId = ref.vfsEntryId || ref.id;
            const entry = await vfsDatabase.getEntryById(entryId);
            if (entry && this._isVirtualSurfaceKind(entry.target_kind)) {
                await this._deleteVirtualSurfaceAsset({
                    targetKind: entry.target_kind,
                    targetId: entry.target_id,
                    workspaceId: ref.workspaceId
                });
            } else if (entry?.target_kind === 'vfs-folder') {
                await this.deleteFolderById(entry.target_id);
            }
            await vfsDatabase.deleteEntry(entryId);
            return { success: true, kind: 'entry' };
        }
        throw new Error('Use remove shortcut for shortcut-only deletes');
    }

    async emptyTrash(workspaceId) {
        const trashRows = await vfsDatabase.getTrashItemsByWorkspace(workspaceId);
        for (const row of trashRows) {
            await this._permanentlyDeleteTrashRecord(row);
        }
        this.invalidatePathStatsCache();
        return { success: true, count: trashRows.length };
    }

    enrichItemsWithPreviewUrls(items, vfsPathUuid) {
        return items.map(item => ({
            ...item,
            previewUrl: this.buildItemPreviewUrl(item, vfsPathUuid)
        }));
    }
}

module.exports = {
    VfsManager,
    VFS_SYSTEM_IDS,
    ROOT_RESERVED_NAMES,
    WORKSPACE_RESERVED_NAMES,
    WORKSPACE_SYSTEM_FOLDERS,
    ROOT_SYSTEM_FOLDERS
};
