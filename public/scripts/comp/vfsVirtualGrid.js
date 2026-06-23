// Virtual scroll grid for Explorer — public/scripts/comp/vfsVirtualGrid.js

const EXPLORER_AUTO_DETAILS_THRESHOLD = 500;

var EXPLORER_VIEW_MODES = {
    'icons-xl': { label: 'Extra Large Icons', rowHeight: 240, cellWidth: 216, columns: 8, type: 'icons', iconSize: 'xl' },
    'icons-lg': { label: 'Large Icons', rowHeight: 176, cellWidth: 144, columns: 10, type: 'icons', iconSize: 'lg' },
    'icons-md': { label: 'Medium Icons', rowHeight: 140, cellWidth: 112, columns: 12, type: 'icons', iconSize: 'md' },
    'icons-sm': { label: 'Small Icons', rowHeight: 88, cellWidth: 64, columns: 14, type: 'icons', iconSize: 'sm' },
    'list': { label: 'List', rowHeight: 28, cellWidth: 0, columns: 1, type: 'list', iconSize: 'row' },
    'details': { label: 'Details', rowHeight: 28, cellWidth: 0, columns: 1, type: 'details', iconSize: 'row' }
};

class VfsVirtualGrid {
    constructor(container, options = {}) {
        this.container = container;
        this.viewMode = options.viewMode || 'icons-lg';
        this.onItemOpen = options.onItemOpen || (() => {});
        this.onSelectionChange = options.onSelectionChange || (() => {});
        this.onItemContextMenu = options.onItemContextMenu || (() => {});
        this.onNearEnd = options.onNearEnd || (() => {});
        this.onItemDrop = options.onItemDrop || (() => {});
        this.onFileDrop = options.onFileDrop || (() => {});
        this.onItemsDrop = options.onItemsDrop || (() => {});
        this.populateIconBox = options.populateIconBox || null;
        this.items = [];
        this.selectedIds = new Set();
        this.anchorIndex = null;
        this.scrollEl = null;
        this.spacerEl = null;
        this.contentEl = null;
        this.visibleStart = -1;
        this.visibleEnd = -1;
        this.bufferRows = 8;
        this._interactionBlocked = false;
        this._loadEndThreshold = 200;
        this._loadingMoreVisible = false;
        this._openingItemId = null;
        this._dragThreshold = 5;
        this._suppressNextClick = false;
        this._bodyMarqueeEl = null;
        this._scrollRaf = 0;
        this._nearEndScrollHeight = 0;
        this._mounted = new Map();
        this._nodePool = new Map();
        this._onScroll = this._onScroll.bind(this);
        this._buildDom();
    }

    _getScrollEl() {
        return this.scrollEl;
    }

    _buildDom() {
        this.container.innerHTML = '';
        this.scrollEl = document.createElement('div');
        this.scrollEl.className = 'explorer-grid-scroll';
        this.spacerEl = document.createElement('div');
        this.spacerEl.className = 'explorer-grid-spacer';
        this.contentEl = document.createElement('div');
        this.contentEl.className = 'explorer-grid-content';
        this.loadMoreEl = document.createElement('div');
        this.loadMoreEl.className = 'explorer-load-more-foot hidden';
        this.loadMoreEl.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Loading more…</span>';
        this.scrollEl.appendChild(this.spacerEl);
        this.scrollEl.appendChild(this.contentEl);
        this.scrollEl.appendChild(this.loadMoreEl);
        this.container.appendChild(this.scrollEl);
        this.scrollEl.addEventListener('scroll', () => this._scheduleScrollUpdate(), { passive: true });
        this.scrollEl.addEventListener('mousedown', (e) => this._handleMarqueeStart(e));

        const bindDropZone = (el) => {
            el.addEventListener('dragover', (e) => {
                const types = e.dataTransfer?.types || [];
                if (types.includes('Files')) {
                    e.preventDefault();
                    this.container.classList.add('explorer-drop-target');
                }
            });
            el.addEventListener('dragleave', (e) => {
                if (!el.contains(e.relatedTarget)) {
                    this.container.classList.remove('explorer-drop-target');
                }
            });
            el.addEventListener('drop', (e) => {
                if (e.target.closest('.explorer-item')) return;
                const files = [...(e.dataTransfer?.files || [])];
                if (!files.length) return;
                e.preventDefault();
                this.container.classList.remove('explorer-drop-target');
                this.onFileDrop(files, e);
            });
        };
        bindDropZone(this.scrollEl);
    }

    _ensureBodyMarqueeEl() {
        if (this._bodyMarqueeEl) return this._bodyMarqueeEl;
        this._bodyMarqueeEl = document.createElement('div');
        this._bodyMarqueeEl.className = 'explorer-selection-marquee hidden';
        document.body.appendChild(this._bodyMarqueeEl);
        return this._bodyMarqueeEl;
    }

    _handleMarqueeStart(event) {
        if (this._interactionBlocked || event.button !== 0) return;
        if (event.target.closest('.explorer-item, .custom-scrollbar-thumb, .custom-scrollbar, .explorer-load-more-foot')) return;
        if (!this.container.contains(event.target)) return;

        const addToSelection = event.ctrlKey || event.metaKey;
        const baseSelection = addToSelection ? new Set(this.selectedIds) : new Set();
        if (!addToSelection) this.clearSelection();

        const startX = event.clientX;
        const startY = event.clientY;
        let dragged = false;
        const marqueeEl = this._ensureBodyMarqueeEl();

        marqueeEl.classList.remove('hidden');
        marqueeEl.style.left = `${startX}px`;
        marqueeEl.style.top = `${startY}px`;
        marqueeEl.style.width = '0px';
        marqueeEl.style.height = '0px';
        this.container.classList.add('explorer-marquee-active');

        const onMove = (e) => {
            dragged = true;
            e.preventDefault();
            const left = Math.min(startX, e.clientX);
            const top = Math.min(startY, e.clientY);
            const width = Math.abs(e.clientX - startX);
            const height = Math.abs(e.clientY - startY);
            marqueeEl.style.left = `${left}px`;
            marqueeEl.style.top = `${top}px`;
            marqueeEl.style.width = `${width}px`;
            marqueeEl.style.height = `${height}px`;
            if (width < 4 && height < 4) return;
            const rect = { left, top, right: left + width, bottom: top + height };
            this._applyMarqueeSelection(rect, baseSelection, addToSelection);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            marqueeEl.classList.add('hidden');
            this.container.classList.remove('explorer-marquee-active');
            if (!dragged && !addToSelection) this.clearSelection();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        event.preventDefault();
    }

    _rectsIntersect(a, b) {
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }

    _applyMarqueeSelection(clientRect, baseSelection, addToSelection) {
        const hits = new Set(addToSelection ? baseSelection : []);
        this.contentEl.querySelectorAll('.explorer-item').forEach((el) => {
            const id = el.dataset.itemId;
            const item = this.items.find(i => i.id === id);
            if (!item || item.isUploadPlaceholder) return;
            if (this._rectsIntersect(clientRect, el.getBoundingClientRect())) {
                hits.add(id);
            }
        });
        this.selectedIds = hits;
        this._updateSelectionClasses();
        this.onSelectionChange(this.getSelectedItems());
    }

    _buildDragPayload(item) {
        const sel = this.getSelectedItems();
        const items = sel.some(s => s.id === item.id) ? sel : [item];
        return items
            .filter(i => !i.isUploadPlaceholder && !i.system)
            .map(i => ({
                id: i.id,
                name: i.name,
                kind: i.kind,
                targetKind: i.targetKind,
                targetId: i.targetId,
                isShortcut: !!i.isShortcut,
                isDesktopShortcut: !!i.isDesktopShortcut,
                isVfsShortcutEntry: !!(i.isVfsShortcutEntry || (i.isShortcut && i.shortcutType && !i.isDesktopShortcut)),
                vfsEntryId: (i.isVfsShortcutEntry || (i.isShortcut && i.shortcutType && !i.isDesktopShortcut)) ? i.id : undefined,
                shortcutType: i.shortcutType,
                shortcutId: i.isDesktopShortcut ? i.id : undefined,
                shortcutData: i.shortcutData,
                workspaceId: i.workspaceId,
                navPath: i.navPath
            }));
    }

    _clearDropHighlight() {
        this.contentEl?.querySelectorAll('.explorer-item-drop-target').forEach((el) => {
            el.classList.remove('explorer-item-drop-target');
        });
        document.getElementById('desktopGridContainer')?.classList.remove('explorer-desktop-drop-target');
        document.getElementById('desktopFreeformContainer')?.classList.remove('explorer-desktop-drop-target');
    }

    _updateDropHighlight(clientX, clientY) {
        this._clearDropHighlight();
        const hit = document.elementFromPoint(clientX, clientY);
        if (!hit) return;

        const folderEl = hit.closest('.explorer-item-folder, .explorer-item[data-item-id]');
        if (folderEl?.closest('#explorerGridHost')) {
            const folderItem = this.items.find(i => i.id === folderEl.dataset.itemId);
            if (folderItem && this._isFolderItem(folderItem)) {
                folderEl.classList.add('explorer-item-drop-target');
            }
        }

        const explorerModal = document.getElementById('explorerModal');
        const overExplorer = explorerModal && !explorerModal.classList.contains('hidden') && explorerModal.contains(hit);
        if (!overExplorer) {
            const desktop = hit.closest('#desktopGridContainer, #desktopFreeformContainer');
            if (desktop) desktop.classList.add('explorer-desktop-drop-target');
        }
    }

    _resolveDropTarget(clientX, clientY) {
        const hit = document.elementFromPoint(clientX, clientY);
        if (!hit) return null;

        const explorerModal = document.getElementById('explorerModal');
        const overExplorer = explorerModal && !explorerModal.classList.contains('hidden') && explorerModal.contains(hit);

        if (!overExplorer) {
            const desktop = hit.closest('#desktopGridContainer, #desktopFreeformContainer');
            if (desktop && document.body.classList.contains('desktop-mode')) {
                return { type: 'desktop' };
            }
        }

        const folderEl = hit.closest('.explorer-item-folder, .explorer-item[data-item-id]');
        if (folderEl?.closest('#explorerGridHost')) {
            const item = this.items.find(i => i.id === folderEl.dataset.itemId);
            if (item && this._isFolderItem(item)) {
                return { type: 'folder', item };
            }
        }
        return null;
    }

    _handleItemDragStart(event, item) {
        if (this._interactionBlocked || item.isUploadPlaceholder || item.system) return;
        if (event.button !== 0) return;

        const payload = this._buildDragPayload(item);
        if (!payload.length) return;

        const startX = event.clientX;
        const startY = event.clientY;
        let dragging = false;

        const onMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!dragging && Math.hypot(dx, dy) < this._dragThreshold) return;
            if (!dragging) {
                dragging = true;
                this._suppressNextClick = true;
                this.container.classList.add('explorer-item-drag-active');
            }
            e.preventDefault();
            this._updateDropHighlight(e.clientX, e.clientY);
        };

        const onUp = (e) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            this._clearDropHighlight();
            this.container.classList.remove('explorer-item-drag-active');
            if (dragging) {
                const target = this._resolveDropTarget(e.clientX, e.clientY);
                if (target) this.onItemsDrop(payload, target);
            }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    setInteractionBlocked(blocked) {
        this._interactionBlocked = !!blocked;
    }

    setLoadingMore(loading) {
        this._loadingMoreVisible = !!loading;
        if (!this.loadMoreEl) return;
        this.loadMoreEl.classList.toggle('hidden', !this._loadingMoreVisible);
        if (this._loadingMoreVisible) this._positionLoadMoreFoot();
    }

    setOpeningItemId(itemId) {
        this._openingItemId = itemId || null;
        this._updateOpeningClasses();
    }

    _positionLoadMoreFoot() {
        if (!this.loadMoreEl || !this.spacerEl) return;
        this.loadMoreEl.style.top = `${this.spacerEl.offsetHeight}px`;
    }

    _updateOpeningClasses() {
        if (!this.contentEl) return;
        this.contentEl.querySelectorAll('.explorer-item').forEach(el => {
            el.classList.toggle('explorer-item-opening', !!this._openingItemId && el.dataset.itemId === this._openingItemId);
        });
    }

    setViewMode(mode) {
        if (!EXPLORER_VIEW_MODES[mode]) return;
        this.viewMode = mode;
        this._refreshViewLayout();
    }

    _refreshViewLayout() {
        this._releaseAllMounted();
        this._nodePool.clear();
        this.visibleStart = -1;
        this.visibleEnd = -1;
        this._updateSpacer();
        this._scheduleScrollUpdate();
    }

    resetItems(items) {
        this.items = items || [];
        this._pruneSelection();
        this._releaseAllMounted();
        this._nodePool.clear();
        this.visibleStart = -1;
        this.visibleEnd = -1;
        if (this.scrollEl) this.scrollEl.scrollTop = 0;
        this._nearEndScrollHeight = 0;
        this._updateSpacer();
        this._scheduleScrollUpdate();
    }

    replaceItems(items) {
        this.items = items || [];
        this._pruneSelection();
        this._releaseAllMounted();
        this._nodePool.clear();
        this.visibleStart = -1;
        this.visibleEnd = -1;
        this._nearEndScrollHeight = 0;
        this._updateSpacer();
        this._scheduleScrollUpdate();
    }

    appendItems(items) {
        if (!items?.length) return;
        this.items = this.items.concat(items);
        this._updateSpacer();
        this._scheduleScrollUpdate();
    }

    /** Grow item list without remounting visible rows (pagination). Caller passes the full merged array. */
    extendItems(items) {
        this.items = items || [];
        this._updateSpacer();
        this._scheduleScrollUpdate();
    }

    setItems(items) {
        this.replaceItems(items);
    }

    _scheduleScrollUpdate() {
        if (this._scrollRaf) return;
        this._scrollRaf = requestAnimationFrame(() => {
            this._scrollRaf = 0;
            this._onScroll();
        });
    }

    _checkNearEnd() {
        const scrollEl = this._getScrollEl();
        if (!scrollEl) return;
        const { scrollTop, clientHeight, scrollHeight } = scrollEl;
        if (scrollTop + clientHeight >= scrollHeight - this._loadEndThreshold) {
            if (this._nearEndScrollHeight !== scrollHeight) {
                this._nearEndScrollHeight = scrollHeight;
                this.onNearEnd();
            }
        }
    }

    _releaseIndex(idx) {
        const el = this._mounted.get(idx);
        if (!el) return;
        this._mounted.delete(idx);
        const itemId = el.dataset.itemId;
        if (itemId && this._nodePool.size < 120) this._nodePool.set(itemId, el);
        el.remove();
    }

    _releaseAllMounted() {
        for (const idx of [...this._mounted.keys()]) {
            this._releaseIndex(idx);
        }
        if (this.contentEl) this.contentEl.replaceChildren();
    }

    _updateSpacer() {
        const mode = this._getMode();
        const rowCount = this._getRowCount();
        this.spacerEl.style.height = `${rowCount * mode.rowHeight}px`;
        if (this._loadingMoreVisible) this._positionLoadMoreFoot();
    }

    needsMoreContent() {
        const scrollEl = this._getScrollEl();
        if (!scrollEl) return false;
        const { clientHeight, scrollHeight } = scrollEl;
        return scrollHeight <= clientHeight + this._loadEndThreshold;
    }

    getSelectedItems() {
        return this.items.filter(i => this.selectedIds.has(i.id));
    }

    clearSelection() {
        this.selectedIds.clear();
        this.anchorIndex = null;
        this._updateSelectionClasses();
        this.onSelectionChange(this.getSelectedItems());
    }

    selectAll() {
        this.items.forEach(i => {
            if (!i.isUploadPlaceholder) this.selectedIds.add(i.id);
        });
        this._updateSelectionClasses();
        this.onSelectionChange(this.getSelectedItems());
    }

    _pruneSelection() {
        if (!this.selectedIds.size) return;
        const validIds = new Set(this.items.map(i => i.id));
        for (const id of [...this.selectedIds]) {
            if (!validIds.has(id)) this.selectedIds.delete(id);
        }
        if (this.anchorIndex != null && !this.items[this.anchorIndex]) {
            this.anchorIndex = null;
        }
    }

    _getMode() {
        return EXPLORER_VIEW_MODES[this.viewMode] || EXPLORER_VIEW_MODES['icons-lg'];
    }

    _getColumnCount() {
        const mode = this._getMode();
        if (mode.type !== 'icons') return 1;
        const w = this._getScrollEl().clientWidth || 600;
        const cellW = mode.cellWidth || mode.rowHeight;
        return Math.max(1, Math.floor(w / cellW));
    }

    _getRowCount() {
        const cols = this._getColumnCount();
        return Math.ceil(this.items.length / cols) || 0;
    }

    _getVisibleIndices() {
        const mode = this._getMode();
        const cols = this._getColumnCount();
        const indices = [];
        for (let row = this.visibleStart; row < this.visibleEnd; row++) {
            for (let col = 0; col < cols; col++) {
                const idx = row * cols + col;
                if (idx >= this.items.length) break;
                indices.push(idx);
            }
        }
        return indices;
    }

    _onScroll() {
        const mode = this._getMode();
        const scrollEl = this._getScrollEl();
        const scrollTop = scrollEl.scrollTop;
        const viewH = scrollEl.clientHeight;
        const scrollH = scrollEl.scrollHeight;
        const startRow = Math.max(0, Math.floor(scrollTop / mode.rowHeight) - this.bufferRows);
        const endRow = Math.min(this._getRowCount(), Math.ceil((scrollTop + viewH) / mode.rowHeight) + this.bufferRows);
        if (startRow !== this.visibleStart || endRow !== this.visibleEnd) {
            this.visibleStart = startRow;
            this.visibleEnd = endRow;
            this._renderWindow();
        }
        if (scrollTop + viewH >= scrollH - this._loadEndThreshold) {
            if (this._nearEndScrollHeight !== scrollH) {
                this._nearEndScrollHeight = scrollH;
                this.onNearEnd();
            }
        } else if (scrollTop + viewH < scrollH - this._loadEndThreshold * 2) {
            this._nearEndScrollHeight = 0;
        }
    }

    _getOrCreateNode(item, idx, mode) {
        let el = this._nodePool.get(item.id);
        if (el) {
            this._nodePool.delete(item.id);
            this._patchItemElement(el, item, idx, mode);
        } else {
            el = this._createItemElement(item, idx, mode);
        }
        this._applyItemLayout(el, mode);
        return el;
    }

    _applyItemLayout(el, mode) {
        if (mode.type === 'icons') {
            el.style.width = `${mode.cellWidth}px`;
            el.style.flexShrink = '0';
            el.style.height = `${mode.rowHeight}px`;
        } else {
            el.style.height = `${mode.rowHeight}px`;
        }
    }

    _patchItemElement(el, item, index, mode) {
        el.dataset.itemIndex = String(index);
        el.classList.toggle('selected', this.selectedIds.has(item.id));
        el.classList.toggle('explorer-item-opening', this._openingItemId === item.id);
        el.classList.toggle('explorer-item-upload-pending', !!item.isUploadPlaceholder);
        const label = el.querySelector('.explorer-item-name, .explorer-item-label, .explorer-item-list-label');
        const name = item.name || '';
        if (label && label.textContent !== name) label.textContent = name;
        if (mode.type === 'details') {
            const date = el.querySelector('.explorer-item-date');
            const type = el.querySelector('.explorer-item-type');
            const size = el.querySelector('.explorer-item-size');
            const dateText = this._formatDate(item.modifiedAt);
            const typeText = this._formatTypeLabel(item);
            const sizeText = this._formatSize(item.size);
            if (date && date.textContent !== dateText) date.textContent = dateText;
            if (type && type.textContent !== typeText) type.textContent = typeText;
            if (size && size.textContent !== sizeText) size.textContent = sizeText;
        }
        this._syncItemIconBox(el, item);
    }

    _syncItemIconBox(el, item) {
        const box = el.querySelector('.explorer-item-icon-box');
        if (!box) return;
        this._syncIconBoxContent(box, item);
    }

    _syncIconBoxContent(box, item) {
        if (this.populateIconBox) {
            const key = `${item.id}|${item.modifiedAt || ''}|${item.previewUrl || ''}`;
            if (box.dataset.iconKey !== key) {
                box.dataset.iconKey = key;
                box.classList.remove('has-preview');
                this.populateIconBox(box, item);
            }
            return;
        }

        let icon = box.querySelector('.explorer-item-type-icon');
        const iconClass = item.icon || 'fas fa-file';
        if (!icon) {
            icon = document.createElement('i');
            box.appendChild(icon);
        }
        icon.className = `${iconClass} explorer-item-type-icon`;

        let img = box.querySelector('.explorer-item-preview-img');
        if (item.previewUrl) {
            if (!img) {
                img = document.createElement('img');
                img.className = 'explorer-item-preview-img';
                img.alt = '';
                img.loading = 'lazy';
                img.addEventListener('load', () => box.classList.add('has-preview'));
                img.addEventListener('error', () => {
                    img.remove();
                    box.classList.remove('has-preview');
                });
                box.appendChild(img);
            }
            const nextSrc = item.previewUrl;
            if (img.getAttribute('src') !== nextSrc) {
                box.classList.remove('has-preview');
                img.src = nextSrc;
            }
        } else {
            if (img) img.remove();
            box.classList.remove('has-preview');
        }
    }

    _renderWindow() {
        const mode = this._getMode();
        const cols = this._getColumnCount();
        const topPx = `${this.visibleStart * mode.rowHeight}px`;
        if (this.contentEl.style.top !== topPx) {
            this.contentEl.style.top = topPx;
        }

        const wantIndices = this._getVisibleIndices();
        const wantSet = new Set(wantIndices);

        for (const idx of [...this._mounted.keys()]) {
            if (!wantSet.has(idx)) this._releaseIndex(idx);
        }

        const fragment = document.createDocumentFragment();
        for (const idx of wantIndices) {
            const item = this.items[idx];
            let el = this._mounted.get(idx);
            if (!el) {
                el = this._getOrCreateNode(item, idx, mode);
                this._mounted.set(idx, el);
            } else {
                this._patchItemElement(el, item, idx, mode);
                this._applyItemLayout(el, mode);
            }
            fragment.appendChild(el);
        }
        this.contentEl.appendChild(fragment);
    }

    _resolveIndex(item, hintIndex) {
        if (hintIndex != null && this.items[hintIndex]?.id === item.id) return hintIndex;
        return this.items.findIndex(i => i.id === item.id);
    }

    _createIconBox(item, size) {
        const box = document.createElement('div');
        box.className = `explorer-item-icon-box explorer-item-icon-box-${size}`;
        this._syncIconBoxContent(box, item);
        return box;
    }

    _formatTypeLabel(item) {
        if (item.mimeType) return item.mimeType;
        if (item.targetKind === 'desktop-shortcut' && item.shortcutType) return item.shortcutType;
        return item.targetKind || item.kind || '';
    }

    _createItemElement(item, index, mode) {
        const el = document.createElement('div');
        el.className = 'explorer-item';
        el.dataset.itemId = item.id;
        el.dataset.itemIndex = String(index);
        if (item.kind === 'folder') el.classList.add('explorer-item-folder');
        if (this.selectedIds.has(item.id)) el.classList.add('selected');
        if (this._openingItemId && item.id === this._openingItemId) el.classList.add('explorer-item-opening');
        if (item.isUploadPlaceholder) el.classList.add('explorer-item-upload-pending');
        if (item.system) el.classList.add('explorer-item-system');

        const iconSize = mode.type === 'details' || mode.type === 'list' ? 'row' : mode.iconSize;

        if (mode.type === 'details') {
            el.classList.add('explorer-item-details-row');
            el.appendChild(this._createIconBox(item, iconSize));
            const name = document.createElement('span');
            name.className = 'explorer-item-name';
            name.textContent = item.name || '';
            const date = document.createElement('span');
            date.className = 'explorer-item-date';
            date.textContent = this._formatDate(item.modifiedAt);
            const type = document.createElement('span');
            type.className = 'explorer-item-type';
            type.textContent = this._formatTypeLabel(item);
            const size = document.createElement('span');
            size.className = 'explorer-item-size';
            size.textContent = this._formatSize(item.size);
            el.append(name, date, type, size);
        } else if (mode.type === 'list') {
            el.classList.add('explorer-item-list-row');
            el.appendChild(this._createIconBox(item, iconSize));
            const label = document.createElement('span');
            label.className = 'explorer-item-list-label';
            label.textContent = item.name || '';
            el.appendChild(label);
        } else {
            el.appendChild(this._createIconBox(item, iconSize));
            const label = document.createElement('span');
            label.className = 'explorer-item-label';
            label.textContent = item.name || '';
            el.appendChild(label);
        }

        el.addEventListener('click', (e) => this._handleClick(e, item, index));
        el.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this._interactionBlocked) return;
            const fresh = this.items.find(i => i.id === item.id) || item;
            this.onItemOpen(fresh);
        });
        el.addEventListener('contextmenu', (e) => {
            if (this._interactionBlocked) return;
            e.preventDefault();
            e.stopPropagation();
            const idx = this._resolveIndex(item, parseInt(el.dataset.itemIndex, 10));
            if (!this.selectedIds.has(item.id)) {
                this.selectedIds.clear();
                this.selectedIds.add(item.id);
                this.anchorIndex = idx;
                this._updateSelectionClasses();
                this.onSelectionChange(this.getSelectedItems());
            }
            this.onItemContextMenu(item, e);
        });

        if (!item.isUploadPlaceholder && !item.system) {
            el.addEventListener('mousedown', (e) => this._handleItemDragStart(e, item));
        }

        if (this._isFolderItem(item) && !item.isUploadPlaceholder) {
            el.addEventListener('dragover', (e) => {
                if (!e.dataTransfer?.types?.includes('Files')) return;
                e.preventDefault();
                e.stopPropagation();
                el.classList.add('explorer-item-drop-target');
            });
            el.addEventListener('dragleave', (e) => {
                if (!el.contains(e.relatedTarget)) el.classList.remove('explorer-item-drop-target');
            });
            el.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                el.classList.remove('explorer-item-drop-target');
                this.container.classList.remove('explorer-drop-target');
                this.onItemDrop(item, e);
            });
        }
        return el;
    }

    _isFolderItem(item) {
        return item.kind === 'folder'
            || item.targetKind === 'system-folder'
            || item.targetKind === 'workspace'
            || item.targetKind === 'vfs-folder';
    }

    _handleClick(e, item, index) {
        if (this._interactionBlocked || item.isUploadPlaceholder) return;
        if (this._suppressNextClick) {
            this._suppressNextClick = false;
            return;
        }
        index = this._resolveIndex(item, index);
        if (index < 0) return;
        if (e.ctrlKey || e.metaKey) {
            if (this.selectedIds.has(item.id)) this.selectedIds.delete(item.id);
            else this.selectedIds.add(item.id);
            this.anchorIndex = index;
        } else if (e.shiftKey && this.anchorIndex !== null) {
            const lo = Math.min(this.anchorIndex, index);
            const hi = Math.max(this.anchorIndex, index);
            this.selectedIds.clear();
            for (let i = lo; i <= hi; i++) {
                const row = this.items[i];
                if (row && !row.isUploadPlaceholder) this.selectedIds.add(row.id);
            }
        } else {
            this.selectedIds.clear();
            this.selectedIds.add(item.id);
            this.anchorIndex = index;
        }
        this._updateSelectionClasses();
        this.onSelectionChange(this.getSelectedItems());
    }

    _updateSelectionClasses() {
        this.contentEl.querySelectorAll('.explorer-item').forEach(el => {
            el.classList.toggle('selected', this.selectedIds.has(el.dataset.itemId));
        });
    }

    _formatSize(bytes) {
        if (!bytes) return '';
        if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
        if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
        if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${bytes} B`;
    }

    _formatDate(ts) {
        if (!ts) return '';
        return new Date(ts * 1000).toLocaleString();
    }

    resize() {
        this._refreshViewLayout();
    }
}
