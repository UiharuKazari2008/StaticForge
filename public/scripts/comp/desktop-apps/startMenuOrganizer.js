// Start menu organizer editor window.
// Server storage/validation: modules/startMenuLayout.js, modules/ws/handlers/260-startMenuLayoutHandler.js
// Opened from the "All Apps" flyout's trailing row: buildAllAppsSubmenuWithOrganizeRow, public/scripts/comp/modalUtils.js

const START_MENU_ORGANIZER_MODAL_ID = 'startMenuOrganizerModal';

let smoListEl = null;
let smoWorkingLayout = [];
let smoCatalogById = new Map();

function smoRefreshCatalogIndex() {
    // getAllAppsMenuItems: public/scripts/comp/modalUtils.js
    smoCatalogById = new Map(getAllAppsMenuItems().map((item) => [item.launchId, item]));
}

/**
 * Working copy of the layout for this editing session: the saved layout
 * (if any) with stale launchIds dropped and any catalog app not referenced
 * anywhere in it appended at the end, in catalog order. Mirrors
 * getOrganizedAllAppsMenuItems's merge rule (modalUtils.js) so the editor
 * always matches what the live Start menu would render.
 */
function smoBuildWorkingLayout() {
    smoRefreshCatalogIndex();
    // getStartMenuCustomLayout: public/scripts/comp/modalUtils.js
    const saved = (typeof getStartMenuCustomLayout === 'function') ? getStartMenuCustomLayout() : null;
    const used = new Set();
    const nodes = [];

    if (Array.isArray(saved)) {
        saved.forEach((node) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'item') {
                if (!smoCatalogById.has(node.launchId) || used.has(node.launchId)) return;
                used.add(node.launchId);
                nodes.push({ type: 'item', launchId: node.launchId });
            } else if (node.type === 'folder') {
                const children = (Array.isArray(node.children) ? node.children : [])
                    .filter((child) => child && child.type === 'item' && smoCatalogById.has(child.launchId) && !used.has(child.launchId));
                children.forEach((child) => used.add(child.launchId));
                nodes.push({
                    type: 'folder',
                    id: node.id,
                    name: node.name,
                    children: children.map((child) => ({ type: 'item', launchId: child.launchId }))
                });
            }
        });
    }

    smoCatalogById.forEach((_item, launchId) => {
        if (used.has(launchId)) return;
        used.add(launchId);
        nodes.push({ type: 'item', launchId });
    });

    return nodes;
}

function smoFindItemLocation(launchId) {
    for (let i = 0; i < smoWorkingLayout.length; i++) {
        const node = smoWorkingLayout[i];
        if (node.type === 'item' && node.launchId === launchId) {
            return { container: smoWorkingLayout, index: i };
        }
        if (node.type === 'folder') {
            const childIndex = node.children.findIndex((child) => child.launchId === launchId);
            if (childIndex >= 0) return { container: node.children, index: childIndex };
        }
    }
    return null;
}

function smoRemoveItem(launchId) {
    const loc = smoFindItemLocation(launchId);
    if (!loc) return null;
    return loc.container.splice(loc.index, 1)[0];
}

function smoNextDefaultFolderName() {
    const existing = new Set(smoWorkingLayout.filter((node) => node.type === 'folder').map((node) => node.name));
    if (!existing.has('New folder')) return 'New folder';
    let n = 2;
    while (existing.has(`New folder (${n})`)) n++;
    return `New folder (${n})`;
}

function smoCreateFolder(initialChildren) {
    const folder = {
        type: 'folder',
        id: crypto.randomUUID(),
        name: smoNextDefaultFolderName(),
        children: initialChildren || []
    };
    smoWorkingLayout.push(folder);
    return folder;
}

function smoMoveItemToExistingFolder(launchId, folderId) {
    const node = smoRemoveItem(launchId);
    if (!node) return;
    const folder = smoWorkingLayout.find((n) => n.type === 'folder' && n.id === folderId);
    if (!folder) {
        smoWorkingLayout.push(node);
        return;
    }
    folder.children.push(node);
}

function smoMoveItemToNewFolder(launchId) {
    const node = smoRemoveItem(launchId);
    if (!node) return null;
    return smoCreateFolder([node]);
}

function smoMoveItemOutOfFolder(launchId) {
    const node = smoRemoveItem(launchId);
    if (!node) return;
    smoWorkingLayout.push(node);
}

function smoDeleteFolder(folderId) {
    const idx = smoWorkingLayout.findIndex((n) => n.type === 'folder' && n.id === folderId);
    if (idx < 0) return;
    const folder = smoWorkingLayout.splice(idx, 1)[0];
    smoWorkingLayout.splice(idx, 0, ...folder.children);
}

function smoRenameFolder(folderId, name) {
    const folder = smoWorkingLayout.find((n) => n.type === 'folder' && n.id === folderId);
    if (!folder) return;
    const trimmed = String(name || '').trim().slice(0, 60);
    folder.name = trimmed || folder.name;
}

async function smoSaveLayout() {
    if (!window.wsClient) return;
    try {
        const result = await window.wsClient.sendMessage('start_menu_save_layout', { layout: smoWorkingLayout }, false);
        if (result && Array.isArray(result.layout)) smoWorkingLayout = result.layout;
        // setStartMenuCustomLayoutCache: public/scripts/comp/modalUtils.js — keeps the live Start menu in sync
        if (typeof setStartMenuCustomLayoutCache === 'function') setStartMenuCustomLayoutCache(smoWorkingLayout);
    } catch (e) {
        console.error('start_menu_save_layout', e);
        showGlassToast('error', null, 'Failed to save Start menu layout', false, 4000, '<i class="fas fa-triangle-exclamation"></i>');
    }
}

/** Runs a layout mutation against smoWorkingLayout, then re-renders and saves. Returns the mutator's result. */
function smoApplyChange(mutator) {
    const result = mutator();
    smoRenderList();
    smoSaveLayout();
    return result;
}

async function smoResetToDefault() {
    if (!window.wsClient) return;
    try {
        await window.wsClient.sendMessage('start_menu_reset_layout', {}, false);
    } catch (e) {
        console.error('start_menu_reset_layout', e);
        showGlassToast('error', null, 'Failed to reset Start menu layout', false, 4000, '<i class="fas fa-triangle-exclamation"></i>');
        return;
    }
    if (typeof setStartMenuCustomLayoutCache === 'function') setStartMenuCustomLayoutCache(null);
    smoWorkingLayout = smoBuildWorkingLayout();
    smoRenderList();
    showGlassToast('success', null, 'Start menu reset to default', false, 3000, '<i class="fas fa-rotate-left"></i>');
}

function smoReadLiveFolders() {
    if (!smoListEl) return [];
    return Array.from(smoListEl.querySelectorAll(':scope > .smo-folder')).map((el) => ({
        id: el.dataset.folderId,
        name: el.dataset.folderName || ''
    }));
}

function smoCurrentFolderIdOf(rowEl) {
    const wrap = rowEl.closest('.smo-folder');
    return wrap ? wrap.dataset.folderId : null;
}

function smoStartFolderRename(folderId) {
    if (!smoListEl || !folderId) return;
    const wrap = smoListEl.querySelector(`.smo-folder[data-folder-id="${folderId}"]`);
    const editable = wrap && wrap.querySelector('.smo-folder-name');
    const input = editable && editable.querySelector('.character-name-input');
    if (!editable || !input) return;
    editable.classList.add('editing-name');
    input.focus();
    input.select();
}

function smoAttachItemContextMenu(rowEl, launchId) {
    if (!contextMenu) return;
    const config = {
        sections: [{
            type: 'list',
            items: [
                {
                    icon: 'fas fa-folder-plus',
                    text: 'Move to Folder',
                    submenu: [],
                    loadfn: (ctxItem) => {
                        const currentFolderId = smoCurrentFolderIdOf(rowEl);
                        const options = smoReadLiveFolders()
                            .filter((folder) => folder.id !== currentFolderId)
                            .map((folder) => ({ icon: 'fas fa-folder', text: folder.name, action: `smo-move-to-folder:${folder.id}` }));
                        if (options.length) options.push({ separator: true });
                        options.push({ icon: 'fas fa-folder-plus', text: 'New Folder…', action: 'smo-move-to-new-folder' });
                        ctxItem.submenu = options;
                    }
                },
                {
                    icon: 'fas fa-arrow-up-from-bracket',
                    text: 'Move out of Folder',
                    action: 'smo-move-out-of-folder',
                    hidden: () => !smoCurrentFolderIdOf(rowEl)
                },
                { separator: true },
                { icon: 'fas fa-rotate-left', text: 'Reset to Default', action: 'smo-reset' }
            ]
        }],
        onAction: (action) => {
            if (action === 'smo-move-out-of-folder') {
                smoApplyChange(() => smoMoveItemOutOfFolder(launchId));
            } else if (action === 'smo-move-to-new-folder') {
                const folder = smoApplyChange(() => smoMoveItemToNewFolder(launchId));
                if (folder) smoStartFolderRename(folder.id);
            } else if (action.indexOf('smo-move-to-folder:') === 0) {
                const folderId = action.slice('smo-move-to-folder:'.length);
                smoApplyChange(() => smoMoveItemToExistingFolder(launchId, folderId));
            } else if (action === 'smo-reset') {
                smoResetToDefault();
            }
        }
    };
    contextMenu.attachToElement(rowEl, config);
}

function smoAttachFolderContextMenu(wrapEl, folderId) {
    if (!contextMenu) return;
    const config = {
        sections: [{
            type: 'list',
            items: [
                { icon: 'fas fa-pen', text: 'Rename', action: 'smo-rename-folder' },
                { icon: 'fas fa-folder-minus', text: 'Delete Folder', action: 'smo-delete-folder' },
                { separator: true },
                { icon: 'fas fa-rotate-left', text: 'Reset to Default', action: 'smo-reset' }
            ]
        }],
        onAction: (action) => {
            if (action === 'smo-rename-folder') {
                smoStartFolderRename(folderId);
            } else if (action === 'smo-delete-folder') {
                smoApplyChange(() => smoDeleteFolder(folderId));
            } else if (action === 'smo-reset') {
                smoResetToDefault();
            }
        }
    };
    contextMenu.attachToElement(wrapEl, config);
}

function smoAttachEmptyAreaContextMenu(listEl) {
    if (!contextMenu) return;
    const config = {
        sections: [{
            type: 'list',
            items: [
                { icon: 'fas fa-folder-plus', text: 'New Folder', action: 'smo-new-folder' },
                { separator: true },
                { icon: 'fas fa-rotate-left', text: 'Reset to Default', action: 'smo-reset' }
            ]
        }],
        onAction: (action) => {
            if (action === 'smo-new-folder') {
                const folder = smoApplyChange(() => smoCreateFolder([]));
                smoStartFolderRename(folder.id);
            } else if (action === 'smo-reset') {
                smoResetToDefault();
            }
        }
    };
    contextMenu.attachToElement(listEl, config);
}

function smoCreateItemRow(launchId) {
    const catalogItem = smoCatalogById.get(launchId);
    const row = document.createElement('div');
    row.className = 'smo-row';
    row.dataset.launchId = launchId;
    const label = catalogItem ? catalogItem.text : launchId;
    // getIconHTML, escapeHtml: public/scripts/comp/modalUtils.js, public/scripts/comp/utilities.js
    row.innerHTML = `
        <div class="smo-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></div>
        ${getIconHTML(catalogItem ? catalogItem.icon : 'fas fa-cube', catalogItem ? catalogItem.imageIcon : null)}
        <span class="smo-row-label">${escapeHtml(label)}</span>
    `;
    smoAttachItemContextMenu(row, launchId);
    return row;
}

function smoCreateFolderRow(folderNode) {
    const wrap = document.createElement('div');
    wrap.className = 'smo-folder';
    wrap.dataset.folderId = folderNode.id;
    wrap.dataset.folderName = folderNode.name;

    const header = document.createElement('div');
    header.className = 'smo-row smo-folder-row';
    header.innerHTML = `
        <div class="smo-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></div>
        <i class="fas fa-folder"></i>
        <div class="character-name-editable inline-name-edit smo-folder-name">
            <input type="text" class="character-name-input hover-show" value="${escapeHtmlAttribute(folderNode.name)}" placeholder="Folder name" title="Click to rename">
            <span class="character-name-input-placeholder">${escapeHtml(folderNode.name)}</span>
        </div>
    `;
    wrap.appendChild(header);

    const childrenEl = document.createElement('div');
    childrenEl.className = 'smo-folder-children';
    folderNode.children.forEach((child) => childrenEl.appendChild(smoCreateItemRow(child.launchId)));
    const emptyHint = document.createElement('div');
    emptyHint.className = 'smo-folder-empty-hint';
    emptyHint.textContent = 'Drag apps here';
    childrenEl.appendChild(emptyHint);
    wrap.appendChild(childrenEl);

    // wireInlineNameEditable: public/scripts/comp/pipelineStageManager.js
    wireInlineNameEditable(header.querySelector('.smo-folder-name'), {
        onCommit: (value) => {
            const trimmed = value.trim();
            if (!trimmed || trimmed === folderNode.name) return;
            smoApplyChange(() => smoRenameFolder(folderNode.id, trimmed));
        },
        onCancel: (input) => {
            input.value = folderNode.name;
        }
    });

    smoAttachFolderContextMenu(wrap, folderNode.id);
    return wrap;
}

function smoRenderList() {
    if (!smoListEl) return;
    smoListEl.innerHTML = '';
    if (!smoWorkingLayout.length) {
        const empty = document.createElement('div');
        empty.className = 'smo-empty-hint form-hint';
        empty.textContent = 'No apps available.';
        smoListEl.appendChild(empty);
        return;
    }
    smoWorkingLayout.forEach((node) => {
        if (node.type === 'item') {
            smoListEl.appendChild(smoCreateItemRow(node.launchId));
        } else if (node.type === 'folder') {
            smoListEl.appendChild(smoCreateFolderRow(node));
        }
    });
}

function smoCommitFromDom() {
    if (!smoListEl) return;
    const nodes = [];
    Array.from(smoListEl.children).forEach((el) => {
        if (el.classList.contains('smo-row') && el.dataset.launchId) {
            nodes.push({ type: 'item', launchId: el.dataset.launchId });
        } else if (el.classList.contains('smo-folder')) {
            const childrenEl = el.querySelector('.smo-folder-children');
            const children = childrenEl
                ? Array.from(childrenEl.children)
                    .filter((child) => child.classList.contains('smo-row') && child.dataset.launchId)
                    .map((child) => ({ type: 'item', launchId: child.dataset.launchId }))
                : [];
            nodes.push({ type: 'folder', id: el.dataset.folderId, name: el.dataset.folderName, children });
        }
    });
    smoWorkingLayout = nodes;
    smoSaveLayout();
}

/**
 * Pointer-based drag and drop (mouse + touch), delegated on the list container so it
 * survives smoRenderList() rebuilding rows. Items can be dropped at the top level or
 * into/out of any folder; folders themselves may only reorder at the top level (no
 * nested folders, matching the server's one-level-deep model: modules/startMenuLayout.js).
 */
function smoWireDragAndDrop(listEl) {
    let draggedEl = null;
    let draggedType = null;
    let rafId = null;
    let pendingPoint = null;

    function pointFromEvent(e) {
        if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }

    function flush() {
        rafId = null;
        if (!draggedEl || !pendingPoint) return;
        const { x, y } = pendingPoint;
        const below = document.elementFromPoint(x, y);
        if (!below) return;

        let zoneEl = null;
        const folderChildrenHit = below.closest('.smo-folder-children');
        const folderRowHit = below.closest('.smo-folder-row');
        if (folderChildrenHit) {
            zoneEl = draggedType === 'folder' ? null : folderChildrenHit;
        } else if (folderRowHit && draggedType === 'item') {
            const wrap = folderRowHit.closest('.smo-folder');
            if (wrap && wrap !== draggedEl) zoneEl = wrap.querySelector('.smo-folder-children');
        } else if (below === listEl || listEl.contains(below)) {
            zoneEl = listEl;
        }
        if (!zoneEl) return;

        const siblings = Array.from(zoneEl.children).filter((child) => child !== draggedEl
            && (child.classList.contains('smo-row') || child.classList.contains('smo-folder')));
        let insertBeforeEl = null;
        for (const sib of siblings) {
            const rect = sib.getBoundingClientRect();
            if (y < rect.top + rect.height / 2) {
                insertBeforeEl = sib;
                break;
            }
        }

        if (draggedEl.parentElement === zoneEl && draggedEl.nextElementSibling === insertBeforeEl) return;
        if (insertBeforeEl) zoneEl.insertBefore(draggedEl, insertBeforeEl);
        else zoneEl.appendChild(draggedEl);
    }

    function onDrag(e) {
        if (!draggedEl) return;
        e.preventDefault();
        pendingPoint = pointFromEvent(e);
        if (rafId == null) rafId = requestAnimationFrame(flush);
    }

    function endDrag() {
        if (!draggedEl) return;
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        flush();
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', endDrag);
        document.removeEventListener('touchmove', onDrag);
        document.removeEventListener('touchend', endDrag);
        document.body.style.userSelect = '';
        draggedEl.classList.remove('dragging');
        draggedEl.style.pointerEvents = '';
        draggedEl = null;
        draggedType = null;
        pendingPoint = null;
        smoCommitFromDom();
    }

    function startDrag(e) {
        const handle = e.target.closest('.smo-drag-handle');
        if (!handle) return;
        e.preventDefault();
        const headerRow = handle.closest('.smo-folder-row');
        draggedEl = headerRow ? headerRow.closest('.smo-folder') : handle.closest('.smo-row');
        if (!draggedEl) return;
        draggedType = headerRow ? 'folder' : 'item';
        draggedEl.classList.add('dragging');
        draggedEl.style.pointerEvents = 'none';
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchmove', onDrag, { passive: false });
        document.addEventListener('touchend', endDrag);
        document.body.style.userSelect = 'none';
    }

    listEl.addEventListener('mousedown', startDrag);
    listEl.addEventListener('touchstart', startDrag, { passive: false });
}

function ensureStartMenuOrganizerModal() {
    let modal = document.getElementById(START_MENU_ORGANIZER_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = START_MENU_ORGANIZER_MODAL_ID;
    modal.className = 'modal resizeable-window hidden';
    modal.dataset.windowIdentifier = 'startMenuOrganizer';
    modal.dataset.windowDefaultWidth = '420';
    modal.dataset.windowMinWidth = '340';
    modal.dataset.windowDefaultHeight = '520';
    modal.dataset.windowMinHeight = '320';
    modal.dataset.windowMaxWidth = '720';
    modal.dataset.windowMaxHeight = '900';
    modal.classList.add("smo-modal");
    modal.innerHTML = `
        <div class="modal-window-title">
            <div class="modal-window-title-main">
                <i class="fas fa-arrows-up-down-left-right"></i>
                <span>Organize Start Menu</span>
            </div>
        </div>
        <div class="modal-focus-overlay"></div>
        <div class="modal-window-controls">
            <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
            <button type="button" class="btn-danger close-btn btn-small" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
        </div>
        <div class="modal-content start-menu-organizer-content dark">
            <div class="modal-body">
                <div class="smo-hint form-hint">Drag to reorder, or drop an app onto a folder. Right-click for more options.</div>
                <div class="smo-list" id="smoList"></div>
            </div>
        </div>
    `;
    modal.querySelector('.close-btn').addEventListener('click', () => {
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
    });
    document.body.appendChild(modal);

    smoListEl = modal.querySelector('#smoList');
    smoAttachEmptyAreaContextMenu(smoListEl);
    smoWireDragAndDrop(smoListEl);

    return modal;
}

function openStartMenuOrganizer() {
    const modal = ensureStartMenuOrganizerModal();
    smoWorkingLayout = smoBuildWorkingLayout();
    smoRenderList();
    if (modal.classList.contains('minimised')) {
        // restoreMinimizedModal: public/scripts/comp/modalUtils.js
        restoreMinimizedModal(modal);
    }
    if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt')) {
        // openModal: public/scripts/comp/modalUtils.js
        openModal(modal);
    }
    // bringModalToFront: public/scripts/comp/modalUtils.js
    bringModalToFront(modal);
}
