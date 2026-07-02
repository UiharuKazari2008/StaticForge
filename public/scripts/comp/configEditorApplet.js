/**
 * Runes applet — registry-style config browser (WebSocket only).
 * public/scripts/comp/modalUtils.js (openModal, closeModal)
 * public/scripts/comp/confirmationDialog.js (showConfirmationDialog)
 * public/scripts/comp/contextMenu.js (attachClickMenuToElement)
 */

const CONFIG_EDITOR_SECRET_MASK = '••••••••';

function configEditorEscapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

function configEditorPathKey(configId, path) {
    return configId + '\0' + (path || []).join('\0');
}

function configEditorPathLabel(path) {
    if (!path || !path.length) return '(root)';
    return path.join('.');
}

function configEditorFormatDisplayValue(val) {
    if (val === null) return 'null';
    if (val === undefined) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
}

function configEditorIsSecret(stub) {
    if (!stub) return false;
    if (stub.secret) return true;
    const key = stub.path?.length ? stub.path[stub.path.length - 1] : stub.key;
    return /^(apiKey|api_key|password|secret|token|sessionSecret|loginKey|loginPin|devLoginKey|readOnlyPin)$/i.test(String(key || ''));
}

const CONFIG_EDITOR_INLINE_STRING_MAX = 100;

function configEditorEnumLabel(val) {
    if (val === null) return 'null';
    if (val === undefined) return '';
    return String(val);
}

function configEditorResolveEditMode(stub, effectiveVal) {
    if (stub?.expandable) return 'modal';
    if (stub?.readOnly) return 'readonly';
    if (stub?.secret || configEditorIsSecret(stub)) return 'secret';
    if (stub?.editMode) return stub.editMode;
    if (stub?.editorType === 'prompt' || stub?.editorType === 'textarea') return 'modal';
    if (stub?.editorType === 'input') return 'inline';
    if (stub?.type === 'boolean' && !stub?.types?.length) return 'inline';
    if (stub?.enum?.length) return 'inline';
    if (stub?.type === 'number' && !stub?.types?.length) return 'inline';
    if (stub?.type === 'string' && !stub?.types?.length) {
        const val = effectiveVal !== undefined ? effectiveVal : stub.value;
        const s = val == null ? '' : String(val);
        if (s.length > CONFIG_EDITOR_INLINE_STRING_MAX || s.includes('\n')) return 'modal';
        return 'inline';
    }
    return 'modal';
}

function configEditorResolveEditorType(stub, effectiveVal, effectiveType) {
    const et = stub?.editorType;
    if (et === 'prompt' || et === 'textarea' || et === 'input') return et;
    if (effectiveType === 'array') return 'textarea';
    if (effectiveType === 'string') {
        const val = effectiveVal !== undefined ? effectiveVal : stub?.value;
        const s = val == null ? '' : String(val);
        if (s.length > CONFIG_EDITOR_INLINE_STRING_MAX || s.includes('\n')) return 'textarea';
        return 'input';
    }
    return 'input';
}

const CONFIG_EDITOR_VALUE_MODAL_SIZES = {
    multiline: {
        width: 640,
        height: 240,
        minWidth: 400,
        minHeight: 200,
        maxWidth: 640,
        maxHeight: 720
    },
    compact: {
        width: 500,
        height: 135,
        minWidth: 400,
        minHeight: 135,
        maxWidth: 900,
        maxHeight: 135
    }
};

function configEditorValueModalLayoutMode({ rawJsonMode, effectiveType, editorType } = {}) {
    if (rawJsonMode) return 'multiline';
    if (effectiveType === 'array') return 'multiline';
    if (editorType === 'prompt' || editorType === 'textarea') return 'multiline';
    return 'compact';
}

function configEditorEditModeIndicator(stub, effectiveVal) {
    const mode = configEditorResolveEditMode(stub, effectiveVal);
    if (stub?.expandable) {
        return { icon: 'fas fa-folder-open', title: 'Open node' };
    }
    if (mode === 'inline') {
        if (stub?.enum?.length) {
            return { icon: 'fas fa-list', title: 'Inline enum picker' };
        }
        if (stub?.type === 'number') {
            return { icon: 'fas fa-hashtag', title: 'Inline number edit' };
        }
        if (stub?.type === 'boolean') {
            return { icon: 'fas fa-toggle-on', title: 'Inline toggle edit' };
        }
        return { icon: 'fas fa-i-cursor', title: 'Inline text edit' };
    }
    if (mode === 'secret') {
        return { icon: 'fas fa-key', title: 'Secret value — modal edit' };
    }
    if (mode === 'readonly') {
        return { icon: 'fas fa-lock', title: 'Read-only entry' };
    }
    return { icon: 'fas fa-pen-to-square', title: 'Modal editor' };
}

function configEditorParsePathKey(pathKey) {
    const parts = pathKey.split('\0');
    const configId = parts[0];
    const path = parts.length > 1 ? parts.slice(1).filter(Boolean) : [];
    return { configId, path };
}

function configEditorPathsEqual(a, b) {
    const pa = a || [];
    const pb = b || [];
    if (pa.length !== pb.length) return false;
    return pa.every((seg, i) => String(seg) === String(pb[i]));
}

function configEditorHighlightMatch(text, query) {
    const raw = String(text ?? '');
    const q = String(query || '').trim();
    if (!q) return configEditorEscapeHtml(raw);
    const lower = raw.toLowerCase();
    const qLower = q.toLowerCase();
    const idx = lower.indexOf(qLower);
    if (idx < 0) return configEditorEscapeHtml(raw);
    const before = configEditorEscapeHtml(raw.slice(0, idx));
    const match = configEditorEscapeHtml(raw.slice(idx, idx + q.length));
    const after = configEditorEscapeHtml(raw.slice(idx + q.length));
    return `${before}<mark>${match}</mark>${after}`;
}

function configEditorSearchTypeIcon(type) {
    switch (type) {
        case 'object': return 'fas fa-folder';
        case 'array': return 'fas fa-list';
        case 'boolean': return 'fas fa-toggle-on';
        case 'number': return 'fas fa-hashtag';
        case 'string': return 'fas fa-font';
        default: return 'fas fa-circle';
    }
}

function configEditorFormatTypeDisplay(child, effectiveType) {
    const base = effectiveType || child?.type || 'auto';
    const strictLabel = (t) => {
        if (t === 'number') return 'strict int';
        if (t === 'boolean') return 'strict bool';
        if (t === 'string') return 'strict str';
        return `strict ${t}`;
    };

    if (child?.enum?.length) {
        const vals = child.enum.filter((v) => v !== null && v !== undefined);
        let underlying = 'str';
        if (vals.length && vals.every((v) => typeof v === 'number')) underlying = 'int';
        else if (vals.length && vals.every((v) => typeof v === 'boolean')) underlying = 'bool';
        return strictLabel(underlying);
    }

    if (child?.types?.length === 1) {
        return strictLabel(child.types[0]);
    }

    if (base === 'number') return 'int';
    if (base === 'boolean') return 'bool';
    return base;
}

function configEditorTypeColumnTitle(child, effectiveType) {
    if (child?.enum?.length) {
        const labels = child.enum.map((v) => (v === null ? 'null' : String(v)));
        return `Allowed values: ${labels.join(', ')}`;
    }
    if (child?.types?.length > 1) {
        return `Allowed types: ${child.types.join(', ')}`;
    }
    if (child?.types?.length === 1) {
        return `Restricted to: ${child.types[0]}`;
    }
    return '';
}

function configEditorSearchMatchReasonLabel(reason) {
    switch (reason) {
        case 'label': return 'label';
        case 'description': return 'description';
        case 'path': return 'path';
        case 'enum': return 'enum';
        case 'value': return 'value';
        default: return reason || '';
    }
}

const CONFIG_EDITOR_ADD_TYPE_LABELS = {
    object: 'Node (object)',
    string: 'String',
    number: 'Number',
    boolean: 'Boolean',
    array: 'Array'
};

function configEditorFormatChildLabel(key, value, childDisplay) {
    if (!childDisplay?.displayTemplate) return String(key);
    const fields = childDisplay.displayFields || ['name', 'display', 'id', 'text', 'select_text'];
    let nameVal = String(key);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const f of fields) {
            if (value[f] != null && String(value[f]).trim() !== '') {
                nameVal = String(value[f]);
                break;
            }
        }
    }
    let typeVal = '';
    if (value && typeof value === 'object' && !Array.isArray(value) && value.type != null) {
        const raw = String(value.type);
        typeVal = raw.charAt(0).toUpperCase() + raw.slice(1);
    }
    return childDisplay.displayTemplate
        .replace(/\{index\}/g, String(key))
        .replace(/\{name\}/g, nameVal)
        .replace(/\{type\}/g, typeVal);
}

function configEditorChildIcon(value, childDisplay) {
    if (!childDisplay?.iconField || !value || typeof value !== 'object') return null;
    return value[childDisplay.iconField] || null;
}

class ConfigEditorApplet {
    constructor() {
        this.modal = null;
        this.valueModal = null;
        this.treePanel = null;
        this.valuesPanel = null;
        this.treeEl = null;
        this.valuesEl = null;
        this.statusEl = null;
        this.configList = [];
        this.selectedConfigId = null;
        this.selectedPath = [];
        this.nodeCache = new Map();
        this.pendingEdits = new Map();
        this.expandedKeys = new Set();
        this.editTarget = null;
        this.searchInput = null;
        this.searchClearBtn = null;
        this.searchResultsEl = null;
        this.searchQuery = '';
        this.searchResults = [];
        this.searchSelectedIndex = -1;
        this.searchTimeout = null;
        this.searchDebounceMs = 350;
        this.searchToken = 0;
        this.searchActive = false;
        this.checkpointsModal = null;
        this.checkpointsListEl = null;
        this.checkpointsStatusEl = null;
        this.checkpointsScopeConfigId = null;
        this.checkpointsCache = [];
        this.treeScrollShell = null;
        this.valuesScrollShell = null;
        this.valueScrollShell = null;
        this.checkpointsScrollShell = null;
        this.loadValuesToken = 0;
        this.editorBusyDepth = 0;
        this._valueModalHeightSyncRafId = null;
        this._isSyncingValueModalHeight = false;
        this._valuePromptResizeObservedEl = null;
    }

    setEditorBusy(busy) {
        if (busy) {
            this.editorBusyDepth++;
        } else {
            this.editorBusyDepth = Math.max(0, this.editorBusyDepth - 1);
        }
        const on = this.editorBusyDepth > 0;
        if (this.treePanel) this.treePanel.classList.toggle('config-editor-panel-busy', on);
        if (this.valuesPanel) this.valuesPanel.classList.toggle('config-editor-panel-busy', on);
    }

    async runEditorAction(fn) {
        this.setEditorBusy(true);
        try {
            return await fn();
        } finally {
            this.setEditorBusy(false);
        }
    }

    valuesPanelStateRow(className, text) {
        return `<tr class="config-editor-values-state-row"><td colspan="4" class="${className}">${configEditorEscapeHtml(text)}</td></tr>`;
    }

    init() {
        this.modal = document.getElementById('configEditorModal');
        if (!this.modal) return;
        if (this._initWired) {
            return;
        }
        this._initWired = true;

        this.valueModal = document.getElementById('configEditorValueModal');
        this.valueScrollShell = this.valueModal?.querySelector('.config-editor-value-scroll-shell');
        this.treePanel = this.modal.querySelector('.config-editor-tree-panel');
        this.treeScrollShell = this.modal.querySelector('.config-editor-tree-scroll-shell');
        this.valuesPanel = this.modal.querySelector('.config-editor-values-panel');
        this.valuesScrollShell = this.modal.querySelector('.config-editor-values-scroll-shell');
        this.treeEl = document.getElementById('configEditorTree');
        this.valuesEl = document.getElementById('configEditorValuesBody');
        this.statusEl = document.getElementById('configEditorStatus');
        this.searchInput = document.getElementById('configEditorSearchInput');
        this.searchClearBtn = document.getElementById('configEditorSearchClearBtn');
        this.searchResultsEl = document.getElementById('configEditorSearchResults');

        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => this.handleSearchInput());
            this.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
        }
        if (this.searchClearBtn) {
            this.searchClearBtn.addEventListener('click', () => this.clearSearch(true));
        }

        const closeBtn = document.getElementById('closeConfigEditorBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.requestClose());
        }

        const saveBtn = document.getElementById('configEditorSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.requestSave());
        }

        this.checkpointsModal = document.getElementById('configEditorCheckpointsModal');
        this.checkpointsListEl = document.getElementById('configEditorCheckpointsList');
        this.checkpointsStatusEl = document.getElementById('configEditorCheckpointsStatus');
        this.checkpointsScrollShell = this.checkpointsModal?.querySelector('.config-editor-checkpoints-scroll-shell');

        const checkpointsCreateBtn = document.getElementById('configEditorCheckpointsCreateBtn');
        if (checkpointsCreateBtn) {
            checkpointsCreateBtn.addEventListener('click', () => this.requestCreateCheckpoint());
        }
        const closeCheckpointsBtn = document.getElementById('closeConfigEditorCheckpointsBtn');
        if (closeCheckpointsBtn) {
            closeCheckpointsBtn.addEventListener('click', () => this.closeCheckpointsModal());
        }

        const minimizeBtn = this.modal.querySelector('.minimize-btn');
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => {
                this.modal.classList.add('minimised');
                updateBackdropVisibility(); // modalUtils.js
            });
        }

        const valueCloseBtn = document.getElementById('closeConfigEditorValueBtn');
        if (valueCloseBtn) {
            valueCloseBtn.addEventListener('click', () => this.closeValueEditor());
        }
        const valueCancelBtn = document.getElementById('configEditorValueCancelBtn');
        if (valueCancelBtn) {
            valueCancelBtn.addEventListener('click', () => this.closeValueEditor());
        }
        const valueApplyBtn = document.getElementById('configEditorValueApplyBtn');
        if (valueApplyBtn) {
            valueApplyBtn.addEventListener('click', () => this.applyValueFromEditor());
        }
        const valueConvertBtn = document.getElementById('configEditorValueConvertBtn');
        if (valueConvertBtn) {
            valueConvertBtn.addEventListener('click', () => this.convertValueEditorType());
        }
        const valueBoolToggle = document.getElementById('configEditorValueBoolToggle');
        if (valueBoolToggle) {
            valueBoolToggle.addEventListener('click', () => {
                const on = valueBoolToggle.getAttribute('data-state') !== 'on';
                valueBoolToggle.setAttribute('data-state', on ? 'on' : 'off');
                valueBoolToggle.textContent = on ? 'true' : 'false';
            });
        }

        this.setupContextMenus();
        this.setupClickMenus();
        this.wireKeyboardOverlayEntries();
    }

    setupClickMenus() {
        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        if (!contextMenu) return;

        this.inlineEnumClickMenuConfig = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 360,
            beforeShow: (event, target) => this.refreshInlineEnumClickMenuItems(target),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => this.handleInlineEnumClickMenuAction(action, target, item)
        };

        this.valueModalEnumClickMenuConfig = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 360,
            beforeShow: () => this.refreshValueModalEnumClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => this.handleValueModalEnumClickMenuAction(action, target, item)
        };

        const valueEnumBtn = document.getElementById('configEditorValueEnumBtn');
        if (valueEnumBtn) {
            contextMenu.attachClickMenuToElement(valueEnumBtn, this.valueModalEnumClickMenuConfig);
        }
    }

    wireKeyboardOverlayEntries() {
        if (this._keyboardOverlayWired) return;
        this._keyboardOverlayWired = true;
        if (!this._escapeKeyHandler) {
            this._escapeKeyHandler = (e) => {
                if (e.key !== 'Escape') return;
                if (this.valueModal && !this.valueModal.classList.contains('hidden')) {
                    this.closeValueEditor();
                    return true;
                }
            };
        }
        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        registerKeyboardListener({
            id: 'configEditorModal.escape',
            handler: this._escapeKeyHandler,
            type: 'whenFocused',
            modalId: 'configEditorModal',
            priority: 80,
            critical: true,
            showInOverlay: false
        });
        if (!this._saveKeyHandler) {
            this._saveKeyHandler = (e) => {
                if (!(e.ctrlKey || e.metaKey) || (e.key !== 's' && e.key !== 'S')) return;
                if (this.valueModal && !this.valueModal.classList.contains('hidden')) return;
                if (!this.modal || this.modal.classList.contains('hidden')) return;
                e.preventDefault();
                e.stopPropagation();
                this.requestSave();
                return true;
            };
        }
        registerKeyboardListener({
            id: 'configEditorModal.save',
            handler: this._saveKeyHandler,
            type: 'whenFocused',
            modalId: 'configEditorModal',
            priority: 79,
            showInOverlay: false
        });
        registerModalOverlayEntries('configEditorModal', 'Runes', [
            { id: 'overlay.configEditor.save', label: 'Save', keys: 'Ctrl+S', icon: 'fas fa-save' },
            { id: 'overlay.configEditor.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' }
        ]);
        registerKeyboardListener({
            id: 'configEditorValueModal.keydown',
            handler: (e) => {
                const modal = this.valueModal;
                if (!modal || modal.classList.contains('hidden')) return;
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeValueEditor();
                    return true;
                }
                if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.applyValueFromEditor();
                    return true;
                }
            },
            type: 'whenFocused',
            modalId: 'configEditorValueModal',
            priority: 85,
            critical: true,
            showInOverlay: false
        });
        registerModalOverlayEntries('configEditorValueModal', 'Runes', [
            { id: 'overlay.configEditorValue.save', label: 'Save', keys: 'Ctrl+S', icon: 'fas fa-save' },
            { id: 'overlay.configEditorValue.close', label: 'Close', keys: 'Esc', icon: 'fas fa-times' }
        ]);
    }

    canShowCheckpointsMenu(path) {
        return Array.isArray(path) && path.length <= 1;
    }

    setupContextMenus() {
        if (!contextMenu) return;
        const applet = this;

        const panelCtx = () => ({
            configId: applet.selectedConfigId,
            path: applet.selectedPath.slice(),
            containerPath: applet.selectedPath.slice(),
            expandable: applet.isContainerPath(applet.selectedConfigId, applet.selectedPath)
        });

        const treePanelItems = () => [
            applet.makeAddEntryMenuItem(panelCtx, { panelMode: true }),
            { text: 'Commit all here', icon: 'fas fa-check', action: 'commit-all',
                disabled: () => !applet.selectedConfigId
                    || !applet.hasPendingUnder(applet.selectedConfigId, applet.selectedPath) },
            { text: 'Revert all here', icon: 'fas fa-undo', action: 'revert-all',
                disabled: () => !applet.selectedConfigId
                    || !applet.hasPendingUnder(applet.selectedConfigId, applet.selectedPath) },
            { separator: true },
            { text: 'Checkpoints', icon: 'fas fa-clock-rotate-left', action: 'checkpoints',
                hidden: () => !applet.selectedConfigId || !applet.canShowCheckpointsMenu(applet.selectedPath) }
        ];

        const valuesPanelItems = () => [
            applet.makeAddEntryMenuItem(panelCtx, { panelMode: true }),
            { text: 'Commit all here', icon: 'fas fa-check', action: 'commit-all',
                disabled: () => !applet.selectedConfigId
                    || !applet.hasPendingUnder(applet.selectedConfigId, applet.selectedPath) },
            { text: 'Revert all here', icon: 'fas fa-undo', action: 'revert-all',
                disabled: () => !applet.selectedConfigId
                    || !applet.hasPendingUnder(applet.selectedConfigId, applet.selectedPath) }
        ];

        const itemMenuConfig = (getCtx, { includeCheckpoints = false } = {}) => ({
            sections: [{
                type: 'list',
                items: [
                    { text: 'Open', icon: 'fas fa-folder-open', action: 'open',
                        hidden: () => !getCtx().expandable },
                    { text: 'Edit value', icon: 'fas fa-pen', action: 'edit',
                        hidden: () => getCtx().expandable },
                    { text: 'View raw JSON', icon: 'fas fa-code', action: 'raw-json',
                        loadfn: (item) => {
                            item.text = applet.isConfigEditorAdmin() ? 'Edit raw JSON' : 'View raw JSON';
                        } },
                    { text: 'Change type', icon: 'fas fa-exchange-alt', action: 'change-type',
                        hidden: () => !applet.canChangeChildType(getCtx()),
                        loadfn: (item) => applet.loadChangeTypeMenuItem(item, getCtx()) },
                    applet.makeAddEntryMenuItem(getCtx),
                    { text: 'Delete', icon: 'fas fa-trash', action: 'delete',
                        disabled: () => {
                            const ctx = getCtx();
                            return !applet.canDeletePath(ctx.configId, ctx.path, ctx.child);
                        },
                        tooltip: () => {
                            const ctx = getCtx();
                            return applet.canDeletePath(ctx.configId, ctx.path, ctx.child)
                                ? ''
                                : applet.getDeleteDeniedReason(ctx.configId, ctx.path, ctx.child);
                        } },
                    { separator: true },
                    { text: 'Commit', icon: 'fas fa-check', action: 'commit',
                        disabled: () => !applet.hasPendingUnder(getCtx().configId, getCtx().path) },
                    { text: 'Revert', icon: 'fas fa-undo', action: 'revert',
                        disabled: () => !applet.hasPendingAt(getCtx().configId, getCtx().path) },
                    ...(includeCheckpoints ? [
                        { separator: true },
                        { text: 'Checkpoints', icon: 'fas fa-clock-rotate-left', action: 'checkpoints',
                            hidden: () => !getCtx().configId || !applet.canShowCheckpointsMenu(getCtx().path) }
                    ] : [])
                ]
            }],
            onAction: (action, target, item) => applet.handleContextAction(action, getCtx(), item)
        });

        this._treeItemMenuFactory = (el) => itemMenuConfig(() => el._configEditorCtx, { includeCheckpoints: true });
        this._valueRowMenuFactory = (el) => itemMenuConfig(() => el._configEditorCtx);

        if (this.treePanel) {
            contextMenu.attachToElement(this.treePanel, {
                sections: [{ type: 'list', items: treePanelItems() }],
                onAction: (action, target, item) => applet.handleContextAction(action, panelCtx(), item)
            });
        }
        if (this.valuesPanel) {
            contextMenu.attachToElement(this.valuesPanel, {
                sections: [{ type: 'list', items: valuesPanelItems() }],
                onAction: (action, target, item) => applet.handleContextAction(action, panelCtx(), item)
            });
        }
    }

    attachRowContextMenu(el, ctx) {
        if (!contextMenu || !el) return;
        el._configEditorCtx = ctx;
        if (el.dataset.contextMenu) {
            contextMenu.detachFromElement(el);
        }
        const factory = ctx.kind === 'value' ? this._valueRowMenuFactory : this._treeItemMenuFactory;
        contextMenu.attachToElement(el, factory(el));
    }

    isContainerPath(configId, path) {
        if (!configId) return false;
        const data = this.nodeCache.get(configEditorPathKey(configId, path));
        return !!data?.node?.expandable;
    }

    getAddDeniedReason(configId, containerPath) {
        if (!configId || !this.isContainerPath(configId, containerPath)) {
            return 'Select a container to add entries';
        }
        const data = this.nodeCache.get(configEditorPathKey(configId, containerPath));
        return data?.node?.addMeta?.reason || 'Adding entries is not allowed here';
    }

    canAddAtPath(configId, containerPath) {
        if (!this.isContainerPath(configId, containerPath)) return false;
        const data = this.nodeCache.get(configEditorPathKey(configId, containerPath));
        return data?.node?.addMeta?.allowed !== false;
    }

    getAddEntryTypeInfoSync(configId, containerPath) {
        if (!configId || !containerPath) return { type: 'string', picker: false };
        const data = this.nodeCache.get(configEditorPathKey(configId, containerPath));
        if (!data) return { type: 'string', picker: false };
        return this.resolveAddValueType(data);
    }

    buildAddTypeSubmenuItems(allowedTypes) {
        return allowedTypes.map((t) => ({
            text: CONFIG_EDITOR_ADD_TYPE_LABELS[t] || t,
            icon: configEditorSearchTypeIcon(t),
            action: 'add-type',
            typeValue: t
        }));
    }

    makeAddEntryMenuItem(getCtx, { panelMode = false } = {}) {
        const applet = this;
        const item = {
            text: 'Add entry…',
            icon: 'fas fa-plus',
            tooltip: () => {
                const ctx = getCtx();
                if (!ctx?.configId) return '';
                if (applet.canAddAtPath(ctx.configId, ctx.containerPath)) return '';
                return applet.getAddDeniedReason(ctx.configId, ctx.containerPath);
            },
            loadfn: () => applet.loadAddEntryMenuItem(item, getCtx())
        };
        if (panelMode) {
            item.disabled = () => {
                const ctx = getCtx();
                return !ctx?.configId || !applet.canAddAtPath(ctx.configId, ctx.containerPath);
            };
        } else {
            item.hidden = () => {
                const ctx = getCtx();
                return !applet.canAddAtPath(ctx?.configId, ctx?.containerPath);
            };
        }
        return item;
    }

    loadAddEntryMenuItem(item, ctx) {
        const typeInfo = this.getAddEntryTypeInfoSync(ctx?.configId, ctx?.containerPath);
        if (typeInfo.picker) {
            item.submenu = this.buildAddTypeSubmenuItems(typeInfo.allowedTypes);
            delete item.action;
        } else {
            item.action = 'add';
            delete item.submenu;
            delete item.optionsfn;
        }
    }

    canDeletePath(configId, path, child) {
        if (!Array.isArray(path) || path.length === 0) return false;
        const stub = child || this.findChildAtPath(configId, path);
        if (stub?.required || stub?.readOnly) return false;
        return true;
    }

    getDeleteDeniedReason(configId, path, child) {
        const stub = child || this.findChildAtPath(configId, path);
        if (stub?.readOnly) return 'Read-only entry (JSON comment or documentation key)';
        if (stub?.required) return 'Required by schema — cannot delete';
        return 'Cannot delete this entry';
    }

    isConfigEditorAdmin() {
        // serverManagement.isAdminSession: public/scripts/comp/serverManagement.js
        return serverManagement.isAdminSession();
    }

    getConfigLabel(configId) {
        return this.configList.find((c) => c.id === configId)?.label || configId;
    }

    setValueModalTitle(configId, keyName, typeLabel, { readOnly = false } = {}) {
        const titleEl = document.getElementById('configEditorValueModalTitle');
        if (!titleEl) return;
        const verb = readOnly ? 'View' : 'Modify';
        const cfgLabel = this.getConfigLabel(configId);
        let title = `${verb} ${keyName} [${cfgLabel}]`;
        if (typeLabel) title += ` · ${typeLabel}`;
        titleEl.textContent = title;
    }

    setValueEditorApplyState(enabled) {
        const applyBtn = document.getElementById('configEditorValueApplyBtn');
        if (applyBtn) applyBtn.disabled = !enabled;
    }

    resetValueEditorFieldClasses() {
        const ta = document.getElementById('configEditorValueTextarea');
        if (ta) {
            ta.readOnly = false;
        }
        this.setValueEditorApplyState(true);
    }

    applyValueModalLayout(mode) {
        const modal = this.valueModal;
        if (!modal) return;

        const spec = CONFIG_EDITOR_VALUE_MODAL_SIZES[mode] || CONFIG_EDITOR_VALUE_MODAL_SIZES.compact;
        const isMultiline = mode === 'multiline';
        modal.classList.toggle('value-modal-multiline', isMultiline);
        modal.classList.toggle('value-modal-input-mode', !isMultiline);

        modal.dataset.windowDefaultWidth = String(spec.width);
        modal.dataset.windowDefaultHeight = String(spec.height);
        modal.dataset.windowMinWidth = String(spec.minWidth);
        modal.dataset.windowMinHeight = String(spec.minHeight);
        modal.dataset.windowMaxWidth = String(spec.maxWidth);
        modal.dataset.windowMaxHeight = String(spec.maxHeight);

        if (modal.classList.contains('hidden')) {
            modal.style.width = `${spec.width}px`;
            modal.style.height = `${spec.height}px`;
            return;
        }

        // setModalSizePreservingCenter: public/scripts/comp/modalUtils.js
        setModalSizePreservingCenter(modal, spec.width, spec.height);
    }

    getValueModalMultilineFieldHeight() {
        const promptTa = document.getElementById('configEditorValuePromptTextarea');
        if (this.isValuePromptEditorVisible() && promptTa) {
            const container = promptTa.closest('.character-prompt-textarea-container');
            if (container) {
                return container.offsetHeight + 3; // 3px for border
            }
            const inline = parseInt(promptTa.style.height, 10);
            return (Number.isFinite(inline) && inline > 0) ? inline : promptTa.offsetHeight;
        }

        const plainTa = document.getElementById('configEditorValueTextarea');
        if (plainTa && !plainTa.classList.contains('hidden')) {
            const inline = parseInt(plainTa.style.height, 10);
            if (Number.isFinite(inline) && inline > 0) return inline;
            return plainTa.scrollHeight || plainTa.offsetHeight;
        }

        const fieldWrap = document.getElementById('configEditorValueFieldWrap');
        return fieldWrap ? fieldWrap.scrollHeight : 0;
    }

    scheduleValueModalHeightSync() {
        if (this._valueModalHeightSyncRafId) return;
        // ResizeObserver delivers after sync layout; defer measure → apply to next frame.
        this._valueModalHeightSyncRafId = requestAnimationFrame(() => {
            this._valueModalHeightSyncRafId = requestAnimationFrame(() => {
                this._valueModalHeightSyncRafId = null;
                this.syncValueModalHeightToContent();
            });
        });
    }

    _pauseValuePromptResizeObserver() {
        if (this._valuePromptResizeObserver) {
            this._valuePromptResizeObserver.disconnect();
        }
    }

    _resumeValuePromptResizeObserver() {
        const el = this._valuePromptResizeObservedEl;
        if (this._valuePromptResizeObserver && el && this.isValuePromptEditorVisible()) {
            this._valuePromptResizeObserver.observe(el);
        }
    }

    syncValueModalHeightToContent() {
        const modal = this.valueModal;
        if (!modal || modal.classList.contains('hidden')) return;
        if (!modal.classList.contains('value-modal-multiline')) return;
        if (this._isSyncingValueModalHeight) return;

        const spec = CONFIG_EDITOR_VALUE_MODAL_SIZES.multiline;
        const body = modal.querySelector('.config-editor-value-modal-body');
        if (!body) return;

        const promptTa = document.getElementById('configEditorValuePromptTextarea');
        if (this.isValuePromptEditorVisible() && promptTa) {
            const container = promptTa.closest('.character-prompt-textarea-container');
            if (container) {
                // syncPromptTextareaContainerMeasurements: public/scripts/comp/utilities.js
                syncPromptTextareaContainerMeasurements(container);
            }
        }

        const fieldHeight = this.getValueModalMultilineFieldHeight();
        if (!fieldHeight) return;

        const chromeHeight = modal.offsetHeight - body.clientHeight;
        let nextHeight = chromeHeight + fieldHeight;
        nextHeight = Math.max(spec.height, spec.minHeight, Math.min(spec.maxHeight, nextHeight));

        const currentWidth = Math.round(modal.getBoundingClientRect().width) || spec.width;
        if (Math.abs(modal.offsetHeight - nextHeight) < 1) return;

        this._isSyncingValueModalHeight = true;
        this._pauseValuePromptResizeObserver();

        // setModalSizePreservingCenter: public/scripts/comp/modalUtils.js
        setModalSizePreservingCenter(modal, currentWidth, nextHeight);

        requestAnimationFrame(() => {
            this._isSyncingValueModalHeight = false;
            this._resumeValuePromptResizeObserver();
        });
    }

    layoutValueModalMultilineContent() {
        const promptTa = document.getElementById('configEditorValuePromptTextarea');
        const plainTa = document.getElementById('configEditorValueTextarea');

        if (this.isValuePromptEditorVisible() && promptTa) {
            // autoResizeTextarea: public/scripts/comp/utilities.js
            autoResizeTextarea(promptTa, 120);
        } else if (plainTa && !plainTa.classList.contains('hidden')) {
            autoResizeTextarea(plainTa, 120);
        }

        this.scheduleValueModalHeightSync();
    }

    ensureValueMultilineTextareaWired() {
        if (this._valueMultilineTextareaWired) return;
        const ta = document.getElementById('configEditorValueTextarea');
        if (!ta) return;
        // addTextareaInputSideEffect, autoResizeTextarea: public/scripts/comp/textareaUtils.js, utilities.js
        addTextareaInputSideEffect(ta, () => {
            autoResizeTextarea(ta, 120);
            this.scheduleValueModalHeightSync();
        }, 'valueModalMultilineResize');
        this._valueMultilineTextareaWired = true;
    }

    ensureValuePromptTextareaWired() {
        if (this._valuePromptTextareaWired) return;
        const ta = document.getElementById('configEditorValuePromptTextarea');
        if (!ta) return;
        // setupEditableTextarea: public/scripts/comp/textareaUtils.js
        setupEditableTextarea(ta);
        // addTextareaInputSideEffect, autoResizeTextarea: public/scripts/comp/textareaUtils.js, utilities.js
        addTextareaInputSideEffect(ta, () => {
            autoResizeTextarea(ta, 120);
            this.scheduleValueModalHeightSync();
        }, 'valueModalPromptResize');

        if (typeof ResizeObserver !== 'undefined') {
            const container = ta.closest('.character-prompt-textarea-container') || ta;
            this._valuePromptResizeObservedEl = container;
            this._valuePromptResizeObserver = new ResizeObserver(() => {
                if (!this.isValuePromptEditorVisible()) return;
                this.scheduleValueModalHeightSync();
            });
            this._valuePromptResizeObserver.observe(container);
        }

        this._valuePromptTextareaWired = true;
    }

    isValuePromptEditorVisible() {
        const wrap = document.getElementById('configEditorValuePromptWrap');
        return wrap && !wrap.classList.contains('hidden');
    }

    hasPendingAt(configId, path) {
        return !!this.getPendingEdit(configId, path);
    }

    hasPendingUnder(configId, containerPath) {
        const prefix = configEditorPathKey(configId, containerPath);
        const map = this.pendingEdits.get(configId);
        if (!map) return false;
        for (const key of map.keys()) {
            if (key === prefix || key.startsWith(prefix + '\0')) return true;
        }
        return false;
    }

    invalidateCacheFrom(configId, path) {
        const prefix = configEditorPathKey(configId, path);
        for (const key of [...this.nodeCache.keys()]) {
            if (key === prefix || key.startsWith(prefix + '\0')) {
                this.nodeCache.delete(key);
            }
        }
    }

    isPendingOnlyPath(configId, path) {
        if (!path?.length) return false;
        const pathKey = configEditorPathKey(configId, path);
        const map = this.pendingEdits.get(configId);
        if (!map) return false;
        for (const edit of map.values()) {
            if (!edit.isNew || edit.deleted || !edit.path?.length) continue;
            const newPrefix = configEditorPathKey(configId, edit.path);
            if (pathKey === newPrefix || pathKey.startsWith(newPrefix + '\0')) return true;
        }
        return false;
    }

    getEffectiveObjectAtPath(configId, path) {
        const pending = this.getPendingEdit(configId, path);
        let base = pending?.value;
        if (base === undefined || base === null || typeof base !== 'object') return base;

        const result = Array.isArray(base) ? base.slice() : { ...base };
        const prefix = configEditorPathKey(configId, path);
        const map = this.pendingEdits.get(configId);
        if (!map) return result;

        map.forEach((edit, key) => {
            if (edit.deleted) return;
            if (key === prefix || !key.startsWith(prefix + '\0')) return;
            const rest = key.slice(prefix.length + 1);
            if (rest.includes('\0')) return;
            if (edit.deleted) {
                if (Array.isArray(result)) result.splice(Number(rest), 1);
                else delete result[rest];
            } else {
                result[rest] = edit.value;
            }
        });
        return result;
    }

    buildChildStubsFromValue(configId, parentPath, rawValue, parentNodeMeta) {
        const val = this.getEffectiveObjectAtPath(configId, parentPath) ?? rawValue;
        if (!val || typeof val !== 'object') return [];

        const keys = Array.isArray(val)
            ? val.map((_, i) => String(i))
            : Object.keys(val);
        const childDisplay = parentNodeMeta?.childDisplay;
        const multiTypes = parentNodeMeta?.addMeta?.allowedTypes;
        const types = multiTypes?.length > 1 ? multiTypes.slice() : null;

        return keys.map((key) => {
            const childPath = [...parentPath, key];
            const childVal = this.getEffectiveValue(configId, childPath, val[key]);
            const expandable = childVal !== null && typeof childVal === 'object';
            return {
                key: String(key),
                path: childPath,
                type: Array.isArray(childVal) ? 'array' : expandable ? 'object' : typeof childVal,
                label: configEditorFormatChildLabel(key, childVal, childDisplay),
                icon: configEditorChildIcon(childVal, childDisplay),
                types,
                expandable,
                hasExpandableChildren: expandable,
                secret: configEditorIsSecret({ path: childPath, key }),
                value: expandable ? undefined : childVal,
                mapped: false
            };
        });
    }

    valueHasExpandableChildren(val) {
        if (!val || typeof val !== 'object') return false;
        if (Array.isArray(val)) {
            return val.some((item) => item !== null && typeof item === 'object');
        }
        return Object.values(val).some((item) => item !== null && typeof item === 'object');
    }

    async buildPseudoNode(configId, path) {
        if (!path?.length || !this.isPendingOnlyPath(configId, path)) return null;

        const parentPath = path.slice(0, -1);
        let parentData;
        if (parentPath.length && this.isPendingOnlyPath(configId, parentPath)) {
            parentData = await this.buildPseudoNode(configId, parentPath);
        } else {
            parentData = await this.fetchNode(configId, parentPath, true);
        }
        if (!parentData) return null;

        const merged = this.mergeChildrenWithPending(configId, parentData);
        const childStub = merged.find((c) => configEditorPathsEqual(c.path, path));
        const val = childStub
            ? this.getEffectiveValue(configId, path, childStub.value)
            : this.getEffectiveValue(configId, path, undefined);
        const expandable = val !== null && typeof val === 'object';
        const parentNode = parentData.node || {};
        const childRuleAddMeta = childStub?.expandable ? parentNode.addMeta : undefined;

        const node = {
            type: Array.isArray(val) ? 'array' : expandable ? 'object' : (childStub?.type || typeof val),
            expandable,
            label: childStub?.label || String(path[path.length - 1]),
            childDisplay: expandable && !Array.isArray(val) ? parentNode.childDisplay : undefined,
            addMeta: expandable ? (childRuleAddMeta || parentNode.addMeta) : undefined,
            hasExpandableChildren: expandable ? this.valueHasExpandableChildren(val) : false
        };

        const children = expandable
            ? this.buildChildStubsFromValue(configId, path, val, { ...parentNode, addMeta: node.addMeta })
            : [];

        return { configId, path: path.slice(), node, children };
    }

    getUncommittedParentCommits(configId, path) {
        if (!path?.length) return [];
        const required = [];
        for (let i = 1; i < path.length; i++) {
            const ancestorPath = path.slice(0, i);
            const edit = this.getPendingEdit(configId, ancestorPath);
            if (edit?.isNew && !edit.deleted) {
                required.push({
                    path: ancestorPath.slice(),
                    label: edit.label || configEditorPathLabel(ancestorPath)
                });
            }
        }
        return required;
    }

    collectPatchesForSubtree(configId, rootPath, includeParents = true) {
        const patches = [];
        const seen = new Set();
        const addPatch = (edit) => {
            const key = configEditorPathKey(configId, edit.path);
            if (seen.has(key)) return;
            seen.add(key);
            patches.push({
                path: edit.path.slice(),
                value: edit.deleted ? undefined : edit.value,
                deleted: !!edit.deleted
            });
        };

        if (includeParents) {
            for (const parent of this.getUncommittedParentCommits(configId, rootPath)) {
                const edit = this.getPendingEdit(configId, parent.path);
                if (edit) addPatch(edit);
            }
        }

        const prefix = configEditorPathKey(configId, rootPath);
        const map = this.pendingEdits.get(configId);
        if (!map) return patches;
        map.forEach((edit, key) => {
            if (key === prefix || key.startsWith(prefix + '\0')) {
                addPatch(edit);
            }
        });
        return patches;
    }

    clearPendingForPatches(configId, patches) {
        for (const patch of patches) {
            this.setPendingEdit(configId, patch.path, null);
        }
        const rootPaths = new Set();
        for (const patch of patches) {
            if (patch.path?.length) rootPaths.add(patch.path[0]);
        }
        for (const seg of rootPaths) {
            this.invalidateCacheFrom(configId, [seg]);
        }
    }

    async requestPartialCommit(configId, containerPath) {
        if (!configId || !this.hasPendingUnder(configId, containerPath)) return;

        const parentCommits = this.getUncommittedParentCommits(configId, containerPath);
        const patches = this.collectPatchesForSubtree(configId, containerPath, true);
        if (!patches.length) return;

        let summaryHtml = `<p>Commit <strong>${patches.length}</strong> pending change${patches.length === 1 ? '' : 's'} under <code>${configEditorEscapeHtml(configEditorPathLabel(containerPath))}</code>?</p>`;
        if (parentCommits.length) {
            const list = parentCommits.map((p) =>
                `<li><strong>${configEditorEscapeHtml(p.label)}</strong> (${configEditorEscapeHtml(configEditorPathLabel(p.path))})</li>`
            ).join('');
            summaryHtml += `<p class="config-editor-commit-parent-note">These parent entries must also be committed first:</p><ul class="config-editor-commit-parent-list">${list}</ul>`;
        }

        const rows = patches.map((edit) => {
            const pending = this.getPendingEdit(configId, edit.path)
                || { path: edit.path, deleted: edit.deleted, value: edit.value };
            const pathStr = configEditorPathLabel(pending.path);
            const action = pending.deleted ? 'delete' : 'set';
            return `<tr><td>${configEditorEscapeHtml(pathStr)}</td><td>${action}</td></tr>`;
        }).join('');
        summaryHtml += `<div class="config-editor-summary-table-wrap form-section-scroll"><table class="config-editor-summary-table"><thead><tr><th>Path</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`;

        const result = await showConfirmationDialog(summaryHtml, [
            { text: 'Commit', value: 'commit', className: 'btn-primary', icon: 'fas fa-check', primary: true },
            { text: 'Cancel', value: null, className: 'btn-secondary' }
        ], null, { title: 'Partial commit' });

        if (result !== 'commit') return;

        await this.runEditorAction(async () => {
            this.setStatus('Committing…');
            try {
                const payload = {
                    patches: { [configId]: patches },
                    createCheckpoint: { [configId]: true },
                    partialScope: { configId, path: containerPath.slice() }
                };
                const data = await window.wsClient.sendMessage('config_editor_save', payload, false);
                if (!data?.success) {
                    const errMsg = data?.errors?.map((e) => e.message || e).join('; ') || 'Commit failed';
                    this.setStatus(errMsg);
                    if (typeof showGlassToast === 'function') {
                        showGlassToast('error', 'Runes', errMsg);
                    }
                    return;
                }
                this.clearPendingForPatches(configId, patches);
                if (data.restarting) {
                    this.setStatus('Restarting server…');
                } else {
                    this.setStatus('Committed');
                    if (typeof showGlassToast === 'function') {
                        showGlassToast('success', 'Runes', 'Partial commit saved');
                    }
                    if (this.selectedConfigId === configId) {
                        await this.refreshTreePreservingExpansion();
                    }
                }
            } catch (err) {
                console.error('config_editor_save partial:', err);
                this.setStatus('Commit failed');
            }
        });
    }

    applyPendingHighlight(el, configId, path, isPendingNew) {
        if (!el) return;
        const pending = this.getPendingEdit(configId, path);
        const dirty = !!pending || !!isPendingNew || this.hasPendingUnder(configId, path);
        el.classList.toggle('dirty', dirty);
        el.classList.toggle('pending-new', !!(isPendingNew || pending?.isNew));
    }

    async refreshTreeBranch(configId, path) {
        const expandKey = configEditorPathKey(configId, path) + ':expanded';
        if (!this.expandedKeys.has(expandKey)) return;
        const row = this.findTreeRow(configId, path);
        if (row) await this.loadTreeChildren(configId, path, row);
    }

    mergeChildrenWithPending(configId, data) {
        const parentPath = data.path || [];
        let children = [...(data.children || [])];

        children = children.filter((c) => {
            const pending = this.getPendingEdit(configId, c.path);
            return !pending?.deleted;
        });

        const map = this.pendingEdits.get(configId);
        if (map) {
            const parentKey = configEditorPathKey(configId, parentPath);
            map.forEach((edit) => {
                if (edit.deleted) return;
                if (!edit.path || edit.path.length !== parentPath.length + 1) return;
                if (configEditorPathKey(configId, edit.path.slice(0, -1)) !== parentKey) return;
                const exists = children.some((c) => configEditorPathsEqual(c.path, edit.path));
                if (!exists) {
                    const key = edit.path[edit.path.length - 1];
                    const val = edit.value;
                    const expandable = val !== null && typeof val === 'object';
                    const parentDisplay = data?.node?.childDisplay;
                    const label = configEditorFormatChildLabel(key, val, parentDisplay);
                    const icon = configEditorChildIcon(val, parentDisplay);
                    const multiTypes = data?.node?.addMeta?.allowedTypes;
                    const types = multiTypes?.length > 1 ? multiTypes.slice() : null;
                    children.push({
                        key: String(key),
                        path: edit.path.slice(),
                        type: Array.isArray(val) ? 'array' : expandable ? 'object' : typeof val,
                        label,
                        icon,
                        types,
                        expandable,
                        secret: configEditorIsSecret({ path: edit.path, key }),
                        value: expandable ? undefined : val,
                        isPendingNew: !!edit.isNew
                    });
                }
            });
        }

        children = children.map((c) => {
            const pending = this.getPendingEdit(configId, c.path);
            if (!pending || pending.deleted) return c;
            if (pending.isNew) return c;
            const copy = { ...c };
            if (!copy.expandable) {
                copy.value = pending.value;
            }
            return copy;
        });

        return children;
    }

    nextArrayEntryKey(configId, parentData) {
        const parentPath = parentData.path || [];
        const keys = new Set();

        for (const c of parentData.children || []) {
            keys.add(String(c.key));
        }

        const map = this.pendingEdits.get(configId);
        if (map) {
            const parentKey = configEditorPathKey(configId, parentPath);
            map.forEach((edit) => {
                if (edit.deleted) return;
                if (!edit.path || edit.path.length !== parentPath.length + 1) return;
                if (configEditorPathKey(configId, edit.path.slice(0, -1)) !== parentKey) return;
                keys.add(String(edit.path[edit.path.length - 1]));
            });
        }

        let max = -1;
        for (const k of keys) {
            const n = parseInt(k, 10);
            if (!Number.isNaN(n) && n >= 0 && n > max) max = n;
        }
        return String(max + 1);
    }

    defaultValueForType(type) {
        if (type === 'number') return 0;
        if (type === 'boolean') return false;
        if (type === 'array') return [];
        if (type === 'object') return {};
        return '';
    }

    prepareDefaultValue(addMeta, entryKey, valueType) {
        if (valueType === 'object' && addMeta?.defaultSkeleton && typeof addMeta.defaultSkeleton === 'object') {
            const sk = JSON.parse(JSON.stringify(addMeta.defaultSkeleton));
            if (entryKey != null && entryKey !== '') {
                const k = String(entryKey);
                if ('name' in sk && (sk.name === '' || sk.name == null)) sk.name = k;
                if ('preset' in sk && (sk.preset === '' || sk.preset == null)) sk.preset = k;
                if ('display' in sk && (sk.display === '' || sk.display == null)) sk.display = k;
            }
            if ('id' in sk && (sk.id === '' || sk.id == null)) {
                sk.id = `entry_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
            }
            if ('created' in sk && (sk.created === '' || sk.created == null)) {
                sk.created = new Date().toISOString();
            }
            if ('timestamp' in sk && (sk.timestamp === '' || sk.timestamp == null)) {
                sk.timestamp = new Date().toISOString();
            }
            if ('dateAdded' in sk && (sk.dateAdded === '' || sk.dateAdded == null)) {
                sk.dateAdded = new Date().toISOString();
            }
            return sk;
        }
        return this.defaultValueForType(valueType);
    }

    resolveAddValueType(parentData) {
        const addMeta = parentData?.node?.addMeta;
        if (!addMeta) return { type: 'string', picker: false };
        const allowed = addMeta.allowedTypes || ['string'];
        if (allowed.length === 1) {
            return { type: allowed[0], picker: false, addMeta };
        }
        return { type: addMeta.defaultType || allowed[0], picker: true, allowedTypes: allowed, addMeta };
    }

    async promptAddEntry(configId, containerPath, presetValueType) {
        const parentData = await this.fetchNode(configId, containerPath, true);
        if (!this.canAddAtPath(configId, containerPath)) {
            this.setStatus(this.getAddDeniedReason(configId, containerPath));
            return;
        }
        const isArray = parentData?.node?.type === 'array';
        let key;

        if (isArray) {
            key = this.nextArrayEntryKey(configId, parentData);
        } else {
            if (typeof showInputDialog !== 'function') return;
            key = await showInputDialog(
                'Name for the new entry',
                '',
                'key name',
                [
                    { text: 'Add', value: 'ok', className: 'btn-primary', icon: 'fas fa-plus', primary: true },
                    { text: 'Cancel', value: null, className: 'btn-secondary' }
                ],
                null,
                { title: 'Add entry' }
            );
            if (!key || key === null) return;
            key = String(key).trim();
            if (!key) return;
        }

        const newPath = [...containerPath, key];
        const merged = this.mergeChildrenWithPending(configId, parentData);
        if (merged.some((c) => c.key === key)) {
            this.setStatus('Key already exists');
            return;
        }

        const typeInfo = this.resolveAddValueType(parentData);
        const valueType = presetValueType || typeInfo.type;

        const defaultVal = this.prepareDefaultValue(typeInfo.addMeta, key, valueType);
        const parentDisplay = parentData?.node?.childDisplay;
        const label = configEditorFormatChildLabel(key, defaultVal, parentDisplay);
        this.setPendingEdit(configId, newPath, {
            path: newPath.slice(),
            value: defaultVal,
            deleted: false,
            isNew: true,
            previousValue: undefined,
            restartRequired: false,
            secret: configEditorIsSecret({ path: newPath, key }),
            label
        });
        this.invalidateCacheFrom(configId, containerPath);
        await this.selectNode(configId, containerPath);
        await this.refreshTreeBranch(configId, containerPath);
        this.highlightValueRow(configId, newPath);
    }

    revertPending(configId, path) {
        this.setPendingEdit(configId, path, null);
        const parentPath = path.slice(0, -1);
        this.invalidateCacheFrom(configId, parentPath.length ? parentPath : path);
    }

    revertPendingUnder(configId, containerPath) {
        const prefix = configEditorPathKey(configId, containerPath);
        const map = this.pendingEdits.get(configId);
        if (!map) return;
        for (const key of [...map.keys()]) {
            if (key === prefix || key.startsWith(prefix + '\0')) {
                map.delete(key);
            }
        }
        if (map.size === 0) this.pendingEdits.delete(configId);
        this.invalidateCacheFrom(configId, containerPath);
    }

    async handleContextAction(action, ctx, item) {
        if (!ctx?.configId) return;
        const { configId } = ctx;
        const path = ctx.path ? ctx.path.slice() : [];
        const containerPath = ctx.containerPath ? ctx.containerPath.slice() : path.slice();

        switch (action) {
            case 'open':
                if (ctx.expandable) await this.navigateToPath(configId, path);
                break;
            case 'edit': {
                let child = ctx.child;
                if (!child && ctx.path?.length) {
                    child = await this.ensureChildAtPath(configId, ctx.path);
                }
                if (child) this.openValueEditor(configId, child);
                break;
            }
            case 'raw-json':
                await this.openRawJsonEditor(configId, path, ctx);
                break;
            case 'change-type': {
                const child = ctx.child || this.findChildAtPath(configId, path);
                if (child) await this.convertChildValueType(configId, child);
                break;
            }
            case 'add':
                await this.promptAddEntry(configId, containerPath);
                break;
            case 'add-type':
                await this.promptAddEntry(configId, containerPath, item?.typeValue);
                break;
            case 'delete':
                if (!this.canDeletePath(configId, path, ctx.child)) break;
                this.markDeleted(configId, path);
                break;
            case 'revert':
                await this.runEditorAction(async () => {
                    this.revertPending(configId, path);
                    if (configEditorPathsEqual(path, this.selectedPath) && this.selectedConfigId === configId) {
                        await this.loadAndRenderValues(configId, this.selectedPath);
                    }
                });
                break;
            case 'revert-all':
                await this.runEditorAction(async () => {
                    this.revertPendingUnder(configId, containerPath);
                    if (this.selectedConfigId === configId) {
                        await this.loadAndRenderValues(configId, this.selectedPath);
                    }
                });
                break;
            case 'commit':
                await this.requestPartialCommit(configId, path);
                break;
            case 'commit-all':
                await this.requestPartialCommit(configId, containerPath);
                break;
            case 'checkpoints':
                await this.openCheckpointsModal(configId);
                break;
            default:
                break;
        }
    }

    markDeleted(configId, path) {
        const parentKey = configEditorPathKey(configId, path.slice(0, -1));
        const parentData = this.nodeCache.get(parentKey);
        const stub = parentData?.children?.find((c) => configEditorPathsEqual(c.path, path));
        const pending = this.getPendingEdit(configId, path);
        if (pending?.isNew) {
            this.setPendingEdit(configId, path, null);
        } else {
            this.setPendingEdit(configId, path, {
                path: path.slice(),
                deleted: true,
                previousValue: stub?.value,
                restartRequired: !!stub?.restartRequired,
                secret: configEditorIsSecret(stub || { path }),
                label: path[path.length - 1]
            });
        }
        this.invalidateCacheFrom(configId, path.slice(0, -1));
        if (this.selectedConfigId === configId) {
            this.loadAndRenderValues(configId, this.selectedPath);
        }
    }

    reinitScrollbars() {
        if (!window.customScrollbar) return;
        if (this.treeScrollShell) window.customScrollbar.forceReinit(this.treeScrollShell);
        if (this.valuesScrollShell) window.customScrollbar.forceReinit(this.valuesScrollShell);
        if (this.valueScrollShell) window.customScrollbar.forceReinit(this.valueScrollShell);
        if (this.checkpointsScrollShell) window.customScrollbar.forceReinit(this.checkpointsScrollShell);
    }

    async open() {
        if (!this.modal) this.init();
        if (!this.modal) return;

        this.clearSession();
        openModal(this.modal);
        this.setStatus('Loading…');
        setTimeout(() => this.reinitScrollbars(), 80);

        try {
            if (!window.wsClient?.isConnected()) {
                this.setStatus('WebSocket not connected');
                return;
            }
            const data = await window.wsClient.sendMessage('config_editor_list', {}, false);
            this.configList = data?.configs || [];
            this.renderConfigRoots();
            this.setStatus('Select a configuration');
            setTimeout(() => this.reinitScrollbars(), 80);
        } catch (err) {
            console.error('Config editor list:', err);
            this.setStatus('Failed to load config list');
        }
    }

    clearSession() {
        this.closeValueEditor();
        this.clearSearch(false);
        this.selectedConfigId = null;
        this.selectedPath = [];
        this.nodeCache.clear();
        this.pendingEdits.clear();
        this.expandedKeys.clear();
        this.editTarget = null;
        if (this.treeEl) this.treeEl.innerHTML = '';
        if (this.valuesEl) this.valuesEl.innerHTML = '';
    }

    handleSearchInput() {
        clearTimeout(this.searchTimeout);
        const value = this.searchInput ? this.searchInput.value : '';
        if (this.searchClearBtn) {
            this.searchClearBtn.classList.toggle('hidden', !value.trim());
        }
        if (!value.trim()) {
            this.clearSearch(false);
            return;
        }
        this.searchTimeout = setTimeout(() => this.runSearch(value.trim()), this.searchDebounceMs);
    }

    handleSearchKeydown(e) {
        if (!this.searchActive || !this.searchResults.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.searchSelectedIndex = Math.min(this.searchSelectedIndex + 1, this.searchResults.length - 1);
            this.updateSearchSelectionHighlight();
            this.scrollSearchSelectionIntoView();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.searchSelectedIndex = Math.max(this.searchSelectedIndex - 1, 0);
            this.updateSearchSelectionHighlight();
            this.scrollSearchSelectionIntoView();
        } else if (e.key === 'Enter' && this.searchSelectedIndex >= 0) {
            e.preventDefault();
            const hit = this.searchResults[this.searchSelectedIndex];
            if (hit) void this.navigateFromSearchResult(hit);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.clearSearch(true);
        }
    }

    async runSearch(query) {
        if (!query) {
            this.clearSearch(false);
            return;
        }
        if (!window.wsClient?.isConnected()) {
            this.setStatus('WebSocket not connected');
            return;
        }

        const token = ++this.searchToken;
        this.searchQuery = query;
        this.searchActive = true;
        if (this.treeEl) this.treeEl.classList.add('search-hidden');
        if (this.searchResultsEl) {
            this.searchResultsEl.classList.remove('hidden');
            this.searchResultsEl.innerHTML = '<div class="config-editor-search-loading">Searching…</div>';
        }
        setTimeout(() => this.reinitScrollbars(), 0);

        try {
            const payload = { query, maxResults: 50 };
            if (this.selectedConfigId) payload.configId = this.selectedConfigId;
            const data = await window.wsClient.sendMessage('config_editor_search', payload, false);
            if (token !== this.searchToken) return;
            if ((this.searchInput?.value || '').trim() !== query) return;

            this.searchResults = data?.results || [];
            this.searchSelectedIndex = this.searchResults.length ? 0 : -1;
            this.renderSearchResults();
            const scope = this.selectedConfigId ? this.selectedConfigId : 'all configs';
            const suffix = data?.truncated ? ' (truncated)' : '';
            this.setStatus(`${this.searchResults.length} result${this.searchResults.length === 1 ? '' : 's'} in ${scope}${suffix}`);
        } catch (err) {
            if (token !== this.searchToken) return;
            console.error('config_editor_search:', err);
            if (this.searchResultsEl) {
                this.searchResultsEl.innerHTML = '<div class="config-editor-search-empty">Search failed</div>';
            }
            this.setStatus('Search failed');
        }
        setTimeout(() => this.reinitScrollbars(), 0);
    }

    renderSearchResults() {
        if (!this.searchResultsEl) return;
        this.searchResultsEl.innerHTML = '';
        if (!this.searchResults.length) {
            this.searchResultsEl.innerHTML = '<div class="config-editor-search-empty">No matches</div>';
            return;
        }

        const frag = document.createDocumentFragment();
        this.searchResults.forEach((hit, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'config-editor-search-item';
            if (index === this.searchSelectedIndex) btn.classList.add('keyboard-selected');

            const crumb = (hit.breadcrumb || []).join(' › ');
            const typeIcon = !this.selectedConfigId && hit.configId
                ? this.getConfigRootIcon(hit.configId)
                : configEditorSearchTypeIcon(hit.type);
            const reason = configEditorSearchMatchReasonLabel(hit.matchReason);
            const preview = hit.valuePreview && !hit.secret
                ? ` · ${hit.valuePreview}`
                : '';
            const labelHtml = configEditorHighlightMatch(hit.label || configEditorPathLabel(hit.path), this.searchQuery);
            const crumbHtml = configEditorHighlightMatch(crumb + preview, this.searchQuery);

            btn.innerHTML = `
                <div class="config-editor-search-item-main">
                    <i class="${typeIcon}" aria-hidden="true"></i>
                    <span class="config-editor-search-item-label">${labelHtml}</span>
                    <span class="config-editor-search-item-type" title="Match: ${configEditorEscapeHtml(reason)}">${configEditorEscapeHtml(hit.type || 'auto')}</span>
                </div>
                <div class="config-editor-search-item-crumb">${crumbHtml}</div>
            `;
            if (hit.description) btn.title = hit.description;
            btn.addEventListener('click', () => {
                this.searchSelectedIndex = index;
                void this.navigateFromSearchResult(hit);
            });
            frag.appendChild(btn);
        });
        this.searchResultsEl.appendChild(frag);
    }

    updateSearchSelectionHighlight() {
        if (!this.searchResultsEl) return;
        this.searchResultsEl.querySelectorAll('.config-editor-search-item').forEach((el, index) => {
            el.classList.toggle('keyboard-selected', index === this.searchSelectedIndex);
        });
    }

    scrollSearchSelectionIntoView() {
        if (!this.searchResultsEl || this.searchSelectedIndex < 0) return;
        const items = this.searchResultsEl.querySelectorAll('.config-editor-search-item');
        const el = items[this.searchSelectedIndex];
        if (el?.scrollIntoView) {
            el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
    }

    async navigateFromSearchResult(hit) {
        if (!hit?.configId) return;
        const query = this.searchQuery;
        const fullPath = hit.path || [];
        const isContainer = hit.type === 'object' || hit.type === 'array';
        const selectPath = (!isContainer && fullPath.length) ? fullPath.slice(0, -1) : fullPath;
        this.clearSearch(false);
        if (this.searchInput && query) this.searchInput.value = query;
        if (this.searchClearBtn) this.searchClearBtn.classList.remove('hidden');
        await this.navigateToPath(hit.configId, selectPath);
        if (!isContainer && fullPath.length) {
            setTimeout(() => this.highlightValueRow(hit.configId, fullPath), 80);
        }
    }

    clearSearch(clearInput) {
        clearTimeout(this.searchTimeout);
        this.searchToken++;
        this.searchQuery = '';
        this.searchResults = [];
        this.searchSelectedIndex = -1;
        this.searchActive = false;
        if (clearInput && this.searchInput) this.searchInput.value = '';
        if (this.searchClearBtn) this.searchClearBtn.classList.add('hidden');
        if (this.treeEl) this.treeEl.classList.remove('search-hidden');
        if (this.searchResultsEl) {
            this.searchResultsEl.classList.add('hidden');
            this.searchResultsEl.innerHTML = '';
        }
        setTimeout(() => this.reinitScrollbars(), 0);
    }

    formatValueDisplay(val, secretOrStub) {
        const secret = typeof secretOrStub === 'object'
            ? configEditorIsSecret(secretOrStub)
            : !!secretOrStub;
        if (secret) return CONFIG_EDITOR_SECRET_MASK;
        if (val === null) return 'null';
        if (val === undefined) return '—';
        return configEditorFormatDisplayValue(val);
    }

    buildValueCellHtml(configId, child, effectiveVal, effectiveType) {
        const pathAttr = encodeURIComponent(JSON.stringify(child.path));
        const cfgAttr = configEditorEscapeHtml(configId);
        const editMode = configEditorResolveEditMode(child, effectiveVal);
        const isSecret = configEditorIsSecret(child);

        if (child.expandable) {
            return `<button type="button" class="btn-secondary btn-small config-editor-open-btn" data-config-id="${cfgAttr}" data-path="${pathAttr}">
                <i class="fas fa-folder-open"></i> Open
            </button>`;
        }

        if (editMode === 'inline') {
            if (child.type === 'boolean' && !isSecret && !child.types?.length) {
                const on = effectiveVal === true || effectiveVal === 'true';
                return `<div class="config-editor-value-cell">
                    <button type="button" class="btn-secondary btn-small toggle-btn config-editor-bool-toggle"
                        data-state="${on ? 'on' : 'off'}"
                        data-config-id="${cfgAttr}"
                        data-path="${pathAttr}"
                        title="Toggle value">${on ? 'true' : 'false'}</button>
                </div>`;
            }
            if (child.enum?.length) {
                const label = configEditorEnumLabel(effectiveVal);
                const hiddenVal = effectiveVal === null ? 'null' : (effectiveVal != null ? String(effectiveVal) : '');
                return `<div class="config-editor-value-cell">
                    <button type="button" class="btn-secondary btn-small hover-show colored config-editor-inline-enum-btn"
                        data-config-id="${cfgAttr}" data-path="${pathAttr}">
                        <span class="config-editor-inline-enum-selected">${configEditorEscapeHtml(label)}</span>
                    </button>
                    <input type="hidden" class="config-editor-inline-enum-hidden" value="${configEditorEscapeHtml(hiddenVal)}">
                </div>`;
            }
            if (effectiveType === 'number') {
                const numVal = effectiveVal != null && effectiveVal !== '' ? String(effectiveVal) : '';
                return `<div class="config-editor-value-cell">
                    <input type="number" class="form-control hover-show colored config-editor-inline-input config-editor-inline-number"
                        data-config-id="${cfgAttr}" data-path="${pathAttr}"
                        value="${configEditorEscapeHtml(numVal)}" spellcheck="false">
                </div>`;
            }
            const strVal = effectiveVal != null ? String(effectiveVal) : '';
            return `<div class="config-editor-value-cell">
                <input type="text" class="form-control hover-show colored config-editor-inline-input config-editor-inline-string"
                    data-config-id="${cfgAttr}" data-path="${pathAttr}"
                    value="${configEditorEscapeHtml(strVal)}" spellcheck="false">
            </div>`;
        }

        const display = configEditorEscapeHtml(this.formatValueDisplay(effectiveVal, child));
        const titleAttr = configEditorEscapeHtml(this.formatValueDisplay(effectiveVal, child));
        if (editMode === 'secret') {
            return `<div class="config-editor-value-cell config-editor-secret-cell">
                <span class="config-editor-value-display" title="${titleAttr}">${display}</span>
                <button type="button" class="btn-secondary btn-small config-editor-edit-btn"
                    data-config-id="${cfgAttr}"
                    data-path="${pathAttr}" title="Edit secret">
                    <i class="fas fa-key"></i>
                </button>
            </div>`;
        }

        return `<div class="config-editor-value-cell">
            <span class="config-editor-value-display" title="${titleAttr}">${display}</span>
            <button type="button" class="btn-secondary btn-small config-editor-edit-btn"
                data-config-id="${cfgAttr}"
                data-path="${pathAttr}" title="Edit value">
                <i class="fas fa-pen"></i>
            </button>
        </div>`;
    }

    buildTreeExpandHtml(hasExpandableChildren) {
        if (hasExpandableChildren) {
            return `<button type="button" class="config-editor-tree-expand btn-secondary btn-small" title="Expand" aria-label="Expand">
                <i class="fas fa-chevron-right"></i>
            </button>`;
        }
        return '<span class="config-editor-tree-spacer" aria-hidden="true"></span>';
    }

    setStatus(text) {
        if (this.statusEl) this.statusEl.textContent = text;
    }

    getPendingCount() {
        let n = 0;
        this.pendingEdits.forEach((m) => { n += m.size; });
        return n;
    }

    getConfigRootIcon(configId) {
        return this.configList.find((c) => c.id === configId)?.icon || 'fas fa-database';
    }

    renderConfigRoots() {
        if (!this.treeEl) return;
        this.treeEl.innerHTML = '';
        for (const cfg of this.configList) {
            const row = document.createElement('div');
            row.className = 'config-editor-tree-item config-editor-tree-root';
            row.dataset.configId = cfg.id;
            row.dataset.path = '';
            const rootIcon = configEditorEscapeHtml(cfg.icon || 'fas fa-database');
            row.innerHTML = `
                ${this.buildTreeExpandHtml(true)}
                <button type="button" class="config-editor-tree-label">
                    <i class="${rootIcon}"></i>
                    <span>${configEditorEscapeHtml(cfg.label)}</span>
                </button>
            `;
            const expandBtn = row.querySelector('.config-editor-tree-expand');
            const labelBtn = row.querySelector('.config-editor-tree-label');
            expandBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleTreeExpand(cfg.id, [], row);
            });
            labelBtn.addEventListener('click', () => {
                this.selectNode(cfg.id, []);
            });
            this.attachRowContextMenu(row, {
                kind: 'tree',
                configId: cfg.id,
                path: [],
                containerPath: [],
                expandable: true
            });
            this.treeEl.appendChild(row);
        }
        setTimeout(() => {
            if (this.treeScrollShell) customScrollbar?.forceReinit(this.treeScrollShell);
        }, 0);
    }

    async selectNode(configId, path) {
        return this.runEditorAction(async () => {
            this.selectedConfigId = configId;
            this.selectedPath = path.slice();
            this.highlightTreeSelection();
            this.scrollTreeSelectionIntoView();
            this.setStatus(`${configId} → ${configEditorPathLabel(path)}`);
            await this.loadAndRenderValues(configId, path);
        });
    }

    highlightTreeSelection() {
        if (!this.treeEl) return;
        const key = configEditorPathKey(this.selectedConfigId, this.selectedPath);
        const trailKeys = new Set();
        for (let i = 0; i < this.selectedPath.length; i++) {
            trailKeys.add(configEditorPathKey(this.selectedConfigId, this.selectedPath.slice(0, i)));
        }
        this.treeEl.querySelectorAll('.config-editor-tree-item').forEach((el) => {
            const elPath = (el.dataset.path || '').split('\0').filter(Boolean);
            const elKey = configEditorPathKey(el.dataset.configId, elPath);
            el.classList.toggle('selected', elKey === key);
            el.classList.toggle('active-trail', trailKeys.has(elKey) && elKey !== key);
        });
    }

    scrollTreeSelectionIntoView() {
        if (!this.selectedConfigId) return;
        setTimeout(() => {
            const row = this.findTreeRow(this.selectedConfigId, this.selectedPath);
            if (!row) return;
            const scrollable = this.treeScrollShell?.querySelector('.config-editor-tree-scrollable')
                || this.treeScrollShell;
            if (scrollable && row.scrollIntoView) {
                row.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            }
        }, 60);
    }

    scrollValuesRowIntoView(row) {
        if (!row?.scrollIntoView) return;
        const scrollable = this.valuesScrollShell?.querySelector('.config-editor-values-scrollable')
            || this.valuesScrollShell;
        if (scrollable) {
            row.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
    }

    async fetchNode(configId, path, force) {
        const cacheKey = configEditorPathKey(configId, path);
        if (!force && this.nodeCache.has(cacheKey)) {
            return this.nodeCache.get(cacheKey);
        }
        if (path?.length && this.isPendingOnlyPath(configId, path)) {
            const pseudo = await this.buildPseudoNode(configId, path);
            if (pseudo) {
                this.nodeCache.set(cacheKey, pseudo);
                return pseudo;
            }
        }
        try {
            const data = await window.wsClient.sendMessage('config_editor_get_node', {
                configId,
                path
            }, false);
            this.nodeCache.set(cacheKey, data);
            return data;
        } catch (err) {
            const pseudo = await this.buildPseudoNode(configId, path);
            if (pseudo) {
                this.nodeCache.set(cacheKey, pseudo);
                return pseudo;
            }
            throw err;
        }
    }

    async loadAndRenderValues(configId, path) {
        if (!this.valuesEl) return;
        const token = ++this.loadValuesToken;
        this.valuesEl.innerHTML = this.valuesPanelStateRow('config-editor-loading', 'Loading…');
        try {
            const data = await this.fetchNode(configId, path);
            if (token !== this.loadValuesToken) return;
            if (this.selectedConfigId !== configId || !configEditorPathsEqual(this.selectedPath, path)) return;
            this.renderValuesPanel(data);
        } catch (err) {
            if (token !== this.loadValuesToken) return;
            console.error('config_editor_get_node:', err);
            this.valuesEl.innerHTML = this.valuesPanelStateRow('config-editor-error', 'Failed to load values');
        }
    }

    getPendingEdit(configId, path) {
        const m = this.pendingEdits.get(configId);
        if (!m) return null;
        return m.get(configEditorPathKey(configId, path)) || null;
    }

    setPendingEdit(configId, path, patch) {
        if (!this.pendingEdits.has(configId)) {
            this.pendingEdits.set(configId, new Map());
        }
        const key = configEditorPathKey(configId, path);
        const m = this.pendingEdits.get(configId);
        if (patch == null) {
            m.delete(key);
        } else {
            m.set(key, patch);
        }
        this.updatePendingStatus();
    }

    updatePendingStatus() {
        const n = this.getPendingCount();
        if (n > 0) {
            this.setStatus(`${n} unsaved change${n === 1 ? '' : 's'}`);
        }
    }

    getEffectiveValue(configId, path, serverValue) {
        const pending = this.getPendingEdit(configId, path);
        if (pending) {
            if (pending.deleted) return undefined;
            return pending.value;
        }
        return serverValue;
    }

    renderValuesPanel(data) {
        if (!this.valuesEl || !data) return;
        const { configId, path } = data;
        const children = this.mergeChildrenWithPending(configId, data);
        if (!children || !children.length) {
            this.valuesEl.innerHTML = this.valuesPanelStateRow('config-editor-empty', 'No child values at this path');
            return;
        }

        const frag = document.createDocumentFragment();
        for (const child of children) {
            const row = document.createElement('tr');
            row.className = 'config-editor-row';
            this.applyPendingHighlight(row, configId, child.path, child.isPendingNew);

            const effectiveVal = this.getEffectiveValue(configId, child.path, child.value);
            const name = child.label || child.key;
            const effectiveType = this.getEffectiveChildType(child, effectiveVal);
            const typeStr = configEditorFormatTypeDisplay(child, effectiveType);
            const typeTitle = configEditorTypeColumnTitle(child, effectiveType);
            const editHint = configEditorEditModeIndicator(child, effectiveVal);
            const unmappedBadge = child.mapped === false
                ? '<span class="config-editor-unmapped-badge" title="Not documented in config map">?</span>'
                : '';
            const nameCell = child.icon
                ? `<span class="config-editor-name-with-icon"><i class="${configEditorEscapeHtml(child.icon)}"></i> ${configEditorEscapeHtml(name)}${unmappedBadge}</span>`
                : `${configEditorEscapeHtml(name)}${unmappedBadge}`;

            const valueCell = this.buildValueCellHtml(configId, child, effectiveVal, effectiveType);

            row.innerHTML = `
                <td class="config-editor-col-edit" title="${configEditorEscapeHtml(editHint.title)}">
                    <i class="${configEditorEscapeHtml(editHint.icon)}" aria-hidden="true"></i>
                </td>
                <td class="config-editor-col-name">${nameCell}</td>
                <td class="config-editor-col-type"${typeTitle ? ` title="${configEditorEscapeHtml(typeTitle)}"` : ''}>${configEditorEscapeHtml(typeStr)}</td>
                <td class="config-editor-col-value">${valueCell}</td>
            `;
            if (child.description) row.title = child.description;
            this.attachRowContextMenu(row, {
                kind: 'value',
                configId,
                path: child.path.slice(),
                containerPath: path.slice(),
                expandable: !!child.expandable,
                child
            });
            frag.appendChild(row);
        }

        this.valuesEl.innerHTML = '';
        this.valuesEl.appendChild(frag);
        this.wireValuePanelEvents(configId);
        setTimeout(() => {
            if (this.valuesScrollShell) customScrollbar?.forceReinit(this.valuesScrollShell);
        }, 0);
    }

    parseValuePanelPath(datasetPath) {
        if (!datasetPath) return [];
        try {
            return JSON.parse(decodeURIComponent(datasetPath));
        } catch {
            return [];
        }
    }

    resolveChildFromValueTarget(target, configId, path) {
        const row = target?.closest?.('tr.config-editor-row');
        const ctxChild = row?._configEditorCtx?.child;
        if (ctxChild && configEditorPathsEqual(ctxChild.path, path)) {
            return ctxChild;
        }
        return this.findChildAtPath(configId, path);
    }

    async ensureChildAtPath(configId, path) {
        if (!path?.length) return null;
        const existing = this.findChildAtPath(configId, path);
        if (existing) return existing;

        const parentPath = path.slice(0, -1);
        let parentData = this.nodeCache.get(configEditorPathKey(configId, parentPath));
        if (!parentData) {
            try {
                parentData = await this.fetchNode(configId, parentPath);
            } catch (err) {
                console.error('configEditor ensureChildAtPath:', err);
                return null;
            }
        }
        if (!parentData) return null;
        const merged = this.mergeChildrenWithPending(configId, parentData);
        return merged.find(
            (c) => configEditorPathKey(configId, c.path) === configEditorPathKey(configId, path)
        ) || null;
    }

    async openValueEditorFromTarget(target) {
        const path = this.parseValuePanelPath(target?.dataset?.path);
        const configId = target?.dataset?.configId;
        if (!configId || !path.length) return;

        let child = this.resolveChildFromValueTarget(target, configId, path);
        if (!child) child = await this.ensureChildAtPath(configId, path);
        if (child) {
            this.openValueEditor(configId, child);
        } else {
            this.setStatus('Could not open editor — re-select the parent node');
        }
    }

    highlightValueRow(configId, path) {
        if (!this.valuesEl || !path?.length) return;
        this.valuesEl.querySelectorAll('tr.config-editor-row').forEach((row) => {
            const ctx = row._configEditorCtx;
            const match = ctx?.configId === configId && configEditorPathsEqual(ctx.path, path);
            row.classList.toggle('config-editor-row-flash', match);
            if (match) this.scrollValuesRowIntoView(row);
        });
        setTimeout(() => {
            this.valuesEl?.querySelectorAll('.config-editor-row-flash').forEach((row) => {
                row.classList.remove('config-editor-row-flash');
            });
        }, 1800);
    }

    wireValuePanelEvents(configId) {
        this.valuesEl.querySelectorAll('.config-editor-open-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const path = this.parseValuePanelPath(btn.dataset.path);
                const cfgId = btn.dataset.configId || configId;
                if (path.length) void this.navigateToPath(cfgId, path);
            });
        });

        this.valuesEl.querySelectorAll('.config-editor-edit-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.openValueEditorFromTarget(btn);
            });
        });

        this.valuesEl.querySelectorAll('.config-editor-bool-toggle').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const on = btn.getAttribute('data-state') !== 'on';
                btn.setAttribute('data-state', on ? 'on' : 'off');
                btn.textContent = on ? 'true' : 'false';
                const path = this.parseValuePanelPath(btn.dataset.path);
                const cfgId = btn.dataset.configId || configId;
                const row = btn.closest('tr.config-editor-row');
                this.recordValueChange(cfgId, path, on, row);
            });
        });

        this.valuesEl.querySelectorAll('.config-editor-inline-string').forEach((input) => {
            const commit = () => {
                const path = this.parseValuePanelPath(input.dataset.path);
                const cfgId = input.dataset.configId || configId;
                const row = input.closest('tr.config-editor-row');
                this.recordValueChange(cfgId, path, input.value, row);
            };
            input.addEventListener('change', commit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
            });
        });

        this.valuesEl.querySelectorAll('.config-editor-inline-number').forEach((input) => {
            const commit = () => {
                const path = this.parseValuePanelPath(input.dataset.path);
                const cfgId = input.dataset.configId || configId;
                const row = input.closest('tr.config-editor-row');
                let val = input.value === '' ? '' : Number(input.value);
                if (input.value !== '' && Number.isNaN(val)) {
                    this.setStatus('Invalid number');
                    return;
                }
                this.recordValueChange(cfgId, path, val, row);
            };
            input.addEventListener('change', commit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
            });
        });

        this.valuesEl.querySelectorAll('.config-editor-inline-enum-btn').forEach((btn) => {
            this.wireInlineEnumClickMenu(btn);
        });

        this.valuesEl.querySelectorAll('tr.config-editor-row').forEach((row) => {
            const editBtn = row.querySelector('.config-editor-edit-btn');
            if (!editBtn) return;
            row.addEventListener('dblclick', () => editBtn.click());
        });
    }

    findValuePanelChild(configId, path, target) {
        if (!path?.length) return null;
        if (target) {
            const fromRow = this.resolveChildFromValueTarget(target, configId, path);
            if (fromRow) return fromRow;
        }
        return this.findChildAtPath(configId, path);
    }

    findChildAtPath(configId, path) {
        if (!path?.length) return null;
        const parentPath = path.slice(0, -1);
        const parentKey = configEditorPathKey(configId, parentPath);
        const parentData = this.nodeCache.get(parentKey);
        if (!parentData) return null;
        const merged = this.mergeChildrenWithPending(configId, parentData);
        return merged.find(
            (c) => configEditorPathKey(configId, c.path) === configEditorPathKey(configId, path)
        ) || null;
    }

    async refreshCurrentValuesPanel() {
        if (!this.selectedConfigId || !this.valuesEl) return;
        await this.loadAndRenderValues(this.selectedConfigId, this.selectedPath);
    }

    canChangeChildType(ctx) {
        const child = ctx?.child || this.findChildAtPath(ctx?.configId, ctx?.path);
        if (!child?.types || child.types.length <= 1) return false;
        const val = this.getEffectiveValue(ctx.configId, child.path, child.value);
        const t = this.getEffectiveChildType(child, val);
        return t === 'string' || t === 'array';
    }

    loadChangeTypeMenuItem(item, ctx) {
        const child = ctx?.child || this.findChildAtPath(ctx?.configId, ctx?.path);
        if (!child) return;
        const val = this.getEffectiveValue(ctx.configId, child.path, child.value);
        const t = this.getEffectiveChildType(child, val);
        if (t === 'array') {
            item.text = 'Convert to string';
            item.icon = 'fas fa-font';
        } else {
            item.text = 'Convert to array';
            item.icon = 'fas fa-list';
        }
    }

    wireInlineEnumClickMenu(btn) {
        if (!contextMenu || !this.inlineEnumClickMenuConfig) return;
        contextMenu.attachClickMenuToElement(btn, this.inlineEnumClickMenuConfig);
    }

    refreshInlineEnumClickMenuItems(target) {
        if (!this.inlineEnumClickMenuConfig || !target) return;
        const configId = target.dataset.configId;
        const path = this.parseValuePanelPath(target.dataset.path);
        const child = this.findValuePanelChild(configId, path, target);
        if (!child?.enum?.length) {
            this.inlineEnumClickMenuConfig.sections[0].items = [];
            return;
        }
        const hidden = target.parentElement?.querySelector('.config-editor-inline-enum-hidden');
        const current = hidden?.value ?? '';
        const items = child.enum.map((v) => {
            const raw = v === null ? 'null' : String(v);
            return {
                text: configEditorEnumLabel(v),
                action: 'config-editor-inline-enum-pick',
                enumValue: raw,
                loadfn: (item) => {
                    item.highlighted = item.enumValue === current;
                }
            };
        });
        if (child.enumAllowCustom) {
            items.push({ text: 'Custom…', action: 'config-editor-inline-enum-custom' });
        }
        this.inlineEnumClickMenuConfig.sections[0].items = items;
    }

    async handleInlineEnumClickMenuAction(action, target, item) {
        const configId = target?.dataset?.configId;
        const path = this.parseValuePanelPath(target?.dataset?.path);
        let child = this.findValuePanelChild(configId, path, target);
        if (!child) child = await this.ensureChildAtPath(configId, path);
        if (!child) return;

        const selectedEl = target.querySelector('.config-editor-inline-enum-selected');
        const hidden = target.parentElement?.querySelector('.config-editor-inline-enum-hidden');
        const row = target.closest('tr.config-editor-row');

        const applyEnumValue = (rawVal) => {
            let stored = rawVal;
            if (rawVal === 'null') stored = null;
            else if (child.type === 'number') stored = Number(rawVal);
            if (selectedEl) selectedEl.textContent = configEditorEnumLabel(stored);
            if (hidden) hidden.value = stored === null ? 'null' : String(stored);
            this.recordValueChange(configId, path, stored, row);
        };

        if (action === 'config-editor-inline-enum-pick') {
            applyEnumValue(item.enumValue);
            return;
        }
        if (action === 'config-editor-inline-enum-custom') {
            const current = hidden?.value === 'null' ? '' : (hidden?.value ?? '');
            // showInputDialog: public/scripts/comp/confirmationDialog.js
            const custom = await showInputDialog(
                'Enter custom value:',
                current,
                '',
                null,
                null,
                { title: child.label || child.key || 'Custom value' }
            );
            if (custom == null) return;
            applyEnumValue(String(custom));
        }
    }

    refreshValueModalEnumClickMenuItems() {
        if (!this.valueModalEnumClickMenuConfig) return;
        const child = this.editTarget?.child;
        const hidden = document.getElementById('configEditorValueEnumHidden');
        const current = hidden?.value ?? '';
        const values = child?.enum?.length ? child.enum : [];
        const items = values.map((v) => {
            const raw = v === null ? 'null' : String(v);
            return {
                text: configEditorEnumLabel(v),
                action: 'config-editor-value-enum-pick',
                enumValue: raw,
                loadfn: (menuItem) => {
                    menuItem.highlighted = menuItem.enumValue === current;
                }
            };
        });
        if (child?.enumAllowCustom) {
            items.push({ text: 'Custom…', action: 'config-editor-value-enum-custom' });
        }
        this.valueModalEnumClickMenuConfig.sections[0].items = items;
    }

    async handleValueModalEnumClickMenuAction(action, target, item) {
        const child = this.editTarget?.child;
        const selectedEl = document.getElementById('configEditorValueEnumSelected');
        const hidden = document.getElementById('configEditorValueEnumHidden');
        if (!child || !selectedEl || !hidden) return;

        if (action === 'config-editor-value-enum-pick') {
            hidden.value = String(item.enumValue);
            selectedEl.textContent = item.enumValue === 'null' ? 'null' : String(item.enumValue);
            return;
        }
        if (action === 'config-editor-value-enum-custom') {
            const current = hidden.value === 'null' ? '' : hidden.value;
            // showInputDialog: public/scripts/comp/confirmationDialog.js
            const custom = await showInputDialog(
                'Enter custom value:',
                current,
                '',
                null,
                null,
                { title: child.label || child.key || 'Custom value' }
            );
            if (custom == null) return;
            hidden.value = String(custom);
            selectedEl.textContent = String(custom);
        }
    }

    getEffectiveChildType(child, value) {
        if (child?.types?.length) {
            if (Array.isArray(value)) return 'array';
            if (value !== null && typeof value === 'object') return 'object';
            if (typeof value === 'boolean') return 'boolean';
            if (typeof value === 'number') return 'number';
            return 'string';
        }
        return child?.type || 'string';
    }

    hideAllValueEditorFields() {
        const ids = [
            'configEditorValueInput',
            'configEditorValueNumber',
            'configEditorValueSecret',
            'configEditorValueTextarea',
            'configEditorValuePromptWrap',
            'configEditorValueBoolToggle',
            'configEditorValueEnumBtn'
        ];
        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        const convertBtn = document.getElementById('configEditorValueConvertBtn');
        if (convertBtn) convertBtn.classList.add('hidden');
    }

    async resolvePathValue(configId, path) {
        const pending = this.getPendingEdit(configId, path);
        if (pending) {
            if (pending.deleted) return undefined;
            return pending.value;
        }
        const data = await this.fetchNode(configId, path);
        if (data && Object.prototype.hasOwnProperty.call(data, 'nodeValue')) {
            return data.nodeValue;
        }
        const child = this.findChildAtPath(configId, path);
        return child?.value;
    }

    async openRawJsonEditor(configId, path, ctx) {
        if (!this.valueModal) return;
        const keyName = ctx?.child?.label || ctx?.child?.key
            || (path?.length ? path[path.length - 1] : this.getConfigLabel(configId));
        let value;
        try {
            value = await this.resolvePathValue(configId, path);
        } catch (err) {
            console.error('config_editor raw json:', err);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Runes', err.message || 'Failed to load value');
            }
            return;
        }
        const readOnly = !this.isConfigEditorAdmin();
        const typeLabel = value === null ? 'null'
            : Array.isArray(value) ? 'array'
                : typeof value;
        this.editTarget = {
            configId,
            path: path.slice(),
            rawJsonMode: true,
            readOnly,
            keyName
        };
        this.setValueModalTitle(configId, keyName, `${typeLabel} · JSON`, { readOnly });
        this.hideAllValueEditorFields();
        this.resetValueEditorFieldClasses();
        const ta = document.getElementById('configEditorValueTextarea');
        if (!ta) return;
        ta.classList.remove('hidden');
        ta.readOnly = readOnly;
        ta.value = JSON.stringify(value, null, 2);
        this.setValueEditorApplyState(!readOnly);
        this.applyValueModalLayout('multiline');
        openModal(this.valueModal);
        this.ensureValueMultilineTextareaWired();
        setTimeout(() => {
            this.applyValueModalLayout('multiline');
            this.layoutValueModalMultilineContent();
            this.reinitScrollbars();
            ta.focus();
        }, 80);
    }

    async openValueEditor(configId, child) {
        if (!this.valueModal || !child || child.expandable) return;

        this.editTarget = { configId, child: { ...child }, rawJsonMode: false, readOnly: false };
        const effectiveVal = this.getEffectiveValue(configId, child.path, child.value);
        const effectiveType = this.getEffectiveChildType(child, effectiveVal);
        const keyName = child.label || child.key || 'value';
        this.setValueModalTitle(configId, keyName, effectiveType || child.type || 'auto');

        this.hideAllValueEditorFields();
        this.resetValueEditorFieldClasses();

        const multiType = child.types?.length > 1;
        const convertBtn = document.getElementById('configEditorValueConvertBtn');
        if (convertBtn) {
            if (multiType) {
                convertBtn.classList.remove('hidden');
                const toArray = effectiveType === 'string';
                convertBtn.innerHTML = toArray
                    ? '<i class="fas fa-list"></i> Convert to array'
                    : '<i class="fas fa-font"></i> Convert to string';
                convertBtn.dataset.convertTo = toArray ? 'array' : 'string';
            } else {
                convertBtn.classList.add('hidden');
            }
        }

        const editorType = configEditorResolveEditorType(child, effectiveVal, effectiveType);
        const layoutMode = configEditorValueModalLayoutMode({ effectiveType, editorType });
        this.applyValueModalLayout(layoutMode);
        openModal(this.valueModal);
        if (layoutMode === 'multiline') {
            this.ensureValueMultilineTextareaWired();
        }
        setTimeout(() => {
            this.applyValueModalLayout(layoutMode);
            if (layoutMode === 'multiline') {
                this.layoutValueModalMultilineContent();
            }
            this.reinitScrollbars();
        }, 80);

        if (configEditorIsSecret(child)) {
            const el = document.getElementById('configEditorValueSecret');
            if (!el) return;
            el.classList.remove('hidden');
            el.value = '';
            el.disabled = true;
            el.placeholder = 'Loading secret…';
            try {
                const data = await window.wsClient.sendMessage('config_editor_reveal_secret', {
                    configId,
                    path: child.path
                }, false);
                el.value = data?.value ?? '';
                el.placeholder = 'Enter new value (leave empty to keep unchanged)';
            } catch (err) {
                console.error('config_editor_reveal_secret:', err);
                el.placeholder = 'Failed to load secret value';
                if (typeof showGlassToast === 'function') {
                    showGlassToast('error', 'Runes', err.message || 'Failed to load secret');
                }
            }
            el.disabled = false;
            el.focus();
        } else if (effectiveType === 'boolean') {
            const btn = document.getElementById('configEditorValueBoolToggle');
            if (!btn) return;
            btn.classList.remove('hidden');
            const on = effectiveVal === true || effectiveVal === 'true';
            btn.setAttribute('data-state', on ? 'on' : 'off');
            btn.textContent = on ? 'true' : 'false';
        } else if (effectiveType === 'number') {
            const el = document.getElementById('configEditorValueNumber');
            if (!el) return;
            el.classList.remove('hidden');
            el.value = effectiveVal != null && effectiveVal !== '' ? String(effectiveVal) : '';
            el.focus();
        } else if (effectiveType === 'array') {
            const el = document.getElementById('configEditorValueTextarea');
            if (!el) return;
            el.classList.remove('hidden');
            el.value = JSON.stringify(Array.isArray(effectiveVal) ? effectiveVal : [], null, 2);
            el.focus();
        } else if (child.enum?.length) {
            const enumBtn = document.getElementById('configEditorValueEnumBtn');
            if (!enumBtn) return;
            enumBtn.classList.remove('hidden');
            this.setEnumEditorValue(child.enum, effectiveVal);
        } else if (editorType === 'prompt') {
            const wrap = document.getElementById('configEditorValuePromptWrap');
            const el = document.getElementById('configEditorValuePromptTextarea');
            if (!wrap || !el) return;
            wrap.classList.remove('hidden');
            el.value = effectiveVal != null ? String(effectiveVal) : '';
            this.ensureValuePromptTextareaWired();
            if (window.promptTextareaToolbar) {
                window.promptTextareaToolbar.updateTokenCount(el);
            }
            setTimeout(() => el.focus(), 80);
        } else if (editorType === 'textarea') {
            const el = document.getElementById('configEditorValueTextarea');
            if (!el) return;
            el.classList.remove('hidden');
            el.value = effectiveVal != null ? String(effectiveVal) : '';
            el.focus();
        } else {
            const el = document.getElementById('configEditorValueInput');
            if (!el) return;
            el.classList.remove('hidden');
            el.value = effectiveVal != null ? configEditorFormatDisplayValue(effectiveVal) : '';
            el.focus();
        }
    }

    async convertChildValueType(configId, child, { reopenEditor = false } = {}) {
        const effectiveVal = this.getEffectiveValue(configId, child.path, child.value);
        const effectiveType = this.getEffectiveChildType(child, effectiveVal);

        if (effectiveType === 'string') {
            const wrapped = effectiveVal != null && effectiveVal !== '' ? [String(effectiveVal)] : [''];
            this.recordValueChange(configId, child.path, wrapped, null);
            const updated = { ...child, value: wrapped, type: 'array' };
            if (this.editTarget?.configId === configId
                && configEditorPathsEqual(this.editTarget.child?.path, child.path)) {
                this.editTarget.child = updated;
            }
            if (reopenEditor) {
                this.openValueEditor(configId, updated);
            } else if (this.selectedConfigId === configId) {
                await this.loadAndRenderValues(configId, this.selectedPath);
            }
            return;
        }

        if (effectiveType === 'array') {
            const arr = Array.isArray(effectiveVal) ? effectiveVal : [];
            const preview = arr.length === 1
                ? `Use first item: "${String(arr[0]).slice(0, 80)}"`
                : `Array has ${arr.length} items — only the first will be kept as a string.`;
            const ok = await showConfirmationDialog(
                `Convert this array to a single string?<br>${configEditorEscapeHtml(preview)}`,
                [
                    { text: 'Convert', value: 'ok', className: 'btn-primary', icon: 'fas fa-font', primary: true },
                    { text: 'Cancel', value: null, className: 'btn-secondary' }
                ],
                null,
                { title: 'Convert to string' }
            );
            if (ok !== 'ok') return;
            const str = arr.length ? String(arr[0]) : '';
            this.recordValueChange(configId, child.path, str, null);
            const updated = { ...child, value: str, type: 'string' };
            if (this.editTarget?.configId === configId
                && configEditorPathsEqual(this.editTarget.child?.path, child.path)) {
                this.editTarget.child = updated;
            }
            if (reopenEditor) {
                this.openValueEditor(configId, updated);
            } else if (this.selectedConfigId === configId) {
                await this.loadAndRenderValues(configId, this.selectedPath);
            }
        }
    }

    async convertValueEditorType() {
        if (!this.editTarget) return;
        const { configId, child } = this.editTarget;
        await this.convertChildValueType(configId, child, { reopenEditor: true });
    }

    setEnumEditorValue(enumValues, effectiveVal) {
        const selectedEl = document.getElementById('configEditorValueEnumSelected');
        const hidden = document.getElementById('configEditorValueEnumHidden');
        if (!selectedEl || !hidden) return;

        const value = effectiveVal != null ? String(effectiveVal) : String(enumValues[0] ?? '');
        const hiddenVal = effectiveVal === null ? 'null' : value;
        hidden.value = hiddenVal;
        selectedEl.textContent = configEditorEnumLabel(effectiveVal);
    }

    readValueFromEditor() {
        const target = this.editTarget;
        if (!target) return undefined;

        if (target.rawJsonMode) {
            const ta = document.getElementById('configEditorValueTextarea');
            const raw = (ta?.value ?? '').trim();
            if (!raw) return null;
            try {
                return JSON.parse(raw);
            } catch {
                throw new Error('Invalid JSON');
            }
        }

        const child = target.child;
        if (!child) return undefined;

        if (configEditorIsSecret(child)) {
            const el = document.getElementById('configEditorValueSecret');
            return (el?.value ?? '').trim();
        }
        const effectiveVal = this.getEffectiveValue(target.configId, child.path, child.value);
        const effectiveType = this.getEffectiveChildType(child, effectiveVal);
        if (effectiveType === 'boolean') {
            const btn = document.getElementById('configEditorValueBoolToggle');
            return btn?.getAttribute('data-state') === 'on';
        }
        if (effectiveType === 'number') {
            const el = document.getElementById('configEditorValueNumber');
            if (!el || el.value === '') return '';
            return Number(el.value);
        }
        if (this.isValuePromptEditorVisible()) {
            const promptTa = document.getElementById('configEditorValuePromptTextarea');
            if (promptTa) {
                // applyFormattedText: public/scripts/comp/utilities.js
                if (typeof applyFormattedText === 'function') {
                    applyFormattedText(promptTa, true);
                }
                return promptTa.value;
            }
        }
        const ta = document.getElementById('configEditorValueTextarea');
        if (ta && !ta.classList.contains('hidden')) {
            if (effectiveType === 'array') {
                const raw = ta.value.trim();
                if (!raw) return [];
                try {
                    const parsed = JSON.parse(raw);
                    if (!Array.isArray(parsed)) throw new Error('not array');
                    return parsed;
                } catch {
                    throw new Error('Invalid JSON array');
                }
            }
            return ta.value;
        }
        const enumBtn = document.getElementById('configEditorValueEnumBtn');
        if (enumBtn && !enumBtn.classList.contains('hidden')) {
            const raw = document.getElementById('configEditorValueEnumHidden')?.value ?? '';
            if (raw === 'null' && child.enum?.includes(null)) return null;
            if (child.type === 'number' && raw !== '') return Number(raw);
            return raw;
        }
        const el = document.getElementById('configEditorValueInput');
        return el?.value ?? '';
    }

    applyValueFromEditor() {
        if (!this.editTarget) return;
        if (this.editTarget.readOnly) return;
        const { configId, child, rawJsonMode, path } = this.editTarget;
        let val;
        try {
            val = this.readValueFromEditor();
        } catch (err) {
            this.setStatus(err.message || 'Invalid value');
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Runes', err.message || 'Invalid value');
            }
            return;
        }
        if (rawJsonMode) {
            this.recordValueChange(configId, path, val, null);
            this.closeValueEditor();
            if (this.selectedConfigId === configId) {
                void this.refreshCurrentValuesPanel();
            }
            return;
        }
        if (configEditorIsSecret(child)) {
            if (!val) {
                this.closeValueEditor();
                return;
            }
        }
        this.recordValueChange(configId, child.path, val, null);
        this.closeValueEditor();
        if (this.selectedConfigId === configId) {
            void this.refreshCurrentValuesPanel();
        }
    }

    closeValueEditor() {
        this.editTarget = null;
        this.resetValueEditorFieldClasses();
        if (this.valueModal && !this.valueModal.classList.contains('hidden')) {
            closeModal(this.valueModal);
        }
    }

    recordValueChange(configId, path, value, rowEl) {
        const cacheKey = configEditorPathKey(configId, path);
        const parentKey = configEditorPathKey(configId, this.selectedPath);
        const parentData = this.nodeCache.get(parentKey);
        let previousValue;
        if (parentData?.children) {
            const stub = parentData.children.find((c) => configEditorPathKey(configId, c.path) === cacheKey);
            previousValue = stub?.value;
        }

        const stub = parentData?.children?.find((c) => configEditorPathKey(configId, c.path) === cacheKey);

        const mergedStub = rowEl?._configEditorCtx?.child || stub;
        this.setPendingEdit(configId, path, {
            path: path.slice(),
            value,
            deleted: false,
            previousValue,
            restartRequired: !!(mergedStub?.restartRequired ?? stub?.restartRequired),
            secret: configEditorIsSecret(mergedStub || stub || { path, key: path[path.length - 1] }),
            label: mergedStub?.label || mergedStub?.key || path[path.length - 1]
        });
        if (rowEl) {
            this.applyPendingHighlight(rowEl, configId, path, false);
            if (rowEl._configEditorCtx?.child && !rowEl._configEditorCtx.child.expandable) {
                rowEl._configEditorCtx.child.value = value;
            }
        }
        this.invalidateCacheFrom(configId, path.slice(0, -1));
    }

    async navigateToPath(configId, path) {
        await this.ensureTreePath(configId, path);
        await this.selectNode(configId, path);
    }

    async ensureTreePath(configId, path) {
        for (let i = 0; i < path.length; i++) {
            const partial = path.slice(0, i);
            const expandKey = configEditorPathKey(configId, partial) + ':expanded';
            if (!this.expandedKeys.has(expandKey)) {
                const row = this.findTreeRow(configId, partial);
                if (row) await this.toggleTreeExpand(configId, partial, row, true);
            }
        }
    }

    findTreeRow(configId, path) {
        const pathStr = path.join('\0');
        return this.treeEl?.querySelector(
            `.config-editor-tree-item[data-config-id="${configId}"][data-path="${pathStr}"]`
        );
    }

    async toggleTreeExpand(configId, path, rowEl, forceOpen) {
        const expandKey = configEditorPathKey(configId, path) + ':expanded';
        const isOpen = this.expandedKeys.has(expandKey);
        if (forceOpen && isOpen) {
            await this.loadTreeChildren(configId, path, rowEl);
            return;
        }
        if (isOpen && !forceOpen) {
            this.expandedKeys.delete(expandKey);
            const container = rowEl.nextElementSibling;
            if (container?.classList.contains('config-editor-tree-children')) {
                container.remove();
            }
            const icon = rowEl.querySelector('.config-editor-tree-expand i');
            if (icon) icon.className = 'fas fa-chevron-right';
            return;
        }

        this.expandedKeys.add(expandKey);
        const icon = rowEl.querySelector('.config-editor-tree-expand i');
        if (icon) icon.className = 'fas fa-chevron-down';
        await this.loadTreeChildren(configId, path, rowEl);
    }

    async loadTreeChildren(configId, path, rowEl) {
        let container = rowEl.nextElementSibling;
        if (container?.classList.contains('config-editor-tree-children')) {
            container.remove();
        }
        container = document.createElement('div');
        container.className = 'config-editor-tree-children';
        rowEl.after(container);

        try {
            const data = await this.fetchNode(configId, path);
            const children = this.mergeChildrenWithPending(configId, data);
            for (const child of children) {
                if (!child.expandable) continue;
                const childPath = child.path;
                const item = document.createElement('div');
                item.className = 'config-editor-tree-item';
                this.applyPendingHighlight(item, configId, childPath, child.isPendingNew);
                item.dataset.configId = configId;
                item.dataset.path = childPath.join('\0');
                item.dataset.depth = String(childPath.length);
                const hasExpandableChildren = !!child.hasExpandableChildren;
                const treeIcon = child.icon ? configEditorEscapeHtml(child.icon) : 'fas fa-folder';
                item.innerHTML = `
                    ${this.buildTreeExpandHtml(hasExpandableChildren)}
                    <button type="button" class="config-editor-tree-label">
                        <i class="${treeIcon}"></i>
                        <span>${configEditorEscapeHtml(child.label || child.key)}</span>
                    </button>
                `;
                const expandBtn = item.querySelector('.config-editor-tree-expand');
                const labelBtn = item.querySelector('.config-editor-tree-label');
                if (expandBtn) {
                    expandBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.toggleTreeExpand(configId, childPath, item);
                    });
                }
                labelBtn.addEventListener('click', () => {
                    this.selectNode(configId, childPath);
                });
                this.attachRowContextMenu(item, {
                    kind: 'tree',
                    configId,
                    path: childPath.slice(),
                    containerPath: childPath.slice(),
                    expandable: true,
                    hasExpandableChildren,
                    child
                });
                container.appendChild(item);
            }
            this.highlightTreeSelection();
        } catch (err) {
            console.error('Tree expand:', err);
        }
        setTimeout(() => {
            if (this.treeScrollShell) customScrollbar?.forceReinit(this.treeScrollShell);
            this.scrollTreeSelectionIntoView();
        }, 0);
    }

    async refreshTreePreservingExpansion() {
        if (!this.treeEl) return;
        const expandedSnapshot = [...this.expandedKeys];
        const { selectedConfigId, selectedPath } = this;
        this.renderConfigRoots();
        const sorted = expandedSnapshot.sort((a, b) => {
            const depthA = configEditorParsePathKey(a.slice(0, -':expanded'.length)).path.length;
            const depthB = configEditorParsePathKey(b.slice(0, -':expanded'.length)).path.length;
            return depthA - depthB;
        });
        for (const expandKey of sorted) {
            if (!expandKey.endsWith(':expanded')) continue;
            const { configId, path } = configEditorParsePathKey(expandKey.slice(0, -':expanded'.length));
            this.expandedKeys.add(expandKey);
            const row = this.findTreeRow(configId, path);
            if (row) await this.toggleTreeExpand(configId, path, row, true);
        }
        if (selectedConfigId) {
            await this.selectNode(selectedConfigId, selectedPath);
        }
    }

    buildPatchesPayload() {
        const patches = {};
        this.pendingEdits.forEach((map, configId) => {
            patches[configId] = [];
            map.forEach((edit) => {
                patches[configId].push({
                    path: edit.path,
                    value: edit.deleted ? undefined : edit.value,
                    deleted: !!edit.deleted
                });
            });
        });
        return patches;
    }

    buildSaveSummaryHtml() {
        const rows = [];
        const configIds = [];
        let anyRestart = false;
        this.pendingEdits.forEach((map, configId) => {
            configIds.push(configId);
            map.forEach((edit) => {
                if (edit.restartRequired) anyRestart = true;
                const pathStr = configEditorPathLabel(edit.path);
                const from = edit.secret
                    ? CONFIG_EDITOR_SECRET_MASK
                    : configEditorEscapeHtml(configEditorFormatDisplayValue(edit.previousValue));
                const to = edit.deleted
                    ? '<em>deleted</em>'
                    : (edit.secret && edit.value !== CONFIG_EDITOR_SECRET_MASK
                        ? CONFIG_EDITOR_SECRET_MASK
                        : configEditorEscapeHtml(configEditorFormatDisplayValue(edit.value)));
                const restart = edit.restartRequired ? ' <i class="fas fa-arrows-rotate" title="Restart required"></i>' : '';
                rows.push(`<tr>
                    <td>${configEditorEscapeHtml(configId)}</td>
                    <td>${configEditorEscapeHtml(pathStr)}</td>
                    <td>${edit.deleted ? 'delete' : 'set'}</td>
                    <td>${from} → ${to}${restart}</td>
                </tr>`);
            });
        });

        const toggleRows = configIds.map((configId) => `
            <div class="config-editor-save-checkpoint-row">
                <span>${configEditorEscapeHtml(configId)}</span>
                <button type="button" class="btn-secondary btn-small toggle-btn config-editor-save-cp-toggle"
                    data-config-id="${configEditorEscapeHtml(configId)}"
                    data-state="on"
                    title="Create checkpoint before saving this config">Checkpoint: on</button>
            </div>`).join('');

        let html = `<p>Apply <strong>${rows.length}</strong> change${rows.length === 1 ? '' : 's'}?</p>`;
        if (configIds.length) {
            html += `<div class="config-editor-save-checkpoint-toggles form-section-scroll">
                <p class="config-editor-save-checkpoint-heading">Checkpoint before save</p>
                ${toggleRows}
            </div>`;
        }
        html += `<div class="config-editor-summary-table-wrap form-section-scroll">
            <table class="config-editor-summary-table">
            <thead><tr><th>Config</th><th>Path</th><th>Action</th><th>Change</th></tr></thead>
            <tbody>${rows.join('')}</tbody></table></div>`;
        if (anyRestart) {
            html += '<p class="config-editor-restart-note"><i class="fas fa-arrows-rotate"></i> Server will restart after save.</p>';
        }
        return html;
    }

    wireSaveCheckpointToggles(dialog) {
        if (!dialog) return;
        dialog.querySelectorAll('.config-editor-save-cp-toggle').forEach((btn) => {
            btn.addEventListener('click', () => {
                const on = btn.dataset.state === 'on';
                btn.dataset.state = on ? 'off' : 'on';
                btn.textContent = on ? 'Checkpoint: off' : 'Checkpoint: on';
            });
        });
    }

    collectSaveCheckpointOptions(dialog) {
        const createCheckpoint = {};
        if (!dialog) return createCheckpoint;
        dialog.querySelectorAll('.config-editor-save-cp-toggle').forEach((btn) => {
            const configId = btn.dataset.configId;
            if (!configId) return;
            createCheckpoint[configId] = btn.dataset.state === 'on';
        });
        return createCheckpoint;
    }

    async requestSave() {
        const n = this.getPendingCount();
        if (!n) {
            this.setStatus('No pending changes');
            return;
        }

        const summaryHtml = this.buildSaveSummaryHtml();
        const result = await showConfirmationDialog(summaryHtml, [
            { text: 'Save', value: 'save', className: 'btn-primary', icon: 'fas fa-save', primary: true },
            { text: 'Cancel', value: null, className: 'btn-secondary' }
        ], null, {
            title: 'Save configuration changes',
            onDialogReady: () => {
                const dialog = document.getElementById('confirmationDialog');
                this.wireSaveCheckpointToggles(dialog);
            },
            resolveValue: (value, dialog) => {
                if (value !== 'save') return value;
                return {
                    action: 'save',
                    createCheckpoint: this.collectSaveCheckpointOptions(dialog)
                };
            }
        });

        if (!result || result.action !== 'save') return;

        await this.runEditorAction(async () => {
            this.setStatus('Saving…');
            try {
                const patches = this.buildPatchesPayload();
                const payload = { patches };
                if (result.createCheckpoint && Object.keys(result.createCheckpoint).length) {
                    payload.createCheckpoint = result.createCheckpoint;
                }
                const data = await window.wsClient.sendMessage('config_editor_save', payload, false);
                if (!data?.success) {
                    const errMsg = data?.errors?.map((e) => e.message || e).join('; ') || 'Save failed';
                    this.setStatus(errMsg);
                    if (typeof showGlassToast === 'function') {
                        showGlassToast('error', 'Runes', errMsg);
                    }
                    return;
                }
                this.pendingEdits.clear();
                this.nodeCache.clear();
                if (data.restarting) {
                    this.setStatus('Restarting server…');
                    if (typeof showGlassToast === 'function') {
                        showGlassToast('info', 'Runes', 'Server is restarting…');
                    }
                } else {
                    this.setStatus('Saved');
                    if (typeof showGlassToast === 'function') {
                        showGlassToast('success', 'Runes', 'Configuration saved');
                    }
                    if (this.selectedConfigId) {
                        await this.refreshTreePreservingExpansion();
                    }
                }
            } catch (err) {
                console.error('config_editor_save:', err);
                this.setStatus('Save failed');
            }
        });
    }

    async requestClose() {
        const n = this.getPendingCount();
        if (n > 0) {
            const result = await showConfirmationDialog(
                `Discard <strong>${n}</strong> pending change${n === 1 ? '' : 's'}?`,
                [
                    { text: 'Discard', value: 'discard', className: 'btn-danger', icon: 'fas fa-trash' },
                    { text: 'Cancel', value: null, className: 'btn-secondary' }
                ],
                null,
                { title: 'Unsaved changes' }
            );
            if (result !== 'discard') return;
        }
        this.doClose();
    }

    formatCheckpointTimestamp(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return d.toLocaleString();
        } catch {
            return String(iso);
        }
    }

    formatCheckpointRelativeTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);
        const sec = Math.floor((Date.now() - d.getTime()) / 1000);
        if (sec < 45) return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
        const day = Math.floor(hr / 24);
        if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
        const month = Math.floor(day / 30);
        if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
        const year = Math.floor(month / 12);
        return `${year} year${year === 1 ? '' : 's'} ago`;
    }

    formatBytes(n) {
        const num = Number(n) || 0;
        if (num < 1024) return `${num} B`;
        if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
        return `${(num / (1024 * 1024)).toFixed(1)} MB`;
    }

    setCheckpointsStatus(msg) {
        if (this.checkpointsStatusEl) {
            this.checkpointsStatusEl.textContent = msg || '';
        }
    }

    async openCheckpointsModal(configId) {
        if (!this.checkpointsModal) return;
        this.checkpointsScopeConfigId = configId || this.selectedConfigId || null;
        openModal(this.checkpointsModal);
        setTimeout(() => this.reinitScrollbars(), 80);
        await this.loadCheckpointsList();
    }

    closeCheckpointsModal() {
        if (this.checkpointsModal && !this.checkpointsModal.classList.contains('hidden')) {
            closeModal(this.checkpointsModal);
        }
    }

    renderCheckpointsList(checkpoints) {
        if (!this.checkpointsListEl) return;
        const scopeLabel = this.checkpointsScopeConfigId
            ? (this.configList.find((c) => c.id === this.checkpointsScopeConfigId)?.label || this.checkpointsScopeConfigId)
            : null;
        if (!checkpoints?.length) {
            const emptyMsg = scopeLabel
                ? `No checkpoints for ${scopeLabel} yet.`
                : 'No checkpoints yet. Create one before major changes.';
            this.checkpointsListEl.innerHTML = `<div class="config-editor-checkpoints-empty">${configEditorEscapeHtml(emptyMsg)}</div>`;
            return;
        }
        this.checkpointsListEl.innerHTML = checkpoints.map((cp) => {
            const label = cp.label
                ? configEditorEscapeHtml(cp.label)
                : `<span class="config-editor-checkpoints-auto">${configEditorEscapeHtml(cp.reason || (cp.kind === 'config-file' ? 'auto-save' : 'manual'))}</span>`;
            const absoluteTime = this.formatCheckpointTimestamp(cp.createdAt);
            const relativeTime = this.formatCheckpointRelativeTime(cp.createdAt);
            const meta = `<span title="${configEditorEscapeHtml(absoluteTime)}">${configEditorEscapeHtml(relativeTime)}</span> · ${configEditorEscapeHtml(cp.scopeSummary || '')} · ${this.formatBytes(cp.totalSizeBytes || 0)}`;
            const deleteBtn = cp.kind === 'config-file' ? '' : `
                    <button type="button" class="btn-danger btn-small config-editor-cp-delete" data-id="${configEditorEscapeHtml(cp.id)}" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>`;
            const detailBtn = cp.kind === 'config-file' ? '' : `
                    <button type="button" class="btn-secondary btn-small config-editor-cp-detail" data-id="${configEditorEscapeHtml(cp.id)}" title="Details">
                        <i class="fas fa-circle-info"></i>
                    </button>`;
            return `<div class="config-editor-checkpoint-row" data-checkpoint-id="${configEditorEscapeHtml(cp.id)}">
                <div class="config-editor-checkpoint-main">
                    <div class="config-editor-checkpoint-label">${label}</div>
                    <div class="config-editor-checkpoint-meta">${meta}</div>
                </div>
                <div class="config-editor-checkpoint-actions">
                    <button type="button" class="btn-secondary btn-small config-editor-cp-restore" data-id="${configEditorEscapeHtml(cp.id)}" title="Restore">
                        <i class="fas fa-rotate-left"></i>
                    </button>${detailBtn}${deleteBtn}
                </div>
            </div>`;
        }).join('');

        this.checkpointsListEl.querySelectorAll('.config-editor-cp-restore').forEach((btn) => {
            btn.addEventListener('click', () => this.requestRestoreCheckpoint(btn.dataset.id));
        });
        this.checkpointsListEl.querySelectorAll('.config-editor-cp-detail').forEach((btn) => {
            btn.addEventListener('click', () => this.showCheckpointDetail(btn.dataset.id));
        });
        this.checkpointsListEl.querySelectorAll('.config-editor-cp-delete').forEach((btn) => {
            btn.addEventListener('click', () => this.requestDeleteCheckpoint(btn.dataset.id));
        });
    }

    async loadCheckpointsList() {
        if (!this.checkpointsListEl) return;
        this.checkpointsListEl.innerHTML = '<div class="config-editor-checkpoints-loading">Loading checkpoints…</div>';
        this.setCheckpointsStatus('');
        try {
            const payload = this.checkpointsScopeConfigId
                ? { configId: this.checkpointsScopeConfigId }
                : {};
            const data = await window.wsClient.sendMessage('config_editor_checkpoints_list', payload, false);
            this.checkpointsCache = data?.checkpoints || [];
            this.renderCheckpointsList(this.checkpointsCache);
            if (this.checkpointsScopeConfigId) {
                const cfgLabel = this.configList.find((c) => c.id === this.checkpointsScopeConfigId)?.label
                    || this.checkpointsScopeConfigId;
                this.setCheckpointsStatus(`${this.checkpointsCache.length} checkpoint${this.checkpointsCache.length === 1 ? '' : 's'} for ${cfgLabel}`);
            }
        } catch (err) {
            console.error('config_editor_checkpoints_list:', err);
            this.checkpointsListEl.innerHTML = '<div class="config-editor-checkpoints-empty config-editor-error">Failed to load checkpoints</div>';
        }
    }

    async showCheckpointDetail(checkpointId) {
        try {
            const data = await window.wsClient.sendMessage('config_editor_checkpoints_get', { checkpointId }, false);
            const jsonRows = Object.entries(data?.resources?.json || {}).map(([k, v]) =>
                `<tr><td>${configEditorEscapeHtml(k)}</td><td>${configEditorEscapeHtml(v.filename || '')}</td><td>${this.formatBytes(v.sizeBytes)}</td><td>${v.exists ? 'OK' : 'Missing'}</td></tr>`
            ).join('');
            const dbRows = Object.entries(data?.resources?.database || {}).map(([k, v]) =>
                `<tr><td>${configEditorEscapeHtml(k)}</td><td>${configEditorEscapeHtml(v.filename || '')}</td><td>${this.formatBytes(v.sizeBytes)}</td><td>${v.exists ? 'OK' : 'Missing'}</td></tr>`
            ).join('');
            const html = `<p><strong>${configEditorEscapeHtml(data.label || data.reason || checkpointId)}</strong></p>
                <p>${configEditorEscapeHtml(this.formatCheckpointTimestamp(data.createdAt))} · ${this.formatBytes(data.totalSizeBytes)}</p>
                <div class="config-editor-summary-table-wrap form-section-scroll">
                <table class="config-editor-summary-table">
                <thead><tr><th>Config</th><th>File</th><th>Size</th><th>Status</th></tr></thead>
                <tbody>${jsonRows || '<tr><td colspan="4">No config files</td></tr>'}</tbody></table></div>
                <div class="config-editor-summary-table-wrap form-section-scroll">
                <table class="config-editor-summary-table">
                <thead><tr><th>Database</th><th>File</th><th>Size</th><th>Status</th></tr></thead>
                <tbody>${dbRows || '<tr><td colspan="4">No databases</td></tr>'}</tbody></table></div>`;
            await showConfirmationDialog(html, [
                { text: 'Close', value: true, className: 'btn-secondary' }
            ], null, { title: 'Checkpoint details' });
        } catch (err) {
            console.error('config_editor_checkpoints_get:', err);
            this.setCheckpointsStatus('Failed to load checkpoint details');
        }
    }

    async requestCreateCheckpoint() {
        // showInputDialog: public/scripts/comp/confirmationDialog.js
        let label = '';
        if (typeof showInputDialog === 'function') {
            label = await showInputDialog(
                'Optional label for this checkpoint:',
                '',
                'e.g. Before API key rotation',
                null,
                null,
                { title: 'Create checkpoint' }
            );
            if (label === null) return;
        }

        this.setCheckpointsStatus('Creating checkpoint…');
        try {
            const data = await window.wsClient.sendMessage('config_editor_checkpoints_create', { label: label || '' }, false);
            if (data?.success) {
                this.setCheckpointsStatus('Checkpoint created');
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', 'Checkpoints', 'Snapshot created');
                }
                await this.loadCheckpointsList();
            } else {
                this.setCheckpointsStatus('Create failed');
            }
        } catch (err) {
            console.error('config_editor_checkpoints_create:', err);
            this.setCheckpointsStatus('Create failed');
        }
    }

    async requestRestoreCheckpoint(checkpointId) {
        const cp = this.checkpointsCache.find((c) => c.id === checkpointId);
        const label = cp?.label || cp?.reason || checkpointId?.slice(0, 8) || 'checkpoint';
        const html = `<p>Restore <strong>${configEditorEscapeHtml(label)}</strong>?</p>
            <p>This replaces live config files and databases with the snapshot state. A pre-restore safety checkpoint will be created first.</p>
            <p class="config-editor-restart-note"><i class="fas fa-triangle-exclamation"></i> Destructive — running sessions may see stale data until refresh.</p>`;
        const result = await showConfirmationDialog(html, [
            { text: 'Restore', value: 'restore', className: 'btn-danger', icon: 'fas fa-rotate-left' },
            { text: 'Cancel', value: null, className: 'btn-secondary' }
        ], null, { title: 'Restore checkpoint' });
        if (result !== 'restore') return;

        this.setCheckpointsStatus('Restoring…');
        await this.runEditorAction(async () => {
            try {
                const data = await window.wsClient.sendMessage('config_editor_checkpoints_restore', {
                    checkpointId,
                    createSafetyCheckpoint: true
                }, false);
                if (data?.success) {
                    this.pendingEdits.clear();
                    this.nodeCache.clear();
                    this.setCheckpointsStatus('Restored');
                    if (typeof showGlassToast === 'function') {
                        showGlassToast('success', 'Checkpoints', 'Config and databases restored');
                    }
                    await this.loadCheckpointsList();
                    if (this.selectedConfigId) {
                        await this.refreshTreePreservingExpansion();
                    }
                    this.setStatus('Restored from checkpoint — reload settings if needed');
                } else {
                    this.setCheckpointsStatus('Restore failed');
                }
            } catch (err) {
                console.error('config_editor_checkpoints_restore:', err);
                this.setCheckpointsStatus('Restore failed');
                if (typeof showGlassToast === 'function') {
                    showGlassToast('error', 'Checkpoints', err.message || 'Restore failed');
                }
            }
        });
    }

    async requestDeleteCheckpoint(checkpointId) {
        const cp = this.checkpointsCache.find((c) => c.id === checkpointId);
        const label = cp?.label || cp?.reason || checkpointId?.slice(0, 8) || 'checkpoint';
        const result = await showConfirmationDialog(
            `Delete checkpoint <strong>${configEditorEscapeHtml(label)}</strong>? Snapshot files will be removed when not referenced by other bundles.`,
            [
                { text: 'Delete', value: 'delete', className: 'btn-danger', icon: 'fas fa-trash' },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ],
            null,
            { title: 'Delete checkpoint' }
        );
        if (result !== 'delete') return;

        this.setCheckpointsStatus('Deleting…');
        try {
            await window.wsClient.sendMessage('config_editor_checkpoints_delete', { checkpointId }, false);
            this.setCheckpointsStatus('Deleted');
            await this.loadCheckpointsList();
        } catch (err) {
            console.error('config_editor_checkpoints_delete:', err);
            this.setCheckpointsStatus('Delete failed');
        }
    }

    doClose() {
        this.clearSession();
        if (this.modal) closeModal(this.modal);
    }
}

const configEditorApplet = new ConfigEditorApplet();
configEditorApplet.init();
window.configEditorApplet = configEditorApplet;
