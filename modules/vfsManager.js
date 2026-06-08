const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vfsDatabase = require('./vfsDatabase');

const VFS_SYSTEM_IDS = {
    SYSTEM: '@system',
    WORKSPACES: '@workspaces',
    DESKTOP: '@desktop',
    PICTURES: '@pictures',
    REFERENCES: '@references',
    NOTES: '@notes',
    SCRAPS: '@scraps'
};

const ROOT_RESERVED_NAMES = ['System', 'Workspaces'];
const WORKSPACE_RESERVED_NAMES = ['Desktop', 'Pictures', 'References', 'Notes', 'Scraps'];

const WORKSPACE_SYSTEM_FOLDERS = [
    { id: VFS_SYSTEM_IDS.DESKTOP, name: 'Desktop', icon: 'fas fa-desktop' },
    { id: VFS_SYSTEM_IDS.PICTURES, name: 'Pictures', icon: 'fas fa-image' },
    { id: VFS_SYSTEM_IDS.REFERENCES, name: 'References', icon: 'fas fa-swatchbook' },
    { id: VFS_SYSTEM_IDS.NOTES, name: 'Notes', icon: 'fas fa-notebook' },
    { id: VFS_SYSTEM_IDS.SCRAPS, name: 'Scraps', icon: 'fas fa-bin-recycle' }
];

const ROOT_SYSTEM_FOLDERS = [
    { id: VFS_SYSTEM_IDS.SYSTEM, name: 'System', icon: 'fas fa-cog' },
    { id: VFS_SYSTEM_IDS.WORKSPACES, name: 'Workspaces', icon: 'fas fa-planet-ringed' }
];

class VfsManager {
    constructor(globalResources) {
        this.globalResources = globalResources;
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
            case 'note':
                break;
            default:
                break;
        }
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

    sortItems(items, sortField = 'name', sortDirection = 'asc') {
        const dir = sortDirection === 'desc' ? -1 : 1;
        const folders = items.filter(i => i.kind === 'folder');
        const files = items.filter(i => i.kind !== 'folder');
        const sortFn = (a, b) => {
            let av, bv;
            switch (sortField) {
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
                emptyMessage = 'System folders will appear here in a future update';
                break;

            case 'workspaces-list': {
                const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
                items = Object.entries(workspaces).map(([id, ws]) => ({
                    id: `ws-${id}`,
                    name: ws.name || id,
                    kind: 'folder',
                    targetKind: 'workspace',
                    targetId: id,
                    navPath: `/Workspaces/${id}`,
                    icon: 'fas fa-planet-ringed',
                    system: true,
                    protected: false,
                    importable: false,
                    color: ws.color,
                    size: 0,
                    modifiedAt: null
                }));
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

        items = this.filterItems(items, search);
        items = this.sortItems(items, sortField, sortDirection);
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

        switch (systemName) {
            case 'Desktop': {
                const { shortcuts } = this.globalResources.getWorkspaceManager().getDesktopShortcuts(workspaceId);
                const rootShortcuts = (shortcuts || []).filter(s => !s.folderId);
                const desktopFolderIds = this._getDesktopVfsFolderIds(workspaceId);
                const folders = await vfsDatabase.getFoldersByParent('workspace', workspaceId, null);
                const desktopFolders = folders.filter(f => desktopFolderIds.has(f.id));
                return [
                    ...desktopFolders.map(f => this.makeFolderItem(f, {
                        importable: false,
                        navPath: `/Workspaces/${workspaceId}/Desktop/${f.id}`,
                        workspaceId
                    })),
                    ...rootShortcuts.filter(s => s.type !== 'folder').map(s => this._shortcutToItem(s, workspaceId))
                ];
            }
            case 'Pictures': {
                const files = ws.files || [];
                const imagesPath = this.globalResources.getPath('images');
                let filenames = [...files];
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
                return (notes || []).map(n => ({
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
                const scraps = ws.scraps || [];
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
            return {
                displayName: 'System',
                displayPath: '/System',
                segments: [{ label: 'System', canonical: '/System' }]
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

    async resolvePathInput(input) {
        const trimmed = (input || '').trim();
        if (!trimmed || trimmed === '/') return '/';

        try {
            const canonical = this.normalizePath(trimmed);
            this.parsePath(canonical);
            return canonical;
        } catch (_) { /* resolve friendly path */ }

        let parts = trimmed.replace(/^\/+/, '').split('/').filter(Boolean);
        const wm = this.globalResources.getWorkspaceManager();
        const workspaces = wm.getWorkspaces();
        let canonical = '';
        let i = 0;

        if (parts[0]?.toLowerCase() === 'system') {
            return '/System';
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

    async getPathStats(vfsPath) {
        const result = await this.listDirectory(vfsPath, { offset: 0, limit: Number.MAX_SAFE_INTEGER });
        const parsed = this.parsePath(vfsPath);
        const display = await this.getPathDisplayInfo(vfsPath);
        const stats = {
            path: vfsPath,
            displayName: display.displayName,
            displayPath: display.displayPath,
            itemCount: result.totalCount,
            totalSizeBytes: result.totalSizeBytes,
            selectedCount: 0
        };

        if (parsed.type === 'workspace-home' && parsed.workspaceId) {
            const sysInfo = this.globalResources.getSystemInfoCache();
            const wsInfo = sysInfo?.workspaces?.find(w => {
                const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
                const ws = workspaces[parsed.workspaceId];
                return ws && w.name === ws.name;
            });
            if (wsInfo) {
                stats.workspaceStats = wsInfo;
            }
        }

        if (parsed.type === 'root' && this.globalResources.getSystemInfoCache()?.disk) {
            stats.disk = this.globalResources.getSystemInfoCache().disk;
        }

        return stats;
    }

    async createFolderAtPath(vfsPath, name) {
        const parsed = this.parsePath(vfsPath);
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
        return vfsDatabase.deleteFolder(folderId);
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
            return `"${name}" is a notebook entry and cannot be moved. Use Add to Desktop instead.`;
        }
        if (kind === 'vfs-folder') {
            return `Moving folders to "${targetPath}" is not supported yet.`;
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

        for (const ref of itemRefs) {
            if (isDesktopTarget) {
                if (this._isStoredShortcutRef(ref)) {
                    results.push(await this._importEntryToDesktop(ref, location, true));
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
                    wm.updateDesktopShortcut(wsId || ref.workspaceId, ref.shortcutId || ref.id, {
                        folderId: location.folderId ?? null
                    });
                    results.push(ref);
                    continue;
                }
            }

            if (this._isLiveDesktopShortcutRef(ref)) {
                const shortcut = await this._resolveLiveDesktopShortcut(ref, wsId || ref.workspaceId);
                const entryFolderId = await this._resolveEntryFolderId(targetPath);
                const entry = await this._createShortcutEntryFromPayload(
                    shortcut,
                    entryFolderId,
                    wsId || ref.workspaceId
                );
                wm.removeDesktopShortcut(wsId || ref.workspaceId, shortcut.id);
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
                throw new Error(this._describeMoveFailure(ref, targetPath));
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
        const results = [];

        for (const ref of itemRefs) {
            if (isDesktopTarget) {
                if (this._isStoredShortcutRef(ref) || this._isLiveDesktopShortcutRef(ref)) {
                    results.push(await this._importEntryToDesktop(ref, location, false));
                    continue;
                }
            }

            if (this._isLiveDesktopShortcutRef(ref)) {
                const shortcut = await this._resolveLiveDesktopShortcut(ref, wsId || ref.workspaceId);
                const entryFolderId = await this._resolveEntryFolderId(targetPath);
                results.push(await this._createShortcutEntryFromPayload(
                    shortcut,
                    entryFolderId,
                    wsId || ref.workspaceId
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
                    wsId || ref.workspaceId
                ));
                continue;
            }

            if (ref.targetKind === 'user-file') {
                results.push(await this._copyUserFileRef(ref, targetPath, userFileCopyMode));
            } else if (ref.targetKind === 'vfs-folder') {
                throw new Error('Copying folders is not supported yet.');
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
