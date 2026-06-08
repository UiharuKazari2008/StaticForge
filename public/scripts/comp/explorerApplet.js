// Explorer Applet — public/scripts/comp/explorerApplet.js

const EXPLORER_FOLDER_VIEW_KEY = 'explorerFolderViewModes';
const EXPLORER_DEFAULT_VIEW_KEY = 'explorerDefaultViewMode';

const EXPLORER_IMAGE_GALLERY_CONTEXT_ACTIONS = new Set([
    'toggle-favorite', 'reroll', 'download', 'copy', 'open-in-window', 'modify',
    'expand-canvas', 'upscale', 'view-image-data', 'start-chat', 'set-wallpaper',
    'jump-to-image', 'create-reference', 'create-desktop-shortcut', 'scrap', 'delete',
    'move-to-workspace'
]);

const DESKTOP_GLOBAL_CONTEXT_ACTIONS = new Set([
    'refresh-cache', 'clear-cache', 'toggle-glass', 'toggle-privacy-mode',
    'desktop-new-folder', 'desktop-paste', 'open-desktop-settings', 'open-about-melatonin',
    'exit-desktop', 'toggle-gallery-window', 'lock-app', 'logout'
]);

function isEditableTextInputTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.matches?.('input, textarea, select')) return true;
    if (el.isContentEditable) return true;
    return !!el.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

function isVfsOrImageFileDrag(dataTransfer) {
    if (!dataTransfer) return false;
    const types = dataTransfer.types ? [...dataTransfer.types] : [];
    if (types.includes('application/x-vfs-file-id')) return true;
    if (types.includes('Files')) {
        const files = [...(dataTransfer.files || [])];
        return files.some((f) => f.type && f.type.startsWith('image/'));
    }
    return false;
}

/** Wire VFS/image drop onto Studio — lazy; skips text fields. public/scripts/comp/explorerApplet.js */
function wireStudioVfsDrop() {
    const manualModal = document.getElementById('manualModal');
    if (!manualModal || manualModal.dataset.vfsDropWired === 'true') return;
    manualModal.dataset.vfsDropWired = 'true';

    manualModal.addEventListener('dragover', (e) => {
        if (!isVfsOrImageFileDrag(e.dataTransfer)) return;
        if (isEditableTextInputTarget(e.target)) return;
        e.preventDefault();
        manualModal.classList.add('reference-drop-target');
    });
    manualModal.addEventListener('dragleave', (e) => {
        if (!manualModal.contains(e.relatedTarget)) {
            manualModal.classList.remove('reference-drop-target');
        }
    });
    manualModal.addEventListener('drop', async (e) => {
        const isEditable = isEditableTextInputTarget(e.target);
        const isVfsOrImage = isVfsOrImageFileDrag(e.dataTransfer);
        if (isEditable && !isVfsOrImage) return;
        if (!isVfsOrImage) return;

        e.preventDefault();
        e.stopPropagation();
        manualModal.classList.remove('reference-drop-target');

        const fileId = e.dataTransfer.getData('application/x-vfs-file-id');
        const mime = e.dataTransfer.getData('application/x-vfs-file-mime') || '';
        if (fileId && mime.startsWith('image/')) {
            try {
                const resp = await vfsClient.downloadFile(fileId);
                if (resp.downloadUrl && typeof addReferenceFromUrl === 'function') {
                    await addReferenceFromUrl(resp.downloadUrl);
                    showGlassToast('success', null, 'Image added to Studio', false, 3000);
                } else if (resp.fileData) {
                    await wsClient.uploadReference(resp.fileData, activeWorkspace, null, null, null, null, []);
                    showGlassToast('success', null, 'Image added to Studio', false, 3000);
                }
            } catch (err) {
                showGlassToast('error', 'Studio', err.message || 'Failed to add image', false, 5000);
            }
            return;
        }

        const files = [...(e.dataTransfer.files || [])];
        if (files.length && files[0].type.startsWith('image/') && typeof unifiedUploadModalManager !== 'undefined') {
            unifiedUploadModalManager.handleFiles?.(files);
        }
    });
}

function isDesktopSurfaceContextTarget(target) {
    if (!target) return false;
    if (target.closest?.('.desktop-shortcut')) return false;
    if (target.id === 'desktopIcons' || target.id === 'desktopGridContainer' || target.id === 'desktopFreeformContainer') {
        return true;
    }
    return !!target.closest?.('#desktopIcons');
}

const EXPLORER_SORT_OPTIONS = [
    { value: 'name:asc', field: 'name', direction: 'asc', label: 'Name (A–Z)' },
    { value: 'name:desc', field: 'name', direction: 'desc', label: 'Name (Z–A)' },
    { value: 'date:desc', field: 'date', direction: 'desc', label: 'Date (Newest)' },
    { value: 'date:asc', field: 'date', direction: 'asc', label: 'Date (Oldest)' },
    { value: 'type:asc', field: 'type', direction: 'asc', label: 'Type (A–Z)' },
    { value: 'type:desc', field: 'type', direction: 'desc', label: 'Type (Z–A)' },
    { value: 'size:desc', field: 'size', direction: 'desc', label: 'Size (Largest)' },
    { value: 'size:asc', field: 'size', direction: 'asc', label: 'Size (Smallest)' }
];

class ExplorerApplet {
    constructor() {
        this.modal = null;
        this.currentPath = '/';
        this.history = ['/'];
        this.historyIndex = 0;
        this.items = [];
        this.totalCount = 0;
        this.hasMore = false;
        this.loadedOffset = 0;
        this.pageLimit = 300;
        this.clipboard = null;
        this.grid = null;
        this.searchQuery = '';
        this.sortField = localStorage.getItem('explorerSortField') || 'name';
        this.sortDirection = localStorage.getItem('explorerSortDirection') || 'asc';
        this.viewMode = 'icons-lg';
        this._searchDebounce = null;
        this._pathStats = null;
        this._contextMenuTarget = null;
        this._contextMenuConfig = null;
        this._contextMenuWired = false;
        this._loading = false;
        this._loadingMore = false;
        this._navToken = 0;
        this._busyKind = null;
        this._busyDetail = null;
        this._statusHint = null;
        this._uploadSeq = 0;
        this._emptyMessage = null;
    }

    init() {
        this.modal = document.getElementById('explorerModal');
        if (!this.modal) return;

        this.bindElements();
        this.bindEvents();
        this.setupDropdowns();
        this.setupDetailsHeader();
        this.setupExplorerContextMenu();

        const gridHost = document.getElementById('explorerGridHost');
        if (gridHost) {
            this.grid = new VfsVirtualGrid(gridHost, {
                viewMode: this.viewMode,
                populateIconBox: (box, item) => this._populateIconBox(box, item),
                onItemOpen: (item) => this.openItem(item),
                onSelectionChange: (sel) => this.onSelectionChange(sel),
                onItemContextMenu: (item, e) => this.showItemContextMenu(item, e),
                onNearEnd: () => this.loadMore(),
                onItemDrop: (item, e) => this.handleItemDrop(item, e),
                onFileDrop: (files) => this.uploadFilesToPath(this.currentPath, files),
                onItemsDrop: (dragItems, target) => this.handleItemsDrop(dragItems, target)
            });
        }

        this._applyViewModeForPath(this.currentPath);
        this.updateSortLabel();
        this.updateViewsLabel();
    }

    getDefaultPath() {
        const ws = typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
        if (ws) return `/Workspaces/${ws}`;
        return '/';
    }

    getWorkspaceIdFromPath() {
        const parts = this.currentPath.split('/').filter(Boolean);
        if (parts[0] === 'Workspaces' && parts.length >= 2) return parts[1];
        return typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
    }

    setupDetailsHeader() {
        const header = this.el?.detailsHeader;
        if (!header) return;
        header.querySelectorAll('[data-sort-field]').forEach((col) => {
            col.addEventListener('click', () => this.toggleSortByField(col.dataset.sortField));
        });
        this.updateDetailsHeaderSort();
        this.updateDetailsHeaderVisibility();
    }

    toggleSortByField(field) {
        if (!field) return;
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        localStorage.setItem('explorerSortField', this.sortField);
        localStorage.setItem('explorerSortDirection', this.sortDirection);
        this.updateSortLabel();
        this.updateDetailsHeaderSort();
        this.navigateTo(this.currentPath);
    }

    updateDetailsHeaderVisibility() {
        const header = this.el?.detailsHeader;
        if (!header) return;
        const show = this.viewMode === 'details';
        header.classList.toggle('hidden', !show);
        header.setAttribute('aria-hidden', show ? 'false' : 'true');
    }

    updateDetailsHeaderSort() {
        const header = this.el?.detailsHeader;
        if (!header) return;
        header.querySelectorAll('[data-sort-field]').forEach((col) => {
            const field = col.dataset.sortField;
            const active = field === this.sortField;
            col.classList.toggle('active', active);
            const icon = col.querySelector('.explorer-details-sort-icon');
            if (!icon) return;
            icon.className = 'explorer-details-sort-icon fas ' + (
                active
                    ? (this.sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down')
                    : 'fa-sort'
            );
        });
    }

    setupExplorerContextMenu() {
        if (this._contextMenuWired || !contextMenu) return;
        const gridHost = document.getElementById('explorerGridHost');
        if (!gridHost) return;

        this._contextMenuConfig = {
            maxHeight: true,
            sections: [],
            beforeShow: (event) => {
                const itemEl = event.target.closest('.explorer-item');
                if (!itemEl) {
                    this._contextMenuTarget = null;
                    this._setContextMenuSections(this.buildEmptyContextMenuSections());
                    return;
                }
                const itemId = itemEl.dataset.itemId;
                const item = (this.grid?.items || this.items).find(i => i.id === itemId);
                this._contextMenuTarget = item || null;
                this._setContextMenuSections(item
                    ? this.buildContextMenuSections(item)
                    : this.buildEmptyContextMenuSections());
            }
        };

        contextMenu.attachToElement(gridHost, this._contextMenuConfig);
        this._contextMenuWired = true;

        if (!document.body.dataset.explorerContextWired) {
            document.body.dataset.explorerContextWired = 'true';
            document.addEventListener('contextMenuAction', (e) => this.handleContextMenuAction(e));
        }
    }

    _setContextMenuSections(sections) {
        if (!this._contextMenuConfig) return;
        this._contextMenuConfig.sections = sections || [];
    }

    buildEmptyContextMenuSections() {
        const items = [
            { icon: 'fas fa-folder-plus', text: 'New Folder', action: 'explorer-new-folder' },
            { icon: 'fas fa-upload', text: 'Upload', action: 'explorer-upload' }
        ];
        if (this.clipboard) {
            items.push({ separator: true });
            items.push({ icon: 'fas fa-paste', text: 'Paste', action: 'explorer-paste' });
        }
        return [{ type: 'list', items }];
    }

    _getFolderViewModes() {
        try {
            return JSON.parse(localStorage.getItem(EXPLORER_FOLDER_VIEW_KEY) || '{}');
        } catch {
            return {};
        }
    }

    _resolveViewModeForPath(path) {
        const normalized = (path || '/').replace(/\/+$/, '') || '/';
        const map = this._getFolderViewModes();
        const parts = normalized.split('/').filter(Boolean);
        for (let i = parts.length; i >= 0; i--) {
            const p = i === 0 ? '/' : `/${parts.slice(0, i).join('/')}`;
            if (map[p]) return map[p];
        }
        return localStorage.getItem(EXPLORER_DEFAULT_VIEW_KEY)
            || localStorage.getItem('explorerViewMode')
            || 'icons-lg';
    }

    _applyViewModeForPath(path) {
        const mode = this._resolveViewModeForPath(path);
        this.setViewMode(mode, true);
    }

    _getDesktopShortcutContextSections(item) {
        if (!item?.shortcutType || typeof desktopShortcuts === 'undefined') return [];
        const shortcut = {
            id: item.id,
            name: item.name,
            type: item.shortcutType,
            data: item.shortcutData || {}
        };
        const typeHandler = desktopShortcuts.shortcutTypes[shortcut.type];
        const config = typeHandler?.contextMenu
            ? typeHandler.contextMenu.call(desktopShortcuts, shortcut)
            : desktopShortcuts.getDefaultContextMenu(shortcut);
        return config.sections ? [...config.sections] : [];
    }

    _explorerContextTargetItem() {
        return explorerApplet?._contextMenuTarget || this._contextMenuTarget || null;
    }

    _explorerContextGalleryImage() {
        const item = this._explorerContextTargetItem();
        return item ? this._resolveGalleryImage(item) : null;
    }

    _explorerContextCacheImage() {
        const item = this._explorerContextTargetItem();
        return item ? this._resolveReferenceCacheImage(item) : null;
    }

    _shortcutToExplorerItem(shortcut, { isDesktopShortcut = false } = {}) {
        if (!shortcut) return null;
        const data = shortcut.data || shortcut.shortcutData || {};
        const item = {
            id: shortcut.id,
            name: shortcut.name,
            shortcutType: shortcut.type || shortcut.shortcutType,
            shortcutData: data,
            isDesktopShortcut: !!isDesktopShortcut,
            kind: 'shortcut'
        };
        if (item.shortcutType === 'image') {
            item.targetKind = 'image';
            item.previewImageFilename = data.filename;
            item.targetId = data.filename;
        }
        return item;
    }

    _resolveGalleryImage(item) {
        if (!item) return null;
        const filename = item.previewImageFilename || item.targetId || item.shortcutData?.filename;
        if (!filename) return null;
        // public/scripts/comp/galleryView.js findImageByFilename
        if (typeof findImageByFilename === 'function') {
            const found = findImageByFilename(filename);
            if (found) return found;
        }
        if (typeof allImages !== 'undefined' && Array.isArray(allImages)) {
            return allImages.find(img =>
                img.filename === filename || img.original === filename || img.upscaled === filename
            ) || null;
        }
        return null;
    }

    _getNoteContextData(item) {
        return {
            id: item.targetId,
            name: item.name,
            icon: item.noteIcon,
            color: item.noteColor
        };
    }

    _isDesktopMode() {
        return document.body.classList.contains('desktop-mode');
    }

    _isManualModalActive() {
        const manualModal = document.getElementById('manualModal');
        return !!(manualModal && !manualModal.classList.contains('hidden'));
    }

    _shouldRemoveShortcutOnly(item) {
        if (!item) return false;
        if (this._isFolderShortcutItem(item)) return false;
        if (this._isLiveDesktopShortcutItem(item)) return true;
        if (this._isStoredShortcutItem(item)) return true;
        if (this._isVfsVirtualEntry(item)) return true;
        if (this._isUserFileLinkItem(item)) return true;
        return false;
    }

    async _removeShortcutItem(item) {
        if (!item) return;
        if (this._isLiveDesktopShortcutItem(item)) {
            if (typeof desktopShortcuts !== 'undefined') {
                await desktopShortcuts.removeShortcut(item.id);
                this._refreshDesktop();
            }
            return;
        }
        await vfsClient.deleteEntry(item.id);
    }

    _shouldHideJumpToImage(item) {
        const onDesktop = this._isLiveDesktopShortcutItem(item) || !!item.isDesktopShortcut;
        if (onDesktop) return false;
        if (this.modal && !this.modal.classList.contains('hidden')) {
            const path = this.currentPath || '';
            if (item.targetKind === 'scrap' && /\/Scraps(\/|$)/.test(path)) return true;
            if (item.targetKind === 'image' && /\/Pictures(\/|$)/.test(path)) return true;
            return false;
        }
        const currentView = typeof currentGalleryView !== 'undefined' ? currentGalleryView : 'images';
        return currentView === 'images' && !window.currentSearchTerm;
    }

    _isGalleryImageContextItem(item) {
        if (!item) return false;
        if (item.targetKind === 'image' || item.targetKind === 'scrap') return true;
        if (item.shortcutType === 'image') return true;
        if (item.previewImageFilename && this._resolveGalleryImage(item)) return true;
        return false;
    }

    _buildImageScrapContextMenuSections(item) {
        const image = this._resolveGalleryImage(item);
        const isScrap = item.targetKind === 'scrap';
        const isDesktop = this._isDesktopMode();
        const onDesktop = this._isLiveDesktopShortcutItem(item) || !!item.isDesktopShortcut;

        return [
            {
                type: 'icons',
                position: 'outer',
                icons: [
                    {
                        icon: image?.isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star',
                        tooltip: image?.isPinned ? 'Unfavorite' : 'Favorite',
                        action: 'toggle-favorite',
                        loadfn: (menuItem) => {
                            const img = this._explorerContextGalleryImage();
                            if (!img) return;
                            menuItem.icon = img.isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
                            menuItem.tooltip = img.isPinned ? 'Unfavorite' : 'Favorite';
                        }
                    },
                    { icon: 'fas fa-dice-three', tooltip: 'Recast Spell', action: 'reroll' },
                    { icon: 'fas fa-download', tooltip: 'Download', action: 'download' },
                    { icon: 'fas fa-clipboard', tooltip: 'Copy', action: 'copy' }
                ]
            },
            {
                type: 'list',
                items: [
                    { icon: 'fas fa-external-link-alt', text: 'Open in Window', action: 'open-in-window', hideOnBreakpoint: 'small-mobile' },
                    { icon: 'fas fa-compass-drafting', text: 'Edit in DreamStudio', action: 'modify', hideOnBreakpoint: 'small-mobile' },
                    { icon: 'mdi mdi-1-25 mdi-relative-scale', text: 'Expand Canvas', action: 'expand-canvas' },
                    {
                        icon: 'nai-upscale',
                        text: 'Upscale',
                        action: 'upscale',
                        disabled: !!(image?.upscaled),
                        loadfn: (menuItem) => {
                            const img = this._explorerContextGalleryImage();
                            if (!img) return;
                            if (img.upscaled) {
                                menuItem.disabled = true;
                                return;
                            }
                            // public/scripts/comp/galleryView.js calculateUpscaleInfo
                            if (img.width && img.height && typeof calculateUpscaleInfo === 'function') {
                                const upscaleInfo = calculateUpscaleInfo(img.width, img.height);
                                if (!upscaleInfo.available) {
                                    menuItem.disabled = true;
                                    menuItem.subtitle = 'Image too large';
                                } else {
                                    menuItem.disabled = false;
                                    menuItem.subtitle = null;
                                }
                            } else {
                                menuItem.disabled = false;
                            }
                        }
                    },
                    {
                        icon: 'fas fa-glasses-round',
                        text: 'Properties',
                        action: 'view-image-data',
                        disabled: true
                    },
                    { separator: true },
                    { icon: 'fas fa-person-to-portal', text: 'Create Chat', action: 'start-chat' },
                    {
                        icon: 'fas fa-image',
                        text: 'Set as Wallpaper',
                        action: 'set-wallpaper',
                        hidden: () => !isDesktop
                    },
                    {
                        icon: 'fas fa-crosshairs',
                        text: 'Jump to Image',
                        action: 'jump-to-image',
                        hidden: () => this._shouldHideJumpToImage(item)
                    },
                    { icon: 'nai-img2img', text: 'New Reference', action: 'create-reference' },
                    {
                        icon: 'fas fa-arrow-down-left',
                        text: 'Add to Desktop',
                        action: 'create-desktop-shortcut',
                        hidden: () => !isDesktop || onDesktop
                    }
                ]
            },
            {
                type: 'list',
                title: 'Management',
                items: [
                    {
                        icon: 'fas fa-folder-arrow-up',
                        text: 'Move to...',
                        optionsfn: () => this._getExplorerMoveWorkspaceOptions(),
                        handlerfn: (subItem) => this._handleExplorerMoveWorkspace(subItem, item),
                        openOnHover: false
                    },
                    {
                        icon: isScrap ? 'nai-dot-reset' : 'fas fa-bin-recycle',
                        text: isScrap ? 'Restore' : 'Scrap',
                        action: 'scrap',
                        loadfn: (menuItem) => {
                            const targetItem = this._explorerContextTargetItem();
                            if (targetItem?.targetKind === 'scrap') {
                                menuItem.text = 'Restore';
                                menuItem.icon = 'nai-dot-reset';
                            } else {
                                menuItem.text = 'Scrap';
                                menuItem.icon = 'fas fa-bin-recycle';
                            }
                        }
                    },
                    {
                        icon: 'fas fa-fire',
                        text: 'Incinerate',
                        action: 'delete',
                        className: 'context-menu-item-danger'
                    }
                ]
            }
        ];
    }

    _buildNoteContextMenuSections(item) {
        const onDesktop = this._isLiveDesktopShortcutItem(item) || !!item.isDesktopShortcut;
        return [
            {
                type: 'list',
                items: [
                    { icon: 'fas fa-window', text: 'Open in Window', action: 'open-in-window' },
                    {
                        icon: 'fas fa-arrow-down-left',
                        text: 'Add to Desktop',
                        action: 'add-to-desktop',
                        hidden: () => onDesktop
                    }
                ]
            },
            {
                type: 'list',
                title: 'Management',
                items: [
                    { icon: 'fas fa-cog', text: 'Properties', action: 'modify-note' },
                    {
                        icon: 'fas fa-trash',
                        text: 'Delete Note',
                        action: 'delete-note',
                        className: 'context-menu-item-danger'
                    }
                ]
            }
        ];
    }

    _buildReferenceContextMenuSections(item) {
        const isDesktop = this._isDesktopMode();
        const manualActive = this._isManualModalActive();
        const listItems = [
            {
                icon: 'fas fa-external-link-alt',
                text: 'Open in Window',
                action: 'reference-manager-open-in-window',
                loadfn: (menuItem) => {
                    menuItem.disabled = !this._explorerContextCacheImage();
                }
            },
            {
                icon: 'nai-vibe-transfer',
                text: 'New Encoding',
                action: 'reference-manager-vibe-encode',
                loadfn: (menuItem) => {
                    const cacheImage = this._explorerContextCacheImage();
                    menuItem.disabled = !cacheImage || !!cacheImage.locked;
                }
            },
            {
                icon: 'xai-icon',
                text: 'New Session',
                action: 'reference-manager-director',
                loadfn: (menuItem) => {
                    const cacheImage = this._explorerContextCacheImage();
                    menuItem.disabled = !cacheImage || cacheImage.isStandalone;
                }
            },
        ];

        listItems.push({
            icon: 'fas fa-plus',
            text: 'Add to Studio as...',
            hidden: () => !manualActive,
            submenu: [
                {
                    text: 'Base Image',
                    icon: 'nai-img2img',
                    action: 'reference-manager-add-as-base',
                    loadfn: (menuItem) => {
                        const cacheImage = this._explorerContextCacheImage();
                        menuItem.disabled = !cacheImage || cacheImage.isStandalone;
                    }
                },
                {
                    text: 'Vibe',
                    icon: 'nai-vibe-transfer',
                    action: 'reference-manager-add-as-vibe',
                    loadfn: (menuItem) => {
                        const cacheImage = this._explorerContextCacheImage();
                        if (!cacheImage || window.currentMaskData) {
                            menuItem.disabled = true;
                            return;
                        }
                        // public/scripts/comp/referenceManager.js getCurrentSelectedModel
                        const currentModel = getCurrentSelectedModel();
                        let hasCompatibleEncodings = false;
                        if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
                            hasCompatibleEncodings = cacheImage.vibes.some(vibe =>
                                vibe.encodings && vibe.encodings.some(encoding =>
                                    encoding.model.toLowerCase() === currentModel.toLowerCase()
                                )
                            );
                        }
                        menuItem.disabled = !hasCompatibleEncodings;
                    }
                },
                {
                    text: 'Precise Reference',
                    icon: 'nai-precise-reference',
                    action: 'reference-manager-add-as-character',
                    loadfn: (menuItem) => {
                        const cacheImage = this._explorerContextCacheImage();
                        menuItem.disabled = !cacheImage || !cacheImage.hash;
                    }
                }
            ]
        });

        listItems.push({ separator: true });
        listItems.push({
            icon: 'fas fa-image',
            text: 'Set as Wallpaper',
            action: 'reference-manager-set-wallpaper',
            hidden: () => !isDesktop
        });
        listItems.push({
            icon: 'fas fa-arrow-down-left',
            text: 'Add to Desktop...',
            hidden: () => !isDesktop,
            submenu: [
                { text: 'Base Image', icon: 'nai-img2img', action: 'reference-manager-create-shortcut-base' },
                { text: 'Vibe', icon: 'nai-vibe-transfer', action: 'reference-manager-create-shortcut-vibe' },
                { text: 'Precise Reference', icon: 'nai-precise-reference', action: 'reference-manager-create-shortcut-character' }
            ]
        });

        return [
            {
                type: 'icons',
                icons: [
                    {
                        icon: 'fas fa-comment',
                        tooltip: 'View Comments',
                        action: 'reference-manager-comment',
                        loadfn: (menuItem) => {
                            const cacheImage = this._explorerContextCacheImage();
                            if (!cacheImage) {
                                menuItem.disabled = true;
                                return;
                            }
                            const vibesWithComments = cacheImage.vibes?.filter(vibe =>
                                vibe.comment && vibe.comment.trim() !== ''
                            ) || [];
                            menuItem.disabled = vibesWithComments.length === 0;
                        }
                    }
                ]
            },
            {
                type: 'list',
                items: listItems
            },
            {
                type: 'list',
                title: 'Management',
                items: [
                    {
                        icon: 'fas fa-planet-ringed',
                        text: 'Move to...',
                        optionsfn: () => this._getExplorerReferenceMoveOptions(item),
                        handlerfn: (subItem) => this._handleExplorerReferenceMove(subItem, item),
                        openOnHover: false
                    },
                    {
                        icon: 'fas fa-file-export',
                        text: 'Export',
                        submenu: [
                            { text: 'Copy', icon: 'fas fa-copy', action: 'explorer-convert-ref-copy' },
                            { text: 'Move', icon: 'fas fa-cut', action: 'explorer-convert-ref-move' }
                        ]
                    },
                    {
                        icon: 'fas fa-fire',
                        text: 'Destroy',
                        optionsfn: () => this._getExplorerReferenceDeleteOptions(item),
                        handlerfn: (subItem) => this._handleExplorerReferenceDelete(subItem, item),
                        openOnHover: false,
                        className: 'context-menu-item-danger'
                    },
                    { icon: 'fas fa-cog', text: 'Properties', action: 'reference-manager-manage' }
                ]
            }
        ];
    }

    _normalizeMenuItems(items) {
        const result = [];
        for (const item of items || []) {
            if (item.separator) {
                if (result.length && !result[result.length - 1]?.separator) {
                    result.push({ separator: true });
                }
            } else {
                result.push(item);
            }
        }
        while (result.length && result[result.length - 1]?.separator) result.pop();
        return result;
    }

    _isSystemItem(item) {
        if (!item) return false;
        return item.targetKind === 'system-folder'
            || item.targetKind === 'workspace'
            || !!item.system;
    }

    _canCutCopyItem(item) {
        if (!item || item.protected || this._isSystemItem(item)) return false;
        return true;
    }

    _canRenameItem(item) {
        if (!item || item.protected || this._isSystemItem(item)) return false;
        if (item.targetKind === 'vfs-folder' || item.targetKind === 'user-file') return true;
        if (item.shortcutType || this._isStoredShortcutItem(item) || this._isLiveDesktopShortcutItem(item)) return true;
        if (this._isVfsVirtualEntry(item) || this._isUserFileLinkItem(item)) return true;
        if (item.isShortcut && this._isVirtualSurfaceItem(item)) return true;
        return false;
    }

    _stripFileOpsFromSections(sections) {
        const stripActions = new Set([
            'explorer-cut', 'explorer-copy', 'explorer-rename', 'explorer-paste',
            'remove-shortcut', 'rename-shortcut', 'delete-folder-shortcut',
            'explorer-remove-shortcut', 'explorer-delete'
        ]);
        return (sections || []).map((section) => {
            if (section.type !== 'list' || !section.items) return section;
            const items = section.items.filter((menuItem) => {
                if (menuItem.separator) return true;
                return !menuItem.action || !stripActions.has(menuItem.action);
            });
            return { ...section, items: this._normalizeMenuItems(items) };
        }).filter((section) => {
            if (section.type === 'list') return section.items?.length > 0;
            return true;
        });
    }

    _getFileManagementRemoveIcon(item, { multi, selCount }) {
        if (item.shortcutType) {
            return {
                icon: 'fas fa-trash',
                tooltip: multi && selCount > 1 ? `Remove ${selCount} items` : 'Remove',
                action: 'remove-shortcut'
            };
        }
        if (!multi && this._shouldRemoveShortcutOnly(item)) {
            return {
                icon: 'fas fa-unlink',
                tooltip: 'Remove Shortcut',
                action: 'explorer-remove-shortcut'
            };
        }
        if (item.targetKind === 'vfs-folder' || item.targetKind === 'user-file' || multi) {
            return {
                icon: 'fas fa-trash',
                tooltip: multi && selCount > 1 ? `Delete ${selCount} items` : 'Delete',
                action: 'explorer-delete'
            };
        }
        return null;
    }

    _buildFileManagementIcons(item, { multi, selCount }) {
        if (!item) return [];
        const icons = [];

        if (this._canCutCopyItem(item)) {
            icons.push({
                icon: 'fas fa-cut',
                tooltip: multi && selCount > 1 ? `Cut ${selCount} items` : 'Cut',
                action: 'explorer-cut'
            });
            icons.push({
                icon: 'fas fa-copy',
                tooltip: multi && selCount > 1 ? `Copy ${selCount} items` : 'Copy',
                action: 'explorer-copy'
            });
        }

        if (!multi && this._canRenameItem(item)) {
            icons.push({
                icon: 'fas fa-i-cursor',
                tooltip: 'Rename',
                action: 'explorer-rename'
            });
        }

        const removeIcon = this._getFileManagementRemoveIcon(item, { multi, selCount });
        if (removeIcon) icons.push(removeIcon);

        return icons;
    }

    _getImportMenuItem(item, { multi } = {}) {
        if (!item || multi) return null;
        if (item.targetKind !== 'user-file' || !(item.mimeType || '').startsWith('image/')) return null;
        return {
            icon: 'fas fa-swatchbook',
            text: 'Import',
            submenu: [
                { text: 'Copy', icon: 'fas fa-copy', action: 'explorer-convert-file-ref-copy' },
                { text: 'Move', icon: 'fas fa-cut', action: 'explorer-convert-file-ref-move' }
            ]
        };
    }

    _insertAfterMoveTo(items, insertItem) {
        if (!insertItem) return items;
        const result = [...items];
        const moveIdx = result.findIndex((i) => i.text === 'Move to...');
        if (moveIdx === -1) {
            result.push(insertItem);
        } else {
            result.splice(moveIdx + 1, 0, insertItem);
        }
        return result;
    }

    _buildManagementListItems(item, { multi } = {}) {
        if (!item) return [];
        const items = [];

        if (this.clipboard && (this._isSystemItem(item) || item.targetKind === 'vfs-folder')) {
            items.push({ icon: 'fas fa-paste', text: 'Paste', action: 'explorer-paste' });
        }
        if (item.targetKind === 'user-file' && !multi) {
            items.push({ icon: 'fas fa-download', text: 'Download', action: 'explorer-download' });
        }
        return items;
    }

    _isShortcutOnlyListSection(sections, section) {
        if (section.type !== 'list' || section.title) return false;
        const lists = (sections || []).filter((s) => s.type === 'list');
        if (lists.length !== 1 || lists[0] !== section) return false;
        if ((sections || []).some((s) => s.type === 'icons')) return false;
        const primaryActions = new Set([
            'open-folder-shortcut', 'explorer-open', 'explorer-navigate',
            'open-note', 'open-in-studio', 'open-note-in-notebook'
        ]);
        const hasPrimary = (section.items || []).some((i) => i.action && primaryActions.has(i.action));
        return !hasPrimary;
    }

    _finalizeContextMenuSections(sections, item, vfsOpts) {
        const stripped = this._stripFileOpsFromSections(sections);
        const nonMgmtSections = [];
        let mgmtListItems = [];

        for (const section of stripped) {
            if (section.type === 'list' && section.title === 'Management') {
                mgmtListItems.push(...(section.items || []));
            } else if (this._isShortcutOnlyListSection(stripped, section)) {
                mgmtListItems.push(...(section.items || []));
            } else {
                nonMgmtSections.push(section);
            }
        }

        const builtItems = this._buildManagementListItems(item, vfsOpts || {});
        const fileIcons = this._buildFileManagementIcons(item, vfsOpts || {});
        let combinedMgmt = [...builtItems, ...mgmtListItems];
        combinedMgmt = this._insertAfterMoveTo(combinedMgmt, this._getImportMenuItem(item, vfsOpts || {}));
        mgmtListItems = this._normalizeMenuItems(combinedMgmt);

        const result = [...nonMgmtSections];
        if (fileIcons.length || mgmtListItems.length) {
            if (fileIcons.length) {
                result.push({ type: 'icons', title: 'Management', icons: fileIcons });
            }
            if (mgmtListItems.length) {
                result.push({
                    type: 'list',
                    title: fileIcons.length ? undefined : 'Management',
                    items: mgmtListItems
                });
            }
        }

        return result.length ? result : this.buildEmptyContextMenuSections();
    }

    _getExplorerMoveWorkspaceOptions() {
        const workspaceOptions = [];
        const workspacesData = workspaces || {};
        let currentWorkspaceId = 'default';
        if (typeof activeWorkspace !== 'undefined') {
            currentWorkspaceId = activeWorkspace;
        } else if (getActiveWorkspace) {
            currentWorkspaceId = getActiveWorkspace();
        }

        Object.values(workspacesData)
            .sort((a, b) => (a.sort || 0) - (b.sort || 0))
            .filter(workspace => workspace.id !== currentWorkspaceId)
            .forEach((workspace) => {
                const workspaceColor = workspace.color || '#6366f1';
                workspaceOptions.push({
                    content: `
                        <div class="workspace-option-content" style="display: flex; align-items: center; gap: 8px;">
                            <div class="workspace-color-indicator" style="width: 12px; height: 12px; border-radius: 50%; background-color: ${workspaceColor};"></div>
                            <span class="context-menu-item-text">${workspace.name}</span>
                        </div>
                    `,
                    action: 'move-to-workspace',
                    workspaceId: workspace.id,
                    workspaceName: workspace.name
                });
            });
        return workspaceOptions;
    }

    async _handleExplorerMoveWorkspace(subItem, item) {
        const workspaceId = subItem.workspaceId;
        const workspaceName = subItem.workspaceName;
        if (!workspaceId || !workspaceName) return;

        const image = this._resolveGalleryImage(item);
        if (!image) {
            showGlassToast('error', 'Explorer', 'Could not resolve image data', false, 4000);
            return;
        }

        const filename = image.filename || image.original || image.upscaled;
        if (!filename) return;

        const confirmed = await showConfirmationDialog(
            `Move this image to workspace "${workspaceName}"?`,
            [
                { text: 'Move', value: true, className: 'btn-primary' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        if (!confirmed) return;

        let currentWorkspaceId = this.getWorkspaceIdFromPath();
        if (!currentWorkspaceId) {
            if (typeof activeWorkspace !== 'undefined') currentWorkspaceId = activeWorkspace;
            else if (getActiveWorkspace) currentWorkspaceId = getActiveWorkspace();
            else currentWorkspaceId = 'default';
        }

        const moveType = item.targetKind === 'scrap' ? 'scraps' : 'files';
        const response = await wsClient.moveFilesToWorkspace([filename], workspaceId, currentWorkspaceId, moveType);
        if (!response?.success) {
            throw new Error(response?.message || 'Move failed');
        }

        showGlassToast('success', 'Moved', `Image moved to ${workspaceName}`, false, 3000, '<i class="mdi mdi-1-5 mdi-folder-move"></i>');
        if (typeof loadGallery === 'function') loadGallery(true);
        await this.softRefresh();
    }

    _getExplorerReferenceMoveOptions(item) {
        const cacheImage = this._resolveReferenceCacheImage(item);
        if (!cacheImage) return [];

        const sourceWorkspace = item.workspaceId || this.getWorkspaceIdFromPath() || activeWorkspace || 'default';
        const options = [];
        Object.values(workspaces || {}).forEach((workspace) => {
            if (workspace.id === sourceWorkspace) return;
            const workspaceColor = workspace.color || '#102040';
            options.push({
                content: `
                    <div class="workspace-option-content">
                        <div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div>
                        <div class="workspace-name">${workspace.name}</div>
                    </div>
                `,
                value: workspace.id,
                className: 'custom-dropdown-option'
            });
        });
        return options;
    }

    async _handleExplorerReferenceMove(option, item) {
        const cacheImage = this._resolveReferenceCacheImage(item);
        if (!cacheImage) return;

        const sourceWorkspace = item.workspaceId || this.getWorkspaceIdFromPath() || activeWorkspace || 'default';
        const targetWorkspace = option.value;
        const workspace = Object.values(workspaces || {}).find(ws => ws.id === targetWorkspace);
        const workspaceName = workspace ? workspace.name : targetWorkspace;
        let message = `Move this reference to ${workspaceName}?`;
        if (cacheImage.hasVibes && !cacheImage.isStandalone) {
            message = `This item contains both a base image and vibe encodings. Both will be moved to ${workspaceName}. Continue?`;
        }

        const confirmed = await showConfirmationDialog(
            message,
            [
                { text: 'Move', value: true, className: 'btn-primary' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        if (!confirmed) return;

        try {
            let response;
            if (cacheImage.isStandalone) {
                if (cacheImage.vibes && cacheImage.vibes.length > 0) {
                    response = await wsClient.moveVibeImage(cacheImage.vibes[0].id, targetWorkspace, sourceWorkspace);
                } else {
                    throw new Error('Standalone image has no vibe data');
                }
            } else {
                response = await wsClient.moveReferences([cacheImage.hash], targetWorkspace, sourceWorkspace);
                if (response.success && cacheImage.hasVibes) {
                    const vibeMovePromises = [];
                    for (const vibe of cacheImage.vibes) {
                        if (vibe.type === 'cache') {
                            vibeMovePromises.push(
                                wsClient.moveVibeImage(vibe.id, targetWorkspace, sourceWorkspace)
                            );
                        }
                    }
                    if (vibeMovePromises.length > 0) {
                        try {
                            await Promise.all(vibeMovePromises);
                        } catch (vibeError) {
                            console.warn('Some vibe images failed to move:', vibeError);
                        }
                    }
                }
            }

            if (!response?.success) {
                throw new Error(response?.message || 'Move failed');
            }

            showGlassToast('success', 'Moved', `Reference moved to ${workspaceName}`, false, 3000, '<i class="mdi mdi-1-5 mdi-folder-move"></i>');
            if (typeof refreshReferenceBrowserIfOpen === 'function') await refreshReferenceBrowserIfOpen();
            if (typeof refreshReferenceManagerAfterVibeOperation === 'function') {
                await refreshReferenceManagerAfterVibeOperation();
            }
            if (typeof loadCacheImages === 'function') await loadCacheImages();
            await this.softRefresh();
        } catch (err) {
            showGlassToast('error', 'Explorer', err.message || 'Move failed', false, 5000);
        }
    }

    _getExplorerReferenceDeleteOptions(item) {
        const cacheImage = this._resolveReferenceCacheImage(item);
        if (!cacheImage) return [];

        const options = [];
        if (cacheImage.hasVibes && !cacheImage.isStandalone) {
            options.push(
                { text: 'Base Image', value: 'base', icon: 'nai-img2img', className: 'context-menu-item' },
                { text: 'Encodings', value: 'vibes', icon: 'nai-vibe-transfer', className: 'context-menu-item' },
                { text: 'Entire Reference', value: 'both', icon: 'fas fa-fire', className: 'context-menu-item-danger' }
            );
        } else if (cacheImage.isStandalone) {
            options.push({
                text: 'Imported Encoding',
                value: 'vibes',
                icon: 'nai-vibe-transfer',
                className: 'context-menu-item-danger'
            });
        } else {
            options.push({
                text: 'Base Image',
                value: 'base',
                icon: 'nai-img2img',
                className: 'context-menu-item-danger'
            });
        }
        return options;
    }

    async _handleExplorerReferenceDelete(option, item) {
        const cacheImage = this._resolveReferenceCacheImage(item);
        if (!cacheImage) return;

        const deleteType = option.value;
        const wsId = item.workspaceId || this.getWorkspaceIdFromPath() || activeWorkspace || 'default';
        let confirmMessage = '';
        switch (deleteType) {
            case 'base':
                confirmMessage = 'Are you sure you want to delete the base image? Vibe encodings will remain.';
                break;
            case 'vibes':
                confirmMessage = cacheImage.isStandalone
                    ? 'Are you sure you want to delete this vibe encoding?'
                    : 'Are you sure you want to delete the vibe encoding(s)? Base image will remain.';
                break;
            case 'both':
                confirmMessage = 'Are you sure you want to delete both the base image and all vibe encodings?';
                break;
            default:
                return;
        }

        const confirmed = await showConfirmationDialog(confirmMessage, [
            { text: 'Delete', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]);
        if (!confirmed) return;

        // public/scripts/comp/referenceManager.js deleteReferenceImage
        await deleteReferenceImage(cacheImage, wsId, async () => {
            if (typeof refreshReferenceBrowserIfOpen === 'function') await refreshReferenceBrowserIfOpen();
        }, deleteType);
        if (this._shouldRemoveShortcutOnly(item)) {
            await this._removeShortcutItem(item);
        }
        await this.softRefresh();
    }

    async _handleImageGalleryContextAction(action, item, event) {
        if (!EXPLORER_IMAGE_GALLERY_CONTEXT_ACTIONS.has(action)) return false;

        const image = this._resolveGalleryImage(item);
        if (!image) {
            showGlassToast('warning', 'Explorer', 'Could not load image data for this action', false, 4000);
            return false;
        }

        const filename = image.filename || image.original || image.upscaled;
        let needsRefresh = false;

        switch (action) {
            case 'toggle-favorite':
                // public/scripts/comp/galleryView.js togglePinImage
                togglePinImage(image, null);
                image.isPinned = !image.isPinned;
                break;
            case 'reroll':
                rerollImage(image, event);
                break;
            case 'download':
                downloadImage(image);
                break;
            case 'copy':
                copyImageToClipboard(image);
                break;
            case 'open-in-window': {
                const viewer = openGalleryImageInViewer(image);
                if (viewer?.element) {
                    viewer.element.dataset.imageData = JSON.stringify(image);
                }
                break;
            }
            case 'modify':
                openManualModalWithContent({ type: 'image', image, metadata: image.metadata || null }, event);
                break;
            case 'expand-canvas':
                expandCanvasFromGallery(image);
                break;
            case 'upscale':
                if (!image.upscaled) upscaleImage(image, event);
                break;
            case 'start-chat':
                if (chatSystem) chatSystem.openChatModal(filename, image.characterName || null);
                break;
            case 'set-wallpaper':
                openDesktopSettingsModal(`file:${filename}`);
                break;
            case 'create-desktop-shortcut':
                createDesktopShortcutFromImage(image);
                break;
            case 'jump-to-image':
                await this.openGalleryImage(filename);
                break;
            case 'create-reference':
                createReferenceFromImage(image);
                break;
            case 'scrap':
                if (item.targetKind === 'scrap') {
                    // public/scripts/app.js removeFromScraps
                    await removeFromScraps(image);
                } else {
                    moveImageToScraps(image, event);
                }
                needsRefresh = true;
                if (typeof loadGallery === 'function') loadGallery(true);
                break;
            case 'delete':
                deleteImage(image);
                if (this._shouldRemoveShortcutOnly(item)) {
                    await this._removeShortcutItem(item);
                }
                needsRefresh = true;
                if (typeof loadGallery === 'function') loadGallery(true);
                break;
            default:
                return false;
        }

        if (needsRefresh) await this.softRefresh();
        return true;
    }

    async _handleNoteContextAction(action, item) {
        if (!notepadManager || !item?.targetId) return false;
        const noteData = this._getNoteContextData(item);

        switch (action) {
            case 'open-in-window':
                await notepadManager.notebookOpenInWindow(noteData.id);
                return true;
            case 'add-to-desktop':
                await notepadManager.notebookAddToDesktop(noteData);
                return true;
            case 'modify-note':
                await notepadManager.notebookModifyNote(noteData.id);
                return true;
            case 'delete-note':
                await notepadManager.notebookDeleteNote(noteData.id);
                if (this._shouldRemoveShortcutOnly(item)) {
                    await this._removeShortcutItem(item);
                }
                await this.softRefresh();
                return true;
            default:
                return false;
        }
    }

    async _handleReferenceContextAction(action, item) {
        if (!action || !action.startsWith('reference-manager-')) return false;

        const cacheImage = this._resolveReferenceCacheImage(item);
        if (!cacheImage) {
            showGlassToast('warning', 'Explorer', 'Could not load reference data for this action', false, 4000);
            return false;
        }

        let needsRefresh = false;
        switch (action) {
            case 'reference-manager-open-in-window': {
                const viewer = openReferenceImageInViewer(cacheImage);
                if (viewer?.element) {
                    viewer.element.dataset.cacheImageData = JSON.stringify(cacheImage);
                }
                break;
            }
            case 'reference-manager-comment': {
                const vibesWithComments = cacheImage.vibes?.filter(vibe =>
                    vibe.comment && vibe.comment.trim() !== ''
                ) || [];
                showVibesCommentsDialog(vibesWithComments);
                break;
            }
            case 'reference-manager-vibe-encode':
                if (cacheImage.hasVibes && cacheImage.vibes.length > 0) {
                    showVibeEncodingModal('ie', cacheImage.vibes[0]);
                } else {
                    showVibeEncodingModal('reference', cacheImage);
                }
                break;
            case 'reference-manager-director':
                createDirectorSessionWithImage(cacheImage);
                break;
            case 'reference-manager-set-wallpaper':
                openDesktopSettingsModal(`cache:${cacheImage.hash}`);
                break;
            case 'reference-manager-create-shortcut-base':
                createDesktopShortcutFromReference(cacheImage, 'base');
                break;
            case 'reference-manager-create-shortcut-vibe':
                createDesktopShortcutFromReference(cacheImage, 'vibe');
                break;
            case 'reference-manager-create-shortcut-character':
                createDesktopShortcutFromReference(cacheImage, 'character');
                break;
            case 'reference-manager-add-as-base':
                addAsBaseImage(cacheImage);
                break;
            case 'reference-manager-add-as-vibe':
                addAsVibeReference(cacheImage);
                break;
            case 'reference-manager-add-as-character':
                addAsCharacterReference(cacheImage);
                break;
            case 'reference-manager-manage':
                showManageReferenceModal(cacheImage);
                break;
            default:
                return false;
        }

        if (needsRefresh) await this.softRefresh();
        return true;
    }

    async _handleVirtualSurfaceContextAction(action, item, event) {
        if (!item || !this._isVirtualSurfaceItem(item)) return false;

        if (item.targetKind === 'image' || item.targetKind === 'scrap') {
            return this._handleImageGalleryContextAction(action, item, event);
        }
        if (item.targetKind === 'note') {
            return this._handleNoteContextAction(action, item);
        }
        if (item.targetKind === 'reference' || item.targetKind === 'vibe') {
            return this._handleReferenceContextAction(action, item);
        }
        return false;
    }

    buildContextMenuSections(item) {
        if (!item) return this.buildEmptyContextMenuSections();

        const isFolder = item.kind === 'folder' || item.targetKind === 'vfs-folder'
            || item.targetKind === 'system-folder' || item.targetKind === 'workspace';
        const canModify = !item.protected && (
            item.targetKind === 'vfs-folder'
            || (item.targetKind === 'user-file' && !this._isUserFileLinkItem(item))
        );
        const selCount = this.grid?.getSelectedItems()?.length || 0;
        const multi = selCount > 1;
        const vfsOpts = { multi, canModify, selCount };

        if (!multi && this._isGalleryImageContextItem(item)) {
            return this._finalizeContextMenuSections(this._buildImageScrapContextMenuSections(item), item, vfsOpts);
        }

        if (item.shortcutType) {
            const sections = this._getDesktopShortcutContextSections(item);
            return this._finalizeContextMenuSections(sections, item, vfsOpts);
        }

        if (item.targetKind === 'system-folder') {
            const items = [{
                icon: 'fas fa-folder-open',
                text: 'Open',
                action: 'explorer-navigate'
            }];
            const appItem = this._getSystemFolderAppMenuItem(item);
            if (appItem) items.push(appItem);
            return this._finalizeContextMenuSections([{ type: 'list', items }], item, vfsOpts);
        }

        const sections = [];
        const openLabel = this.getOpenContextLabel(item, isFolder);
        const showOpenSection = isFolder
            || (!multi && !['image', 'scrap', 'note', 'reference', 'vibe'].includes(item.targetKind));

        if (showOpenSection) {
            sections.push({
                type: 'list',
                items: [{
                    icon: isFolder ? 'fas fa-folder-open' : 'fas fa-external-link',
                    text: openLabel,
                    action: 'explorer-open'
                }]
            });
        }

        if (!multi && item.targetKind === 'note') {
            sections.push(...this._buildNoteContextMenuSections(item));
        } else if (!multi && (item.targetKind === 'reference' || item.targetKind === 'vibe')) {
            sections.push(...this._buildReferenceContextMenuSections(item));
        }

        return this._finalizeContextMenuSections(sections, item, vfsOpts);
    }

    buildDesktopShortcutContextMenu(shortcut) {
        if (!shortcut) return this.buildEmptyContextMenuSections();
        const item = this._shortcutToExplorerItem(shortcut, { isDesktopShortcut: true });
        const selCount = typeof desktopShortcuts !== 'undefined' ? desktopShortcuts.getSelectedCount() : 1;
        const multi = selCount > 1;
        const vfsOpts = { multi, canModify: false, selCount };

        if (this._isGalleryImageContextItem(item) && !multi) {
            return this._finalizeContextMenuSections(this._buildImageScrapContextMenuSections(item), item, vfsOpts);
        }

        if (!multi && item.shortcutType === 'note') {
            return this._finalizeContextMenuSections(this._buildNoteContextMenuSections(item), item, vfsOpts);
        }

        if (!multi && item.shortcutType === 'reference') {
            return this._finalizeContextMenuSections(this._buildReferenceContextMenuSections(item), item, vfsOpts);
        }

        const sections = this._getDesktopShortcutContextSections(item);
        return this._finalizeContextMenuSections(sections, item, vfsOpts);
    }

    async handleDesktopShortcutExplorerAction(action, item, event) {
        if (!item || typeof desktopShortcuts === 'undefined') return false;

        switch (action) {
            case 'explorer-cut':
            case 'explorer-copy': {
                const ids = desktopShortcuts.getSelectedCount() > 1 && desktopShortcuts.isShortcutSelected(item.id)
                    ? [...desktopShortcuts.selectedShortcutIds]
                    : [item.id];
                const refs = ids
                    .map((id) => desktopShortcuts.shortcuts.find((s) => s.id === id))
                    .filter(Boolean)
                    .map((s) => this._shortcutToExplorerItem(s, { isDesktopShortcut: true }));
                if (!refs.length) return true;
                const wsId = desktopShortcuts.currentWorkspace
                    || (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null)
                    || 'default';
                this.clipboard = {
                    operation: action === 'explorer-cut' ? 'cut' : 'copy',
                    items: this._itemRefs(refs),
                    sourcePath: `/Workspaces/${wsId}/Desktop`
                };
                return true;
            }
            case 'explorer-rename': {
                const newName = typeof showInputDialog === 'function'
                    ? await showInputDialog(
                        'Rename Shortcut',
                        item.name,
                        'Enter shortcut name',
                        [
                            { text: 'Rename', value: true, className: 'btn-primary' },
                            { text: 'Cancel', value: false, className: 'btn-secondary' }
                        ],
                        event?.detail?.event
                    )
                    : prompt('Rename to:', item.name);
                if (newName && newName !== item.name) {
                    await desktopShortcuts.renameShortcut(item.id, newName);
                }
                return true;
            }
            case 'remove-shortcut': {
                const shortcut = this._shortcutFromItem(item);
                if (item.shortcutType === 'folder') {
                    const confirmed = typeof showConfirmationDialog === 'function'
                        ? await showConfirmationDialog(
                            desktopShortcuts.getFolderDeleteConfirmMessage(shortcut),
                            [
                                { text: 'Delete', value: true, className: 'btn-danger' },
                                { text: 'Cancel', value: false, className: 'btn-secondary' }
                            ],
                            event?.detail?.event
                        )
                        : true;
                    if (confirmed) await desktopShortcuts.deleteFolderShortcut(item.id);
                    return true;
                }
                if (desktopShortcuts.getSelectedCount() > 1 && desktopShortcuts.isShortcutSelected(item.id)) {
                    await desktopShortcuts.removeSelectedShortcuts();
                    return true;
                }
                const confirmed = typeof showConfirmationDialog === 'function'
                    ? await showConfirmationDialog(
                        `Remove "${item.name}"?`,
                        [
                            { text: 'Remove', value: true, className: 'btn-danger' },
                            { text: 'Cancel', value: false, className: 'btn-secondary' }
                        ],
                        event?.detail?.event
                    )
                    : true;
                if (confirmed) await this._removeShortcutItem(item);
                return true;
            }
            case 'explorer-delete': {
                const shortcut = this._shortcutFromItem(item);
                const confirmed = typeof showConfirmationDialog === 'function'
                    ? await showConfirmationDialog(
                        `Permanently delete "${item.name}" and remove its shortcut?`,
                        [
                            { text: 'Delete', value: true, className: 'btn-danger' },
                            { text: 'Cancel', value: false, className: 'btn-secondary' }
                        ],
                        event?.detail?.event
                    )
                    : true;
                if (confirmed) {
                    await desktopShortcuts.permanentlyDeleteShortcutTarget(shortcut);
                }
                return true;
            }
            default:
                return false;
        }
    }

    showItemContextMenu(item, event) {
        if (!contextMenu || !this._contextMenuWired) return;
        this._contextMenuTarget = item;
        this._setContextMenuSections(item
            ? this.buildContextMenuSections(item)
            : this.buildEmptyContextMenuSections());
        const gridHost = document.getElementById('explorerGridHost');
        if (gridHost) contextMenu.showMenu(event, gridHost);
    }

    async handleContextMenuAction(event) {
        const action = event.detail?.action;
        const target = event.detail?.target;
        if (!action) return;
        if (DESKTOP_GLOBAL_CONTEXT_ACTIONS.has(action)) return;
        if (isDesktopSurfaceContextTarget(target)) return;
        if (!this.modal || this.modal.classList.contains('hidden')) return;

        // public/scripts/comp/desktopShortcuts.js — shortcut menus own their actions
        if (target?.closest?.('.desktop-shortcut')) return;
        if (!target?.closest?.('#explorerGridHost, #explorerModal')) return;

        const item = this._contextMenuTarget;
        const workspaceId = this.getWorkspaceIdFromPath();

        if (!action.startsWith('explorer-')) {
            if (item?.shortcutType === 'image') {
                if (await this._handleImageGalleryContextAction(action, item, event)) return;
            }
            if (item?.shortcutType) {
                if (await this._handleShortcutContextAction(action, item)) return;
            }
            if (item && await this._handleVirtualSurfaceContextAction(action, item, event)) {
                return;
            }
            return;
        }

        try {
            switch (action) {
                case 'explorer-navigate':
                    this._navigateToItem(item);
                    break;
                case 'explorer-app-workspace':
                case 'explorer-app-references':
                case 'explorer-app-notebook':
                case 'explorer-app-scraps':
                    this._runSystemFolderAppAction(item);
                    break;
                case 'explorer-open':
                    if (item) this.openItem(item);
                    break;
                case 'explorer-cut':
                    this.cutSelection();
                    break;
                case 'explorer-copy':
                    this.copySelection();
                    break;
                case 'explorer-paste':
                    await this.pasteClipboard();
                    break;
                case 'explorer-new-folder':
                    await this.createFolder();
                    break;
                case 'explorer-upload':
                    this.el?.fileInput?.click();
                    break;
                case 'explorer-rename':
                    await this.renameSelection();
                    break;
                case 'explorer-download':
                    if (item) await this.downloadSelectionItem(item);
                    else await this.downloadSelection();
                    break;
                case 'explorer-remove-shortcut':
                    if (item) {
                        await this._removeShortcutItem(item);
                        await this.softRefresh();
                    } else {
                        await this.deleteSelection();
                    }
                    break;
                case 'explorer-delete':
                    await this.deleteSelection();
                    break;
                case 'explorer-convert-ref-copy':
                case 'explorer-convert-ref-move':
                    if (item) {
                        await vfsClient.convertReferenceToFile(
                            item.targetId,
                            workspaceId,
                            action.endsWith('move') ? 'move' : 'copy'
                        );
                        await this.navigateTo(this.currentPath);
                    }
                    break;
                case 'explorer-convert-file-ref-copy':
                case 'explorer-convert-file-ref-move':
                    if (item) {
                        await vfsClient.convertFileToReference(
                            item.targetId,
                            workspaceId,
                            action.endsWith('move') ? 'move' : 'copy'
                        );
                        await this.navigateTo(this.currentPath);
                    }
                    break;
            }
        } catch (err) {
            showGlassToast('error', 'Explorer', err.message || 'Action failed', false, 5000);
        }
    }

    async _handleShortcutContextAction(action, item) {
        const shortcut = {
            id: item.id,
            name: item.name,
            type: item.shortcutType,
            data: item.shortcutData || {}
        };
        if (typeof desktopShortcuts === 'undefined') return false;

        switch (action) {
            case 'open-folder-shortcut':
                desktopShortcuts.handleFolderClick(shortcut);
                return true;
            case 'open-note':
                await desktopShortcuts.handleNoteClick(shortcut);
                return true;
            case 'open-note-in-notebook':
                await desktopShortcuts.handleNoteClick(shortcut);
                return true;
            case 'open-in-studio':
                await this._openImageInStudio(item);
                return true;
            case 'jump-to-workspace':
                await this.openGalleryImage(shortcut.data?.filename || item.targetId);
                return true;
            case 'download-image':
                await this._downloadImageFilename(shortcut.data?.filename || item.targetId);
                return true;
            case 'copy-to-clipboard':
                await this._copyImageToClipboard(item);
                return true;
            case 'rename-shortcut':
                await this.renameSelection();
                return true;
            case 'delete-folder-shortcut': {
                const confirmed = typeof showConfirmationDialog === 'function'
                    ? await showConfirmationDialog(
                        desktopShortcuts.getFolderDeleteConfirmMessage(shortcut),
                        [
                            { text: 'Delete', value: true, className: 'btn-danger' },
                            { text: 'Cancel', value: false, className: 'btn-secondary' }
                        ]
                    )
                    : true;
                if (confirmed) {
                    await desktopShortcuts.deleteFolderShortcut(item.id);
                    await this.softRefresh();
                    this._refreshDesktop();
                }
                return true;
            }
            case 'remove-shortcut':
                await this._removeShortcutItem(item);
                await this.softRefresh();
                if (this._isLiveDesktopShortcutItem(item)) this._refreshDesktop();
                return true;
            case 'incinerate-shortcut-target':
            case 'delete-note-shortcut-target':
            case 'destroy-reference-shortcut-target': {
                const confirmMessages = {
                    'incinerate-shortcut-target': `Permanently delete "${item.name}" and remove its shortcut?`,
                    'delete-note-shortcut-target': `Permanently delete note "${item.name}" and remove its shortcut?`,
                    'destroy-reference-shortcut-target': `Permanently destroy reference "${item.name}" and remove its shortcut?`
                };
                const confirmLabels = {
                    'incinerate-shortcut-target': 'Incinerate',
                    'delete-note-shortcut-target': 'Delete',
                    'destroy-reference-shortcut-target': 'Destroy'
                };
                const confirmed = typeof showConfirmationDialog === 'function'
                    ? await showConfirmationDialog(
                        confirmMessages[action],
                        [
                            { text: confirmLabels[action], value: true, className: 'btn-danger' },
                            { text: 'Cancel', value: false, className: 'btn-secondary' }
                        ]
                    )
                    : true;
                if (confirmed) {
                    await desktopShortcuts.permanentlyDeleteShortcutTarget(shortcut);
                    await this.softRefresh();
                    this._refreshDesktop();
                }
                return true;
            }
            default:
                return false;
        }
    }

    async _openImageInStudio(item) {
        const filename = item.previewImageFilename || item.targetId || item.shortcutData?.filename;
        if (!filename) return;
        let image = null;
        if (typeof allImages !== 'undefined' && allImages.length > 0) {
            image = allImages.find(img =>
                img.filename === filename || img.original === filename || img.upscaled === filename
            );
        }
        if (image && typeof openManualModalWithContent === 'function') {
            openManualModalWithContent({ type: 'image', image }, null);
        } else {
            showGlassToast('warning', 'Not Available', 'Could not load image data', false, 3000);
        }
    }

    async _downloadImageFilename(filename) {
        if (!filename) return;
        const link = document.createElement('a');
        link.href = `/images/${filename}`;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    async _copyImageToClipboard(item) {
        const filename = item.previewImageFilename || item.targetId || item.shortcutData?.filename;
        if (!filename) return;
        try {
            const resp = await fetch(`/images/${encodeURIComponent(filename)}`);
            const blob = await resp.blob();
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        } catch (err) {
            showGlassToast('error', 'Copy Failed', err.message || 'Could not copy image', false, 4000);
        }
    }

    async _addReferenceFromItem(item, action) {
        if (typeof desktopShortcuts === 'undefined') return;
        const shortcut = {
            id: item.id,
            name: item.name,
            type: 'reference',
            data: {
                hash: item.targetId || item.previewHash,
                refType: action === 'explorer-ref-vibe' ? 'vibe' : action === 'explorer-ref-character' ? 'character' : 'base',
                workspaceId: item.workspaceId
            }
        };
        await desktopShortcuts.handleReferenceDragToManual(shortcut, document.getElementById('manualModal'));
    }

    setupDropdowns() {
        const sortDropdown = document.getElementById('explorerSortDropdown');
        const sortBtn = document.getElementById('explorerSortDropdownBtn');
        const sortMenu = document.getElementById('explorerSortDropdownMenu');
        const viewsDropdown = document.getElementById('explorerViewsDropdown');
        const viewsBtn = document.getElementById('explorerViewsDropdownBtn');
        const viewsMenu = document.getElementById('explorerViewsDropdownMenu');

        if (sortDropdown && sortBtn && sortMenu && typeof setupDropdown === 'function') {
            setupDropdown(
                sortDropdown,
                sortBtn,
                sortMenu,
                () => this.renderSortMenu(sortMenu),
                () => `${this.sortField}:${this.sortDirection}`,
                { preventFocusTransfer: true }
            );
        }

        if (viewsDropdown && viewsBtn && viewsMenu && typeof setupDropdown === 'function') {
            setupDropdown(
                viewsDropdown,
                viewsBtn,
                viewsMenu,
                () => this.renderViewsMenu(viewsMenu),
                () => this.viewMode,
                { preventFocusTransfer: true }
            );
        }
    }

    renderSortMenu(menu) {
        if (!menu) return;
        menu.innerHTML = '';
        const current = `${this.sortField}:${this.sortDirection}`;
        EXPLORER_SORT_OPTIONS.forEach((opt) => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (opt.value === current ? ' selected' : '');
            option.dataset.value = opt.value;
            option.textContent = opt.label;
            option.addEventListener('click', () => {
                this.sortField = opt.field;
                this.sortDirection = opt.direction;
                localStorage.setItem('explorerSortField', this.sortField);
                localStorage.setItem('explorerSortDirection', this.sortDirection);
                this.updateSortLabel();
                this.updateDetailsHeaderSort();
                closeDropdown(menu, document.getElementById('explorerSortDropdownBtn'));
                this.navigateTo(this.currentPath);
            });
            menu.appendChild(option);
        });
    }

    renderViewsMenu(menu) {
        if (!menu) return;
        menu.innerHTML = '';
        Object.entries(EXPLORER_VIEW_MODES).forEach(([mode, cfg]) => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (mode === this.viewMode ? ' selected' : '');
            option.dataset.value = mode;
            option.textContent = cfg.label;
            option.addEventListener('click', () => {
                this.setViewMode(mode);
                closeDropdown(menu, document.getElementById('explorerViewsDropdownBtn'));
            });
            menu.appendChild(option);
        });
    }

    updateSortLabel() {
        const btn = document.getElementById('explorerSortDropdownBtn');
        if (!btn) return;
        const icon = btn.querySelector('i.fas:not(.naxt-dataset-chevron)');
        if (!icon) return;
        const sortIcons = {
            name: this.sortDirection === 'asc' ? 'fa-sort-alpha-down' : 'fa-sort-alpha-up',
            date: this.sortDirection === 'asc' ? 'fa-sort-amount-up' : 'fa-sort-amount-down',
            type: this.sortDirection === 'asc' ? 'fa-sort-alpha-down' : 'fa-sort-alpha-up',
            size: this.sortDirection === 'asc' ? 'fa-sort-amount-up' : 'fa-sort-amount-down'
        };
        icon.className = `fas ${sortIcons[this.sortField] || 'fa-sort'}`;
        btn.title = `Sort: ${this.sortField} (${this.sortDirection})`;
    }

    updateViewsLabel() {
        const btn = document.getElementById('explorerViewsDropdownBtn');
        if (!btn) return;
        const icon = btn.querySelector('i.fas:not(.naxt-dataset-chevron)');
        if (!icon) return;
        const viewIcons = {
            'icons-xl': 'fa-th',
            'icons-lg': 'fa-th-large',
            'icons-md': 'fa-th',
            'icons-sm': 'fa-grip',
            list: 'fa-list',
            details: 'fa-bars'
        };
        icon.className = `fas ${viewIcons[this.viewMode] || 'fa-th-large'}`;
        const cfg = EXPLORER_VIEW_MODES[this.viewMode];
        btn.title = cfg ? cfg.label : this.viewMode;
    }

    bindElements() {
        this.el = {
            backBtn: document.getElementById('explorerBackBtn'),
            forwardBtn: document.getElementById('explorerForwardBtn'),
            upBtn: document.getElementById('explorerUpBtn'),
            refreshBtn: document.getElementById('explorerRefreshBtn'),
            addressBar: document.getElementById('explorerAddressBar'),
            titleLabel: document.getElementById('explorerTitleLabel'),
            searchBar: document.getElementById('explorerSearchBar'),
            cutBtn: document.getElementById('explorerCutBtn'),
            copyBtn: document.getElementById('explorerCopyBtn'),
            pasteBtn: document.getElementById('explorerPasteBtn'),
            renameBtn: document.getElementById('explorerRenameBtn'),
            downloadBtn: document.getElementById('explorerDownloadBtn'),
            replaceBtn: document.getElementById('explorerReplaceBtn'),
            deleteBtn: document.getElementById('explorerDeleteBtn'),
            newFolderBtn: document.getElementById('explorerNewFolderBtn'),
            uploadBtn: document.getElementById('explorerUploadBtn'),
            detailsHeader: document.getElementById('explorerDetailsHeader'),
            statusText: document.getElementById('explorerStatusText'),
            statusSpinner: document.getElementById('explorerStatusSpinner'),
            viewLargeBtn: document.getElementById('explorerViewLargeBtn'),
            viewDetailsBtn: document.getElementById('explorerViewDetailsBtn'),
            fileInput: document.getElementById('explorerFileInput'),
            closeBtn: document.getElementById('closeExplorerBtn')
        };
    }

    bindEvents() {
        const e = this.el;
        if (e.backBtn) e.backBtn.addEventListener('click', () => this.goBack());
        if (e.forwardBtn) e.forwardBtn.addEventListener('click', () => this.goForward());
        if (e.upBtn) e.upBtn.addEventListener('click', () => this.goUp());
        if (e.refreshBtn) e.refreshBtn.addEventListener('click', () => this.navigateTo(this.currentPath));
        if (e.addressBar) e.addressBar.addEventListener('keydown', async (ev) => {
            if (ev.key !== 'Enter') return;
            const input = e.addressBar.value.trim();
            if (!input) {
                this.navigateTo('/');
                return;
            }
            try {
                const resolved = await vfsClient.resolvePath(input);
                this.navigateTo(resolved);
            } catch (err) {
                showGlassToast('error', 'Explorer', err.message || 'Path not found', false, 5000);
            }
        });
        if (e.searchBar) e.searchBar.addEventListener('input', () => {
            clearTimeout(this._searchDebounce);
            this._searchDebounce = setTimeout(() => {
                this.searchQuery = e.searchBar.value.trim();
                this.navigateTo(this.currentPath);
            }, 300);
        });
        if (e.cutBtn) e.cutBtn.addEventListener('click', () => this.cutSelection());
        if (e.copyBtn) e.copyBtn.addEventListener('click', () => this.copySelection());
        if (e.pasteBtn) e.pasteBtn.addEventListener('click', () => this.pasteClipboard());
        if (e.renameBtn) e.renameBtn.addEventListener('click', () => this.renameSelection());
        if (e.downloadBtn) e.downloadBtn.addEventListener('click', () => this.downloadSelection());
        if (e.replaceBtn) e.replaceBtn.addEventListener('click', () => this.replaceSelection());
        if (e.deleteBtn) e.deleteBtn.addEventListener('click', () => this.deleteSelection());
        if (e.newFolderBtn) e.newFolderBtn.addEventListener('click', () => this.createFolder());
        if (e.uploadBtn) e.uploadBtn.addEventListener('click', () => e.fileInput?.click());
        if (e.fileInput) e.fileInput.addEventListener('change', (ev) => this.handleFileUpload(ev.target.files));
        if (e.viewLargeBtn) e.viewLargeBtn.addEventListener('click', () => this.setViewMode('icons-lg'));
        if (e.viewDetailsBtn) e.viewDetailsBtn.addEventListener('click', () => this.setViewMode('details'));
        if (e.closeBtn) e.closeBtn.addEventListener('click', () => this.close());

        if (this.modal) {
            this.modal.addEventListener('keydown', (ev) => {
                if (!this._shouldHandleExplorerShortcut(ev)) return;
                if (ev.ctrlKey || ev.metaKey) {
                    if (ev.key === 'c') { ev.preventDefault(); this.copySelection(); }
                    if (ev.key === 'x') { ev.preventDefault(); this.cutSelection(); }
                    if (ev.key === 'v') { ev.preventDefault(); this.pasteClipboard(); }
                }
                if (ev.key === 'F2') { ev.preventDefault(); this.renameSelection(); }
                if (ev.key === 'Delete') {
                    ev.preventDefault();
                    this.deleteSelection({ fromKeyboard: true, permanent: ev.shiftKey });
                }
            });
        }
    }

    _isEditableShortcutTarget(el) {
        return isEditableTextInputTarget(el);
    }

    _shouldHandleExplorerShortcut(ev) {
        if (!this.modal || this.modal.classList.contains('hidden') || this.modal.classList.contains('minimised')) {
            return false;
        }
        const target = ev.target;
        if (target && this.modal.contains(target)) {
            return !this._isEditableShortcutTarget(target);
        }
        const active = document.activeElement;
        if (active && this.modal.contains(active)) {
            return !this._isEditableShortcutTarget(active);
        }
        return false;
    }

    getOpenContextLabel(item, isFolder) {
        if (!item) return 'Open';
        if (item.targetKind === 'workspace') return 'Open Workspace';
        if (item.targetKind === 'system-folder') return 'Open';
        return isFolder ? 'Open' : 'Open';
    }

    _getSystemFolderAppMenuItem(item) {
        if (!item || item.targetKind !== 'system-folder') return null;
        switch (item.name) {
            case 'Pictures':
                return { icon: 'fas fa-images', text: 'Open Workspace', action: 'explorer-app-workspace' };
            case 'References':
                return { icon: 'fas fa-swatchbook', text: 'Manage References', action: 'explorer-app-references' };
            case 'Notes':
                return { icon: 'fas fa-notebook', text: 'Open Notebook', action: 'explorer-app-notebook' };
            case 'Scraps':
                return { icon: 'fas fa-bin-recycle', text: 'Open Scraps', action: 'explorer-app-scraps' };
            default:
                return null;
        }
    }

    _navigateToItem(item) {
        if (!item) return;
        const navPath = item.navPath || this.resolveNavigationPath(item);
        if (!navPath || navPath === this.currentPath) return;
        this.navigateTo(navPath);
    }

    isFolderItem(item) {
        if (!item) return false;
        return item.kind === 'folder'
            || item.targetKind === 'system-folder'
            || item.targetKind === 'workspace'
            || item.targetKind === 'vfs-folder';
    }

    resolveNavigationPath(item) {
        if (!item) return null;
        if (item.navPath) return item.navPath;

        if (item.targetKind === 'workspace') {
            return `/Workspaces/${item.targetId}`;
        }

        if (item.targetKind === 'system-folder') {
            const tid = item.targetId || item.id;
            if (tid === '@workspaces' || item.name === 'Workspaces') return '/Workspaces';
            if (tid === '@system' || item.name === 'System') return '/System';
            if (item.workspaceId && item.name) {
                return `/Workspaces/${item.workspaceId}/${item.name}`;
            }
        }

        if (item.targetKind === 'vfs-folder') {
            const folderId = item.targetId || item.id;
            if (item.workspaceId) {
                const parts = this.currentPath.split('/').filter(Boolean);
                if (parts[0] === 'Workspaces' && parts.length >= 3 && parts[2] === 'Desktop') {
                    return `/Workspaces/${item.workspaceId}/Desktop/${folderId}`;
                }
            }
            const base = this.currentPath.replace(/\/+$/, '') || '/';
            return base === '/' ? `/${folderId}` : `${base}/${folderId}`;
        }

        return null;
    }

    _hasSavedViewPreference(path) {
        const normalized = (path || '/').replace(/\/+$/, '') || '/';
        const map = this._getFolderViewModes();
        const parts = normalized.split('/').filter(Boolean);
        for (let i = parts.length; i >= 0; i--) {
            const p = i === 0 ? '/' : `/${parts.slice(0, i).join('/')}`;
            if (map[p]) return true;
        }
        return false;
    }

    _shouldAutoDetailsView(path) {
        if (this._hasSavedViewPreference(path)) return false;
        const defaultMode = localStorage.getItem(EXPLORER_DEFAULT_VIEW_KEY)
            || localStorage.getItem('explorerViewMode')
            || 'icons-lg';
        return defaultMode !== 'details';
    }

    _resolveVfsPathForUserFiles(navPath) {
        const folderId = this._getDesktopFolderIdFromPath(navPath);
        if (folderId) return navPath;
        if (!this._isDesktopDestination(navPath)) return navPath;
        const parts = navPath.split('/').filter(Boolean);
        if (parts.length >= 2 && parts[0] === 'Workspaces') {
            return `/Workspaces/${parts[1]}`;
        }
        return navPath;
    }

    _isVirtualSurfaceItem(item) {
        if (!item) return false;
        return ['image', 'scrap', 'reference', 'vibe', 'note'].includes(item.targetKind);
    }

    _isUserFileLinkItem(item) {
        return !!(item?.isUserFileLink || (item?.isShortcut && item?.targetKind === 'user-file'));
    }

    _refsIncludeUserFiles(refs) {
        return (refs || []).some(r => r.targetKind === 'user-file' && !r.isShortcut && !r.isUserFileLink);
    }

    _promptUserFileCopyMode() {
        return new Promise((resolve) => {
            const modal = document.getElementById('vfsImportChoiceModal');
            if (!modal) {
                resolve('duplicate');
                return;
            }
            const titleEl = document.getElementById('vfsImportChoiceTitle');
            const listEl = document.getElementById('vfsImportChoiceList');
            if (titleEl) titleEl.textContent = 'Copy File';
            if (listEl) {
                listEl.innerHTML = '';
                [
                    {
                        id: 'shortcut',
                        label: 'Shortcut — link to the same file (stays in sync until the original is replaced)'
                    },
                    {
                        id: 'duplicate',
                        label: 'Duplicate — independent copy with its own file data'
                    },
                    {
                        id: '',
                        label: 'Cancel'
                    }
                ].forEach((opt) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn-secondary vfs-import-choice-btn';
                    btn.textContent = opt.label;
                    btn.addEventListener('click', () => {
                        closeModal(modal);
                        resolve(opt.id || null);
                    });
                    listEl.appendChild(btn);
                });
            }
            openModal(modal);
        });
    }

    async _deleteVirtualSurfaceItem(item) {
        const wsId = item.workspaceId || this.getWorkspaceIdFromPath();
        if (!wsId) throw new Error('Workspace required');

        switch (item.targetKind) {
            case 'image':
            case 'scrap': {
                const filename = item.previewImageFilename || item.targetId;
                if (!filename) throw new Error('No filename for image');
                const result = await wsClient.deleteImagesBulk([filename]);
                if (!result?.successful) throw new Error('Failed to delete image');
                if (typeof loadGallery === 'function') loadGallery(true);
                break;
            }
            case 'reference':
                await wsClient.deleteReference(item.targetId, wsId);
                break;
            case 'vibe':
                await wsClient.deleteVibeImage(item.targetId, wsId);
                break;
            case 'note':
                await wsClient.deleteNote(item.targetId);
                break;
            default:
                throw new Error(`Cannot delete ${item.targetKind}`);
        }
    }

    _isVfsVirtualEntry(item) {
        return !!(item?.isShortcut && !item?.isDesktopShortcut && !this._isStoredShortcutItem(item));
    }

    _isDesktopShortcutItem(item) {
        return !!(item?.shortcutType || item?.isDesktopShortcut);
    }

    _isLiveDesktopShortcutItem(item) {
        return !!item?.isDesktopShortcut;
    }

    _isFolderShortcutItem(item) {
        return item?.shortcutType === 'folder'
            || (item?.targetKind === 'vfs-folder' && this._isLiveDesktopShortcutItem(item));
    }

    _isStoredShortcutItem(item) {
        return !!(item?.isVfsShortcutEntry
            || (item?.isShortcut && item?.shortcutType && !item?.isDesktopShortcut));
    }

    _isDesktopDestination(navPath) {
        if (!navPath) return false;
        const parts = navPath.split('/').filter(Boolean);
        return parts[0] === 'Workspaces' && parts.length >= 3 && parts[2] === 'Desktop';
    }

    _getDesktopFolderIdFromPath(navPath) {
        const parts = navPath.split('/').filter(Boolean);
        if (parts.length > 3 && parts[2] === 'Desktop') return parts[3];
        return null;
    }

    _folderShortcutFromItem(item) {
        if (!item || item.targetKind !== 'vfs-folder') return null;
        const vfsFolderId = item.targetId || item.id;
        return { id: item.id, data: { vfsFolderId } };
    }

    _refreshDesktop() {
        if (typeof desktopShortcuts !== 'undefined') {
            desktopShortcuts.renderShortcuts();
        }
    }

    _touchesDesktop(navPath, items) {
        if (this._isDesktopDestination(navPath)) return true;
        if (this._isDesktopDestination(this.currentPath)) return true;
        return (items || []).some(i => this._isLiveDesktopShortcutItem(i));
    }

    _runSystemFolderAppAction(item) {
        if (!item || item.targetKind !== 'system-folder') return;
        switch (item.name) {
            case 'Pictures':
                if (typeof switchGalleryView === 'function') switchGalleryView('images');
                break;
            case 'Scraps':
                if (typeof switchGalleryView === 'function') switchGalleryView('scraps');
                break;
            case 'References':
                if (typeof showCacheManagerModal === 'function') showCacheManagerModal();
                break;
            case 'Notes':
                if (typeof notepadManager !== 'undefined') notepadManager.openNotebook();
                break;
        }
    }

    async _restoreStatusAfterOperation() {
        this._statusHint = null;
        this._setBusyState(null);
        await this.updateStatusBar();
        this.updateToolbarState(this.grid?.getSelectedItems() || []);
    }

    async _createDesktopShortcutFromItem(item) {
        if (typeof desktopShortcuts === 'undefined' || !item) return null;
        if (item.targetKind === 'image' || item.targetKind === 'scrap') {
            const filename = item.previewImageFilename || item.targetId;
            return desktopShortcuts.addShortcut({
                name: (item.name || filename).replace(/\.[^/.]+$/, ''),
                type: 'image',
                data: {
                    filename,
                    preview: item.galleryPreview || null
                }
            });
        }
        if (item.targetKind === 'reference' || item.targetKind === 'vibe') {
            const refType = item.targetKind === 'vibe' ? 'vibe' : 'base';
            const hash = item.targetId || item.previewHash;
            return desktopShortcuts.addShortcut({
                name: item.name || hash,
                type: 'reference',
                data: {
                    hash,
                    filename: item.name,
                    preview: item.previewCachePreview || (hash ? `${hash}.webp` : undefined),
                    refType,
                    isStandalone: item.targetKind === 'vibe',
                    workspaceId: item.workspaceId
                }
            });
        }
        if (item.targetKind === 'note') {
            return desktopShortcuts.addShortcut({
                name: item.name,
                type: 'note',
                data: { noteId: item.targetId }
            });
        }
        return null;
    }

    async _deliverToDesktop(items, navPath, operation) {
        const folderId = this._getDesktopFolderIdFromPath(navPath);
        const folderShortcut = folderId ? { id: folderId, data: { vfsFolderId: folderId } } : null;
        const resolved = items.map(ref => this.items.find(i => i.id === ref.id) || ref);

        const storedOrLiveShortcuts = resolved.filter(i =>
            this._isStoredShortcutItem(i) || this._isLiveDesktopShortcutItem(i)
        );
        const vfsVirtualEntries = resolved.filter(i =>
            this._isVfsVirtualEntry(i) && (this._isVirtualSurfaceItem(i) || this._isUserFileLinkItem(i))
        );
        const nativeVirtual = resolved.filter(i =>
            this._isVirtualSurfaceItem(i) && !this._isVfsVirtualEntry(i)
        );
        const userFiles = resolved.filter(i =>
            i.targetKind === 'user-file' && !this._isVfsVirtualEntry(i)
        );

        const newShortcutIds = [];
        for (const item of nativeVirtual) {
            const created = await this._createDesktopShortcutFromItem(item);
            if (created?.id) newShortcutIds.push(created.id);
        }

        for (const item of vfsVirtualEntries) {
            if (this._isVirtualSurfaceItem(item)) {
                const created = await this._createDesktopShortcutFromItem(item);
                if (created?.id) newShortcutIds.push(created.id);
            } else if (this._isUserFileLinkItem(item) && operation === 'cut') {
                await vfsClient.deleteEntry(item.id);
                await vfsClient.moveItems([{
                    id: item.targetId,
                    name: item.name,
                    kind: item.kind,
                    targetKind: 'user-file',
                    targetId: item.targetId,
                    workspaceId: item.workspaceId
                }], this._resolveVfsPathForUserFiles(navPath));
            }
            if (operation === 'cut' && this._isVirtualSurfaceItem(item)) {
                await vfsClient.deleteEntry(item.id);
            }
        }

        if (folderShortcut && newShortcutIds.length) {
            await desktopShortcuts.assignShortcutsToFolder(newShortcutIds, folderShortcut);
        }

        if (storedOrLiveShortcuts.length) {
            const refs = this._itemRefs(storedOrLiveShortcuts);
            if (operation === 'cut') {
                await vfsClient.moveItems(refs, navPath);
            } else {
                const stored = storedOrLiveShortcuts.filter(i => this._isStoredShortcutItem(i));
                const live = storedOrLiveShortcuts.filter(i => this._isLiveDesktopShortcutItem(i));
                if (stored.length) {
                    await vfsClient.copyItems(this._itemRefs(stored), navPath);
                }
                const newIds = [];
                for (const item of live) {
                    const sc = this._shortcutFromItem(item);
                    const created = await desktopShortcuts.addShortcut({
                        name: sc.name,
                        type: sc.type,
                        data: { ...sc.data }
                    });
                    if (created?.id) newIds.push(created.id);
                }
                if (folderShortcut && newIds.length) {
                    await desktopShortcuts.assignShortcutsToFolder(newIds, folderShortcut);
                }
            }
        }

        if (userFiles.length) {
            const refs = this._itemRefs(userFiles);
            const vfsPath = this._resolveVfsPathForUserFiles(navPath);
            const onDesktopRoot = this._isDesktopDestination(navPath) && !this._getDesktopFolderIdFromPath(navPath);
            if (operation === 'cut') await vfsClient.moveItems(refs, vfsPath);
            else await vfsClient.copyItems(refs, vfsPath);
            if (onDesktopRoot) {
                showGlassToast('info', 'Explorer',
                    'Files were placed in the workspace home folder. The desktop surface shows shortcuts only.',
                    false, 5000);
            }
        }
    }

    _setGridLoading(loading) {
        const gridHost = document.getElementById('explorerGridHost');
        if (gridHost) gridHost.classList.toggle('explorer-loading', !!loading);
        if (this.grid) this.grid.setInteractionBlocked(!!loading);
        this.renderStatusText();
    }

    _setBusyState(kind, detail) {
        this._busyKind = kind || null;
        this._busyDetail = detail || null;
        const gridHost = document.getElementById('explorerGridHost');
        if (gridHost) {
            gridHost.classList.toggle('explorer-busy-open', kind === 'open');
            gridHost.classList.toggle('explorer-busy-paste', kind === 'paste');
        }
        this.renderStatusText();
    }

    _syncHasMore(result) {
        const total = Number(result?.totalCount);
        if (Number.isFinite(total)) {
            this.totalCount = total;
        }
        this.hasMore = result?.hasMore === true
            || (Number.isFinite(this.totalCount) && this.totalCount > this.loadedOffset);
    }

    _getUploadPlaceholders() {
        return this.items.filter(i => i.isUploadPlaceholder);
    }

    _serverItemCount() {
        return this.items.filter(i => !i.isUploadPlaceholder).length;
    }

    _makeUploadPlaceholder(file, index) {
        const mime = file.type || '';
        return {
            id: `upload-pending-${Date.now()}-${this._uploadSeq++}-${index}`,
            name: file.name,
            kind: mime.startsWith('image/') ? 'image' : 'file',
            targetKind: 'upload-placeholder',
            isUploadPlaceholder: true,
            icon: 'fas fa-spinner fa-spin',
            mimeType: mime,
            size: file.size
        };
    }

    _addUploadPlaceholders(fileList) {
        const placeholders = [...fileList].map((f, i) => this._makeUploadPlaceholder(f, i));
        this.items = this.items.concat(placeholders);
        if (this.grid) this.grid.replaceItems(this.items);
        return placeholders.map(p => p.id);
    }

    _removeUploadPlaceholders(ids) {
        if (!ids?.length) return;
        const drop = new Set(ids);
        this.items = this.items.filter(i => !drop.has(i.id));
        if (this.grid) this.grid.replaceItems(this.items);
    }

    async softRefresh() {
        if (this._loading || !wsClient?.isConnected()) return;
        const pathForRequest = this.currentPath;
        const token = this._navToken;
        const placeholders = this._getUploadPlaceholders();
        try {
            const result = await vfsClient.listDirectory(pathForRequest, {
                offset: 0,
                limit: this.pageLimit,
                sortField: this.sortField,
                sortDirection: this.sortDirection,
                search: this.searchQuery.length >= 2 ? this.searchQuery : ''
            });
            if (token !== this._navToken || pathForRequest !== this.currentPath) return;

            const serverItems = this._enrichGalleryPreviews(result.items || []);
            const serverNames = new Set(serverItems.map(i => i.name));
            const pendingPlaceholders = placeholders.filter(p => !serverNames.has(p.name));
            this.items = serverItems.concat(pendingPlaceholders);
            this.loadedOffset = serverItems.length;
            this._syncHasMore(result);
            this._emptyMessage = result.emptyMessage || null;

            if (this.grid) this.grid.replaceItems(this.items);
            await this.updateStatusBar();
            this.updateToolbarState(this.grid?.getSelectedItems() || []);
            await this._ensurePaginationFill();
        } catch (err) {
            this._statusHint = err.message || 'Failed to refresh';
            this.renderStatusText();
        }
    }

    _beginNavigation() {
        this._navToken += 1;
        this._loading = true;
        this._setGridLoading(true);
        if (this.grid) {
            this.grid.clearSelection();
            this.grid.resetItems([]);
        }
        this.items = [];
        this.loadedOffset = 0;
        this.hasMore = false;
        return this._navToken;
    }

    _endNavigation(token) {
        if (token !== this._navToken) return;
        this._loading = false;
        this._setGridLoading(false);
    }

    _enrichGalleryPreviews(items) {
        if (typeof allImages === 'undefined' || !Array.isArray(allImages)) return items;
        return items.map(item => {
            if (item.targetKind !== 'image' && item.targetKind !== 'scrap') return item;
            const fn = item.previewImageFilename || item.targetId;
            const gi = allImages.find(img =>
                img.filename === fn || img.original === fn || img.upscaled === fn
            );
            if (!gi?.preview) return item;
            const previewPath = typeof getGalleryPreviewUrl === 'function'
                ? getGalleryPreviewUrl(gi.preview)
                : gi.preview;
            return {
                ...item,
                galleryPreview: gi.preview,
                previewUrl: `/previews/${encodeURIComponent(previewPath)}`
            };
        });
    }

    async open(path) {
        if (!this.modal) this.init();
        if (!this.modal) return;
        openModal(this.modal);
        // public/scripts/comp/modalUtils.js — activate immediately so focus overlay does not swallow grid clicks
        if (typeof bringModalToFront === 'function') {
            bringModalToFront(this.modal);
        }
        vfsClient.ensureVfsPathUuid();
        const target = path || this.getDefaultPath();
        await this.navigateTo(target);
    }

    openPath(path) {
        return this.open(path);
    }

    close() {
        if (this.modal) closeModal(this.modal);
    }

    async navigateTo(path) {
        const normalized = (path.startsWith('/') ? path : `/${path}`).replace(/\/+$/, '') || '/';
        if (this._loading) return;
        if (normalized === this.currentPath) {
            await this.softRefresh();
            return;
        }

        const token = this._beginNavigation();
        this.currentPath = normalized;
        this._applyViewModeForPath(normalized);
        this.updateLocationLabels(null);
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        if (this.history[this.historyIndex] !== this.currentPath) {
            this.history.push(this.currentPath);
            this.historyIndex = this.history.length - 1;
        }
        try {
            await this.refresh(token);
        } finally {
            this._endNavigation(token);
        }
    }

    goBack() {
        if (this._loading || this.historyIndex <= 0) return;
        this.historyIndex--;
        this.currentPath = this.history[this.historyIndex];
        this._applyViewModeForPath(this.currentPath);
        this.updateLocationLabels(null);
        const token = this._beginNavigation();
        this.refresh(token).finally(() => this._endNavigation(token));
    }

    goForward() {
        if (this._loading || this.historyIndex >= this.history.length - 1) return;
        this.historyIndex++;
        this.currentPath = this.history[this.historyIndex];
        this._applyViewModeForPath(this.currentPath);
        this.updateLocationLabels(null);
        const token = this._beginNavigation();
        this.refresh(token).finally(() => this._endNavigation(token));
    }

    goUp() {
        if (this._loading) return;
        const parts = this.currentPath.split('/').filter(Boolean);
        if (parts.length === 0) return;
        parts.pop();
        this.navigateTo(parts.length ? '/' + parts.join('/') : '/');
    }

    async refresh(navToken) {
        if (!wsClient?.isConnected()) return;
        const pathForRequest = this.currentPath;
        const token = navToken != null ? navToken : this._navToken;
        try {
            const result = await vfsClient.listDirectory(pathForRequest, {
                offset: 0,
                limit: this.pageLimit,
                sortField: this.sortField,
                sortDirection: this.sortDirection,
                search: this.searchQuery.length >= 2 ? this.searchQuery : ''
            });
            if (token !== this._navToken || pathForRequest !== this.currentPath) return;

            this.items = this._enrichGalleryPreviews(result.items || []);
            this.loadedOffset = this.items.length;
            this._syncHasMore(result);
            this._emptyMessage = result.emptyMessage || null;

            if (this._shouldAutoDetailsView(this.currentPath)
                && this.totalCount > EXPLORER_AUTO_DETAILS_THRESHOLD
                && this.viewMode !== 'details') {
                this.setViewMode('details', true);
            }

            if (this.grid) {
                this.grid.resetItems(this.items);
            }

            await this.updateStatusBar();
            this.updateToolbarState([]);
            await this._ensurePaginationFill();
        } catch (err) {
            if (token !== this._navToken) return;
            showGlassToast('error', 'Explorer', err.message || 'Failed to load directory', false, 5000);
        }
    }

    async _ensurePaginationFill() {
        if (!this.hasMore || this._loadingMore || !this.grid) return;
        let guard = 0;
        let prevCount = this._serverItemCount();
        while (this.hasMore && this.grid.needsMoreContent() && guard < 20) {
            guard += 1;
            await this.loadMore();
            const now = this._serverItemCount();
            if (now <= prevCount) break;
            prevCount = now;
        }
        if (!this._loadingMore && !this._busyKind) {
            this._statusHint = null;
            this.renderStatusText();
        }
    }

    async loadMore() {
        if (this._loadingMore || !this.hasMore) return;
        this._loadingMore = true;
        if (this.grid) this.grid.setLoadingMore(true);
        this._statusHint = 'Loading more items…';
        this.renderStatusText();
        const pathForRequest = this.currentPath;
        const placeholders = this._getUploadPlaceholders();
        const offset = this._serverItemCount();
        try {
            const result = await vfsClient.listDirectory(pathForRequest, {
                offset,
                limit: this.pageLimit,
                sortField: this.sortField,
                sortDirection: this.sortDirection,
                search: this.searchQuery.length >= 2 ? this.searchQuery : ''
            });
            if (pathForRequest !== this.currentPath) return;

            const nextItems = this._enrichGalleryPreviews(result.items || []);
            const serverItems = this.items.filter(i => !i.isUploadPlaceholder);
            this.items = serverItems.concat(nextItems).concat(placeholders);
            this.loadedOffset = serverItems.length + nextItems.length;
            if (nextItems.length === 0) {
                this.hasMore = false;
            } else {
                this._syncHasMore(result);
            }
            if (this.grid) this.grid.extendItems(this.items);
        } catch (err) {
            this._statusHint = err.message || 'Failed to load more items';
            this.renderStatusText();
        } finally {
            this._loadingMore = false;
            if (!this._busyKind) {
                this._statusHint = null;
                this.renderStatusText();
            }
            if (this.grid) {
                this.grid.setLoadingMore(false);
                this.grid._checkNearEnd();
            }
        }
    }

    renderStatusText(selected) {
        const el = this.el.statusText;
        const spinner = this.el.statusSpinner;
        const showSpinner = !!(this._loading || this._loadingMore || this._busyKind
            || (this._statusHint && /loading/i.test(this._statusHint)));
        if (spinner) spinner.classList.toggle('hidden', !showSpinner);
        if (!el) return;

        if (this._busyKind === 'open') {
            el.textContent = `Opening ${this._busyDetail || 'item'}…`;
            return;
        }
        if (this._busyKind === 'paste') {
            el.textContent = 'Moving items…';
            return;
        }
        if (this._statusHint) {
            el.textContent = this._statusHint;
            return;
        }

        const sel = selected || (this.grid ? this.grid.getSelectedItems() : []);
        if (sel.length > 0) {
            const totalSize = sel.reduce((s, i) => s + (i.size || 0), 0);
            const sizePart = totalSize ? ` · ${this.formatSize(totalSize)}` : '';
            el.textContent = sel.length === 1
                ? `${sel.length} item selected${sizePart}`
                : `${sel.length} items selected${sizePart}`;
            return;
        }

        const stats = this._pathStats;
        if (!stats) {
            if (!this._loading && !this._loadingMore && this._serverItemCount() === 0 && this._emptyMessage) {
                el.textContent = this._emptyMessage;
            } else {
                el.textContent = '';
            }
            return;
        }

        const sizeStr = this.formatSize(stats.totalSizeBytes || 0);
        let text = `${stats.itemCount || 0} items · ${sizeStr}`;
        if (stats.disk && this.currentPath === '/') {
            text += ` · Free: ${stats.disk.free || '?'} / ${stats.disk.total || '?'}`;
        }
        el.textContent = text;
    }

    updateLocationLabels(stats) {
        const displayName = stats?.displayName || this._fallbackDisplayName(this.currentPath);
        const displayPath = stats?.displayPath || this._fallbackDisplayPath(this.currentPath);
        if (this.el.titleLabel) {
            this.el.titleLabel.textContent = `${displayName} - File Explorer`;
        }
        if (this.el.addressBar && document.activeElement !== this.el.addressBar) {
            this.el.addressBar.value = displayPath;
        }
    }

    _fallbackDisplayName(path) {
        if (!path || path === '/') return 'Root';
        const parts = path.split('/').filter(Boolean);
        if (parts[0] === 'Workspaces' && parts.length >= 3) {
            const reserved = ['Desktop', 'Pictures', 'References', 'Notes', 'Scraps'];
            if (reserved.includes(parts[2])) return parts[2];
        }
        if (parts[0] === 'Workspaces' && parts.length >= 2 && typeof workspaces !== 'undefined') {
            const ws = workspaces[parts[1]];
            if (ws?.name) return ws.name;
        }
        if (parts[0] === 'System') return 'System';
        if (parts[0] === 'Workspaces' && parts.length === 1) return 'Workspaces';
        return parts[parts.length - 1] || 'File Explorer';
    }

    _fallbackDisplayPath(path) {
        if (!path || path === '/') return '/';
        const parts = path.split('/').filter(Boolean);
        if (parts[0] !== 'Workspaces') return path;
        const labels = ['Workspaces'];
        if (parts.length >= 2 && typeof workspaces !== 'undefined' && workspaces[parts[1]]?.name) {
            labels.push(workspaces[parts[1]].name);
        } else if (parts.length >= 2) {
            labels.push(parts[1]);
        }
        const reserved = ['Desktop', 'Pictures', 'References', 'Notes', 'Scraps'];
        if (parts.length >= 3 && reserved.includes(parts[2])) {
            labels.push(parts[2]);
            for (let i = 3; i < parts.length; i++) labels.push(parts[i]);
        } else if (parts.length > 2) {
            for (let i = 2; i < parts.length; i++) labels.push(parts[i]);
        }
        return '/' + labels.join('/');
    }

    async updateStatusBar() {
        try {
            const resp = await vfsClient.getPathStats(this.currentPath);
            this._pathStats = resp?.stats || resp;
            this.updateLocationLabels(this._pathStats);
            this.renderStatusText([]);
        } catch (_) {
            this._pathStats = null;
            this.updateLocationLabels(null);
            this.renderStatusText([]);
        }
    }

    formatSize(bytes) {
        if (!bytes) return '0 B';
        if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
        if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
        if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${bytes} B`;
    }

    setViewMode(mode, inheritOnly) {
        if (!mode || !EXPLORER_VIEW_MODES[mode]) return;
        this.viewMode = mode;
        if (!inheritOnly) {
            const map = this._getFolderViewModes();
            map[this.currentPath] = mode;
            localStorage.setItem(EXPLORER_FOLDER_VIEW_KEY, JSON.stringify(map));
        }
        if (this.grid) this.grid.setViewMode(mode);
        if (this.el.viewLargeBtn) this.el.viewLargeBtn.classList.toggle('active', mode === 'icons-lg');
        if (this.el.viewDetailsBtn) this.el.viewDetailsBtn.classList.toggle('active', mode === 'details');
        this.updateDetailsHeaderVisibility();
        this.updateViewsLabel();
    }

    _shortcutFromItem(item) {
        return {
            id: item.id,
            name: item.name,
            type: item.shortcutType,
            data: item.shortcutData || {}
        };
    }

    async openGalleryImage(filename) {
        if (!filename || typeof openGalleryImageInViewer !== 'function') return;
        let imageData = null;
        if (typeof allImages !== 'undefined' && allImages.length > 0) {
            imageData = allImages.find(img =>
                img.filename === filename ||
                img.original === filename ||
                img.upscaled === filename
            );
        }
        if (imageData) {
            openGalleryImageInViewer(imageData);
            return;
        }
        // public/scripts/comp/desktopShortcuts.js handleImageClick — open Lumen without metadata requirement
        const base = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '').replace(/_upscaled$/, '');
        openGalleryImageInViewer({
            filename,
            original: filename,
            base,
            upscaled: filename.includes('_upscaled') ? filename : undefined
        });
    }

    _resolveReferenceCacheImage(item) {
        if (!item?.targetId) return null;
        const hash = item.targetId;
        const sd = item.shortcutData || {};
        // public/scripts/comp/desktopShortcuts.js handleReferenceClick
        if (Array.isArray(cacheImages) && cacheImages.length) {
            const found = cacheImages.find(img => img.hash === hash);
            if (found) return found;
        }
        const isStandalone = item.targetKind === 'vibe' || !!sd.isStandalone;
        const preview = sd.preview || item.previewCachePreview
            || (item.previewHash ? `${item.previewHash}.webp` : null);
        const hasPreviewValue = preview ? (isStandalone ? preview : true) : (isStandalone ? false : true);
        return {
            hash,
            filename: sd.filename || item.name || hash,
            hasPreview: hasPreviewValue,
            preview: isStandalone ? preview : undefined,
            isStandalone,
            hasVibes: isStandalone || !!sd.hasVibes,
            workspaceId: item.workspaceId || sd.workspaceId
        };
    }

    openReferenceItem(item) {
        const cacheImage = this._resolveReferenceCacheImage(item);
        if (!cacheImage || typeof openReferenceImageInViewer !== 'function') return;
        const viewer = openReferenceImageInViewer(cacheImage);
        if (viewer?.element) {
            viewer.element.dataset.cacheImageData = JSON.stringify(cacheImage);
        }
    }

    _mountDesktopIconInBox(box, iconNode, item) {
        box.innerHTML = '';
        if (!iconNode) {
            this._populateDefaultIconBox(box, item);
            return;
        }
        iconNode.classList.add('explorer-desktop-icon-root');
        box.appendChild(iconNode);
    }

    _populateGalleryImageIconBox(box, item) {
        const frame = document.createElement('div');
        frame.className = 'desktop-shortcut-icon desktop-shortcut-icon-image explorer-desktop-icon-root';
        const imagePreview = document.createElement('div');
        imagePreview.className = 'desktop-shortcut-image-preview';
        if (item.previewUrl) {
            imagePreview.style.backgroundImage = `url('${item.previewUrl}')`;
        } else if (item.galleryPreview) {
            const previewUrl = typeof getGalleryPreviewUrl === 'function'
                ? getGalleryPreviewUrl(item.galleryPreview)
                : item.galleryPreview;
            imagePreview.style.backgroundImage = `url('/previews/${encodeURIComponent(previewUrl)}')`;
        } else if (item.previewImageFilename) {
            imagePreview.style.backgroundImage = `url('/images/${encodeURIComponent(item.previewImageFilename)}')`;
        }
        const flareHolder = document.createElement('div');
        flareHolder.className = 'desktop-shortcut-flare-holder';
        const imageIcon = document.createElement('i');
        imageIcon.className = 'fas fa-image desktop-shortcut-image-icon';
        flareHolder.appendChild(imageIcon);
        imagePreview.appendChild(flareHolder);
        frame.appendChild(imagePreview);
        box.innerHTML = '';
        box.appendChild(frame);
    }

    _populateReferenceIconBox(box, item) {
        const frame = document.createElement('div');
        frame.className = 'desktop-shortcut-icon desktop-shortcut-icon-image explorer-desktop-icon-root';
        const imagePreview = document.createElement('div');
        imagePreview.className = 'desktop-shortcut-image-preview';
        const sd = item.shortcutData || {};
        const hash = sd.hash || item.previewHash || item.targetId;
        if (sd.preview || item.previewCachePreview) {
            imagePreview.style.backgroundImage = `url('/cache/preview/${sd.preview || item.previewCachePreview}')`;
        } else if (hash) {
            imagePreview.style.backgroundImage = `url('/cache/preview/${hash}.webp')`;
        }
        const flareHolder = document.createElement('div');
        flareHolder.className = 'desktop-shortcut-flare-holder';
        const refIcon = document.createElement('i');
        const refType = sd.refType || item.refType || (item.targetKind === 'vibe' ? 'vibe' : 'base');
        if (refType === 'vibe') {
            refIcon.className = 'nai-vibe-transfer desktop-shortcut-image-icon';
        } else if (refType === 'character') {
            refIcon.className = 'nai-precise-reference desktop-shortcut-image-icon';
        } else {
            refIcon.className = 'nai-img2img desktop-shortcut-image-icon';
        }
        flareHolder.appendChild(refIcon);
        imagePreview.appendChild(flareHolder);
        frame.appendChild(imagePreview);
        box.innerHTML = '';
        box.appendChild(frame);
    }

    _populateNoteIconBox(box, item) {
        const icon = document.createElement('div');
        icon.className = 'desktop-shortcut-icon desktop-shortcut-icon-note explorer-desktop-icon-root';
        icon.style.color = item.noteColor || '#ffc107';
        const noteIcon = document.createElement('i');
        noteIcon.className = item.noteIcon || item.icon || 'fas fa-file-lines';
        icon.appendChild(noteIcon);
        box.innerHTML = '';
        box.appendChild(icon);
    }

    _populateDefaultIconBox(box, item) {
        const icon = document.createElement('i');
        icon.className = `${item.icon || 'fas fa-file'} explorer-item-type-icon`;
        box.innerHTML = '';
        box.appendChild(icon);
    }

    _populatePreviewIconBox(box, item) {
        box.innerHTML = '';
        box.classList.remove('has-preview');
        const icon = document.createElement('i');
        icon.className = `${item.icon || 'fas fa-file'} explorer-item-type-icon`;
        box.appendChild(icon);
        const img = document.createElement('img');
        img.className = 'explorer-item-preview-img';
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('load', () => box.classList.add('has-preview'));
        img.addEventListener('error', () => {
            img.remove();
            box.classList.remove('has-preview');
        });
        img.src = item.previewUrl;
        box.appendChild(img);
    }

    _populateIconBox(box, item) {
        if (item.shortcutType && typeof desktopShortcuts !== 'undefined') {
            const shortcut = this._shortcutFromItem(item);
            const handler = desktopShortcuts.shortcutTypes[shortcut.type];
            if (handler?.icon) {
                const iconResult = handler.icon.call(desktopShortcuts, shortcut);
                if (iconResult instanceof Promise) {
                    iconResult.then((node) => this._mountDesktopIconInBox(box, node, item))
                        .catch(() => this._populateDefaultIconBox(box, item));
                    return;
                }
                this._mountDesktopIconInBox(box, iconResult, item);
                return;
            }
        }
        if (item.targetKind === 'reference' || item.targetKind === 'vibe') {
            this._populateReferenceIconBox(box, item);
            return;
        }
        if (item.targetKind === 'note') {
            this._populateNoteIconBox(box, item);
            return;
        }
        if (item.targetKind === 'image' || item.targetKind === 'scrap' || item.previewImageFilename || item.galleryPreview) {
            this._populateGalleryImageIconBox(box, item);
            return;
        }
        if (item.previewUrl) {
            this._populatePreviewIconBox(box, item);
            return;
        }
        this._populateDefaultIconBox(box, item);
    }

    async openItem(item) {
        if (this._loading || this._loadingMore || item?.isUploadPlaceholder) return;

        const navPath = item.navPath || this.resolveNavigationPath(item);
        if (navPath) {
            if (navPath === this.currentPath) return;
            this.navigateTo(navPath);
            return;
        }

        const openLabel = item.name || 'item';
        this._setBusyState('open', openLabel);
        if (this.grid) this.grid.setOpeningItemId(item.id);
        try {
            if (item.targetKind === 'reference' || item.targetKind === 'vibe') {
                this.openReferenceItem(item);
                return;
            }

            if (item.shortcutType && typeof desktopShortcuts !== 'undefined') {
                desktopShortcuts.handleShortcutClick(this._shortcutFromItem(item));
                return;
            }

            if (item.targetKind === 'image' || item.targetKind === 'scrap') {
                const filename = item.previewImageFilename || item.targetId;
                await this.openGalleryImage(filename);
                return;
            }
            if (item.targetKind === 'note') {
                if (notepadManager) notepadManager.openExistingNote(item.targetId);
                return;
            }
            if (item.targetKind === 'user-file') {
                if ((item.mimeType || '').startsWith('text/')) {
                    await this.downloadSelectionItem(item);
                } else if ((item.mimeType || '').startsWith('image/') && item.previewUrl) {
                    openImageInViewer(item.previewUrl, item.name, {});
                } else {
                    await this.downloadSelectionItem(item);
                }
            }
        } finally {
            this._setBusyState(null);
            if (this.grid) this.grid.setOpeningItemId(null);
        }
    }

    onSelectionChange(selected) {
        this.updateToolbarState(selected);
        this.renderStatusText(selected);
    }

    updateToolbarState(selected) {
        const sel = selected || (this.grid ? this.grid.getSelectedItems() : []);
        const hasSel = sel.length > 0;
        const single = sel.length === 1;
        const canModify = single && !sel[0].protected && sel[0].targetKind === 'vfs-folder';
        const canFile = single && sel[0].targetKind === 'user-file' && !this._isUserFileLinkItem(sel[0]);
        const canRenameShortcut = single && (
            this._isLiveDesktopShortcutItem(sel[0]) || this._isStoredShortcutItem(sel[0])
                || this._isUserFileLinkItem(sel[0])
                || (sel[0].isShortcut && this._isVirtualSurfaceItem(sel[0]))
        ) && !sel[0].protected;

        const set = (btn, on) => {
            if (!btn) return;
            btn.disabled = !on;
            btn.classList.toggle('disabled', !on);
        };
        set(this.el.cutBtn, hasSel);
        set(this.el.copyBtn, hasSel);
        set(this.el.pasteBtn, !!this.clipboard);
        set(this.el.renameBtn, canModify || canFile || canRenameShortcut);
        set(this.el.downloadBtn, canFile);
        set(this.el.replaceBtn, canFile);
        set(this.el.deleteBtn, hasSel);
    }

    _itemRefs(items) {
        return items.map(i => ({
            id: i.id,
            name: i.name,
            kind: i.kind,
            targetKind: i.targetKind,
            targetId: i.targetId,
            isShortcut: !!i.isShortcut,
            isUserFileLink: this._isUserFileLinkItem(i),
            isDesktopShortcut: !!i.isDesktopShortcut,
            isVfsShortcutEntry: !!this._isStoredShortcutItem(i),
            vfsEntryId: this._isStoredShortcutItem(i) ? i.id : undefined,
            workspaceId: i.workspaceId,
            shortcutId: i.isDesktopShortcut ? i.id : undefined,
            shortcutType: i.shortcutType || undefined,
            shortcutData: i.shortcutData || undefined
        }));
    }

    cutSelection() {
        const sel = this.grid?.getSelectedItems() || [];
        if (!sel.length) return;
        this.clipboard = { operation: 'cut', items: this._itemRefs(sel), sourcePath: this.currentPath };
        this.updateToolbarState(sel);
    }

    copySelection() {
        const sel = this.grid?.getSelectedItems() || [];
        if (!sel.length) return;
        this.clipboard = { operation: 'copy', items: this._itemRefs(sel), sourcePath: this.currentPath };
        this.updateToolbarState(sel);
    }

    async pasteClipboard() {
        if (!this.clipboard) return;
        await this.pasteToPath(this.currentPath);
    }

    async pasteToPath(navPath) {
        if (!this.clipboard || !navPath) return;
        const { operation, items } = this.clipboard;
        this._setBusyState('paste');
        try {
            const done = await this.deliverItemsToPath(items, navPath, operation);
            if (done === false) return;
            if (operation === 'cut') this.clipboard = null;
            if (navPath === this.currentPath) {
                await this.softRefresh();
            }
        } catch (err) {
            showGlassToast('error', 'Explorer', err.message || 'Paste failed', false, 5000);
        } finally {
            await this._restoreStatusAfterOperation();
        }
    }

    async createFolder() {
        const name = 'New Folder';
        await vfsClient.createFolder(this.currentPath, name);
        await this.softRefresh();
    }

    async uploadFilesToPath(vfsPath, fileList) {
        if (!fileList?.length) return;
        const files = [...fileList];
        const showPlaceholders = vfsPath === this.currentPath;
        let placeholderIds = [];
        if (showPlaceholders) {
            placeholderIds = this._addUploadPlaceholders(files);
        } else {
            this._statusHint = `Uploading ${files.length} file(s)…`;
            this.renderStatusText();
        }
        try {
            await vfsImportRouter.routeFilesToPath(vfsPath, files);
            if (showPlaceholders) {
                await this.softRefresh();
            }
        } catch (err) {
            this._statusHint = err.message || 'Upload failed';
            this.renderStatusText();
        } finally {
            if (showPlaceholders) {
                this._removeUploadPlaceholders(placeholderIds);
            } else {
                this._statusHint = null;
                this.renderStatusText();
            }
            if (this.el?.fileInput) this.el.fileInput.value = '';
        }
    }

    async handleFileUpload(fileList) {
        await this.uploadFilesToPath(this.currentPath, fileList);
    }

    async handleItemsDrop(dragItems, target) {
        if (!dragItems?.length || !target) return;
        if (target.type === 'folder') {
            const navPath = target.item.navPath || this.resolveNavigationPath(target.item);
            if (navPath) await this.deliverItemsToPath(dragItems, navPath, 'cut');
            return;
        }
        if (target.type === 'desktop') {
            const wsId = dragItems[0]?.workspaceId
                || this.getWorkspaceIdFromPath()
                || (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null);
            if (!wsId) return;
            await this.deliverItemsToPath(dragItems, `/Workspaces/${wsId}/Desktop`, 'cut');
        }
    }

    async deliverItemsToPath(dragItems, navPath, operation = 'cut') {
        if (!dragItems?.length || !navPath) return true;
        const touchDesktop = this._touchesDesktop(navPath, dragItems);
        this._setBusyState('paste');
        try {
            if (this._isDesktopDestination(navPath)) {
                await this._deliverToDesktop(dragItems, navPath, operation);
            } else if (operation === 'cut') {
                await vfsClient.moveItems(this._itemRefs(dragItems), navPath);
            } else {
                const refs = this._itemRefs(dragItems);
                let copyOptions = {};
                if (this._refsIncludeUserFiles(refs)) {
                    const mode = await this._promptUserFileCopyMode();
                    if (!mode) return false;
                    copyOptions.userFileCopyMode = mode;
                }
                await vfsClient.copyItems(refs, navPath, copyOptions);
            }

            if (touchDesktop) this._refreshDesktop();

            const touchedGallery = dragItems.some(i => this._isVirtualSurfaceItem(i)
                && !i.isShortcut && ['image', 'scrap'].includes(i.targetKind));
            if (touchedGallery && operation === 'cut' && typeof loadGallery === 'function') {
                loadGallery(true);
            }

            const fromHere = dragItems.some(i => this.items.some(x => x.id === i.id));
            if (navPath === this.currentPath) {
                await this.softRefresh();
            } else if (fromHere && operation === 'cut') {
                const movedIds = new Set(dragItems.map(i => i.id));
                this.items = this.items.filter(i => !movedIds.has(i.id));
                this.loadedOffset = this._serverItemCount();
                if (this.grid) this.grid.replaceItems(this.items);
                await this.updateStatusBar();
                this.updateToolbarState(this.grid?.getSelectedItems() || []);
                await this.softRefresh();
            } else if (fromHere) {
                await this.softRefresh();
            }
            return true;
        } catch (err) {
            showGlassToast('error', 'Explorer', err.message || 'Move failed', false, 5000);
            return false;
        } finally {
            await this._restoreStatusAfterOperation();
        }
    }

    async moveItemsToPath(dragItems, navPath) {
        await this.deliverItemsToPath(dragItems, navPath, 'cut');
    }

    async handleItemDrop(targetItem, event) {
        if (!this.isFolderItem(targetItem)) return;
        const navPath = targetItem.navPath || this.resolveNavigationPath(targetItem);
        if (!navPath) return;

        const files = [...(event.dataTransfer?.files || [])];
        if (files.length) {
            await this.uploadFilesToPath(navPath, files);
            return;
        }

        const raw = event.dataTransfer?.getData('application/x-explorer-items');
        if (!raw) return;
        let dragItems;
        try {
            dragItems = JSON.parse(raw);
        } catch {
            return;
        }
        if (!dragItems.length) return;
        await this.moveItemsToPath(dragItems, navPath);
    }

    async renameSelection() {
        const sel = this.grid?.getSelectedItems() || [];
        if (sel.length !== 1) return;
        const item = sel[0];
        const newName = prompt('Rename to:', item.name);
        if (!newName || newName === item.name) return;
        if (item.targetKind === 'vfs-folder') {
            await vfsClient.renameFolder(item.targetId, newName);
        } else if (item.targetKind === 'user-file' && !this._isUserFileLinkItem(item)) {
            await vfsClient.renameFile(item.targetId, newName);
        } else if (this._isUserFileLinkItem(item)) {
            await vfsClient.renameEntry(item.id, newName);
        } else if (item.isShortcut && this._isVirtualSurfaceItem(item)) {
            await vfsClient.renameEntry(item.id, newName);
        } else if (this._isStoredShortcutItem(item)) {
            await vfsClient.renameShortcutEntry(item.id, newName);
        } else if (this._isLiveDesktopShortcutItem(item) && typeof desktopShortcuts !== 'undefined') {
            await desktopShortcuts.renameShortcut(item.id, newName);
            if (this._isDesktopDestination(this.currentPath)) this._refreshDesktop();
        } else {
            return;
        }
        await this.softRefresh();
    }

    async replaceSelection() {
        const sel = this.grid?.getSelectedItems() || [];
        if (sel.length !== 1 || sel[0].targetKind !== 'user-file') return;
        const item = sel[0];
        const input = document.createElement('input');
        input.type = 'file';
        input.style.display = 'none';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            input.remove();
            if (!file) return;
            try {
                const base64 = await fileToBase64(file);
                await vfsClient.replaceFile(item.targetId, base64, file.type || item.mimeType);
                await this.softRefresh();
                showGlassToast('success', 'Explorer', 'File replaced', false, 3000);
            } catch (err) {
                showGlassToast('error', 'Explorer', err.message || 'Replace failed', false, 5000);
            }
        });
        document.body.appendChild(input);
        input.click();
    }

    async downloadSelection() {
        const sel = this.grid?.getSelectedItems() || [];
        for (const item of sel) await this.downloadSelectionItem(item);
    }

    async downloadSelectionItem(item) {
        if (item.targetKind !== 'user-file') return;
        const resp = await vfsClient.downloadFile(item.targetId);
        if (resp.downloadUrl) {
            const a = document.createElement('a');
            a.href = resp.downloadUrl;
            a.download = item.name;
            a.click();
        }
    }

    async _permanentlyDeleteExplorerItem(item) {
        if (this._isLiveDesktopShortcutItem(item) && this._isFolderShortcutItem(item) && typeof desktopShortcuts !== 'undefined') {
            await desktopShortcuts.deleteFolderShortcut(item.id);
            return 'desktop';
        }
        if (this._isLiveDesktopShortcutItem(item) && typeof desktopShortcuts !== 'undefined') {
            const shortcut = {
                id: item.id,
                name: item.name,
                type: item.shortcutType,
                data: item.shortcutData || {}
            };
            await desktopShortcuts.permanentlyDeleteShortcutTarget(shortcut);
            return 'desktop';
        }
        if (this._isStoredShortcutItem(item)) {
            if (item.targetKind && item.targetKind !== 'vfs-folder') {
                await this._deleteVirtualSurfaceItem(item);
            } else if (item.targetKind === 'vfs-folder') {
                await vfsClient.deleteFolder(item.targetId);
            }
            await vfsClient.deleteEntry(item.id);
            return item.targetKind === 'image' || item.targetKind === 'scrap' ? 'gallery' : null;
        }
        if (this._shouldRemoveShortcutOnly(item) && this._isVirtualSurfaceItem(item)) {
            await this._deleteVirtualSurfaceItem(item);
            await this._removeShortcutItem(item);
            return 'gallery';
        }
        if (item.targetKind === 'vfs-folder') {
            const wsId = item.workspaceId || this.getWorkspaceIdFromPath();
            const folderId = item.targetId || item.id;
            const listPath = item.navPath
                || (wsId ? `/Workspaces/${wsId}/Desktop/${folderId}` : null);
            if (listPath && typeof desktopShortcuts !== 'undefined') {
                await desktopShortcuts.purgeVfsFolderByPath(listPath, folderId);
            } else {
                await vfsClient.deleteFolder(folderId);
            }
            if (this._isLiveDesktopShortcutItem(item)) return 'desktop';
            return null;
        }
        if (item.targetKind === 'user-file') {
            await wsClient.sendMessage('vfs_delete_file', { fileId: item.targetId });
            return null;
        }
        if (this._isVirtualSurfaceItem(item)) {
            await this._deleteVirtualSurfaceItem(item);
            return ['image', 'scrap'].includes(item.targetKind) ? 'gallery' : null;
        }
        return null;
    }

    async deleteSelection(options = {}) {
        const fromKeyboard = options.fromKeyboard === true;
        const permanent = options.permanent === true;
        const sel = this.grid?.getSelectedItems() || [];
        if (!sel.length) return;

        const folderItems = sel.filter(i => this._isFolderShortcutItem(i) && !i.protected && !i.system);
        const shortcutItems = sel.filter(i => this._shouldRemoveShortcutOnly(i) && !i.protected && !i.system);
        const nativeVirtual = sel.filter(i => this._isVirtualSurfaceItem(i) && !this._shouldRemoveShortcutOnly(i));

        if (folderItems.length && typeof showConfirmationDialog === 'function') {
            const folderMsg = folderItems.length === 1 && sel.length === 1
                ? desktopShortcuts.getFolderDeleteConfirmMessage({
                    name: folderItems[0].name,
                    data: folderItems[0].shortcutData || {}
                })
                : `Delete ${folderItems.length} folder(s) and their contents? This cannot be undone.`;
            const folderConfirmed = await showConfirmationDialog(
                folderMsg,
                [
                    { text: 'Delete', value: true, className: 'btn-danger' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ]
            );
            if (!folderConfirmed) return;
        }

        // Delete key (no Shift): remove shortcut links only — never permanently delete underlying files
        if (fromKeyboard && !permanent && shortcutItems.length && !folderItems.length) {
            let desktopTouched = false;
            for (const item of shortcutItems) {
                try {
                    await this._removeShortcutItem(item);
                    if (this._isLiveDesktopShortcutItem(item)) desktopTouched = true;
                } catch (err) {
                    showGlassToast('error', 'Explorer', err.message || 'Remove shortcut failed', false, 5000);
                }
            }
            if (desktopTouched) this._refreshDesktop();
            await this.softRefresh();
            return;
        }

        if (nativeVirtual.length) {
            const labels = { image: 'image(s)', scrap: 'scrap(s)', reference: 'reference(s)', vibe: 'vibe(s)', note: 'note(s)' };
            const kinds = [...new Set(nativeVirtual.map(i => labels[i.targetKind] || 'item(s)'))].join(', ');
            const confirmed = typeof showConfirmationDialog === 'function'
                ? await showConfirmationDialog(
                    `Permanently delete ${nativeVirtual.length} ${kinds}? This uses the same action as deleting from the gallery or reference manager.`,
                    [
                        { text: 'Delete', value: true, className: 'btn-danger' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ]
                )
                : true;
            if (!confirmed) return;
        } else if (shortcutItems.length && !fromKeyboard) {
            const confirmed = typeof showConfirmationDialog === 'function'
                ? await showConfirmationDialog(
                    `Remove ${shortcutItems.length} shortcut(s)? The original files will not be deleted.`,
                    [
                        { text: 'Remove', value: true, className: 'btn-danger' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ]
                )
                : true;
            if (!confirmed) return;
        } else if (shortcutItems.length && fromKeyboard && permanent) {
            const confirmed = typeof showConfirmationDialog === 'function'
                ? await showConfirmationDialog(
                    `Permanently delete ${shortcutItems.length} shortcut item(s) and their underlying files?`,
                    [
                        { text: 'Delete', value: true, className: 'btn-danger' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ]
                )
                : true;
            if (!confirmed) return;
        }

        let desktopTouched = false;
        let deleted = 0;
        let skipped = 0;
        let galleryTouched = false;

        for (const item of sel) {
            if (item.protected || item.system) {
                skipped += 1;
                continue;
            }
            if (this._isFolderShortcutItem(item)) {
                try {
                    if (typeof desktopShortcuts !== 'undefined') {
                        await desktopShortcuts.deleteFolderShortcut(item.id);
                    } else {
                        await this._permanentlyDeleteExplorerItem(item);
                    }
                    if (this._isLiveDesktopShortcutItem(item)) desktopTouched = true;
                    deleted += 1;
                } catch (err) {
                    showGlassToast('error', 'Explorer', err.message || 'Delete folder failed', false, 5000);
                    skipped += 1;
                }
                continue;
            }
            if (!permanent && this._shouldRemoveShortcutOnly(item)) {
                try {
                    await this._removeShortcutItem(item);
                    if (this._isLiveDesktopShortcutItem(item)) desktopTouched = true;
                    deleted += 1;
                } catch (err) {
                    showGlassToast('error', 'Explorer', err.message || 'Remove shortcut failed', false, 5000);
                    skipped += 1;
                }
                continue;
            }
            try {
                const touch = await this._permanentlyDeleteExplorerItem(item);
                deleted += 1;
                if (touch === 'desktop') desktopTouched = true;
                if (touch === 'gallery') galleryTouched = true;
            } catch (err) {
                showGlassToast('error', 'Explorer', err.message || 'Delete failed', false, 5000);
                skipped += 1;
            }
        }
        if (skipped && !deleted) {
            showGlassToast('warning', 'Explorer', 'The selected items cannot be deleted from here.', false, 4000);
            return;
        }
        if (skipped && deleted) {
            showGlassToast('warning', 'Explorer', `${skipped} item(s) could not be deleted.`, false, 4000);
        }
        if (desktopTouched) this._refreshDesktop();
        if (galleryTouched && typeof loadGallery === 'function') loadGallery(true);
        if (deleted) await this.softRefresh();
    }
}

let explorerApplet = null;

function initializeExplorerApplet() {
    if (!explorerApplet) {
        explorerApplet = new ExplorerApplet();
    }
    return explorerApplet;
}

function openExplorerApplet(path) {
    const app = initializeExplorerApplet();
    if (app) app.open(path);
}
