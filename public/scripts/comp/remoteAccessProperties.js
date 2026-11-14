/**
 * Remote Access Properties (Yukimi 2026-10-21: "Update the Remote Access page to open a properties
 * dialog to configure the settings like windows does for remote desktop"): Vista's System
 * Properties > Remote tab (sysdm.cpl.mui dialog 9002), measured on the Vista Aero VM, with
 * Remote Access's settings in its places:
 *
 *   Remote Assistance  -> Priority Client: register this window for agents (agentClientBridge.js
 *                         setAgentPriorityClient). Advanced... is Vista's Remote Assistance
 *                         Settings (racpldlg.dll.mui 503): Auto Generate and the prints per turn.
 *   Remote Desktop     -> Generation: the three radio buttons are the default generation method
 *                         (detached / studio / auto). Select Users... becomes Open With..., a
 *                         Remote Desktop Users-sized dialog (remotepg 513) that picks where
 *                         generated images open (Ledge / Lumen / Glancewell / do not open).
 *
 * Opened by Control Panel's Remote Access item, System's "Remote settings" and every
 * openRemoteAccessSettingsModal() caller (Start menu, desktop menu, Run). Changes go to a pending
 * copy; Apply / OK save them (persistRemoteAccessSettingsPatch, modalUtils.js), Cancel drops them.
 *
 * MCP Connector tab (#828, Yukimi: "MCP Connector is moved as a tab in Remote Access, system
 * message template is in a separate window via a button on that tab"): what the MCP Connector DSAP
 * (dsap://mcp.dreamscape.jp/, which now opens this tab) showed - the live connector URLs and scopes
 * from resolve_grimoire_url (modules/mcpServerInfo.js buildMcpConnectorGrimPage), each read-only
 * with Copy, and the LinkXi persona link. Template... opens System Message Template, the Grok
 * project instructions in a Notepad-like edit; administrators can change or restore them
 * (get_ / save_mcp_project_instructions, modules/mcpProjectInstructions.js).
 *
 * The sheet uses Taskbar Properties' Vista controls (public/css/taskbar-properties.css, tbp-*);
 * its own sizes are in public/css/remote-access-properties.css.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ICONS = '/static_images/app_icons/16';
    const METHODS = ['detached', 'studio', 'auto'];
    const OPEN_WITH = [
        { id: 'ledge', name: 'Ledge', icon: `${ICONS}/stack.webp`, text: 'One desk that holds several prints.' },
        { id: 'lumen', name: 'Lumen', icon: `${ICONS}/vista-photo-viewer.webp`, text: 'A viewer window for each print.' },
        { id: 'glancewell', name: 'Glancewell', icon: `${ICONS}/vista-photo-gallery.webp`, text: 'The gallery slideshow, opened at the print.' },
        { id: 'disabled', name: 'Do not open', icon: '', text: 'Prints are saved to the gallery and nothing opens.' }
    ];
    const PRINTS = [1, 2, 3, 4, 5, 6, 7, 8];
    const TABS = [
        { id: 'remote', label: 'Remote' },
        { id: 'mcp', label: 'MCP Connector' }
    ];
    const MCP_DSAP_URL = 'dsap://mcp.dreamscape.jp/';
    // the MCP Connector tab's read-only fields: [id, label, page data key]
    const MCP_FIELDS = [
        ['url', 'Connector <u>U</u>RL:', 'connectorUrl'],
        ['mcp', '<u>M</u>CP path:', 'mcpUrl'],
        ['authorize', '<u>A</u>uthorize URL:', 'oauthAuthorize'],
        ['token', 'To<u>k</u>en URL:', 'oauthToken'],
        ['scopes', '<u>S</u>copes:', 'scopes'],
        ['recommended', '<u>R</u>ecommended:', 'recommendedScopes']
    ];
    const MCP_DEFAULT_SCOPES = 'generation gallery workspace chat';

    // dialog units -> px (MS Shell Dlg 8 at 96 dpi: x * 6/4, y * 13/8), as the VM places them:
    // edges round, except a bottom edge, which drops its fraction (the Remote tab's Remote Desktop
    // frame ends at 352 px, not 353; Remote Assistance Settings' check box centres in 16 px, not 17).
    // inset pulls a push button's face 1 px inside its rectangle (taskbarProperties.js dlu())
    function bottomPx(y, h) {
        return Math.floor((y + h) * 1.625);
    }

    function dlu(x, y, w, h, inset = 0) {
        const left = Math.round(x * 1.5);
        const top = Math.round(y * 1.625);
        let s = `left:${left + inset}px;top:${top + inset}px;`;
        if (w !== undefined) s += `width:${Math.round((x + w) * 1.5) - left - 2 * inset}px;`;
        if (h !== undefined) s += `height:${bottomPx(y, h) - top - 2 * inset}px;`;
        return s;
    }

    /** A check box row: the 13 px box centred in the control's height, as BS_VCENTER draws it. */
    function checkStyle(x, y, w, h) {
        const top = Math.round(y * 1.625);
        const height = bottomPx(y, h) - top;
        return `${dlu(x, y, w, h)}padding-top:${Math.max(0, Math.floor((height - 13) / 2))}px;`;
    }

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    // modalUtils.js keeps Remote Access's state as classic-script globals (not window properties)
    /* global remoteAccessSettingsState, persistRemoteAccessSettingsPatch, loadUserGlobalSettingsFromServer,
       applyRemoteAccessSettingsToState */

    // ---- state ---------------------------------------------------------------------------------

    function readState() {
        const st = typeof remoteAccessSettingsState !== 'undefined' && remoteAccessSettingsState ? remoteAccessSettingsState : {};
        const min = Number(st.minPrintsPerTurn) || 1;
        const max = Number(st.maxPrintsPerTurn) || 8;
        return {
            priority: typeof root.isAgentPriorityClient === 'function' && root.isAgentPriorityClient() === true,
            method: METHODS.includes(st.defaultGenerationMethod) ? st.defaultGenerationMethod : 'studio',
            autoGenerate: st.autoGenerate === true,
            openGenerated: OPEN_WITH.some((o) => o.id === st.openGeneratedImages) ? st.openGeneratedImages : 'ledge',
            minPrints: Math.min(8, Math.max(1, min)),
            maxPrints: Math.min(8, Math.max(1, max))
        };
    }

    let dlg = null; // { modal, content, saved, pending, dirty, sub, tab, mcp }
    let tpl = null; // the System Message Template window: { modal, content, data, admin, dirty }

    // ---- markup --------------------------------------------------------------------------------

    /** Taller than one line: BS_MULTILINE, the text wraps beside the box. */
    function multi(h) {
        return h > 10 ? ' rap-multi' : '';
    }

    function check(id, x, y, w, h, label) {
        return `<div class="tbp-ctl tbp-check${multi(h)}" style="${checkStyle(x, y, w, h)}"><input type="checkbox" id="rap-${id}"><label for="rap-${id}"><span>${label}</span></label></div>`;
    }

    /** The Remote tab's radio buttons are BS_TOP: the circle and the first line at the control's top. */
    function radio(id, x, y, w, h, value, label) {
        return `<div class="tbp-ctl tbp-check rap-top${multi(h)}" style="${dlu(x, y, w, h)}"><input type="radio" id="rap-${id}" name="rap-method" value="${value}"><label for="rap-${id}"><span>${label}</span></label></div>`;
    }

    function group(x, y, w, h, label) {
        return `<div class="tbp-group" style="${dlu(x, y, w, h)}"><span class="tbp-group-label">${label}</span></div>`;
    }

    function text(x, y, w, h, body, cls = '') {
        return `<div class="tbp-ctl tbp-static ${cls}" style="${dlu(x, y, w, h)}">${body}</div>`;
    }

    function button(x, y, w, h, label, action) {
        return `<button type="button" class="tbp-ctl tbp-button" style="${dlu(x, y, w, h, 1)}" data-action="${action}">${label}</button>`;
    }

    function link(x, y, w, h, label, action) {
        return `<div class="tbp-ctl tbp-link-row" style="${dlu(x, y, w, h)}"><button type="button" class="tbp-link" data-action="${action}">${label}</button></div>`;
    }

    function printsSelect(cls, x, y, value, label) {
        // a combo box's height is the font's (21 px), not the template's
        return `<select class="tbp-ctl tbp-select ${cls}" style="${dlu(x, y, 42)}" aria-label="${label}">${PRINTS.map((n) => `<option value="${n}"${n === value ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
    }

    /** The Remote tab, on dialog 9002's grid. */
    function pageRemote() {
        return `
            ${group(6, 6, 244, 76, 'Priority Client')}
            ${check('priority', 12, 20, 232, 16, 'Make this window the <u>p</u>riority client for agents')}
            ${link(12, 45, 165, 18, 'What does the priority client do?', 'help-priority')}
            ${button(181, 60, 62, 14, 'Ad<u>v</u>anced...', 'advanced')}
            ${group(6, 93, 244, 124, 'Generation')}
            ${text(12, 111, 219, 8, 'Click an option, and then choose where prints open, if needed.')}
            ${radio('detached', 12, 130, 196, 10, 'detached', '<u>D</u>etached requests: generate without Studio')}
            ${radio('studio', 12, 148, 196, 17, 'studio', 'Use the Studio app on the bound window (agents fi<u>l</u>l in Studio and press Generate)')}
            ${radio('auto', 12, 172, 196, 17, 'auto', 'Let the agent choose for each request (Studio when it is open, <u>o</u>therwise detached)')}
            ${link(12, 200, 120, 14, 'Help me choose', 'help-method')}
            ${button(181, 196, 62, 14, '<u>O</u>pen With...', 'open-with')}`;
    }

    /** A read-only edit (ES_READONLY: the dialog face behind the text) and its Copy button. */
    function copyRow(id, label, y) {
        return `
            <label class="tbp-ctl tbp-static" for="rap-mcp-${id}" style="${dlu(12, y + 2, 58, 8)}">${label}</label>
            <input type="text" class="tbp-ctl tbp-edit rap-readonly" id="rap-mcp-${id}" readonly spellcheck="false" style="${dlu(72, y, 132, 12)}">
            ${button(208, y - 1, 36, 14, 'Copy', `copy:${id}`)}`;
    }

    /** The MCP Connector tab, on the Remote tab's grid (256 x 226 DLU). */
    function pageMcp() {
        return `
            ${group(6, 6, 244, 148, 'Grok Custom Connector')}
            ${text(12, 18, 232, 16, 'In Grok, add a custom connector with these addresses. The path is unlisted; do not share it.')}
            ${MCP_FIELDS.map(([id, label], i) => copyRow(id, label, 38 + i * 18)).join('')}
            ${group(6, 160, 244, 44, 'Project Instructions')}
            ${text(12, 173, 165, 24, 'The system message for a Grok project that uses this connector.')}
            ${button(181, 182, 62, 14, '<u>T</u>emplate...', 'template')}
            ${link(6, 211, 200, 10, 'Edit the LinkXi persona that agents read', 'linkxi')}`;
    }

    // ---- the window ----------------------------------------------------------------------------

    function el(tag, className, textContent) {
        const n = doc.createElement(tag);
        if (className) n.className = className;
        if (textContent !== undefined) n.textContent = textContent;
        return n;
    }

    /** A Vista dialog window (light client, 7.css controls) with only the close box. */
    function makeWindow(id, title, clientClass, iconSrc = '') {
        const modal = el('div', `modal hidden on-top tbp-window rap-window ${clientClass}-window`);
        modal.id = id;
        modal.dataset.windowIdentifier = id;
        modal.dataset.windowRestorePosition = 'false';
        modal.dataset.windowRestoreSize = 'false';
        modal.dataset.windowFixedSize = 'true';
        modal.dataset.vistaDialog = 'form';
        // as in Vista, a property sheet has no caption icon; the taskbar button still gets one (modalUtils.js)
        if (!iconSrc) modal.dataset.captionIcon = 'none';
        modal.dataset.windowClient = 'light';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', title);
        const cap = el('div', 'modal-window-title');
        const main = el('div', 'modal-window-title-main');
        if (iconSrc) {
            const img = el('img', 'icon-image');
            img.alt = '';
            img.src = iconSrc;
            main.appendChild(img);
        }
        main.appendChild(el('span', '', title));
        cap.appendChild(main);
        const controls = el('div', 'modal-window-controls');
        const close = el('button', 'btn-danger close-btn btn-small');
        close.type = 'button';
        close.title = 'Close';
        const x = el('i', 'fa-regular fa-xmark-large');
        x.setAttribute('aria-hidden', 'true');
        close.appendChild(x);
        controls.appendChild(close);
        const content = el('div', `modal-content win7 tbp-client ${clientClass}`);
        modal.append(cap, el('div', 'modal-focus-overlay'), controls, content);
        doc.body.appendChild(modal);
        return { modal, content, close };
    }

    function showWindow(modal, owner) {
        // a sheet without its own icon shows its owner's on the taskbar button (ensureModalApplicationIcon)
        if (owner && owner.id) modal.dataset.iconOwnerId = owner.id;
        callGlobal('openModal', modal);
        if (modal.classList.contains('hidden')) modal.classList.remove('hidden');
        // centred over the owner (or the screen), as Vista places a property sheet
        root.requestAnimationFrame(() => {
            const r = modal.getBoundingClientRect();
            let cx = root.innerWidth / 2;
            let cy = (root.innerHeight - 35) / 2;
            if (owner) {
                const o = owner.getBoundingClientRect();
                cx = o.left + o.width / 2;
                cy = o.top + o.height / 2;
            }
            const left = Math.max(0, Math.round(cx - r.width / 2));
            const top = Math.max(0, Math.round(cy - r.height / 2));
            callGlobal('setModalOffsetsFromViewportTopLeft', modal, left, top);
        });
    }

    function closeWindow(modal) {
        if (!modal) return;
        try {
            callGlobal('closeModal', modal);
        } catch (_) { /* window manager gone */ }
        setTimeout(() => { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 400);
    }

    function buildSheet() {
        const { modal, content, close } = makeWindow('remoteAccessPropertiesDialog', 'Remote Access Properties', 'rap-sheet');
        content.innerHTML = `
            <div class="tbp-tabs" role="tablist">
                ${TABS.map((t) => `<button type="button" class="tbp-tab" role="tab" data-tab="${t.id}" aria-selected="false">${t.label}</button>`).join('')}
            </div>
            <div class="tbp-pane">
                <div class="tbp-page" data-page="remote" role="tabpanel">${pageRemote()}</div>
                <div class="tbp-page" data-page="mcp" role="tabpanel" hidden>${pageMcp()}</div>
            </div>
            <div class="tbp-footer">
                <button type="button" class="tbp-button tbp-footer-button" data-action="ok" data-dialog-primary="1">OK</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="cancel">Cancel</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="apply" disabled>Apply</button>
            </div>`;
        close.addEventListener('click', () => finish());
        content.addEventListener('click', onClick);
        content.addEventListener('change', onChange);
        modal.addEventListener('keydown', onKey);
        return { modal, content };
    }

    function syncControls() {
        const c = dlg.content;
        const p = dlg.pending;
        c.querySelector('#rap-priority').checked = p.priority;
        c.querySelectorAll('input[name="rap-method"]').forEach((r) => { r.checked = r.value === p.method; });
    }

    function selectTab(tab) {
        if (!TABS.some((t) => t.id === tab)) tab = 'remote';
        dlg.tab = tab;
        dlg.content.querySelectorAll('.tbp-tab').forEach((b) => {
            const on = b.dataset.tab === tab;
            b.classList.toggle('is-selected', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
        });
        dlg.content.querySelectorAll('.tbp-page').forEach((p) => { p.hidden = p.dataset.page !== tab; });
        dlg.modal.dataset.tab = tab;
        if (tab === 'mcp' && !dlg.mcp) void loadMcp();
    }

    // ---- MCP Connector -------------------------------------------------------------------------

    /** The connector page as the server builds it (the DSAP's data), or null. */
    async function fetchConnectorPage() {
        if (typeof wsClient === 'undefined' || !wsClient || typeof wsClient.sendMessage !== 'function') return null;
        // sendMessage: public/scripts/websocket.js; the page: modules/mcpServerInfo.js
        const result = await wsClient.sendMessage('resolve_grimoire_url', { url: MCP_DSAP_URL }, false);
        return result && result.page && result.page.data ? result.page.data : null;
    }

    function fillMcp(page) {
        if (!dlg) return;
        const data = page || {};
        MCP_FIELDS.forEach(([id, , key]) => {
            const input = dlg.content.querySelector(`#rap-mcp-${id}`);
            if (!input) return;
            let value = data[key] || '';
            if (!value && key === 'scopes') value = MCP_DEFAULT_SCOPES;
            input.value = value;
            input.placeholder = page ? 'Not set up on this server' : 'Unavailable';
            const copy = dlg.content.querySelector(`[data-action="copy:${id}"]`);
            if (copy) copy.disabled = !value;
        });
    }

    async function loadMcp() {
        if (!dlg) return;
        dlg.mcp = { loading: true };
        fillMcp({});
        let page = null;
        try {
            page = await fetchConnectorPage();
        } catch (err) {
            console.warn('Remote Access Properties: could not load the connector addresses', err);
        }
        if (!dlg) return;
        dlg.mcp = { page };
        fillMcp(page);
    }

    async function copyText(textValue, input) {
        if (!textValue) return false;
        if (input) {
            input.focus();
            input.select();
        }
        try {
            // writeClipboard: public/scripts/utils/dreamscapeClipboard.js
            if (typeof writeClipboard === 'function') await writeClipboard({ text: textValue });
            else await root.navigator.clipboard.writeText(textValue);
            return true;
        } catch (err) {
            console.warn('Remote Access Properties: copy failed', err);
            return false;
        }
    }

    function copyField(id) {
        const input = dlg && dlg.content.querySelector(`#rap-mcp-${id}`);
        if (input) void copyText(input.value, input);
    }

    function openLinkXi() {
        // Enshutsuka's persona page (enshutsukaConsole), else the old DSAP page
        if (typeof root.openEnshutsukaConsole === 'function') {
            root.openEnshutsukaConsole('persona');
            return;
        }
        // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js (follows the page's opensApp)
        callGlobal('openDsapInGrimoire', 'dsap://xi.dyna.dreamscape.jp/persona');
    }

    function setDirty(on) {
        dlg.dirty = on;
        const apply = dlg.content.querySelector('[data-action="apply"]');
        if (apply) apply.disabled = !on;
    }

    function onChange(ev) {
        const t = ev.target;
        if (t.id === 'rap-priority') dlg.pending.priority = t.checked;
        else if (t.name === 'rap-method' && t.checked) dlg.pending.method = t.value;
        else return;
        setDirty(true);
    }

    function help() {
        // Help and Support is the Grimoire (modalUtils.js start menu places)
        callGlobal('openGrimoireApplet');
    }

    function onClick(ev) {
        const tab = ev.target.closest('.tbp-tab');
        if (tab) {
            selectTab(tab.dataset.tab);
            return;
        }
        const b = ev.target.closest('[data-action]');
        if (!b || b.disabled) return;
        if (b.dataset.action.startsWith('copy:')) {
            copyField(b.dataset.action.slice(5));
            return;
        }
        switch (b.dataset.action) {
            case 'template': void openTemplate(); break;
            case 'linkxi': openLinkXi(); break;
            case 'ok': void ok(); break;
            case 'cancel': finish(); break;
            case 'apply': void applyPending(); break;
            case 'advanced': openAdvanced(); break;
            case 'open-with': openOpenWith(); break;
            case 'help-priority':
            case 'help-method': help(); break;
            default: break;
        }
    }

    function onKey(ev) {
        if (!dlg || dlg.sub) return;
        if (ev.key === 'Escape') {
            ev.preventDefault();
            finish();
        } else if (ev.key === 'Enter' && !ev.target.matches('button, select, textarea')) {
            ev.preventDefault();
            void ok();
        } else if (ev.ctrlKey && (ev.key === 'Tab' || ev.key === 'PageDown' || ev.key === 'PageUp')) {
            // Ctrl+Tab / Ctrl+PageDown walk the tabs, as in Vista (on the desktop Ctrl+Tab is also
            // the window switcher, keyboardShortcuts.js, which takes it first)
            ev.preventDefault();
            ev.stopPropagation();
            const back = ev.key === 'PageUp' || (ev.key === 'Tab' && ev.shiftKey);
            const i = TABS.findIndex((t) => t.id === dlg.tab);
            selectTab(TABS[(i + (back ? TABS.length - 1 : 1)) % TABS.length].id);
        } else if (ev.target.matches('.tbp-tab') && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
            ev.preventDefault();
            const i = TABS.findIndex((t) => t.id === dlg.tab);
            selectTab(TABS[(i + (ev.key === 'ArrowLeft' ? TABS.length - 1 : 1)) % TABS.length].id);
            const on = dlg.content.querySelector('.tbp-tab.is-selected');
            if (on) on.focus();
        }
    }

    // ---- apply ---------------------------------------------------------------------------------

    async function applyPending() {
        const p = dlg.pending;
        const s = dlg.saved;
        const patch = {};
        if (p.method !== s.method) patch.defaultGenerationMethod = p.method;
        if (p.autoGenerate !== s.autoGenerate) patch.autoGenerate = p.autoGenerate;
        if (p.openGenerated !== s.openGenerated) patch.openGeneratedImages = p.openGenerated;
        if (p.minPrints !== s.minPrints) patch.minPrintsPerTurn = p.minPrints;
        if (p.maxPrints !== s.maxPrints) patch.maxPrintsPerTurn = p.maxPrints;
        const priorityChanged = p.priority !== s.priority;
        dlg.saved = { ...p };
        setDirty(false);
        // agentClientBridge.js: registers / releases this window with the server
        if (priorityChanged) callGlobal('setAgentPriorityClient', p.priority);
        if (!Object.keys(patch).length) return;
        try {
            if (typeof persistRemoteAccessSettingsPatch !== 'undefined') await persistRemoteAccessSettingsPatch(patch);
        } catch (err) {
            console.error('Remote Access Properties: saving to the server failed', err);
        }
    }

    async function ok() {
        if (dlg.dirty) await applyPending();
        finish();
    }

    function finish() {
        if (!dlg) return;
        if (dlg.sub) closeSub(false);
        const modal = dlg.modal;
        dlg = null;
        closeWindow(modal);
    }

    /** The settings as the server holds them, unless the sheet has changes of its own by then. */
    async function refreshFromServer() {
        if (typeof loadUserGlobalSettingsFromServer === 'undefined') return;
        let settings = null;
        try {
            settings = await loadUserGlobalSettingsFromServer();
        } catch (_) {
            return;
        }
        if (!dlg || dlg.dirty || !settings || !settings.remoteAccess) return;
        if (typeof applyRemoteAccessSettingsToState !== 'undefined') applyRemoteAccessSettingsToState(settings.remoteAccess);
        dlg.saved = readState();
        dlg.pending = { ...dlg.saved };
        syncControls();
    }

    /** Opens the sheet on a tab: 'remote' (the default) or 'mcp'. */
    function open(tab = 'remote') {
        if (!doc) return;
        if (dlg) {
            if (!dlg.sub) selectTab(tab);
            callGlobal('openModal', dlg.modal);
            return;
        }
        const saved = readState();
        const { modal, content } = buildSheet();
        dlg = { modal, content, saved, pending: { ...saved }, dirty: false, sub: null, tab, mcp: null };
        syncControls();
        selectTab(tab);
        showWindow(modal, null);
        void refreshFromServer();
    }

    // ---- sub-dialogs (modal to the sheet) ------------------------------------------------------

    function openSub(id, title, cls, html, onOk) {
        if (!dlg || dlg.sub) return null;
        const { modal, content, close } = makeWindow(id, title, cls);
        content.innerHTML = html;
        dlg.modal.setAttribute('inert', '');
        dlg.sub = { modal, content, onOk };
        close.addEventListener('click', () => closeSub(false));
        modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                closeSub(false);
            }
        });
        content.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-action]');
            if (!b || b.disabled) return;
            if (b.dataset.action === 'sub-ok') closeSub(true);
            else if (b.dataset.action === 'sub-cancel') closeSub(false);
        });
        showWindow(modal, dlg.modal);
        return dlg.sub;
    }

    function closeSub(accept) {
        if (!dlg || !dlg.sub) return;
        const sub = dlg.sub;
        if (accept && sub.onOk) {
            if (sub.onOk(sub.content) === false) return;
            setDirty(true);
            syncControls();
        }
        dlg.sub = null;
        dlg.modal.removeAttribute('inert');
        closeWindow(sub.modal);
        callGlobal('openModal', dlg.modal);
    }

    function okCancel(okX, cancelX, y) {
        return `${button(okX, y, 50, 14, 'OK', 'sub-ok')}${button(cancelX, y, 50, 14, 'Cancel', 'sub-cancel')}`;
    }

    /** Advanced...: Vista's Remote Assistance Settings (racpldlg.dll.mui 503, 277 x 181). */
    function openAdvanced() {
        const p = dlg.pending;
        const html = `
            ${text(13, 9, 253, 8, 'You can set limits for the use of Remote Access on this computer.')}
            ${group(13, 24, 252, 43, 'Studio')}
            <div class="tbp-ctl tbp-check" style="${checkStyle(28, 42, 225, 10)}"><input type="checkbox" id="rap-autogen"${p.autoGenerate ? ' checked' : ''}><label for="rap-autogen"><span><u>G</u>enerate after an agent changes Studio</span></label></div>
            ${group(13, 76, 252, 78, 'Prints')}
            ${text(28, 89, 192, 8, '<u>S</u>et how many prints an agent can make in one turn')}
            ${printsSelect('rap-min', 28, 102, p.minPrints, 'Fewest prints per turn')}
            ${text(73, 104, 8, 8, 'to', 'rap-to')}
            ${printsSelect('rap-max', 83, 102, p.maxPrints, 'Most prints per turn')}
            ${text(130, 104, 40, 8, 'prints')}
            ${text(28, 123, 225, 22, 'An agent asks for a number of prints; Dreamscape keeps it between these.')}
            ${okCancel(158, 214, 161)}`;
        const sub = openSub('remoteAccessSettingsDialog', 'Remote Access Settings', 'rap-settings', html, (content) => {
            const min = Number(content.querySelector('.rap-min').value) || 1;
            const max = Number(content.querySelector('.rap-max').value) || 8;
            dlg.pending.autoGenerate = content.querySelector('#rap-autogen').checked;
            dlg.pending.minPrints = Math.min(min, max);
            dlg.pending.maxPrints = Math.max(min, max);
            return true;
        });
        if (!sub) return;
        // the two limits stay in order, as Vista's paired combo boxes do
        const minSel = sub.content.querySelector('.rap-min');
        const maxSel = sub.content.querySelector('.rap-max');
        minSel.addEventListener('change', () => { if (Number(minSel.value) > Number(maxSel.value)) maxSel.value = minSel.value; });
        maxSel.addEventListener('change', () => { if (Number(maxSel.value) < Number(minSel.value)) minSel.value = maxSel.value; });
    }

    /** Open With...: where a detached print opens, in Remote Desktop Users' frame (remotepg 513, 250 x 172). */
    function openOpenWith() {
        let chosen = dlg.pending.openGenerated;
        const describe = (id) => (OPEN_WITH.find((o) => o.id === id) || OPEN_WITH[0]).text;
        const rows = OPEN_WITH.map((o) => `
            <div class="rap-list-row${o.id === chosen ? ' is-selected' : ''}" role="option" data-id="${o.id}"${o.id === chosen ? ' aria-selected="true"' : ''} tabindex="${o.id === chosen ? 0 : -1}">
                <span class="rap-list-icon">${o.icon ? `<img src="${o.icon}" alt="" width="16" height="16">` : ''}</span><span class="rap-list-name">${esc(o.name)}</span>
            </div>`).join('');
        const html = `
            ${text(7, 7, 236, 19, 'After a detached request, the new print opens on the window the agent is bound to, in:')}
            <div class="tbp-ctl tbp-list rap-list" style="${dlu(7, 26, 236, 58)}" role="listbox" aria-label="Open generated images with">${rows}</div>
            ${text(7, 88, 236, 10, esc(describe(chosen)), 'rap-openwith-desc')}
            ${text(7, 123, 236, 19, 'Every print is saved to the gallery; this only chooses what opens.')}
            ${okCancel(136, 193, 151)}`;
        const sub = openSub('remoteAccessOpenWithDialog', 'Open Generated Images', 'rap-openwith', html, () => {
            dlg.pending.openGenerated = chosen;
            return true;
        });
        if (!sub) return;
        const c = sub.content;
        const select = (row) => {
            if (!row) return;
            chosen = row.dataset.id;
            c.querySelectorAll('.rap-list-row').forEach((r) => {
                const on = r === row;
                r.classList.toggle('is-selected', on);
                // only the chosen row carries aria-selected (7.css colours any row that has it)
                if (on) r.setAttribute('aria-selected', 'true');
                else r.removeAttribute('aria-selected');
                r.tabIndex = on ? 0 : -1;
            });
            row.focus();
            c.querySelector('.rap-openwith-desc').textContent = describe(chosen);
        };
        c.addEventListener('click', (ev) => select(ev.target.closest('.rap-list-row')));
        c.addEventListener('dblclick', (ev) => {
            if (ev.target.closest('.rap-list-row')) closeSub(true);
        });
        c.querySelector('.rap-list').addEventListener('keydown', (ev) => {
            const rowsEls = [...c.querySelectorAll('.rap-list-row')];
            const i = rowsEls.findIndex((r) => r.dataset.id === chosen);
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                select(rowsEls[Math.min(rowsEls.length - 1, Math.max(0, i + (ev.key === 'ArrowDown' ? 1 : -1)))]);
            } else if (ev.key === 'Enter') {
                ev.preventDefault();
                closeSub(true);
            }
        });
    }

    // ---- System Message Template (a window of its own) -----------------------------------------

    const TEMPLATE_ID = 'mcpSystemMessageTemplateWindow';

    function setTemplateStatus(message) {
        const st = tpl && tpl.content.querySelector('.rap-tpl-status');
        if (st) st.textContent = message;
    }

    function describeTemplate() {
        if (!tpl || !tpl.data) return '';
        if (!tpl.admin) return 'Only an administrator can change the template.';
        if (tpl.dirty) return 'Changed. Click OK or Apply to save the template.';
        if (!tpl.data.custom) return 'This is the built-in template.';
        let when = '';
        try {
            if (tpl.data.updatedAt) when = ` on ${new Date(tpl.data.updatedAt).toLocaleString()}`;
        } catch (_) { /* no date */ }
        return `An administrator changed this template${when}.`;
    }

    function syncTemplate() {
        if (!tpl) return;
        const c = tpl.content;
        const edit = c.querySelector('.rap-tpl-edit');
        const data = tpl.data;
        edit.readOnly = !tpl.admin || !data;
        c.querySelector('[data-action="tpl-copy"]').disabled = !edit.value;
        c.querySelector('[data-action="tpl-default"]').disabled = !tpl.admin || !data || edit.value === data.defaultText;
        c.querySelector('[data-action="tpl-apply"]').disabled = !tpl.dirty;
        setTemplateStatus(data ? describeTemplate() : 'Loading the template...');
    }

    /** The template from the server: the admin call, else (not an administrator) the connector page's copy. */
    async function loadTemplate() {
        let data = null;
        let admin = false;
        try {
            const r = await wsClient.sendMessage('get_mcp_project_instructions', {}, false);
            if (r && typeof r.text === 'string') {
                data = r;
                admin = true;
            }
        } catch (_) { /* not an administrator, or the server predates the template */ }
        if (!data) {
            try {
                const page = (dlg && dlg.mcp && dlg.mcp.page) || await fetchConnectorPage();
                if (page && page.projectInstructions) data = { text: page.projectInstructions, defaultText: '', custom: false };
            } catch (_) { /* offline */ }
        }
        if (!tpl) return;
        if (!data) {
            setTemplateStatus('The template could not be loaded.');
            return;
        }
        tpl.data = data;
        tpl.admin = admin;
        tpl.dirty = false;
        tpl.content.querySelector('.rap-tpl-edit').value = data.text;
        syncTemplate();
    }

    async function saveTemplate(restoreDefault = false) {
        if (!tpl || !tpl.admin) return false;
        const edit = tpl.content.querySelector('.rap-tpl-edit');
        const payload = restoreDefault ? { restoreDefault: true } : { text: edit.value };
        setTemplateStatus('Saving...');
        try {
            const r = await wsClient.sendMessage('save_mcp_project_instructions', payload, false);
            if (!tpl) return true;
            if (r && typeof r.text === 'string') {
                tpl.data = r;
                tpl.dirty = false;
                edit.value = r.text;
                syncTemplate();
                return true;
            }
            throw new Error('The server did not answer.');
        } catch (err) {
            if (tpl) setTemplateStatus(`The template could not be saved. ${err && err.message ? err.message : ''}`.trim());
            return false;
        }
    }

    function closeTemplate() {
        if (!tpl) return;
        const modal = tpl.modal;
        tpl = null;
        closeWindow(modal);
    }

    function onTemplateClick(ev) {
        const b = ev.target.closest('[data-action]');
        if (!b || b.disabled || !tpl) return;
        const edit = tpl.content.querySelector('.rap-tpl-edit');
        switch (b.dataset.action) {
            case 'tpl-copy':
                void copyText(edit.value, null);
                break;
            case 'tpl-default':
                // into the edit, as a change OK or Apply saves (Cancel keeps the saved text)
                edit.value = tpl.data.defaultText;
                tpl.dirty = edit.value !== tpl.data.text;
                syncTemplate();
                break;
            case 'tpl-ok':
                if (!tpl.dirty) closeTemplate();
                else void saveTemplate(edit.value === tpl.data.defaultText).then((ok) => { if (ok) closeTemplate(); });
                break;
            case 'tpl-cancel':
                closeTemplate();
                break;
            case 'tpl-apply':
                void saveTemplate(edit.value === tpl.data.defaultText);
                break;
            default: break;
        }
    }

    /** Template...: System Message Template, the Grok project instructions in a Notepad-like edit. */
    async function openTemplate() {
        if (!doc) return;
        if (tpl) {
            callGlobal('openModal', tpl.modal);
            return;
        }
        const { modal, content, close } = makeWindow(TEMPLATE_ID, 'System Message Template', 'rap-template', `${ICONS}/vista-remote-access.webp`);
        content.innerHTML = `
            <div class="rap-tpl-intro">Paste this into the instructions of a Grok project that uses the DreamScape connector. Paste it again after each tools revision. Agents that connect get the same MCP rules.</div>
            <textarea class="rap-tpl-edit" spellcheck="false" wrap="soft" aria-label="System message template" readonly></textarea>
            <div class="rap-tpl-status" role="status"></div>
            <div class="tbp-footer rap-tpl-left">
                <button type="button" class="tbp-button tbp-footer-button" data-action="tpl-copy">Cop<u>y</u></button>
                <button type="button" class="tbp-button tbp-footer-button rap-tpl-default" data-action="tpl-default">Restore <u>D</u>efault</button>
            </div>
            <div class="tbp-footer rap-tpl-right">
                <button type="button" class="tbp-button tbp-footer-button" data-action="tpl-ok" data-dialog-primary="1">OK</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="tpl-cancel">Cancel</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="tpl-apply" disabled>Apply</button>
            </div>`;
        tpl = { modal, content, data: null, admin: false, dirty: false };
        close.addEventListener('click', () => closeTemplate());
        content.addEventListener('click', onTemplateClick);
        const edit = content.querySelector('.rap-tpl-edit');
        edit.addEventListener('input', () => {
            if (!tpl || !tpl.data) return;
            tpl.dirty = edit.value !== tpl.data.text;
            syncTemplate();
        });
        modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                closeTemplate();
            } else if (ev.key === 'Tab' && ev.target === edit && !edit.readOnly && !ev.ctrlKey && !ev.altKey) {
                // a tab character, as Notepad types one (Ctrl+Tab still moves on)
                ev.preventDefault();
                ev.stopPropagation();
                const start = edit.selectionStart;
                edit.setRangeText('\t', start, edit.selectionEnd, 'end');
                edit.dispatchEvent(new Event('input'));
            }
        });
        syncTemplate();
        showWindow(modal, dlg ? dlg.modal : null);
        await loadTemplate();
    }

    const api = {
        open,
        openTemplate,
        isOpen: () => !!dlg,
        _test: { readState, pageRemote, pageMcp, dlu, checkStyle, OPEN_WITH, MCP_FIELDS }
    };
    root.remoteAccessProperties = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
