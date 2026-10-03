// Studio New Session + Save As — public/scripts/comp/studioSession.js
// clearManualForm / saveRequestAsDesktopShortcut: public/scripts/comp/manualModalManager.js
// handleManualSave: public/scripts/comp/generationOrchestrator.js
// forgetLastStudioPreview: public/scripts/comp/imageGenerationSettings.js
// searchPresets: public/scripts/comp/presetManager.js (wsClient.searchPresets)

const STUDIO_SAVE_REQUEST_TYPE = 'request';

const studioSaveNameState = {
    mode: 'preset-new',
    workspaceId: '',
    searchTimer: null,
    results: [],
    selectedIndex: -1
};

const studioSaveFolderState = {
    path: '/',
    items: [],
    viewMode: 'icons-lg',
    grid: null,
    navToken: 0,
    wired: false,
    mode: 'save',
    selected: [],
    host: null
};

function startStudioNewSession(options) {
    clearManualForm();
    resetManualPreview();
    if (!options || options.keepHistory !== true) forgetLastStudioPreview();
    if (manualPresetName) manualPresetName.value = '';
    updateManualPresetToggleBtn();
    if (options && options.quiet === true) return;
    showGlassToast('info', null, 'New Session', false, 2000, '<i class="fa-regular fa-file"></i>');
}

function studioSessionPresetName() {
    const el = document.getElementById('manualPresetName');
    return el ? String(el.value || '').trim() : '';
}

function getStudioSaveAsMenuItems() {
    return [
        {
            icon: 'fa-regular fa-file-circle-plus',
            text: 'New Preset',
            action: 'studio-save-preset-new'
        },
        {
            icon: 'fas fa-desktop',
            text: 'To Desktop',
            action: 'studio-save-desktop'
        },
        {
            icon: 'fa-regular fa-folder-open',
            text: 'To Folder',
            action: 'studio-save-folder'
        }
    ];
}

function studioSaveWorkspaceRecords() {
    if (typeof workspaces === 'undefined' || !workspaces) return [];
    return Object.values(workspaces).sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

function studioSaveWorkspaceMenuItems() {
    return studioSaveWorkspaceRecords().map((ws) => {
        const color = ws.color || '#102040';
        return {
            content: `<div class="workspace-option-content"><div class="workspace-color-indicator" style="background-color: ${color}"></div><span>${ws.name || ws.id}</span></div>`,
            action: 'studio-save-workspace',
            workspaceId: ws.id
        };
    });
}

function studioSaveNameSetWorkspace(workspaceId) {
    studioSaveNameState.workspaceId = workspaceId || (typeof activeWorkspace !== 'undefined' ? activeWorkspace : '');
    const ws = (typeof workspaces !== 'undefined' && workspaces)
        ? workspaces[studioSaveNameState.workspaceId]
        : null;
    const dot = document.getElementById('studioSaveNameWorkspaceDot');
    const btn = document.getElementById('studioSaveNameWorkspaceBtn');
    const color = (ws && ws.color) || '#102040';
    const label = (ws && ws.name) || studioSaveNameState.workspaceId || 'Workspace';
    if (dot) dot.style.backgroundColor = color;
    if (btn) btn.title = label;
    studioSaveNameQueueSearch();
}

function studioSaveSuggestName(existingNames) {
    const taken = new Set((existingNames || []).map((name) => String(name || '').toLowerCase()));
    const promptEl = document.getElementById('manualPrompt');
    let base = '';
    if (promptEl && promptEl.value) {
        base = promptEl.value.split('\n')[0].split(',')[0];
    }
    base = base.replace(/[{}\[\]<>:#]/g, ' ').replace(/\s+/g, ' ').trim();
    if (base.length > 48) base = base.slice(0, 48).trim();
    if (!base) {
        const current = document.getElementById('manualPresetName');
        base = (current && current.value.trim()) || 'Untitled';
    }
    if (!taken.has(base.toLowerCase())) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`.toLowerCase()) && n < 100) n += 1;
    return `${base} ${n}`;
}

async function studioSaveCollectNames(mode, workspaceId) {
    const names = [];
    if (mode === 'desktop') {
        if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts.currentWorkspace === workspaceId) {
            desktopShortcuts.shortcuts.forEach((shortcut) => {
                if (!shortcut._isDeleted && shortcut.name) names.push(shortcut.name);
            });
            return names;
        }
        if (wsClient && wsClient.isConnected() && workspaceId) {
            const resp = await wsClient.getDesktopShortcuts(workspaceId);
            const list = resp && resp.shortcuts ? resp.shortcuts : [];
            list.forEach((shortcut) => {
                if (shortcut && shortcut.name) names.push(shortcut.name);
            });
        }
        return names;
    }
    if (mode === 'folder') {
        studioSaveFolderState.items.forEach((item) => {
            if (item && item.name) names.push(item.name);
        });
        return names;
    }
    const presets = window.optionsData && window.optionsData.presets;
    if (Array.isArray(presets)) {
        presets.forEach((preset) => {
            if (preset && preset.name) names.push(preset.name);
        });
    }
    return names;
}

function studioSaveHideSuggestions() {
    const list = document.getElementById('studioSaveNameSuggestions');
    if (!list) return;
    list.classList.add('hidden');
    list.innerHTML = '';
    studioSaveNameState.results = [];
    studioSaveNameState.selectedIndex = -1;
}

function studioSaveRenderSuggestions(rows) {
    const list = document.getElementById('studioSaveNameSuggestions');
    if (!list) return;
    studioSaveNameState.results = rows;
    studioSaveNameState.selectedIndex = -1;
    list.innerHTML = '';
    if (!rows.length) {
        list.classList.add('hidden');
        return;
    }
    rows.forEach((row, index) => {
        const item = document.createElement('div');
        item.className = 'preset-autocomplete-item';
        item.dataset.index = String(index);
        const name = document.createElement('span');
        name.className = 'preset-name';
        name.textContent = row.name;
        const detail = document.createElement('span');
        detail.className = 'preset-details';
        detail.textContent = row.detail || '';
        item.appendChild(name);
        item.appendChild(detail);
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            studioSaveApplySuggestion(row.name);
        });
        list.appendChild(item);
    });
    list.classList.remove('hidden');
}

function studioSaveApplySuggestion(name) {
    const input = document.getElementById('studioSaveNameInput');
    if (input) {
        input.value = name;
        input.focus();
    }
    studioSaveHideSuggestions();
}

function studioSaveMoveSuggestion(delta) {
    const list = document.getElementById('studioSaveNameSuggestions');
    const rows = studioSaveNameState.results;
    if (!list || !rows.length) return;
    let next = studioSaveNameState.selectedIndex + delta;
    if (next < 0) next = rows.length - 1;
    if (next >= rows.length) next = 0;
    studioSaveNameState.selectedIndex = next;
    list.querySelectorAll('.preset-autocomplete-item').forEach((el, index) => {
        el.classList.toggle('selected', index === next);
    });
}

async function studioSaveRunSearch(query) {
    const mode = studioSaveNameState.mode;
    const q = String(query || '').trim();
    if (q.length < 2) {
        studioSaveHideSuggestions();
        return;
    }
    if (mode === 'desktop') {
        const names = await studioSaveCollectNames('desktop', studioSaveNameState.workspaceId);
        const lowered = q.toLowerCase();
        const rows = names
            .filter((name) => name.toLowerCase().includes(lowered))
            .slice(0, 8)
            .map((name) => ({ name, detail: name.toLowerCase() === lowered ? 'existing shortcut' : 'desktop' }));
        studioSaveRenderSuggestions(rows);
        return;
    }
    if (!wsClient || !wsClient.isConnected()) {
        studioSaveHideSuggestions();
        return;
    }
    let presetResults = [];
    try {
        presetResults = await wsClient.searchPresets(q);
    } catch (_err) {
        studioSaveHideSuggestions();
        return;
    }
    if (!Array.isArray(presetResults)) {
        studioSaveHideSuggestions();
        return;
    }
    const lowered = q.toLowerCase();
    const rows = presetResults.slice(0, 8).map((result) => ({
        name: result.name,
        detail: result.name && result.name.toLowerCase() === lowered
            ? 'existing preset'
            : (window.optionsData?.modelsShort?.[String(result.model || '').toUpperCase()] || result.model || 'preset')
    }));
    studioSaveRenderSuggestions(rows);
}

function studioSaveNameQueueSearch() {
    const input = document.getElementById('studioSaveNameInput');
    if (studioSaveNameState.searchTimer) clearTimeout(studioSaveNameState.searchTimer);
    const value = input ? input.value : '';
    studioSaveNameState.searchTimer = setTimeout(() => {
        studioSaveRunSearch(value);
    }, 300);
}

function wireStudioSaveNameDialog() {
    const modal = document.getElementById('studioSaveNameModal');
    if (!modal || modal.dataset.wired === 'true') return;
    modal.dataset.wired = 'true';

    const input = document.getElementById('studioSaveNameInput');
    const autoBtn = document.getElementById('studioSaveNameAutoBtn');
    const cancelBtn = document.getElementById('studioSaveNameCancelBtn');
    const saveBtn = document.getElementById('studioSaveNameSaveBtn');
    const closeBtn = document.getElementById('closeStudioSaveNameBtn');
    const workspaceBtn = document.getElementById('studioSaveNameWorkspaceBtn');

    if (input) {
        input.addEventListener('input', () => studioSaveNameQueueSearch());
        input.addEventListener('keydown', (e) => {
            const open = studioSaveNameState.results.length > 0;
            if (e.key === 'ArrowDown' && open) {
                e.preventDefault();
                studioSaveMoveSuggestion(1);
            } else if (e.key === 'ArrowUp' && open) {
                e.preventDefault();
                studioSaveMoveSuggestion(-1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (studioSaveNameState.selectedIndex >= 0 && studioSaveNameState.results[studioSaveNameState.selectedIndex]) {
                    studioSaveApplySuggestion(studioSaveNameState.results[studioSaveNameState.selectedIndex].name);
                    return;
                }
                studioSaveNameConfirm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (!document.getElementById('studioSaveNameSuggestions').classList.contains('hidden')) {
                    studioSaveHideSuggestions();
                    return;
                }
                closeModal(modal);
            }
        });
    }
    if (autoBtn) autoBtn.addEventListener('click', () => studioSaveNameFillAuto());
    if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal(modal));
    if (closeBtn) closeBtn.addEventListener('click', () => closeModal(modal));
    if (saveBtn) saveBtn.addEventListener('click', () => studioSaveNameConfirm());

    if (workspaceBtn && contextMenu) {
        contextMenu.attachClickMenuToElement(workspaceBtn, {
            sections: [{
                type: 'list',
                initfn: function (section) {
                    section.items = studioSaveWorkspaceMenuItems();
                }
            }],
            onAction: function (action, _target, item) {
                if (action === 'studio-save-workspace' && item && item.workspaceId) {
                    studioSaveNameSetWorkspace(item.workspaceId);
                }
            }
        });
    }
}

async function studioSaveNameFillAuto() {
    const input = document.getElementById('studioSaveNameInput');
    if (!input) return;
    const names = await studioSaveCollectNames(
        studioSaveNameState.mode === 'desktop' ? 'desktop' : 'preset',
        studioSaveNameState.workspaceId
    );
    input.value = studioSaveSuggestName(names);
    input.focus();
    studioSaveNameQueueSearch();
}

function studioSaveNameApplyChrome(mode) {
    const title = document.getElementById('studioSaveNameTitle');
    const saveBtn = document.getElementById('studioSaveNameSaveBtn');
    const autoBtn = document.getElementById('studioSaveNameAutoBtn');
    const workspaceBtn = document.getElementById('studioSaveNameWorkspaceBtn');
    const labels = {
        desktop: ['Save to Desktop', 'Save'],
        rename: ['Session Name', 'Set'],
        'load-preset': ['Open Preset', 'Open'],
        'preset-current': ['Save Preset', 'Save'],
        'preset-new': ['Save Preset', 'Save']
    };
    const pair = labels[mode] || labels['preset-new'];
    if (title) title.textContent = pair[0];
    if (saveBtn) saveBtn.textContent = pair[1];
    const hideExtras = mode === 'rename' || mode === 'load-preset';
    if (autoBtn) autoBtn.classList.toggle('hidden', hideExtras);
    if (workspaceBtn) workspaceBtn.classList.toggle('hidden', hideExtras);
}

function openStudioSaveNameDialog(mode) {
    wireStudioSaveNameDialog();
    const modal = document.getElementById('studioSaveNameModal');
    const input = document.getElementById('studioSaveNameInput');
    if (!modal || !input) return;
    studioSaveNameState.mode = mode;
    const currentName = studioSessionPresetName();
    if (mode === 'preset-current' || mode === 'desktop' || mode === 'rename') input.value = currentName;
    else input.value = '';
    studioSaveNameApplyChrome(mode);
    studioSaveNameSetWorkspace(typeof activeWorkspace !== 'undefined' ? activeWorkspace : '');
    studioSaveHideSuggestions();
    openModal(modal);
    bringModalToFront(modal);
    input.focus();
    input.select();
    if (input.value.trim().length >= 2) studioSaveNameQueueSearch();
}

async function studioSaveFindDesktopRequest(workspaceId, name) {
    if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts.currentWorkspace === workspaceId) {
        return desktopShortcuts.shortcuts.find((shortcut) =>
            !shortcut._isDeleted && shortcut.type === STUDIO_SAVE_REQUEST_TYPE && shortcut.name === name
        ) || null;
    }
    if (!wsClient || !wsClient.isConnected() || !workspaceId) return null;
    const resp = await wsClient.getDesktopShortcuts(workspaceId);
    const list = resp && resp.shortcuts ? resp.shortcuts : [];
    return list.find((shortcut) => shortcut && shortcut.type === STUDIO_SAVE_REQUEST_TYPE && shortcut.name === name) || null;
}

async function studioRenameSessionPreset(newName) {
    const oldName = studioSessionPresetName();
    if (!newName || newName === oldName) return true;
    // isValidPresetName: public/scripts/comp/presetManager.js
    if (isValidPresetName(newName)) {
        showError('A preset with that name already exists');
        return false;
    }
    if (isValidPresetName(oldName)) {
        if (!wsClient || !wsClient.isConnected()) {
            showError('WebSocket not connected');
            return false;
        }
        try {
            await wsClient.updatePreset(oldName, { name: newName });
            // loadOptions: public/scripts/comp/presetManager.js
            await loadOptions();
        } catch (err) {
            showError(err.message || 'Failed to rename preset');
            return false;
        }
    }
    if (manualPresetName) {
        manualPresetName.value = newName;
        // updateManualPresetToggleBtn: public/scripts/comp/presetManager.js
        updateManualPresetToggleBtn();
    }
    showGlassToast('success', null, `Session name set to “${newName}”`, false, 2200, '<i class="fas fa-pen"></i>');
    return true;
}

async function studioSaveCurrentPreset() {
    const name = studioSessionPresetName();
    if (!name) return;
    // isValidPresetName: public/scripts/comp/presetManager.js
    if (isValidPresetName(name)) {
        // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
        const choice = await showConfirmationDialog(
            `A preset named “${name}” already exists.`,
            [
                { text: 'Overwrite', value: 'overwrite', className: 'btn-primary', icon: 'fas fa-floppy-disk' },
                { text: 'Rename', value: 'rename', className: 'btn-secondary', icon: 'fas fa-pen' },
                { text: 'Cancel', value: 'cancel', className: 'btn-secondary' }
            ],
            null,
            { title: 'Save Preset', icon: 'fas fa-floppy-disk' }
        );
        if (choice === 'rename') {
            openStudioSaveNameDialog('rename');
            return;
        }
        if (choice !== 'overwrite') return;
    }
    // handleManualSave: public/scripts/comp/generationOrchestrator.js
    await handleManualSave({ name: name });
}

async function studioSaveNameConfirm() {
    const modal = document.getElementById('studioSaveNameModal');
    const input = document.getElementById('studioSaveNameInput');
    const name = input ? input.value.trim() : '';
    if (!name) {
        showError('Enter a name');
        return;
    }
    if (studioSaveNameState.mode === 'load-preset') {
        closeModal(modal);
        // openManualModalWithContent: public/scripts/comp/manualModalManager.js
        await openManualModalWithContent({ type: 'preset', name: name, title: name });
        return;
    }
    if (studioSaveNameState.mode === 'rename') {
        const renamed = await studioRenameSessionPreset(name);
        if (renamed) closeModal(modal);
        return;
    }
    const workspaceId = studioSaveNameState.workspaceId || activeWorkspace;
    let saved = false;
    if (studioSaveNameState.mode === 'desktop') {
        const existing = await studioSaveFindDesktopRequest(workspaceId, name);
        saved = await saveRequestAsDesktopShortcut({
            name: name,
            workspaceId: workspaceId,
            overwriteId: existing ? existing.id : null
        });
    } else {
        saved = await handleManualSave({ name: name, workspaceId: workspaceId });
    }
    if (saved) closeModal(modal);
}

function studioSaveFolderNavPath(item, currentPath) {
    if (!item) return null;
    if (item.navPath) return item.navPath;
    if (item.targetKind === 'workspace' && item.targetId) return `/Workspaces/${item.targetId}`;
    if (item.targetKind === 'system-folder') {
        const tid = item.targetId || item.id;
        if (tid === '@workspaces' || item.name === 'Workspaces') return '/Workspaces';
        if (tid === '@system' || item.name === 'System') return '/System';
        if (item.workspaceId && item.name) return `/Workspaces/${item.workspaceId}/${item.name}`;
    }
    if (item.kind === 'folder' || item.targetKind === 'vfs-folder') {
        const folderId = item.targetId || item.id;
        if (!folderId) return null;
        const base = String(currentPath || '/').replace(/\/+$/, '') || '/';
        return base === '/' ? `/${folderId}` : `${base}/${folderId}`;
    }
    return null;
}

function studioSaveFolderAcceptType() {
    const host = studioSaveFolderState.host;
    return (host && host.acceptType) || STUDIO_SAVE_REQUEST_TYPE;
}

function studioSaveFolderSameType(item) {
    return !!(item && item.shortcutType === studioSaveFolderAcceptType() && item.kind !== 'folder');
}

function studioSaveFolderOverwrite(name) {
    const match = studioSaveFolderState.items.find((item) =>
        studioSaveFolderSameType(item) && item.name === name
    );
    if (!match) return {};
    if (match.isVfsShortcutEntry || match.targetKind === 'desktop-shortcut') {
        if (match.isDesktopShortcut) return { overwriteId: match.id };
        return { overwriteEntryId: match.id };
    }
    if (match.isDesktopShortcut) return { overwriteId: match.id };
    return { overwriteEntryId: match.id };
}

function studioSaveFolderSetView(mode) {
    studioSaveFolderState.viewMode = mode;
    if (studioSaveFolderState.grid) studioSaveFolderState.grid.setViewMode(mode);
    const iconsBtn = document.getElementById('studioSaveFolderIconsBtn');
    const listBtn = document.getElementById('studioSaveFolderListBtn');
    if (iconsBtn) iconsBtn.classList.toggle('active', mode !== 'list');
    if (listBtn) listBtn.classList.toggle('active', mode === 'list');
}

async function studioSaveFolderNavigate(path) {
    const token = ++studioSaveFolderState.navToken;
    const target = path || '/';
    studioSaveFolderState.path = target;
    const address = document.getElementById('studioSaveFolderPath');
    if (address && document.activeElement !== address) address.value = target;
    if (!wsClient || !wsClient.isConnected()) return;
    try {
        const result = await vfsClient.listDirectory(target, {
            offset: 0,
            limit: 300,
            sortField: 'name',
            sortDirection: 'asc'
        });
        if (token !== studioSaveFolderState.navToken) return;
        studioSaveFolderState.items = result && result.items ? result.items : [];
        if (studioSaveFolderState.grid) studioSaveFolderState.grid.resetItems(studioSaveFolderState.items);
        try {
            const stats = await vfsClient.getPathStats(target);
            if (token !== studioSaveFolderState.navToken) return;
            const displayPath = stats && (stats.displayPath || (stats.stats && stats.stats.displayPath));
            if (displayPath && address && document.activeElement !== address) address.value = displayPath;
        } catch (_err) { /* keep raw path */ }
    } catch (err) {
        showGlassToast('error', 'Save As', err.message || 'Failed to open folder', false, 4000, '<i class="fas fa-folder"></i>');
    }
}

function studioSaveFolderPopulateIcon(box, item) {
    try {
        // initializeExplorerApplet: public/scripts/comp/explorerApplet.js
        const explorer = initializeExplorerApplet();
        explorer._populateIconBox(box, item);
    } catch (_err) {
        const icon = document.createElement('i');
        icon.className = item.icon || (item.kind === 'folder' ? 'fas fa-folder' : 'fas fa-file');
        box.appendChild(icon);
    }
}

function wireStudioSaveFolderDialog() {
    if (studioSaveFolderState.wired) return;
    const modal = document.getElementById('studioSaveFolderModal');
    const host = document.getElementById('studioSaveFolderGrid');
    if (!modal || !host) return;
    studioSaveFolderState.wired = true;

    studioSaveFolderState.grid = new VfsVirtualGrid(host, {
        viewMode: studioSaveFolderState.viewMode,
        populateIconBox: (box, item) => studioSaveFolderPopulateIcon(box, item),
        onItemOpen: (item) => {
            if (studioSaveFolderState.mode !== 'save') {
                void studioOpenFolderItem(item);
                return;
            }
            const nav = studioSaveFolderNavPath(item, studioSaveFolderState.path);
            if (nav) {
                studioSaveFolderNavigate(nav);
                return;
            }
            if (studioSaveFolderSameType(item)) {
                const input = document.getElementById('studioSaveFolderName');
                if (input) input.value = item.name || '';
            }
        },
        onSelectionChange: (selected) => {
            studioSaveFolderState.selected = selected || [];
            if (studioSaveFolderState.mode !== 'save') return;
            const item = studioSaveFolderState.selected.find((row) => studioSaveFolderSameType(row));
            if (!item) return;
            const input = document.getElementById('studioSaveFolderName');
            if (input) input.value = item.name || '';
        }
    });

    const pathInput = document.getElementById('studioSaveFolderPath');
    const upBtn = document.getElementById('studioSaveFolderUpBtn');
    const iconsBtn = document.getElementById('studioSaveFolderIconsBtn');
    const listBtn = document.getElementById('studioSaveFolderListBtn');
    const autoBtn = document.getElementById('studioSaveFolderAutoBtn');
    const cancelBtn = document.getElementById('studioSaveFolderCancelBtn');
    const saveBtn = document.getElementById('studioSaveFolderSaveBtn');
    const closeBtn = document.getElementById('closeStudioSaveFolderBtn');
    const nameInput = document.getElementById('studioSaveFolderName');

    if (upBtn) {
        upBtn.addEventListener('click', () => {
            const parts = studioSaveFolderState.path.split('/').filter(Boolean);
            if (!parts.length) return;
            parts.pop();
            studioSaveFolderNavigate(parts.length ? `/${parts.join('/')}` : '/');
        });
    }
    if (pathInput) {
        pathInput.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const typed = pathInput.value.trim() || '/';
            let resolved = typed;
            try {
                resolved = await vfsClient.resolvePath(typed);
            } catch (_err) { /* use typed */ }
            studioSaveFolderNavigate(resolved || typed);
        });
    }
    if (iconsBtn) iconsBtn.addEventListener('click', () => studioSaveFolderSetView('icons-lg'));
    if (listBtn) listBtn.addEventListener('click', () => studioSaveFolderSetView('list'));
    if (autoBtn) {
        autoBtn.addEventListener('click', async () => {
            if (!nameInput) return;
            const names = await studioSaveCollectNames('folder');
            nameInput.value = studioSaveSuggestName(names);
            nameInput.focus();
        });
    }
    if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal(modal));
    if (closeBtn) closeBtn.addEventListener('click', () => closeModal(modal));
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            if (studioSaveFolderState.mode === 'save') studioSaveFolderConfirm();
            else studioSaveFolderOpenSelected();
        });
    }
    if (nameInput) {
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (studioSaveFolderState.mode === 'save') studioSaveFolderConfirm();
                else studioSaveFolderOpenSelected();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeModal(modal);
            }
        });
    }
    if (contextMenu) {
        const workspaceBtn = document.getElementById('studioSaveFolderWorkspaceBtn');
        if (workspaceBtn) {
            contextMenu.attachClickMenuToElement(workspaceBtn, {
                sections: [{
                    type: 'list',
                    initfn: function (section) {
                        section.items = studioSaveWorkspaceMenuItems();
                    }
                }],
                onAction: function (action, _target, item) {
                    if (action === 'studio-save-workspace' && item && item.workspaceId) {
                        studioOpenGalleryWorkspace(item.workspaceId);
                    }
                }
            });
        }
    }
}

function studioSaveFolderApplyChrome(mode) {
    studioSaveFolderState.mode = mode || 'save';
    const title = document.getElementById('studioSaveFolderTitle');
    const saveBtn = document.getElementById('studioSaveFolderSaveBtn');
    const nameInput = document.getElementById('studioSaveFolderName');
    const autoBtn = document.getElementById('studioSaveFolderAutoBtn');
    const workspaceBtn = document.getElementById('studioSaveFolderWorkspaceBtn');
    const openMode = studioSaveFolderState.mode !== 'save';
    const hostTitle = studioSaveFolderState.host && studioSaveFolderState.host.title;
    if (title) {
        title.textContent = hostTitle
            || (studioSaveFolderState.mode === 'open-gallery'
                ? 'Open Gallery Image'
                : (studioSaveFolderState.mode === 'open-vfs' ? 'Open VFS File' : 'Save As'));
    }
    if (saveBtn) saveBtn.textContent = openMode ? 'Open' : 'Save';
    if (nameInput) nameInput.classList.toggle('hidden', openMode);
    if (autoBtn) autoBtn.classList.toggle('hidden', openMode);
    if (workspaceBtn) workspaceBtn.classList.toggle('hidden', studioSaveFolderState.mode !== 'open-gallery');
}

async function openStudioSaveFolderDialog() {
    await studioOpenFolderDialog('save');
}

async function studioOpenFolderDialog(mode, options = {}) {
    // featureLoader.loadFeature: public/scripts/comp/featureLoader.js
    try { await featureLoader.loadFeature('explorer'); } catch (_err) { /* icon fallback */ }
    wireStudioSaveFolderDialog();
    const modal = document.getElementById('studioSaveFolderModal');
    const nameInput = document.getElementById('studioSaveFolderName');
    if (!modal) return;
    studioSaveFolderState.host = options.host || null;
    studioSaveFolderApplyChrome(mode);
    if (nameInput && mode === 'save') {
        const suggest = studioSaveFolderState.host && studioSaveFolderState.host.suggestName;
        nameInput.value = typeof suggest === 'function' ? suggest() : studioSessionPresetName();
    }
    studioSaveFolderSetView(studioSaveFolderState.viewMode || 'icons-lg');
    const workspaceId = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : '';
    let start = options.startPath || '/';
    if (!options.startPath) {
        if (mode === 'open-gallery' && workspaceId) start = `/Workspaces/${workspaceId}/Pictures`;
        else if (mode === 'save' && workspaceId) start = `/Workspaces/${workspaceId}`;
    }
    studioOpenFolderSyncWorkspaceDot(workspaceId);
    openModal(modal);
    bringModalToFront(modal);
    await studioSaveFolderNavigate(start);
    if (nameInput && mode === 'save') nameInput.focus();
}

async function studioSaveFolderConfirm() {
    const modal = document.getElementById('studioSaveFolderModal');
    const nameInput = document.getElementById('studioSaveFolderName');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
        showError('Enter a name');
        return;
    }
    const overwrite = studioSaveFolderOverwrite(name);
    const parts = studioSaveFolderState.path.split('/').filter(Boolean);
    const workspaceId = (parts[0] === 'Workspaces' && parts[1])
        ? parts[1]
        : activeWorkspace;
    const host = studioSaveFolderState.host;
    if (host && typeof host.onSave === 'function') {
        const savedByHost = await host.onSave({
            path: studioSaveFolderState.path,
            name: name,
            overwrite: overwrite,
            workspaceId: workspaceId
        });
        if (savedByHost) closeModal(modal);
        return;
    }
    const saved = await saveRequestAsDesktopShortcut({
        dest: 'vfs',
        path: studioSaveFolderState.path,
        name: name,
        workspaceId: workspaceId,
        overwriteId: overwrite.overwriteId || null,
        overwriteEntryId: overwrite.overwriteEntryId || null
    });
    if (saved) closeModal(modal);
}

function studioOpenFolderSyncWorkspaceDot(workspaceId) {
    const ws = (typeof workspaces !== 'undefined' && workspaces) ? workspaces[workspaceId] : null;
    const dot = document.getElementById('studioSaveFolderWorkspaceDot');
    const btn = document.getElementById('studioSaveFolderWorkspaceBtn');
    const color = (ws && ws.color) || '#102040';
    const label = (ws && ws.name) || workspaceId || 'Workspace';
    if (dot) dot.style.backgroundColor = color;
    if (btn) btn.title = label;
}

function studioOpenGalleryWorkspace(workspaceId) {
    if (!workspaceId) return;
    studioOpenFolderSyncWorkspaceDot(workspaceId);
    studioSaveFolderNavigate(`/Workspaces/${workspaceId}/Pictures`);
}

function studioSaveFolderOpenSelected() {
    const selected = studioSaveFolderState.selected || [];
    const item = selected[0];
    if (!item) {
        showGlassToast('info', null, 'Select a file', false, 2000, '<i class="fas fa-folder-open"></i>');
        return;
    }
    void studioOpenFolderItem(item);
}

async function studioOpenSessionFromImage(filename, workspaceId) {
    if (!filename) return;
    const modal = document.getElementById('studioSaveFolderModal');
    if (modal) closeModal(modal);
    const image = {
        filename: filename,
        original: filename,
        workspaceId: workspaceId || undefined
    };
    // openManualModalWithContent: public/scripts/comp/manualModalManager.js
    await openManualModalWithContent({ type: 'image', image: image });
}

async function studioOpenFolderItem(item) {
    if (!item) return;
    const nav = studioSaveFolderNavPath(item, studioSaveFolderState.path);
    if (nav) {
        studioSaveFolderNavigate(nav);
        const parts = nav.split('/').filter(Boolean);
        if (parts[0] === 'Workspaces' && parts[1]) studioOpenFolderSyncWorkspaceDot(parts[1]);
        return;
    }
    const host = studioSaveFolderState.host;
    if (host && typeof host.onOpen === 'function') {
        if (item.shortcutType === studioSaveFolderAcceptType()) {
            const hostModal = document.getElementById('studioSaveFolderModal');
            if (hostModal) closeModal(hostModal);
            await host.onOpen(item, studioSaveFolderState.path);
            return;
        }
        showGlassToast('info', null, host.rejectMessage || 'Choose a file', false, 2500, '<i class="fas fa-folder-open"></i>');
        return;
    }
    const galleryMode = studioSaveFolderState.mode === 'open-gallery';
    const filename = item.previewImageFilename || item.targetId;
    if (item.targetKind === 'image' || item.targetKind === 'scrap' || item.shortcutType === 'image') {
        const imageName = item.shortcutType === 'image'
            ? ((item.shortcutData && item.shortcutData.filename) || filename)
            : filename;
        await studioOpenSessionFromImage(imageName, item.workspaceId);
        return;
    }
    if (galleryMode) {
        showGlassToast('info', null, 'Choose an image', false, 2000, '<i class="fas fa-images"></i>');
        return;
    }
    if (item.shortcutType === 'request' || item.shortcutType === 'preset') {
        const shortcut = {
            type: item.shortcutType,
            name: item.name,
            id: item.id,
            data: item.shortcutData || {}
        };
        const modal = document.getElementById('studioSaveFolderModal');
        if (modal) closeModal(modal);
        // desktopShortcuts: public/scripts/comp/desktopShortcuts.js
        if (item.shortcutType === 'request') await desktopShortcuts.handleRequestClick(shortcut);
        else await desktopShortcuts.handlePresetClick(shortcut);
        return;
    }
    showGlassToast('info', null, 'Choose an image, preset, or saved session', false, 2500, '<i class="fas fa-folder-open"></i>');
}

let studioAboutCloseHandler = null;

function hideStudioAboutSplash() {
    const splash = document.getElementById('manualModalSplash');
    if (studioAboutCloseHandler) {
        document.removeEventListener('pointerdown', studioAboutCloseHandler, true);
        studioAboutCloseHandler = null;
    }
    if (!splash) return;
    splash.classList.remove('splash-about');
    splash.classList.add('hidden');
    const statusText = splash.querySelector('.splash-status-text');
    if (statusText) {
        statusText.textContent = 'Initializing...';
        statusText.style.whiteSpace = '';
    }
}

function showStudioAboutSplash() {
    const splash = document.getElementById('manualModalSplash');
    if (!splash) return;
    hideStudioAboutSplash();
    const statusText = splash.querySelector('.splash-status-text');
    const clientVersion = (wsClient && wsClient.clientVersion) ? wsClient.clientVersion : '';
    const lines = ['DreamStudio 2026 R7'];
    if (clientVersion) lines.push('Client ' + clientVersion);
    if (statusText) statusText.textContent = lines.join('\n');
    splash.classList.add('splash-about');
    splash.classList.remove('hidden');
    studioAboutCloseHandler = function () {
        hideStudioAboutSplash();
    };
    setTimeout(() => {
        if (!studioAboutCloseHandler) return;
        document.addEventListener('pointerdown', studioAboutCloseHandler, true);
    }, 0);
    fetch('/app', { method: 'OPTIONS', cache: 'no-cache' })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => {
            if (!data || !splash.classList.contains('splash-about') || !statusText) return;
            const serverVersion = data.serverVersion || data.version;
            if (!serverVersion) return;
            statusText.textContent = lines.concat(['Server ' + serverVersion]).join('\n');
        })
        .catch(() => { /* version line stays client-only */ });
}
