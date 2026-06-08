// Desktop Shortcuts Manager
// Manages desktop shortcuts for each workspace

class DesktopShortcutsManager {
    constructor() {
        this.shortcuts = [];
        this.currentWorkspace = null;
        this.desktopContainer = null;
        this.gridContainer = null;
        this.freeformContainer = null;
        this.draggedShortcut = null;
        this.dragOffset = { x: 0, y: 0 };
        this.dragStartPos = { x: 0, y: 0 };
        this.isDragging = false;
        this.dragThreshold = 10; // pixels to move before starting drag
        
        // Debounce settings
        this.saveDebounceTimer = null;
        this.saveDebounceDelay = 10000; // 10 seconds (aligned with server workspaceDesktop debounce)
        this.pendingChanges = false;
        this.pendingWindowPositionSave = false;
        this._saveTrayState = 'hidden';
        this._saveTrayHideTimer = null;
        
        // Positioning settings
        this.snapThreshold = 50; // pixels to snap to grid
        this.iconSize = 80; // default icon size for collision detection
        
        // Drop zone overlay
        this.dropZoneOverlay = null;
        
        // Collision offsets (temporary display adjustments for freeform icons only)
        this.collisionOffsets = new Map(); // shortcutId -> {x, y}

        // Multi-select state
        this.selectedShortcutIds = new Set();
        this.dragGroup = null; // [{ element, shortcut, startX, startY, wasInGrid }]
        this.primaryDragStart = { x: 0, y: 0 };
        this.marqueeState = null;
        this.selectionMarqueeEl = null;

        // Folder drag/hold gesture state
        this.folderHoldTarget = null;
        this.folderHoldTimer = null;
        this._lastDesktopContextCoords = null;
        
        // Shortcut type definitions
        this.shortcutTypes = {
            image: {
                icon: this.createImageIcon,
                contextMenu: this.getImageContextMenu,
                onClick: this.handleImageClick
            },
            note: {
                icon: this.createNoteIcon,
                contextMenu: this.getNoteContextMenu,
                onClick: this.handleNoteClick
            },
            reference: {
                icon: this.createReferenceIcon,
                contextMenu: this.getReferenceContextMenu,
                onClick: this.handleReferenceClick,
                onDragToManual: this.handleReferenceDragToManual
            },
            applet: {
                icon: this.createAppletIcon,
                contextMenu: this.getAppletContextMenu,
                onClick: this.handleAppletClick
            },
            request: {
                icon: this.createRequestIcon,
                contextMenu: this.getRequestContextMenu,
                onClick: this.handleRequestClick
            },
            preset: {
                icon: this.createPresetIcon,
                contextMenu: this.getPresetContextMenu,
                onClick: this.handlePresetClick
            },
            'wiki-page': {
                icon: this.createWikiPageIcon,
                contextMenu: this.getWikiPageContextMenu,
                onClick: this.handleWikiPageClick
            },
            'static-wiki-page': {
                icon: this.createStaticWikiPageIcon,
                contextMenu: this.getStaticWikiPageContextMenu,
                onClick: this.handleStaticWikiPageClick
            },
            'nax-tag': {
                icon: this.createNaxTagIcon,
                contextMenu: this.getNaxTagContextMenu,
                onClick: this.handleNaxTagClick
            },
            'bracket-generation': {
                icon: this.createBracketGenerationIcon,
                contextMenu: this.getBracketGenerationContextMenu,
                onClick: this.handleBracketGenerationClick
            },
            folder: {
                icon: this.createFolderIcon,
                contextMenu: this.getFolderContextMenu,
                onClick: this.handleFolderClick
            }
        };
    }

    // Initialize the desktop shortcuts manager
    init() {
        this.desktopContainer = document.getElementById('desktopIcons');
        this.gridContainer = document.getElementById('desktopGridContainer');
        this.freeformContainer = document.getElementById('desktopFreeformContainer');
        
        if (!this.desktopContainer || !this.gridContainer || !this.freeformContainer) {
            console.error('Desktop containers not found:', {
                desktopContainer: !!this.desktopContainer,
                gridContainer: !!this.gridContainer,
                freeformContainer: !!this.freeformContainer
            });
            return;
        }

        // Listen for WebSocket events
        this.initializeWebSocketListeners();
        this.setupSelectionHandlers();
        this.hideSaveTrayIndicator();
        
        // Save pending changes before page unload
        window.addEventListener('beforeunload', () => {
            if (this.pendingChanges || this.pendingWindowPositionSave) {
                if (this.saveDebounceTimer) {
                    clearTimeout(this.saveDebounceTimer);
                }
                if (this.pendingWindowPositionSave && typeof flushSaveWindowPositions === 'function') {
                    flushSaveWindowPositions();
                }
                if (this.pendingChanges) {
                    this.saveToServer();
                }
            }
        });
    }

    hasPendingDesktopChanges() {
        return !!(this.pendingChanges || this.pendingWindowPositionSave);
    }

    hideSaveTrayIndicator() {
        this.updateSaveTrayIndicator('hidden');
    }

    refreshSaveTrayIndicator() {
        if (!window.isDesktop) {
            this.hideSaveTrayIndicator();
            return;
        }

        if (this.hasPendingDesktopChanges()) {
            this.updateSaveTrayIndicator('pending');
        }
    }

    updateSaveTrayIndicator(state) {
        if (!window.isDesktop) {
            return;
        }

        const indicator = document.getElementById('desktopSaveTrayIndicator');
        const icon = document.getElementById('desktopSaveTrayIcon');
        if (!indicator || !icon) {
            return;
        }

        if (this._saveTrayHideTimer) {
            clearTimeout(this._saveTrayHideTimer);
            this._saveTrayHideTimer = null;
        }

        this._saveTrayState = state;
        indicator.classList.remove('pending', 'received', 'saved');

        switch (state) {
            case 'pending':
                indicator.classList.remove('hidden');
                indicator.classList.add('pending');
                icon.className = 'fas fa-inbox-in';
                indicator.title = 'Desktop changes waiting to sync…';
                break;
            case 'received':
                indicator.classList.remove('hidden');
                indicator.classList.add('received');
                icon.className = 'fas fa-inbox-full';
                indicator.title = 'Desktop changes received by server…';
                break;
            case 'saved':
                indicator.classList.remove('hidden');
                indicator.classList.add('saved');
                icon.className = 'fas fa-inbox';
                indicator.title = 'Desktop layout saved to disk';
                this._saveTrayHideTimer = setTimeout(() => {
                    if (this._saveTrayState === 'saved' && !this.hasPendingDesktopChanges()) {
                        this.hideSaveTrayIndicator();
                    }
                }, 20000);
                break;
            default:
                indicator.classList.add('hidden');
                indicator.title = 'Desktop layout saved';
                this._saveTrayState = 'hidden';
                break;
        }
    }

    handleWorkspaceDesktopPersisted() {
        if (this.hasPendingDesktopChanges()) {
            return;
        }

        this.updateSaveTrayIndicator('saved');
    }

    markDesktopChangesReceivedByServer() {
        if (this.hasPendingDesktopChanges()) {
            this.refreshSaveTrayIndicator();
            return;
        }

        this.updateSaveTrayIndicator('received');
    }

    async flushPendingDesktopLayout() {
        const hadWindowPositions = this.pendingWindowPositionSave;
        const hadShortcutChanges = this.pendingChanges;

        if (hadWindowPositions && typeof flushSaveWindowPositions === 'function') {
            await flushSaveWindowPositions();
            this.pendingWindowPositionSave = false;
        }

        if (hadShortcutChanges) {
            await this.saveToServer();
        }

        if (!this.hasPendingDesktopChanges() && (hadWindowPositions || hadShortcutChanges)) {
            this.markDesktopChangesReceivedByServer();
        }
    }

    // Initialize WebSocket listeners for desktop events
    initializeWebSocketListeners() {
        if (!wsClient) {
            console.warn('WebSocket client not available');
            return;
        }

        document.addEventListener('wsMessage', (event) => {
            const { type, data } = event.detail;
            
            // Ignore broadcasts from our own pending local changes
            if (this.pendingChanges) {
                return;
            }
            
            switch (type) {
                case 'desktop_shortcut_added':
                    if (data.workspaceId === this.currentWorkspace) {
                        // Check if we don't already have this shortcut locally
                        if (!this.shortcuts.find(s => s.id === data.shortcut.id && !s._isDeleted)) {
                            this.shortcuts.push(data.shortcut);
                            this.renderShortcuts();
                        }
                    }
                    break;
                    
                case 'desktop_shortcut_updated':
                    if (data.workspaceId === this.currentWorkspace) {
                        const shortcut = this.shortcuts.find(s => s.id === data.shortcutId);
                        if (shortcut && !shortcut._isDeleted && !shortcut._nameModified) {
                            Object.assign(shortcut, data.updates);
                            this.updateShortcutInDOM(data.shortcutId, data.updates);
                        }
                    }
                    break;
                    
                case 'desktop_shortcut_removed':
                    if (data.workspaceId === this.currentWorkspace) {
                        this.shortcuts = this.shortcuts.filter(s => s.id !== data.shortcutId);
                        this.removeShortcutFromDOM(data.shortcutId);
                    }
                    break;
                    
                case 'desktop_positions_updated':
                    if (data.workspaceId === this.currentWorkspace) {
                        data.positions.forEach(({ id, position }) => {
                            const shortcut = this.shortcuts.find(s => s.id === id);
                            if (shortcut && !shortcut._isDeleted) {
                                shortcut.position = position;
                            }
                        });
                        this.updatePositionsInDOM(data.positions);
                    }
                    break;

                case 'note_updated':
                    // Refresh note shortcuts if they exist on desktop
                    if (data.noteId) {
                        const noteShortcuts = this.shortcuts.filter(s => s.type === 'note' && s.data?.noteId === data.noteId);
                        noteShortcuts.forEach(shortcut => {
                            this.updateShortcutInDOM(shortcut.id, {});
                        });
                    }
                    break;

                case 'note_deleted':
                    // Remove note shortcuts from desktop if the note was deleted
                    if (data.noteId) {
                        const noteShortcuts = this.shortcuts.filter(s => s.type === 'note' && s.data?.noteId === data.noteId);
                        noteShortcuts.forEach(shortcut => {
                            this.removeShortcut(shortcut.id);
                        });
                    }
                    break;

                case 'workspace_updated':
                    // Handle window positions updates (stored in same file as shortcuts, global not per-workspace)
                    if (data.action === 'window_positions_updated' && data.windowPositions) {
                        // Update global window positions directly
                        Object.assign(globalWindowPositions, data.windowPositions);
                    }
                    break;
            }
        });
    }

    // Handle workspace change
    async handleWorkspaceChange(workspaceId, skipAnimation = false) {
        // Save any pending changes before switching
        if (this.hasPendingDesktopChanges()) {
            if (this.saveDebounceTimer) {
                clearTimeout(this.saveDebounceTimer);
                this.saveDebounceTimer = null;
            }
            await this.flushPendingDesktopLayout();
        }

        this.currentWorkspace = workspaceId;
        this.clearSelection();

        await this.loadShortcuts(workspaceId);
        
        // Only render shortcuts if containers are initialized and not during initial load
        // The init step will handle rendering after containers are ready
        if (!skipAnimation && this.gridContainer && this.freeformContainer) {
            this.renderShortcuts();
        }
    }

    // Load shortcuts for a workspace (also loads window positions from same file)
    async loadShortcuts(workspaceId) {
        try {
            if (!wsClient || !wsClient.isConnected()) {
                console.warn('WebSocket not connected, cannot load shortcuts');
                return;
            }

            const data = await wsClient.getDesktopShortcuts(workspaceId);

            if (data && data.shortcuts) {
                this.shortcuts = data.shortcuts;
            } else {
                this.shortcuts = [];
            }
            
            // Set global window positions directly
            globalWindowPositions = data?.windowPositions || {};
        } catch (error) {
            console.error('Failed to load desktop shortcuts:', error);
            this.shortcuts = [];
        }
    }

    // Fetch all notes metadata for current workspace (using notepadManager cache)
    async fetchNotesMetadataCache() {
        if (!this.currentWorkspace) {
            return null;
        }

        // Get metadata from notepadManager's centralized cache
        return await window.notepadManager.getNotesMetadata(this.currentWorkspace);
    }

    // Render all shortcuts
    async renderShortcuts() {
        if (!this.gridContainer || !this.freeformContainer) {
            console.warn('Desktop containers not found');
            return;
        }

        // Load notes metadata cache before rendering
        this.notesMetadataCache = await this.fetchNotesMetadataCache();

        // Clear existing shortcuts
        this.gridContainer.innerHTML = '';
        this.freeformContainer.innerHTML = '';
        
        // Clear collision offsets
        this.collisionOffsets.clear();

        const activeShortcuts = this.shortcuts.filter(s => !s._isDeleted && (s.folderId == null || s.folderId === undefined));
        
        // Separate grid shortcuts from freeform shortcuts
        const gridShortcuts = activeShortcuts
            .filter(s => s.position && s.position.index === 0)
            .sort((a, b) => (a.position.pos || 0) - (b.position.pos || 0));
            
        const freeformShortcuts = activeShortcuts
            .filter(s => !s.position || s.position.index !== 0)
            .sort((a, b) => {
                if (!a.position || !b.position) return 0;
                return a.position.index - b.position.index;
            });
        
        // Render grid shortcuts (flex layout, no positioning needed)
        gridShortcuts.forEach(shortcut => {
            this.addGridShortcutToDOM(shortcut);
        });
        
        // Calculate collision offsets for freeform shortcuts, then render
        freeformShortcuts.forEach(shortcut => {
            const pixelPos = this.calculateQuadrantPixelPosition(shortcut);
            if (pixelPos) {
                const offset = this.calculateCollisionOffset(shortcut, pixelPos, freeformShortcuts);
                if (offset.x !== 0 || offset.y !== 0) {
                    this.collisionOffsets.set(shortcut.id, offset);
                }
            }
            this.addFreeformShortcutToDOM(shortcut);
        });
        
        // Clear cache after rendering
        this.notesMetadataCache = null;
        this.updateSelectionVisuals();
    }

    // --- Multi-select ---

    setupSelectionHandlers() {
        if (!this.desktopContainer || this.desktopContainer.dataset.selectionWired === 'true') {
            return;
        }
        this.desktopContainer.dataset.selectionWired = 'true';

        this.desktopContainer.addEventListener('mousedown', (e) => this.handleDesktopMarqueeStart(e));
        this.freeformContainer?.addEventListener('contextmenu', (e) => {
            this._lastDesktopContextCoords = { x: e.clientX, y: e.clientY };
        });

        document.addEventListener('keydown', (e) => {
            if (!document.body.classList.contains('desktop-mode')) return;
            if (!this.selectedShortcutIds.size) return;
            if (this._isEditableShortcutTarget(e.target) || this._isEditableShortcutTarget(document.activeElement)) return;
            if (!this._isDesktopKeyboardFocused(e)) return;
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            e.preventDefault();
            this.removeSelectedShortcuts();
        });
    }

    _isEditableShortcutTarget(el) {
        if (!el || el === document.body || el === document.documentElement) return false;
        if (el.matches?.('input, textarea, select')) return true;
        if (el.isContentEditable) return true;
        return !!el.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
    }

    _isDesktopKeyboardFocused(ev) {
        const inDesktop = (el) => el && (
            this.desktopContainer?.contains(el) ||
            this.freeformContainer?.contains(el)
        );
        if (inDesktop(ev.target)) return true;
        return inDesktop(document.activeElement);
    }

    getAllShortcutElements() {
        const elements = [];
        if (this.gridContainer) {
            elements.push(...this.gridContainer.querySelectorAll('.desktop-shortcut:not(.desktop-drop-placeholder)'));
        }
        if (this.freeformContainer) {
            elements.push(...this.freeformContainer.querySelectorAll('.desktop-shortcut'));
        }
        return elements;
    }

    rectsIntersect(a, b) {
        return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
    }

    getShortcutIdsInRect(rect) {
        const ids = [];
        this.getAllShortcutElements().forEach((el) => {
            if (this.rectsIntersect(rect, el.getBoundingClientRect())) {
                ids.push(el.dataset.shortcutId);
            }
        });
        return ids;
    }

    selectShortcut(shortcutId, add = false) {
        if (!shortcutId) return;
        if (!add) {
            this.selectedShortcutIds.clear();
        }
        this.selectedShortcutIds.add(shortcutId);
        this.updateSelectionVisuals();
    }

    toggleShortcutSelection(shortcutId) {
        if (!shortcutId) return;
        if (this.selectedShortcutIds.has(shortcutId)) {
            this.selectedShortcutIds.delete(shortcutId);
        } else {
            this.selectedShortcutIds.add(shortcutId);
        }
        this.updateSelectionVisuals();
    }

    clearSelection() {
        if (!this.selectedShortcutIds.size) return;
        this.selectedShortcutIds.clear();
        this.updateSelectionVisuals();
    }

    updateSelectionVisuals() {
        this.getAllShortcutElements().forEach((el) => {
            const isSelected = this.selectedShortcutIds.has(el.dataset.shortcutId);
            el.classList.toggle('selected', isSelected);
            el.dataset.selected = isSelected ? 'true' : 'false';
        });
        this.desktopContainer?.classList.toggle('desktop-has-selection', this.selectedShortcutIds.size > 0);
    }

    getSelectedShortcuts() {
        return this.shortcuts.filter((s) => this.selectedShortcutIds.has(s.id));
    }

    getSelectedCount() {
        return this.selectedShortcutIds.size;
    }

    isShortcutSelected(shortcutId) {
        return this.selectedShortcutIds.has(shortcutId);
    }

    ensureSelectionMarqueeEl() {
        if (this.selectionMarqueeEl) return this.selectionMarqueeEl;
        this.selectionMarqueeEl = document.createElement('div');
        this.selectionMarqueeEl.className = 'desktop-selection-marquee hidden';
        document.body.appendChild(this.selectionMarqueeEl);
        return this.selectionMarqueeEl;
    }

    handleDesktopMarqueeStart(event) {
        if (!document.body.classList.contains('desktop-mode')) return;
        if (event.button !== 0) return;
        if (event.target.closest('.desktop-shortcut, .modal, #desktopTaskbar, #startMenu')) return;

        const isDesktopSurface =
            event.target === this.desktopContainer ||
            event.target === this.freeformContainer ||
            event.target === this.gridContainer;
        if (!isDesktopSurface) return;

        const addToSelection = event.ctrlKey || event.metaKey;
        if (!addToSelection) {
            this.clearSelection();
        }

        const startX = event.clientX;
        const startY = event.clientY;
        const marqueeEl = this.ensureSelectionMarqueeEl();
        const baseSelection = addToSelection ? new Set(this.selectedShortcutIds) : new Set();

        marqueeEl.classList.remove('hidden');
        marqueeEl.style.left = `${startX}px`;
        marqueeEl.style.top = `${startY}px`;
        marqueeEl.style.width = '0px';
        marqueeEl.style.height = '0px';

        this.marqueeState = { startX, startY, addToSelection, baseSelection };
        document.body.classList.add('desktop-marquee-active');

        const moveHandler = (e) => this.handleDesktopMarqueeMove(e, moveHandler, endHandler);
        const endHandler = (e) => this.handleDesktopMarqueeEnd(e, moveHandler, endHandler);

        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', endHandler);
        event.preventDefault();
    }

    handleDesktopMarqueeMove(event, moveHandler, endHandler) {
        if (!this.marqueeState) return;

        const { startX, startY, addToSelection, baseSelection } = this.marqueeState;
        const left = Math.min(startX, event.clientX);
        const top = Math.min(startY, event.clientY);
        const width = Math.abs(event.clientX - startX);
        const height = Math.abs(event.clientY - startY);

        const marqueeEl = this.selectionMarqueeEl;
        if (marqueeEl) {
            marqueeEl.style.left = `${left}px`;
            marqueeEl.style.top = `${top}px`;
            marqueeEl.style.width = `${width}px`;
            marqueeEl.style.height = `${height}px`;
        }

        if (width < 4 && height < 4) return;

        const rect = { left, top, right: left + width, bottom: top + height };
        const boxIds = this.getShortcutIdsInRect(rect);

        if (addToSelection) {
            this.selectedShortcutIds = new Set(baseSelection);
            boxIds.forEach((id) => this.selectedShortcutIds.add(id));
        } else {
            this.selectedShortcutIds = new Set(boxIds);
        }
        this.updateSelectionVisuals();
    }

    handleDesktopMarqueeEnd(event, moveHandler, endHandler) {
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', endHandler);
        document.body.classList.remove('desktop-marquee-active');

        if (this.selectionMarqueeEl) {
            this.selectionMarqueeEl.classList.add('hidden');
            this.selectionMarqueeEl.style.width = '0px';
            this.selectionMarqueeEl.style.height = '0px';
        }
        this.marqueeState = null;
    }

    async removeSelectedShortcuts() {
        const ids = [...this.selectedShortcutIds];
        if (!ids.length) return;

        const selected = ids.map(id => this.shortcuts.find(s => s.id === id)).filter(Boolean);
        const folders = selected.filter(s => s.type === 'folder');
        const shortcuts = selected.filter(s => s.type !== 'folder');
        const count = ids.length;

        let message;
        let confirmLabel;
        if (folders.length && shortcuts.length) {
            message = `Remove ${shortcuts.length} item(s) and delete ${folders.length} folder(s)? Folder contents may be permanently deleted.`;
            confirmLabel = 'Confirm';
        } else if (folders.length === 1 && !shortcuts.length) {
            message = this.getFolderDeleteConfirmMessage(folders[0]);
            confirmLabel = 'Delete';
        } else if (folders.length > 1 && !shortcuts.length) {
            message = `Delete ${folders.length} folders and their contents? This cannot be undone.`;
            confirmLabel = 'Delete';
        } else if (count === 1) {
            message = `Remove "${selected[0].name}"?`;
            confirmLabel = 'Remove';
        } else {
            message = `Remove ${count} items from the desktop?`;
            confirmLabel = 'Remove';
        }

        const confirmed = await showConfirmationDialog(
            message,
            [
                { text: confirmLabel, value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );

        if (!confirmed) return;

        for (const id of ids) {
            const shortcut = this.shortcuts.find(s => s.id === id);
            if (shortcut?.type === 'folder') {
                await this.deleteFolderShortcut(id);
            } else {
                await this.removeShortcut(id);
            }
        }
        this.clearSelection();
    }

    async moveSelectedShortcutsToWorkspace(targetWorkspaceId) {
        const ids = [...this.selectedShortcutIds];
        if (!ids.length) return;

        let moved = 0;
        for (const id of ids) {
            try {
                await this.moveShortcutToWorkspace(id, targetWorkspaceId, true);
                moved++;
            } catch (error) {
                // moveShortcutToWorkspace already toasts errors
            }
        }
        this.clearSelection();

        if (moved > 0) {
            const wsName = workspaces[targetWorkspaceId]?.name || targetWorkspaceId;
            const message = moved === 1
                ? `Shortcut moved to ${wsName}`
                : `${moved} shortcuts moved to ${wsName}`;
            showGlassToast('success', null, message, false, 3000, '<i class="fas fa-arrow-right"></i>');
        }
    }

    getFolderDeleteConfirmMessage(shortcut) {
        const vfsFolderId = shortcut?.data?.vfsFolderId;
        const nestedCount = vfsFolderId
            ? this.shortcuts.filter(s => s.folderId === vfsFolderId && !s._isDeleted).length
            : 0;
        const name = shortcut?.name || 'this folder';
        if (nestedCount > 0) {
            return `Delete folder "${name}" and the ${nestedCount} item(s) inside? Any files stored in this folder will also be permanently deleted.`;
        }
        return `Delete folder "${name}"? Any files or items stored inside will be permanently deleted.`;
    }

    async _purgeVfsFolderContents(folderListPath) {
        if (!folderListPath || !wsClient?.isConnected()) return;

        let listing;
        try {
            listing = await vfsClient.listDirectory(folderListPath);
        } catch (err) {
            console.warn('Could not list folder for delete:', err);
            return;
        }

        const items = listing?.items || [];
        for (const item of items) {
            const targetKind = item.targetKind || item.kind;
            if (targetKind === 'vfs-folder' || item.kind === 'folder') {
                const subId = item.targetId || item.id;
                const subPath = item.navPath || `${folderListPath.replace(/\/+$/, '')}/${subId}`;
                await this._purgeVfsFolderContents(subPath);
                try {
                    await vfsClient.deleteFolder(subId);
                } catch (err) {
                    console.error('Failed to delete subfolder:', subId, err);
                    throw err;
                }
            } else if (targetKind === 'user-file') {
                await wsClient.sendMessage('vfs_delete_file', { fileId: item.targetId || item.id });
            } else if (item.isDesktopShortcut && item.id) {
                const exists = this.shortcuts.find(s => s.id === item.id && !s._isDeleted);
                if (exists) await this.removeShortcut(item.id);
            } else if (item.isShortcut && item.id) {
                await vfsClient.deleteEntry(item.id);
            }
        }
    }

    async purgeVfsFolderByPath(folderListPath, folderId) {
        if (!folderId) throw new Error('Folder id required');
        await this._purgeVfsFolderContents(folderListPath);
        await vfsClient.deleteFolder(folderId);
    }

    async deleteFolderShortcut(shortcutId) {
        const shortcut = this.shortcuts.find(s => s.id === shortcutId);
        if (!shortcut || shortcut.type !== 'folder') {
            throw new Error('Not a folder shortcut');
        }

        const vfsFolderId = shortcut.data?.vfsFolderId;
        const workspaceId = this.currentWorkspace;

        if (vfsFolderId && workspaceId && wsClient?.isConnected()) {
            const nested = this.shortcuts.filter(s => s.folderId === vfsFolderId && !s._isDeleted && s.id !== shortcutId);
            for (const nestedShortcut of nested) {
                await this.removeShortcut(nestedShortcut.id);
            }

            const listPath = `/Workspaces/${workspaceId}/Desktop/${vfsFolderId}`;
            await this.purgeVfsFolderByPath(listPath, vfsFolderId);
        }

        await this.removeShortcut(shortcutId);
    }

    getShortcutPermanentDeleteItems(shortcut) {
        if (!shortcut?.type) return [];
        switch (shortcut.type) {
            case 'image':
                return [
                    { separator: true },
                    {
                        icon: 'fas fa-fire',
                        text: 'Incinerate',
                        action: 'incinerate-shortcut-target',
                        className: 'context-menu-item-danger'
                    }
                ];
            case 'note':
                return [
                    { separator: true },
                    {
                        icon: 'fas fa-trash',
                        text: 'Delete Note',
                        action: 'delete-note-shortcut-target',
                        className: 'context-menu-item-danger'
                    }
                ];
            case 'reference':
                return [
                    { separator: true },
                    {
                        icon: 'fas fa-fire',
                        text: 'Destroy',
                        action: 'destroy-reference-shortcut-target',
                        className: 'context-menu-item-danger'
                    }
                ];
            default:
                return [];
        }
    }

    async permanentlyDeleteShortcutTarget(shortcut) {
        if (!shortcut?.type) return;

        switch (shortcut.type) {
            case 'image': {
                const filename = shortcut.data?.filename;
                if (!filename) throw new Error('No filename for image shortcut');
                let image = null;
                if (typeof allImages !== 'undefined' && allImages.length > 0) {
                    image = allImages.find(img =>
                        img.filename === filename || img.original === filename || img.upscaled === filename
                    );
                }
                if (image && typeof deleteImage === 'function') {
                    deleteImage(image);
                } else if (wsClient?.deleteImagesBulk) {
                    const result = await wsClient.deleteImagesBulk([filename]);
                    if (!result?.successful) throw new Error('Failed to delete image');
                }
                if (typeof loadGallery === 'function') loadGallery(true);
                break;
            }
            case 'note': {
                const noteId = shortcut.data?.noteId;
                if (!noteId) throw new Error('No note id for note shortcut');
                if (notepadManager?.notebookDeleteNote) {
                    await notepadManager.notebookDeleteNote(noteId);
                } else {
                    const response = await wsClient.deleteNote(noteId);
                    if (!response?.success) throw new Error('Failed to delete note');
                }
                break;
            }
            case 'reference': {
                const hash = shortcut.data?.hash;
                const wsId = shortcut.data?.workspaceId || activeWorkspace || 'default';
                if (!hash) throw new Error('No reference hash for reference shortcut');
                let cacheImage = null;
                if (Array.isArray(cacheImages) && cacheImages.length) {
                    cacheImage = cacheImages.find(img => img.hash === hash);
                }
                if (!cacheImage) {
                    cacheImage = {
                        hash,
                        filename: shortcut.data?.filename || shortcut.name || hash,
                        hasPreview: true,
                        preview: shortcut.data?.preview,
                        isStandalone: !!shortcut.data?.isStandalone,
                        hasVibes: !!shortcut.data?.hasVibes,
                        workspaceId: wsId
                    };
                }
                const deleteType = (cacheImage.hasVibes && !cacheImage.isStandalone) ? 'both' : 'base';
                // public/scripts/comp/referenceManager.js deleteReferenceImage
                await deleteReferenceImage(cacheImage, wsId, async () => {
                    if (typeof refreshReferenceBrowserIfOpen === 'function') await refreshReferenceBrowserIfOpen();
                }, deleteType);
                break;
            }
            default:
                return;
        }

        await this.removeShortcut(shortcut.id);
    }

    getShortcutManagementMenuItems(leadingSeparator = false) {
        const items = [];
        if (leadingSeparator) {
            items.push({ separator: true });
        }
        items.push(
            {
                icon: 'fas fa-pen',
                text: 'Rename',
                action: 'rename-shortcut'
            },
            {
                icon: 'fas fa-arrow-right',
                text: 'Move to...',
                optionsfn: () => this.getWorkspaceSubmenuItems(),
                loadfn: (item) => {
                    item.disabled = this.getWorkspaceSubmenuItems().length === 0;
                }
            },
            {
                icon: 'fas fa-trash',
                text: 'Remove',
                action: 'remove-shortcut',
                className: 'context-menu-item-danger'
            }
        );
        return items;
    }

    getBulkContextMenu() {
        const count = this.getSelectedCount();
        return {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'fas fa-folder-plus',
                            text: count > 1 ? `Create folder from ${count} items` : 'Create folder from selection',
                            action: 'create-folder-from-selection'
                        },
                        {
                            icon: 'fas fa-arrow-right',
                            text: count > 1 ? `Move ${count} items to...` : 'Move to...',
                            optionsfn: () => this.getWorkspaceSubmenuItems(),
                            loadfn: (item) => {
                                item.disabled = this.getWorkspaceSubmenuItems().length === 0;
                            }
                        },
                        {
                            icon: 'fas fa-trash',
                            text: count > 1 ? `Remove ${count} items` : 'Remove',
                            action: 'remove-shortcut',
                            className: 'context-menu-item-danger'
                        }
                    ]
                }
            ]
        };
    }

    prepareDragGroup(primaryElement, primaryShortcut) {
        const containerRect = this.freeformContainer.getBoundingClientRect();
        const dragIds = this.selectedShortcutIds.has(primaryShortcut.id) && this.selectedShortcutIds.size > 1
            ? [...this.selectedShortcutIds]
            : [primaryShortcut.id];

        if (dragIds.length === 1 && !this.selectedShortcutIds.has(primaryShortcut.id)) {
            this.selectShortcut(primaryShortcut.id);
        }

        this.dragGroup = dragIds.map((id) => {
            const shortcut = this.shortcuts.find((s) => s.id === id);
            const element = this.gridContainer?.querySelector(`[data-shortcut-id="${id}"]`)
                || this.freeformContainer?.querySelector(`[data-shortcut-id="${id}"]`);
            if (!shortcut || !element) return null;

            const wasInGrid = element.parentElement === this.gridContainer;
            const rect = element.getBoundingClientRect();
            return {
                element,
                shortcut,
                startX: rect.left - containerRect.left,
                startY: rect.top - containerRect.top,
                wasInGrid
            };
        }).filter(Boolean);

        const primaryEntry = this.dragGroup.find((item) => item.element === primaryElement);
        if (primaryEntry) {
            this.primaryDragStart = { x: primaryEntry.startX, y: primaryEntry.startY };
        }
    }

    convertDragGroupToFreeform() {
        if (!this.dragGroup || !this.freeformContainer) return;

        const containerRect = this.freeformContainer.getBoundingClientRect();
        this.dragGroup.forEach((item) => {
            if (item.wasInGrid) {
                this.freeformContainer.appendChild(item.element);
                item.element.style.position = 'absolute';
            }
            item.element.style.left = `${item.startX}px`;
            item.element.style.top = `${item.startY}px`;
            item.element.classList.add('dragging');
        });
    }

    updateDragGroupPositions(primaryX, primaryY) {
        if (!this.dragGroup) return;

        const deltaX = primaryX - this.primaryDragStart.x;
        const deltaY = primaryY - this.primaryDragStart.y;
        const containerRect = this.freeformContainer.getBoundingClientRect();

        this.dragGroup.forEach((item) => {
            let newX = item.startX + deltaX;
            let newY = item.startY + deltaY;
            const elementRect = item.element.getBoundingClientRect();
            newX = Math.max(0, Math.min(newX, containerRect.width - elementRect.width));
            newY = Math.max(0, Math.min(newY, containerRect.height - elementRect.height));
            item.element.style.left = `${newX}px`;
            item.element.style.top = `${newY}px`;
        });
    }

    // Add a grid shortcut to the DOM (index 0)
    addGridShortcutToDOM(shortcut) {
        if (!this.gridContainer) return;

        const shortcutElement = this.createShortcutElement(shortcut, true);
        this.gridContainer.appendChild(shortcutElement);

        // Attach context menu
        this.attachShortcutContextMenu(shortcutElement, shortcut);
    }
    
    // Add a freeform shortcut to the DOM (index 1-4)
    addFreeformShortcutToDOM(shortcut) {
        if (!this.freeformContainer) return;

        const shortcutElement = this.createShortcutElement(shortcut, false);
        this.freeformContainer.appendChild(shortcutElement);

        // Attach context menu
        this.attachShortcutContextMenu(shortcutElement, shortcut);
    }

    // Create a shortcut element
    createShortcutElement(shortcut, isGrid) {
        const element = document.createElement('div');
        element.className = 'desktop-shortcut';
        element.dataset.shortcutId = shortcut.id;
        element.dataset.shortcutType = shortcut.type;

        if (isGrid) {
            // Grid mode - no positioning needed, flex handles it
            element.classList.add('in-grid');
            // Store grid position for reordering
            element.dataset.gridPos = shortcut.position.pos || 0;
        } else {
            // Freeform mode - calculate and set percentage-based position
            const pixelPos = this.calculateQuadrantPixelPosition(shortcut);
            if (pixelPos) {
                // Apply collision offset if exists
                const offset = this.collisionOffsets.get(shortcut.id) || { x: 0, y: 0 };
                
                // Convert to percentage for responsive positioning
                const containerRect = this.freeformContainer.getBoundingClientRect();
                const leftPercent = ((pixelPos.x + offset.x) / containerRect.width) * 100;
                const topPercent = ((pixelPos.y + offset.y) / containerRect.height) * 100;
                
                element.style.left = `${leftPercent}%`;
                element.style.top = `${topPercent}%`;
                
                // Store quadrant index
                element.dataset.quadrant = shortcut.position.index;
            }
        }

        // Add label first (will be after icon in DOM due to prepend below)
        const label = document.createElement('div');
        label.className = 'desktop-shortcut-label';
        label.textContent = shortcut.name;
        element.appendChild(label);

        // Create icon based on type
        const typeHandler = this.shortcutTypes[shortcut.type];
        if (typeHandler && typeHandler.icon) {
            const iconResult = typeHandler.icon.call(this, shortcut);
            // Handle async icon creation - prepend before label
            if (iconResult instanceof Promise) {
                iconResult.then(icon => {
                    if (icon) element.insertBefore(icon, label);
                });
            } else {
                element.insertBefore(iconResult, label);
            }
        } else {
            // Default icon - prepend before label
            const defaultIcon = document.createElement('div');
            defaultIcon.className = 'desktop-shortcut-icon';
            defaultIcon.innerHTML = '<i class="fas fa-file"></i>';
            element.insertBefore(defaultIcon, label);
        }

        // Add double-click handler (prevents conflict with dragging)
        element.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleShortcutClick(shortcut);
        });

        element.addEventListener('contextmenu', () => {
            if (!this.isShortcutSelected(shortcut.id)) {
                this.selectShortcut(shortcut.id);
            }
        });

        // Add drag handlers
        element.addEventListener('mousedown', (e) => this.handleDragStart(e, shortcut));
        element.addEventListener('touchstart', (e) => this.handleDragStart(e, shortcut), { passive: false });
        
        // Store shortcut data for drag-to-manual detection
        element.dataset.shortcutData = JSON.stringify({
            type: shortcut.type,
            data: shortcut.data
        });

        return element;
    }

    // Create image icon
    createImageIcon(shortcut) {
        // Frame container
        const frame = document.createElement('div');
        frame.className = 'desktop-shortcut-icon desktop-shortcut-icon-image';

        // Preview image as background
        const imagePreview = document.createElement('div');
        imagePreview.className = 'desktop-shortcut-image-preview';
        
        if (shortcut.data && shortcut.data.preview) {
            // Use the preview filename with proper URL construction
            const previewUrl = typeof getGalleryPreviewUrl === 'function' 
                ? getGalleryPreviewUrl(shortcut.data.preview)
                : shortcut.data.preview;
            imagePreview.style.backgroundImage = `url('/previews/${encodeURIComponent(previewUrl)}')`;
        } else if (shortcut.data && shortcut.data.filename) {
            // Fallback to full image if preview not available
            imagePreview.style.backgroundImage = `url('/images/${shortcut.data.filename}')`;
        }

        // Flare holder for overlay effect
        const flareHolder = document.createElement('div');
        flareHolder.className = 'desktop-shortcut-flare-holder';

        // Icon overlay
        const imageIcon = document.createElement('i');
        imageIcon.className = 'fas fa-image desktop-shortcut-image-icon';

        // Build structure: frame > preview > flare > icon
        flareHolder.appendChild(imageIcon);
        imagePreview.appendChild(flareHolder);
        frame.appendChild(imagePreview);

        return frame;
    }

    // Handle shortcut click
    handleShortcutClick(shortcut) {
        const typeHandler = this.shortcutTypes[shortcut.type];
        if (typeHandler && typeHandler.onClick) {
            typeHandler.onClick.call(this, shortcut);
        }
    }

    // Handle image shortcut click
    async handleImageClick(shortcut) {
        if (!shortcut.data || !shortcut.data.filename) {
            console.error('Image shortcut missing filename');
            return;
        }

        // Open image preview modal (windowed)
        try {
            const filename = shortcut.data.filename;
            
            // Try to find in gallery images first for full metadata
            let imageData = null;
            if (allImages && allImages.length > 0) {
                imageData = allImages.find(img => 
                    img.filename === filename || 
                    img.original === filename || 
                    img.upscaled === filename
                );
            }
            
            if (imageData) {
                // Open with full gallery metadata
                openGalleryImageInViewer(imageData);
            } else if (wsClient && wsClient.isConnected()) {
                // Image not in gallery, fetch metadata and open viewer
                try {
                    const metadata = await wsClient.requestImageMetadata(filename);
                    if (metadata) {
                        // Create image object from metadata
                        const imageObj = {
                            filename: filename,
                            original: filename,
                            width: metadata.width,
                            height: metadata.height,
                            ...metadata
                        };
                        openGalleryImageInViewer(imageObj);
                    } else {
                        // Fallback to basic viewer
                        openImageInViewer(`/images/${filename}`, filename);
                    }
                } catch (error) {
                    console.warn('Failed to get metadata, opening with defaults:', error);
                    openImageInViewer(`/images/${filename}`, filename);
                }
            } else {
                // No WebSocket, open with basic viewer
                openImageInViewer(`/images/${filename}`, filename);
            }
        } catch (error) {
            console.error('Failed to open image preview:', error);
        }
    }

    // Create note icon (retrieves icon and color from note)
    async createNoteIcon(shortcut) {
        // Just the icon, no wrapper or frame (like applet)
        const icon = document.createElement('div');
        icon.className = 'desktop-shortcut-icon desktop-shortcut-icon-note';
        
        // Retrieve note data to get current icon and color
        let noteIcon = 'fas fa-file-lines';
        let noteColor = '#ffc107';
        
        if (shortcut.data && shortcut.data.noteId) {
            // Try to use render cache first (available during renderShortcuts)
            if (this.notesMetadataCache && this.notesMetadataCache.has(shortcut.data.noteId)) {
                const cached = this.notesMetadataCache.get(shortcut.data.noteId);
                noteIcon = cached.icon;
                noteColor = cached.color;
            } else {
                // Use notepadManager's global cache
                const cached = await window.notepadManager?.getNoteMetadata(null, shortcut.data.noteId);
                if (cached) {
                    noteIcon = cached.icon;
                    noteColor = cached.color;
                }
            }
        }
        
        // Apply color
        icon.style.color = noteColor;
        
        // Create FontAwesome icon
        const noteIconElement = document.createElement('i');
        noteIconElement.className = noteIcon;
        
        icon.appendChild(noteIconElement);
        return icon;
    }

    // Handle note shortcut click
    async handleNoteClick(shortcut) {
        if (!shortcut.data || !shortcut.data.noteId) {
            console.error('Note shortcut missing noteId in data');
            return;
        }

        // Open notepad (individual window)
        if (typeof notepadManager !== 'undefined') {
            await notepadManager.openExistingNote(shortcut.data.noteId);
        } else {
            console.error('Notepad manager not available');
        }
    }

    // Handle opening note in notebook view
    async handleNoteOpenInNotebook(shortcut) {
        if (!shortcut.data || !shortcut.data.noteId) {
            console.error('Note shortcut missing noteId in data');
            return;
        }

        // Open notebook and load this specific note
        if (typeof notepadManager !== 'undefined' && typeof notepadManager.openNotebook === 'function') {
            await notepadManager.openNotebook();
            // Wait a moment for the notebook to open, then load the note
            setTimeout(async () => {
                if (typeof notepadManager.notebookLoadNote === 'function') {
                    await notepadManager.notebookLoadNote(shortcut.data.noteId, false);
                }
            }, 100);
        } else {
            console.error('Notebook functionality not available');
            // Fallback to regular notepad
            if (typeof notepadManager !== 'undefined') {
                await notepadManager.openExistingNote(shortcut.data.noteId);
            }
        }
    }

    // Get note context menu
    getNoteContextMenu(shortcut) {
        return {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'fas fa-folder-open',
                            text: 'Open',
                            action: 'open-note'
                        },
                        {
                            icon: 'fas fa-book',
                            text: 'Open in Notion',
                            action: 'open-note-in-notebook'
                        },
                        ...this.getShortcutManagementMenuItems(true, shortcut)
                    ]
                }
            ],
            onAction: async (action, target, item) => {
                switch (action) {
                    case 'open-note':
                        await this.handleNoteClick(shortcut);
                        break;
                    case 'open-note-in-notebook':
                        await this.handleNoteOpenInNotebook(shortcut);
                        break;
                    default:
                        document.dispatchEvent(new CustomEvent('contextMenuAction', {
                            detail: { action, target, item }
                        }));
                }
            }
        };
    }

    // Create reference icon
    createReferenceIcon(shortcut) {
        // Frame container
        const frame = document.createElement('div');
        frame.className = 'desktop-shortcut-icon desktop-shortcut-icon-image';

        // Preview image as background
        const imagePreview = document.createElement('div');
        imagePreview.className = 'desktop-shortcut-image-preview';
        
        if (shortcut.data && shortcut.data.hash) {
            // References use /cache/preview/{hash}.webp or /cache/preview/{preview}
            if (shortcut.data.preview) {
                // If preview is provided (standalone vibes), use it
                imagePreview.style.backgroundImage = `url('/cache/preview/${shortcut.data.preview}')`;
            } else {
                // Otherwise use hash.webp (regular cache images)
                imagePreview.style.backgroundImage = `url('/cache/preview/${shortcut.data.hash}.webp')`;
            }
        }

        // Flare holder for overlay effect
        const flareHolder = document.createElement('div');
        flareHolder.className = 'desktop-shortcut-flare-holder';

        // Icon overlay based on reference type
        const refIcon = document.createElement('i');
        const refType = shortcut.data && shortcut.data.refType ? shortcut.data.refType : 'base';
        
        switch (refType) {
            case 'vibe':
                refIcon.className = 'nai-vibe-transfer desktop-shortcut-image-icon';
                break;
            case 'character':
                refIcon.className = 'nai-precise-reference desktop-shortcut-image-icon';
                break;
            case 'base':
            default:
                refIcon.className = 'nai-img2img desktop-shortcut-image-icon';
                break;
        }

        // Build structure: frame > preview > flare > icon
        flareHolder.appendChild(refIcon);
        imagePreview.appendChild(flareHolder);
        frame.appendChild(imagePreview);

        return frame;
    }

    // Handle reference shortcut click
    async handleReferenceClick(shortcut) {
        if (!shortcut.data || !shortcut.data.hash) {
            console.error('Reference shortcut missing hash');
            return;
        }

        const hash = shortcut.data.hash;

        try {
            // Ensure references are loaded
            if (typeof cacheImages === 'undefined' || !Array.isArray(cacheImages) || cacheImages.length === 0) {
                console.log('Loading references...');
                if (typeof loadCacheImages === 'function') {
                    await loadCacheImages();
                } else {
                    console.error('loadCacheImages function not available');
                    showGlassToast('error', 'Error', 'Reference system not ready', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                    return;
                }
            }
            
            // Find the full cache image from global cacheImages array
            let cacheImage = null;
            if (typeof cacheImages !== 'undefined' && Array.isArray(cacheImages)) {
                cacheImage = cacheImages.find(img => img.hash === hash);
            }
            
            // If not found in cache, construct minimal object from stored data
            if (!cacheImage && shortcut.data) {
                // shortcut.data.preview is now always a string (e.g., "hash.webp" or "abc123.webp")
                // For the minimal object, set hasPreview to match what the system expects
                const hasPreviewValue = shortcut.data.preview 
                    ? (shortcut.data.isStandalone ? shortcut.data.preview : true)
                    : false;
                
                cacheImage = {
                    hash: shortcut.data.hash,
                    filename: shortcut.data.filename,
                    hasPreview: hasPreviewValue,
                    preview: shortcut.data.preview, // Keep the string preview for standalone vibes
                    isStandalone: shortcut.data.isStandalone,
                    hasVibes: shortcut.data.hasVibes,
                    workspaceId: shortcut.data.workspaceId
                };
                console.warn('Reference not found in cache, using stored shortcut data for preview:', hash);
            }
            
            if (!cacheImage) {
                console.error('Reference not found and no stored data:', hash);
                showGlassToast('error', 'Error', 'Reference not found', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                return;
            }
            
            // Open reference preview in window with cache image data
            openReferenceImageInViewer(cacheImage);
        } catch (error) {
            console.error('Failed to open reference preview:', error);
            showGlassToast('error', 'Error', 'Failed to open reference', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }

    // Get reference context menu
    getReferenceContextMenu(shortcut) {
        return {
            sections: [
                {
                    type: 'list',
                    items: this.getShortcutManagementMenuItems(false, shortcut)
                }
            ]
        };
    }

    // Create applet icon
    createAppletIcon(shortcut) {
        // Just the icon, no wrapper or frame
        const icon = document.createElement('div');
        icon.className = 'desktop-shortcut-icon';
        
        // Get the applet config to check for imageIcon
        const applet = this.findAppletById(shortcut.data.launchId);
        const hasImageIcon = applet && applet.imageIcon;
        
        // Render Font Awesome icon (add icon-fa class if there's an imageIcon)
        if (shortcut.data.icon) {
            const appletIcon = document.createElement('i');
            appletIcon.className = hasImageIcon ? `${shortcut.data.icon} icon-fa` : shortcut.data.icon;
            icon.appendChild(appletIcon);
        }
        
        // Render image icon if available
        if (hasImageIcon && applet.imageIcon) {
            const imageIcon = document.createElement('img');
            const imagePath = applet.imageIcon.startsWith('/') ? applet.imageIcon : `/static_images/app_icons/${applet.imageIcon}`;
            imageIcon.src = imagePath;
            imageIcon.className = 'icon-image';
            imageIcon.alt = '';
            icon.appendChild(imageIcon);
        }
        
        return icon;
    }

    // Handle applet shortcut click
    handleAppletClick(shortcut) {
        if (!shortcut.data || !shortcut.data.launchId) {
            console.error('Applet shortcut missing launch ID');
            return;
        }

        // Find the applet in start menu config and trigger its action
        const applet = this.findAppletById(shortcut.data.launchId);
        if (applet && applet.action) {
            applet.action();
        } else {
            console.error('Applet not found or has no action:', shortcut.data.launchId);
            showGlassToast('error', 'Error', 'Applet not available', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }

    createBracketGenerationIcon(shortcut) {
        const icon = document.createElement('div');
        icon.className = 'desktop-shortcut-icon';

        const faIcon = document.createElement('i');
        faIcon.className = 'fas fa-layer-group icon-fa';
        icon.appendChild(faIcon);

        const imageIcon = document.createElement('img');
        imageIcon.src = '/static_images/app_icons/stack.png';
        imageIcon.className = 'icon-image';
        imageIcon.alt = '';
        icon.appendChild(imageIcon);

        return icon;
    }

    getBracketGenerationContextMenu(shortcut) {
        return {
            sections: [
                {
                    type: 'list',
                    items: this.getShortcutManagementMenuItems(false, shortcut)
                }
            ]
        };
    }

    handleBracketGenerationClick(shortcut) {
        if (!shortcut.data || !shortcut.data.state) {
            showGlassToast('error', null, 'Phasewalker shortcut has no saved state', false, 4000);
            return;
        }
        const manualModal = document.getElementById('manualModal');
        const editorOpen = manualModal && !manualModal.classList.contains('hidden');
        if (window.bracketGenerationApplet) {
            window.bracketGenerationApplet.open({
                state: shortcut.data.state,
                autoCompile: editorOpen,
                desktopShortcut: { id: shortcut.id, name: shortcut.name }
            });
        } else {
            showGlassToast('error', null, 'Phasewalker not available', false, 4000);
        }
    }

    createFolderIcon() {
        const icon = document.createElement('div');
        icon.className = 'desktop-shortcut-icon';
        icon.innerHTML = '<i class="fas fa-folder"></i>';
        return icon;
    }

    handleFolderClick(shortcut) {
        const wsId = this.currentWorkspace;
        const vfsFolderId = shortcut.data?.vfsFolderId;
        if (!wsId || !vfsFolderId) return;
        openExplorerApplet(`/Workspaces/${wsId}/Desktop/${vfsFolderId}`);
    }

    getFolderContextMenu() {
        return {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'fas fa-folder-open',
                            text: 'Open',
                            action: 'open-folder-shortcut'
                        },
                        {
                            icon: 'fas fa-i-cursor',
                            text: 'Rename',
                            action: 'rename-shortcut'
                        },
                        { separator: true },
                        {
                            icon: 'fas fa-trash',
                            text: 'Delete Folder',
                            action: 'delete-folder-shortcut',
                            className: 'context-menu-item-danger'
                        }
                    ]
                }
            ]
        };
    }

    getContextMenuPosition() {
        if (this._lastDesktopContextCoords && this.freeformContainer) {
            const rect = this.freeformContainer.getBoundingClientRect();
            const x = this._lastDesktopContextCoords.x - rect.left;
            const y = this._lastDesktopContextCoords.y - rect.top;
            return this.pixelToPositionData(x, y, rect);
        }
        return this.getNextAvailablePosition();
    }

    getShortcutUnderPoint(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY)?.closest('.desktop-shortcut:not(.desktop-drop-placeholder)');
        if (!el) return null;
        const id = el.dataset.shortcutId;
        return this.shortcuts.find(s => s.id === id) || null;
    }

    getFolderShortcutUnderPoint(clientX, clientY) {
        const shortcut = this.getShortcutUnderPoint(clientX, clientY);
        if (shortcut && shortcut.type === 'folder') return shortcut;
        return null;
    }

    clearFolderHoldTimer() {
        if (this.folderHoldTimer) {
            clearTimeout(this.folderHoldTimer);
            this.folderHoldTimer = null;
        }
        this.folderHoldTarget = null;
    }

    async createEmptyFolder(options = {}) {
        const workspaceId = this.currentWorkspace;
        if (!workspaceId || !wsClient?.isConnected()) return;

        const position = options.position || this.getNextAvailablePosition();
        try {
            const resp = await vfsClient.createDesktopEmptyFolder(workspaceId, position, options.name || 'New Folder');
            if (!resp.success) return;

            if (resp.shortcut) {
                const exists = this.shortcuts.find(s => s.id === resp.shortcut.id);
                if (!exists) this.shortcuts.push(resp.shortcut);
            }
            this.renderShortcuts();

            const shortcutId = resp.shortcutId || resp.shortcut?.id;
            if (shortcutId) {
                const newName = await showInputDialog(
                    'New Folder',
                    'New Folder',
                    'Enter folder name',
                    [
                        { text: 'Create', value: true, className: 'btn-primary' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ]
                );
                if (newName && newName.trim()) {
                    await this.renameShortcut(shortcutId, newName.trim());
                    if (resp.folderId) {
                        await vfsClient.renameFolder(resp.folderId, newName.trim());
                    }
                }
            }
        } catch (err) {
            showGlassToast('error', 'Desktop', err.message || 'Failed to create folder', false, 5000);
        }
    }

    async createFolderFromSelection(position) {
        const workspaceId = this.currentWorkspace;
        if (!workspaceId) return;

        const shortcutIds = this.getSelectedCount() > 0
            ? [...this.selectedShortcutIds]
            : (this.draggedShortcut ? [this.draggedShortcut.shortcut.id] : []);

        if (shortcutIds.length < 1) return;

        try {
            const pos = position || this.getNextAvailablePosition();
            await vfsClient.createFolderFromSelection(workspaceId, shortcutIds, pos);
            this.clearSelection();
            await this.loadShortcuts(workspaceId);
            this.renderShortcuts();
        } catch (err) {
            showGlassToast('error', 'Desktop', err.message || 'Failed to create folder', false, 5000);
        }
    }

    async assignShortcutsToFolder(shortcutIds, folderShortcut) {
        const workspaceId = this.currentWorkspace;
        const folderId = folderShortcut?.data?.vfsFolderId;
        if (!workspaceId || !folderId || !shortcutIds.length) return;

        const updates = shortcutIds
            .filter(id => id !== folderShortcut.id)
            .map(shortcutId => ({ shortcutId, folderId }));

        if (!updates.length) return;

        await vfsClient.updateShortcutFolders(workspaceId, updates);
        updates.forEach(({ shortcutId, folderId: fid }) => {
            const s = this.shortcuts.find(sc => sc.id === shortcutId);
            if (s) s.folderId = fid;
        });
        this.clearSelection();
        this.renderShortcuts();
    }

    // Find applet by launch ID
    findAppletById(launchId) {
        // Search in main start menu config
        if (typeof startMenuConfig !== 'undefined') {
            const mainItem = startMenuConfig.find(item => item.launchId === launchId);
            if (mainItem) return mainItem;
        }

        // Search in submenus
        if (typeof startMenuSubmenus !== 'undefined') {
            for (const submenuKey in startMenuSubmenus) {
                const submenuData = startMenuSubmenus[submenuKey];
                const submenuItems = typeof submenuData === 'function' ? submenuData() : submenuData;
                if (submenuItems && Array.isArray(submenuItems)) {
                    const submenuItem = submenuItems.find(item => item.launchId === launchId);
                    if (submenuItem) return submenuItem;
                }
            }
        }

        return null;
    }

    // Get applet context menu
    getAppletContextMenu(shortcut) {
        return {
            sections: [
                {
                    type: 'list',
                    items: this.getShortcutManagementMenuItems(false, shortcut)
                }
            ]
        };
    }

    // Check if applet shortcut already exists
    hasAppletShortcut(launchId) {
        return this.shortcuts.some(s => 
            s.type === 'applet' && 
            s.data && 
            s.data.launchId === launchId
        );
    }

    // Create request icon (circular preview with drafting compass icon)
    createRequestIcon(shortcut) {
        // Frame container
        const frame = document.createElement('div');
        frame.className = 'desktop-shortcut-icon desktop-shortcut-icon-image desktop-shortcut-icon-request';

        // Preview image as background (circular)
        const imagePreview = document.createElement('div');
        imagePreview.className = 'desktop-shortcut-image-preview desktop-shortcut-request-preview';
        
        // Use embedded preview if available (base64)
        if (shortcut.data && shortcut.data.preview) {
            // Preview is base64 encoded
            imagePreview.style.backgroundImage = `url('data:image/png;base64,${shortcut.data.preview}')`;
        }

        // Flare holder for overlay effect
        const flareHolder = document.createElement('div');
        flareHolder.className = 'desktop-shortcut-flare-holder';

        // Drafting compass icon overlay
        const requestIcon = document.createElement('i');
        requestIcon.className = 'fas fa-compass-drafting desktop-shortcut-image-icon';

        // Build structure: frame > preview > flare > icon
        flareHolder.appendChild(requestIcon);
        imagePreview.appendChild(flareHolder);
        frame.appendChild(imagePreview);

        return frame;
    }

    // Handle request shortcut click
    async handleRequestClick(shortcut) {
        if (!shortcut.data || !shortcut.data.requestBody) {
            console.error('Request shortcut missing requestBody');
            return;
        }

        try {
            // Convert request body to metadata format
            const requestBody = shortcut.data.requestBody;
            const metadata = {
                prompt: requestBody.prompt || '',
                uc: requestBody.uc || '',
                model: requestBody.model || 'v4_5',
                steps: requestBody.steps || 25,
                guidance: requestBody.guidance || 5.0,
                rescale: requestBody.rescale || 0.0,
                seed: requestBody.seed,
                sampler: requestBody.sampler,
                noiseScheduler: requestBody.noiseScheduler || requestBody.noise_schedule,
                upscale: requestBody.upscale,
                resolution: requestBody.resolution,
                width: requestBody.width,
                height: requestBody.height,
                // Copy other fields that might be in the request body
                allCharacterPrompts: requestBody.allCharacterPrompts,
                use_coords: requestBody.use_coords,
                dataset_config: requestBody.dataset_config,
                append_quality: requestBody.append_quality,
                append_uc: requestBody.append_uc,
                vibe_transfer: requestBody.vibe_transfer,
                normalize_vibes: requestBody.normalize_vibes,
                dynamic_generation: requestBody.dynamic_generation,
                chara_reference_source: requestBody.chara_reference_source,
                chara_reference_type: requestBody.chara_reference_type,
                chara_reference_strength: requestBody.chara_reference_strength,
                chara_reference_with_style: requestBody.chara_reference_with_style,
                chara_reference_fidelity: requestBody.chara_reference_fidelity,
                text_replacements: requestBody.text_replacements,
                text_replacements_seed: requestBody.text_replacements_seed,
                pipeline: requestBody.pipeline,
                save_base_output: requestBody.save_base_output,
                skip_pipeline_stages: requestBody.skip_pipeline_stages,
                stage_compiled_prompts: requestBody.stage_compiled_prompts,
                text_overlays: requestBody.text_overlays,
                auto_clean_uc: requestBody.auto_clean_uc,
                image: requestBody.image,
                image_bias: requestBody.image_bias,
                mask_compressed: requestBody.mask_compressed,
                strength: requestBody.strength,
                noise: requestBody.noise,
                variety: requestBody.variety
            };

            await openManualModalWithContent({ type: 'metadata', data: metadata });
        } catch (error) {
            console.error('Failed to open request in editor:', error);
            showGlassToast('error', 'Error', 'Failed to load request', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }

    // Get request context menu
    getRequestContextMenu(shortcut) {
        return {
            sections: [
                {
                    type: 'list',
                    items: [
                        ...this.getShortcutManagementMenuItems(false, shortcut)
                    ]
                }
            ]
        };
    }

    // Create preset icon (based on notes template)
    createPresetIcon(shortcut) {
        // Just the icon, no wrapper or frame (like note)
        const icon = document.createElement('div');
        icon.className = 'desktop-shortcut-icon desktop-shortcut-icon-preset';
        
        // Use fa-file-prescription icon
        const presetIcon = document.createElement('i');
        presetIcon.className = 'fas fa-file-prescription';
        
        icon.appendChild(presetIcon);
        return icon;
    }

    // Handle preset shortcut click
    async handlePresetClick(shortcut) {
        if (!shortcut.data || !shortcut.data.uuid) {
            console.error('Preset shortcut missing UUID');
            showGlassToast('error', 'Error', 'Preset UUID not found', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        try {
            await openManualModalWithContent({ type: 'preset', uuid: shortcut.data.uuid, title: shortcut.name });
        } catch (error) {
            console.error('Failed to open preset in editor:', error);
            showGlassToast('error', 'Error', 'Failed to load preset', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }

    // Get preset context menu
    getPresetContextMenu(shortcut) {
        return {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'nai-sparkles',
                            text: 'Generate',
                            action: 'preset-generate'
                        },
                        {
                            icon: 'fas fa-compass-drafting',
                            text: 'Edit in Studio',
                            action: 'preset-edit-studio'
                        },
                        {
                            icon: 'fas fa-link-horizontal',
                            text: 'Copy URL',
                            action: 'preset-copy-url'
                        },
                        ...this.getShortcutManagementMenuItems(true, shortcut)
                    ]
                }
            ]
        };
    }

    // Create wiki page icon
    createWikiPageIcon(shortcut) {
        // Just the icon, no wrapper or frame (like note/preset)
        const icon = document.createElement('div');
        icon.className = 'desktop-shortcut-icon desktop-shortcut-icon-wiki';
        
        // Use fa-file-alt icon for wiki pages
        const wikiIcon = document.createElement('i');
        wikiIcon.className = 'fas fa-file-doc';
        
        icon.appendChild(wikiIcon);
        return icon;
    }

    // Handle wiki page shortcut click
    async handleWikiPageClick(shortcut) {
        if (!shortcut.data || !shortcut.data.tagName) {
            console.error('Wiki page shortcut missing tagName');
            showGlassToast('error', 'Error', 'Wiki page tag not found', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        const tagName = shortcut.data.tagName;

        try {
            if (!wikiWindowManager) {
                showGlassToast('error', 'Error', 'Wiki window manager not available', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                return;
            }

            if (!wsClient || !wsClient.isConnected()) {
                showGlassToast('error', 'Error', 'WebSocket not connected', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                return;
            }

            const result = await wsClient.sendMessage('get_tag_wiki_page', {
                tagName: tagName,
                source: 'both',
                format: 'html'
            });

            if (result) {
                wikiWindowManager.createWindow(result, { title: tagName, name: tagName });
            } else {
                showGlassToast('error', 'Error', 'Failed to load wiki page', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } catch (error) {
            console.error('Failed to open wiki page:', error);
            showGlassToast('error', 'Error', 'Failed to open wiki page: ' + error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }

    createStaticWikiPageIcon(shortcut) {
        const icon = document.createElement('div');
        icon.className = 'desktop-shortcut-icon desktop-shortcut-icon-wiki';
        const iconPath = shortcut.data && shortcut.data.siteId
            ? `/private/wiki/${shortcut.data.siteId}/assets/icon.png`
            : null;
        if (iconPath) {
            const img = document.createElement('img');
            img.className = 'desktop-shortcut-wiki-site-icon';
            img.src = iconPath;
            img.alt = '';
            icon.appendChild(img);
        } else {
            const wikiIcon = document.createElement('i');
            wikiIcon.className = 'fas fa-file-doc';
            icon.appendChild(wikiIcon);
        }
        return icon;
    }

    async handleStaticWikiPageClick(shortcut) {
        if (!shortcut.data || !shortcut.data.siteId || !shortcut.data.pageId) {
            showGlassToast('error', 'Error', 'Documentation shortcut is incomplete', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        const { siteId, pageId, title } = shortcut.data;

        try {
            if (!wikiWindowManager) {
                showGlassToast('error', 'Error', 'Wiki window manager not available', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                return;
            }

            if (!wsClient || !wsClient.isConnected()) {
                showGlassToast('error', 'Error', 'WebSocket not connected', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                return;
            }

            const result = await wsClient.sendMessage('get_static_wiki_page', { siteId, pageId });
            if (result) {
                const content = {
                    title: result.title || title || pageId,
                    tagName: result.title || title || pageId,
                    html: result.html || '',
                    staticWiki: true,
                    siteId,
                    pageId,
                    siteIcon: result.siteIcon || null
                };
                wikiWindowManager.createWindow(content, {
                    title: content.title,
                    name: content.title
                });
            } else {
                showGlassToast('error', 'Error', 'Failed to load documentation page', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } catch (error) {
            console.error('Failed to open static wiki page:', error);
            showGlassToast('error', 'Error', 'Failed to open page: ' + error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }

    getStaticWikiPageContextMenu(shortcut) {
        return this.getWikiPageContextMenu(shortcut);
    }

    // Get wiki page context menu
    getWikiPageContextMenu(shortcut) {
        return {
            sections: [
                {
                    type: 'list',
                    items: this.getShortcutManagementMenuItems(false, shortcut)
                }
            ]
        };
    }

    naxTagImageUrl(data) {
        if (!data || !data.gallerySlug || !data.filename) return '';
        const slug = encodeURIComponent(data.gallerySlug);
        const file = encodeURIComponent(data.filename);
        return `/naxCache/${slug}/${file}`;
    }

    createNaxTagIcon(shortcut) {
        const frame = document.createElement('div');
        frame.className = 'desktop-shortcut-icon desktop-shortcut-icon-image';

        const imagePreview = document.createElement('div');
        imagePreview.className = 'desktop-shortcut-image-preview';

        if (shortcut.data) {
            const previewUrl = this.naxTagImageUrl(shortcut.data);
            if (previewUrl) {
                imagePreview.style.backgroundImage = `url('${previewUrl}')`;
            }
        }

        const flareHolder = document.createElement('div');
        flareHolder.className = 'desktop-shortcut-flare-holder';

        const tagIcon = document.createElement('i');
        tagIcon.className = 'fas fa-flask desktop-shortcut-image-icon';

        flareHolder.appendChild(tagIcon);
        imagePreview.appendChild(flareHolder);
        frame.appendChild(imagePreview);

        return frame;
    }

    handleNaxTagClick(shortcut) {
        if (!shortcut.data || !shortcut.data.tag || !shortcut.data.gallerySlug || !shortcut.data.filename) {
            console.error('NAX tag shortcut missing data');
            showGlassToast('error', 'Error', 'Tag shortcut data not found', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        const item = {
            tag: shortcut.data.tag,
            gallerySlug: shortcut.data.gallerySlug,
            filename: shortcut.data.filename
        };

        if (window.naxtApplet && typeof window.naxtApplet.openNaxItemInViewer === 'function') {
            window.naxtApplet.openNaxItemInViewer(item);
            return;
        }

        const src = this.naxTagImageUrl(item);
        if (src && typeof openImageInViewer === 'function') {
            openImageInViewer(src, item.tag, {
                url: src,
                genericExternalImage: true,
                naxFilename: item.filename,
                naxGallerySlug: item.gallerySlug
            });
        }
    }

    getNaxTagContextMenu(shortcut) {
        const manualModal = document.getElementById('manualModal');

        return {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'nai-clipboard',
                            text: 'Copy Tag',
                            action: 'nax-tag-copy'
                        },
                        {
                            icon: 'fas fa-plus',
                            text: 'Add to Prompt',
                            action: 'nax-tag-add-to-prompt',
                            disabled: () => manualModal && manualModal.classList.contains('hidden')
                        },
                        ...this.getShortcutManagementMenuItems(true, shortcut)
                    ]
                }
            ]
        };
    }

    // Update note shortcuts when note properties change
    async updateNoteShortcuts(noteId) {
        // Find all note shortcuts for this noteId
        const noteShortcuts = this.shortcuts.filter(s => 
            s.type === 'note' && 
            s.data && 
            s.data.noteId === noteId
        );

        if (noteShortcuts.length === 0) {
            return; // No shortcuts to update
        }

        // Re-render shortcuts to pick up new icon/color from note
        for (const shortcut of noteShortcuts) {
            const element = this.desktopContainer?.querySelector(`[data-shortcut-id="${shortcut.id}"]`);
            if (element) {
                // Find and update the icon element
                const iconElement = element.querySelector('.desktop-shortcut-icon');
                if (iconElement) {
                    // Recreate the icon with updated note data
                    const newIcon = await this.createNoteIcon(shortcut);
                    iconElement.replaceWith(newIcon);
                }
            }
        }
    }

    // Handle reference drag to manual modal
    async handleReferenceDragToManual(shortcut, manualModal) {
        if (!shortcut.data || !shortcut.data.hash) {
            console.error('Reference shortcut missing data');
            return;
        }

        const refType = shortcut.data.refType || 'base';
        const hash = shortcut.data.hash;

        try {
            // For vibe shortcuts with stored vibeId, we can add directly without looking up cache
            if (refType === 'vibe' && shortcut.data.vibeId) {
                if (typeof addVibeReferenceToContainer === 'function') {
                    await addVibeReferenceToContainer(shortcut.data.vibeId, 'default', 0.7);
                    showGlassToast('success', null, 'Vibe reference added', false, 3000, '<i class="nai-vibe-transfer"></i>');
                    return;
                } else {
                    console.warn('addVibeReferenceToContainer not available, falling back to cache lookup');
                }
            }
            
            // Ensure references are loaded
            if (typeof cacheImages === 'undefined' || !Array.isArray(cacheImages) || cacheImages.length === 0) {
                console.log('Loading references...');
                if (typeof loadCacheImages === 'function') {
                    await loadCacheImages();
                } else {
                    console.error('loadCacheImages function not available');
                    showGlassToast('error', 'Error', 'Reference system not ready', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                    return;
                }
            }
            
            // Find the full cache image from global cacheImages array
            let cacheImage = null;
            if (typeof cacheImages !== 'undefined' && Array.isArray(cacheImages)) {
                cacheImage = cacheImages.find(img => img.hash === hash);
            }
            
            // If not found in cache, try to construct minimal object from stored data
            if (!cacheImage && shortcut.data) {
                // shortcut.data.preview is now always a string (e.g., "hash.webp" or "abc123.webp")
                // For the minimal object, set hasPreview to match what the system expects
                const hasPreviewValue = shortcut.data.preview 
                    ? (shortcut.data.isStandalone ? shortcut.data.preview : true)
                    : false;
                
                cacheImage = {
                    hash: shortcut.data.hash,
                    filename: shortcut.data.filename,
                    hasPreview: hasPreviewValue,
                    preview: shortcut.data.preview, // Keep the string preview for standalone vibes
                    isStandalone: shortcut.data.isStandalone,
                    hasVibes: shortcut.data.hasVibes,
                    workspaceId: shortcut.data.workspaceId
                };
                console.warn('Reference not found in cache, using stored shortcut data:', hash);
            }
            
            if (!cacheImage) {
                console.error('Reference not found and no stored data:', hash);
                showGlassToast('error', 'Error', 'Reference not found', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                return;
            }
            
            // Different behavior based on reference type
            switch (refType) {
                case 'vibe':
                    // Add as vibe reference
                    if (typeof addAsVibeReference === 'function') {
                        await addAsVibeReference(cacheImage);
                        showGlassToast('success', null, 'Vibe reference added', false, 3000, '<i class="nai-vibe-transfer"></i>');
                    }
                    break;
                    
                case 'base':
                    // Replace base image
                    if (typeof addAsBaseImage === 'function') {
                        await addAsBaseImage(cacheImage);
                        showGlassToast('success', null, 'Base image set', false, 3000, '<i class="nai-img2img"></i>');
                    }
                    break;
                    
                case 'character':
                    // Replace or add character reference
                    if (typeof addAsCharacterReference === 'function') {
                        await addAsCharacterReference(cacheImage);
                        showGlassToast('success', null, 'Precise reference added', false, 3000, '<i class="nai-precise-reference"></i>');
                    }
                    break;
            }
        } catch (error) {
            console.error('Failed to add reference to manual modal:', error);
            showGlassToast('error', 'Error', 'Failed to add reference', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }

    // Attach context menu to shortcut
    attachShortcutContextMenu(element, shortcut) {
        if (!contextMenu) return;

        const typeHandler = this.shortcutTypes[shortcut.type];
        const singleMenuConfig = typeHandler && typeHandler.contextMenu
            ? typeHandler.contextMenu.call(this, shortcut)
            : this.getDefaultContextMenu(shortcut);

        const config = {
            sections: singleMenuConfig.sections,
            beforeShow: (event, target) => {
                const shortcutId = target.closest('.desktop-shortcut')?.dataset.shortcutId;
                const menuShortcut = shortcutId
                    ? this.shortcuts.find((s) => s.id === shortcutId)
                    : shortcut;
                if (this.getSelectedCount() > 1 && this.isShortcutSelected(shortcutId)) {
                    if (explorerApplet) explorerApplet._contextMenuTarget = null;
                    config.sections = this.getBulkContextMenu().sections;
                    return;
                }
                // public/scripts/comp/explorerApplet.js buildDesktopShortcutContextMenu
                const explorer = typeof initializeExplorerApplet === 'function'
                    ? initializeExplorerApplet()
                    : explorerApplet;
                if (explorer && explorer.buildDesktopShortcutContextMenu && menuShortcut) {
                    explorer._contextMenuTarget = explorer._shortcutToExplorerItem(
                        menuShortcut,
                        { isDesktopShortcut: true }
                    );
                    config.sections = explorer.buildDesktopShortcutContextMenu(menuShortcut);
                    return;
                }
                if (explorer) explorer._contextMenuTarget = null;
                config.sections = singleMenuConfig.sections;
            }
        };

        contextMenu.attachToElement(element, config);
    }

    // Get default context menu
    getDefaultContextMenu(shortcut) {
        return {
            sections: [
                {
                    type: 'list',
                    items: this.getShortcutManagementMenuItems(false, shortcut)
                }
            ]
        };
    }

    // Get image context menu
    getImageContextMenu(shortcut) {
        return {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'fas fa-compass-drafting',
                            text: 'Edit in Studio',
                            action: 'open-in-studio'
                        },
                        {
                            icon: 'fas fa-film-canister',
                            text: 'Jump to Image',
                            action: 'jump-to-workspace'
                        },
                        {
                            icon: 'fas fa-download',
                            text: 'Download',
                            action: 'download-image'
                        },
                        {
                            icon: 'fas fa-copy',
                            text: 'Copy to Clipboard',
                            action: 'copy-to-clipboard'
                        },
                        ...this.getShortcutManagementMenuItems(true, shortcut)
                    ]
                }
            ]
        };
    }

    // Handle drag start (mousedown/touchstart)
    handleDragStart(event, shortcut) {
        if (event.type === 'mousedown' && event.button !== 0) return;

        const element = event.currentTarget;
        const isCtrl = event.ctrlKey || event.metaKey;

        if (isCtrl) {
            this.toggleShortcutSelection(shortcut.id);
            return;
        }

        if (!this.isShortcutSelected(shortcut.id)) {
            this.selectShortcut(shortcut.id);
        }
        
        const rect = element.getBoundingClientRect();
        
        // Calculate offset from mouse/touch to element position
        const clientX = event.type === 'touchstart' ? event.touches[0].clientX : event.clientX;
        const clientY = event.type === 'touchstart' ? event.touches[0].clientY : event.clientY;
        
        // Record start position
        this.dragStartPos = { x: clientX, y: clientY };
        this.isDragging = false; // Not dragging yet
        
        this.dragOffset = {
            x: clientX - rect.left,
            y: clientY - rect.top
        };

        this.draggedShortcut = {
            element: element,
            shortcut: shortcut,
            wasInGrid: element.parentElement === this.gridContainer,
            lastDropZoneState: null
        };

        // Add event listeners for drag (check threshold on first move)
        const moveHandler = (e) => this.handleDragMove(e);
        const endHandler = (e) => this.handleDragEnd(e, moveHandler, endHandler);

        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('touchmove', moveHandler, { passive: false });
        document.addEventListener('mouseup', endHandler);
        document.addEventListener('touchend', endHandler);
    }

    // Handle drag move
    handleDragMove(event) {
        if (!this.draggedShortcut) return;

        const clientX = event.type === 'touchmove' ? event.touches[0].clientX : event.clientX;
        const clientY = event.type === 'touchmove' ? event.touches[0].clientY : event.clientY;

        // Check if we've moved beyond the drag threshold
        if (!this.isDragging) {
            const dx = clientX - this.dragStartPos.x;
            const dy = clientY - this.dragStartPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < this.dragThreshold) {
                // Haven't moved enough yet, don't start dragging
                return;
            }
            
            // Beyond threshold, enter drag mode
            this.isDragging = true;
            event.preventDefault();

            this.prepareDragGroup(this.draggedShortcut.element, this.draggedShortcut.shortcut);
            this.convertDragGroupToFreeform();
            
            // Show drop zones
            this.showDropZones();
        }
        
        // Only update position if we're in drag mode
        if (!this.isDragging) return;
        
        event.preventDefault();

        const containerRect = this.freeformContainer.getBoundingClientRect();
        
        // Calculate new position relative to freeform container
        let newX = clientX - containerRect.left - this.dragOffset.x;
        let newY = clientY - containerRect.top - this.dragOffset.y;

        // Constrain primary position to container bounds
        const elementRect = this.draggedShortcut.element.getBoundingClientRect();
        newX = Math.max(0, Math.min(newX, containerRect.width - elementRect.width));
        newY = Math.max(0, Math.min(newY, containerRect.height - elementRect.height));

        if (this.dragGroup && this.dragGroup.length > 1) {
            this.updateDragGroupPositions(newX, newY);
        } else {
            this.draggedShortcut.element.style.left = `${newX}px`;
            this.draggedShortcut.element.style.top = `${newY}px`;
        }
        
        // Check if hovering over manual modal for reference shortcuts
        this.checkManualModalDrop(clientX, clientY);
        
        // Highlight drop placeholder if hovering over grid
        this.highlightDropZone(newX, newY, containerRect);

        // Folder drop target highlight + hold-to-folder gesture
        const folderTarget = this.getFolderShortcutUnderPoint(clientX, clientY);
        this.getAllShortcutElements().forEach((el) => {
            el.classList.toggle('folder-drop-target', folderTarget && el.dataset.shortcutId === folderTarget.id);
        });

        const hoverTarget = this.getShortcutUnderPoint(clientX, clientY);
        if (folderTarget && folderTarget.id !== this.draggedShortcut.shortcut.id) {
            this.clearFolderHoldTimer();
        } else if (hoverTarget && hoverTarget.id !== this.draggedShortcut.shortcut.id && hoverTarget.type !== 'folder') {
            if (this.folderHoldTarget !== hoverTarget.id) {
                this.clearFolderHoldTimer();
                this.folderHoldTarget = hoverTarget.id;
                this.folderHoldTimer = setTimeout(async () => {
                    const ids = this.getSelectedCount() > 1
                        ? [...this.selectedShortcutIds]
                        : [this.draggedShortcut.shortcut.id];
                    if (!ids.includes(hoverTarget.id)) ids.push(hoverTarget.id);
                    this.selectedShortcutIds = new Set(ids);
                    await this.createFolderFromSelection();
                    this.clearFolderHoldTimer();
                    this.hideDropZones();
                    this.draggedShortcut = null;
                    this.dragGroup = null;
                    this.isDragging = false;
                }, 600);
            }
        } else if (!folderTarget) {
            this.clearFolderHoldTimer();
        }
    }
    
    // Check if dragging over manual modal
    checkManualModalDrop(clientX, clientY) {
        if (!this.draggedShortcut || this.draggedShortcut.shortcut.type !== 'reference') {
            return; // Only for reference shortcuts
        }
        
        // Check if manual modal is open
        const manualModal = document.getElementById('manualModal');
        if (!manualModal || manualModal.classList.contains('hidden')) {
            return;
        }
        
        // Check if cursor is over manual modal
        const modalRect = manualModal.getBoundingClientRect();
        const isOver = clientX >= modalRect.left && 
                      clientX <= modalRect.right && 
                      clientY >= modalRect.top && 
                      clientY <= modalRect.bottom;
        
        // Add/remove visual indicator
        if (isOver) {
            manualModal.classList.add('reference-drop-target');
            this.draggedShortcut.element.classList.add('can-drop-reference');
        } else {
            manualModal.classList.remove('reference-drop-target');
            this.draggedShortcut.element.classList.remove('can-drop-reference');
        }
    }
    
    // Highlight drop placeholder if hovering over grid area
    highlightDropZone(x, y, freeformContainerRect) {
        if (!this.dropZoneOverlay || !this.draggedShortcut) return;
        
        // Check if icon intersects with grid area
        const gridRect = this.gridContainer ? this.gridContainer.getBoundingClientRect() : null;
        
        if (gridRect) {
            // Convert icon position (relative to freeform) to absolute screen coordinates
            const iconLeft = x + freeformContainerRect.left;
            const iconTop = y + freeformContainerRect.top;
            const iconRight = iconLeft + this.iconSize;
            const iconBottom = iconTop + this.iconSize;
            
            // Expand grid bounds with snap threshold
            const gridLeft = gridRect.left - this.snapThreshold;
            const gridRight = gridRect.right + this.snapThreshold;
            const gridTop = gridRect.top - this.snapThreshold;
            const gridBottom = gridRect.bottom + this.snapThreshold;
            
            // Check if icon rectangle intersects with grid rectangle
            const intersects = !(iconRight < gridLeft || 
                                iconLeft > gridRight || 
                                iconBottom < gridTop || 
                                iconTop > gridBottom);
            
            // Only update DOM if state changed (prevents flickering)
            if (intersects !== this.draggedShortcut.lastDropZoneState) {
                this.draggedShortcut.lastDropZoneState = intersects;
                
                if (intersects) {
                    this.dropZoneOverlay.classList.add('active');
                } else {
                    this.dropZoneOverlay.classList.remove('active');
                }
            }
        }
    }

    // Handle drag end
    async handleDragEnd(event, moveHandler, endHandler) {
        if (!this.draggedShortcut) return;

        // Remove event listeners
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('touchmove', moveHandler);
        document.removeEventListener('mouseup', endHandler);
        document.removeEventListener('touchend', endHandler);

        // Check if we actually entered drag mode
        if (this.isDragging) {
            // Check if dropped on manual modal (reference shortcuts only)
            let droppedOnManual = false;
            if (this.draggedShortcut.shortcut.type === 'reference') {
                const manualModal = document.getElementById('manualModal');
                if (manualModal && !manualModal.classList.contains('hidden')) {
                    const clientX = event.type === 'touchend' ? event.changedTouches[0].clientX : event.clientX;
                    const clientY = event.type === 'touchend' ? event.changedTouches[0].clientY : event.clientY;
                    
                    const modalRect = manualModal.getBoundingClientRect();
                    droppedOnManual = clientX >= modalRect.left && 
                                     clientX <= modalRect.right && 
                                     clientY >= modalRect.top && 
                                     clientY <= modalRect.bottom;
                    
                    // Remove visual indicators
                    manualModal.classList.remove('reference-drop-target');
                }
            }
            
            // Remove dragging class from all dragged items
            if (this.dragGroup) {
                this.dragGroup.forEach((item) => {
                    item.element.classList.remove('dragging', 'can-drop-reference');
                });
            } else {
                this.draggedShortcut.element.classList.remove('dragging', 'can-drop-reference');
            }
            
            // Hide drop zones
            this.hideDropZones();
            this.clearFolderHoldTimer();
            this.getAllShortcutElements().forEach((el) => el.classList.remove('folder-drop-target'));

            const clientX = event.type === 'touchend' ? event.changedTouches[0].clientX : event.clientX;
            const clientY = event.type === 'touchend' ? event.changedTouches[0].clientY : event.clientY;
            const folderTarget = this.getFolderShortcutUnderPoint(clientX, clientY);

            if (folderTarget && !droppedOnManual) {
                const dragIds = this.dragGroup && this.dragGroup.length > 0
                    ? this.dragGroup.map((item) => item.shortcut.id)
                    : [this.draggedShortcut.shortcut.id];
                await this.assignShortcutsToFolder(dragIds, folderTarget);
            } else if (droppedOnManual) {
                // Handle drop on manual modal
                const typeHandler = this.shortcutTypes[this.draggedShortcut.shortcut.type];
                if (typeHandler && typeHandler.onDragToManual) {
                    await typeHandler.onDragToManual.call(this, this.draggedShortcut.shortcut, document.getElementById('manualModal'));
                }
                
                // Return icon to original position - re-render to restore
                this.renderShortcuts();
            } else {
                const containerRect = this.freeformContainer.getBoundingClientRect();
                const positionUpdates = [];

                const itemsToMove = this.dragGroup && this.dragGroup.length > 0
                    ? this.dragGroup
                    : [{
                        element: this.draggedShortcut.element,
                        shortcut: this.draggedShortcut.shortcut
                    }];

                itemsToMove.forEach((item) => {
                    const finalX = parseInt(item.element.style.left, 10) || 0;
                    const finalY = parseInt(item.element.style.top, 10) || 0;
                    const position = this.pixelToPositionData(finalX, finalY, containerRect, item.shortcut);
                    positionUpdates.push({
                        id: item.shortcut.id,
                        position
                    });
                    // Apply tentatively so subsequent grid snaps see updated occupancy
                    const shortcutRef = this.shortcuts.find((s) => s.id === item.shortcut.id);
                    if (shortcutRef) {
                        shortcutRef.position = position;
                    }
                });

                await this.updateMultipleShortcutPositions(positionUpdates);
            }
        }
        
        // Clean up
        this.draggedShortcut = null;
        this.dragGroup = null;
        this.isDragging = false;
    }

    async updateMultipleShortcutPositions(updates) {
        if (!updates.length) return;

        try {
            updates.forEach(({ id, position }) => {
                const shortcut = this.shortcuts.find((s) => s.id === id);
                if (!shortcut) return;
                shortcut.position = position;
                if (!shortcut._isNew) {
                    shortcut._isModified = true;
                }
            });

            this.renderShortcuts();
            this.debouncedSave();
        } catch (error) {
            console.error('Failed to update shortcut positions:', error);
        }
    }
    
    // Show drop zone placeholder in grid
    showDropZones() {
        if (!this.gridContainer) return;
        
        if (!this.dropZoneOverlay) {
            this.dropZoneOverlay = document.createElement('div');
            this.dropZoneOverlay.className = 'desktop-shortcut desktop-drop-placeholder';
            this.dropZoneOverlay.innerHTML = `
                <div class="desktop-shortcut-icon">
                    <i class="fas fa-plus"></i>
                </div>
                <div class="desktop-shortcut-label">Drop here</div>
            `;
            // Add to grid immediately on creation
            this.gridContainer.appendChild(this.dropZoneOverlay);
        } else if (!this.dropZoneOverlay.parentElement) {
            // Re-add if removed
            this.gridContainer.appendChild(this.dropZoneOverlay);
        }
        
        this.dropZoneOverlay.classList.add('visible');
    }
    
    // Hide drop zone placeholder
    hideDropZones() {
        if (this.dropZoneOverlay && this.dropZoneOverlay.parentElement) {
            this.dropZoneOverlay.remove();
        }
    }

    // Update shortcut position (local operation)
    async updateShortcutPosition(shortcutId, position) {
        try {
            const shortcut = this.shortcuts.find(s => s.id === shortcutId);
            if (!shortcut) {
                console.warn('Shortcut not found:', shortcutId);
                return;
            }

            // Update position locally
            shortcut.position = position;
            
            // Mark as modified if not new
            if (!shortcut._isNew) {
                shortcut._isModified = true;
            }
            
            this.renderShortcuts();
            
            // Trigger debounced save
            this.debouncedSave();
        } catch (error) {
            console.error('Failed to update shortcut position:', error);
        }
    }

    // Update shortcut in DOM
    updateShortcutInDOM(shortcutId, updates) {
        // Update local shortcuts array first
        const shortcut = this.shortcuts.find(s => s.id === shortcutId);
        if (shortcut) {
            Object.assign(shortcut, updates);
            
            // If position changed, need to re-render to move between containers
            if (updates.position) {
                this.renderShortcuts();
                return;
            }
        }

        // For non-position updates, just update the element
        let element = this.gridContainer ? this.gridContainer.querySelector(`[data-shortcut-id="${shortcutId}"]`) : null;
        if (!element && this.freeformContainer) {
            element = this.freeformContainer.querySelector(`[data-shortcut-id="${shortcutId}"]`);
        }
        
        if (!element) return;

        // Update name if provided
        if (updates.name) {
            const label = element.querySelector('.desktop-shortcut-label');
            if (label) {
                label.textContent = updates.name;
            }
        }
    }

    // Remove shortcut from DOM
    removeShortcutFromDOM(shortcutId) {
        // Check both containers
        let element = this.gridContainer ? this.gridContainer.querySelector(`[data-shortcut-id="${shortcutId}"]`) : null;
        if (!element && this.freeformContainer) {
            element = this.freeformContainer.querySelector(`[data-shortcut-id="${shortcutId}"]`);
        }
        
        if (element) {
            element.remove();
        }
    }

    // Update positions in DOM
    updatePositionsInDOM(positions) {
        // Update local shortcuts first (skip pending deletions)
        positions.forEach(({ id, position }) => {
            const shortcut = this.shortcuts.find(s => s.id === id);
            if (shortcut && !shortcut._isDeleted) {
                shortcut.position = position;
            }
        });
        
        // Re-render to recalculate collisions and pixel positions
        this.renderShortcuts();
    }

    // Debounced save to server (optionally includes window positions in the same flush)
    debouncedSave(options = {}) {
        const { includeWindowPositions = false } = options;

        if (includeWindowPositions) {
            this.pendingWindowPositionSave = true;
        } else {
            this.pendingChanges = true;
        }

        if (!this.pendingChanges && !this.pendingWindowPositionSave) {
            return;
        }

        this.refreshSaveTrayIndicator();

        // Clear existing timer
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        
        // Set new timer
        this.saveDebounceTimer = setTimeout(async () => {
            this.saveDebounceTimer = null;
            await this.flushPendingDesktopLayout();
        }, this.saveDebounceDelay);
    }

    // Save all shortcuts to server
    async saveToServer() {
        if (!this.pendingChanges) return;
        
        try {
            if (!wsClient || !wsClient.isConnected()) {
                console.warn('WebSocket not connected, changes saved locally');
                return;
            }

            // Process deletions first, then additions, then updates
            for (const shortcut of this.shortcuts) {
                if (shortcut._isDeleted) {
                    // Remove deleted shortcut (skip if it has temp ID - never saved)
                    if (!shortcut.id.startsWith('temp-')) {
                        try {
                            await wsClient.removeDesktopShortcut(this.currentWorkspace, shortcut.id);
                            console.log(`✅ Removed shortcut: ${shortcut.name} (${shortcut.type}, id: ${shortcut.id})`);
                        } catch (error) {
                            console.error(`❌ Failed to remove shortcut: ${shortcut.name} (${shortcut.type}, id: ${shortcut.id})`, error);
                        }
                    } else {
                        console.log(`⏭️ Skipping deletion of temp shortcut: ${shortcut.name} (${shortcut.type}, id: ${shortcut.id})`);
                    }
                }
            }
            
            // Process additions
            for (const shortcut of this.shortcuts) {
                if (shortcut._isNew && !shortcut._isDeleted) {
                    // Add new shortcut and get real ID from server
                    try {
                        const response = await wsClient.addDesktopShortcut(this.currentWorkspace, {
                            name: shortcut.name,
                            type: shortcut.type,
                            position: shortcut.position,
                            data: shortcut.data
                        });
                        
                        // Update local shortcut with real ID from server
                        if (response && response.shortcut && response.shortcut.id) {
                            const oldId = shortcut.id;
                            const newId = response.shortcut.id;
                            shortcut.id = newId;
                            shortcut.createdAt = response.shortcut.createdAt;
                            
                            // Update DOM element's data-shortcut-id
                            const element = this.desktopContainer.querySelector(`[data-shortcut-id="${oldId}"]`);
                            if (element) {
                                element.dataset.shortcutId = newId;
                            }
                        }
                        
                        // Clear both flags since new shortcuts might also be modified
                        delete shortcut._isNew;
                        delete shortcut._isModified;
                    } catch (error) {
                        console.error('Failed to add shortcut:', shortcut.name, error);
                    }
                }
            }
            
            // Process updates — batch position changes, individual saves only for renames
            const positionUpdates = [];

            for (const shortcut of this.shortcuts) {
                if (!shortcut._isModified || shortcut._isNew || shortcut._isDeleted) {
                    continue;
                }

                if (shortcut.id.startsWith('temp-')) {
                    console.warn('Skipping update for shortcut with temp ID:', shortcut.id);
                    delete shortcut._isModified;
                    delete shortcut._nameModified;
                    continue;
                }

                if (shortcut._nameModified) {
                    try {
                        await wsClient.updateDesktopShortcut(this.currentWorkspace, shortcut.id, {
                            name: shortcut.name,
                            position: shortcut.position
                        });
                        delete shortcut._nameModified;
                        delete shortcut._isModified;
                    } catch (error) {
                        console.error('Failed to update shortcut:', error);
                    }
                    continue;
                }

                positionUpdates.push({
                    id: shortcut.id,
                    position: shortcut.position
                });
            }

            if (positionUpdates.length > 0) {
                try {
                    await wsClient.updateDesktopPositions(this.currentWorkspace, positionUpdates);
                    positionUpdates.forEach(({ id }) => {
                        const shortcut = this.shortcuts.find(s => s.id === id);
                        if (shortcut) {
                            delete shortcut._isModified;
                        }
                    });
                } catch (error) {
                    console.error('Failed to batch update shortcut positions:', error);
                }
            }
            
            // Remove deleted shortcuts from local array
            this.shortcuts = this.shortcuts.filter(s => !s._isDeleted);
            
            this.pendingChanges = false;
            console.log('✅ Desktop shortcuts saved to server');
        } catch (error) {
            console.error('Failed to save desktop shortcuts:', error);
        }
    }

    // Add a new shortcut (local operation)
    async addShortcut(shortcut) {
        try {
            // Generate local ID (will be replaced by server ID on save)
            shortcut.id = 'temp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            shortcut.createdAt = new Date().toISOString();
            shortcut._isNew = true;

            // Set default position if not provided (defaults to grid)
            if (!shortcut.position) {
                shortcut.position = this.getNextAvailablePosition();
            }

            // Add to local array
            this.shortcuts.push(shortcut);
            
            // Recalculate collisions and re-render
            this.renderShortcuts();
            
            // Trigger debounced save
            this.debouncedSave();
            
            return shortcut;
        } catch (error) {
            console.error('Failed to add desktop shortcut:', error);
            throw error;
        }
    }

    // Calculate pixel position for freeform (quadrant) shortcuts only
    calculateQuadrantPixelPosition(shortcut) {
        if (!shortcut.position || shortcut.position.index === 0) {
            return null; // Grid icons don't need pixel positions
        }
        
        const containerRect = this.freeformContainer ? this.freeformContainer.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
        return this.calculateQuadrantPosition(shortcut.position.index, shortcut.position.x || 0, shortcut.position.y || 0, containerRect);
    }
    
    // Calculate quadrant position (indexes 1-4)
    calculateQuadrantPosition(index, xPercent, yPercent, containerRect) {
        const width = containerRect.width;
        const height = containerRect.height;
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        
        let baseX, baseY, rangeX, rangeY;
        
        switch (index) {
            case 1: // Top-left
                baseX = 0;
                baseY = 0;
                rangeX = halfWidth;
                rangeY = halfHeight;
                break;
            case 2: // Top-right
                baseX = halfWidth;
                baseY = 0;
                rangeX = halfWidth;
                rangeY = halfHeight;
                break;
            case 3: // Bottom-left
                baseX = 0;
                baseY = halfHeight;
                rangeX = halfWidth;
                rangeY = halfHeight;
                break;
            case 4: // Bottom-right
                baseX = halfWidth;
                baseY = halfHeight;
                rangeX = halfWidth;
                rangeY = halfHeight;
                break;
            default:
                return { x: 0, y: 0 };
        }
        
        // Calculate position within quadrant using percentage
        const x = baseX + rangeX * xPercent;
        const y = baseY + rangeY * yPercent;
        
        return { x, y };
    }
    
    // Get next available position for a shortcut (defaults to grid)
    getNextAvailablePosition() {
        // Find next available grid position
        const gridShortcuts = this.shortcuts.filter(s => s.position && s.position.index === 0);
        const maxPos = gridShortcuts.length > 0 ? Math.max(...gridShortcuts.map(s => s.position.pos || 0)) : -1;
        
        return {
            index: 0,
            pos: maxPos + 1
        };
    }
    
    // Convert pixel position to position data based on drop location
    pixelToPositionData(pixelX, pixelY, freeformContainerRect, shortcutForContext = null) {
        const width = freeformContainerRect.width;
        const height = freeformContainerRect.height;
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        
        // Check if icon intersects with grid area
        const gridRect = this.gridContainer ? this.gridContainer.getBoundingClientRect() : null;
        
        if (gridRect) {
            // Convert pixel position (relative to freeform) to absolute screen coordinates
            const iconLeft = pixelX + freeformContainerRect.left;
            const iconTop = pixelY + freeformContainerRect.top;
            const iconRight = iconLeft + this.iconSize;
            const iconBottom = iconTop + this.iconSize;
            
            // Expand grid bounds with snap threshold
            const gridLeft = gridRect.left - this.snapThreshold;
            const gridRight = gridRect.right + this.snapThreshold;
            const gridTop = gridRect.top - this.snapThreshold;
            const gridBottom = gridRect.bottom + this.snapThreshold;
            
            // Check if icon rectangle intersects with grid rectangle
            const intersects = !(iconRight < gridLeft || 
                                iconLeft > gridRight || 
                                iconBottom < gridTop || 
                                iconTop > gridBottom);
            
            if (intersects) {
                // Snap to grid
                const currentShortcut = shortcutForContext
                    || (this.draggedShortcut ? this.draggedShortcut.shortcut : null);
                
                if (currentShortcut && currentShortcut.position && currentShortcut.position.index === 0) {
                    // Already in grid, keep its position (don't create gaps)
                    return {
                        index: 0,
                        pos: currentShortcut.position.pos
                    };
                } else {
                    // New to grid, find next available position
                    // Exclude the current shortcut from the count
                    const gridShortcuts = this.shortcuts.filter(s => 
                        s.position && 
                        s.position.index === 0 && 
                        (!currentShortcut || s.id !== currentShortcut.id)
                    );
                    
                    // Find next position (fills gaps)
                    if (gridShortcuts.length === 0) {
                        return { index: 0, pos: 0 };
                    }
                    
                    // Sort by pos and find first gap or append to end
                    const sortedPositions = gridShortcuts.map(s => s.position.pos || 0).sort((a, b) => a - b);
                    let nextPos = 0;
                    
                    for (let i = 0; i < sortedPositions.length; i++) {
                        if (sortedPositions[i] !== i) {
                            // Found a gap
                            nextPos = i;
                            break;
                        }
                    }
                    
                    // No gaps found, append to end
                    if (nextPos === 0 && sortedPositions[0] === 0) {
                        nextPos = sortedPositions.length;
                    }
                    
                    return {
                        index: 0,
                        pos: nextPos
                    };
                }
            }
        }
        
        // Determine quadrant based on which half the icon is in
        let index;
        let baseX, baseY, rangeX, rangeY;
        
        if (pixelX < halfWidth && pixelY < halfHeight) {
            // Top-left (1)
            index = 1;
            baseX = 0;
            baseY = 0;
            rangeX = halfWidth;
            rangeY = halfHeight;
        } else if (pixelX >= halfWidth && pixelY < halfHeight) {
            // Top-right (2)
            index = 2;
            baseX = halfWidth;
            baseY = 0;
            rangeX = halfWidth;
            rangeY = halfHeight;
        } else if (pixelX < halfWidth && pixelY >= halfHeight) {
            // Bottom-left (3)
            index = 3;
            baseX = 0;
            baseY = halfHeight;
            rangeX = halfWidth;
            rangeY = halfHeight;
        } else {
            // Bottom-right (4)
            index = 4;
            baseX = halfWidth;
            baseY = halfHeight;
            rangeX = halfWidth;
            rangeY = halfHeight;
        }
        
        // Convert to percentage within quadrant (0.0 to 1.0)
        const xPercent = Math.max(0, Math.min(1, (pixelX - baseX) / rangeX));
        const yPercent = Math.max(0, Math.min(1, (pixelY - baseY) / rangeY));
        
        return {
            index: index,
            x: xPercent,
            y: yPercent
        };
    }
    
    // Check for collisions and calculate offset (freeform icons only)
    calculateCollisionOffset(shortcut, pixelPos, freeformShortcuts) {
        const offset = { x: 0, y: 0 };
        const checkRadius = this.iconSize;
        
        // Only check collisions with other freeform shortcuts (grid is handled by flex)
        for (const otherShortcut of freeformShortcuts) {
            if (otherShortcut.id === shortcut.id) continue;
            
            const otherPos = this.calculateQuadrantPixelPosition(otherShortcut);
            if (!otherPos) continue;
            
            // Apply existing collision offset to other shortcut
            const otherOffset = this.collisionOffsets.get(otherShortcut.id) || { x: 0, y: 0 };
            const otherFinalX = otherPos.x + otherOffset.x;
            const otherFinalY = otherPos.y + otherOffset.y;
            
            // Check for overlap
            const dx = pixelPos.x - otherFinalX;
            const dy = pixelPos.y - otherFinalY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < checkRadius) {
                // Collision detected - push away
                const angle = Math.atan2(dy, dx);
                const pushDistance = checkRadius - distance;
                offset.x += Math.cos(angle) * pushDistance;
                offset.y += Math.sin(angle) * pushDistance;
            }
        }
        
        return offset;
    }

    // Remove a shortcut (local operation)
    async removeShortcut(shortcutId) {
        try {
            const shortcut = this.shortcuts.find(s => s.id === shortcutId);
            if (!shortcut) {
                throw new Error('Shortcut not found');
            }

            // If it's a new shortcut that hasn't been saved, just remove it
            if (shortcut._isNew) {
                this.shortcuts = this.shortcuts.filter(s => s.id !== shortcutId);
            } else {
                // Mark for deletion
                shortcut._isDeleted = true;
            }
            
            // Remove from DOM immediately
            this.removeShortcutFromDOM(shortcutId);
            this.selectedShortcutIds.delete(shortcutId);
            
            // Trigger debounced save
            this.debouncedSave();
        } catch (error) {
            console.error('Failed to remove desktop shortcut:', error);
            throw error;
        }
    }

    // Rename a shortcut (local operation)
    async renameShortcut(shortcutId, newName) {
        try {
            const shortcut = this.shortcuts.find(s => s.id === shortcutId);
            if (!shortcut) {
                throw new Error('Shortcut not found');
            }

            // Update name locally
            shortcut.name = newName;
            if (shortcut.type === 'bracket-generation' && shortcut.data) {
                shortcut.data.label = newName;
            }
            if (shortcut.type === 'folder' && shortcut.data?.vfsFolderId && wsClient?.isConnected()) {
                await vfsClient.renameFolder(shortcut.data.vfsFolderId, newName);
            }
            
            // Mark as modified if not new
            if (!shortcut._isNew) {
                shortcut._isModified = true;
                shortcut._nameModified = true;
            }
            
            // Update DOM immediately
            this.updateShortcutInDOM(shortcutId, { name: newName });
            
            // Trigger debounced save
            this.debouncedSave();
        } catch (error) {
            console.error('Failed to rename desktop shortcut:', error);
            throw error;
        }
    }

    // Get workspace submenu items for "Move to..." menu
    getWorkspaceSubmenuItems() {
        if (typeof workspaces === 'undefined' || !this.currentWorkspace) {
            return [];
        }

        const workspaceList = Object.values(workspaces)
            .filter(ws => ws.id !== this.currentWorkspace)
            .sort((a, b) => (a.sort || 0) - (b.sort || 0))
            .map(ws => {
                const workspaceColor = ws.color || '#102040';
                return {
                    content: `<div class="workspace-color-indicator" style="background-color: ${workspaceColor}"></div><span>${ws.name || ws.id}</span>`,
                    action: 'move-shortcut-to-workspace',
                    data: { workspaceId: ws.id, workspaceName: ws.name || ws.id }
                };
            });

        return workspaceList;
    }

    // Move a shortcut to another workspace
    async moveShortcutToWorkspace(shortcutId, targetWorkspaceId, silent = false) {
        try {
            const shortcut = this.shortcuts.find(s => s.id === shortcutId);
            if (!shortcut) {
                throw new Error('Shortcut not found');
            }

            if (!wsClient || !wsClient.isConnected()) {
                throw new Error('WebSocket not connected');
            }

            // Create a copy of the shortcut without internal flags
            const shortcutCopy = { ...shortcut };
            delete shortcutCopy._isNew;
            delete shortcutCopy._isModified;
            delete shortcutCopy._isDeleted;

            // Add shortcut to target workspace
            await wsClient.addDesktopShortcut(targetWorkspaceId, shortcutCopy);

            // Remove shortcut from current workspace using debounced save
            await this.removeShortcut(shortcutId);

            if (!silent) {
                showGlassToast('success', null, `Shortcut moved to ${workspaces[targetWorkspaceId]?.name || targetWorkspaceId}`, false, 3000, '<i class="fas fa-arrow-right"></i>');
            }
        } catch (error) {
            console.error('Failed to move desktop shortcut:', error);
            showGlassToast('error', 'Error', 'Failed to move shortcut', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            throw error;
        }
    }
}

// Initialize global desktop shortcuts manager
desktopShortcuts = new DesktopShortcutsManager();

// Register initialization step (after wallpaper and taskbar are loaded)
wsClient.registerInitStep(18, 'Loading Desktop Shortcuts', async () => {
    // Only initialize and load desktop shortcuts if in desktop mode
    if (window.isDesktop) {
        desktopShortcuts.init();
        
        // Load and render shortcuts for current workspace
        // activeWorkspace is set in step 12 (Loading Workspaces)
        if (typeof activeWorkspace !== 'undefined') {
            desktopShortcuts.currentWorkspace = activeWorkspace;
            await desktopShortcuts.loadShortcuts(activeWorkspace);
            desktopShortcuts.renderShortcuts();
            applyDesktopWindowPositionsAfterLoad();
        }
    }
});

// Handle context menu actions for shortcuts
document.addEventListener('contextMenuAction', async (event) => {
    const { action, target } = event.detail;

    // public/scripts/comp/explorerApplet.js isDesktopSurfaceContextTarget
    if (isDesktopSurfaceContextTarget(target)) return;
    
    // Check if this is a desktop shortcut
    const shortcutElement = target.closest('.desktop-shortcut');
    if (!shortcutElement) return;
    
    const shortcutId = shortcutElement.dataset.shortcutId;
    const shortcut = desktopShortcuts.shortcuts.find(s => s.id === shortcutId);
    if (!shortcut) return;
    
    // Create a synthetic event for positioning dialogs near the shortcut
    const rect = shortcutElement.getBoundingClientRect();
    const syntheticEvent = {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        target: shortcutElement
    };

    const explorer = typeof initializeExplorerApplet === 'function'
        ? initializeExplorerApplet()
        : explorerApplet;

    if (explorer && (action.startsWith('explorer-') || action === 'remove-shortcut')) {
        const item = explorer._shortcutToExplorerItem(shortcut, { isDesktopShortcut: true });
        explorer._contextMenuTarget = item;
        if (await explorer.handleDesktopShortcutExplorerAction(action, item, event)) return;
    }

    if (shortcut.type === 'image' && explorer) {
        const item = explorer._shortcutToExplorerItem(shortcut, { isDesktopShortcut: true });
        explorer._contextMenuTarget = item;

        // public/scripts/comp/explorerApplet.js EXPLORER_IMAGE_GALLERY_CONTEXT_ACTIONS
        if (EXPLORER_IMAGE_GALLERY_CONTEXT_ACTIONS.has(action)) {
            if (await explorer._handleImageGalleryContextAction(action, item, event)) return;
        }
    }

    if (shortcut.type === 'reference' && explorer && action.startsWith('reference-manager-')) {
        const item = explorer._shortcutToExplorerItem(shortcut, { isDesktopShortcut: true });
        explorer._contextMenuTarget = item;
        if (await explorer._handleReferenceContextAction(action, item)) return;
    }

    if (shortcut.type === 'note' && explorer) {
        const item = explorer._shortcutToExplorerItem(shortcut, { isDesktopShortcut: true });
        explorer._contextMenuTarget = item;
        // public/scripts/comp/explorerApplet.js _handleNoteContextAction
        const noteActions = new Set(['open-in-window', 'add-to-desktop', 'modify-note', 'delete-note']);
        if (noteActions.has(action)) {
            if (await explorer._handleNoteContextAction(action, item)) return;
        }
    }
    
    switch (action) {
        case 'open-folder-shortcut':
            if (shortcut.type === 'folder') {
                desktopShortcuts.handleFolderClick(shortcut);
            }
            break;

        case 'create-folder-from-selection':
            await desktopShortcuts.createFolderFromSelection();
            break;

        case 'rename-shortcut':
            // Show rename dialog with input
            const newName = await showInputDialog(
                'Rename Shortcut',
                shortcut.name,
                'Enter shortcut name',
                [
                    { text: 'Rename', value: true, className: 'btn-primary' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ],
                syntheticEvent
            );
            
            if (newName && newName !== shortcut.name) {
                await desktopShortcuts.renameShortcut(shortcutId, newName);
            }
            break;
            
        case 'remove-shortcut':
            if (shortcut.type === 'folder') {
                const folderDeleteConfirmed = await showConfirmationDialog(
                    desktopShortcuts.getFolderDeleteConfirmMessage(shortcut),
                    [
                        { text: 'Delete', value: true, className: 'btn-danger' },
                        { text: 'Cancel', value: false, className: 'btn-secondary' }
                    ],
                    syntheticEvent
                );
                if (folderDeleteConfirmed) {
                    try {
                        await desktopShortcuts.deleteFolderShortcut(shortcutId);
                    } catch (error) {
                        console.error('Failed to delete folder:', error);
                        showGlassToast('error', 'Error', error.message || 'Failed to delete folder', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                    }
                }
                break;
            }
            if (desktopShortcuts.getSelectedCount() > 1 && desktopShortcuts.isShortcutSelected(shortcutId)) {
                await desktopShortcuts.removeSelectedShortcuts();
                break;
            }
            // Show confirmation dialog
            const confirmed = await showConfirmationDialog(
                `Remove "${shortcut.name}"?`,
                [
                    { text: 'Remove', value: true, className: 'btn-danger' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ],
                syntheticEvent
            );
            
            if (confirmed) {
                await desktopShortcuts.removeShortcut(shortcutId);
            }
            break;

        case 'delete-folder-shortcut': {
            const deleteFolderConfirmed = await showConfirmationDialog(
                desktopShortcuts.getFolderDeleteConfirmMessage(shortcut),
                [
                    { text: 'Delete', value: true, className: 'btn-danger' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ],
                syntheticEvent
            );
            if (deleteFolderConfirmed) {
                try {
                    await desktopShortcuts.deleteFolderShortcut(shortcutId);
                } catch (error) {
                    console.error('Failed to delete folder:', error);
                    showGlassToast('error', 'Error', error.message || 'Failed to delete folder', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                }
            }
            break;
        }

        case 'incinerate-shortcut-target':
        case 'delete-note-shortcut-target':
        case 'destroy-reference-shortcut-target': {
            const confirmMessages = {
                'incinerate-shortcut-target': `Permanently delete image "${shortcut.name}" and remove its desktop shortcut?`,
                'delete-note-shortcut-target': `Permanently delete note "${shortcut.name}" and remove its desktop shortcut?`,
                'destroy-reference-shortcut-target': `Permanently destroy reference "${shortcut.name}" and remove its desktop shortcut?`
            };
            const confirmLabels = {
                'incinerate-shortcut-target': 'Incinerate',
                'delete-note-shortcut-target': 'Delete',
                'destroy-reference-shortcut-target': 'Destroy'
            };
            const deleteConfirmed = await showConfirmationDialog(
                confirmMessages[action],
                [
                    { text: confirmLabels[action], value: true, className: 'btn-danger' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ],
                syntheticEvent
            );
            if (deleteConfirmed) {
                try {
                    await desktopShortcuts.permanentlyDeleteShortcutTarget(shortcut);
                } catch (error) {
                    console.error('Failed to permanently delete shortcut target:', error);
                    showGlassToast('error', 'Error', error.message || 'Delete failed', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                }
            }
            break;
        }
            
        case 'move-shortcut-to-workspace':
            // Get workspace data from item
            const { item } = event.detail;
            if (item && item.data && item.data.workspaceId) {
                const targetWorkspaceId = item.data.workspaceId;
                if (desktopShortcuts.getSelectedCount() > 1 && desktopShortcuts.isShortcutSelected(shortcutId)) {
                    await desktopShortcuts.moveSelectedShortcutsToWorkspace(targetWorkspaceId);
                } else {
                    await desktopShortcuts.moveShortcutToWorkspace(shortcutId, targetWorkspaceId);
                }
            }
            break;
            
        case 'open-in-studio':
            if (shortcut.type === 'image' && shortcut.data && shortcut.data.filename) {
                // Find image in allImages gallery
                const filename = shortcut.data.filename;
                let image = null;
                
                if (allImages && allImages.length > 0) {
                    image = allImages.find(img => 
                        img.filename === filename || 
                        img.original === filename || 
                        img.upscaled === filename
                    );
                }
                
                if (image) {
                    openManualModalWithContent({
                        type: 'image',
                        image: image
                    }, syntheticEvent);
                } else {
                    showGlassToast('warning', 'Not Available', 'Could not load image data', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                }
            }
            break;
            
        case 'download-image':
            if (shortcut.type === 'image' && shortcut.data && shortcut.data.filename) {
                // Create download link
                const filename = shortcut.data.filename;
                const link = document.createElement('a');
                link.href = `/images/${filename}`;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                showGlassToast('success', null, 'Download started', false, 3000, '<i class="fas fa-download"></i>');
            }
            break;

        case 'nax-tag-copy':
            if (shortcut.type === 'nax-tag' && shortcut.data && shortcut.data.tag && window.naxtApplet) {
                window.naxtApplet.copyTag(shortcut.data.tag);
            }
            break;

        case 'nax-tag-add-to-prompt':
            if (shortcut.type === 'nax-tag' && shortcut.data && shortcut.data.tag && window.naxtApplet) {
                window.naxtApplet.addToPrompt(shortcut.data.tag, shortcut.data.gallerySlug);
            }
            break;
            
        case 'copy-to-clipboard':
            if (shortcut.type === 'image' && shortcut.data && shortcut.data.filename) {
                // Copy image to clipboard
                const filename = shortcut.data.filename;
                if (typeof copyImageToClipboard === 'function') {
                    // Create minimal image object for the copy function
                    copyImageToClipboard({ 
                        filename: filename,
                        original: filename,
                        upscaled: null
                    });
                } else {
                    showGlassToast('warning', 'Not Available', 'Copy function not available', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                }
            }
            break;
            
        case 'jump-to-workspace':
            if (shortcut.type === 'image' && shortcut.data && shortcut.data.filename) {
                // Find image in gallery and jump to it
                const filename = shortcut.data.filename;
                
                // Helper function to find image index and jump
                const jumpToImage = async () => {
                    // Find the image in allImages
                    let imageIndex = -1;
                    if (typeof allImages !== 'undefined' && Array.isArray(allImages) && allImages.length > 0) {
                        imageIndex = allImages.findIndex(img => 
                            img.filename === filename || 
                            img.original === filename || 
                            img.upscaled === filename
                        );
                    }
                    
                    if (imageIndex === -1) {
                        // Image not found in current gallery, try loading gallery first
                        if (typeof loadGallery === 'function') {
                            await loadGallery();
                            // Try finding again after load
                            if (typeof allImages !== 'undefined' && Array.isArray(allImages) && allImages.length > 0) {
                                imageIndex = allImages.findIndex(img => 
                                    img.filename === filename || 
                                    img.original === filename || 
                                    img.upscaled === filename
                                );
                            }
                        }
                    }
                    
                    if (imageIndex === -1) {
                        showGlassToast('warning', 'Not Found', 'Image not found in workspace', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                        return;
                    }
                    
                    // Use filtered index if filtering is active
                    let targetIndex = imageIndex;
                    if (typeof window.filteredImageIndices !== 'undefined' && Array.isArray(window.filteredImageIndices)) {
                        const filteredIndex = window.filteredImageIndices.indexOf(imageIndex);
                        if (filteredIndex !== -1) {
                            targetIndex = filteredIndex;
                        } else {
                            // Image is filtered out, show message
                            showGlassToast('warning', 'Not Visible', 'Image is filtered out of current view', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                            return;
                        }
                    }
                    
                    // Jump to the image using displayGalleryFromStartIndex
                    await displayGalleryFromStartIndex(targetIndex, true);
                };
                
                // Check if gallery window is hidden/closed
                const galleryWindow = document.getElementById('galleryWindow');
                if (galleryWindow) {
                    // Check if gallery is hidden (windowed mode and has 'hidden' class)
                    const isWindowed = galleryWindow.classList.contains('windowed');
                    const isHidden = galleryWindow.classList.contains('hidden');
                    const needsOpen = isWindowed && isHidden;
                    
                    if (needsOpen) {
                        // Open gallery window first
                        if (typeof showGalleryWindow === 'function') {
                            showGalleryWindow();
                        } else if (typeof openModal === 'function') {
                            openModal(galleryWindow);
                            // Mark as visible if the function exists
                            if (typeof window.isGalleryHidden !== 'undefined') {
                                window.isGalleryHidden = false;
                            }
                        }
                        
                        // Wait for gallery to load, then jump
                        const waitForGallery = () => {
                            return new Promise((resolve) => {
                                // Check if gallery is already loaded
                                if (typeof allImages !== 'undefined' && Array.isArray(allImages) && allImages.length > 0) {
                                    resolve();
                                    return;
                                }
                                
                                // Wait for gallery to load
                                const checkInterval = setInterval(() => {
                                    if (typeof allImages !== 'undefined' && Array.isArray(allImages) && allImages.length > 0) {
                                        clearInterval(checkInterval);
                                        resolve();
                                    }
                                }, 100);
                                
                                // Timeout after 5 seconds
                                setTimeout(() => {
                                    clearInterval(checkInterval);
                                    resolve();
                                }, 5000);
                            });
                        };
                        
                        await waitForGallery();
                        await jumpToImage();
                    } else {
                        // Gallery is already open, just jump
                        await jumpToImage();
                    }
                } else {
                    // No gallery window, just try to jump (might work in non-desktop mode)
                    await jumpToImage();
                }
            }
            break;
            
        case 'preset-generate':
            if (shortcut.type === 'preset' && shortcut.data && shortcut.data.uuid) {
                try {
                    // Resolve UUID to preset name by loading the preset
                    if (wsClient && wsClient.isConnected()) {
                        const presetData = await wsClient.loadPreset({ presetUuid: shortcut.data.uuid });
                        if (presetData && presetData.preset_name) {
                            // Use the resolved preset name to generate
                            const workspace = typeof currentWorkspace !== 'undefined' ? currentWorkspace : null;
                            const toastId = showGlassToast('info', 'Generating...', `Starting generation for preset "${shortcut.name}"`, true);
                            
                            try {
                                const result = await wsClient.generatePreset(presetData.preset_name, workspace);
                                
                                updateGlassToastComplete(toastId, {
                                    type: 'success',
                                    title: 'Generation Complete',
                                    message: `Generated image from preset "${shortcut.name}"`,
                                    customIcon: '<i class="fas fa-check"></i>',
                                    showProgress: false
                                });
                            } catch (error) {
                                updateGlassToastComplete(toastId, {
                                    type: 'error',
                                    title: 'Generation Failed',
                                    message: error.message,
                                    customIcon: '<i class="nai-cross"></i>',
                                    showProgress: false
                                });
                            }
                        } else {
                            throw new Error('Could not resolve preset from UUID');
                        }
                    } else {
                        throw new Error('WebSocket not connected');
                    }
                } catch (error) {
                    console.error('Failed to generate from preset UUID:', error);
                    showGlassToast('error', 'Error', 'Failed to generate: ' + error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                }
            }
            break;
            
        case 'preset-edit-studio':
            if (shortcut.type === 'preset' && shortcut.data && shortcut.data.uuid) {
                await openManualModalWithContent({ type: 'preset', uuid: shortcut.data.uuid, title: shortcut.name });
            }
            break;
            
        case 'preset-copy-url':
            if (shortcut.type === 'preset' && shortcut.data && shortcut.data.uuid) {
                // Copy preset URL to clipboard
                const presetURL = location.origin + '/preset/' + shortcut.data.uuid + '?download=true';
                try {
                    await navigator.clipboard.writeText(presetURL);
                    showGlassToast('success', null, 'Preset URL copied to clipboard', false, 3000, '<i class="fa-regular fa-clipboard"></i>');
                } catch (error) {
                    console.error('Failed to copy URL:', error);
                    showGlassToast('error', null, 'Failed to copy URL', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                }
            }
            break;
    }
});

