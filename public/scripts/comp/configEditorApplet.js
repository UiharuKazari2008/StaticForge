/**
 * Config Editor applet — registry-style config browser (WebSocket only).
 * public/scripts/comp/modalUtils.js (openModal, closeModal)
 * public/scripts/comp/confirmationDialog.js (showConfirmationDialog)
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

function configEditorPathsEqual(a, b) {
    const pa = a || [];
    const pb = b || [];
    if (pa.length !== pb.length) return false;
    return pa.every((seg, i) => String(seg) === String(pb[i]));
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
    }

    init() {
        this.modal = document.getElementById('configEditorModal');
        if (!this.modal) return;

        this.valueModal = document.getElementById('configEditorValueModal');
        this.treePanel = this.modal.querySelector('.config-editor-tree-panel');
        this.valuesPanel = this.modal.querySelector('.config-editor-values-panel');
        this.treeEl = document.getElementById('configEditorTree');
        this.valuesEl = document.getElementById('configEditorValuesBody');
        this.statusEl = document.getElementById('configEditorStatus');

        const closeBtn = document.getElementById('closeConfigEditorBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.requestClose());
        }

        const saveBtn = document.getElementById('configEditorSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.requestSave());
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
        const valueBoolToggle = document.getElementById('configEditorValueBoolToggle');
        if (valueBoolToggle) {
            valueBoolToggle.addEventListener('click', () => {
                const on = valueBoolToggle.getAttribute('data-state') !== 'on';
                valueBoolToggle.setAttribute('data-state', on ? 'on' : 'off');
                valueBoolToggle.textContent = on ? 'true' : 'false';
            });
        }

        this.setupContextMenus();
    }

    setupContextMenus() {
        if (!contextMenu) return;
        const applet = this;

        const panelItems = () => [
            { text: 'Add entry…', icon: 'fas fa-plus', action: 'add',
                disabled: () => !applet.selectedConfigId
                    || !applet.canAddAtPath(applet.selectedConfigId, applet.selectedPath) },
            { text: 'Revert all here', icon: 'fas fa-undo', action: 'revert-all',
                disabled: () => !applet.selectedConfigId
                    || !applet.hasPendingUnder(applet.selectedConfigId, applet.selectedPath) }
        ];

        const itemMenuConfig = (getCtx) => ({
            sections: [{
                type: 'list',
                items: [
                    { text: 'Open', icon: 'fas fa-folder-open', action: 'open',
                        hidden: () => !getCtx().expandable },
                    { text: 'Edit value', icon: 'fas fa-pen', action: 'edit',
                        hidden: () => getCtx().expandable },
                    { text: 'Add entry…', icon: 'fas fa-plus', action: 'add',
                        hidden: () => !applet.canAddAtPath(getCtx().configId, getCtx().containerPath) },
                    { text: 'Delete', icon: 'fas fa-trash', action: 'delete',
                        hidden: () => !applet.canDeletePath(getCtx().path) },
                    { separator: true },
                    { text: 'Revert', icon: 'fas fa-undo', action: 'revert',
                        disabled: () => !applet.hasPendingAt(getCtx().configId, getCtx().path) }
                ]
            }],
            onAction: (action) => applet.handleContextAction(action, getCtx())
        });

        this._treeItemMenuFactory = (el) => itemMenuConfig(() => el._configEditorCtx);
        this._valueRowMenuFactory = (el) => itemMenuConfig(() => el._configEditorCtx);

        if (this.treePanel) {
            contextMenu.attachToElement(this.treePanel, {
                sections: [{ type: 'list', items: panelItems() }],
                onAction: (action) => applet.handleContextAction(action, {
                    configId: applet.selectedConfigId,
                    path: applet.selectedPath.slice(),
                    containerPath: applet.selectedPath.slice(),
                    expandable: applet.isContainerPath(applet.selectedConfigId, applet.selectedPath)
                })
            });
        }
        if (this.valuesPanel) {
            contextMenu.attachToElement(this.valuesPanel, {
                sections: [{ type: 'list', items: panelItems() }],
                onAction: (action) => applet.handleContextAction(action, {
                    configId: applet.selectedConfigId,
                    path: applet.selectedPath.slice(),
                    containerPath: applet.selectedPath.slice(),
                    expandable: applet.isContainerPath(applet.selectedConfigId, applet.selectedPath)
                })
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

    canAddAtPath(configId, containerPath) {
        return this.isContainerPath(configId, containerPath);
    }

    canDeletePath(path) {
        return Array.isArray(path) && path.length > 0;
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
                    children.push({
                        key: String(key),
                        path: edit.path.slice(),
                        type: Array.isArray(val) ? 'array' : expandable ? 'object' : typeof val,
                        label: key,
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

    async promptAddEntry(configId, containerPath) {
        if (!this.canAddAtPath(configId, containerPath)) return;
        const parentData = await this.fetchNode(configId, containerPath, true);
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

        const defaultVal = this.defaultValueForType('string');
        this.setPendingEdit(configId, newPath, {
            path: newPath.slice(),
            value: defaultVal,
            deleted: false,
            isNew: true,
            previousValue: undefined,
            restartRequired: false,
            secret: false,
            label: key
        });
        this.invalidateCacheFrom(configId, containerPath);
        await this.selectNode(configId, containerPath);
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

    async handleContextAction(action, ctx) {
        if (!ctx?.configId) return;
        const { configId } = ctx;
        const path = ctx.path ? ctx.path.slice() : [];
        const containerPath = ctx.containerPath ? ctx.containerPath.slice() : path.slice();

        switch (action) {
            case 'open':
                if (ctx.expandable) await this.navigateToPath(configId, path);
                break;
            case 'edit':
                if (ctx.child) this.openValueEditor(configId, ctx.child);
                break;
            case 'add':
                await this.promptAddEntry(configId, containerPath);
                break;
            case 'delete':
                if (!this.canDeletePath(path)) break;
                this.markDeleted(configId, path);
                break;
            case 'revert':
                this.revertPending(configId, path);
                if (configEditorPathsEqual(path, this.selectedPath) && this.selectedConfigId === configId) {
                    await this.loadAndRenderValues(configId, this.selectedPath);
                }
                break;
            case 'revert-all':
                this.revertPendingUnder(configId, containerPath);
                if (this.selectedConfigId === configId) {
                    await this.loadAndRenderValues(configId, this.selectedPath);
                }
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
        if (this.treePanel) window.customScrollbar.forceReinit(this.treePanel);
        if (this.valuesPanel) window.customScrollbar.forceReinit(this.valuesPanel);
        const valueBody = this.valueModal?.querySelector('.config-editor-value-modal-body');
        if (valueBody) window.customScrollbar.forceReinit(valueBody);
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
        this.selectedConfigId = null;
        this.selectedPath = [];
        this.nodeCache.clear();
        this.pendingEdits.clear();
        this.expandedKeys.clear();
        this.editTarget = null;
        if (this.treeEl) this.treeEl.innerHTML = '';
        if (this.valuesEl) this.valuesEl.innerHTML = '';
    }

    formatValueDisplay(val, secretOrStub) {
        const secret = typeof secretOrStub === 'object'
            ? configEditorIsSecret(secretOrStub)
            : !!secretOrStub;
        if (secret) return CONFIG_EDITOR_SECRET_MASK;
        if (val === null) return 'null';
        if (val === undefined) return '—';
        const s = configEditorFormatDisplayValue(val);
        if (s.length > 120) return s.slice(0, 117) + '…';
        return s;
    }

    setStatus(text) {
        if (this.statusEl) this.statusEl.textContent = text;
    }

    getPendingCount() {
        let n = 0;
        this.pendingEdits.forEach((m) => { n += m.size; });
        return n;
    }

    renderConfigRoots() {
        if (!this.treeEl) return;
        this.treeEl.innerHTML = '';
        for (const cfg of this.configList) {
            const row = document.createElement('div');
            row.className = 'config-editor-tree-item config-editor-tree-root';
            row.dataset.configId = cfg.id;
            row.dataset.path = '';
            row.innerHTML = `
                <button type="button" class="config-editor-tree-expand btn-secondary btn-small" title="Expand" aria-label="Expand">
                    <i class="fas fa-chevron-right"></i>
                </button>
                <button type="button" class="config-editor-tree-label">
                    <i class="fas fa-database"></i>
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
            if (this.treePanel) window.customScrollbar?.forceReinit(this.treePanel);
        }, 0);
    }

    async selectNode(configId, path) {
        this.selectedConfigId = configId;
        this.selectedPath = path.slice();
        this.highlightTreeSelection();
        this.setStatus(`${configId} → ${configEditorPathLabel(path)}`);
        await this.loadAndRenderValues(configId, path);
    }

    highlightTreeSelection() {
        if (!this.treeEl) return;
        const key = configEditorPathKey(this.selectedConfigId, this.selectedPath);
        this.treeEl.querySelectorAll('.config-editor-tree-item').forEach((el) => {
            const elKey = configEditorPathKey(el.dataset.configId, (el.dataset.path || '').split('\0').filter(Boolean));
            el.classList.toggle('selected', elKey === key);
        });
    }

    async fetchNode(configId, path, force) {
        const cacheKey = configEditorPathKey(configId, path);
        if (!force && this.nodeCache.has(cacheKey)) {
            return this.nodeCache.get(cacheKey);
        }
        const data = await window.wsClient.sendMessage('config_editor_get_node', {
            configId,
            path
        }, false);
        this.nodeCache.set(cacheKey, data);
        return data;
    }

    async loadAndRenderValues(configId, path) {
        if (!this.valuesEl) return;
        this.valuesEl.innerHTML = '<div class="config-editor-loading">Loading…</div>';
        try {
            const data = await this.fetchNode(configId, path);
            this.renderValuesPanel(data);
        } catch (err) {
            console.error('config_editor_get_node:', err);
            this.valuesEl.innerHTML = '<div class="config-editor-error">Failed to load values</div>';
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
            this.valuesEl.innerHTML = '<div class="config-editor-empty">No child values at this path</div>';
            return;
        }

        const frag = document.createDocumentFragment();
        for (const child of children) {
            const row = document.createElement('tr');
            row.className = 'config-editor-row';
            const pending = this.getPendingEdit(configId, child.path);
            if (pending || child.isPendingNew) row.classList.add('dirty');

            const effectiveVal = this.getEffectiveValue(configId, child.path, child.value);
            const name = child.label || child.key;
            const typeStr = child.type || 'auto';
            const isSecret = configEditorIsSecret(child);

            let valueCell = '';
            if (child.expandable) {
                valueCell = `<button type="button" class="btn-secondary btn-small config-editor-open-btn" data-config-id="${configEditorEscapeHtml(configId)}" data-path="${encodeURIComponent(JSON.stringify(child.path))}">
                    <i class="fas fa-folder-open"></i> Open
                </button>`;
            } else {
                const display = configEditorEscapeHtml(this.formatValueDisplay(effectiveVal, child));
                valueCell = `<div class="config-editor-value-cell">
                    <span class="config-editor-value-display" title="${display}">${display}</span>
                    <button type="button" class="btn-secondary btn-small config-editor-edit-btn"
                        data-config-id="${configEditorEscapeHtml(configId)}"
                        data-path="${encodeURIComponent(JSON.stringify(child.path))}" title="Edit value">
                        <i class="fas fa-pen"></i> Edit
                    </button>
                </div>`;
            }

            row.innerHTML = `
                <td class="config-editor-col-name">${configEditorEscapeHtml(name)}</td>
                <td class="config-editor-col-type">${configEditorEscapeHtml(typeStr)}</td>
                <td class="config-editor-col-value">${valueCell}</td>
            `;
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
            if (this.valuesPanel) window.customScrollbar?.forceReinit(this.valuesPanel);
        }, 0);
    }

    wireValuePanelEvents(configId) {
        this.valuesEl.querySelectorAll('.config-editor-open-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const path = JSON.parse(decodeURIComponent(btn.dataset.path));
                this.navigateToPath(configId, path);
            });
        });

        this.valuesEl.querySelectorAll('.config-editor-edit-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const path = JSON.parse(decodeURIComponent(btn.dataset.path));
                const parentKey = configEditorPathKey(configId, this.selectedPath);
                const parentData = this.nodeCache.get(parentKey);
                if (!parentData) return;
                const merged = this.mergeChildrenWithPending(configId, parentData);
                const child = merged.find(
                    (c) => configEditorPathKey(configId, c.path) === configEditorPathKey(configId, path)
                );
                if (child) this.openValueEditor(configId, child);
            });
        });

        this.valuesEl.querySelectorAll('tr.config-editor-row').forEach((row) => {
            const editBtn = row.querySelector('.config-editor-edit-btn');
            if (!editBtn) return;
            row.addEventListener('dblclick', () => editBtn.click());
        });
    }

    hideAllValueEditorFields() {
        const ids = [
            'configEditorValueInput',
            'configEditorValueNumber',
            'configEditorValueSecret',
            'configEditorValueTextarea',
            'configEditorValueBoolToggle',
            'configEditorValueEnumDropdown'
        ];
        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    }

    openValueEditor(configId, child) {
        if (!this.valueModal || child.expandable) return;

        this.editTarget = { configId, child: { ...child } };
        const effectiveVal = this.getEffectiveValue(configId, child.path, child.value);
        const pathLabel = configEditorPathLabel(child.path);
        const titleEl = document.getElementById('configEditorValueModalTitle');
        const pathEl = document.getElementById('configEditorValuePath');
        const typeEl = document.getElementById('configEditorValueType');

        if (titleEl) titleEl.textContent = child.label || child.key || 'Edit Value';
        if (pathEl) pathEl.textContent = `${configId} → ${pathLabel}`;
        if (typeEl) typeEl.value = child.type || 'auto';

        this.hideAllValueEditorFields();

        const useTextarea = child.type === 'string'
            && typeof effectiveVal === 'string'
            && (effectiveVal.length > 80 || effectiveVal.includes('\n'));

        if (configEditorIsSecret(child)) {
            const el = document.getElementById('configEditorValueSecret');
            el.classList.remove('hidden');
            el.value = '';
            el.placeholder = 'Enter new value (leave empty to keep unchanged)';
            el.focus();
        } else if (child.type === 'boolean') {
            const btn = document.getElementById('configEditorValueBoolToggle');
            btn.classList.remove('hidden');
            const on = effectiveVal === true || effectiveVal === 'true';
            btn.setAttribute('data-state', on ? 'on' : 'off');
            btn.textContent = on ? 'true' : 'false';
        } else if (child.type === 'number') {
            const el = document.getElementById('configEditorValueNumber');
            el.classList.remove('hidden');
            el.value = effectiveVal != null && effectiveVal !== '' ? String(effectiveVal) : '';
            el.focus();
        } else if (child.enum?.length) {
            const wrap = document.getElementById('configEditorValueEnumDropdown');
            wrap?.classList.remove('hidden');
            this.setEnumEditorValue(child.enum, effectiveVal);
        } else if (useTextarea) {
            const el = document.getElementById('configEditorValueTextarea');
            el.classList.remove('hidden');
            el.value = effectiveVal != null ? String(effectiveVal) : '';
            el.focus();
        } else {
            const el = document.getElementById('configEditorValueInput');
            el.classList.remove('hidden');
            el.value = effectiveVal != null ? configEditorFormatDisplayValue(effectiveVal) : '';
            el.focus();
        }

        openModal(this.valueModal);
        setTimeout(() => this.reinitScrollbars(), 80);
    }

    setEnumEditorValue(enumValues, effectiveVal) {
        const container = document.getElementById('configEditorValueEnumDropdown');
        const btn = document.getElementById('configEditorValueEnumBtn');
        const menu = document.getElementById('configEditorValueEnumMenu');
        const selectedEl = document.getElementById('configEditorValueEnumSelected');
        const hidden = document.getElementById('configEditorValueEnumHidden');
        if (!container || !btn || !menu || !selectedEl || !hidden) return;

        const value = effectiveVal != null ? String(effectiveVal) : String(enumValues[0] ?? '');
        hidden.value = value;
        selectedEl.textContent = value;

        if (container.dataset.wired === '1') return;
        container.dataset.wired = '1';

        const renderEnumMenu = (selectedVal) => {
            const currentChild = this.editTarget?.child;
            const values = currentChild?.enum?.length ? currentChild.enum : enumValues;
            const items = values.map((v) => ({ value: String(v), name: String(v) }));
            // renderSimpleDropdown: public/scripts/comp/manualDropdownManager.js
            renderSimpleDropdown(
                menu,
                items,
                'value',
                'name',
                (picked) => {
                    hidden.value = String(picked);
                    selectedEl.textContent = String(picked);
                },
                () => closeDropdown(menu, btn), // closeDropdown: public/scripts/comp/dropdown.js
                String(selectedVal || hidden.value),
                { preventFocusTransfer: true }
            );
        };

        // setupDropdown: public/scripts/comp/dropdown.js
        setupDropdown(container, btn, menu, renderEnumMenu, () => hidden.value, { preventFocusTransfer: true });
    }

    readValueFromEditor() {
        const child = this.editTarget?.child;
        if (!child) return undefined;

        if (configEditorIsSecret(child)) {
            const el = document.getElementById('configEditorValueSecret');
            return (el?.value ?? '').trim();
        }
        if (child.type === 'boolean') {
            const btn = document.getElementById('configEditorValueBoolToggle');
            return btn?.getAttribute('data-state') === 'on';
        }
        if (child.type === 'number') {
            const el = document.getElementById('configEditorValueNumber');
            if (!el || el.value === '') return '';
            return Number(el.value);
        }
        const ta = document.getElementById('configEditorValueTextarea');
        if (ta && !ta.classList.contains('hidden')) {
            return ta.value;
        }
        const enumWrap = document.getElementById('configEditorValueEnumDropdown');
        if (enumWrap && !enumWrap.classList.contains('hidden')) {
            return document.getElementById('configEditorValueEnumHidden')?.value ?? '';
        }
        const el = document.getElementById('configEditorValueInput');
        return el?.value ?? '';
    }

    applyValueFromEditor() {
        if (!this.editTarget) return;
        const { configId, child } = this.editTarget;
        let val = this.readValueFromEditor();
        if (configEditorIsSecret(child)) {
            if (!val) {
                this.closeValueEditor();
                return;
            }
        }
        this.recordValueChange(configId, child.path, val, null);
        this.closeValueEditor();
        if (this.selectedConfigId === configId) {
            const parentKey = configEditorPathKey(configId, this.selectedPath);
            const data = this.nodeCache.get(parentKey);
            if (data) this.renderValuesPanel(data);
        }
    }

    closeValueEditor() {
        this.editTarget = null;
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

        this.setPendingEdit(configId, path, {
            path: path.slice(),
            value,
            deleted: false,
            previousValue,
            restartRequired: !!stub?.restartRequired,
            secret: configEditorIsSecret(stub || { path, key: path[path.length - 1] }),
            label: path[path.length - 1]
        });
        if (rowEl) rowEl.classList.add('dirty');
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
            const children = data?.children || [];
            for (const child of children) {
                if (!child.expandable) continue;
                const childPath = child.path;
                const item = document.createElement('div');
                item.className = 'config-editor-tree-item';
                item.dataset.configId = configId;
                item.dataset.path = childPath.join('\0');
                item.style.paddingLeft = `${12 + childPath.length * 12}px`;
                item.innerHTML = `
                    <button type="button" class="config-editor-tree-expand btn-secondary btn-small" title="Expand">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                    <button type="button" class="config-editor-tree-label">
                        <i class="fas fa-folder"></i>
                        <span>${configEditorEscapeHtml(child.label || child.key)}</span>
                    </button>
                `;
                const expandBtn = item.querySelector('.config-editor-tree-expand');
                const labelBtn = item.querySelector('.config-editor-tree-label');
                expandBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleTreeExpand(configId, childPath, item);
                });
                labelBtn.addEventListener('click', () => {
                    this.selectNode(configId, childPath);
                });
                this.attachRowContextMenu(item, {
                    kind: 'tree',
                    configId,
                    path: childPath.slice(),
                    containerPath: childPath.slice(),
                    expandable: true
                });
                container.appendChild(item);
            }
        } catch (err) {
            console.error('Tree expand:', err);
        }
        setTimeout(() => {
            if (this.treePanel) window.customScrollbar?.forceReinit(this.treePanel);
        }, 0);
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
        let anyRestart = false;
        this.pendingEdits.forEach((map, configId) => {
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
        let html = `<p>Apply <strong>${rows.length}</strong> change${rows.length === 1 ? '' : 's'}?</p>
            <div class="config-editor-summary-table-wrap form-section-scroll">
            <table class="config-editor-summary-table">
            <thead><tr><th>Config</th><th>Path</th><th>Action</th><th>Change</th></tr></thead>
            <tbody>${rows.join('')}</tbody></table></div>`;
        if (anyRestart) {
            html += '<p class="config-editor-restart-note"><i class="fas fa-arrows-rotate"></i> Server will restart after save.</p>';
        }
        return html;
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
        ], null, { title: 'Save configuration changes' });

        if (result !== 'save') return;

        this.setStatus('Saving…');
        try {
            const patches = this.buildPatchesPayload();
            const data = await window.wsClient.sendMessage('config_editor_save', { patches }, false);
            if (!data?.success) {
                const errMsg = data?.errors?.map((e) => e.message || e).join('; ') || 'Save failed';
                this.setStatus(errMsg);
                if (typeof showGlassToast === 'function') {
                    showGlassToast('error', 'Config Editor', errMsg);
                }
                return;
            }
            this.pendingEdits.clear();
            this.nodeCache.clear();
            this.expandedKeys.clear();
            if (data.restarting) {
                this.setStatus('Restarting server…');
                if (typeof showGlassToast === 'function') {
                    showGlassToast('info', 'Config Editor', 'Server is restarting…');
                }
            } else {
                this.setStatus('Saved');
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', 'Config Editor', 'Configuration saved');
                }
                if (this.selectedConfigId) {
                    await this.loadAndRenderValues(this.selectedConfigId, this.selectedPath);
                }
            }
        } catch (err) {
            console.error('config_editor_save:', err);
            this.setStatus('Save failed');
        }
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

    doClose() {
        this.clearSession();
        if (this.modal) closeModal(this.modal);
    }
}

const configEditorApplet = new ConfigEditorApplet();
configEditorApplet.init();
window.configEditorApplet = configEditorApplet;
