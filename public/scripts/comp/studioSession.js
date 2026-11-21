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
    viewMode: 'details',
    grid: null,
    history: [],
    historyIndex: -1,
    expandedHeight: 0,
    navToken: 0,
    wired: false,
    mode: 'save',
    selected: [],
    shown: [],
    host: null,
    hasMore: false,
    loadingMore: false,
    labels: new Map(),
    tree: null,
    typeIndex: 0,
    glob: null,
    search: '',
    searchTimer: null,
    suggestIndex: -1,
    typeAhead: '',
    typeAheadAt: 0,
    menuItem: null,
    crumbs: []
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
            // The preset list only (refreshAppOptionsChunk: public/scripts/comp/appBootstrap.js)
            await refreshAppOptionsChunk('presets');
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
    if (!item || item.kind === 'folder') return false;
    // a program saving files (Paint, Notepad ...): its files are user files, which carry no shortcut type
    if (studioSaveFolderAcceptType() === 'user-file') return item.targetKind === 'user-file';
    return item.shortcutType === studioSaveFolderAcceptType();
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

// ---- the Save As / Open dialog: Vista's common file dialog (app.html #studioSaveFolderModal,
// vista-file-dialog.css), one implementation for every program (Yukimi, Nov 20 2026 review, #962).
// An Explorer view on the VFS: Back / Forward / Recent Pages, the crumbs (Computer ▸ Local Disk (C:) ▸ …)
// and a typed path, Search (the server's, over the whole folder), Organize / Views / New Folder,
// Favorite Links (with the Gallery) and the Folders tree (Cartograph's, explorerVistaChrome.js), the list
// filtered by the file type, its keys (arrows, type-ahead, Enter, Backspace, F2, Delete, F5, Alt+arrows)
// and right-click menu; File name takes a name, a folder, a path or a wildcard and suggests the names in
// the folder; Save asks before replacing; the folder is remembered per program. Modes: 'save', 'folder'
// (pick a folder: Folder: / Select Folder), and the open modes ('open', 'open-vfs', 'open-gallery').
//
// host (optional): { title, typeLabel | types: [{ label, accept(item)?, ext? }], acceptItem(item),
//   acceptType, suggestName(), rejectMessage, onOpen(item, folder), onOpenMany(items, folder) (several
//   files), onSave({ path, name, overwrite, workspaceId, type }), onCancel(), extraButton { label, onClick },
//   rememberKey (the program's own key for the last folder) }
// options: { owner, startPath, forceStart (the program's document folder wins over the remembered one) }

// The dialog's helpers are its own; the names other files call are exported at the end.
(function () {
    const STUDIO_SAVE_FOLDER_COLLAPSED_KEY = 'studioSaveFolderCollapsed';
    const STUDIO_SAVE_FOLDER_LAST_KEY = 'fileDialogLastFolders';
    const STUDIO_SAVE_FOLDER_PAGE = 300;
    const STUDIO_SAVE_FOLDER_VIEWS = [
        ['icons-xl', 'Extra Large Icons'],
        ['icons-lg', 'Large Icons'],
        ['icons-md', 'Medium Icons'],
        ['icons-sm', 'Small Icons'],
        ['list', 'List'],
        ['details', 'Details'],
        ['tiles', 'Tiles']
    ];
    const STUDIO_SAVE_FOLDER_ART = '/static_images/vista-explorer';

    /** A VFS request whose server error this dialog reports itself (one Vista error box, no exception window). */
    function studioSaveFolderQuiet(fn) {
        return wsClient && typeof wsClient.handlesErrors === 'function' ? wsClient.handlesErrors(fn) : fn();
    }

    function studioSaveFolderModalEl() {
        return document.getElementById('studioSaveFolderModal');
    }

    function studioSaveFolderIsOpenMode() {
        const mode = studioSaveFolderState.mode;
        return mode !== 'save' && mode !== 'folder';
    }

    /** The Computer page (Cartograph's: its drives) rather than a VFS folder. */
    function studioSaveFolderComputerPath() {
        return window.ExplorerComputerView ? window.ExplorerComputerView.PATH : 'Computer';
    }

    function studioSaveFolderAtComputer(path) {
        return (path || studioSaveFolderState.path) === studioSaveFolderComputerPath();
    }

    /** Cartograph's applet, for its icons, type names, rename / delete and Computer's drives. */
    function studioSaveFolderExplorer() {
        try {
            // initializeExplorerApplet: public/scripts/comp/explorerApplet.js
            return initializeExplorerApplet();
        } catch (_err) {
            return null;
        }
    }

    /** Cartograph's Vista helpers (type names, dates, row metrics) while the Vista chrome is on;
     *  ExplorerVistaChrome's methods only need the applet, so Cartograph need not have been opened. */
    function studioSaveFolderVista() {
        const Chrome = window.ExplorerVistaChrome;
        if (!Chrome) return null;
        const proto = Chrome.prototype;
        const ctx = { app: studioSaveFolderExplorer() || {} };
        if (!proto.isOn.call(ctx)) return null;
        return {
            typeLabel: (item) => (item && item.fdTypeLabel) || proto.typeLabel.call(ctx, item),
            formatDate: (ts) => proto.formatDate.call(ctx, ts),
            modeMetrics: (mode) => proto.modeMetrics.call(ctx, mode)
        };
    }

    function studioSaveFolderIsFolder(item) {
        if (!item) return false;
        return !!studioSaveFolderNavPath(item, studioSaveFolderState.path);
    }

    // ---- file types ----

    /** "(*.txt; *.log)" in a type's label: the extensions it lists (null for *.* or none). */
    function studioSaveFolderLabelExts(label) {
        const m = String(label || '').match(/\(([^()]*\*\.[^()]*)\)\s*$/);
        if (!m) return null;
        const exts = m[1].split(/[;,]\s*|\s+/).map((p) => p.trim()).filter(Boolean)
            .map((p) => p.replace(/^\*\./, '').toLowerCase());
        if (!exts.length || exts.includes('*')) return null;
        return exts;
    }

    /** The program's file types: host.types, else its one typeLabel. */
    function studioSaveFolderTypes() {
        const host = studioSaveFolderState.host;
        if (host && Array.isArray(host.types) && host.types.length) return host.types;
        return [{ label: studioSaveFolderTypeLabel() }];
    }

    function studioSaveFolderCurrentType() {
        const types = studioSaveFolderTypes();
        return types[Math.min(types.length - 1, Math.max(0, studioSaveFolderState.typeIndex || 0))] || types[0];
    }

    /** What the program itself takes, whatever the type list says. */
    function studioSaveFolderHostAccepts(item) {
        const host = studioSaveFolderState.host;
        const mode = studioSaveFolderState.mode;
        if (host && typeof host.acceptItem === 'function') return !!host.acceptItem(item);
        if (mode === 'save') {
            const accept = studioSaveFolderAcceptType();
            if (accept === 'user-file') return item.targetKind === 'user-file';
            return studioSaveFolderSameType(item);
        }
        if (host && host.acceptType) return item.shortcutType === host.acceptType;
        // Studio's own Open: pictures, presets and saved sessions (studioOpenFolderItem)
        const picture = item.targetKind === 'image' || item.targetKind === 'scrap' || item.shortcutType === 'image';
        if (mode === 'open-gallery') return picture;
        return picture || item.shortcutType === 'request' || item.shortcutType === 'preset';
    }

    /** A file the list shows: the program takes it and it is of the chosen type (and the typed wildcard). */
    function studioSaveFolderShows(item) {
        if (!item) return false;
        if (studioSaveFolderIsFolder(item)) return true;
        if (studioSaveFolderState.mode === 'folder') return false;
        const type = studioSaveFolderCurrentType();
        // All Files (*.*) in an Open dialog lists everything; Open still asks the program
        const everything = studioSaveFolderIsOpenMode() && /\(\*\.\*\)\s*$/.test(String((type && type.label) || ''));
        if (!everything && !studioSaveFolderHostAccepts(item)) return false;
        if (type && typeof type.accept === 'function' && !type.accept(item)) return false;
        const exts = type ? studioSaveFolderLabelExts(type.label) : null;
        const name = String(item.name || '').toLowerCase();
        if (exts && item.targetKind === 'user-file' && !exts.some((ext) => name.endsWith(`.${ext}`))) return false;
        const glob = studioSaveFolderState.glob;
        if (glob && !glob.test(item.name || '')) return false;
        return true;
    }

    /** The type's own extension, added to a typed name that has none (Vista's default extension). */
    function studioSaveFolderWithExt(name) {
        const type = studioSaveFolderCurrentType();
        if (!type || studioSaveFolderAcceptType() !== 'user-file') return name;
        const ext = type.ext || ((studioSaveFolderLabelExts(type.label) || [])[0] || '');
        if (!ext || /\.[a-z0-9]{1,6}$/i.test(name)) return name;
        return `${name}.${String(ext).replace(/^\./, '')}`;
    }

    function studioSaveFolderSyncTypes() {
        const select = document.getElementById('studioSaveFolderType');
        if (!select) return;
        const types = studioSaveFolderTypes();
        select.innerHTML = '';
        types.forEach((type, i) => {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = type.label;
            select.appendChild(option);
        });
        select.value = String(studioSaveFolderState.typeIndex || 0);
    }

    // ---- views, listing ----

    function studioSaveFolderSetView(mode) {
        studioSaveFolderState.viewMode = mode;
        if (studioSaveFolderState.grid) studioSaveFolderState.grid.setViewMode(mode);
        const pane = document.querySelector('#studioSaveFolderModal .explorer-view-pane');
        if (pane) pane.dataset.view = mode === 'details' ? 'details' : (mode === 'list' ? 'list' : 'icons');
        const icon = document.querySelector('#studioSaveFolderViewsBtn .explorer-command-icon');
        if (icon) {
            // the Views button shows the current view's icon (as Cartograph's does)
            const art = `views-${STUDIO_SAVE_FOLDER_VIEWS.some(([m]) => m === mode) ? mode : 'icons-lg'}`;
            icon.src = `${STUDIO_SAVE_FOLDER_ART}/${art}.png`;
            icon.srcset = `${STUDIO_SAVE_FOLDER_ART}/${art}.png 1x, ${STUDIO_SAVE_FOLDER_ART}/${art}@2x.png 2x`;
        }
    }

    /** The folder's items as the list shows them: of the chosen type, folders always. */
    function studioSaveFolderShowItems() {
        const items = studioSaveFolderState.items.filter((item) => studioSaveFolderShows(item));
        studioSaveFolderState.shown = items;
        if (studioSaveFolderState.grid) studioSaveFolderState.grid.resetItems(items);
        void studioSaveFolderFill();
    }

    /** The next page of a long folder (the Gallery has thousands of pictures). */
    async function studioSaveFolderLoadMore() {
        const state = studioSaveFolderState;
        if (!state.hasMore || state.loadingMore || studioSaveFolderAtComputer()) return;
        state.loadingMore = true;
        const token = state.navToken;
        const path = state.path;
        try {
            const sort = studioSaveFolderSort();
            const result = await studioSaveFolderQuiet(() => vfsClient.listDirectory(path, {
                offset: state.items.length,
                limit: STUDIO_SAVE_FOLDER_PAGE,
                sortField: sort.field,
                sortDirection: sort.direction,
                search: state.search || ''
            }));
            if (token !== state.navToken) return;
            const more = (result && result.items) || [];
            state.items = state.items.concat(more);
            state.hasMore = more.length > 0 && studioSaveFolderHasMore(result, state.items.length);
            state.shown = state.items.filter((item) => studioSaveFolderShows(item));
            if (state.grid) state.grid.extendItems(state.shown);
        } catch (_err) {
            state.hasMore = false;
        } finally {
            state.loadingMore = false;
        }
    }

    function studioSaveFolderHasMore(result, loaded) {
        const total = Number(result && result.totalCount);
        return (result && result.hasMore === true) || (Number.isFinite(total) && total > loaded);
    }

    /** Pages on until the list fills its box (a type filter can leave a page nearly empty). */
    async function studioSaveFolderFill() {
        const state = studioSaveFolderState;
        let guard = 0;
        while (state.hasMore && state.grid && state.grid.needsMoreContent() && guard < 10) {
            guard += 1;
            const before = state.items.length;
            await studioSaveFolderLoadMore();
            if (state.items.length <= before) break;
        }
    }

    /** Computer: Local Disk (C:) and the network drives Cartograph's Computer shows. */
    function studioSaveFolderComputerItems() {
        const view = window.ExplorerComputerView;
        const explorer = studioSaveFolderExplorer();
        const items = [{
            id: 'fd-drive-c',
            name: (view && view.ROOT_NAME) || 'Local Disk (C:)',
            kind: 'folder',
            navPath: '/',
            fdIcon: 'drive-system-16.png',
            fdTypeLabel: 'Local Disk'
        }];
        const computer = (explorer && explorer.computer) || studioSaveFolderComputerStub();
        // the phone's own drives (inside the Android app / a hybrid phone's DeX window), lettered as Computer does
        (typeof computer.phoneDrives === 'function' ? computer.phoneDrives() : []).forEach((d) => {
            if (!d.path || d.block) return;
            items.push({ id: `fd-${d.key}`, name: d.letter ? `${d.name} (${d.letter}:)` : d.name, kind: 'folder', navPath: d.path, fdIcon: d.hdd ? 'drive-fixed-16.png' : 'drive-removable-16.png', fdTypeLabel: d.hdd ? 'Local Disk' : 'Removable Disk' });
        });
        // Portable Devices: each phone over ActiveSync, opening to its storages
        (typeof computer.portableDevices === 'function' ? computer.portableDevices() : []).forEach((d) => {
            if (!window.ExplorerComputerView) return;
            items.push({ id: `fd-${d.key}`, name: d.name, kind: 'folder', navPath: window.ExplorerComputerView.devicePath(d.deviceId), fdIcon: window.ExplorerComputerView.deviceIcon(d, 16), fdTypeLabel: 'Portable Media Player' });
        });
        const nets = computer && typeof computer.networkDrives === 'function' ? computer.networkDrives() : [];
        nets.forEach((d) => {
            if (!d.path) return;
            items.push({ id: `fd-${d.key}`, name: d.name, kind: 'folder', navPath: d.path, fdIcon: d.online ? 'drive-network-16.png' : 'drive-network-off-16.png', fdTypeLabel: 'Network Drive' });
        });
        return items;
    }

    /** The crumbs: the place's icon, then Computer ▸ Local Disk (C:) ▸ … (Cartograph's trail). */
    function studioSaveFolderRenderCrumbs(displayPath) {
        const host = document.getElementById('studioSaveFolderCrumbs');
        if (!host) return;
        const path = studioSaveFolderState.path;
        const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const view = window.ExplorerComputerView;
        const crumbs = [{ label: 'Computer', path: studioSaveFolderComputerPath() }];
        let icon = 'crumb-folder.png';
        const deviceId = studioSaveFolderDeviceId(path);
        const phone = studioSaveFolderIsPhonePath(path);
        if (studioSaveFolderAtComputer(path)) {
            icon = 'computer-16.png';
        } else if (deviceId) {
            const view = studioSaveFolderComputerStub();
            crumbs.push({ label: typeof view.deviceName === 'function' ? view.deviceName(deviceId) : 'Portable Device', path });
            icon = window.ExplorerComputerView ? window.ExplorerComputerView.deviceIcon(deviceId, 16) : 'portable-device-16.png';
        } else if (phone) {
            // Computer ▸ <device> ▸ Internal storage ▸ DCIM (explorerPhoneDrive.js)
            window.explorerPhoneDrive.crumbs(path).forEach((c) => crumbs.push(c));
            icon = window.explorerPhoneDrive.crumbIcon(path);
        } else {
            const parts = path.split('/').filter(Boolean);
            const labels = String(displayPath || '').split('/').filter(Boolean);
            const network = window.explorerSequenzia && window.explorerSequenzia.isPath(path);
            if (!network) crumbs.push({ label: (view && view.ROOT_NAME) || 'Local Disk (C:)', path: '/' });
            parts.forEach((part, i) => {
                const label = labels.length === parts.length ? labels[i] : part;
                crumbs.push({ label, path: `/${parts.slice(0, i + 1).join('/')}` });
            });
            if (path === '/') icon = 'drive-system-16.png';
            if (network && path === window.explorerSequenzia.ROOT) icon = 'drive-network-16.png';
            if (/^\/Workspaces\/[^/]+\/Pictures$/.test(path)) icon = '/static_images/vista-file-dialog/fav-gallery.png';
        }
        studioSaveFolderState.crumbs = crumbs;
        crumbs.forEach((c) => studioSaveFolderState.labels.set(c.path, c.label));
        // the 1x art (hidpi/<tier>/img.css matches the exact src for its density)
        const iconSrc = icon.startsWith('/') ? icon : `${STUDIO_SAVE_FOLDER_ART}/${icon}`;
        let html = `<img class="fd-crumb-icon" src="${iconSrc}" alt="" draggable="false">`;
        crumbs.forEach((c) => {
            html += `<button type="button" class="cpl-crumb-sep fd-crumb-sep" data-crumb-menu="${esc(c.path)}" tabindex="-1" aria-label="Places in ${esc(c.label)}">&#9656;</button>`;
            html += `<button type="button" class="cpl-crumb" data-crumb-path="${esc(c.path)}">${esc(c.label)}</button>`;
        });
        // Vista ends the trail with the ▸ of the folder on screen (its sub-folders)
        html += `<button type="button" class="cpl-crumb-sep fd-crumb-sep" data-crumb-menu="${esc(path)}" tabindex="-1" aria-label="Folders here">&#9656;</button>`;
        // the box's ▾: the places visited (its menu is built as it opens)
        html += '<button type="button" class="fd-address-drop" data-fd-address-drop tabindex="-1" aria-label="Previous Locations"></button>';
        host.innerHTML = html;
        studioSaveFolderFoldCrumbs();
    }

    /** A trail too long for the box: Vista folds crumbs from the left into « (a menu of them). */
    function studioSaveFolderFoldCrumbs() {
        const host = document.getElementById('studioSaveFolderCrumbs');
        const crumbs = studioSaveFolderState.crumbs || [];
        if (!host || !host.clientWidth) return;
        const old = host.querySelector('.fd-crumb-overflow');
        if (old) old.remove();
        const nodes = [...host.querySelectorAll('[data-crumb-path]')];
        nodes.forEach((n) => { n.hidden = false; if (n.previousElementSibling) n.previousElementSibling.hidden = false; });
        // the ▾ sits in the box's right margin, outside the room the crumbs have: not measured
        const drop = host.querySelector('.fd-address-drop');
        if (drop) drop.hidden = true;
        const fits = () => host.scrollWidth <= host.clientWidth;
        if (fits()) {
            if (drop) drop.hidden = false;
            return;
        }
        const icon = host.querySelector('.fd-crumb-icon');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'fd-crumb-overflow';
        more.tabIndex = -1;
        more.setAttribute('aria-label', 'Previous Locations');
        more.textContent = '«';
        if (icon) icon.after(more);
        let folded = 0;
        while (!fits() && folded < nodes.length - 1) {
            nodes[folded].hidden = true;
            if (nodes[folded].previousElementSibling && nodes[folded].previousElementSibling.matches('.fd-crumb-sep')) nodes[folded].previousElementSibling.hidden = true;
            folded += 1;
        }
        // the first crumb still shown keeps no ▸ before it (« stands there)
        const first = nodes[folded];
        if (first && first.previousElementSibling && first.previousElementSibling.matches('.fd-crumb-sep')) first.previousElementSibling.hidden = true;
        if (drop) drop.hidden = false;
        if (contextMenu) {
            const items = crumbs.slice(0, folded).reverse().map((c) => ({ text: c.label, action: `p:${c.path}` }));
            contextMenu.attachClickMenuToElement(more, {
                sections: [{ type: 'list', items }],
                onAction: (action) => { if (action.startsWith('p:')) studioSaveFolderNavigate(action.slice(2)); }
            });
        }
    }

    /** A crumb's ▸: the folders in that place, the next one along bold (Vista's breadcrumb menu). */
    async function studioSaveFolderCrumbMenu(sep, path) {
        if (!contextMenu) return;
        let folders = [];
        if (studioSaveFolderAtComputer(path)) {
            folders = studioSaveFolderComputerItems().map((it) => ({ name: it.name, path: it.navPath }));
        } else {
            try {
                const result = await studioSaveFolderQuiet(() => vfsClient.listDirectory(path, { offset: 0, limit: 200, sortField: 'name', sortDirection: 'asc' }));
                folders = ((result && result.items) || []).map((it) => ({ name: it.name, path: studioSaveFolderNavPath(it, path) })).filter((f) => f.path);
            } catch (_err) { /* an empty menu */ }
        }
        const crumbs = studioSaveFolderState.crumbs || [];
        const i = crumbs.findIndex((c) => c.path === path);
        const next = i >= 0 && crumbs[i + 1] ? crumbs[i + 1].path : null;
        const items = folders.slice(0, 40).map((f) => ({ text: f.name, action: `p:${f.path}`, className: f.path === next ? 'context-menu-item-default' : '' }));
        if (!items.length) items.push({ text: '(Empty)', action: 'none', disabled: true });
        contextMenu.attachClickMenuToElement(sep, {
            sections: [{ type: 'list', items }],
            onAction: (action) => {
                if (action.startsWith('p:')) studioSaveFolderNavigate(action.slice(2));
            }
        });
        // under the ▸, its left edge (Vista's breadcrumb drop-down)
        const r = sep.getBoundingClientRect();
        if (typeof contextMenu.showClickMenu === 'function') contextMenu.showClickMenu({ clientX: r.left, clientY: r.bottom }, sep, false);
        else if (typeof contextMenu.openClickMenu === 'function') contextMenu.openClickMenu(sep);
    }

    function studioSaveFolderSyncTravel() {
        const back = document.getElementById('studioSaveFolderBackBtn');
        const forward = document.getElementById('studioSaveFolderForwardBtn');
        const recent = document.getElementById('studioSaveFolderRecentBtn');
        const h = studioSaveFolderState.history || [];
        const i = studioSaveFolderState.historyIndex == null ? -1 : studioSaveFolderState.historyIndex;
        if (back) back.disabled = i <= 0;
        if (forward) forward.disabled = i < 0 || i >= h.length - 1;
        if (recent) recent.disabled = h.length < 2;
    }

    function studioSaveFolderLabelFor(path) {
        if (studioSaveFolderState.labels.has(path)) return studioSaveFolderState.labels.get(path);
        if (path === '/') return (window.ExplorerComputerView && window.ExplorerComputerView.ROOT_NAME) || 'Local Disk (C:)';
        return String(path || '').split('/').filter(Boolean).pop() || path;
    }

    /** Recent Pages: forward pages on top, the current one marked, then back (Vista's order). */
    function studioSaveFolderRecentItems() {
        const h = studioSaveFolderState.history || [];
        const at = studioSaveFolderState.historyIndex;
        const items = [];
        for (let i = Math.min(h.length - 1, at + 4); i >= Math.max(0, at - 4); i--) {
            items.push(i === at
                ? { text: studioSaveFolderLabelFor(h[i]), action: `h:${i}`, indicatorStyle: 'dot', checked: true }
                : { text: studioSaveFolderLabelFor(h[i]), action: `h:${i}` });
        }
        return items;
    }

    /** Favorite Links: this workspace's places, the Gallery (Windows Photo Gallery's icon), Computer, Workspaces, Library. */
    function studioSaveFolderLinks() {
        const ws = typeof activeWorkspace !== 'undefined' && activeWorkspace ? activeWorkspace : null;
        const fav = (name) => [`${STUDIO_SAVE_FOLDER_ART}/${name}`];
        const links = [];
        if (ws) {
            links.push(['Desktop', `/Workspaces/${ws}/Desktop`, fav('fav-desktop.png')]);
            links.push(['Documents', `/Workspaces/${ws}`, fav('fav-documents.png')]);
            // the workspace's gallery (its Pictures folder), browsed as a folder (Yukimi, Nov 20 2026)
            links.push(['Gallery', `/Workspaces/${ws}/Pictures`, ['/static_images/vista-file-dialog/fav-gallery.png']]);
        }
        links.push(['Computer', studioSaveFolderComputerPath(), [`${STUDIO_SAVE_FOLDER_ART}/computer-16.png`]]);
        if (ws) {
            links.push(['References', `/Workspaces/${ws}/References`, fav('fav-searches.png')]);
            links.push(['Notes', `/Workspaces/${ws}/Notes`, fav('fav-documents.png')]);
        }
        links.push(['Workspaces', '/Workspaces', fav('fav-public.png')]);
        links.push(['Library', '/System/Cache', fav('fav-recent.png')]);
        return links;
    }

    function studioSaveFolderRenderLinks() {
        const host = document.getElementById('studioSaveFolderLinks');
        if (!host) return;
        const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        host.innerHTML = studioSaveFolderLinks().map(([label, path, art]) => `
            <li><button type="button" class="explorer-favorite-link" data-path="${esc(path)}" title="${label}">
                <img src="${art[0]}" alt="" draggable="false"><span>${label}</span></button></li>`).join('');
        studioSaveFolderSyncLinks();
        // an open Folders tree keeps three links and More » (Cartograph's rule)
        const chrome = studioSaveFolderTreeChrome();
        if (chrome) chrome.layoutFavorites();
    }

    function studioSaveFolderSyncLinks() {
        document.querySelectorAll('#studioSaveFolderLinks .explorer-favorite-link').forEach((b) => {
            b.classList.toggle('is-current', b.dataset.path === studioSaveFolderState.path);
        });
    }

    // ---- the Folders tree: Cartograph's own (explorerVistaChrome.js) on this window's elements ----

    function studioSaveFolderTreeChrome() {
        const state = studioSaveFolderState;
        if (state.tree) return state.tree;
        const Chrome = window.ExplorerVistaChrome;
        const treeEl = document.getElementById('studioSaveFolderTree');
        if (!Chrome || !treeEl) return null;
        const explorer = studioSaveFolderExplorer();
        const app = {
            get currentPath() { return state.path; },
            // Cartograph's Computer page when it has been opened, else its drives straight from their owners
            get computer() { return (explorer && explorer.computer) || studioSaveFolderComputerStub(); },
            get history() { return state.history; },
            get historyIndex() { return state.historyIndex; },
            modal: null,
            navigateTo: (path) => studioSaveFolderNavigate(path),
            isFolderItem: (item) => (explorer && typeof explorer.isFolderItem === 'function' ? explorer.isFolderItem(item) : !!studioSaveFolderNavPath(item, '/')),
            resolveNavigationPath: (item) => studioSaveFolderNavPath(item, state.path)
        };
        const chrome = Object.create(Chrome.prototype);
        chrome.app = app;
        chrome.labels = new Map([['/', (window.ExplorerComputerView && window.ExplorerComputerView.ROOT_NAME) || 'Computer']]);
        chrome.treeSpecs = new WeakMap();
        chrome.el = {
            tree: treeEl,
            folders: document.getElementById('studioSaveFolderFolders'),
            foldersBar: document.getElementById('studioSaveFolderFoldersBar'),
            favorites: document.getElementById('studioSaveFolderLinks'),
            favoritesMore: document.getElementById('studioSaveFolderLinksMore')
        };
        // Favorite Links folds to three under an open tree; More » lists the rest (this dialog's links)
        chrome.favoriteLinks = () => studioSaveFolderLinks().map(([label, path]) => ({ label, path }));
        // the dialog's Control Panel node opens Control Panel, as in Cartograph
        state.tree = chrome;
        return chrome;
    }

    /**
     * Computer's drives as Cartograph's Computer shows them (explorerComputerView.js): Cartograph's own view when it
     * has been opened, else one of its kind on this dialog (phoneDrives / portableDevices / networkDrives read the
     * phone, ActiveSync and Sequenzia themselves); opening a drive goes there in this dialog.
     */
    function studioSaveFolderComputerStub() {
        const explorer = studioSaveFolderExplorer();
        if (explorer && explorer.computer) return explorer.computer;
        const View = window.ExplorerComputerView;
        if (!View) {
            return { phoneDrives: () => [], portableDevices: () => [], networkDrives: () => (window.explorerSequenzia ? window.explorerSequenzia.computerDrives() : []), openDrive: () => {} };
        }
        if (!studioSaveFolderState.computerView) {
            const view = Object.create(View.prototype);
            view.app = studioSaveFolderPhoneApp();
            view.openDrive = (key) => {
                const all = [...view.phoneDrives(), ...view.networkDrives()];
                const d = all.find((n) => n.key === key);
                if (d && d.path && !d.block) studioSaveFolderNavigate(d.path);
            };
            studioSaveFolderState.computerView = view;
        }
        return studioSaveFolderState.computerView;
    }

    /** This dialog as an "app" for the phone drive (explorerPhoneDrive.js list / watch). */
    function studioSaveFolderPhoneApp() {
        const state = studioSaveFolderState;
        if (state.phoneApp) return state.phoneApp;
        state.phoneApp = {
            modal: null,
            computer: null,
            get currentPath() { return state.path; },
            get sortField() { return studioSaveFolderSort().field; },
            get sortDirection() { return studioSaveFolderSort().direction; },
            navigateTo: (path) => studioSaveFolderNavigate(path),
            softRefresh: () => studioSaveFolderNavigate(state.path, { history: false, keepSearch: true }),
            _isComputerPath: () => studioSaveFolderAtComputer()
        };
        return state.phoneApp;
    }

    function studioSaveFolderIsPhonePath(path) {
        return !!(window.explorerPhoneDrive && window.explorerPhoneDrive.isPath(path));
    }

    /** A portable device's page (Computer ▸ <device>): its storages. */
    function studioSaveFolderDeviceId(path) {
        const View = window.ExplorerComputerView;
        return View && typeof View.deviceIdOf === 'function' ? View.deviceIdOf(path) : null;
    }

    /** Places of the dialog's own: Computer, a device page, the phone; not VFS folders (no New Folder there). */
    function studioSaveFolderIsVfs(path) {
        const p = path || studioSaveFolderState.path;
        return !studioSaveFolderAtComputer(p) && !studioSaveFolderDeviceId(p) && !studioSaveFolderIsPhonePath(p);
    }

    function studioSaveFolderToggleTree() {
        const chrome = studioSaveFolderTreeChrome();
        if (!chrome) return;
        chrome.toggleFolders();
        try { localStorage.setItem('fileDialogFoldersOpen', chrome.el.folders.classList.contains('is-open') ? '1' : '0'); } catch (_err) { /* this time only */ }
    }

    function studioSaveFolderSyncTree() {
        const chrome = studioSaveFolderState.tree;
        if (chrome && chrome.el.folders && chrome.el.folders.classList.contains('is-open')) void chrome.syncTree();
    }

    // ---- navigation ----

    /** Go to a folder; history: false for Back / Forward and Refresh. */
    async function studioSaveFolderNavigate(path, options = {}) {
        const state = studioSaveFolderState;
        const token = ++state.navToken;
        const target = path || '/';
        if (options.history !== false && target !== state.history?.[state.historyIndex]) {
            const h = (state.history || []).slice(0, (state.historyIndex ?? -1) + 1);
            h.push(target);
            state.history = h;
            state.historyIndex = h.length - 1;
        }
        const moved = state.path !== target;
        state.path = target;
        const newFolder = document.getElementById('studioSaveFolderNewFolderBtn');
        if (newFolder) newFolder.disabled = !studioSaveFolderIsVfs(target);
        state.hasMore = false;
        if (moved) state.glob = null;
        studioSaveFolderSyncTravel();
        studioSaveFolderSyncLinks();
        studioSaveFolderRenderCrumbs(null);
        studioSaveFolderSyncTree();
        const search = document.getElementById('studioSaveFolderSearch');
        if (search && !options.keepSearch) {
            search.value = '';
            state.search = '';
        }
        if (studioSaveFolderAtComputer(target)) {
            state.items = studioSaveFolderComputerItems();
            studioSaveFolderShowItems();
            studioSaveFolderSyncFolderName();
            return;
        }
        // a phone place is listed by the phone drive (explorerPhoneDrive.js), a device page by ActiveSync
        if (window.explorerPhoneDrive && !studioSaveFolderIsPhonePath(target)) window.explorerPhoneDrive.leave(studioSaveFolderPhoneApp());
        const deviceId = studioSaveFolderDeviceId(target);
        if (deviceId || studioSaveFolderIsPhonePath(target)) {
            try {
                let items = [];
                if (deviceId) {
                    const Chrome = window.ExplorerVistaChrome;
                    const specs = Chrome ? await Chrome.prototype.deviceStorageSpecs.call({}, deviceId) : [];
                    items = specs.map((sp) => ({ id: `fd-storage:${sp.path}`, name: sp.label, kind: 'folder', navPath: sp.path, fdIcon: sp.icon === 'fixed' ? 'drive-fixed-16.png' : 'drive-removable-16.png', fdTypeLabel: 'Storage' }));
                } else {
                    const result = await window.explorerPhoneDrive.list(studioSaveFolderPhoneApp(), target);
                    items = (result && result.items) || [];
                    const q = (state.search || '').toLowerCase();
                    if (q) items = items.filter((it) => String(it.name || '').toLowerCase().includes(q));
                }
                if (token !== state.navToken) return;
                state.items = items;
                studioSaveFolderShowItems();
                studioSaveFolderSyncFolderName();
                studioSaveFolderRenderCrumbs(null);
            } catch (err) {
                if (token !== state.navToken) return;
                await studioSaveFolderMessage(`${studioSaveFolderLabelFor(target)}\n\n${(err && err.message) || 'The device is not available.'}`, 'error');
            }
            return;
        }
        if (!wsClient || !wsClient.isConnected()) return;
        try {
            // the order Cartograph uses (its headers, Organize > Sort By), and the dialog's own changes to it
            const sort = studioSaveFolderSort();
            const result = await studioSaveFolderQuiet(() => vfsClient.listDirectory(target, {
                offset: 0,
                limit: STUDIO_SAVE_FOLDER_PAGE,
                sortField: sort.field,
                sortDirection: sort.direction,
                search: state.search || ''
            }));
            if (token !== state.navToken) return;
            // a path typed by its names (Downloads) becomes the folder's own (its id): New Folder, saves and
            // the tree work on that
            if (result && typeof result.path === 'string' && result.path && result.path !== target) {
                state.path = result.path;
                if (state.history[state.historyIndex] === target) state.history[state.historyIndex] = result.path;
                studioSaveFolderSyncLinks();
                studioSaveFolderRenderCrumbs(null);
                studioSaveFolderSyncTree();
            }
            state.items = result && result.items ? result.items : [];
            state.hasMore = studioSaveFolderHasMore(result, state.items.length);
            studioSaveFolderShowItems();
            studioSaveFolderSyncFolderName();
            try {
                const stats = await studioSaveFolderQuiet(() => vfsClient.getPathStats(state.path));
                if (token !== state.navToken) return;
                const displayPath = stats && (stats.displayPath || (stats.stats && stats.stats.displayPath));
                if (displayPath) {
                    studioSaveFolderRenderCrumbs(displayPath);
                    // Select Folder names the folder by its display name once it is known
                    if (!(state.selected || []).length) studioSaveFolderSyncFolderName();
                }
            } catch (_err) { /* keep the raw crumbs */ }
        } catch (err) {
            if (token !== state.navToken) return;
            if (options.fallback && options.fallback !== target) {
                state.history = [];
                state.historyIndex = -1;
                studioSaveFolderNavigate(options.fallback);
                return;
            }
            // Vista: "<path> is not accessible." in a message box; the dialog stays where it was
            await studioSaveFolderMessage(`${target}\n\n${(err && err.message) || 'The location is not available.'}`, 'error');
            const back = state.history[state.historyIndex - 1];
            if (options.history !== false && back && back !== target) {
                state.history.splice(state.historyIndex, 1);
                state.historyIndex -= 1;
                studioSaveFolderNavigate(back, { history: false });
            }
        }
    }

    /** Up one level (Backspace, Alt+Up): the parent folder, Computer above Local Disk (C:). */
    function studioSaveFolderUp() {
        const path = studioSaveFolderState.path;
        if (studioSaveFolderAtComputer(path)) return;
        if (studioSaveFolderDeviceId(path)) {
            studioSaveFolderNavigate(studioSaveFolderComputerPath());
            return;
        }
        if (studioSaveFolderIsPhonePath(path)) {
            studioSaveFolderNavigate(window.explorerPhoneDrive.parentOf(path) || studioSaveFolderComputerPath());
            return;
        }
        if (path === '/' || (window.explorerSequenzia && path === window.explorerSequenzia.ROOT)) {
            studioSaveFolderNavigate(studioSaveFolderComputerPath());
            return;
        }
        const parts = path.split('/').filter(Boolean);
        parts.pop();
        studioSaveFolderNavigate(parts.length ? `/${parts.join('/')}` : '/');
    }

    /** The folder's order: shared with Cartograph (localStorage explorerSortField / explorerSortDirection). */
    function studioSaveFolderSort() {
        let field = 'name';
        let direction = 'asc';
        try {
            field = localStorage.getItem('explorerSortField') || 'name';
            direction = localStorage.getItem('explorerSortDirection') || 'asc';
        } catch (_err) { /* the default order */ }
        // the workspace list's own order means nothing in a file dialog
        if (!['name', 'date', 'type', 'size'].includes(field)) field = 'name';
        return { field, direction: direction === 'desc' ? 'desc' : 'asc' };
    }

    function studioSaveFolderApplySort(field, direction) {
        try {
            localStorage.setItem('explorerSortField', field);
            localStorage.setItem('explorerSortDirection', direction === 'desc' ? 'desc' : 'asc');
        } catch (_err) { /* this dialog only */ }
        studioSaveFolderSyncSortHeader();
        studioSaveFolderNavigate(studioSaveFolderState.path, { history: false, keepSearch: true });
    }

    /** The column headers show which one sorts, and which way (as Cartograph's do). */
    function studioSaveFolderSyncSortHeader() {
        const sort = studioSaveFolderSort();
        document.querySelectorAll('#studioSaveFolderModal .explorer-details-header [data-sort-field]').forEach((col) => {
            const active = col.dataset.sortField === sort.field;
            col.classList.toggle('active', active);
            const icon = col.querySelector('.explorer-details-sort-icon');
            if (icon) icon.className = `explorer-details-sort-icon fas ${active ? (sort.direction === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'}`;
        });
    }

    function studioSaveFolderSortByItem() {
        const sort = studioSaveFolderSort();
        return window.vistaSortByMenu
            ? window.vistaSortByMenu([['name', 'Name'], ['date', 'Date modified'], ['type', 'Type'], ['size', 'Size']], sort.field, sort.direction, 'fd-sort')
            : null;
    }

    function studioSaveFolderGo(step) {
        studioSaveFolderGoTo((studioSaveFolderState.historyIndex ?? -1) + step);
    }

    function studioSaveFolderGoTo(index) {
        const h = studioSaveFolderState.history || [];
        if (!Number.isInteger(index) || index < 0 || index >= h.length || index === studioSaveFolderState.historyIndex) return;
        studioSaveFolderState.historyIndex = index;
        studioSaveFolderNavigate(h[index], { history: false });
    }

    function studioSaveFolderPopulateIcon(box, item) {
        if (item && item.fdIcon) {
            const img = document.createElement('img');
            img.src = `${STUDIO_SAVE_FOLDER_ART}/${item.fdIcon}`;
            img.alt = '';
            img.draggable = false;
            img.className = 'fd-place-icon';
            box.appendChild(img);
            return;
        }
        const explorer = studioSaveFolderExplorer();
        if (explorer) {
            explorer._populateIconBox(box, item);
            return;
        }
        const img = document.createElement('img');
        img.src = item.kind === 'folder' ? '/static_images/vista-icons/explorer/folder-16.png' : `${STUDIO_SAVE_FOLDER_ART}/details-folder.png`;
        img.alt = '';
        box.appendChild(img);
    }

    // ---- messages ----

    /** A Vista message box owned by the dialog: kind 'warning' | 'error' | 'info'; buttons default OK. */
    function studioSaveFolderMessage(text, kind = 'warning', buttons = null) {
        if (typeof showConfirmationDialog !== 'function') return Promise.resolve(false);
        const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const icon = kind === 'error' ? 'fas fa-circle-xmark' : kind === 'info' ? 'fas fa-circle-info' : 'fas fa-triangle-exclamation';
        return showConfirmationDialog(`<p>${esc(text).replace(/\n/g, '<br>')}</p>`,
            buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }],
            null,
            { title: studioSaveFolderTitleText(), icon, width: 380 });
    }

    // ---- New Folder, rename, delete ----

    /** New Folder: "New Folder", "New Folder (2)" ... in the current folder, then its name to type (Vista). */
    async function studioSaveFolderNewFolder() {
        const state = studioSaveFolderState;
        if (!studioSaveFolderIsVfs()) return;
        const taken = new Set(state.items.map((item) => String(item.name || '').toLowerCase()));
        let name = 'New Folder';
        for (let n = 2; taken.has(name.toLowerCase()) && n < 100; n += 1) name = `New Folder (${n})`;
        try {
            await studioSaveFolderQuiet(() => vfsClient.createFolder(state.path, name));
            await studioSaveFolderNavigate(state.path, { history: false, keepSearch: true });
            const index = (state.shown || []).findIndex((item) => item.name === name && studioSaveFolderIsFolder(item));
            if (index >= 0) {
                state.grid.selectIndex(index);
                studioSaveFolderRename(state.shown[index]);
            }
        } catch (err) {
            await studioSaveFolderMessage((err && err.message) || 'Could not create the folder.', 'error');
        }
    }

    /** Cartograph's applet acting on this dialog's list (its rename / delete rules, confirmations, Recycle Bin). */
    function studioSaveFolderExplorerProxy() {
        const explorer = studioSaveFolderExplorer();
        if (!explorer) return null;
        const state = studioSaveFolderState;
        const proxy = Object.create(explorer);
        proxy.grid = state.grid;
        proxy.currentPath = state.path;
        proxy.modal = studioSaveFolderModalEl();
        proxy.softRefresh = () => studioSaveFolderNavigate(state.path, { history: false, keepSearch: true });
        proxy.refresh = proxy.softRefresh;
        // its progress window is Cartograph's; here the work is a file or two
        proxy._beginProgress = () => null;
        return proxy;
    }

    /** Rename (F2, the menu, a new folder): the name edited in place, as Vista's list does. */
    function studioSaveFolderRename(item, retried) {
        const state = studioSaveFolderState;
        if (!item || item.system || item.protected || item.fdIcon) return;
        const inline = item.targetKind === 'vfs-folder' || (item.targetKind === 'user-file' && !item.isShortcut);
        if (!inline) {
            const proxy = studioSaveFolderExplorerProxy();
            if (proxy && typeof proxy.renameSelection === 'function') void proxy.renameSelection();
            return;
        }
        const el = state.grid && state.grid.elementFor(item.id);
        // a row the list has not drawn yet (a folder just made): after the next frames
        if (!el && !retried) {
            requestAnimationFrame(() => requestAnimationFrame(() => studioSaveFolderRename(item, true)));
            return;
        }
        const label = el && el.querySelector('.explorer-item-label, .explorer-item-list-label, .explorer-item-name');
        if (!label) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'fd-rename-box';
        input.value = item.name || '';
        input.spellcheck = false;
        label.classList.add('fd-renaming');
        label.appendChild(input);
        input.focus();
        // the name without its extension is selected (Vista)
        const dot = item.targetKind === 'user-file' ? input.value.lastIndexOf('.') : -1;
        input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
        let done = false;
        const finish = async (save) => {
            if (done) return;
            done = true;
            const name = input.value.trim();
            input.remove();
            label.classList.remove('fd-renaming');
            const grid = document.getElementById('studioSaveFolderGrid');
            if (grid) grid.focus();
            if (!save || !name || name === item.name) return;
            if (/[\\/:*?"<>|]/.test(name)) {
                await studioSaveFolderMessage('A file name can\'t contain any of the following characters:\n\\ / : * ? " < > |', 'error');
                return;
            }
            try {
                if (item.targetKind === 'vfs-folder') await studioSaveFolderQuiet(() => vfsClient.renameFolder(item.targetId, name));
                else await studioSaveFolderQuiet(() => vfsClient.renameFile(item.targetId, name));
            } catch (err) {
                await studioSaveFolderMessage(`Cannot rename ${item.name}: ${(err && err.message) || 'the name was not accepted.'}`, 'error');
            }
            await studioSaveFolderNavigate(state.path, { history: false, keepSearch: true });
            const index = (state.shown || []).findIndex((row) => row.name === name);
            if (index >= 0) state.grid.selectIndex(index);
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); void finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); void finish(false); }
        });
        input.addEventListener('blur', () => void finish(true));
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('dblclick', (e) => e.stopPropagation());
    }

    function studioSaveFolderDelete(permanent) {
        const state = studioSaveFolderState;
        const sel = state.grid ? state.grid.getSelectedItems() : [];
        if (!sel.length || sel.some((item) => item.fdIcon || item.system || item.protected)) return;
        const proxy = studioSaveFolderExplorerProxy();
        if (proxy && typeof proxy.deleteSelection === 'function') void proxy.deleteSelection({ fromKeyboard: true, permanent: !!permanent });
    }

    // ---- the list's right-click menu ----

    function studioSaveFolderContextSections(item) {
        const state = studioSaveFolderState;
        const views = STUDIO_SAVE_FOLDER_VIEWS.map(([mode, text]) => ({ text, action: `fd-view:${mode}`, indicatorStyle: 'dot', checked: mode === state.viewMode }));
        if (!item) {
            const sortBy = studioSaveFolderSortByItem();
            return [{
                type: 'list',
                items: [
                    { text: 'View', submenu: views },
                    ...(sortBy ? [sortBy] : []),
                    { text: 'Refresh', action: 'fd-refresh' },
                    { separator: true },
                    { text: 'New', submenu: [{ text: 'Folder', action: 'fd-new-folder' }], disabled: !studioSaveFolderIsVfs() }
                ]
            }];
        }
        const folder = studioSaveFolderIsFolder(item);
        const fixed = !!(item.fdIcon || item.system || item.protected);
        const openText = folder || state.mode !== 'save' ? (folder || state.mode === 'folder' ? 'Open' : 'Select') : 'Select';
        return [{
            type: 'list',
            items: [
                { text: openText, action: 'fd-open', className: 'context-menu-item-default' },
                { separator: true },
                { text: 'Delete', action: 'fd-delete', disabled: fixed },
                { text: 'Rename', action: 'fd-rename', disabled: fixed || (state.grid && state.grid.getSelectedItems().length !== 1) }
            ]
        }];
    }

    function studioSaveFolderContextAction(action) {
        const state = studioSaveFolderState;
        const sel = state.grid ? state.grid.getSelectedItems() : [];
        if (action.startsWith('fd-view:')) { studioSaveFolderSetView(action.slice(8)); return; }
        const next = window.vistaSortByApply && window.vistaSortByApply(action, 'fd-sort', studioSaveFolderSort());
        if (next) { studioSaveFolderApplySort(next.field, next.direction); return; }
        if (action === 'fd-refresh') studioSaveFolderNavigate(state.path, { history: false, keepSearch: true });
        else if (action === 'fd-new-folder') void studioSaveFolderNewFolder();
        else if (action === 'fd-delete') studioSaveFolderDelete(false);
        else if (action === 'fd-rename' && sel[0]) studioSaveFolderRename(sel[0]);
        else if (action === 'fd-open' && sel[0]) studioSaveFolderActivate(sel[0]);
    }

    // ---- types, titles, collapse ----

    /** The type list: what this dialog saves or opens. */
    function studioSaveFolderTypeLabel() {
        const mode = studioSaveFolderState.mode;
        const accept = studioSaveFolderAcceptType();
        const host = studioSaveFolderState.host;
        if (host && host.typeLabel) return host.typeLabel;
        if (accept === 'bracket-generation') return 'Phasewalker Files';
        if (mode === 'open-gallery') return 'Pictures';
        if (mode === 'open-vfs' || mode === 'open') return 'All Studio Files';
        return 'Studio Sessions';
    }

    function studioSaveFolderTitleText() {
        const title = document.getElementById('studioSaveFolderTitle');
        return (title && title.textContent) || 'Save As';
    }

    /** Hide Folders / Browse Folders: the compact form is the travel band, the name and type, the buttons. */
    function studioSaveFolderSetCollapsed(collapsed, options = {}) {
        const modal = studioSaveFolderModalEl();
        const btn = document.getElementById('studioSaveFolderFoldersBtn');
        if (!modal) return;
        const open = !modal.classList.contains('hidden');
        if (collapsed && !modal.classList.contains('fd-collapsed') && open) {
            studioSaveFolderState.expandedHeight = modal.getBoundingClientRect().height;
        }
        modal.classList.toggle('fd-collapsed', !!collapsed);
        if (btn) {
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            const label = btn.querySelector('.fd-expando-label');
            if (label) label.textContent = collapsed ? 'Browse Folders' : 'Hide Folders';
        }
        if (options.remember !== false) {
            try { localStorage.setItem(STUDIO_SAVE_FOLDER_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (_err) { /* session only */ }
        }
        if (!open) return;
        // Vista's compact Save As is 175 px tall; expanding restores the height it had
        const width = modal.getBoundingClientRect().width;
        const height = collapsed ? 175 : (studioSaveFolderState.expandedHeight || 435);
        // setModalSizePreservingCenter: public/scripts/comp/modalUtils.js
        if (typeof setModalSizePreservingCenter === 'function') setModalSizePreservingCenter(modal, width, height);
    }

    function studioSaveFolderSavedCollapsed() {
        try { return localStorage.getItem(STUDIO_SAVE_FOLDER_COLLAPSED_KEY) === '1'; } catch (_err) { return false; }
    }

    // ---- the last folder, per program ----

    function studioSaveFolderRememberKey() {
        const host = studioSaveFolderState.host;
        if (host && host.rememberKey) return String(host.rememberKey);
        const owner = studioSaveFolderState.ownerId || 'desktop';
        const kind = studioSaveFolderState.mode === 'save' ? 'save' : (studioSaveFolderState.mode === 'folder' ? 'folder' : 'open');
        return `${owner}|${kind}|${(host && host.title) || ''}`;
    }

    function studioSaveFolderRecall() {
        try {
            const all = JSON.parse(localStorage.getItem(STUDIO_SAVE_FOLDER_LAST_KEY) || '{}');
            const entry = all && all[studioSaveFolderRememberKey()];
            return entry && typeof entry.p === 'string' ? entry.p : null;
        } catch (_err) {
            return null;
        }
    }

    function studioSaveFolderRemember() {
        const path = studioSaveFolderState.path;
        if (!path) return;
        try {
            const all = JSON.parse(localStorage.getItem(STUDIO_SAVE_FOLDER_LAST_KEY) || '{}') || {};
            all[studioSaveFolderRememberKey()] = { p: path, t: Date.now() };
            // the 40 most recent programs
            const keys = Object.keys(all).sort((a, b) => (all[b].t || 0) - (all[a].t || 0));
            keys.slice(40).forEach((k) => delete all[k]);
            localStorage.setItem(STUDIO_SAVE_FOLDER_LAST_KEY, JSON.stringify(all));
        } catch (_err) { /* not remembered */ }
    }

    // ---- the name box ----

    /** The selection in the name box: one name, or Vista's "a" "b" for several. */
    function studioSaveFolderNameFromSelection(selected) {
        const input = document.getElementById('studioSaveFolderName');
        if (!input) return;
        const mode = studioSaveFolderState.mode;
        if (mode === 'folder') {
            const folder = selected.find((row) => studioSaveFolderIsFolder(row));
            input.value = folder ? folder.name || '' : studioSaveFolderLabelFor(studioSaveFolderState.path);
            return;
        }
        const files = selected.filter((row) => !studioSaveFolderIsFolder(row) && studioSaveFolderShows(row));
        if (!files.length) return;
        input.value = files.length === 1 ? (files[0].name || '') : files.map((row) => `"${row.name}"`).join(' ');
    }

    /** Folder mode: the box names the folder on screen. */
    function studioSaveFolderSyncFolderName() {
        if (studioSaveFolderState.mode !== 'folder') return;
        const input = document.getElementById('studioSaveFolderName');
        if (!input) return;
        input.value = studioSaveFolderLabelFor(studioSaveFolderState.path);
        if (document.activeElement === input) input.select();
    }

    /** Save As with a folder picked in the list: the button reads Open (Vista). */
    function studioSaveFolderSyncPrimary() {
        const btn = document.getElementById('studioSaveFolderSaveBtn');
        if (!btn) return;
        const mode = studioSaveFolderState.mode;
        const sel = studioSaveFolderState.selected || [];
        const folderPicked = sel.length === 1 && studioSaveFolderIsFolder(sel[0]);
        // the list was used last (not the name box): the button stays Open while the pointer goes to it
        const listFocused = !!studioSaveFolderState.listActive;
        let html;
        if (mode === 'folder') html = 'Select Folder';
        else if (mode === 'save') html = folderPicked && listFocused ? '<u>O</u>pen' : '<u>S</u>ave';
        // Open is a split button: its ▾ offers Open and Open as read-only (Vista's common dialog)
        else html = '<u>O</u>pen<span class="fd-split" data-fd-split aria-hidden="true"></span>';
        if (btn.innerHTML !== html) btn.innerHTML = html;
        btn.classList.toggle('fd-has-split', studioSaveFolderIsOpenMode());
    }

    /** Autocomplete: the names in this folder that start with what is typed (Vista's suggestion list). */
    function studioSaveFolderSuggest() {
        const input = document.getElementById('studioSaveFolderName');
        const list = document.getElementById('studioSaveFolderSuggest');
        if (!input || !list) return;
        const typed = input.value;
        const q = typed.toLowerCase();
        const names = [];
        if (q && !/[*?"/]/.test(q)) {
            for (const item of studioSaveFolderState.items) {
                const name = String(item.name || '');
                if (name.toLowerCase().startsWith(q) && name.toLowerCase() !== q && (studioSaveFolderIsFolder(item) || studioSaveFolderShows(item)) && !names.includes(name)) names.push(name);
                if (names.length >= 12) break;
            }
        }
        studioSaveFolderState.suggestIndex = -1;
        if (!names.length) {
            list.hidden = true;
            list.innerHTML = '';
            return;
        }
        const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        list.innerHTML = names.map((name, i) => `<div class="fd-suggest-row" role="option" data-i="${i}">${esc(name)}</div>`).join('');
        list.hidden = false;
    }

    function studioSaveFolderSuggestOpen() {
        const list = document.getElementById('studioSaveFolderSuggest');
        return !!list && !list.hidden;
    }

    function studioSaveFolderSuggestClose() {
        const list = document.getElementById('studioSaveFolderSuggest');
        if (list) list.hidden = true;
    }

    function studioSaveFolderSuggestMove(step) {
        const list = document.getElementById('studioSaveFolderSuggest');
        const input = document.getElementById('studioSaveFolderName');
        if (!list || !input) return;
        const rows = [...list.querySelectorAll('.fd-suggest-row')];
        if (!rows.length) return;
        let i = studioSaveFolderState.suggestIndex + step;
        if (i < 0) i = rows.length - 1;
        if (i >= rows.length) i = 0;
        studioSaveFolderState.suggestIndex = i;
        rows.forEach((row, n) => row.classList.toggle('is-selected', n === i));
        input.value = rows[i].textContent;
    }

    // ---- the list's keys ----

    function studioSaveFolderListKey(e) {
        const state = studioSaveFolderState;
        const grid = state.grid;
        if (!grid || e.target.closest('.fd-rename-box')) return;
        const items = state.shown || [];
        const at = grid.currentIndex();
        const icons = !['details', 'list'].includes(state.viewMode);
        const cols = icons ? grid.columnCount() : 1;
        const step = (n) => {
            e.preventDefault();
            grid.selectIndex(at < 0 ? 0 : at + n, { extend: e.shiftKey });
        };
        switch (e.key) {
            case 'ArrowDown': step(cols); return;
            case 'ArrowUp': step(-cols); return;
            case 'ArrowRight': if (icons) step(1); return;
            case 'ArrowLeft': if (icons) step(-1); return;
            case 'PageDown': step(grid.pageRows() * cols); return;
            case 'PageUp': step(-grid.pageRows() * cols); return;
            case 'Home': e.preventDefault(); grid.selectIndex(0, { extend: e.shiftKey }); return;
            case 'End': e.preventDefault(); grid.selectIndex(items.length - 1, { extend: e.shiftKey }); return;
            case 'Enter': {
                e.preventDefault();
                const sel = grid.getSelectedItems();
                if (sel.length === 1 && studioSaveFolderIsFolder(sel[0])) studioSaveFolderNavigate(studioSaveFolderNavPath(sel[0], state.path));
                else studioSaveFolderPrimary();
                return;
            }
            case 'F2': {
                e.preventDefault();
                const sel = grid.getSelectedItems();
                if (sel.length === 1) studioSaveFolderRename(sel[0]);
                return;
            }
            case 'Delete': e.preventDefault(); studioSaveFolderDelete(e.shiftKey); return;
            default: break;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            grid.selectAll();
            return;
        }
        // type-ahead: the next item whose name starts with what was typed in the last second
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
            const now = Date.now();
            state.typeAhead = now - (state.typeAheadAt || 0) < 1000 ? state.typeAhead + e.key.toLowerCase() : e.key.toLowerCase();
            state.typeAheadAt = now;
            const q = state.typeAhead;
            const single = q.length === 1;
            const from = single ? at + 1 : Math.max(0, at);
            for (let n = 0; n < items.length; n++) {
                const i = (from + n) % items.length;
                if (String(items[i].name || '').toLowerCase().startsWith(q)) {
                    grid.selectIndex(i);
                    break;
                }
            }
            e.preventDefault();
        }
    }

    // ---- wiring ----

    function wireStudioSaveFolderDialog() {
        if (studioSaveFolderState.wired) return;
        const modal = studioSaveFolderModalEl();
        const host = document.getElementById('studioSaveFolderGrid');
        if (!modal || !host) return;
        studioSaveFolderState.wired = true;
        studioSaveFolderState.labels = new Map();

        const vista = () => studioSaveFolderVista();
        studioSaveFolderState.grid = new VfsVirtualGrid(host, {
            viewMode: studioSaveFolderState.viewMode,
            multiSelect: false,
            populateIconBox: (box, item) => studioSaveFolderPopulateIcon(box, item),
            formatTypeLabel: (item) => (vista() ? vista().typeLabel(item) : (item && item.fdTypeLabel) || null),
            formatDate: (ts) => (vista() ? vista().formatDate(ts) : null),
            modeOverrides: (viewMode) => (vista() ? vista().modeMetrics(viewMode) : null),
            onNearEnd: () => { void studioSaveFolderLoadMore(); },
            onItemOpen: (item) => studioSaveFolderActivate(item),
            onSelectionChange: (selected) => {
                studioSaveFolderState.selected = selected || [];
                studioSaveFolderNameFromSelection(studioSaveFolderState.selected);
                studioSaveFolderSyncPrimary();
            },
            onItemContextMenu: (item, e) => {
                if (!contextMenu) return;
                studioSaveFolderState.menuItem = item;
                contextMenu.showMenu(e, host);
            }
        });
        if (contextMenu) {
            // a right-click on the empty list: the folder's menu (an item's sets menuItem first)
            contextMenu.attachToElement(host, {
                sections: [{
                    type: 'list',
                    initfn: function (section) {
                        const item = studioSaveFolderState.menuItem;
                        section.items = studioSaveFolderContextSections(item)[0].items;
                        studioSaveFolderState.menuItem = null;
                    }
                }],
                onAction: (action) => studioSaveFolderContextAction(action)
            });
        }
        host.addEventListener('keydown', (e) => studioSaveFolderListKey(e));
        host.addEventListener('focusin', () => {
            studioSaveFolderState.listActive = true;
            studioSaveFolderSyncPrimary();
        });
        // a click on the list gives it the keys (the items are not focusable themselves)
        host.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.fd-rename-box')) setTimeout(() => host.focus({ preventScroll: true }), 0);
        });

        const $ = (id) => document.getElementById(id);
        const nameInput = $('studioSaveFolderName');
        const address = $('studioSaveFolderPath');
        const addressGroup = modal.querySelector('.fd-address-group');
        const crumbs = $('studioSaveFolderCrumbs');

        $('studioSaveFolderBackBtn')?.addEventListener('click', () => studioSaveFolderGo(-1));
        $('studioSaveFolderForwardBtn')?.addEventListener('click', () => studioSaveFolderGo(1));
        $('studioSaveFolderRefreshBtn')?.addEventListener('click', () => studioSaveFolderNavigate(studioSaveFolderState.path, { history: false, keepSearch: true }));
        const recent = $('studioSaveFolderRecentBtn');
        if (recent && contextMenu) {
            const attach = () => contextMenu.attachClickMenuToElement(recent, {
                sections: [{ type: 'list', items: studioSaveFolderRecentItems() }],
                onAction: (action) => { if (action.startsWith('h:')) studioSaveFolderGoTo(Number(action.slice(2))); }
            });
            recent.addEventListener('pointerdown', attach, true);
            recent.addEventListener('focus', attach);
        }

        // the crumbs navigate, their ▸ list the folders there; the box's ▾ lists the places visited; a
        // click on the empty part of the box types a path
        const typePath = () => {
            if (!address || !addressGroup) return;
            address.value = studioSaveFolderAtComputer() ? 'Computer' : studioSaveFolderState.path;
            addressGroup.classList.add('is-typing');
            address.classList.remove('hidden');
            address.focus();
            address.select();
        };
        const leaveAddress = () => {
            if (addressGroup) addressGroup.classList.remove('is-typing');
            if (address) address.classList.add('hidden');
        };
        if (crumbs) {
            crumbs.addEventListener('click', (e) => {
                const sep = e.target.closest('[data-crumb-menu]');
                if (sep) {
                    e.stopPropagation();
                    // the first click lists the folders and opens the menu; later clicks are the menu's own
                    if (!sep.dataset.clickMenu) void studioSaveFolderCrumbMenu(sep, sep.dataset.crumbMenu);
                    return;
                }
                if (e.target.closest('[data-fd-address-drop]')) return;
                const crumb = e.target.closest('[data-crumb-path]');
                if (crumb) {
                    studioSaveFolderNavigate(crumb.dataset.crumbPath);
                    return;
                }
                typePath();
            });
        }
        if (crumbs && typeof ResizeObserver === 'function') {
            // the trail folds again when the window (and so the box) changes width
            let lastWidth = 0;
            new ResizeObserver(() => {
                if (crumbs.clientWidth === lastWidth) return;
                lastWidth = crumbs.clientWidth;
                studioSaveFolderFoldCrumbs();
            }).observe(crumbs);
        }
        if (crumbs && contextMenu) {
            // the ▾: the places visited, newest first (attached as the pointer goes down, so it is current)
            crumbs.addEventListener('pointerdown', (e) => {
                const drop = e.target.closest('[data-fd-address-drop]');
                if (!drop) return;
                const seen = new Set();
                const items = [];
                for (let i = studioSaveFolderState.history.length - 1; i >= 0 && items.length < 12; i--) {
                    const p = studioSaveFolderState.history[i];
                    if (seen.has(p)) continue;
                    seen.add(p);
                    items.push({ text: studioSaveFolderAtComputer(p) ? 'Computer' : studioSaveFolderLabelFor(p), action: `p:${p}` });
                }
                contextMenu.attachClickMenuToElement(drop, {
                    sections: [{ type: 'list', items }],
                    onAction: (action) => { if (action.startsWith('p:')) studioSaveFolderNavigate(action.slice(2)); }
                });
            }, true);
        }
        if (address) {
            address.addEventListener('blur', leaveAddress);
            address.addEventListener('keydown', async (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    address.blur();
                    return;
                }
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const typed = address.value.trim() || '/';
                address.blur();
                const resolved = await studioSaveFolderResolve(typed);
                if (resolved && resolved.folder) studioSaveFolderNavigate(resolved.folder);
                else await studioSaveFolderMessage(`Windows can't find '${typed}'. Check the spelling and try again.`, 'error');
            });
        }

        const search = $('studioSaveFolderSearch');
        if (search) {
            // the server searches the whole folder (the Gallery by its prompts too), as Explorer's box does
            search.addEventListener('input', () => {
                clearTimeout(studioSaveFolderState.searchTimer);
                studioSaveFolderState.searchTimer = setTimeout(() => {
                    const q = search.value.trim();
                    studioSaveFolderState.search = q.length >= 2 ? q : '';
                    studioSaveFolderNavigate(studioSaveFolderState.path, { history: false, keepSearch: true });
                }, 250);
            });
            search.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && search.value) {
                    e.preventDefault();
                    e.stopPropagation();
                    search.value = '';
                    studioSaveFolderState.search = '';
                    studioSaveFolderNavigate(studioSaveFolderState.path, { history: false });
                }
            });
        }

        $('studioSaveFolderLinks')?.addEventListener('click', (e) => {
            const link = e.target.closest('[data-path]');
            if (link) studioSaveFolderNavigate(link.dataset.path);
        });
        const more = $('studioSaveFolderLinksMore');
        if (more) {
            more.addEventListener('pointerdown', () => {
                const chrome = studioSaveFolderTreeChrome();
                if (chrome) chrome.attachFavoritesMore();
            }, true);
        }
        $('studioSaveFolderFoldersBar')?.addEventListener('click', () => studioSaveFolderToggleTree());
        const tree = $('studioSaveFolderTree');
        if (tree) {
            // Cartograph's tree: the glyph opens and closes a node, the name goes there
            tree.addEventListener('click', (ev) => {
                const chrome = studioSaveFolderState.tree;
                const li = ev.target.closest('.explorer-tree-node');
                if (!chrome || !li) return;
                ev.preventDefault();
                if (ev.target.closest('.explorer-tree-glyph')) chrome.toggleTreeNode(li);
                else if (ev.target.closest('.explorer-tree-label')) chrome.openTreeNode(li);
            });
            tree.addEventListener('dblclick', (ev) => {
                const chrome = studioSaveFolderState.tree;
                const li = ev.target.closest('.explorer-tree-node');
                if (chrome && li && ev.target.closest('.explorer-tree-label')) chrome.toggleTreeNode(li, true);
            });
        }

        $('studioSaveFolderNewFolderBtn')?.addEventListener('click', () => studioSaveFolderNewFolder());
        // Help: Grimoire, as Cartograph's (openGrimoireApplet: public/scripts/comp/featureLoader.js)
        $('studioSaveFolderHelpBtn')?.addEventListener('click', () => {
            if (typeof openGrimoireApplet === 'function') openGrimoireApplet();
        });
        $('studioSaveFolderFoldersBtn')?.addEventListener('click', () => {
            studioSaveFolderSetCollapsed(!modal.classList.contains('fd-collapsed'));
        });
        $('studioSaveFolderCancelBtn')?.addEventListener('click', () => studioSaveFolderDismiss());
        $('closeStudioSaveFolderBtn')?.addEventListener('click', () => studioSaveFolderDismiss());
        const primaryBtn = $('studioSaveFolderSaveBtn');
        if (primaryBtn) {
            primaryBtn.addEventListener('click', (e) => {
                if (e.target.closest('[data-fd-split]')) return;
                studioSaveFolderPrimary();
            });
            if (contextMenu) {
                // the split's ▾: its menu attached as the pointer goes down, so the click opens it
                primaryBtn.addEventListener('pointerdown', (e) => {
                    const split = e.target.closest('[data-fd-split]');
                    if (!split || split.dataset.clickMenu) return;
                    contextMenu.attachClickMenuToElement(split, {
                        sections: [{ type: 'list', items: [
                            { text: 'Open', action: 'fd-open', className: 'context-menu-item-default' },
                            { text: 'Open as read-only', action: 'fd-open-ro' }
                        ] }],
                        onAction: (action) => studioSaveFolderPrimary({ readOnly: action === 'fd-open-ro' })
                    });
                }, true);
            }
        }
        const typeSelect = $('studioSaveFolderType');
        if (typeSelect) {
            typeSelect.addEventListener('change', () => {
                studioSaveFolderState.typeIndex = Number(typeSelect.value) || 0;
                studioSaveFolderState.glob = null;
                studioSaveFolderShowItems();
                // Save As: the typed name takes the new type's extension (Vista)
                const type = studioSaveFolderCurrentType();
                const ext = type && (type.ext || ((studioSaveFolderLabelExts(type.label) || [])[0]));
                if (studioSaveFolderState.mode === 'save' && nameInput && ext && /\.[a-z0-9]{1,6}$/i.test(nameInput.value)) {
                    nameInput.value = nameInput.value.replace(/\.[a-z0-9]{1,6}$/i, `.${String(ext).replace(/^\./, '')}`);
                }
            });
        }
        // Alt shows the access keys; Escape is Cancel wherever the focus is; Alt+arrows travel; F5 refreshes
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Alt') modal.classList.add('fd-cues');
            if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); studioSaveFolderGo(-1); return; }
            if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); studioSaveFolderGo(1); return; }
            if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); studioSaveFolderUp(); return; }
            if (e.key === 'F5') { e.preventDefault(); studioSaveFolderNavigate(studioSaveFolderState.path, { history: false, keepSearch: true }); return; }
            if (e.key === 'F4' || (e.altKey && (e.key === 'd' || e.key === 'D'))) { e.preventDefault(); typePath(); return; }
            if (e.key === 'Backspace' && !studioSaveFolderIsTextTarget(e.target)) { e.preventDefault(); studioSaveFolderUp(); return; }
            if (e.key === 'Escape' && !e.defaultPrevented) {
                e.preventDefault();
                e.stopPropagation();
                studioSaveFolderDismiss();
            }
        });
        modal.addEventListener('keyup', (e) => {
            if (e.key === 'Alt') modal.classList.remove('fd-cues');
        });
        if (nameInput) {
            // the suggestion list under the box
            let list = $('studioSaveFolderSuggest');
            if (!list) {
                list = document.createElement('div');
                list.id = 'studioSaveFolderSuggest';
                list.className = 'fd-suggest';
                list.setAttribute('role', 'listbox');
                list.hidden = true;
                nameInput.parentNode.appendChild(list);
                list.addEventListener('mousedown', (e) => {
                    const row = e.target.closest('.fd-suggest-row');
                    e.preventDefault();
                    if (!row) return;
                    nameInput.value = row.textContent;
                    studioSaveFolderSuggestClose();
                });
            }
            nameInput.addEventListener('input', () => studioSaveFolderSuggest());
            nameInput.addEventListener('focus', () => {
                studioSaveFolderState.listActive = false;
                studioSaveFolderSyncPrimary();
            });
            nameInput.addEventListener('blur', () => studioSaveFolderSuggestClose());
            nameInput.addEventListener('keydown', (e) => {
                if (studioSaveFolderSuggestOpen() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                    e.preventDefault();
                    studioSaveFolderSuggestMove(e.key === 'ArrowDown' ? 1 : -1);
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    studioSaveFolderSuggestClose();
                    studioSaveFolderPrimary({ fromName: true });
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (studioSaveFolderSuggestOpen()) studioSaveFolderSuggestClose();
                    else studioSaveFolderDismiss();
                }
            });
        }

        if (contextMenu) {
            // Organize: Vista's file dialog: New Folder, Sort By, Delete, Rename, Close
            const organize = $('studioSaveFolderOrganizeBtn');
            if (organize) {
                contextMenu.attachClickMenuToElement(organize, {
                    sections: [{
                        type: 'list',
                        initfn: function (section) {
                            const sortBy = studioSaveFolderSortByItem();
                            const sel = studioSaveFolderState.grid ? studioSaveFolderState.grid.getSelectedItems() : [];
                            const fixed = !sel.length || sel.some((item) => item.fdIcon || item.system || item.protected);
                            section.items = [
                                { text: 'New Folder', action: 'fd-new-folder', disabled: !studioSaveFolderIsVfs() },
                                { separator: true },
                                ...(sortBy ? [sortBy, { separator: true }] : []),
                                { text: 'Select All', action: 'fd-select-all', disabled: !studioSaveFolderState.grid || !studioSaveFolderState.grid.multiSelect },
                                { separator: true },
                                { text: 'Delete', action: 'fd-delete', disabled: fixed },
                                { text: 'Rename', action: 'fd-rename', disabled: fixed || sel.length !== 1 },
                                { separator: true },
                                { text: 'Close', action: 'fd-close' }
                            ];
                        }
                    }],
                    onAction: (action) => {
                        if (action === 'fd-close') studioSaveFolderDismiss();
                        else if (action === 'fd-select-all') studioSaveFolderState.grid.selectAll();
                        else studioSaveFolderContextAction(action);
                    }
                });
            }
            // the column headers: a click sorts by that column, again turns the order round
            modal.querySelectorAll('.explorer-details-header [data-sort-field]').forEach((col) => {
                col.addEventListener('click', () => {
                    const sort = studioSaveFolderSort();
                    const field = col.dataset.sortField;
                    studioSaveFolderApplySort(field, sort.field === field && sort.direction === 'asc' ? 'desc' : 'asc');
                });
            });
            studioSaveFolderSyncSortHeader();
            // Views: Explorer's split button (the face cycles, the ▾ drops the slider menu; vfsVirtualGrid.js)
            const views = $('studioSaveFolderViewsBtn');
            if (views && window.vistaViewsMenu) {
                window.vistaViewsMenu.attach(views, { get: () => studioSaveFolderState.viewMode, set: (mode) => studioSaveFolderSetView(mode) });
            }
            // File name ▾: the suggested name and the files of this type in the folder
            const drop = $('studioSaveFolderNameDrop');
            if (drop) {
                contextMenu.attachClickMenuToElement(drop, {
                    sections: [{
                        type: 'list',
                        initfn: function (section) {
                            const names = [];
                            const host = studioSaveFolderState.host;
                            if (studioSaveFolderState.mode === 'save') {
                                names.push(host && typeof host.suggestName === 'function'
                                    ? host.suggestName()
                                    : studioSaveSuggestName(studioSaveFolderState.items.map((item) => item.name)));
                            }
                            (studioSaveFolderState.shown || []).forEach((item) => {
                                const fits = studioSaveFolderState.mode === 'folder' ? studioSaveFolderIsFolder(item) : !studioSaveFolderIsFolder(item);
                                if (fits && item.name && !names.includes(item.name)) names.push(item.name);
                            });
                            section.items = names.filter(Boolean).slice(0, 12).map((text) => ({ text, action: 'fd-name', fdName: text }));
                            if (!section.items.length) section.items = [{ text: '(None)', action: 'none', disabled: true }];
                        }
                    }],
                    onAction: (action, _target, item) => {
                        if (action !== 'fd-name' || !item || !nameInput) return;
                        nameInput.value = item.fdName;
                        nameInput.focus();
                        nameInput.select();
                    }
                });
            }
        }
    }

    function studioSaveFolderIsTextTarget(el) {
        return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    }

    function studioSaveFolderApplyChrome(mode) {
        studioSaveFolderState.mode = mode || 'save';
        const modal = studioSaveFolderModalEl();
        const title = document.getElementById('studioSaveFolderTitle');
        const nameLabel = document.querySelector('#studioSaveFolderModal .fd-name-label');
        const typeLabel = document.querySelector('#studioSaveFolderModal .fd-type-label');
        const m = studioSaveFolderState.mode;
        const openMode = studioSaveFolderIsOpenMode();
        const hostTitle = studioSaveFolderState.host && studioSaveFolderState.host.title;
        if (modal) modal.dataset.fileDialogMode = openMode ? 'open' : (m === 'folder' ? 'folder' : 'save');
        if (title) title.textContent = hostTitle || (openMode ? 'Open' : (m === 'folder' ? 'Select Folder' : 'Save As'));
        if (nameLabel) nameLabel.innerHTML = m === 'folder' ? 'F<u>o</u>lder:' : 'File <u>n</u>ame:';
        if (typeLabel) typeLabel.innerHTML = 'Save as <u>t</u>ype:';
        const given = studioSaveFolderState.host && Number(studioSaveFolderState.host.defaultType);
        studioSaveFolderState.typeIndex = Number.isInteger(given) && given > 0 && given < studioSaveFolderTypes().length ? given : 0;
        studioSaveFolderState.glob = null;
        studioSaveFolderSyncTypes();
        studioSaveFolderSyncPrimary();
        // the caption's own icon (Yukimi, Oct 23 2026): Open a folder, Save As a disk (shell32.dll 4 and
        // 6 from the Vista VM, 16 px with its 32 px twin), the same whichever program asked
        const icon = document.querySelector('#studioSaveFolderModal .modal-window-title-main img.icon-image');
        const art = `/static_images/vista-file-dialog/${openMode || m === 'folder' ? 'open' : 'save'}`;
        if (icon) {
            icon.src = `${art}-16.png`;
            icon.setAttribute('srcset', `${art}-16.png 1x, ${art}-32.png 2x`);
        }
        // its own icon, not an owner's: the taskbar button reads the caption's (modalUtils.js getModalIcons)
        if (modal) delete modal.dataset.iconOwnerId;
        // several files only for a program that takes several (Alchemy's multiple file chooser)
        const host = studioSaveFolderState.host;
        if (studioSaveFolderState.grid) studioSaveFolderState.grid.setMultiSelect(openMode && !!(host && typeof host.onOpenMany === 'function'));
    }

    /** The host hears Cancel once (host.onCancel), however the dialog went away. */
    function studioSaveFolderSettle(host) {
        // the phone folder on screen stops being watched with the dialog
        if (window.explorerPhoneDrive && studioSaveFolderState.phoneApp) window.explorerPhoneDrive.leave(studioSaveFolderState.phoneApp);
        if (host && !host._settled) {
            host._settled = true;
            if (typeof host.onCancel === 'function') host.onCancel();
        }
    }

    /**
     * Cancel / Close / Escape: the host hears it once (host.onCancel), e.g. Alchemy's file chooser
     * answering the page with no files (grimoireRemoteBrowser.js, #628).
     */
    function studioSaveFolderDismiss() {
        const modal = studioSaveFolderModalEl();
        const host = studioSaveFolderState.host;
        studioSaveFolderSuggestClose();
        if (modal) closeModal(modal);
        studioSaveFolderSettle(host);
    }

    /** Closed some other way (the taskbar, Close all windows): still Cancel for the program. */
    function studioSaveFolderOnLifecycle(e) {
        const d = e && e.detail;
        if (!d || d.id !== 'studioSaveFolderModal' || d.type !== 'closed') return;
        document.removeEventListener('staticforge:modal-lifecycle', studioSaveFolderOnLifecycle);
        studioSaveFolderSuggestClose();
        studioSaveFolderSettle(studioSaveFolderState.host);
    }

    /** A host's own button beside Open (Receive from Device, fileOpenPicker.js): host.extraButton { label, onClick, disabled }. */
    function studioSaveFolderSyncExtraButton() {
        const saveBtn = document.getElementById('studioSaveFolderSaveBtn');
        if (!saveBtn) return;
        let extra = document.getElementById('studioSaveFolderExtraBtn');
        const spec = studioSaveFolderState.host && studioSaveFolderState.host.extraButton;
        if (!spec) {
            if (extra) extra.hidden = true;
            return;
        }
        if (!extra) {
            extra = document.createElement('button');
            extra.type = 'button';
            extra.id = 'studioSaveFolderExtraBtn';
            extra.className = 'btn-standard fd-button fd-extra';
            saveBtn.parentNode.insertBefore(extra, saveBtn);
            extra.addEventListener('click', () => {
                const host = studioSaveFolderState.host;
                const s = host && host.extraButton;
                if (s && typeof s.onClick === 'function') s.onClick();
            });
        }
        extra.innerHTML = spec.label;
        // shown but greyed where the program has nothing to offer (Receive from Device on DreamOS)
        extra.disabled = !!spec.disabled;
        extra.hidden = false;
    }

    async function openStudioSaveFolderDialog() {
        await studioOpenFolderDialog('save');
    }

    /** The window that opened the dialog: options.owner (an element or its id), else the active window. */
    function studioSaveFolderFindOwner(options) {
        const given = options && options.owner;
        const el = typeof given === 'string' ? document.getElementById(given) : given;
        const pick = (m) => (m && m.id && m.id !== 'studioSaveFolderModal' && m.querySelector('.modal-window-title-main img.icon-image') ? m : null);
        return pick(el) || pick(document.querySelector('.modal.active-window:not(.hidden)')) || null;
    }

    async function studioOpenFolderDialog(mode, options = {}) {
        // the caption takes the icon of the window that asked (Paint, Notepad, Alchemy ...), found before
        // the dialog itself becomes the active window
        const owner = studioSaveFolderFindOwner(options);
        // featureLoader.loadFeature: public/scripts/comp/featureLoader.js
        try { await featureLoader.loadFeature('explorer'); } catch (_err) { /* icon fallback */ }
        wireStudioSaveFolderDialog();
        const modal = studioSaveFolderModalEl();
        const nameInput = document.getElementById('studioSaveFolderName');
        if (!modal) return;
        // a dialog still up for another program: that one is cancelled (it hears onCancel once)
        const previous = studioSaveFolderState.host;
        if (!modal.classList.contains('hidden')) studioSaveFolderSettle(previous);
        studioSaveFolderState.ownerId = owner ? owner.id : null;
        // a program window kept on top (Presentation Settings, a Control Panel dialog): its file dialog over it
        modal.classList.toggle('on-top', !!(owner && owner.classList.contains('on-top')));
        studioSaveFolderState.host = options.host || null;
        if (studioSaveFolderState.host) studioSaveFolderState.host._settled = false;
        studioSaveFolderState.history = [];
        studioSaveFolderState.historyIndex = -1;
        studioSaveFolderState.items = [];
        studioSaveFolderState.selected = [];
        studioSaveFolderState.search = '';
        studioSaveFolderState.listActive = false;
        if (studioSaveFolderState.grid) studioSaveFolderState.grid.clearSelection();
        studioSaveFolderApplyChrome(mode);
        studioSaveFolderSyncExtraButton();
        if (nameInput) {
            const suggest = studioSaveFolderState.host && studioSaveFolderState.host.suggestName;
            nameInput.value = mode === 'save' ? (typeof suggest === 'function' ? suggest() : studioSessionPresetName()) : '';
        }
        modal.classList.remove('fd-cues');
        studioSaveFolderRenderLinks();
        studioSaveFolderSetView(studioSaveFolderState.viewMode || 'details');
        // only Save As folds; Open is always the Explorer view (a window closed folded opens at its full height)
        const wasCollapsed = modal.classList.contains('fd-collapsed');
        studioSaveFolderSetCollapsed(mode === 'save' && studioSaveFolderSavedCollapsed(), { remember: false });
        const workspaceId = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : '';
        let start = options.startPath || '/';
        if (!options.startPath) {
            if (mode === 'open-gallery' && workspaceId) start = `/Workspaces/${workspaceId}/Pictures`;
            else if (workspaceId) start = `/Workspaces/${workspaceId}`;
        }
        // the folder this program used last (Vista keeps it per program), unless the program names its
        // document's own folder
        const recalled = options.forceStart ? null : studioSaveFolderRecall();
        if (recalled) start = recalled;
        document.removeEventListener('staticforge:modal-lifecycle', studioSaveFolderOnLifecycle);
        openModal(modal);
        bringModalToFront(modal);
        document.addEventListener('staticforge:modal-lifecycle', studioSaveFolderOnLifecycle);
        if (modal.classList.contains('fd-collapsed')) studioSaveFolderSetCollapsed(true, { remember: false });
        else if (wasCollapsed && typeof setModalSizePreservingCenter === 'function') {
            setModalSizePreservingCenter(modal, modal.getBoundingClientRect().width, studioSaveFolderState.expandedHeight || 435);
        }
        // the Folders tree as it was last left
        let foldersOpen = false;
        try { foldersOpen = localStorage.getItem('fileDialogFoldersOpen') === '1'; } catch (_err) { /* closed */ }
        const chrome = studioSaveFolderTreeChrome();
        if (chrome && chrome.el.folders && chrome.el.folders.classList.contains('is-open') !== foldersOpen) chrome.toggleFolders();
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
        // a remembered folder that has gone since: the program's own start, without a message
        await studioSaveFolderNavigate(start, recalled ? { fallback: options.startPath || (workspaceId ? `/Workspaces/${workspaceId}` : '/') } : {});
    }

    // ---- what a typed name means ----

    /**
     * A typed name or path: { folder } for a folder to go to, { folder, name } for a file in a folder,
     * { glob } for a wildcard, or null. Relative to the folder on screen; ".." is the parent.
     */
    async function studioSaveFolderResolve(typed) {
        const text = String(typed || '').trim().replace(/\\/g, '/');
        if (!text) return null;
        if (/^computer$/i.test(text)) return { folder: studioSaveFolderComputerPath() };
        // the phone's places: phone://..., "D:\DCIM", "<phone>/Internal storage/..." (explorerPhoneDrive.js)
        const phonePath = window.explorerPhoneDrive && typeof window.explorerPhoneDrive.resolveInput === 'function' ? window.explorerPhoneDrive.resolveInput(String(typed || '').trim()) : null;
        if (phonePath) return { folder: phonePath };
        if (/[*?]/.test(text) && !text.includes('/')) {
            const src = text.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
            return { glob: new RegExp(`^${src}$`, 'i') };
        }
        const here = studioSaveFolderState.path;
        const base = studioSaveFolderAtComputer(here) ? '/' : here;
        if (text === '..') {
            const parts = base.split('/').filter(Boolean);
            parts.pop();
            return { folder: parts.length ? `/${parts.join('/')}` : '/' };
        }
        // a folder in this list by its name
        if (!text.includes('/')) {
            const folder = studioSaveFolderState.items.find((item) => studioSaveFolderIsFolder(item) && String(item.name || '').toLowerCase() === text.toLowerCase());
            if (folder) return { folder: studioSaveFolderNavPath(folder, here) };
            return { folder: null, name: text };
        }
        const abs = text.startsWith('/') ? text : `${base.replace(/\/+$/, '')}/${text}`;
        const parts = [];
        abs.split('/').forEach((p) => {
            if (!p || p === '.') return;
            if (p === '..') parts.pop();
            else parts.push(p);
        });
        // the last part is a folder in its parent, or a file there (probing the whole path as a folder would
        // raise the server's "Object Not Found" for every file name)
        if (!parts.length) return { folder: '/' };
        const name = parts.pop();
        const dir = `/${parts.join('/')}`;
        if (text.endsWith('/')) return { folder: `${dir === '/' ? '' : dir}/${name}` };
        try {
            const result = await studioSaveFolderQuiet(() => vfsClient.listDirectory(dir, { offset: 0, limit: 500, sortField: 'name', sortDirection: 'asc', search: '' }));
            const folder = ((result && result.items) || []).find((item) => studioSaveFolderNavPath(item, dir) && String(item.name || '').toLowerCase() === name.toLowerCase());
            if (folder) return { folder: studioSaveFolderNavPath(folder, dir) };
            return { folder: dir, name, move: true };
        } catch (_err) {
            return null;
        }
    }

    /** Open / Save / Select Folder, or Enter in the name box. */
    async function studioSaveFolderPrimary(options = {}) {
        const mode = studioSaveFolderState.mode;
        const sel = studioSaveFolderState.selected || [];
        // Save As with a folder picked in the list (the button reads Open): into it
        if (!options.fromName && mode === 'save' && sel.length === 1 && studioSaveFolderIsFolder(sel[0]) && studioSaveFolderState.listActive) {
            studioSaveFolderNavigate(studioSaveFolderNavPath(sel[0], studioSaveFolderState.path));
            return;
        }
        if (mode === 'save') await studioSaveFolderConfirm();
        else if (mode === 'folder') await studioSaveFolderPickFolder();
        else await studioSaveFolderOpenSelected({ readOnly: !!options.readOnly });
    }

    /** Double-click / Enter / the menu's Open on an item. */
    function studioSaveFolderActivate(item) {
        const mode = studioSaveFolderState.mode;
        const nav = studioSaveFolderNavPath(item, studioSaveFolderState.path);
        if (nav) {
            studioSaveFolderNavigate(nav);
            return;
        }
        if (mode === 'save') {
            const input = document.getElementById('studioSaveFolderName');
            if (input) input.value = item.name || '';
            void studioSaveFolderConfirm();
            return;
        }
        if (mode === 'folder') return;
        void studioOpenFolderItem(item);
    }

    async function studioSaveFolderConfirm() {
        const modal = studioSaveFolderModalEl();
        const nameInput = document.getElementById('studioSaveFolderName');
        const typed = nameInput ? nameInput.value.trim() : '';
        // nothing typed: Vista does nothing
        if (!typed) {
            if (nameInput) nameInput.focus();
            return;
        }
        const target = await studioSaveFolderResolve(typed);
        if (target && target.glob) {
            studioSaveFolderState.glob = target.glob;
            studioSaveFolderShowItems();
            return;
        }
        if (target && target.folder && !target.name) {
            await studioSaveFolderNavigate(target.folder);
            if (nameInput) nameInput.value = '';
            return;
        }
        if (target && target.move && target.folder && target.folder !== studioSaveFolderState.path) {
            await studioSaveFolderNavigate(target.folder);
        }
        let name = target && target.name ? target.name : typed;
        if (/[\\/:*?"<>|]/.test(name)) {
            await studioSaveFolderMessage(`The file name is not valid.`, 'error');
            return;
        }
        name = studioSaveFolderWithExt(name);
        if (nameInput) nameInput.value = name;
        // an existing file of this kind: Vista's "Confirm Save As" (Yes / No, No first)
        const existing = studioSaveFolderState.items.find((item) => !studioSaveFolderIsFolder(item)
            && studioSaveFolderHostAccepts(item) && String(item.name || '').toLowerCase() === name.toLowerCase());
        if (existing) {
            const answer = await showConfirmationDialog(`<p>${String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;')} already exists.<br>Do you want to replace it?</p>`, [
                { text: 'Yes', value: true, className: 'btn-standard' },
                { text: 'No', value: false, className: 'btn-standard primary' }
            ], null, { title: 'Confirm Save As', icon: 'fas fa-triangle-exclamation', width: 380 });
            if (answer !== true) {
                if (nameInput) {
                    nameInput.focus();
                    nameInput.select();
                }
                return;
            }
        }
        const overwrite = existing ? studioSaveFolderOverwrite(existing.name) : {};
        const parts = studioSaveFolderState.path.split('/').filter(Boolean);
        const workspaceId = (parts[0] === 'Workspaces' && parts[1]) ? parts[1] : activeWorkspace;
        const host = studioSaveFolderState.host;
        const type = studioSaveFolderCurrentType();
        if (host && typeof host.onSave === 'function') {
            const savedByHost = await host.onSave({
                path: studioSaveFolderState.path,
                name,
                overwrite,
                existing: existing || null,
                workspaceId,
                type,
                typeIndex: studioSaveFolderState.typeIndex || 0
            });
            if (savedByHost) {
                host._settled = true;
                studioSaveFolderRemember();
                closeModal(modal);
            }
            return;
        }
        const saved = await saveRequestAsDesktopShortcut({
            dest: 'vfs',
            path: studioSaveFolderState.path,
            name,
            workspaceId,
            overwriteId: overwrite.overwriteId || null,
            overwriteEntryId: overwrite.overwriteEntryId || null
        });
        if (saved) {
            studioSaveFolderRemember();
            closeModal(modal);
        }
    }

    /** Select Folder: the folder typed or picked, else the one on screen. */
    async function studioSaveFolderPickFolder() {
        const modal = studioSaveFolderModalEl();
        const host = studioSaveFolderState.host;
        const nameInput = document.getElementById('studioSaveFolderName');
        const typed = nameInput ? nameInput.value.trim() : '';
        let path = studioSaveFolderState.path;
        if (typed && typed !== studioSaveFolderLabelFor(path)) {
            const target = await studioSaveFolderResolve(typed);
            if (target && target.folder && !target.name) path = target.folder;
            else {
                await studioSaveFolderMessage(`${typed}\nThe folder can't be found. Check the name and try again.`, 'warning');
                return;
            }
        }
        if (studioSaveFolderAtComputer(path)) return;
        const done = host && typeof host.onSave === 'function'
            ? await host.onSave({ path, name: '', folder: true, workspaceId: (path.split('/').filter(Boolean)[0] === 'Workspaces' ? path.split('/').filter(Boolean)[1] : activeWorkspace) })
            : true;
        if (done) {
            if (host) host._settled = true;
            studioSaveFolderState.path = path;
            studioSaveFolderRemember();
            closeModal(modal);
        }
    }

    async function studioSaveFolderOpenSelected(how = {}) {
        const state = studioSaveFolderState;
        const selected = state.selected || [];
        const host = state.host;
        const nameInput = document.getElementById('studioSaveFolderName');
        const typed = nameInput ? nameInput.value.trim() : '';
        const selName = selected.length === 1 ? (selected[0].name || '') : selected.map((row) => `"${row.name}"`).join(' ');
        // a name or path typed over the selection: what it means first
        if (typed && typed !== selName) {
            const target = await studioSaveFolderResolve(typed);
            if (target && target.glob) {
                state.glob = target.glob;
                studioSaveFolderShowItems();
                return;
            }
            if (target && target.folder && !target.name) {
                await studioSaveFolderNavigate(target.folder);
                if (nameInput) nameInput.value = '';
                return;
            }
            if (target && target.move && target.folder) await studioSaveFolderNavigate(target.folder);
            const want = String((target && target.name) || typed).toLowerCase();
            const item = state.items.find((row) => !studioSaveFolderIsFolder(row) && String(row.name || '').toLowerCase() === want);
            if (!item) {
                // comdlg32: "<name>\nFile not found.\nCheck the file name and try again."
                await studioSaveFolderMessage(`${(target && target.name) || typed}\nFile not found.\nCheck the file name and try again.`, 'warning');
                if (nameInput) { nameInput.focus(); nameInput.select(); }
                return;
            }
            await studioOpenFolderItem(item, how);
            return;
        }
        // a host that takes several files at once (host.onOpenMany: Alchemy's multiple file chooser)
        if (host && typeof host.onOpenMany === 'function' && typeof host.acceptItem === 'function') {
            const files = selected.filter((row) => host.acceptItem(row) && !studioSaveFolderIsFolder(row));
            if (files.length > 1) {
                const modal = studioSaveFolderModalEl();
                host._settled = true;
                studioSaveFolderRemember();
                if (modal) closeModal(modal);
                void host.onOpenMany(files, state.path, how);
                return;
            }
        }
        const item = selected[0];
        // nothing picked or typed: Vista does nothing
        if (!item) {
            if (nameInput) nameInput.focus();
            return;
        }
        await studioOpenFolderItem(item, how);
    }

    async function studioOpenSessionFromImage(filename, workspaceId) {
        if (!filename) return;
        const modal = studioSaveFolderModalEl();
        if (modal) closeModal(modal);
        const image = {
            filename: filename,
            original: filename,
            workspaceId: workspaceId || undefined
        };
        // openManualModalWithContent: public/scripts/comp/manualModalManager.js
        await openManualModalWithContent({ type: 'image', image: image });
    }

    async function studioOpenFolderItem(item, how = {}) {
        if (!item) return;
        const nav = studioSaveFolderNavPath(item, studioSaveFolderState.path);
        if (nav) {
            studioSaveFolderNavigate(nav);
            return;
        }
        const host = studioSaveFolderState.host;
        if (host && typeof host.onOpen === 'function') {
            const accepted = typeof host.acceptItem === 'function' ? host.acceptItem(item) : item.shortcutType === studioSaveFolderAcceptType();
            if (accepted) {
                const hostModal = studioSaveFolderModalEl();
                host._settled = true;
                studioSaveFolderRemember();
                if (hostModal) closeModal(hostModal);
                // how.readOnly: Open as read-only (the program saves elsewhere, where it can)
                await host.onOpen(item, studioSaveFolderState.path, { readOnly: !!how.readOnly });
                return;
            }
            await studioSaveFolderMessage(`${item.name || ''}\n${host.rejectMessage || 'This file can\'t be opened here.'}`, 'warning');
            return;
        }
        studioSaveFolderRemember();
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
            await studioSaveFolderMessage(`${item.name || ''}\nChoose a picture.`, 'warning');
            return;
        }
        if (item.shortcutType === 'request' || item.shortcutType === 'preset') {
            const shortcut = {
                type: item.shortcutType,
                name: item.name,
                id: item.id,
                data: item.shortcutData || {}
            };
            const modal = studioSaveFolderModalEl();
            if (modal) closeModal(modal);
            // desktopShortcuts: public/scripts/comp/desktopShortcuts.js
            if (item.shortcutType === 'request') await desktopShortcuts.handleRequestClick(shortcut);
            else await desktopShortcuts.handlePresetClick(shortcut);
            return;
        }
        await studioSaveFolderMessage(`${item.name || ''}\nChoose a picture, a preset or a saved session.`, 'warning');
    }

    // the names other files call (wmFileDialogs.js wraps studioOpenFolderDialog on a phone)
    window.studioOpenFolderDialog = studioOpenFolderDialog;
    window.openStudioSaveFolderDialog = openStudioSaveFolderDialog;
    window.studioOpenSessionFromImage = studioOpenSessionFromImage;
    window.studioSaveFolderDismiss = studioSaveFolderDismiss;
})();

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
