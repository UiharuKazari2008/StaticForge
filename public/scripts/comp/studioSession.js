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

// ---- the Save As / Open dialog: Vista's common file dialog (app.html #studioSaveFolderModal,
// vista-file-dialog.css). An Explorer view: Back / Forward and the crumbs, Search (filters the
// folder), Organize / Views / New Folder, Favorite Links, the Details list; File name (its ▾ lists
// suggested names) and the type; Hide Folders folds it to the compact form (remembered). ----

const STUDIO_SAVE_FOLDER_COLLAPSED_KEY = 'studioSaveFolderCollapsed';
const STUDIO_SAVE_FOLDER_VIEWS = [
    ['icons-xl', 'Extra Large Icons'],
    ['icons-lg', 'Large Icons'],
    ['icons-md', 'Medium Icons'],
    ['icons-sm', 'Small Icons'],
    ['list', 'List'],
    ['details', 'Details']
];

/** Cartograph's Vista helpers (type names, dates, row metrics) while the Vista chrome is on;
 *  ExplorerVistaChrome's methods only need the applet, so Cartograph need not have been opened. */
function studioSaveFolderVista() {
    const Chrome = window.ExplorerVistaChrome;
    if (!Chrome) return null;
    const proto = Chrome.prototype;
    let explorer = null;
    try {
        // initializeExplorerApplet: public/scripts/comp/explorerApplet.js
        explorer = initializeExplorerApplet();
    } catch (_err) { /* type names fall back to the server's */ }
    const ctx = { app: explorer || {} };
    if (!proto.isOn.call(ctx)) return null;
    return {
        typeLabel: (item) => proto.typeLabel.call(ctx, item),
        formatDate: (ts) => proto.formatDate.call(ctx, ts),
        modeMetrics: (mode) => proto.modeMetrics.call(ctx, mode)
    };
}

function studioSaveFolderSetView(mode) {
    studioSaveFolderState.viewMode = mode;
    if (studioSaveFolderState.grid) studioSaveFolderState.grid.setViewMode(mode);
    const pane = document.querySelector('#studioSaveFolderModal .explorer-view-pane');
    if (pane) pane.dataset.view = mode === 'details' ? 'details' : (mode === 'list' ? 'list' : 'icons');
    const icon = document.querySelector('#studioSaveFolderViewsBtn .explorer-command-icon');
    if (icon) {
        // the Views button shows the current view's icon (as Cartograph's does)
        const art = mode === 'details' ? 'views-details' : 'views-icons-lg';
        icon.src = `/static_images/vista-explorer/${art}.png`;
        icon.srcset = `/static_images/vista-explorer/${art}.png 1x, /static_images/vista-explorer/${art}@2x.png 2x`;
    }
}

/** The folder's items, filtered by the Search box. */
function studioSaveFolderShowItems() {
    const search = document.getElementById('studioSaveFolderSearch');
    const q = search ? search.value.trim().toLowerCase() : '';
    const items = q
        ? studioSaveFolderState.items.filter((item) => String(item.name || '').toLowerCase().includes(q))
        : studioSaveFolderState.items;
    if (studioSaveFolderState.grid) studioSaveFolderState.grid.resetItems(items);
}

/** The crumbs: the folder icon, then one crumb per folder (the display names where known). */
function studioSaveFolderRenderCrumbs(displayPath) {
    const host = document.getElementById('studioSaveFolderCrumbs');
    if (!host) return;
    const parts = studioSaveFolderState.path.split('/').filter(Boolean);
    const labels = String(displayPath || '').split('/').filter(Boolean);
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    let html = '<i class="fas fa-folder cpl-address-icon" aria-hidden="true"></i>';
    html += '<span class="cpl-crumb-sep" aria-hidden="true">&#9656;</span>';
    html += '<button type="button" class="cpl-crumb" data-crumb-path="/">Cartograph</button>';
    parts.forEach((part, i) => {
        const label = labels.length === parts.length ? labels[i] : part;
        const path = `/${parts.slice(0, i + 1).join('/')}`;
        html += '<span class="cpl-crumb-sep" aria-hidden="true">&#9656;</span>';
        html += `<button type="button" class="cpl-crumb" data-crumb-path="${esc(path)}">${esc(label)}</button>`;
    });
    host.innerHTML = html;
}

function studioSaveFolderSyncTravel() {
    const back = document.getElementById('studioSaveFolderBackBtn');
    const forward = document.getElementById('studioSaveFolderForwardBtn');
    const h = studioSaveFolderState.history || [];
    const i = studioSaveFolderState.historyIndex == null ? -1 : studioSaveFolderState.historyIndex;
    if (back) back.disabled = i <= 0;
    if (forward) forward.disabled = i < 0 || i >= h.length - 1;
}

/** Favorite Links: Cartograph's (this workspace's folders, Workspaces, Library). */
function studioSaveFolderRenderLinks() {
    const host = document.getElementById('studioSaveFolderLinks');
    if (!host) return;
    const ws = typeof activeWorkspace !== 'undefined' && activeWorkspace ? activeWorkspace : null;
    const links = [];
    if (ws) {
        links.push(['Desktop', `/Workspaces/${ws}/Desktop`, 'fav-desktop.png']);
        links.push(['Pictures', `/Workspaces/${ws}/Pictures`, 'fav-pictures.png']);
        links.push(['References', `/Workspaces/${ws}/References`, 'fav-searches.png']);
        links.push(['Notes', `/Workspaces/${ws}/Notes`, 'fav-documents.png']);
    }
    links.push(['Workspaces', '/Workspaces', 'fav-public.png']);
    links.push(['Library', '/System/Cache', 'fav-recent.png']);
    host.innerHTML = links.map(([label, path, icon]) => `
        <li><button type="button" class="explorer-favorite-link" data-path="${path}" title="${label}">
            <img src="/static_images/vista-explorer/${icon}" alt=""><span>${label}</span></button></li>`).join('');
    studioSaveFolderSyncLinks();
}

function studioSaveFolderSyncLinks() {
    document.querySelectorAll('#studioSaveFolderLinks .explorer-favorite-link').forEach((b) => {
        b.classList.toggle('is-current', b.dataset.path === studioSaveFolderState.path);
    });
}

/** Go to a folder; history: false for Back / Forward and Refresh. */
async function studioSaveFolderNavigate(path, options = {}) {
    const token = ++studioSaveFolderState.navToken;
    const target = path || '/';
    if (options.history !== false && target !== studioSaveFolderState.history?.[studioSaveFolderState.historyIndex]) {
        const h = (studioSaveFolderState.history || []).slice(0, (studioSaveFolderState.historyIndex ?? -1) + 1);
        h.push(target);
        studioSaveFolderState.history = h;
        studioSaveFolderState.historyIndex = h.length - 1;
    }
    studioSaveFolderState.path = target;
    studioSaveFolderSyncTravel();
    studioSaveFolderSyncLinks();
    studioSaveFolderRenderCrumbs(null);
    const search = document.getElementById('studioSaveFolderSearch');
    if (search && !options.keepSearch) search.value = '';
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
        studioSaveFolderShowItems();
        try {
            const stats = await vfsClient.getPathStats(target);
            if (token !== studioSaveFolderState.navToken) return;
            const displayPath = stats && (stats.displayPath || (stats.stats && stats.stats.displayPath));
            if (displayPath) studioSaveFolderRenderCrumbs(displayPath);
        } catch (_err) { /* keep the raw crumbs */ }
    } catch (err) {
        showGlassToast('error', studioSaveFolderTitleText(), err.message || 'Failed to open folder', false, 4000, '<i class="fas fa-folder"></i>');
    }
}

function studioSaveFolderGo(step) {
    const h = studioSaveFolderState.history || [];
    const next = (studioSaveFolderState.historyIndex ?? -1) + step;
    if (next < 0 || next >= h.length) return;
    studioSaveFolderState.historyIndex = next;
    studioSaveFolderNavigate(h[next], { history: false });
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

/** New Folder: "New Folder", "New Folder (2)" ... in the current folder. */
async function studioSaveFolderNewFolder() {
    const taken = new Set(studioSaveFolderState.items.map((item) => String(item.name || '').toLowerCase()));
    let name = 'New Folder';
    for (let n = 2; taken.has(name.toLowerCase()) && n < 100; n += 1) name = `New Folder (${n})`;
    try {
        await vfsClient.createFolder(studioSaveFolderState.path, name);
        await studioSaveFolderNavigate(studioSaveFolderState.path, { history: false });
    } catch (err) {
        showGlassToast('error', studioSaveFolderTitleText(), err.message || 'Could not create the folder', false, 4000);
    }
}

/** The type list: what this dialog saves or opens. */
function studioSaveFolderTypeLabel() {
    const mode = studioSaveFolderState.mode;
    const accept = studioSaveFolderAcceptType();
    const host = studioSaveFolderState.host;
    if (host && host.typeLabel) return host.typeLabel;
    if (accept === 'bracket-generation') return 'Phasewalker Files';
    if (mode === 'open-gallery') return 'Pictures';
    if (mode === 'open-vfs') return 'All Studio Files';
    return 'Studio Sessions';
}

function studioSaveFolderTitleText() {
    const title = document.getElementById('studioSaveFolderTitle');
    return (title && title.textContent) || 'Save As';
}

/** Hide Folders / Browse Folders: the compact form is the travel band, the name and type, the buttons. */
function studioSaveFolderSetCollapsed(collapsed, options = {}) {
    const modal = document.getElementById('studioSaveFolderModal');
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

function wireStudioSaveFolderDialog() {
    if (studioSaveFolderState.wired) return;
    const modal = document.getElementById('studioSaveFolderModal');
    const host = document.getElementById('studioSaveFolderGrid');
    if (!modal || !host) return;
    studioSaveFolderState.wired = true;

    const vista = () => studioSaveFolderVista();
    studioSaveFolderState.grid = new VfsVirtualGrid(host, {
        viewMode: studioSaveFolderState.viewMode,
        populateIconBox: (box, item) => studioSaveFolderPopulateIcon(box, item),
        formatTypeLabel: (item) => (vista() ? vista().typeLabel(item) : null),
        formatDate: (ts) => (vista() ? vista().formatDate(ts) : null),
        modeOverrides: (viewMode) => (vista() ? vista().modeMetrics(viewMode) : null),
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
            const item = studioSaveFolderState.selected.find((row) => studioSaveFolderState.mode === 'save'
                ? studioSaveFolderSameType(row)
                : !studioSaveFolderNavPath(row, studioSaveFolderState.path));
            if (!item) return;
            const input = document.getElementById('studioSaveFolderName');
            if (input) input.value = item.name || '';
        }
    });

    const $ = (id) => document.getElementById(id);
    const nameInput = $('studioSaveFolderName');
    const address = $('studioSaveFolderPath');
    const addressGroup = modal.querySelector('.fd-address-group');
    const crumbs = $('studioSaveFolderCrumbs');

    $('studioSaveFolderBackBtn')?.addEventListener('click', () => studioSaveFolderGo(-1));
    $('studioSaveFolderForwardBtn')?.addEventListener('click', () => studioSaveFolderGo(1));
    $('studioSaveFolderRefreshBtn')?.addEventListener('click', () => studioSaveFolderNavigate(studioSaveFolderState.path, { history: false, keepSearch: true }));

    // the crumbs navigate; a click on the empty part of the box types a path
    const leaveAddress = () => {
        if (addressGroup) addressGroup.classList.remove('is-typing');
        if (address) address.classList.add('hidden');
    };
    if (crumbs) {
        crumbs.addEventListener('click', (e) => {
            const crumb = e.target.closest('[data-crumb-path]');
            if (crumb) {
                studioSaveFolderNavigate(crumb.dataset.crumbPath);
                return;
            }
            if (!address || !addressGroup) return;
            address.value = studioSaveFolderState.path;
            addressGroup.classList.add('is-typing');
            address.classList.remove('hidden');
            address.focus();
            address.select();
        });
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
            let resolved = typed;
            try {
                resolved = await vfsClient.resolvePath(typed);
            } catch (_err) { /* use typed */ }
            address.blur();
            studioSaveFolderNavigate(resolved || typed);
        });
    }

    const search = $('studioSaveFolderSearch');
    if (search) search.addEventListener('input', () => studioSaveFolderShowItems());

    $('studioSaveFolderLinks')?.addEventListener('click', (e) => {
        const link = e.target.closest('[data-path]');
        if (link) studioSaveFolderNavigate(link.dataset.path);
    });

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
    $('studioSaveFolderSaveBtn')?.addEventListener('click', () => {
        if (studioSaveFolderState.mode === 'save') studioSaveFolderConfirm();
        else studioSaveFolderOpenSelected();
    });
    // Alt shows the access keys
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Alt') modal.classList.add('fd-cues');
    });
    if (nameInput) {
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (studioSaveFolderState.mode === 'save') studioSaveFolderConfirm();
                else studioSaveFolderOpenSelected();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                studioSaveFolderDismiss();
            }
        });
    }

    if (contextMenu) {
        // Organize: Vista's file dialog has New Folder at the top and Close at the bottom
        const organize = $('studioSaveFolderOrganizeBtn');
        if (organize) {
            contextMenu.attachClickMenuToElement(organize, {
                sections: [{
                    type: 'list',
                    items: [
                        { text: 'New Folder', action: 'fd-new-folder' },
                        { separator: true },
                        { text: 'Close', action: 'fd-close' }
                    ]
                }],
                onAction: (action) => {
                    if (action === 'fd-new-folder') studioSaveFolderNewFolder();
                    else if (action === 'fd-close') closeModal(modal);
                }
            });
        }
        const views = $('studioSaveFolderViewsBtn');
        if (views) {
            contextMenu.attachClickMenuToElement(views, {
                sections: [{
                    type: 'list',
                    initfn: function (section) {
                        section.items = STUDIO_SAVE_FOLDER_VIEWS.map(([mode, text]) => ({
                            text,
                            action: `fd-view:${mode}`,
                            highlighted: mode === studioSaveFolderState.viewMode
                        }));
                    }
                }],
                onAction: (action) => {
                    if (action.startsWith('fd-view:')) studioSaveFolderSetView(action.slice(8));
                }
            });
        }
        // File name ▾: the suggested name and the same kind of file in this folder
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
                        studioSaveFolderState.items.forEach((item) => {
                            const fits = studioSaveFolderState.mode === 'save'
                                ? studioSaveFolderSameType(item)
                                : !studioSaveFolderNavPath(item, studioSaveFolderState.path);
                            if (fits && item.name && !names.includes(item.name)) names.push(item.name);
                        });
                        section.items = names.filter(Boolean).slice(0, 12).map((text) => ({ text, action: 'fd-name', fdName: text }));
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

function studioSaveFolderApplyChrome(mode) {
    studioSaveFolderState.mode = mode || 'save';
    const modal = document.getElementById('studioSaveFolderModal');
    const title = document.getElementById('studioSaveFolderTitle');
    const saveBtn = document.getElementById('studioSaveFolderSaveBtn');
    const nameLabel = document.querySelector('#studioSaveFolderModal .fd-name-label');
    const typeSelect = document.getElementById('studioSaveFolderType');
    const openMode = studioSaveFolderState.mode !== 'save';
    const hostTitle = studioSaveFolderState.host && studioSaveFolderState.host.title;
    if (modal) modal.dataset.fileDialogMode = openMode ? 'open' : 'save';
    if (title) title.textContent = hostTitle || (openMode ? 'Open' : 'Save As');
    if (saveBtn) saveBtn.innerHTML = openMode ? '<u>O</u>pen' : '<u>S</u>ave';
    if (nameLabel) nameLabel.innerHTML = 'File <u>n</u>ame:';
    if (typeSelect) {
        typeSelect.innerHTML = '';
        const option = document.createElement('option');
        option.textContent = studioSaveFolderTypeLabel();
        typeSelect.appendChild(option);
    }
    // the caption shows the owner's icon (Studio, or Phasewalker for its files)
    const ownerId = studioSaveFolderAcceptType() === 'bracket-generation' ? 'bracketGenerationModal' : 'manualModal';
    const ownerIcon = document.querySelector(`#${ownerId} .modal-window-title-main img.icon-image`);
    const icon = document.querySelector('#studioSaveFolderModal .modal-window-title-main img.icon-image');
    if (icon && ownerIcon) {
        icon.src = ownerIcon.getAttribute('src');
        const srcset = ownerIcon.getAttribute('srcset');
        if (srcset) icon.setAttribute('srcset', srcset);
    }
    if (modal) modal.dataset.iconOwnerId = ownerId;
}

/**
 * Cancel / Close / Escape: the host hears it once (host.onCancel), e.g. Alchemy's file chooser
 * answering the page with no files (grimoireRemoteBrowser.js, #628).
 */
function studioSaveFolderDismiss() {
    const modal = document.getElementById('studioSaveFolderModal');
    const host = studioSaveFolderState.host;
    if (modal) closeModal(modal);
    if (host && !host._settled && typeof host.onCancel === 'function') {
        host._settled = true;
        host.onCancel();
    }
}

/** A host's own button beside Open (Alchemy's "Select on Client"): host.extraButton { label, onClick }. */
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
    extra.hidden = false;
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
    studioSaveFolderState.history = [];
    studioSaveFolderState.historyIndex = -1;
    studioSaveFolderApplyChrome(mode);
    studioSaveFolderSyncExtraButton();
    if (nameInput) {
        const suggest = studioSaveFolderState.host && studioSaveFolderState.host.suggestName;
        nameInput.value = mode === 'save' ? (typeof suggest === 'function' ? suggest() : studioSessionPresetName()) : '';
    }
    modal.classList.remove('fd-cues');
    studioSaveFolderRenderLinks();
    studioSaveFolderSetView(studioSaveFolderState.viewMode || 'details');
    // only Save As folds; Open is always the Explorer view
    studioSaveFolderSetCollapsed(mode === 'save' && studioSaveFolderSavedCollapsed(), { remember: false });
    const workspaceId = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : '';
    let start = options.startPath || '/';
    if (!options.startPath) {
        if (mode === 'open-gallery' && workspaceId) start = `/Workspaces/${workspaceId}/Pictures`;
        else if (mode === 'save' && workspaceId) start = `/Workspaces/${workspaceId}`;
    }
    openModal(modal);
    bringModalToFront(modal);
    if (modal.classList.contains('fd-collapsed')) studioSaveFolderSetCollapsed(true, { remember: false });
    await studioSaveFolderNavigate(start);
    if (nameInput) {
        nameInput.focus();
        nameInput.select();
    }
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

function studioSaveFolderOpenSelected() {
    const selected = studioSaveFolderState.selected || [];
    const host = studioSaveFolderState.host;
    // a host that takes several files at once (host.onOpenMany: Alchemy's multiple file chooser)
    if (host && typeof host.onOpenMany === 'function' && typeof host.acceptItem === 'function') {
        const files = selected.filter((row) => host.acceptItem(row));
        if (files.length > 1 || (files.length === 1 && !studioSaveFolderNavPath(files[0], studioSaveFolderState.path))) {
            const modal = document.getElementById('studioSaveFolderModal');
            host._settled = true;
            if (modal) closeModal(modal);
            void host.onOpenMany(files, studioSaveFolderState.path);
            return;
        }
    }
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
        return;
    }
    const host = studioSaveFolderState.host;
    if (host && typeof host.onOpen === 'function') {
        const accepted = typeof host.acceptItem === 'function' ? host.acceptItem(item) : item.shortcutType === studioSaveFolderAcceptType();
        if (accepted) {
            const hostModal = document.getElementById('studioSaveFolderModal');
            host._settled = true;
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
