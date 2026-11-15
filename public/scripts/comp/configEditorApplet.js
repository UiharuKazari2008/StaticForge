/**
 * Runes: Vista's Registry Editor (regedit.exe) 1:1 over Dreamscape's JSON configs (WebSocket only,
 * config_editor_* packets in modules/ws/handlers/20-configEditorHandler.js). Yozora #831.
 *
 * The window (app.html #configEditorModal, config-editor.css) is regedit's: the menu bar
 * (regedit.exe.mui MENU 103), Computer and the five hives in the tree, Name / Type / Data in the
 * list, the key's path in the status bar. How the configs map onto the registry:
 *
 *   a config        a key under a hive (HIVES below; an unknown config goes under HKEY_LOCAL_MACHINE)
 *   an object       a key (subkeys in the tree, sorted as the registry sorts them)
 *   a list          a key whose subkeys / values are named 0, 1, 2 ...; a list of strings is a
 *                   REG_MULTI_SZ value, a list of bytes (0-255) a REG_BINARY value
 *   a string        REG_SZ (a fraction, a number regedit has no type for, reads as REG_SZ too)
 *   a whole number  REG_DWORD, or REG_QWORD when it does not fit 32 bits
 *   true / false    REG_DWORD 1 / 0
 *   null            REG_BINARY (zero-length binary value)
 *
 * Every change is written at once, as regedit writes (the server keeps an automatic checkpoint of
 * each config file it saves); a value whose change restarts the server asks first. Secrets stay
 * masked (eight bullets) until their own Edit String reveals the one value. Checkpoints (File >
 * Checkpoints...) is the snapshot window; Export / Import write and read .reg text in the VFS.
 *
 * public/scripts/comp/modalUtils.js (openModal, closeModal)
 * public/scripts/comp/confirmationDialog.js (showConfirmationDialog: Vista's message box)
 * public/scripts/comp/contextMenu.js (attachClickMenuToElement, attachToElement)
 * public/scripts/comp/vistaDialogTemplate.js (openDialog: regedit.exe.mui dialogs)
 */

const CONFIG_EDITOR_SECRET_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

/** The five hives, regedit's order, and the configs each holds. */
const CONFIG_EDITOR_HIVES = [
    { id: 'HKEY_CLASSES_ROOT', configs: ['promptConfig', 'naxGeneration'] },
    { id: 'HKEY_CURRENT_USER', configs: ['directorConfig', 'favorites', 'workspaces'] },
    { id: 'HKEY_LOCAL_MACHINE', configs: ['config', 'secureConfig'] },
    { id: 'HKEY_USERS', configs: [] },
    { id: 'HKEY_CURRENT_CONFIG', configs: ['workspaceDesktop'] }
];

/** regedit.exe.mui's status bar help for each menu and command (strings 512-1281). */
const CONFIG_EDITOR_MENU_HELP = {
    file: 'Contains commands for working with the whole registry.',
    edit: 'Contains commands for editing values or keys.',
    view: 'Contains commands for customizing the registry window.',
    favorites: 'Contains commands for accessing frequently used keys.',
    help: 'Contains commands for displaying Help for and information about Registry Editor.',
    new: 'Contains commands for creating new keys or values.',
    refresh: 'Refreshes the window.',
    connect: 'Connects to a remote computer\'s registry.',
    import: 'Imports a file into the registry.',
    export: 'Exports all or part of the registry to a file.',
    print: 'Prints all or part of the registry.',
    exit: 'Quits the Registry Editor.',
    find: 'Finds a text string in a key, value, or data.',
    'new-key': 'Adds a new key.',
    'new-string': 'Adds a new string value.',
    'new-binary': 'Adds a new binary value.',
    about: 'Displays program information, version number, and copyright.',
    'status-bar': 'Shows or hides the status bar.',
    split: 'Changes position of split between two panes.',
    'find-next': 'Finds the next occurrence of text specified in previous search.',
    'help-topics': 'Opens Registry Editor Help.',
    'new-dword': 'Adds a new 32 bit value.',
    'copy-key': 'Copies the name of the selected key to the Clipboard.',
    'new-multi': 'Adds a new multi-string value.',
    'new-expand': 'Adds a new expandable string value.',
    permissions: 'Displays the permissions for a key.',
    'display-binary': 'Displays a value\'s data in binary form.',
    'load-hive': 'Loads a hive file to the registry.',
    'unload-hive': 'Unloads a hive from the registry.',
    'new-qword': 'Adds a new 64 bit value.',
    disconnect: 'Disconnects from a remote computer\'s registry.',
    modify: 'Modifies the value\'s data.',
    delete: 'Deletes the selection.',
    rename: 'Renames the selection.',
    expand: 'Expands or collapses the branch.',
    'modify-binary': 'Edit the value\'s data in binary form.',
    'fav-remove': 'Removes keys from the Favorites list.',
    'fav-add': 'Adds keys to the Favorites list.',
    checkpoints: 'Creates and restores checkpoints of the configuration.'
};

const CONFIG_EDITOR_TYPE_ICON = {
    REG_SZ: 'string', REG_EXPAND_SZ: 'string', REG_MULTI_SZ: 'string',
    REG_DWORD: 'binary', REG_QWORD: 'binary', REG_BINARY: 'binary'
};

function configEditorEscapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function configEditorIsSecret(stub, configId) {
    if (!stub) return false;
    if (stub.secret === false) return false;
    if (stub.secret) return true;
    const id = configId || stub.configId;
    if (id === 'secureConfig' && stub.path?.length) return true;
    const key = stub.path?.length ? stub.path[stub.path.length - 1] : stub.key;
    return /^(apiKey|api_key|password|secret|token|sessionSecret|loginKey|loginPin|devLoginKey|readOnlyPin)$/i.test(String(key || ''));
}

function configEditorPathsEqual(a, b) {
    const pa = a || [];
    const pb = b || [];
    return pa.length === pb.length && pa.every((seg, i) => String(seg) === String(pb[i]));
}

/** The registry's order: subkeys and values by name, case-insensitive (a list's by index). */
function configEditorCompareNames(a, b) {
    const na = /^\d+$/.test(a) ? Number(a) : NaN;
    const nb = /^\d+$/.test(b) ? Number(b) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    const ua = String(a).toUpperCase();
    const ub = String(b).toUpperCase();
    return ua < ub ? -1 : ua > ub ? 1 : 0;
}

function configEditorIsByteList(v) {
    return Array.isArray(v) && v.length > 0 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}

function configEditorIsStringList(v) {
    return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

/** The registry type a JSON value shows as (null when it is a key). */
function configEditorRegTypeOf(value) {
    if (value === null || value === undefined) return 'REG_BINARY';
    if (Array.isArray(value)) {
        if (configEditorIsStringList(value)) return 'REG_MULTI_SZ';
        if (configEditorIsByteList(value)) return 'REG_BINARY';
        return null;
    }
    if (typeof value === 'object') return null;
    if (typeof value === 'boolean') return 'REG_DWORD';
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) return 'REG_SZ';
        return value >= -0x80000000 && value <= 0xffffffff ? 'REG_DWORD' : 'REG_QWORD';
    }
    return 'REG_SZ';
}

function configEditorHex(n, width) {
    return n.toString(16).padStart(width, '0');
}

/** The Data column, as regedit writes it (strings 22, 27, 29, 32). */
function configEditorRegData(regType, value, secret) {
    if (secret && value != null && typeof value !== 'object') return CONFIG_EDITOR_SECRET_MASK;
    if (regType === 'REG_DWORD') {
        const n = value === true ? 1 : value === false ? 0 : Number(value);
        return `0x${configEditorHex(n >>> 0, 8)} (${n < 0 ? n : n >>> 0})`;
    }
    if (regType === 'REG_QWORD') {
        const big = BigInt.asUintN(64, BigInt(Math.trunc(Number(value))));
        return `0x${configEditorHex(big, 16)} (${Number(value)})`;
    }
    if (regType === 'REG_BINARY') {
        if (!Array.isArray(value) || !value.length) return '(zero-length binary value)';
        return value.map((b) => configEditorHex(b, 2)).join(' ');
    }
    if (regType === 'REG_MULTI_SZ') return (value || []).join(' ');
    return String(value);
}

/** The bytes regedit shows in Edit Binary Value / Binary Data for a value. */
function configEditorBytesOf(regType, value) {
    const utf16 = (s) => {
        const out = [];
        for (let i = 0; i < s.length; i += 1) { const c = s.charCodeAt(i); out.push(c & 0xff, c >> 8); }
        return out;
    };
    if (regType === 'REG_BINARY') return Array.isArray(value) ? value.slice() : [];
    if (regType === 'REG_DWORD') {
        const n = (value === true ? 1 : value === false ? 0 : Number(value)) >>> 0;
        return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    }
    if (regType === 'REG_QWORD') {
        let big = BigInt.asUintN(64, BigInt(Math.trunc(Number(value))));
        const out = [];
        for (let i = 0; i < 8; i += 1) { out.push(Number(big & 0xffn)); big >>= 8n; }
        return out;
    }
    if (regType === 'REG_MULTI_SZ') {
        const out = [];
        (value || []).forEach((s) => out.push(...utf16(String(s)), 0, 0));
        out.push(0, 0);
        return out;
    }
    return utf16(String(value == null ? '' : value)).concat([0, 0]);
}

/** Bytes back into the value's own JSON type (the reverse of configEditorBytesOf). */
function configEditorValueFromBytes(regType, bytes, original) {
    const fromUtf16 = (arr) => {
        let s = '';
        for (let i = 0; i + 1 < arr.length; i += 2) s += String.fromCharCode(arr[i] | (arr[i + 1] << 8));
        return s;
    };
    if (regType === 'REG_BINARY') return bytes.length ? bytes.slice() : (Array.isArray(original) ? [] : null);
    if (regType === 'REG_DWORD') {
        const b = bytes.concat([0, 0, 0, 0]);
        const n = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
        if (typeof original === 'boolean') return n !== 0;
        return typeof original === 'number' && original < 0 ? n | 0 : n;
    }
    if (regType === 'REG_QWORD') {
        const b = bytes.concat([0, 0, 0, 0, 0, 0, 0, 0]);
        let big = 0n;
        for (let i = 7; i >= 0; i -= 1) big = (big << 8n) | BigInt(b[i]);
        return Number(BigInt.asIntN(64, big));
    }
    const text = fromUtf16(bytes);
    if (regType === 'REG_MULTI_SZ') return text.split('\0').filter(Boolean);
    const s = text.replace(/\0+$/, '').split('\0')[0];
    if (typeof original === 'number') {
        const n = Number(s);
        return s.trim() !== '' && Number.isFinite(n) ? n : s;
    }
    return s;
}

/**
 * regedit's MessageBox, as Vista draws it (measured on the VM: Confirm Value Delete is a 556 x 101
 * client): the 32 px icon at 10,10, Segoe UI 9 pt text from 52,15 in lines of 15 wrapped at 470 px,
 * the white area at least 49 px tall, a #dfdfdf rule and a 40 px #f0f0f0 band with 66 x 21 buttons
 * 9 px down, 8 px apart, 11 px from the right. Yes / No boxes have no Close and ignore Esc (no
 * IDCANCEL). Resolves 'ok' / 'yes' / 'no'. Falls back to confirmationDialog.js without the dialogs.
 */
async function configEditorMessageBox(text, title, kind, buttons, owner) {
    if (!window.vistaDialogTemplate && typeof featureLoader !== 'undefined') {
        try { await featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* no dialogs */ }
    }
    const V = window.vistaDialogTemplate;
    const set = buttons === 'yesno' ? [['Yes', 'yes'], ['No', 'no']] : [['OK', 'ok']];
    if (!V) {
        if (typeof showConfirmationDialog !== 'function') return null;
        const icons = { info: 'fas fa-circle-info', warning: 'fas fa-triangle-exclamation', error: 'fas fa-circle-xmark' };
        return showConfirmationDialog(`<p>${configEditorEscapeHtml(text).replace(/\n/g, '<br>')}</p>`,
            set.map(([t, v], i) => ({ text: t, value: v, className: i ? 'btn-standard' : 'btn-standard primary', primary: !i })), null,
            { title: title || 'Registry Editor', icon: icons[kind || 'info'] });
    }
    const ctx2d = document.createElement('canvas').getContext('2d');
    ctx2d.font = '12px "Segoe UI", Tahoma, sans-serif';
    const WRAP = 470;
    let wrapped = false;
    const lines = [];
    String(text).split('\n').forEach((para) => {
        let line = '';
        para.split(/(\s+)/).forEach((word) => {
            const next = line + word;
            if (line && ctx2d.measureText(next.trimEnd()).width > WRAP) { lines.push(line.trimEnd()); line = word.trimStart(); wrapped = true; } else line = next;
        });
        lines.push(line);
    });
    const widest = Math.max(...lines.map((l) => Math.ceil(ctx2d.measureText(l).width)));
    const btnRow = 11 + set.length * 66 + (set.length - 1) * 8 + 11;
    const w = Math.max(btnRow, 56 + (wrapped ? WRAP : widest) + 30);
    const white = Math.max(49, 15 + lines.length * 15 + 15);
    const h = white + 1 + 40;
    const icon = { warning: 'msgbox-warning-32.png', error: 'msgbox-error-32.png', info: 'msgbox-info-32.png', question: 'msgbox-question-32.png' }[kind || 'info'];
    const tpl = { t: title || 'Registry Editor', w: 100, h: 50, f: ['Segoe UI', 9], s: 0, c: set.map(([t], i) => [i ? 7 : 1, 'B', 0, 0, 10, 10, 0x50010000 | (i ? 0 : 1), t, 0]) };
    return new Promise((resolve) => {
        let result = buttons === 'yesno' ? 'no' : 'ok';
        const ids = set.map((_, i) => (i ? 7 : 1));
        V.openDialog({
            id: 'configEditorMessageBox', tpl, owner, bareCaption: true,
            buttons: { 7: (ctx) => { result = 'no'; ctx.close(); } },
            init: (ctx) => {
                const c = ctx.content;
                c.classList.add('rg-msgbox');
                c.style.width = `${w}px`;
                c.style.height = `${h}px`;
                c.insertAdjacentHTML('afterbegin', `<div class="rg-mb-white" style="height:${white}px"></div><img class="rg-mb-icon" src="/static_images/vista-icons/${icon}" alt=""><div class="rg-mb-text">${lines.map((l) => configEditorEscapeHtml(l) || '&nbsp;').join('<br>')}</div>`);
                ids.forEach((id, i) => {
                    const b = ctx.holder(id);
                    if (!b) return;
                    Object.assign(b.style, { left: `${w - 11 - 66 - (set.length - 1 - i) * 74}px`, top: `${white + 1 + 9}px`, width: '66px', height: '21px' });
                    if (!i) b.dataset.dialogPrimary = '1';
                });
                if (buttons === 'yesno') {
                    // no Close box at all on a Yes / No MessageBox (the VM's caption has none)
                    const x = ctx.modal.querySelector('.vdt-close');
                    if (x) { x.disabled = true; x.style.display = 'none'; }
                    // no IDCANCEL: Esc does nothing
                    ctx.modal.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
                }
                setTimeout(() => { try { ctx.holder(1)?.focus(); } catch (_) { /* gone */ } }, 0);
            },
            ok: () => { result = buttons === 'yesno' ? 'yes' : 'ok'; return true; },
            cancel: () => { if (buttons !== 'yesno') result = 'ok'; }
        });
        // resolve once the box is gone
        const watch = setInterval(() => {
            const m = document.getElementById('configEditorMessageBox');
            if (!m || m.classList.contains('hidden') || !m.isConnected) { clearInterval(watch); resolve(result); }
        }, 100);
    });
}

class ConfigEditorApplet {
    constructor() {
        this.modal = null;
        this.valueModal = null;
        this.configList = [];
        this.nodeCache = new Map();
        this.expanded = new Set(['C']);
        this.locs = new Map();
        this.selLoc = { kind: 'computer' };
        this.selNames = new Set();
        this.focusName = null;
        this.anchorName = null;
        this.listEntries = [];
        this.findState = null;
        this.editTarget = null;
        this.checkpointsModal = null;
        this.checkpointsCache = [];
        this.checkpointsScopeConfigId = null;
        this._typeAhead = { text: '', at: 0 };
    }

    // ---- setup -------------------------------------------------------------------------------

    init() {
        this.modal = document.getElementById('configEditorModal');
        if (!this.modal || this._initWired) return;
        this._initWired = true;
        this.valueModal = document.getElementById('configEditorValueModal');
        this.treePanel = this.modal.querySelector('.config-editor-tree-panel');
        this.treeEl = document.getElementById('configEditorTree');
        this.listPanel = this.modal.querySelector('.config-editor-values-panel');
        this.listEl = document.getElementById('configEditorValuesBody');
        this.statusEl = document.getElementById('configEditorStatus');
        this.treeScrollShell = this.modal.querySelector('.config-editor-tree-scroll-shell');
        this.listScrollShell = this.modal.querySelector('.config-editor-values-scroll-shell');

        document.getElementById('closeConfigEditorBtn')?.addEventListener('click', () => this.doClose());
        this.modal.querySelector('.minimize-btn')?.addEventListener('click', () => {
            this.modal.classList.add('minimised');
            if (typeof updateBackdropVisibility === 'function') updateBackdropVisibility(); // modalUtils.js
        });

        this.wireTree();
        this.wireList();
        this.wireValueModal();
        this.wireCheckpoints();
        this.wireMenus();
        this.wireContextMenus();
        this.wireSplitter();
        this.wireColumns();
        this.wireKeyboard();
        try {
            if (localStorage.getItem('runes.statusBar') === 'off') this.modal.setAttribute('data-status-bar', 'off');
            const w = Number(localStorage.getItem('runes.split'));
            if (w >= 40) this.setSplit(w);
            const cols = JSON.parse(localStorage.getItem('runes.columns') || 'null');
            if (Array.isArray(cols)) this.setColumns(cols);
        } catch (_) { /* no storage */ }
    }

    async ws(type, data) {
        if (!window.wsClient?.isConnected()) throw new Error('WebSocket not connected');
        return window.wsClient.sendMessage(type, data || {}, false);
    }

    async ensureDialogs() {
        if (window.vistaDialogTemplate && window.vistaDialogTemplates) return window.vistaDialogTemplate;
        if (typeof featureLoader !== 'undefined') {
            try { await featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* no dialogs */ }
        }
        return window.vistaDialogTemplate || null;
    }

    msg(text, title, kind, buttons) {
        return configEditorMessageBox(text, title, kind, buttons, this.modal);
    }

    /** Opens the window at the last key (regedit's LastKey); configId/path open that key instead. */
    async open(configId, path) {
        if (!this.modal) this.init();
        if (!this.modal) return;
        // a window the session restored on its own has no list yet: it loads like a fresh one
        const wasOpen = !this.modal.classList.contains('hidden') && this.configList.length > 0;
        if (!wasOpen) {
            // CW_USEDEFAULT: three quarters of the work area, as regedit's first window
            if (!this.modal.dataset.windowDefaultWidth) {
                this.modal.dataset.windowDefaultWidth = String(Math.round(window.innerWidth * 0.75));
                this.modal.dataset.windowDefaultHeight = String(Math.round((window.innerHeight - 30) * 0.75));
            }
            this.nodeCache.clear();
            this.expanded = new Set(['C']);
            this.selLoc = { kind: 'computer' };
            this.selNames.clear();
            this.focusName = null;
        }
        openModal(this.modal);
        if (!wasOpen) {
            try {
                const data = await this.ws('config_editor_list');
                this.configList = data?.configs || [];
            } catch (err) {
                console.error('config_editor_list:', err);
                this.configList = [];
            }
            let target = null;
            if (configId) target = { kind: 'key', hive: this.hiveOf(configId), configId, path: path || [] };
            else {
                try { target = this.parseKeyPath(localStorage.getItem('runes.lastKey') || ''); } catch (_) { target = null; }
            }
            await this.renderTree();
            if (target) await this.navigateTo(target, { quiet: true });
            else await this.selectLoc({ kind: 'computer' });
        } else if (configId) {
            await this.navigateTo({ kind: 'key', hive: this.hiveOf(configId), configId, path: path || [] });
        }
        this.focusPane(this.treeEl);
    }

    /** vfsSystemOpenRouter.js: opens a config's key. */
    async selectNode(configId, path) {
        if (this.modal?.classList.contains('hidden')) return this.open(configId, path);
        return this.navigateTo({ kind: 'key', hive: this.hiveOf(configId), configId, path: path || [] });
    }

    doClose() {
        this.closeValueEditor();
        if (this.modal) closeModal(this.modal);
    }

    // ---- the model ---------------------------------------------------------------------------

    hiveOf(configId) {
        const h = CONFIG_EDITOR_HIVES.find((x) => x.configs.includes(configId));
        return h ? h.id : 'HKEY_LOCAL_MACHINE';
    }

    configsOf(hive) {
        return this.configList
            .filter((c) => this.hiveOf(c.id) === hive)
            .sort((a, b) => configEditorCompareNames(a.label || a.id, b.label || b.id));
    }

    configLabel(configId) {
        return this.configList.find((c) => c.id === configId)?.label || configId;
    }

    locKey(loc) {
        if (!loc || loc.kind === 'computer') return 'C';
        if (loc.kind === 'hive') return `H|${loc.hive}`;
        return `K|${loc.configId}|${JSON.stringify((loc.path || []).map(String))}`;
    }

    locName(loc) {
        if (loc.kind === 'computer') return 'Computer';
        if (loc.kind === 'hive') return loc.hive;
        return loc.path.length ? String(loc.path[loc.path.length - 1]) : this.configLabel(loc.configId);
    }

    /** "HKEY_LOCAL_MACHINE\Application Config\lruCache" (Copy Key Name; the status bar adds Computer). */
    keyPath(loc) {
        if (!loc || loc.kind === 'computer') return '';
        if (loc.kind === 'hive') return loc.hive;
        return [loc.hive, this.configLabel(loc.configId), ...loc.path].join('\\');
    }

    parseKeyPath(text) {
        const parts = String(text || '').replace(/^Computer\\?/i, '').split('\\').filter((p) => p !== '');
        if (!parts.length) return { kind: 'computer' };
        const hive = CONFIG_EDITOR_HIVES.find((h) => h.id.toUpperCase() === parts[0].toUpperCase());
        if (!hive) return null;
        if (parts.length === 1) return { kind: 'hive', hive: hive.id };
        const cfg = this.configList.find((c) => this.hiveOf(c.id) === hive.id
            && String(c.label || c.id).toUpperCase() === parts[1].toUpperCase());
        if (!cfg) return null;
        return { kind: 'key', hive: hive.id, configId: cfg.id, path: parts.slice(2) };
    }

    async fetchNode(configId, path, force) {
        const key = `${configId}|${(path || []).join('\0')}`;
        if (!force && this.nodeCache.has(key)) return this.nodeCache.get(key);
        const data = await this.ws('config_editor_get_node', { configId, path: path || [] });
        this.nodeCache.set(key, data);
        return data;
    }

    invalidateConfig(configId) {
        for (const k of [...this.nodeCache.keys()]) if (k.startsWith(`${configId}|`)) this.nodeCache.delete(k);
    }

    /** A child's JSON value, from the stub or the parent's masked snapshot. */
    childValue(data, child) {
        if (!child.expandable) return child.value;
        const nv = data?.nodeValue;
        return nv && typeof nv === 'object' ? nv[child.key] : undefined;
    }

    /** Is the child a key (object, or a list that is not one value)? */
    childIsKey(data, child) {
        if (!child.expandable) return false;
        const v = this.childValue(data, child);
        if (v === undefined) return child.type !== 'array' || !!child.hasExpandableChildren;
        return configEditorRegTypeOf(v) === null;
    }

    subkeysOf(data) {
        return (data?.children || []).filter((c) => this.childIsKey(data, c))
            .sort((a, b) => configEditorCompareNames(a.key, b.key));
    }

    valuesOf(data) {
        const out = [];
        for (const child of data?.children || []) {
            if (this.childIsKey(data, child)) continue;
            const value = this.childValue(data, child);
            const regType = configEditorRegTypeOf(value) || 'REG_BINARY';
            out.push({ name: child.key, child, value, regType, secret: configEditorIsSecret(child, data.configId) });
        }
        return out.sort((a, b) => configEditorCompareNames(a.name, b.name));
    }

    // ---- the tree ----------------------------------------------------------------------------

    wireTree() {
        const tree = this.treeEl;
        tree.tabIndex = 0;
        tree.setAttribute('role', 'tree');
        tree.addEventListener('mousedown', (e) => {
            const row = e.target.closest('.config-editor-tree-item');
            if (!row || e.button > 2) return;
            const loc = this.locs.get(row.dataset.loc);
            if (!loc) return;
            if (e.target.closest('.config-editor-tree-expand')) {
                e.preventDefault();
                this.focusPane(tree);
                void this.toggle(loc);
                return;
            }
            if (e.target.closest('.rg-rename')) return;
            e.preventDefault();
            this.focusPane(tree);
            if (this.locKey(loc) !== this.locKey(this.selLoc)) void this.selectLoc(loc);
        });
        tree.addEventListener('dblclick', (e) => {
            const row = e.target.closest('.config-editor-tree-item');
            if (!row || e.target.closest('.config-editor-tree-expand, .rg-rename')) return;
            const loc = this.locs.get(row.dataset.loc);
            if (loc) void this.toggle(loc);
        });
        tree.addEventListener('keydown', (e) => this.treeKey(e));
        tree.addEventListener('focus', () => this.syncFocus());
        tree.addEventListener('blur', () => this.syncFocus());
    }

    /** One key's row and, when it is open, its loaded children (rows for that branch only). */
    async buildBranch(loc) {
        const key = this.locKey(loc);
        this.locs.set(key, loc);
        const kids = await this.treeChildren(loc, this.expanded.has(key));
        const open = this.expanded.has(key) && kids.list !== null;
        const row = document.createElement('div');
        row.className = 'config-editor-tree-item';
        if (loc.kind === 'computer') row.classList.add('config-editor-tree-computer');
        row.dataset.loc = key;
        row.setAttribute('role', 'treeitem');
        const icon = loc.kind === 'computer' ? '/static_images/vista-explorer/computer-16.png' : '/static_images/vista-icons/explorer/folder-16.png';
        const exp = kids.has
            ? `<span class="config-editor-tree-expand" aria-hidden="true"><i class="fas ${open ? 'fa-chevron-down' : 'fa-chevron-right'}"></i></span>`
            : '<span class="config-editor-tree-spacer" aria-hidden="true"></span>';
        row.innerHTML = `${exp}<span class="config-editor-tree-label"><img class="config-editor-tree-icon" src="${icon}" alt=""><span>${configEditorEscapeHtml(this.locName(loc))}</span></span>`;
        const frag = [row];
        if (open && kids.list && kids.list.length) {
            const box = document.createElement('div');
            box.className = 'config-editor-tree-children';
            box.setAttribute('role', 'group');
            for (const k of kids.list) {
                for (const el of await this.buildBranch(k)) box.appendChild(el);
            }
            frag.push(box);
        }
        return frag;
    }

    /** The tree from Computer down, every expanded key loaded first (keeps the scroll position). */
    async renderTree() {
        const sc = this.treeScrollShell || this.treeEl;
        const top = sc.scrollTop;
        const left = sc.scrollLeft;
        this.locs.clear();
        const els = await this.buildBranch({ kind: 'computer' });
        this.treeEl.replaceChildren(...els);
        sc.scrollTop = top;
        sc.scrollLeft = left;
        this.paintTreeSelection();
        this.reinitScroll(this.treeScrollShell);
    }

    /**
     * Expanding or collapsing redraws only that key's branch, as a tree view does: the rest of the
     * tree, its scroll position and the keyboard focus stay as they are. Falls back to a full
     * render when the row is not on screen.
     */
    async renderBranch(loc) {
        const key = this.locKey(loc);
        const row = this.treeEl.querySelector(`.config-editor-tree-item[data-loc="${CSS.escape(key)}"]`);
        if (!row) { await this.renderTree(); return; }
        const next = row.nextElementSibling;
        const oldBox = next && next.classList.contains('config-editor-tree-children') ? next : null;
        const els = await this.buildBranch(loc);
        if (!row.isConnected) { await this.renderTree(); return; }
        if (oldBox) oldBox.remove();
        row.replaceWith(...els);
        this.paintTreeSelection();
        this.reinitScroll(this.treeScrollShell);
    }

    /** { has, list }: list is null when not loaded (a collapsed key keeps its triangle). */
    async treeChildren(loc, load) {
        if (loc.kind === 'computer') return { has: true, list: CONFIG_EDITOR_HIVES.map((h) => ({ kind: 'hive', hive: h.id })) };
        if (loc.kind === 'hive') {
            const list = this.configsOf(loc.hive).map((c) => ({ kind: 'key', hive: loc.hive, configId: c.id, path: [] }));
            return { has: list.length > 0, list };
        }
        const cacheKey = `${loc.configId}|${loc.path.join('\0')}`;
        let data = this.nodeCache.get(cacheKey);
        if (!data && load) {
            try { data = await this.fetchNode(loc.configId, loc.path); } catch (err) { console.error('config_editor_get_node:', err); }
        }
        if (!data) return { has: this.stubHasSubkeys(loc), list: null };
        const list = this.subkeysOf(data).map((c) => ({ kind: 'key', hive: loc.hive, configId: loc.configId, path: c.path.map(String) }));
        return { has: list.length > 0, list };
    }

    stubHasSubkeys(loc) {
        if (!loc.path.length) return true;
        const parent = this.nodeCache.get(`${loc.configId}|${loc.path.slice(0, -1).join('\0')}`);
        const stub = parent?.children?.find((c) => String(c.key) === String(loc.path[loc.path.length - 1]));
        return stub ? !!stub.hasExpandableChildren : true;
    }

    paintTreeSelection() {
        const key = this.locKey(this.selLoc);
        this.treeEl.querySelectorAll('.config-editor-tree-item').forEach((row) => {
            const on = row.dataset.loc === key;
            row.classList.toggle('selected', on);
            row.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }

    selectedRow() {
        return this.treeEl.querySelector(`.config-editor-tree-item[data-loc="${CSS.escape(this.locKey(this.selLoc))}"]`);
    }

    async toggle(loc, force) {
        const key = this.locKey(loc);
        const open = force !== undefined ? force : !this.expanded.has(key);
        if (open === this.expanded.has(key)) return;
        if (open) this.expanded.add(key);
        else {
            this.expanded.delete(key);
            // collapsing a branch that holds the selection selects the branch, as a tree view does
            const sel = this.locKey(this.selLoc);
            if (sel !== key && this.isUnder(this.selLoc, loc)) {
                await this.renderBranch(loc);
                await this.selectLoc(loc);
                return;
            }
        }
        await this.renderBranch(loc);
    }

    isUnder(loc, branch) {
        if (branch.kind === 'computer') return loc.kind !== 'computer';
        if (branch.kind === 'hive') return loc.kind === 'key' && loc.hive === branch.hive;
        return loc.kind === 'key' && loc.configId === branch.configId && loc.path.length > branch.path.length
            && configEditorPathsEqual(loc.path.slice(0, branch.path.length), branch.path);
    }

    parentLoc(loc) {
        if (loc.kind === 'hive') return { kind: 'computer' };
        if (loc.kind === 'key') return loc.path.length ? { ...loc, path: loc.path.slice(0, -1) } : { kind: 'hive', hive: loc.hive };
        return null;
    }

    async selectLoc(loc, opts = {}) {
        this.selLoc = loc;
        this.selNames.clear();
        this.focusName = null;
        this.anchorName = null;
        this.paintTreeSelection();
        const row = this.selectedRow();
        if (row) row.scrollIntoView({ block: 'nearest' });
        this.renderStatus();
        try { localStorage.setItem('runes.lastKey', `Computer${this.keyPath(loc) ? `\\${this.keyPath(loc)}` : ''}`); } catch (_) { /* no storage */ }
        await this.renderList(opts);
    }

    /** Expands down to a key and selects it (the deepest part that exists, as regedit does). */
    async navigateTo(target, opts = {}) {
        let loc = target;
        if (loc.kind === 'key') {
            this.expanded.add('C');
            this.expanded.add(`H|${loc.hive}`);
            let reached = [];
            for (let i = 0; i <= target.path.length; i += 1) {
                const p = target.path.slice(0, i);
                try {
                    const data = await this.fetchNode(target.configId, p);
                    if (i < target.path.length) {
                        const next = String(target.path[i]);
                        const child = data.children?.find((c) => String(c.key) === next);
                        if (!child || !this.childIsKey(data, child)) { reached = p; break; }
                        this.expanded.add(this.locKey({ ...target, path: p }));
                    }
                    reached = p;
                } catch (_) { break; }
            }
            loc = { ...target, path: reached.map(String) };
        } else if (loc.kind === 'hive') this.expanded.add('C');
        await this.renderTree();
        await this.selectLoc(loc, opts);
    }

    visibleRows() {
        return Array.from(this.treeEl.querySelectorAll('.config-editor-tree-item')).filter((r) => r.offsetParent !== null);
    }

    async treeKey(e) {
        if (e.target !== this.treeEl) return;
        const rows = this.visibleRows();
        const cur = this.selectedRow();
        const i = rows.indexOf(cur);
        const go = (row) => { if (row) { const loc = this.locs.get(row.dataset.loc); if (loc) void this.selectLoc(loc); } };
        const page = Math.max(1, Math.floor(this.treeEl.clientHeight / 18) - 1);
        const loc = this.selLoc;
        const key = this.locKey(loc);
        switch (e.key) {
            case 'ArrowDown': go(rows[Math.min(rows.length - 1, i + 1)]); break;
            case 'ArrowUp': go(rows[Math.max(0, i - 1)]); break;
            case 'PageDown': go(rows[Math.min(rows.length - 1, i + page)]); break;
            case 'PageUp': go(rows[Math.max(0, i - page)]); break;
            case 'Home': go(rows[0]); break;
            case 'End': go(rows[rows.length - 1]); break;
            case 'ArrowRight':
                if (!cur?.querySelector('.config-editor-tree-expand')) break;
                if (!this.expanded.has(key)) await this.toggle(loc, true);
                else go(this.visibleRows()[i + 1]);
                break;
            case 'ArrowLeft':
                if (this.expanded.has(key) && cur?.querySelector('.config-editor-tree-expand')) await this.toggle(loc, false);
                else { const p = this.parentLoc(loc); if (p) void this.selectLoc(p); }
                break;
            case 'Backspace': { const p = this.parentLoc(loc); if (p) void this.selectLoc(p); break; }
            case '+': await this.toggle(loc, true); break;
            case '-': await this.toggle(loc, false); break;
            case '*': await this.expandAll(loc); break;
            case 'Tab': case 'F6': this.listPanelFocus(); break;
            case 'Enter': await this.toggle(loc); break;
            default:
                if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { this.typeAhead(e.key, rows, i, go, (r) => r.querySelector('.config-editor-tree-label > span')?.textContent || ''); break; }
                return;
        }
        e.preventDefault();
        e.stopPropagation();
    }

    /** "*" on the keypad: every key under the selection, expanded. */
    async expandAll(loc) {
        const walk = async (l, depth) => {
            if (depth > 12) return;
            this.expanded.add(this.locKey(l));
            const kids = await this.treeChildren(l, true);
            for (const k of kids.list || []) await walk(k, depth + 1);
        };
        await walk(loc, 0);
        await this.renderTree();
    }

    typeAhead(ch, rows, i, go, textOf) {
        const now = Date.now();
        this._typeAhead.text = now - this._typeAhead.at > 1000 ? ch : this._typeAhead.text + ch;
        this._typeAhead.at = now;
        const q = this._typeAhead.text.toUpperCase();
        const n = rows.length;
        const start = q.length === 1 ? i + 1 : i;
        for (let k = 0; k < n; k += 1) {
            const row = rows[(start + k + n) % n];
            if (textOf(row).toUpperCase().startsWith(q)) { go(row); return; }
        }
    }

    // ---- the list ----------------------------------------------------------------------------

    wireList() {
        const panel = this.listPanel;
        panel.tabIndex = 0;
        panel.addEventListener('mousedown', (e) => {
            if (e.target.closest('th, .rg-rename')) return;
            if (e.button > 2) return;
            e.preventDefault();
            this.focusPane(panel);
            const row = e.target.closest('tr.config-editor-row');
            if (!row) {
                if (e.button === 0 && !e.ctrlKey && !e.shiftKey) { this.selNames.clear(); this.focusName = null; this.paintList(); }
                return;
            }
            const name = row.dataset.name;
            if (e.button === 2) {
                if (!this.selNames.has(name)) this.setListSelection([name], name);
                return;
            }
            if (e.shiftKey && this.anchorName != null) this.selectRange(this.anchorName, name, e.ctrlKey);
            else if (e.ctrlKey) {
                if (this.selNames.has(name)) this.selNames.delete(name); else this.selNames.add(name);
                this.focusName = name;
                this.anchorName = name;
                this.paintList();
            } else this.setListSelection([name], name);
        });
        panel.addEventListener('dblclick', (e) => {
            const row = e.target.closest('tr.config-editor-row');
            if (!row) return;
            this.setListSelection([row.dataset.name], row.dataset.name);
            void this.modify();
        });
        panel.addEventListener('keydown', (e) => this.listKey(e));
        panel.addEventListener('focus', () => this.paintList());
        panel.addEventListener('blur', () => this.paintList());
    }

    listPanelFocus() {
        this.focusPane(this.listPanel);
        if (!this.focusName && this.listEntries.length) {
            this.focusName = this.listEntries[0].name;
            this.paintList();
        }
    }

    async renderList(opts = {}) {
        const loc = this.selLoc;
        const token = (this._listToken = (this._listToken || 0) + 1);
        let entries = [];
        if (loc.kind === 'key') {
            try {
                const data = await this.fetchNode(loc.configId, loc.path);
                if (token !== this._listToken) return;
                this.listData = data;
                entries = this.valuesOf(data);
            } catch (err) {
                if (token !== this._listToken) return;
                console.error('config_editor_get_node:', err);
                if (!opts.quiet) await this.msg(`${this.locName(loc)} cannot be opened.\nAn error is preventing this key from being opened.\nDetails: ${err.message || err}`, 'Error Opening Key', 'error');
            }
        } else this.listData = null;
        // every key but Computer lists its (Default) value first
        const def = loc.kind === 'computer' ? [] : [{ name: '', isDefault: true, regType: 'REG_SZ' }];
        this.listEntries = def.concat(entries);
        const names = new Set(this.listEntries.map((x) => x.name));
        for (const n of [...this.selNames]) if (!names.has(n)) this.selNames.delete(n);
        if (this.focusName != null && !names.has(this.focusName)) this.focusName = null;
        const frag = document.createDocumentFragment();
        for (const entry of this.listEntries) {
            const tr = document.createElement('tr');
            tr.className = 'config-editor-row';
            tr.dataset.name = entry.name;
            const icon = CONFIG_EDITOR_TYPE_ICON[entry.regType] || 'binary';
            const label = entry.isDefault ? '(Default)' : entry.name;
            const data = entry.isDefault ? '(value not set)' : configEditorRegData(entry.regType, entry.value, entry.secret);
            tr.innerHTML = `<td class="config-editor-col-name"><span class="config-editor-name-with-icon"><img class="config-editor-value-icon" src="/static_images/vista-controls/regedit-value-${icon}.png" alt=""><span class="rg-name">${configEditorEscapeHtml(label)}</span></span></td><td class="config-editor-col-type">${entry.regType}</td><td class="config-editor-col-value"><span class="config-editor-value-display">${configEditorEscapeHtml(data)}</span></td><td class="rg-col-fill"></td>`;
            if (entry.child?.description) tr.title = entry.child.description;
            frag.appendChild(tr);
        }
        this.listEl.replaceChildren(frag);
        this.paintList();
        this.reinitScroll(this.listScrollShell);
    }

    /** Which pane has the focus: the tree shows its selection only then, the list in blue only then. */
    syncFocus() {
        if (!this.modal) return;
        this.modal.classList.toggle('rg-tree-focus', document.activeElement === this.treeEl);
        this.modal.classList.toggle('rg-list-focus', document.activeElement === this.listPanel);
    }

    focusPane(el) {
        if (!el) return;
        el.focus({ preventScroll: true });
        this.syncFocus();
        if (el === this.listPanel) this.paintList();
    }

    paintList() {
        this.syncFocus();
        const focused = document.activeElement === this.listPanel;
        this.listEl.querySelectorAll('tr.config-editor-row').forEach((tr) => {
            const name = tr.dataset.name;
            tr.classList.toggle('selected', this.selNames.has(name));
            tr.classList.toggle('rg-focus', focused && this.focusName === name);
        });
    }

    setListSelection(names, focus) {
        this.selNames = new Set(names);
        this.focusName = focus;
        this.anchorName = focus;
        this.paintList();
        const tr = this.rowFor(focus);
        if (tr) tr.scrollIntoView({ block: 'nearest' });
    }

    selectRange(from, to, add) {
        const names = this.listEntries.map((x) => x.name);
        const a = names.indexOf(from);
        const b = names.indexOf(to);
        if (a < 0 || b < 0) return;
        const range = names.slice(Math.min(a, b), Math.max(a, b) + 1);
        this.selNames = new Set(add ? [...this.selNames, ...range] : range);
        this.focusName = to;
        this.paintList();
    }

    rowFor(name) {
        if (name == null) return null;
        return this.listEl.querySelector(`tr.config-editor-row[data-name="${CSS.escape(name)}"]`);
    }

    entry(name) {
        return this.listEntries.find((x) => x.name === name) || null;
    }

    selectedEntries() {
        return this.listEntries.filter((x) => this.selNames.has(x.name));
    }

    async listKey(e) {
        if (e.target !== this.listPanel) return;
        const names = this.listEntries.map((x) => x.name);
        if (!names.length) { if (e.key === 'Tab') { this.treeEl.focus(); e.preventDefault(); } return; }
        const i = names.indexOf(this.focusName);
        const page = Math.max(1, Math.floor(this.listPanel.clientHeight / 19) - 2);
        const move = (j) => {
            const n = names[Math.max(0, Math.min(names.length - 1, j))];
            if (e.shiftKey && this.anchorName != null) this.selectRange(this.anchorName, n, false);
            else if (e.ctrlKey) { this.focusName = n; this.paintList(); }
            else this.setListSelection([n], n);
            this.rowFor(n)?.scrollIntoView({ block: 'nearest' });
        };
        switch (e.key) {
            case 'ArrowDown': move(i < 0 ? 0 : i + 1); break;
            case 'ArrowUp': move(i < 0 ? 0 : i - 1); break;
            case 'PageDown': move(i + page); break;
            case 'PageUp': move(i - page); break;
            case 'Home': move(0); break;
            case 'End': move(names.length - 1); break;
            case ' ':
                if (e.ctrlKey && this.focusName != null) {
                    if (this.selNames.has(this.focusName)) this.selNames.delete(this.focusName); else this.selNames.add(this.focusName);
                    this.paintList();
                }
                break;
            case 'Enter': await this.modify(); break;
            case 'Tab': case 'F6': this.focusPane(this.treeEl); break;
            case 'a': case 'A':
                if (e.ctrlKey) { this.selNames = new Set(names); this.paintList(); break; }
                this.typeAhead(e.key, this.listRows(), i, (r) => this.setListSelection([r.dataset.name], r.dataset.name), (r) => r.querySelector('.rg-name')?.textContent || '');
                break;
            default:
                if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                    this.typeAhead(e.key, this.listRows(), i, (r) => this.setListSelection([r.dataset.name], r.dataset.name), (r) => r.querySelector('.rg-name')?.textContent || '');
                    break;
                }
                return;
        }
        e.preventDefault();
        e.stopPropagation();
    }

    listRows() {
        return Array.from(this.listEl.querySelectorAll('tr.config-editor-row'));
    }

    // ---- status bar, splitter, columns ---------------------------------------------------------

    renderStatus(text) {
        if (!this.statusEl) return;
        const path = this.keyPath(this.selLoc);
        const el = this.statusEl.querySelector('[data-status="path"]') || this.statusEl;
        el.textContent = text != null ? text : `Computer${path ? `\\${path}` : ''}`;
    }

    setSplit(w) {
        const width = Math.max(40, Math.min(Math.max(80, (this.modal.clientWidth || 800) - 60), w));
        this.treePanel.style.flexBasis = `${width}px`;
        this.treePanel.style.width = `${width}px`;
        return width;
    }

    wireSplitter() {
        const split = this.modal.querySelector('.config-editor-splitter');
        if (!split) return;
        split.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            split.setPointerCapture(e.pointerId);
            const startX = e.clientX;
            const startW = this.treePanel.getBoundingClientRect().width;
            const move = (ev) => this.setSplit(startW + ev.clientX - startX);
            const up = () => {
                split.removeEventListener('pointermove', move);
                split.removeEventListener('pointerup', up);
                try { localStorage.setItem('runes.split', String(Math.round(this.treePanel.getBoundingClientRect().width))); } catch (_) { /* no storage */ }
            };
            split.addEventListener('pointermove', move);
            split.addEventListener('pointerup', up);
        });
    }

    /** View > Split: the split follows the mouse (or Left / Right) until a click or Enter. */
    startSplit() {
        const split = this.modal.querySelector('.config-editor-splitter');
        const layout = this.modal.querySelector('.config-editor-layout');
        if (!split || !layout) return;
        const left = layout.getBoundingClientRect().left;
        let width = this.treePanel.getBoundingClientRect().width;
        const startW = width;
        this.modal.classList.add('rg-splitting');
        const done = (keep) => {
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('mousedown', click, true);
            document.removeEventListener('keydown', key, true);
            this.modal.classList.remove('rg-splitting');
            if (!keep) this.setSplit(startW);
            else try { localStorage.setItem('runes.split', String(Math.round(width))); } catch (_) { /* no storage */ }
        };
        const move = (e) => { width = this.setSplit(e.clientX - left - 2); };
        const click = (e) => { e.preventDefault(); e.stopPropagation(); done(true); };
        const key = (e) => {
            if (e.key === 'ArrowLeft') width = this.setSplit(width - 8);
            else if (e.key === 'ArrowRight') width = this.setSplit(width + 8);
            else if (e.key === 'Enter') done(true);
            else if (e.key === 'Escape') done(false);
            else return;
            e.preventDefault();
            e.stopPropagation();
        };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mousedown', click, true);
        document.addEventListener('keydown', key, true);
    }

    setColumns(cols) {
        const ths = this.modal.querySelectorAll('.config-editor-values-table thead th');
        cols.forEach((w, i) => { if (ths[i] && w >= 0) ths[i].style.width = `${w}px`; });
    }

    /** The header's dividers drag a column's width (regedit keeps them in its View value). */
    wireColumns() {
        const ths = Array.from(this.modal.querySelectorAll('.config-editor-values-table thead th')).slice(0, 3);
        ths.forEach((th) => {
            th.addEventListener('pointerdown', (e) => {
                const r = th.getBoundingClientRect();
                if (e.clientX < r.right - 6 || e.button !== 0) return;
                e.preventDefault();
                th.setPointerCapture(e.pointerId);
                const startX = e.clientX;
                const startW = r.width;
                const move = (ev) => { th.style.width = `${Math.max(0, Math.round(startW + ev.clientX - startX))}px`; };
                const up = () => {
                    th.removeEventListener('pointermove', move);
                    th.removeEventListener('pointerup', up);
                    try { localStorage.setItem('runes.columns', JSON.stringify(ths.map((t) => Math.round(t.getBoundingClientRect().width)))); } catch (_) { /* no storage */ }
                };
                th.addEventListener('pointermove', move);
                th.addEventListener('pointerup', up);
            });
            th.addEventListener('mousemove', (e) => {
                const r = th.getBoundingClientRect();
                th.style.cursor = e.clientX >= r.right - 6 ? 'col-resize' : '';
            });
        });
    }

    reinitScroll(shell) {
        // only panes that use the overlay scrollbar (the tree and the list scroll natively)
        if (!shell || !window.customScrollbar || !shell.hasAttribute('data-custom-scrollbar')) return;
        setTimeout(() => { try { window.customScrollbar.forceReinit(shell); } catch (_) { /* gone */ } }, 0);
    }

    // ---- what the commands act on ----------------------------------------------------------------

    /** Which pane the Edit menu acts on: the list when it has the focus (or had it last). */
    listActive() {
        return document.activeElement === this.listPanel || (this._lastPane === 'list' && document.activeElement !== this.treeEl);
    }

    canNewHere() {
        const loc = this.selLoc;
        if (loc.kind !== 'key') return false;
        const meta = this.listData?.node?.addMeta;
        return !meta || meta.allowed !== false;
    }

    newAllows(jsType) {
        if (!this.canNewHere()) return false;
        const allowed = this.listData?.node?.addMeta?.allowedTypes;
        if (!allowed || !allowed.length) return true;
        if (jsType === 'null') return true;
        return allowed.includes(jsType);
    }

    keyStub(loc) {
        if (loc.kind !== 'key' || !loc.path.length) return null;
        const parent = this.nodeCache.get(`${loc.configId}|${loc.path.slice(0, -1).join('\0')}`);
        return parent?.children?.find((c) => String(c.key) === String(loc.path[loc.path.length - 1])) || null;
    }

    parentIsList(loc) {
        if (loc.kind !== 'key' || !loc.path.length) return false;
        const parent = this.nodeCache.get(`${loc.configId}|${loc.path.slice(0, -1).join('\0')}`);
        return parent?.node?.type === 'array';
    }

    canDeleteKey(loc) {
        if (loc.kind !== 'key' || !loc.path.length) return false;
        const stub = this.keyStub(loc);
        return !(stub?.required || stub?.readOnly);
    }

    canDeleteValues() {
        const sel = this.selectedEntries().filter((x) => !x.isDefault);
        return sel.length > 0 && sel.every((x) => !(x.child?.required || x.child?.readOnly));
    }

    // ---- menus -------------------------------------------------------------------------------

    newSubmenu() {
        return [
            { text: 'Key', action: 'new-key', disabled: () => !this.newAllows('object') },
            { separator: true },
            { text: 'String Value', action: 'new-string', disabled: () => !this.newAllows('string') },
            { text: 'Binary Value', action: 'new-binary', disabled: () => !this.newAllows('null') },
            { text: 'DWORD (32-bit) Value', action: 'new-dword', disabled: () => !this.newAllows('number') },
            { text: 'QWORD (64-bit) Value', action: 'new-qword', disabled: () => !this.newAllows('number') },
            { text: 'Multi-String Value', action: 'new-multi', disabled: () => !this.newAllows('array') },
            // the configs have no expandable strings
            { text: 'Expandable String Value', action: 'new-expand', disabled: true }
        ];
    }

    menuItems(menu) {
        const loc = this.selLoc;
        const isKey = loc.kind === 'key';
        if (menu === 'file') {
            return [
                { text: 'Import...', action: 'import' },
                { text: 'Export...', action: 'export' },
                // Runes' own: the configuration's checkpoints, with the other whole-registry files
                { text: 'Checkpoints...', action: 'checkpoints' },
                { separator: true },
                { text: 'Load Hive...', action: 'load-hive', disabled: true },
                { text: 'Unload Hive...', action: 'unload-hive', disabled: true },
                { separator: true },
                { text: 'Connect Network Registry...', action: 'connect', disabled: true },
                { text: 'Disconnect Network Registry...', action: 'disconnect', disabled: true },
                { separator: true },
                { text: 'Print...', action: 'print', subtext: 'Ctrl+P', disabled: true },
                { separator: true },
                { text: 'Exit', action: 'exit' }
            ];
        }
        if (menu === 'edit') {
            const inList = this.listActive() && this.selNames.size > 0;
            const one = this.selNames.size === 1;
            const items = [];
            if (inList) {
                items.push(
                    { text: 'Modify...', action: 'modify', className: 'rg-menu-default', disabled: () => !one },
                    { text: 'Modify Binary Data...', action: 'modify-binary', disabled: () => !one },
                    { separator: true }
                );
            }
            items.push(
                { text: 'New', submenu: this.newSubmenu(), disabled: () => !this.canNewHere() },
                { separator: true },
                { text: 'Permissions...', action: 'permissions', disabled: true },
                { separator: true },
                { text: 'Delete', action: 'delete', subtext: 'Del', disabled: () => (inList ? !this.canDeleteValues() : !this.canDeleteKey(loc)) },
                { text: 'Rename', action: 'rename', disabled: () => (inList ? !(one && this.canRenameValue(this.selectedEntries()[0])) : !this.canRenameKey(loc)) },
                { separator: true },
                { text: 'Copy Key Name', action: 'copy-key', disabled: () => loc.kind === 'computer' },
                { separator: true },
                { text: 'Find...', action: 'find', subtext: 'Ctrl+F' },
                { text: 'Find Next', action: 'find-next', subtext: 'F3' }
            );
            return items;
        }
        if (menu === 'view') {
            return [
                { text: 'Status Bar', action: 'status-bar', checked: this.modal.getAttribute('data-status-bar') !== 'off', showIndicator: true },
                { separator: true },
                { text: 'Split', action: 'split' },
                { separator: true },
                { text: 'Display Binary Data...', action: 'display-binary', disabled: () => !(this.listActive() && this.selNames.size === 1 && !this.selectedEntries()[0]?.isDefault) },
                { separator: true },
                { text: 'Refresh', action: 'refresh', subtext: 'F5' }
            ];
        }
        if (menu === 'favorites') {
            const favs = this.getFavorites();
            return [
                { text: 'Add to Favorites...', action: 'fav-add', disabled: () => !isKey && loc.kind !== 'hive' },
                { text: 'Remove Favorite...', action: 'fav-remove', disabled: () => !favs.length },
                ...(favs.length ? [{ separator: true }, ...favs.map((f, k) => ({ text: f.name, action: `fav-go-${k}` }))] : [])
            ];
        }
        return [
            { text: 'Help Topics', action: 'help-topics' },
            { separator: true },
            { text: 'About Registry Editor...', action: 'about' }
        ];
    }

    /** Context menus: regedit.exe.mui MENU 104 (a key), 107 (Computer), 105 (values), 106 (the list). */
    contextItems(where) {
        const loc = this.selLoc;
        if (where === 'tree') {
            const open = this.expanded.has(this.locKey(loc));
            const hasKids = !!this.selectedRow()?.querySelector('.config-editor-tree-expand');
            const expand = { text: open ? 'Collapse' : 'Expand', action: 'expand', className: 'rg-menu-default', disabled: !hasKids };
            if (loc.kind === 'computer') {
                return [expand, { separator: true }, { text: 'Export', action: 'export' }, { separator: true }, { text: 'Disconnect', action: 'disconnect', disabled: true }];
            }
            return [
                expand,
                { text: 'New', submenu: this.newSubmenu(), disabled: () => !this.canNewHere() },
                { text: 'Find...', action: 'find' },
                { separator: true },
                { text: 'Delete', action: 'delete-key', disabled: () => !this.canDeleteKey(loc) },
                { text: 'Rename', action: 'rename-key', disabled: () => !this.canRenameKey(loc) },
                { separator: true },
                { text: 'Export', action: 'export' },
                { text: 'Permissions...', action: 'permissions', disabled: true },
                { separator: true },
                { text: 'Copy Key Name', action: 'copy-key' }
            ];
        }
        if (this.selNames.size) {
            const one = this.selNames.size === 1;
            return [
                { text: 'Modify...', action: 'modify', className: 'rg-menu-default', disabled: !one },
                { text: 'Modify Binary Data...', action: 'modify-binary', disabled: !one },
                { separator: true },
                { text: 'Delete', action: 'delete-values', disabled: () => !this.canDeleteValues() },
                { text: 'Rename', action: 'rename-value', disabled: () => !(one && this.canRenameValue(this.selectedEntries()[0])) }
            ];
        }
        return [{ text: 'New', submenu: this.newSubmenu(), disabled: () => !this.canNewHere() }];
    }

    wireMenus() {
        if (typeof contextMenu === 'undefined' || !contextMenu) return;
        const ids = { file: 'configEditorMenuFile', edit: 'configEditorMenuEdit', view: 'configEditorMenuView', favorites: 'configEditorMenuFavorites', help: 'configEditorMenuHelp' };
        Object.keys(ids).forEach((menu) => {
            const button = document.getElementById(ids[menu]);
            if (!button) return;
            button.addEventListener('mousedown', () => {
                this._lastPane = document.activeElement === this.listPanel ? 'list' : (document.activeElement === this.treeEl ? 'tree' : this._lastPane);
            });
            // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
            contextMenu.attachClickMenuToElement(button, {
                beforeShow: () => { this._menuOpen = menu; this.renderStatus(CONFIG_EDITOR_MENU_HELP[menu]); },
                onHide: () => { this._menuOpen = null; this.renderStatus(); },
                onAction: (action) => this.command(action),
                sections: [{ type: 'list', initfn: (section) => { section.items = this.menuItems(menu); } }]
            });
        });
        // the status bar shows the help line of the menu row under the mouse
        document.addEventListener('mouseover', (e) => {
            if (!this._menuOpen && !this._ctxOpen) return;
            const row = e.target.closest?.('.context-menu .context-menu-item, .context-menu-submenu .context-menu-item');
            if (!row) return;
            const it = row._menuItem;
            const help = it && (CONFIG_EDITOR_MENU_HELP[it.action] || (it.submenu ? CONFIG_EDITOR_MENU_HELP.new : ''));
            this.renderStatus(help || (this._menuOpen ? CONFIG_EDITOR_MENU_HELP[this._menuOpen] : ''));
        });
    }

    wireContextMenus() {
        if (typeof contextMenu === 'undefined' || !contextMenu) return;
        // the right button selects what it is on first, as a tree view and a list view do
        this.treeEl.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('.config-editor-tree-item');
            const loc = row && this.locs.get(row.dataset.loc);
            if (loc && this.locKey(loc) !== this.locKey(this.selLoc)) {
                this.selLoc = loc;
                this.paintTreeSelection();
                this.renderStatus();
                void this.renderList();
            }
        }, true);
        const config = (where) => ({
            beforeShow: () => { this._ctxOpen = true; },
            onHide: () => { this._ctxOpen = false; this.renderStatus(); },
            sections: [{ type: 'list', initfn: (section) => { section.items = this.contextItems(where); } }],
            onAction: (action) => this.command(action, where)
        });
        contextMenu.attachToElement(this.treePanel, config('tree'));
        contextMenu.attachToElement(this.listPanel, config('list'));
    }

    /** Shift+F10 / the menu key: the selection's context menu, at the selection. */
    openContextMenuAtSelection(where) {
        const el = where === 'tree' ? this.selectedRow()?.querySelector('.config-editor-tree-label') : (this.rowFor(this.focusName) || this.listPanel);
        const host = where === 'tree' ? this.treePanel : this.listPanel;
        if (!el || typeof contextMenu === 'undefined') return;
        const r = el.getBoundingClientRect();
        contextMenu.showMenu({ clientX: Math.round(r.left + 8), clientY: Math.round(r.bottom - 2), preventDefault() {}, stopPropagation() {} }, host);
    }

    async command(action, where) {
        this.renderStatus();
        const loc = this.selLoc;
        switch (action) {
            case 'modify': return this.modify();
            case 'modify-binary': return this.modifyBinary();
            case 'new-key': return this.newKey();
            case 'new-string': return this.newValue('');
            case 'new-binary': return this.newValue(null);
            case 'new-dword': return this.newValue(0);
            case 'new-qword': return this.newValue(0, 'REG_QWORD');
            case 'new-multi': return this.newValue([]);
            case 'delete': return this.listActive() && this.selNames.size ? this.deleteValues() : this.deleteKey();
            case 'delete-key': return this.deleteKey();
            case 'delete-values': return this.deleteValues();
            case 'rename': return this.listActive() && this.selNames.size ? this.renameValue() : this.renameKey();
            case 'rename-key': return this.renameKey();
            case 'rename-value': return this.renameValue();
            case 'copy-key': return this.copyKeyName();
            case 'find': return this.openFind();
            case 'find-next': return this.findNext();
            case 'expand': return this.toggle(loc);
            case 'status-bar': {
                const off = this.modal.getAttribute('data-status-bar') !== 'off';
                if (off) this.modal.setAttribute('data-status-bar', 'off'); else this.modal.removeAttribute('data-status-bar');
                try { localStorage.setItem('runes.statusBar', off ? 'off' : 'on'); } catch (_) { /* no storage */ }
                return undefined;
            }
            case 'split': return this.startSplit();
            case 'display-binary': return this.displayBinary();
            case 'refresh': return this.refresh();
            case 'export': return this.exportBranch(where === 'tree' ? loc : (this.selLoc));
            case 'import': return this.importFile();
            case 'checkpoints': return this.openCheckpointsModal(loc.kind === 'key' ? loc.configId : null);
            case 'exit': return this.doClose();
            case 'fav-add': return this.addFavorite();
            case 'fav-remove': return this.removeFavorites();
            case 'help-topics':
                if (typeof openHelpAndSupport === 'function') openHelpAndSupport('runes'); // eslint-disable-line no-undef
                return undefined;
            case 'about':
                if (typeof openAboutMelatoninModal === 'function') openAboutMelatoninModal({ program: 'Registry Editor', owner: this.modal }); // eslint-disable-line no-undef
                return undefined;
            default:
                if (action && action.startsWith('fav-go-')) {
                    const f = this.getFavorites()[Number(action.slice(7))];
                    const target = f && (f.key ? this.parseKeyPath(f.key) : (f.configId ? { kind: 'key', hive: this.hiveOf(f.configId), configId: f.configId, path: f.path || [] } : null));
                    if (target) return this.navigateTo(target);
                }
                return undefined;
        }
    }

    // ---- keyboard ----------------------------------------------------------------------------

    wireKeyboard() {
        const handler = (e) => {
            if (!this.modal || this.modal.classList.contains('hidden')) return undefined;
            if (this.valueModal && !this.valueModal.classList.contains('hidden')) return undefined;
            if (e.target && e.target.closest && e.target.closest('.rg-rename')) return undefined;
            const ctrl = e.ctrlKey || e.metaKey;
            const inPane = e.target === this.treeEl || e.target === this.listPanel;
            const where = e.target === this.listPanel ? 'list' : 'tree';
            let act = null;
            if (ctrl && (e.key === 'f' || e.key === 'F')) act = () => this.openFind();
            else if (e.key === 'F3') act = () => this.findNext();
            else if (e.key === 'F5') act = () => this.refresh();
            else if (e.key === 'F2' && inPane) act = () => (where === 'list' ? this.renameValue() : this.renameKey());
            else if (e.key === 'Delete' && inPane && !ctrl && !e.altKey) act = () => (where === 'list' ? (this.selNames.size ? this.deleteValues() : null) : this.deleteKey());
            else if (inPane && ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu')) act = () => this.openContextMenuAtSelection(where);
            else if (e.altKey && !ctrl && /^[fevah]$/i.test(e.key)) {
                const map = { f: 'File', e: 'Edit', v: 'View', a: 'Favorites', h: 'Help' };
                act = () => document.getElementById(`configEditorMenu${map[e.key.toLowerCase()]}`)?.click();
            }
            if (!act) return undefined;
            e.preventDefault();
            e.stopPropagation();
            if (inPane) this._lastPane = where;
            void act();
            return true;
        };
        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        if (typeof registerKeyboardListener === 'function') {
            registerKeyboardListener({ id: 'configEditorModal.regedit', handler, type: 'whenFocused', modalId: 'configEditorModal', priority: 78, showInOverlay: false });
            registerKeyboardListener({
                id: 'configEditorValueModal.keydown',
                handler: (e) => {
                    if (!this.valueModal || this.valueModal.classList.contains('hidden')) return undefined;
                    if (e.key !== 'Escape') return undefined;
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeValueEditor();
                    return true;
                },
                type: 'whenFocused', modalId: 'configEditorValueModal', priority: 85, critical: true, showInOverlay: false
            });
        } else this.modal.addEventListener('keydown', handler);
        if (typeof registerModalOverlayEntries === 'function') {
            registerModalOverlayEntries('configEditorModal', 'Registry Editor', [
                { id: 'overlay.configEditor.find', label: 'Find', keys: 'Ctrl+F', icon: 'fas fa-magnifying-glass' },
                { id: 'overlay.configEditor.findNext', label: 'Find Next', keys: 'F3', icon: 'fas fa-magnifying-glass' },
                { id: 'overlay.configEditor.refresh', label: 'Refresh', keys: 'F5', icon: 'fas fa-rotate' },
                { id: 'overlay.configEditor.rename', label: 'Rename', keys: 'F2', icon: 'fas fa-i-cursor' },
                { id: 'overlay.configEditor.delete', label: 'Delete', keys: 'Del', icon: 'fas fa-trash' }
            ]);
        }
        this.treeEl.addEventListener('focus', () => { this._lastPane = 'tree'; });
        this.listPanel.addEventListener('focus', () => { this._lastPane = 'list'; });
    }

    // ---- writing ----------------------------------------------------------------------------

    stubAt(configId, path) {
        const parent = this.nodeCache.get(`${configId}|${path.slice(0, -1).join('\0')}`);
        return parent?.children?.find((c) => String(c.key) === String(path[path.length - 1])) || null;
    }

    /**
     * Writes patches to one config at once (config_editor_save). A change to a value the server
     * restarts for asks first. Resolves { ok, error }.
     */
    async commit(configId, patches) {
        const restart = patches.filter((p) => this.stubAt(configId, p.path)?.restartRequired);
        if (restart.length) {
            const names = restart.map((p) => String(p.path[p.path.length - 1])).join(', ');
            const ok = await this.msg(`Changing ${names} restarts the Dreamscape server.\nDo you want to continue?`, 'Registry Editor', 'warning', 'yesno');
            if (ok !== 'yes') return { ok: false, cancelled: true };
        }
        let data;
        try {
            data = await this.ws('config_editor_save', { patches: { [configId]: patches } });
        } catch (err) {
            data = { success: false, errors: [{ message: err.message || String(err) }] };
        }
        this.invalidateConfig(configId);
        if (!data?.success) {
            const error = (data?.errors || []).map((x) => x.message || x).join('\n') || 'The server did not save the change.';
            return { ok: false, error };
        }
        return { ok: true, restarting: !!data.restarting };
    }

    /** Re-reads the selected key and the tree after a write; keeps the list's selection by name. */
    async reload(selectNames) {
        await this.renderTree();
        await this.renderList({ quiet: true });
        if (selectNames) this.setListSelection(selectNames, selectNames[0]);
    }

    uniqueName(base, taken) {
        const set = new Set([...taken].map((n) => String(n).toUpperCase()));
        for (let n = 1; n < 10000; n += 1) {
            const name = `${base} #${n}`;
            if (!set.has(name.toUpperCase())) return name;
        }
        return null;
    }

    nextIndex(data) {
        return String((data?.children || []).length);
    }

    async newKey() {
        const loc = this.selLoc;
        if (loc.kind !== 'key' || !this.newAllows('object')) return;
        const data = await this.fetchNode(loc.configId, loc.path, true);
        const isList = data?.node?.type === 'array';
        const name = isList ? this.nextIndex(data) : this.uniqueName('New Key', (data.children || []).map((c) => c.key));
        if (name == null) { await this.msg('Cannot create key: Unable to generate a unique name.', 'Error Creating Key', 'error'); return; }
        const skeleton = data?.node?.addMeta?.defaultSkeleton;
        const value = skeleton && typeof skeleton === 'object' ? JSON.parse(JSON.stringify(skeleton)) : {};
        const res = await this.commit(loc.configId, [{ path: [...loc.path, name], value, deleted: false }]);
        if (!res.ok) {
            if (!res.cancelled) await this.msg(`Cannot create key: Error writing to the registry.\nDetails: ${res.error}`, 'Error Creating Key', 'error');
            return;
        }
        this.expanded.add(this.locKey(loc));
        const created = { ...loc, path: [...loc.path, name] };
        await this.renderTree();
        await this.selectLoc(created);
        this.focusPane(this.treeEl);
        // a new key is named in place at once (not a list's: its name is its index)
        if (!isList) this.renameKey(true);
    }

    async newValue(value, wantType) {
        const loc = this.selLoc;
        if (loc.kind !== 'key') return;
        const data = await this.fetchNode(loc.configId, loc.path, true);
        const isList = data?.node?.type === 'array';
        const name = isList ? this.nextIndex(data) : this.uniqueName('New Value', (data.children || []).map((c) => c.key));
        if (name == null) { await this.msg('Cannot create value: Unable to generate a unique name.', 'Error Creating Value', 'error'); return; }
        // a QWORD from 0 shows as REG_DWORD (JSON has one number type); the dialog it opens is the QWORD one
        const res = await this.commit(loc.configId, [{ path: [...loc.path, name], value, deleted: false }]);
        if (!res.ok) {
            if (!res.cancelled) await this.msg(`Cannot create value: Error writing to the registry.\nDetails: ${res.error}`, 'Error Creating Value', 'error');
            return;
        }
        this._qwordName = wantType === 'REG_QWORD' ? name : null;
        await this.reload([name]);
        this.focusPane(this.listPanel);
        if (!isList) this.renameValue(true);
    }

    async deleteKey() {
        const loc = this.selLoc;
        if (!this.canDeleteKey(loc)) return;
        const ok = await this.msg('Are you sure you want to permanently delete this key and all of its subkeys?', 'Confirm Key Delete', 'warning', 'yesno');
        if (ok !== 'yes') return;
        const res = await this.commit(loc.configId, [{ path: loc.path, deleted: true }]);
        if (!res.ok) {
            if (!res.cancelled) await this.msg(`Cannot delete ${this.locName(loc)}:  Error while deleting key.\nDetails: ${res.error}`, 'Error Deleting Key', 'error');
            return;
        }
        // the selection goes to the key above, as regedit's does
        const parent = this.parentLoc(loc);
        await this.renderTree();
        await this.selectLoc(parent);
        this.focusPane(this.treeEl);
    }

    async deleteValues() {
        const loc = this.selLoc;
        if (loc.kind !== 'key' || !this.canDeleteValues()) return;
        const sel = this.selectedEntries().filter((x) => !x.isDefault);
        const text = sel.length > 1
            ? 'Deleting certain registry values could cause system instability. Are you sure you want to permanently delete these values?'
            : 'Deleting certain registry values could cause system instability. Are you sure you want to permanently delete this value?';
        const ok = await this.msg(text, 'Confirm Value Delete', 'warning', 'yesno');
        if (ok !== 'yes') return;
        // a list's items go from the last, so the indexes before them hold
        const patches = sel.map((x) => ({ path: [...loc.path, x.name], deleted: true }))
            .sort((a, b) => configEditorCompareNames(String(b.path[b.path.length - 1]), String(a.path[a.path.length - 1])));
        const res = await this.commit(loc.configId, patches);
        if (!res.ok && !res.cancelled) await this.msg('Unable to delete all specified values.', 'Error Deleting Values', 'error');
        await this.reload([]);
    }

    canRenameKey(loc) {
        return loc.kind === 'key' && loc.path.length > 0 && !this.parentIsList(loc) && this.canDeleteKey(loc);
    }

    canRenameValue(entry) {
        if (!entry || entry.isDefault) return false;
        if (this.listData?.node?.type === 'array') return false;
        return !(entry.child?.required || entry.child?.readOnly);
    }

    /** regedit's in-place label edit: Enter keeps, Esc (or an unchanged name) cancels. */
    inlineEdit(span, initial, onDone) {
        if (!span) return;
        const box = document.createElement('input');
        box.type = 'text';
        box.className = 'rg-rename';
        box.value = initial;
        box.spellcheck = false;
        box.autocomplete = 'off';
        const host = span.parentElement;
        span.hidden = true;
        span.after(box);
        let finished = false;
        const size = () => {
            const ctx = this._measure || (this._measure = document.createElement('canvas').getContext('2d'));
            ctx.font = '9pt "Segoe UI", sans-serif';
            // the list view's edit: the text, 4 px in, and room for about two more characters (VM)
            box.style.width = `${Math.ceil(ctx.measureText(box.value || ' ').width) + 20}px`;
        };
        const end = (keep) => {
            if (finished) return;
            finished = true;
            const value = box.value;
            box.remove();
            span.hidden = false;
            void onDone(keep ? value : null, host);
        };
        box.addEventListener('input', size);
        box.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); end(true); }
            else if (e.key === 'Escape') { e.preventDefault(); end(false); }
        });
        box.addEventListener('mousedown', (e) => e.stopPropagation());
        box.addEventListener('blur', () => end(true));
        size();
        box.focus();
        box.select();
    }

    renameKey(isNew) {
        const loc = this.selLoc;
        if (!isNew && !this.canRenameKey(loc)) return;
        const span = this.selectedRow()?.querySelector('.config-editor-tree-label > span');
        const old = this.locName(loc);
        this.inlineEdit(span, old, async (name) => {
            this.focusPane(this.treeEl);
            if (name == null || name === old) return;
            const fail = (n) => this.msg(`The Registry Editor cannot rename ${old}. ${n}`, 'Error Renaming Key', 'error');
            if (!name.trim()) { await fail('The specified key name is empty. Type another name and try again.'); this.renameKey(isNew); return; }
            if (name.includes('\\')) { await fail('Specify a key name without a backslash (\\).'); this.renameKey(isNew); return; }
            if (name.length > 255) { await fail('The specified key name is too long. Type a shorter name and try again.'); this.renameKey(isNew); return; }
            const parentPath = loc.path.slice(0, -1);
            const parent = await this.fetchNode(loc.configId, parentPath, true);
            if ((parent.children || []).some((c) => String(c.key).toUpperCase() === name.toUpperCase() && String(c.key) !== old)) {
                await fail('The specified key name already exists. Type another name and try again.');
                this.renameKey(isNew);
                return;
            }
            const node = await this.fetchNode(loc.configId, loc.path, true);
            const value = node?.nodeValue;
            // a masked secret inside would be written as the mask: refuse, as on any key it cannot read
            if (value === undefined || JSON.stringify(value).includes(CONFIG_EDITOR_SECRET_MASK)) { await fail('Error while renaming key.'); return; }
            const res = await this.commit(loc.configId, [{ path: [...parentPath, name], value, deleted: false }, { path: loc.path, deleted: true }]);
            if (!res.ok) { if (!res.cancelled) await fail(`Error while renaming key.\nDetails: ${res.error}`); await this.renderTree(); return; }
            const oldKey = this.locKey(loc);
            const moved = { ...loc, path: [...parentPath, name] };
            if (this.expanded.has(oldKey)) { this.expanded.delete(oldKey); this.expanded.add(this.locKey(moved)); }
            await this.renderTree();
            await this.selectLoc(moved);
        });
    }

    renameValue(isNew) {
        const entry = this.entry(this.focusName) || this.selectedEntries()[0];
        if (!entry || (!isNew && !this.canRenameValue(entry))) return;
        const loc = this.selLoc;
        const span = this.rowFor(entry.name)?.querySelector('.rg-name');
        const old = entry.name;
        this.inlineEdit(span, old, async (name) => {
            this.focusPane(this.listPanel);
            if (name == null || name === old) return;
            const fail = (n) => this.msg(`The Registry Editor cannot rename ${old}. ${n}`, 'Error Renaming Value', 'error');
            if (!name.trim()) { await fail('The specified value name is empty. Type another name and try again.'); this.renameValue(isNew); return; }
            if (this.listEntries.some((x) => !x.isDefault && x.name !== old && x.name.toUpperCase() === name.toUpperCase())) {
                await fail('The specified value name already exists. Type another name and try again.');
                this.renameValue(isNew);
                return;
            }
            let value = entry.value;
            if (entry.secret) {
                try { value = (await this.ws('config_editor_reveal_secret', { configId: loc.configId, path: [...loc.path, old] }))?.value; } catch (_) { await fail('Error while renaming value.'); return; }
            }
            const res = await this.commit(loc.configId, [{ path: [...loc.path, name], value: value === undefined ? null : value, deleted: false }, { path: [...loc.path, old], deleted: true }]);
            if (!res.ok) { if (!res.cancelled) await fail(`Error while renaming value.\nDetails: ${res.error}`); await this.reload([old]); return; }
            if (this._qwordName === old) this._qwordName = name;
            await this.reload([name]);
        });
    }

    copyKeyName() {
        const text = this.keyPath(this.selLoc);
        if (!text) return;
        // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
        if (typeof copyTextToClipboard === 'function') copyTextToClipboard(text).catch(() => {});
        else navigator.clipboard?.writeText(text).catch(() => {});
    }

    async refresh() {
        this.nodeCache.clear();
        try {
            const data = await this.ws('config_editor_list');
            this.configList = data?.configs || this.configList;
        } catch (_) { /* keep the list */ }
        const keep = [...this.selNames];
        await this.navigateTo(this.selLoc, { quiet: true });
        this.setListSelection(keep.filter((n) => this.entry(n)), this.focusName);
    }

    // ---- Modify (#configEditorValueModal: Edit String / DWORD / QWORD / Multi-String) ---------------

    wireValueModal() {
        document.getElementById('closeConfigEditorValueBtn')?.addEventListener('click', () => this.closeValueEditor());
        document.getElementById('configEditorValueCancelBtn')?.addEventListener('click', () => this.closeValueEditor());
        document.getElementById('configEditorValueApplyBtn')?.addEventListener('click', () => this.applyValueEditor());
        ['configEditorValueBaseHex', 'configEditorValueBaseDec'].forEach((id) => {
            const radio = document.getElementById(id);
            if (radio) radio.addEventListener('change', () => this.setValueNumberBase(Number(radio.value)));
        });
        // the DWORD box takes only digits of its base (hexadecimal: 8 of them, decimal: 10)
        const num = document.getElementById('configEditorValueNumber');
        num?.addEventListener('beforeinput', (e) => {
            if (!e.data) return;
            const re = this.valueNumberBase === 16 ? /^[0-9a-f]+$/i : /^[0-9]+$/;
            if (!re.test(e.data)) e.preventDefault();
        });
        if (this.valueModal) {
            this.valueModal.addEventListener('keydown', (e) => {
                if (e.key === 'Alt') this.valueModal.classList.add('cev-cues');
                if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey) return;
                const t = e.target;
                if (!t || t.tagName !== 'INPUT' || t.type === 'radio') return;
                e.preventDefault();
                void this.applyValueEditor();
            });
        }
        if (typeof contextMenu !== 'undefined' && contextMenu) {
            const btn = document.getElementById('configEditorValueEnumBtn');
            if (btn) {
                contextMenu.attachClickMenuToElement(btn, {
                    position: 'anchor', anchorAlign: 'start', maxHeight: 360,
                    sections: [{ type: 'list', initfn: (section) => { section.items = this.enumMenuItems(); } }],
                    onAction: (action, target, item) => this.pickEnum(action, item)
                });
            }
        }
    }

    hideValueFields() {
        ['configEditorValueInput', 'configEditorValueNumber', 'configEditorValueSecret', 'configEditorValueTextarea', 'configEditorValuePromptWrap', 'configEditorValueEnumBtn', 'configEditorValueConvertBtn']
            .forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    }

    setValueLayout(layout, caption, name) {
        this.valueModal.dataset.cevLayout = layout;
        this.valueModal.classList.remove('cev-cues');
        const base = document.getElementById('configEditorValueBase');
        if (base) base.disabled = layout !== 'dword';
        const title = document.getElementById('configEditorValueModalTitle');
        if (title) title.textContent = caption;
        const nameEl = document.getElementById('configEditorValueName');
        if (nameEl) nameEl.value = name;
        const ok = document.getElementById('configEditorValueApplyBtn');
        if (ok) ok.disabled = false;
    }

    async modify() {
        const entry = this.selNames.size === 1 ? this.selectedEntries()[0] : null;
        if (!entry || !this.valueModal) return;
        const loc = this.selLoc;
        if (entry.isDefault) {
            // (Default) is never set in a config: Edit String opens on it empty and writes nothing
            this.editTarget = { entry, loc, kind: 'default' };
            this.hideValueFields();
            this.setValueLayout('string', 'Edit String', '(Default)');
            const el = document.getElementById('configEditorValueInput');
            el.classList.remove('hidden');
            el.value = '';
            openModal(this.valueModal);
            el.focus();
            return;
        }
        const child = entry.child || {};
        const types = child.types || [];
        const multiType = types.includes('string') && types.includes('array');
        this.editTarget = { entry, loc };
        this.hideValueFields();
        if (entry.secret) {
            this.editTarget.kind = 'secret';
            this.setValueLayout('string', 'Edit String', entry.name);
            const el = document.getElementById('configEditorValueSecret');
            el.classList.remove('hidden');
            el.value = '';
            el.disabled = true;
            openModal(this.valueModal);
            try {
                const data = await this.ws('config_editor_reveal_secret', { configId: loc.configId, path: [...loc.path, entry.name] });
                el.value = data?.value ?? '';
            } catch (err) {
                console.error('config_editor_reveal_secret:', err);
                this.closeValueEditor();
                await this.msg(`Cannot edit ${entry.name}:  Error reading the value's contents.`, 'Error Editing Value', 'error');
                return;
            }
            el.disabled = false;
            el.focus();
            el.select();
            return;
        }
        if (child.enum?.length) {
            this.editTarget.kind = 'enum';
            this.setValueLayout(entry.regType === 'REG_DWORD' ? 'string' : 'string', entry.regType === 'REG_DWORD' ? 'Edit DWORD (32-bit) Value' : 'Edit String', entry.name);
            const btn = document.getElementById('configEditorValueEnumBtn');
            btn.classList.remove('hidden');
            this.setEnum(entry.value);
            openModal(this.valueModal);
            btn.focus();
            return;
        }
        if (entry.regType === 'REG_BINARY') return this.modifyBinary();
        if (entry.regType === 'REG_DWORD' || entry.regType === 'REG_QWORD') {
            const qword = entry.regType === 'REG_QWORD' || this._qwordName === entry.name;
            this.editTarget.kind = qword ? 'qword' : 'dword';
            this.setValueLayout('dword', qword ? 'Edit QWORD (64-bit) Value' : 'Edit DWORD (32-bit) Value', entry.name);
            const el = document.getElementById('configEditorValueNumber');
            el.classList.remove('hidden');
            const n = entry.value === true ? 1 : entry.value === false ? 0 : Number(entry.value);
            // regedit opens a DWORD in hexadecimal
            document.getElementById('configEditorValueBaseHex').checked = true;
            document.getElementById('configEditorValueBaseHex').disabled = false;
            this.valueNumberBase = 16;
            el.maxLength = qword ? 16 : 8;
            el.value = qword ? BigInt.asUintN(64, BigInt(n)).toString(16) : (n >>> 0).toString(16);
            openModal(this.valueModal);
            el.focus();
            el.select();
            return;
        }
        if (entry.regType === 'REG_MULTI_SZ' || multiType) {
            this.editTarget.kind = 'multi';
            this.setValueLayout('multi', 'Edit Multi-String', entry.name);
            const el = document.getElementById('configEditorValueTextarea');
            el.classList.remove('hidden');
            el.readOnly = false;
            el.value = Array.isArray(entry.value) ? entry.value.join('\n') : String(entry.value ?? '');
            openModal(this.valueModal);
            el.focus();
            el.select();
            return;
        }
        const text = String(entry.value ?? '');
        if (child.editorType === 'prompt') {
            this.editTarget.kind = 'prompt';
            this.setValueLayout('multi', 'Edit String', entry.name);
            const wrap = document.getElementById('configEditorValuePromptWrap');
            const el = document.getElementById('configEditorValuePromptTextarea');
            wrap.classList.remove('hidden');
            el.value = text;
            if (!this._promptWired && typeof setupEditableTextarea === 'function') { setupEditableTextarea(el); this._promptWired = true; } // textareaUtils.js
            if (window.promptTextareaToolbar) window.promptTextareaToolbar.updateTokenCount(el);
            openModal(this.valueModal);
            setTimeout(() => el.focus(), 60);
            return;
        }
        this.editTarget.kind = 'string';
        this.setValueLayout('string', 'Edit String', entry.name);
        const el = document.getElementById('configEditorValueInput');
        el.classList.remove('hidden');
        el.value = text;
        openModal(this.valueModal);
        el.focus();
        el.select();
    }

    enumMenuItems() {
        const entry = this.editTarget?.entry;
        const values = entry?.child?.enum || [];
        const cur = this._enumValue;
        return values.map((v) => ({ text: v === null ? 'null' : String(v), action: 'enum-pick', enumValue: v, highlighted: v === cur }))
            .concat(entry?.child?.enumAllowCustom ? [{ text: 'Custom...', action: 'enum-custom' }] : []);
    }

    setEnum(v) {
        this._enumValue = v;
        const el = document.getElementById('configEditorValueEnumSelected');
        if (el) el.textContent = v === null ? 'null' : String(v ?? '');
    }

    async pickEnum(action, item) {
        if (action === 'enum-pick') { this.setEnum(item.enumValue); return; }
        if (action === 'enum-custom' && typeof showInputDialog === 'function') {
            const v = await showInputDialog('Value data:', this._enumValue == null ? '' : String(this._enumValue), '', null, null, { title: 'Edit String' });
            if (v != null) this.setEnum(typeof this.editTarget?.entry?.value === 'number' && Number.isFinite(Number(v)) ? Number(v) : String(v));
        }
    }

    setValueNumberBase(base) {
        const el = document.getElementById('configEditorValueNumber');
        const from = this.valueNumberBase || 10;
        this.valueNumberBase = base;
        if (!el || from === base) return;
        const raw = el.value.trim();
        const qword = this.editTarget?.kind === 'qword';
        el.maxLength = base === 16 ? (qword ? 16 : 8) : (qword ? 20 : 10);
        if (!raw) return;
        try {
            const big = from === 16 ? BigInt(`0x${raw}`) : BigInt(raw);
            el.value = base === 16 ? big.toString(16) : big.toString(10);
        } catch (_) { /* leave it */ }
    }

    /** OK: the value in its JSON type, then the write. */
    async applyValueEditor() {
        const t = this.editTarget;
        if (!t) return;
        if (t.kind === 'default') { this.closeValueEditor(); return; }
        const { entry, loc } = t;
        const original = entry.value;
        let value;
        if (t.kind === 'secret') {
            value = document.getElementById('configEditorValueSecret').value;
        } else if (t.kind === 'enum') {
            value = this._enumValue;
        } else if (t.kind === 'dword' || t.kind === 'qword') {
            const raw = document.getElementById('configEditorValueNumber').value.trim() || '0';
            let big;
            try { big = this.valueNumberBase === 16 ? BigInt(`0x${raw}`) : BigInt(raw); } catch (_) { big = 0n; }
            const max = t.kind === 'qword' ? 0xffffffffffffffffn : 0xffffffffn;
            if (big > max) {
                const ok = await this.msg(t.kind === 'qword'
                    ? 'The decimal value entered is greater than the maximum value of a QWORD (64-bit number).\nShould the value be truncated in order to continue?'
                    : 'The decimal value entered is greater than the maximum value of a DWORD (32-bit number).\nShould the value be truncated in order to continue?', 'Overflow', 'warning', 'yesno');
                if (ok !== 'yes') return;
                big = t.kind === 'qword' ? BigInt.asUintN(64, big) : BigInt.asUintN(32, big);
            }
            const n = t.kind === 'qword' ? Number(BigInt.asIntN(64, big)) : Number(big);
            value = typeof original === 'boolean' ? n !== 0 : (typeof original === 'number' && original < 0 && t.kind === 'dword' ? n | 0 : n);
        } else if (t.kind === 'multi') {
            const lines = document.getElementById('configEditorValueTextarea').value.split('\n').map((l) => l.replace(/\r$/, ''));
            const kept = lines.filter((l) => l !== '');
            const types = entry.child?.types || [];
            if (types.includes('string') && !Array.isArray(original) && kept.length <= 1) value = kept[0] || '';
            else {
                const empties = lines.length - kept.length - (lines[lines.length - 1] === '' ? 1 : 0);
                if (empties > 0) {
                    await this.msg(empties > 1
                        ? 'Data of type REG_MULTI_SZ cannot contain empty strings.\nRegistry Editor will remove all empty strings found.'
                        : 'Data of type REG_MULTI_SZ cannot contain empty strings.\nRegistry Editor will remove the empty string found.', 'Warning', 'warning');
                }
                value = kept;
            }
        } else if (t.kind === 'prompt') {
            const ta = document.getElementById('configEditorValuePromptTextarea');
            if (typeof applyFormattedText === 'function') applyFormattedText(ta, true); // utilities.js
            value = ta.value;
        } else {
            const s = document.getElementById('configEditorValueInput').value;
            const n = Number(s);
            value = typeof original === 'number' && s.trim() !== '' && Number.isFinite(n) ? n : s;
        }
        if (entry.child?.readOnly) {
            this.closeValueEditor();
            await this.msg(`Cannot edit ${entry.name}:  Error writing the value's new contents.`, 'Error Editing Value', 'error');
            return;
        }
        const name = entry.name;
        this.closeValueEditor();
        if (JSON.stringify(value) === JSON.stringify(original) && t.kind !== 'secret') return;
        const res = await this.commit(loc.configId, [{ path: [...loc.path, name], value, deleted: false }]);
        if (!res.ok && !res.cancelled) {
            await this.msg(`Cannot edit ${name}:  Error writing the value's new contents.\nDetails: ${res.error}`, 'Error Editing Value', 'error');
        }
        await this.reload([name]);
        this.focusPane(this.listPanel);
    }

    closeValueEditor() {
        this.editTarget = null;
        if (this.valueModal && !this.valueModal.classList.contains('hidden')) closeModal(this.valueModal);
    }

    // ---- Modify Binary Data (regedit.exe.mui 103) and Display Binary Data (2021) -----------------

    async revealedValue(entry) {
        if (!entry.secret) return entry.value;
        const loc = this.selLoc;
        const data = await this.ws('config_editor_reveal_secret', { configId: loc.configId, path: [...loc.path, entry.name] });
        return data?.value;
    }

    async modifyBinary() {
        const entry = this.selNames.size === 1 ? this.selectedEntries()[0] : null;
        if (!entry) return;
        const V = await this.ensureDialogs();
        if (!V) return;
        const loc = this.selLoc;
        let value;
        try { value = entry.isDefault ? undefined : await this.revealedValue(entry); } catch (_) {
            await this.msg(`Cannot edit ${entry.name}:  Error reading the value's contents.`, 'Error Editing Value', 'error');
            return;
        }
        const regType = entry.isDefault ? 'REG_SZ' : entry.regType;
        const bytes = entry.isDefault ? [] : configEditorBytesOf(regType, value);
        let hex = null;
        V.openDialog({
            id: 'configEditorBinaryDialog', key: 'regedit:103', owner: this.modal, bareCaption: true,
            overrides: { 1000: { nudge: [0, 0, 11, 0] }, 1001: { nudge: [0, 0, 11, 0] }, 1: { nudge: [11, 0, 0, 0] }, 2: { nudge: [11, 0, 0, 0] } },
            init: (ctx) => {
                ctx.set(1000, entry.isDefault ? '(Default)' : entry.name);
                const name = ctx.el(1000);
                if (name) name.readOnly = true;
                // regedit widens its HEX dialog by 11 px at run time (375 px windows on the VM, not the
                // template's 364): the boxes grow and the buttons move with the right edge
                ctx.content.style.width = `${parseFloat(ctx.content.style.width) + 11}px`;
                const host = ctx.content.querySelector('.vdt-custom[data-class="HEX"]');
                hex = this.hexEditor(host, bytes);
                setTimeout(() => hex?.focus(), 0);
            },
            ok: async () => {
                if (entry.isDefault || !hex) return true;
                const next = configEditorValueFromBytes(regType, hex.bytes(), value);
                if (JSON.stringify(next) === JSON.stringify(value)) return true;
                const res = await this.commit(loc.configId, [{ path: [...loc.path, entry.name], value: next, deleted: false }]);
                if (!res.ok && !res.cancelled) await this.msg(`Cannot edit ${entry.name}:  Error writing the value's new contents.\nDetails: ${res.error}`, 'Error Editing Value', 'error');
                await this.reload([entry.name]);
                return true;
            }
        });
    }

    /**
     * regedit's HEX control: "0000  01 02 FF ..  ..y" rows of 8 bytes in 8x13 cells (the address,
     * the bytes from column 6, the characters from column 31). Typing hex digits inserts bytes at the
     * caret; Backspace / Delete remove; arrows, Home / End move; Shift extends the selection.
     */
    hexEditor(host, initial) {
        if (!host) return null;
        let bytes = initial.slice();
        let caret = 0;      // byte index
        let nibble = 0;     // 0: before the high digit, 1: after it (a half-typed byte)
        let anchor = null;  // selection anchor (byte index) or null
        host.classList.add('rg-hex');
        host.tabIndex = 0;
        const view = document.createElement('div');
        view.className = 'rg-hex-view';
        host.appendChild(view);
        const ch = (b) => ((b >= 0x20 && b < 0x7f) || b >= 0xa0 ? String.fromCharCode(b) : '.');
        const selRange = () => (anchor == null || anchor === caret ? null : [Math.min(anchor, caret), Math.max(anchor, caret)]);
        const draw = () => {
            const rows = Math.max(1, Math.ceil((bytes.length + 1) / 8));
            const sel = selRange();
            let html = '';
            for (let r = 0; r < rows; r += 1) {
                const base = r * 8;
                if (base > bytes.length) break;
                // every character in its own 8 px cell, as the raster Courier lays them out
                const cell = (col, text, cls, i) => `<span class="${cls}"${i != null ? ` data-i="${i}"` : ''} style="left:${col * 8}px">${configEditorEscapeHtml(text)}</span>`;
                let line = '<div class="rg-hex-row">';
                configEditorHex(base, 4).toUpperCase().split('').forEach((c, n) => { line += cell(n, c, 'rg-hex-a'); });
                for (let k = 0; k < 8; k += 1) {
                    const i = base + k;
                    if (i >= bytes.length) break;
                    const on = sel && i >= sel[0] && i < sel[1] ? ' is-sel' : '';
                    const hx = configEditorHex(bytes[i], 2).toUpperCase();
                    line += cell(6 + k * 3, hx[0], `rg-hex-b${on}`, i) + cell(7 + k * 3, hx[1], `rg-hex-b${on}`, i);
                    line += cell(31 + k, ch(bytes[i]), `rg-hex-c${on}`, i);
                }
                html += `${line}</div>`;
            }
            const row = Math.floor(caret / 8);
            const col = 6 + (caret % 8) * 3 + nibble;
            html += `<span class="rg-hex-caret" style="left:${col * 8}px;top:${row * 13}px"></span>`;
            view.innerHTML = html;
        };
        const removeSel = () => {
            const sel = selRange();
            if (!sel) return false;
            bytes.splice(sel[0], sel[1] - sel[0]);
            caret = sel[0];
            anchor = null;
            nibble = 0;
            return true;
        };
        host.addEventListener('keydown', (e) => {
            const k = e.key;
            const move = (to) => {
                if (e.shiftKey) { if (anchor == null) anchor = caret; } else anchor = null;
                caret = Math.max(0, Math.min(bytes.length, to));
                nibble = 0;
            };
            if (/^[0-9a-f]$/i.test(k) && !e.ctrlKey && !e.altKey) {
                removeSel();
                const d = parseInt(k, 16);
                if (nibble === 0) { bytes.splice(caret, 0, d << 4); nibble = 1; } else { bytes[caret] = (bytes[caret] & 0xf0) | d; caret += 1; nibble = 0; }
            } else if (k === 'Backspace') {
                if (!removeSel()) { if (nibble) { bytes.splice(caret, 1); nibble = 0; } else if (caret > 0) { bytes.splice(caret - 1, 1); caret -= 1; } }
            } else if (k === 'Delete') {
                if (!removeSel() && caret < bytes.length) bytes.splice(caret, 1);
                nibble = 0;
            } else if (k === 'ArrowLeft') move(caret - (nibble ? 0 : 1));
            else if (k === 'ArrowRight') move(caret + 1);
            else if (k === 'ArrowUp') move(caret - 8);
            else if (k === 'ArrowDown') move(caret + 8);
            else if (k === 'Home') move(e.ctrlKey ? 0 : caret - (caret % 8));
            else if (k === 'End') move(e.ctrlKey ? bytes.length : Math.min(bytes.length, caret - (caret % 8) + 7));
            else if ((k === 'a' || k === 'A') && e.ctrlKey) { anchor = 0; caret = bytes.length; nibble = 0; } else return;
            e.preventDefault();
            e.stopPropagation();
            draw();
        });
        host.addEventListener('mousedown', (e) => {
            const cell = e.target.closest('[data-i]');
            host.focus();
            if (cell) { anchor = e.shiftKey ? (anchor ?? caret) : null; caret = Number(cell.dataset.i); nibble = 0; draw(); }
            e.preventDefault();
        });
        draw();
        return { bytes: () => bytes.slice(), focus: () => host.focus() };
    }

    async displayBinary() {
        const entry = this.selNames.size === 1 ? this.selectedEntries()[0] : null;
        if (!entry || entry.isDefault) return;
        const V = await this.ensureDialogs();
        if (!V) return;
        let value;
        try { value = await this.revealedValue(entry); } catch (_) {
            await this.msg(`Cannot display ${entry.name}:  Error reading the value's contents.`, 'Error Displaying Value', 'error');
            return;
        }
        const bytes = configEditorBytesOf(entry.regType, value);
        const ch = (b) => ((b >= 0x20 && b < 0x7f) || b >= 0xa0 ? String.fromCharCode(b) : '.');
        const lines = (size) => {
            const out = [];
            for (let base = 0; base < Math.max(1, bytes.length); base += 16) {
                const row = bytes.slice(base, base + 16);
                const groups = [];
                for (let i = 0; i < row.length; i += size) {
                    let n = 0n;
                    for (let k = Math.min(size, row.length - i) - 1; k >= 0; k -= 1) n = (n << 8n) | BigInt(row[i + k]);
                    groups.push(configEditorHex(n, size * 2));
                }
                const hexPart = groups.join(' ');
                const width = 16 / size * (size * 2 + 1) - 1;
                out.push(`${configEditorHex(base, 8)}   ${hexPart.padEnd(width, ' ')}    ${row.map(ch).join('')}`);
                if (!bytes.length) break;
            }
            return out;
        };
        V.openDialog({
            id: 'configEditorBinaryDataDialog', key: 'regedit:2021', owner: this.modal, bareCaption: true,
            init: (ctx) => {
                ctx.text(2026, entry.regType);
                const vt = ctx.holder(2026);
                if (vt) vt.style.overflow = 'visible';
                const fill = (size) => {
                    const box = ctx.el(2022);
                    if (!box) return;
                    box.classList.add('rg-bindata');
                    // one 8 px cell per character (the VM's raster Courier); the first row has the focus box
                    const cells = (l) => l.split('').map((c) => `<i>${c === ' ' ? '&nbsp;' : configEditorEscapeHtml(c)}</i>`).join('');
                    box.innerHTML = lines(size).map((l, i) => `<div class="vdt-lb-row rg-bin-row${i === 0 ? ' rg-focus' : ''}" role="option"><span>${cells(l)}</span></div>`).join('');
                };
                ctx.set(2023, true);
                fill(1);
                [[2023, 1], [2024, 2], [2025, 4], [2027, 8]].forEach(([id, size]) => ctx.on(id, 'change', () => { if (ctx.get(id)) fill(size); }));
            }
        });
    }

    // ---- Find (regedit.exe.mui 106) ----------------------------------------------------------------

    async openFind() {
        const V = await this.ensureDialogs();
        if (!V) return;
        let flags = { keys: true, values: true, data: true, whole: false };
        try { flags = Object.assign(flags, JSON.parse(localStorage.getItem('runes.findFlags') || '{}')); } catch (_) { /* defaults */ }
        V.openDialog({
            id: 'configEditorFindDialog', key: 'regedit:106', owner: this.modal, bareCaption: true, focusFirst: true,
            init: (ctx) => {
                ctx.set(1150, this.findState?.query || '');
                ctx.set(1152, flags.keys);
                ctx.set(1153, flags.values);
                ctx.set(1154, flags.data);
                ctx.set(1151, flags.whole);
                const sync = () => ctx.el(1)?.toggleAttribute('disabled', !String(ctx.get(1150) || '') || !(ctx.get(1152) || ctx.get(1153) || ctx.get(1154)));
                [1150, 1152, 1153, 1154].forEach((id) => ctx.on(id, id === 1150 ? 'input' : 'change', sync));
                sync();
            },
            ok: (ctx) => {
                const query = String(ctx.get(1150) || '');
                if (!query) return false;
                const f = { keys: !!ctx.get(1152), values: !!ctx.get(1153), data: !!ctx.get(1154), whole: !!ctx.get(1151) };
                try { localStorage.setItem('runes.findFlags', JSON.stringify(f)); } catch (_) { /* no storage */ }
                this.findState = { query, ...f };
                setTimeout(() => void this.findNext(), 0);
                return true;
            }
        });
    }

    /** The next match after the selection, in the tree's order (keys, then their values). */
    async findNext() {
        const st = this.findState;
        if (!st) { await this.openFind(); return; }
        const q = st.query.toUpperCase();
        const hit = (text) => (st.whole ? String(text).toUpperCase() === q : String(text).toUpperCase().includes(q));
        // the whole registry in order: [loc, valueName|null]
        const order = [];
        for (const h of CONFIG_EDITOR_HIVES) {
            order.push([{ kind: 'hive', hive: h.id }, null]);
            for (const cfg of this.configsOf(h.id)) {
                let root;
                try { root = (await this.ws('config_editor_get_node', { configId: cfg.id, path: [] }))?.nodeValue; } catch (_) { continue; }
                const walk = (path, v) => {
                    const loc = { kind: 'key', hive: h.id, configId: cfg.id, path };
                    order.push([loc, null, v]);
                    const keys = Object.keys(v || {}).sort(configEditorCompareNames);
                    const vals = [];
                    const subs = [];
                    for (const k of keys) {
                        const cv = v[k];
                        if (cv !== null && typeof cv === 'object' && configEditorRegTypeOf(cv) === null) subs.push(k);
                        else vals.push(k);
                    }
                    vals.forEach((k) => order.push([loc, k, v[k]]));
                    subs.forEach((k) => walk([...path, String(k)], v[k]));
                };
                walk([], root || {});
            }
        }
        const selKey = this.locKey(this.selLoc);
        const selName = this.listActive() && this.focusName ? this.focusName : null;
        let start = order.findIndex(([l, n]) => this.locKey(l) === selKey && (n === selName || (selName == null && n == null)));
        if (start < 0) start = order.findIndex(([l]) => this.locKey(l) === selKey);
        for (let i = start + 1; i < order.length; i += 1) {
            const [loc, name, v] = order[i];
            let match = false;
            if (name == null) match = st.keys && loc.kind === 'key' && hit(this.locName(loc));
            else {
                if (st.values && hit(name)) match = true;
                if (!match && st.data) {
                    const regType = configEditorRegTypeOf(v) || 'REG_BINARY';
                    const secret = configEditorIsSecret({ path: [...loc.path, name] }, loc.configId);
                    if (!secret && (regType === 'REG_SZ' || regType === 'REG_MULTI_SZ')) {
                        match = regType === 'REG_SZ' ? hit(v) : (v || []).some((s) => hit(s));
                    }
                }
            }
            if (!match) continue;
            await this.navigateTo(loc, { quiet: true });
            if (name != null) {
                this.setListSelection([name], name);
                this.focusPane(this.listPanel);
            } else this.focusPane(this.treeEl);
            return;
        }
        await this.msg('Finished searching through the registry.', 'Registry Editor', 'info');
    }

    // ---- Favorites (regedit.exe.mui 112 / 113) -------------------------------------------------------

    getFavorites() {
        try { return JSON.parse(localStorage.getItem('runes.favorites') || '[]'); } catch (_) { return []; }
    }

    setFavorites(list) {
        try { localStorage.setItem('runes.favorites', JSON.stringify(list)); } catch (_) { /* no storage */ }
    }

    async addFavorite() {
        const loc = this.selLoc;
        if (loc.kind === 'computer') return;
        const V = await this.ensureDialogs();
        if (!V) return;
        const name = this.locName(loc);
        const key = `Computer\\${this.keyPath(loc)}`;
        V.openDialog({
            id: 'configEditorAddFavorite', key: 'regedit:112', owner: this.modal, bareCaption: true, focusFirst: true,
            init: (ctx) => ctx.set(1190, name),
            ok: async (ctx) => {
                const n = String(ctx.get(1190) || '').trim();
                if (!n) return false;
                if (this.getFavorites().some((f) => f.name.toUpperCase() === n.toUpperCase())) {
                    await this.msg('There is already a favorite with that name.', 'Error Adding Favorite', 'error');
                    return false;
                }
                this.setFavorites(this.getFavorites().concat([{ name: n, key }]));
                return true;
            }
        });
    }

    async removeFavorites() {
        const V = await this.ensureDialogs();
        if (!V) return;
        V.openDialog({
            id: 'configEditorRemoveFavorites', key: 'regedit:113', owner: this.modal, bareCaption: true,
            init: (ctx) => {
                const box = ctx.el(1191);
                if (!box) return;
                box.innerHTML = this.getFavorites().map((f) => `<div class="vdt-lb-row" data-value="${configEditorEscapeHtml(f.name)}" role="option"><span>${configEditorEscapeHtml(f.name)}</span></div>`).join('');
                // LBS_EXTENDEDSEL: a click picks one, Ctrl+click adds, Shift+click a range
                let last = null;
                box.addEventListener('click', (ev) => {
                    const row = ev.target.closest('.vdt-lb-row');
                    if (!row) return;
                    const rows = Array.from(box.querySelectorAll('.vdt-lb-row'));
                    setTimeout(() => {
                        if (ev.shiftKey && last) {
                            const a = rows.indexOf(last);
                            const b = rows.indexOf(row);
                            rows.forEach((r, i) => r.classList.toggle('is-picked', i >= Math.min(a, b) && i <= Math.max(a, b)));
                        } else if (ev.ctrlKey) row.classList.toggle('is-picked');
                        else rows.forEach((r) => r.classList.toggle('is-picked', r === row));
                        rows.forEach((r) => r.classList.remove('is-selected'));
                        last = row;
                    }, 0);
                });
            },
            ok: (ctx) => {
                const picked = new Set(Array.from(ctx.content.querySelectorAll('.vdt-lb-row.is-picked'), (r) => r.dataset.value));
                this.setFavorites(this.getFavorites().filter((f) => !picked.has(f.name)));
                return true;
            }
        });
    }

    // ---- Export / Import (.reg text in the VFS) ------------------------------------------------------

    regEscape(s) {
        return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    regHex(prefix, bytes) {
        const parts = bytes.map((b) => configEditorHex(b, 2));
        const lines = [];
        let line = `${prefix}`;
        parts.forEach((p, i) => {
            const piece = p + (i < parts.length - 1 ? ',' : '');
            if (line.length + piece.length > 77) { lines.push(`${line}\\`); line = '  '; }
            line += piece;
        });
        lines.push(line);
        return lines.join('\r\n');
    }

    regValueLine(name, v) {
        const n = `"${this.regEscape(name)}"=`;
        const t = configEditorRegTypeOf(v);
        if (t === 'REG_SZ' && !/[\r\n\0]/.test(String(v))) return `${n}"${this.regEscape(v)}"`;
        if (t === 'REG_SZ') return this.regHex(`${n}hex(1):`, configEditorBytesOf('REG_SZ', v));
        if (t === 'REG_DWORD') return `${n}dword:${configEditorHex((v === true ? 1 : v === false ? 0 : v) >>> 0, 8)}`;
        if (t === 'REG_QWORD') return this.regHex(`${n}hex(b):`, configEditorBytesOf('REG_QWORD', v));
        if (t === 'REG_MULTI_SZ') return this.regHex(`${n}hex(7):`, configEditorBytesOf('REG_MULTI_SZ', v));
        return this.regHex(`${n}hex:`, Array.isArray(v) ? v : []);
    }

    async regText(loc) {
        const out = ['Windows Registry Editor Version 5.00', ''];
        const emitKey = (keyPath, v) => {
            out.push(`[${keyPath}]`);
            const keys = Object.keys(v || {}).sort(configEditorCompareNames);
            const subs = [];
            for (const k of keys) {
                const cv = v[k];
                if (cv !== null && typeof cv === 'object' && configEditorRegTypeOf(cv) === null) subs.push(k);
                else out.push(this.regValueLine(k, cv));
            }
            out.push('');
            subs.forEach((k) => emitKey(`${keyPath}\\${k}`, v[k]));
        };
        const hives = loc.kind === 'computer' ? CONFIG_EDITOR_HIVES.map((h) => h.id) : [loc.hive];
        for (const hive of hives) {
            const cfgs = loc.kind === 'key' ? [this.configList.find((c) => c.id === loc.configId)].filter(Boolean) : this.configsOf(hive);
            if (loc.kind !== 'key') { out.push(`[${hive}]`, ''); }
            for (const cfg of cfgs) {
                const path = loc.kind === 'key' ? loc.path : [];
                const data = await this.ws('config_editor_get_node', { configId: cfg.id, path });
                emitKey([hive, cfg.label || cfg.id, ...path].join('\\'), data?.nodeValue);
            }
        }
        return out.join('\r\n');
    }

    vfs() {
        return window.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef
    }

    async exportBranch(loc) {
        if (typeof studioOpenFolderDialog !== 'function') return; // studioSession.js
        const target = loc || { kind: 'computer' };
        const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : ''; // eslint-disable-line no-undef
        const applet = this;
        await studioOpenFolderDialog('save', {
            startPath: ws ? `/Workspaces/${ws}` : '/',
            host: {
                title: 'Export Registry File',
                typeLabel: 'Registration Files (*.reg)',
                acceptType: 'user-file',
                suggestName: () => '',
                async onSave(info) {
                    let name = String(info.name || '').trim();
                    if (!name) return false;
                    if (!/\.[a-z0-9]{1,5}$/i.test(name)) name += '.reg';
                    try {
                        const text = await applet.regText(target);
                        const bytes = new TextEncoder().encode(text);
                        let bin = '';
                        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
                        await applet.vfs().uploadFile(info.path || '/', btoa(bin), name, 'text/plain');
                        return true;
                    } catch (err) {
                        await applet.msg(`Cannot export ${name}: Error writing the file. There may be a disk or file system error.\nDetails: ${err.message || err}`, 'Registry Editor', 'error');
                        return false;
                    }
                }
            }
        });
    }

    async importFile() {
        if (typeof studioOpenFolderDialog !== 'function') return;
        const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : ''; // eslint-disable-line no-undef
        const applet = this;
        await studioOpenFolderDialog('open-vfs', {
            startPath: ws ? `/Workspaces/${ws}` : '/',
            host: {
                title: 'Import Registry File',
                typeLabel: 'Registration Files (*.reg)',
                rejectMessage: 'Choose a registration file',
                acceptItem: (item) => item && item.targetKind === 'user-file',
                async onOpen(item) {
                    let text;
                    try {
                        const res = await applet.vfs().downloadFile(item.id);
                        const r = await fetch(res.downloadUrl, { credentials: 'same-origin', cache: 'no-store' });
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        text = await r.text();
                    } catch (_) {
                        await applet.msg(`Cannot import ${item.name}: Error opening the file. There may be a disk or file system error.`, 'Registry Editor', 'error');
                        return;
                    }
                    await applet.importRegText(text, item.name);
                }
            }
        });
    }

    /** Parses .reg text into patches per config; existing values keep their JSON type. */
    async importRegText(text, fileName) {
        const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\\\r?\n\s*/g, '');
        const lines = raw.split(/\r?\n/);
        if (!/^(Windows Registry Editor Version 5\.00|REGEDIT4)\s*$/.test(lines[0] || '')) {
            await this.msg(`Cannot import ${fileName}: The specified file is not a registry script.\nYou can only import binary registry files from within the registry editor.`, 'Registry Editor', 'error');
            return;
        }
        const byConfig = new Map();
        const add = (cid, patch) => { if (!byConfig.has(cid)) byConfig.set(cid, []); byConfig.get(cid).push(patch); };
        const parseBytes = (s) => s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => parseInt(x, 16) & 0xff);
        const unq = (s) => s.replace(/\\(.)/g, '$1');
        let cur = null;
        let bad = false;
        const roots = new Map();
        for (const line of lines.slice(1)) {
            const l = line.trim();
            if (!l || l.startsWith(';')) continue;
            const km = /^\[(-?)(.+)\]$/.exec(l);
            if (km) {
                const loc = this.parseKeyPath(km[2]);
                cur = loc && loc.kind === 'key' ? loc : null;
                if (!cur) { if (loc === null) bad = true; continue; }
                if (km[1]) { if (cur.path.length) add(cur.configId, { path: cur.path, deleted: true }); cur = null; continue; }
                if (cur.path.length) add(cur.configId, { path: cur.path, ensureKey: true });
                continue;
            }
            if (!cur) continue;
            const vm = /^(@|"((?:[^"\\]|\\.)*)")=(.*)$/.exec(l);
            if (!vm || vm[1] === '@') continue;
            const name = unq(vm[2]);
            const rhs = vm[3];
            const path = [...cur.path, name];
            let value;
            let regType;
            if (rhs === '-') { add(cur.configId, { path, deleted: true }); continue; }
            if (/^"/.test(rhs)) { value = unq(rhs.replace(/^"|"$/g, '')); regType = 'REG_SZ'; } else if (/^dword:/i.test(rhs)) { value = parseInt(rhs.slice(6), 16) >>> 0; regType = 'REG_DWORD'; } else {
                const hm = /^hex(?:\(([0-9a-f]+)\))?:(.*)$/i.exec(rhs);
                if (!hm) continue;
                const t = hm[1] ? parseInt(hm[1], 16) : 3;
                const bytes = parseBytes(hm[2]);
                regType = { 1: 'REG_SZ', 2: 'REG_SZ', 3: 'REG_BINARY', 4: 'REG_DWORD', 7: 'REG_MULTI_SZ', 11: 'REG_QWORD' }[t] || 'REG_BINARY';
                value = configEditorValueFromBytes(regType, bytes, regType === 'REG_BINARY' ? [] : undefined);
            }
            add(cur.configId, { path, value, regType });
        }
        if (bad && !byConfig.size) {
            await this.msg(`Cannot import ${fileName}: Error accessing the registry.`, 'Registry Editor', 'error');
            return;
        }
        let failed = false;
        for (const [cid, list] of byConfig) {
            let root = roots.get(cid);
            if (!root) { try { root = (await this.ws('config_editor_get_node', { configId: cid, path: [] }))?.nodeValue || {}; } catch (_) { root = {}; } roots.set(cid, root); }
            const at = (p) => p.reduce((v, k) => (v == null ? undefined : v[k]), root);
            const patches = [];
            for (const p of list) {
                if (p.deleted) { patches.push({ path: p.path, deleted: true }); continue; }
                if (p.ensureKey) {
                    if (at(p.path) === undefined) patches.push({ path: p.path, value: {}, deleted: false });
                    continue;
                }
                const old = at(p.path);
                let v = p.value;
                if (v === CONFIG_EDITOR_SECRET_MASK) continue;
                if (typeof old === 'boolean' && p.regType === 'REG_DWORD') v = v !== 0;
                else if (typeof old === 'number' && p.regType === 'REG_SZ' && Number.isFinite(Number(v)) && String(v).trim() !== '') v = Number(v);
                else if (old === null && p.regType === 'REG_BINARY' && Array.isArray(v) && !v.length) v = null;
                // only what differs is written (a re-imported export changes nothing and restarts nothing)
                if (JSON.stringify(old) === JSON.stringify(v)) continue;
                patches.push({ path: p.path, value: v, deleted: false });
            }
            if (!patches.length) continue;
            const res = await this.commit(cid, patches);
            if (!res.ok && !res.cancelled) failed = true;
        }
        await this.refresh();
        if (failed) await this.msg(`Cannot import ${fileName}: Not all data was successfully written to the registry.  Some keys are open by the system or other processes.`, 'Registry Editor', 'error');
        else await this.msg(`The keys and values contained in ${fileName} have been successfully added to the registry.`, 'Registry Editor', 'info');
    }

    // ---- Checkpoints (File > Checkpoints...: the snapshot window) --------------------------------

    wireCheckpoints() {
        this.checkpointsModal = document.getElementById('configEditorCheckpointsModal');
        this.checkpointsListEl = document.getElementById('configEditorCheckpointsList');
        this.checkpointsStatusEl = document.getElementById('configEditorCheckpointsStatus');
        this.checkpointsScrollShell = this.checkpointsModal?.querySelector('.config-editor-checkpoints-scroll-shell');
        this.checkpointsSelectedId = null;
        this.checkpointsRestoreBtn = document.getElementById('configEditorCheckpointsRestoreBtn');
        this.checkpointsDetailBtn = document.getElementById('configEditorCheckpointsDetailBtn');
        this.checkpointsDeleteBtn = document.getElementById('configEditorCheckpointsDeleteBtn');
        document.getElementById('configEditorCheckpointsCreateBtn')?.addEventListener('click', () => this.requestCreateCheckpoint());
        this.checkpointsRestoreBtn?.addEventListener('click', () => { if (this.checkpointsSelectedId) this.requestRestoreCheckpoint(this.checkpointsSelectedId); });
        this.checkpointsDetailBtn?.addEventListener('click', () => { if (this.checkpointsSelectedId) this.showCheckpointDetail(this.checkpointsSelectedId); });
        this.checkpointsDeleteBtn?.addEventListener('click', () => { if (this.checkpointsSelectedId) this.requestDeleteCheckpoint(this.checkpointsSelectedId); });
        document.getElementById('closeConfigEditorCheckpointsBtn')?.addEventListener('click', () => this.closeCheckpointsModal());
    }

    formatCheckpointTimestamp(iso) {
        if (!iso) return '';
        try { return new Date(iso).toLocaleString(); } catch (_) { return String(iso); }
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
        if (this.checkpointsStatusEl) this.checkpointsStatusEl.textContent = msg || '';
    }

    async openCheckpointsModal(configId) {
        if (!this.checkpointsModal) return;
        this.checkpointsScopeConfigId = configId || null;
        openModal(this.checkpointsModal);
        this.reinitScroll(this.checkpointsScrollShell);
        await this.loadCheckpointsList();
    }

    closeCheckpointsModal() {
        if (this.checkpointsModal && !this.checkpointsModal.classList.contains('hidden')) closeModal(this.checkpointsModal);
    }

    renderCheckpointsList(checkpoints) {
        if (!this.checkpointsListEl) return;
        const scopeLabel = this.checkpointsScopeConfigId ? this.configLabel(this.checkpointsScopeConfigId) : null;
        if (!checkpoints?.length) {
            const emptyMsg = scopeLabel ? `No checkpoints for ${scopeLabel} yet.` : 'No checkpoints yet. Create one before major changes.';
            this.checkpointsListEl.innerHTML = `<div class="config-editor-checkpoints-empty">${configEditorEscapeHtml(emptyMsg)}</div>`;
            this.selectCheckpoint(null);
            return;
        }
        this.checkpointsListEl.innerHTML = checkpoints.map((cp) => {
            const label = cp.label
                ? configEditorEscapeHtml(cp.label)
                : `<span class="config-editor-checkpoints-auto">${configEditorEscapeHtml(cp.reason || (cp.kind === 'config-file' ? 'auto-save' : 'manual'))}</span>`;
            const meta = `<span title="${configEditorEscapeHtml(this.formatCheckpointTimestamp(cp.createdAt))}">${configEditorEscapeHtml(this.formatCheckpointRelativeTime(cp.createdAt))}</span> \u00b7 ${configEditorEscapeHtml(cp.scopeSummary || '')} \u00b7 ${this.formatBytes(cp.totalSizeBytes || 0)}`;
            return `<div class="config-editor-checkpoint-row" role="option" tabindex="-1" aria-selected="false" data-checkpoint-id="${configEditorEscapeHtml(cp.id)}">
                <div class="config-editor-checkpoint-main"><div class="config-editor-checkpoint-label">${label}</div><div class="config-editor-checkpoint-meta">${meta}</div></div>
            </div>`;
        }).join('');
        // a list box: click selects, double-click opens Properties (Restore for auto-saved files)
        this.checkpointsListEl.querySelectorAll('.config-editor-checkpoint-row').forEach((row) => {
            const id = row.dataset.checkpointId;
            row.addEventListener('click', () => this.selectCheckpoint(id));
            row.addEventListener('dblclick', () => {
                this.selectCheckpoint(id);
                const cp = this.checkpointsCache.find((c) => c.id === id);
                if (cp && cp.kind === 'config-file') this.requestRestoreCheckpoint(id);
                else this.showCheckpointDetail(id);
            });
        });
        const keep = checkpoints.some((cp) => cp.id === this.checkpointsSelectedId) ? this.checkpointsSelectedId : null;
        this.selectCheckpoint(keep);
    }

    selectCheckpoint(checkpointId) {
        this.checkpointsSelectedId = checkpointId || null;
        this.checkpointsListEl?.querySelectorAll('.config-editor-checkpoint-row').forEach((row) => {
            const on = row.dataset.checkpointId === this.checkpointsSelectedId;
            row.classList.toggle('selected', on);
            row.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        const cp = this.checkpointsSelectedId ? (this.checkpointsCache || []).find((c) => c.id === this.checkpointsSelectedId) : null;
        // auto-saved config files can be restored only (no details, no delete)
        const bundle = !!cp && cp.kind !== 'config-file';
        if (this.checkpointsRestoreBtn) this.checkpointsRestoreBtn.disabled = !cp;
        if (this.checkpointsDetailBtn) this.checkpointsDetailBtn.disabled = !bundle;
        if (this.checkpointsDeleteBtn) this.checkpointsDeleteBtn.disabled = !bundle;
    }

    async loadCheckpointsList() {
        if (!this.checkpointsListEl) return;
        this.checkpointsListEl.innerHTML = '<div class="config-editor-checkpoints-loading">Loading checkpoints...</div>';
        this.setCheckpointsStatus('');
        try {
            const payload = this.checkpointsScopeConfigId ? { configId: this.checkpointsScopeConfigId } : {};
            const data = await this.ws('config_editor_checkpoints_list', payload);
            this.checkpointsCache = data?.checkpoints || [];
            this.renderCheckpointsList(this.checkpointsCache);
            const n = this.checkpointsCache.length;
            this.setCheckpointsStatus(this.checkpointsScopeConfigId ? `${n} checkpoint${n === 1 ? '' : 's'} for ${this.configLabel(this.checkpointsScopeConfigId)}` : `${n} checkpoint${n === 1 ? '' : 's'}`);
        } catch (err) {
            console.error('config_editor_checkpoints_list:', err);
            this.checkpointsListEl.innerHTML = '<div class="config-editor-checkpoints-empty config-editor-error">Failed to load checkpoints</div>';
            this.selectCheckpoint(null);
        }
    }

    async showCheckpointDetail(checkpointId) {
        try {
            const data = await this.ws('config_editor_checkpoints_get', { checkpointId });
            const rows = (obj) => Object.entries(obj || {}).map(([k, v]) => `<tr><td>${configEditorEscapeHtml(k)}</td><td>${configEditorEscapeHtml(v.filename || '')}</td><td>${this.formatBytes(v.sizeBytes)}</td><td>${v.exists ? 'OK' : 'Missing'}</td></tr>`).join('');
            const html = `<p><strong>${configEditorEscapeHtml(data.label || data.reason || checkpointId)}</strong></p>
                <p>${configEditorEscapeHtml(this.formatCheckpointTimestamp(data.createdAt))} \u00b7 ${this.formatBytes(data.totalSizeBytes)}</p>
                <div class="config-editor-summary-table-wrap form-section-scroll"><table class="config-editor-summary-table">
                <thead><tr><th>Config</th><th>File</th><th>Size</th><th>Status</th></tr></thead>
                <tbody>${rows(data?.resources?.json) || '<tr><td colspan="4">No config files</td></tr>'}</tbody></table></div>
                <div class="config-editor-summary-table-wrap form-section-scroll"><table class="config-editor-summary-table">
                <thead><tr><th>Database</th><th>File</th><th>Size</th><th>Status</th></tr></thead>
                <tbody>${rows(data?.resources?.database) || '<tr><td colspan="4">No databases</td></tr>'}</tbody></table></div>`;
            await showConfirmationDialog(html, [{ text: 'Close', value: true, className: 'btn-standard primary' }], null, { title: 'Checkpoint Properties', icon: 'fas fa-circle-info' });
        } catch (err) {
            console.error('config_editor_checkpoints_get:', err);
            this.setCheckpointsStatus('Failed to load checkpoint details');
        }
    }

    async requestCreateCheckpoint() {
        let label = '';
        if (typeof showInputDialog === 'function') {
            label = await showInputDialog('Type a description to help you identify the checkpoint:', '', '', null, null, { title: 'Create Checkpoint' });
            if (label === null) return;
        }
        this.setCheckpointsStatus('Creating checkpoint...');
        try {
            const data = await this.ws('config_editor_checkpoints_create', { label: label || '' });
            this.setCheckpointsStatus(data?.success ? 'The checkpoint was created successfully.' : 'Create failed');
            if (data?.success) await this.loadCheckpointsList();
        } catch (err) {
            console.error('config_editor_checkpoints_create:', err);
            this.setCheckpointsStatus('Create failed');
        }
    }

    async requestRestoreCheckpoint(checkpointId) {
        const cp = this.checkpointsCache.find((c) => c.id === checkpointId);
        const label = cp?.label || cp?.reason || checkpointId?.slice(0, 8) || 'checkpoint';
        const ok = await this.msg(`Restore ${label}?\nThis replaces the configuration files and databases with the checkpoint's. A checkpoint of the current state is created first.`, 'Restore Checkpoint', 'warning', 'yesno');
        if (ok !== 'yes') return;
        this.setCheckpointsStatus('Restoring...');
        try {
            const data = await this.ws('config_editor_checkpoints_restore', { checkpointId, createSafetyCheckpoint: true });
            if (data?.success) {
                this.setCheckpointsStatus('Restored');
                await this.loadCheckpointsList();
                await this.refresh();
            } else this.setCheckpointsStatus('Restore failed');
        } catch (err) {
            console.error('config_editor_checkpoints_restore:', err);
            this.setCheckpointsStatus('Restore failed');
            await this.msg(`The checkpoint could not be restored.\nDetails: ${err.message || err}`, 'Restore Checkpoint', 'error');
        }
    }

    async requestDeleteCheckpoint(checkpointId) {
        const cp = this.checkpointsCache.find((c) => c.id === checkpointId);
        const label = cp?.label || cp?.reason || checkpointId?.slice(0, 8) || 'checkpoint';
        const ok = await this.msg(`Are you sure you want to permanently delete the checkpoint ${label}?`, 'Confirm Checkpoint Delete', 'warning', 'yesno');
        if (ok !== 'yes') return;
        this.setCheckpointsStatus('Deleting...');
        try {
            await this.ws('config_editor_checkpoints_delete', { checkpointId });
            this.setCheckpointsStatus('Deleted');
            await this.loadCheckpointsList();
        } catch (err) {
            console.error('config_editor_checkpoints_delete:', err);
            this.setCheckpointsStatus('Delete failed');
        }
    }
}

const configEditorApplet = new ConfigEditorApplet();
configEditorApplet.init();
window.configEditorApplet = configEditorApplet;
