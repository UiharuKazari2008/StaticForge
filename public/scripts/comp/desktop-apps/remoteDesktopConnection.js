/**
 * Remote Desktop Connection (Yukimi 2026-10-21): Vista's mstsc.exe dialog, measured on the Vista
 * Aero VM (mstsc.exe.mui dialog 15001, credential frame 15002, banner bitmaps 675-677 + 625 in
 * public/static_images/vista-mstsc/), for quick connections through Guacamole.
 *
 * Connect: Yukimi (2026-10-21) chose a Protocol drop-down under Computer instead of probing the
 * host. Typing a scheme (rdp:// ssh:// vnc://) or a well-known port (host:22, host:3389,
 * host:5900-5999) sets it; a history entry brings back its last protocol. Windows Security asks for
 * the credentials, then POST /api/desktop-guac/quick (modules/guacRemoteBridge.js) opens a
 * temporary session in Guacamole's quickconnect extension, shown in Remote Desktop Manager's
 * session window (openDesktopGuacFrame, guacRemote.js). Nothing is stored but the computer names
 * and their last protocol in the Computer box's history (this browser only). That window's Add to
 * Desktop saves { host, port, protocol } as a desktop shortcut; opening it runs connectTo, which
 * asks for the credentials again.
 *
 * Options >> (Yukimi 2026-10-22, #612) grows the window into mstsc's property sheet: General
 * (13020 with the credential frame 13033), Display (13021), Local Resources (13022), Programs
 * (13023), Experience (13024) and Advanced (15021), every position measured on the VM. Only what a
 * quickconnect session can honour is live: the User name (Windows Security starts from it) and the
 * Display slider (the session window's size, or full screen). The rest is drawn as Vista draws
 * it and is inert.
 *
 * Errors use mstsc's "Remote Desktop Disconnected" box (dialog 15003) and its own strings.
 * Styles: public/css/desktop-apps/remoteDesktopConnection.css on Taskbar Properties' Vista
 * controls (public/css/taskbar-properties.css, tbp-*).
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const HISTORY_KEY = 'remoteDesktopConnectionHistory';
    const HISTORY_MAX = 10;
    const PROTOCOL_KEY = 'remoteDesktopConnectionProtocols';
    const USER_KEY = 'remoteDesktopConnectionUserName';
    const DISPLAY_KEY = 'remoteDesktopConnectionDisplay';
    // the Protocol row (Yukimi's, not mstsc's) pushes everything under Computer down this far (px)
    const ROW = 31;
    // Options >> adds this much under the banner (the VM's client grows from 218 to 439 px)
    const GROW = 221;
    // the property sheet's tabs: unselected widths measured on the VM (mstsc.exe.mui 1087-1091, 13302)
    const TABS = [
        { id: 'general', label: 'General', width: 49 },
        { id: 'display', label: 'Display', width: 46 },
        { id: 'local', label: 'Local Resources', width: 92 },
        { id: 'programs', label: 'Programs', width: 56 },
        { id: 'experience', label: 'Experience', width: 65 },
        { id: 'advanced', label: 'Advanced', width: 59 }
    ];
    // the Display slider's stops on the VM's 1920x1200 screen, then Full Screen (null); here the
    // ones larger than this screen are left out, as mstsc leaves out what the monitor cannot show
    const SIZES = [[640, 480], [800, 600], [1024, 768], [1152, 864], [1280, 1024], [1600, 1200], [1680, 1050], [1920, 1200], null];
    const ICON = 'vista-remote-desktop.png';
    const PROTOCOLS = [
        { id: 'rdp', port: 3389, label: 'Remote Desktop (RDP)', icon: 'fab fa-windows' },
        { id: 'ssh', port: 22, label: 'Secure Shell (SSH)', icon: 'fas fa-terminal' },
        { id: 'vnc', port: 5900, label: 'Virtual Network Computing (VNC)', icon: 'fas fa-display' }
    ];
    // mstsc.exe.mui / mstscax.dll.mui strings
    const TEXT = {
        blank: 'The computer name field is blank. Enter a remote computer name.',
        invalid: 'The specified computer name contains invalid characters.\nFor assistance, contact your system administrator.',
        generic: 'This computer can\'t connect to the remote computer.\n\nTry connecting again. If the problem continues, contact the owner of the remote computer or your network administrator.',
        unavailable: 'This computer can\'t connect to the remote computer because quick connect is not available on the Remote Desktop Gateway. Contact your network administrator for assistance.',
        noServer: 'This computer can\'t connect to the remote computer because the Remote Desktop Gateway is temporarily unavailable. Try reconnecting later or contact your network administrator for assistance.',
        refused: 'This computer can\'t connect to the remote computer because the Remote Desktop Gateway refused the connection. Try connecting again. If the problem continues, contact your network administrator for assistance.',
        blocked: 'This computer can\'t connect to the remote computer.\n\nRemote connections to this computer are not allowed. Contact your network administrator for assistance.',
        denied: 'This computer can\'t connect to the remote computer because your user account is not allowed to use the Remote Desktop Gateway. Sign in with a full account, or contact your network administrator for assistance.',
        busy: 'This computer can\'t connect to the remote computer because there were too many connection attempts. Wait a minute, and then try connecting again.',
        asked: 'You will be asked for credentials when you connect.',
        // broken where Vista's GDI text breaks it
        blankHint: 'The computer name field is blank. Enter a full remote computer\nname.',
        cue: 'Example: computer.fabrikam.com',
        noUser: 'None specified',
        fullScreen: 'Full Screen'
    };

    let main = null; // { modal, content, input, list, protocol, user, busy, expanded, tab, size }

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function el(tag, className, textContent) {
        const n = doc.createElement(tag);
        if (className) n.className = className;
        if (textContent !== undefined) n.textContent = textContent;
        return n;
    }

    // Positions are pixels measured on the VM (mstsc's template is MS Shell Dlg 8 dialog units,
    // which Vista draws in Microsoft Sans Serif 8 pt)
    function px(left, top, width, height) {
        return `left:${left}px;top:${top}px;` + (width !== undefined ? `width:${width}px;` : '') + (height !== undefined ? `height:${height}px;` : '');
    }

    // ---- history (the Computer box's drop-down) --------------------------------------------------

    function readHistory() {
        try {
            const list = JSON.parse(root.localStorage.getItem(HISTORY_KEY) || '[]');
            return Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v).slice(0, HISTORY_MAX) : [];
        } catch (_) {
            return [];
        }
    }

    function readProtocols() {
        try {
            const map = JSON.parse(root.localStorage.getItem(PROTOCOL_KEY) || '{}');
            return map && typeof map === 'object' ? map : {};
        } catch (_) {
            return {};
        }
    }

    // the User name and the Display size, kept like mstsc's Default.rdp (this browser only)
    function readSetting(key, fallback) {
        try {
            const v = root.localStorage.getItem(key);
            return v === null ? fallback : v;
        } catch (_) {
            return fallback;
        }
    }

    function writeSetting(key, value) {
        try {
            root.localStorage.setItem(key, value);
        } catch (_) { /* private window: not kept */ }
    }

    function remember(computer, protocol) {
        const list = [computer].concat(readHistory().filter((v) => v.toLowerCase() !== computer.toLowerCase())).slice(0, HISTORY_MAX);
        const protocols = readProtocols();
        const kept = {};
        list.forEach((c) => { if (protocols[c.toLowerCase()]) kept[c.toLowerCase()] = protocols[c.toLowerCase()]; });
        kept[computer.toLowerCase()] = protocol;
        try {
            root.localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
            root.localStorage.setItem(PROTOCOL_KEY, JSON.stringify(kept));
        } catch (_) { /* private window: no history */ }
    }

    /** The drop-down follows the Computer box: a typed scheme or port, else the entry's last protocol. */
    function syncProtocol() {
        if (!main) return;
        const blank = !main.input.value.trim();
        main.content.querySelectorAll('.rdc-cred-hint').forEach((n) => { n.textContent = blank ? TEXT.blankHint : TEXT.asked; });
        main.content.querySelector('.rdc-save-creds').hidden = blank;
        const parsed = parseComputer(main.input.value);
        const last = readProtocols()[main.input.value.trim().toLowerCase()];
        const next = (!parsed.error && parsed.protocol) || last;
        if (next && PROTOCOLS.some((p) => p.id === next)) main.protocol.value = next;
    }

    // ---- computer name ---------------------------------------------------------------------------

    /** "host", "host:port", "[v6]:port", "rdp://host" -> { host, port, protocol } (protocol '' = ask). */
    function parseComputer(input) {
        let raw = String(input || '').trim();
        if (!raw) return { error: TEXT.blank };
        let protocol = '';
        const scheme = /^(rdp|ssh|vnc):\/\/(.*?)\/?$/i.exec(raw);
        if (scheme) {
            protocol = scheme[1].toLowerCase();
            raw = scheme[2];
        }
        let host = raw;
        let port = 0;
        const v6 = /^\[([0-9A-Fa-f:.]+)\](?::(\d{1,5}))?$/.exec(raw);
        if (v6) {
            host = v6[1];
            port = v6[2] ? Number(v6[2]) : 0;
        } else if ((raw.match(/:/g) || []).length === 1) {
            const m = /^([^:]+):(\d{1,5})$/.exec(raw);
            if (!m) return { error: TEXT.invalid };
            host = m[1];
            port = Number(m[2]);
        } else if (raw.indexOf(':') !== -1 && !/^[0-9A-Fa-f:.]+$/.test(raw)) {
            return { error: TEXT.invalid };
        }
        if (!/^[A-Za-z0-9.:-]+$/.test(host) || host.length > 253) return { error: TEXT.invalid };
        if (Number.isNaN(port) || port < 0 || port > 65535 || (port === 0 && /:0+$/.test(raw))) return { error: TEXT.invalid };
        if (!protocol && port) {
            if (port === 22) protocol = 'ssh';
            else if (port === 3389) protocol = 'rdp';
            else if (port >= 5900 && port <= 5999) protocol = 'vnc';
        }
        return { host, port, protocol };
    }

    // ---- windows ---------------------------------------------------------------------------------

    function titleBar(text, withIcon) {
        const cap = el('div', 'modal-window-title');
        const titleMain = el('div', 'modal-window-title-main');
        if (withIcon) {
            const glyph = el('i', 'fas fa-satellite-dish icon-fa');
            glyph.setAttribute('aria-hidden', 'true');
            const img = el('img', 'icon-image');
            img.alt = '';
            // resolveAppIconPath / buildAppIconSrcset: public/scripts/comp/modalUtils.js
            img.src = callGlobal('resolveAppIconPath', ICON) || '/static_images/app_icons/' + ICON;
            const srcset = callGlobal('buildAppIconSrcset', ICON);
            if (srcset) {
                img.setAttribute('srcset', srcset);
                img.setAttribute('sizes', '16px');
            }
            titleMain.append(glyph, img);
        }
        titleMain.appendChild(el('span', '', text));
        cap.appendChild(titleMain);
        return cap;
    }

    function captionButton(className, title, glyph) {
        const b = el('button', className);
        b.type = 'button';
        b.title = title;
        const i = el('i', glyph);
        i.setAttribute('aria-hidden', 'true');
        b.appendChild(i);
        return b;
    }

    /**
     * A Vista dialog with a light client (7.css controls). opts.appWindow: mstsc's own window
     * (caption icon, minimize, a greyed maximize); otherwise a dialog with only the close box
     * that takes its owner's taskbar icon.
     */
    function makeWindow(id, title, clientClass, opts = {}) {
        const modal = el('div', `modal hidden on-top tbp-window rdc-window ${clientClass}-window`);
        modal.id = id;
        modal.dataset.windowIdentifier = id;
        modal.dataset.windowRestorePosition = 'false';
        modal.dataset.windowRestoreSize = 'false';
        modal.dataset.windowFixedSize = 'true';
        modal.dataset.vistaDialog = 'form';
        modal.dataset.windowClient = 'light';
        if (!opts.appWindow) modal.dataset.captionIcon = 'none';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', title);
        const controls = el('div', 'modal-window-controls');
        if (opts.appWindow) {
            const min = captionButton('btn-secondary minimize-btn btn-small', 'Minimize', 'fa-regular fa-window-minimize');
            const max = captionButton('btn-secondary btn-small', 'Maximize', 'fa-regular fa-window-maximize');
            max.disabled = true;
            controls.append(min, max);
        }
        const close = captionButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
        controls.appendChild(close);
        const content = el('div', `modal-content win7 tbp-client rdc-client ${clientClass}`);
        modal.append(titleBar(title, !!opts.appWindow), el('div', 'modal-focus-overlay'), controls, content);
        doc.body.appendChild(modal);
        return { modal, content, close };
    }

    function centre(modal, owner) {
        root.requestAnimationFrame(() => {
            const r = modal.getBoundingClientRect();
            let cx = root.innerWidth / 2;
            let cy = (root.innerHeight - 35) / 2;
            if (owner && !owner.classList.contains('hidden')) {
                const o = owner.getBoundingClientRect();
                cx = o.left + o.width / 2;
                cy = o.top + o.height / 2;
            }
            callGlobal('setModalOffsetsFromViewportTopLeft', modal,
                Math.max(0, Math.round(cx - r.width / 2)), Math.max(0, Math.round(cy - r.height / 2)));
        });
    }

    function showWindow(modal, owner) {
        if (owner && owner.id) modal.dataset.iconOwnerId = owner.id;
        callGlobal('openModal', modal);
        modal.classList.remove('hidden');
        centre(modal, owner);
    }

    function closeWindow(modal) {
        if (!modal) return;
        try {
            callGlobal('closeModal', modal);
        } catch (_) { /* window manager gone */ }
        setTimeout(() => { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 400);
    }

    /** The banner across the top: icon, tile, swoosh, and the coloured rule under them. */
    function banner() {
        return `
            <div class="rdc-banner" aria-hidden="true">
                <span class="rdc-banner-text"><span class="rdc-banner-small">Remote Desktop</span><span class="rdc-banner-big">Connection</span></span>
            </div>
            <div class="rdc-banner-line" aria-hidden="true"></div>`;
    }

    // ---- a modal sub-dialog (Windows Security, Disconnected) -------- ----------------------------

    /** Resolves with the button's data-result, or null for Cancel / Esc / the close box. */
    function subDialog(id, title, cls, html, setup) {
        return new Promise((resolve) => {
            const owner = main && main.modal;
            const { modal, content, close } = makeWindow(id, title, cls);
            content.innerHTML = html;
            if (owner) owner.setAttribute('inert', '');
            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                if (owner) {
                    owner.removeAttribute('inert');
                    callGlobal('openModal', owner);
                }
                closeWindow(modal);
                resolve(value);
            };
            close.addEventListener('click', () => finish(null));
            content.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-result]');
                if (!b || b.disabled) return;
                finish(b.dataset.result === 'cancel' ? null : (setup && setup.read ? setup.read(content, b.dataset.result) : b.dataset.result));
            });
            modal.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    finish(null);
                } else if (ev.key === 'Enter' && !ev.target.matches('button')) {
                    ev.preventDefault();
                    const primary = content.querySelector('[data-default]');
                    if (primary && !primary.disabled) primary.click();
                }
            });
            showWindow(modal, owner);
            if (setup && setup.ready) setup.ready(content);
            const focus = content.querySelector('[autofocus]') || content.querySelector('[data-default]');
            if (focus) root.requestAnimationFrame(() => focus.focus());
        });
    }

    /** "Remote Desktop Disconnected" (mstsc.exe.mui 15003): error icon, text, OK. */
    function showError(message) {
        const html = `
            <div class="rdc-error-body">
                <div class="rdc-error-icon" aria-hidden="true"></div>
                <div class="rdc-error-text">${esc(message).replace(/\n/g, '<br>')}</div>
            </div>
            <div class="rdc-error-buttons">
                <button type="button" class="tbp-button rdc-error-button" data-result="ok" data-default>OK</button>
                <button type="button" class="tbp-button rdc-error-button" data-result="help"><u>H</u>elp</button>
            </div>`;
        return subDialog('remoteDesktopConnectionErrorDialog', 'Remote Desktop Disconnected', 'rdc-error', html, {
            read: (c, result) => {
                if (result === 'help') callGlobal('openGrimoireApplet');
                return result;
            }
        });
    }

    /** The domain credui names under the edits: one typed as DOMAIN\\user, else the computer's own
        name (its first label; an IP address stays whole). */
    function credentialDomain(host, username) {
        const slash = String(username || '').indexOf('\\');
        if (slash > 0) return username.slice(0, slash);
        return /^[\d.]+$/.test(host) || host.indexOf(':') !== -1 ? host : host.split('.')[0];
    }

    /** Windows Security (credui.dll): "Enter your credentials" for the remote computer. */
    function askCredentials(target) {
        const name = target.host;
        const vnc = target.protocol === 'vnc';
        const user = target.username || '';
        const html = `
            <div class="rdc-cred-heading">Enter your credentials</div>
            <div class="rdc-cred-text">These credentials will be used to connect to ${esc(name)}.</div>
            <div class="rdc-cred-rule"></div>
            <div class="rdc-cred-tile">
                <div class="rdc-cred-picture" aria-hidden="true"></div>
                <input type="text" class="rdc-cred-edit rdc-cred-user" placeholder="User name" aria-label="User name" autocomplete="off" spellcheck="false" value="${esc(user)}"${vnc || user ? '' : ' autofocus'}>
                <input type="password" class="rdc-cred-edit rdc-cred-pass" placeholder="Password" aria-label="Password" autocomplete="off"${vnc || user ? ' autofocus' : ''}>
                <div class="rdc-cred-domain">${vnc ? 'Leave the user name blank unless the computer asks for one.' : 'Domain: ' + esc(credentialDomain(name, user))}</div>
            </div>
            <div class="rdc-cred-footer">
                <button type="button" class="tbp-button rdc-cred-button" data-result="ok" data-default>OK</button>
                <button type="button" class="tbp-button rdc-cred-button" data-result="cancel">Cancel</button>
            </div>`;
        return subDialog('remoteDesktopConnectionCredentialDialog', 'Melaton Security', 'rdc-cred', html, {
            ready: (c) => {
                if (vnc) return;
                const user = c.querySelector('.rdc-cred-user');
                user.addEventListener('input', () => {
                    c.querySelector('.rdc-cred-domain').textContent = 'Domain: ' + credentialDomain(name, user.value);
                });
            },
            read: (c) => ({
                username: c.querySelector('.rdc-cred-user').value,
                password: c.querySelector('.rdc-cred-pass').value
            })
        });
    }

    // ---- Options >>: mstsc's property sheet -------------------------------------------------------
    // Page markup is in page coordinates, measured on the VM: a page's origin is the client's 10,103
    // (the pane 6,101 390x301 and the tabs from 8,83, as Taskbar Properties draws them). Button
    // positions are their faces, 1 px inside the rectangle. Controls Guacamole cannot honour carry
    // the inert attribute: drawn as Vista draws them, they take no input.

    function group(x, y, w, h, label) {
        return `<div class="tbp-group" style="${px(x, y, w, h)}"><span class="tbp-group-label">${label}</span></div>`;
    }

    function icon(x, y, name) {
        return `<div class="tbp-ctl rdc-opt-icon rdc-opt-${name}" style="${px(x, y, 32, 32)}" aria-hidden="true"></div>`;
    }

    function text(x, y, w, h, body, cls = '') {
        return `<div class="tbp-ctl tbp-static ${cls}" style="${px(x, y, w, h)}">${body}</div>`;
    }

    /** An inert check box: the 13 px box centred in the control's height (BS_VCENTER). */
    function check(x, y, w, h, label, checked, cls = '') {
        const id = 'rdcOpt' + (++check.seq);
        return `<div class="tbp-ctl tbp-check ${cls}" style="${px(x, y, w, h)}padding-top:${Math.floor((h - 13) / 2)}px;" inert><input type="checkbox" id="${id}"${checked ? ' checked' : ''}><label for="${id}"><span>${label}</span></label></div>`;
    }
    check.seq = 0;

    /** An inert drop-down list showing mstsc's default. */
    function combo(x, y, w, options, selected) {
        return `<select class="tbp-ctl tbp-select rdc-opt-select" style="${px(x, y, w, 21)}" inert>${options.map((o) => `<option${o === selected ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    }

    function button(x, y, w, label) {
        return `<button type="button" class="tbp-ctl tbp-button" style="${px(x, y, w, 21)}" inert>${label}</button>`;
    }

    function edit(x, y, w, h) {
        return `<input type="text" class="tbp-ctl rdc-opt-edit" style="${px(x, y, w, h)}" disabled inert>`;
    }

    function pageGeneral() {
        return `
            ${group(3, 7, 375, 181 + ROW, 'Logon settings')}
            ${icon(20, 26, 'logon')}
            ${text(65, 26, 300, 26, 'Enter the name of the remote computer.')}
            <label class="tbp-ctl tbp-static" style="${px(65, 54, 54, 13)}" for="rdcComputer"><u>C</u>omputer:</label>
            <label class="tbp-ctl tbp-static" style="${px(65, 54 + ROW, 54, 13)}" for="rdcProtocol"><u>P</u>rotocol:</label>
            <label class="tbp-ctl tbp-static" style="${px(65, 86 + ROW, 57, 13)}" for="rdcUserName">User name:</label>
            <input type="text" id="rdcUserName" class="tbp-ctl rdc-user-edit" style="${px(136, 83 + ROW, 218, 21)}" autocomplete="off" spellcheck="false" aria-label="User name">
            ${text(65, 116 + ROW, 294, 26, '', 'rdc-cred-hint')}
            ${check(65, 155 + ROW, 183, 15, 'Allow me to save c<u>r</u>edentials', false, 'rdc-save-creds')}
            ${group(3, 193 + ROW, 375, 84, 'Connection settings')}
            ${icon(20, 213 + ROW, 'connection')}
            ${text(65, 211 + ROW, 294, 26, 'Save the current connection settings to an RDP file or open a<br>saved connection.', 'rdc-lines')}
            ${button(66, 245 + ROW, 96, '<u>S</u>ave')}
            ${button(169, 245 + ROW, 96, 'Sa<u>v</u>e As...')}
            ${button(273, 245 + ROW, 96, 'Op<u>e</u>n...')}`;
    }

    function pageDisplay() {
        return `
            ${group(3, 7, 375, 114, '<u>R</u>emote desktop size')}
            ${icon(20, 26, 'display')}
            ${text(65, 26, 291, 26, 'Choose the size of your remote desktop. Drag the slider all the<br>way to the right to go fullscreen.', 'rdc-lines')}
            ${text(66, 62, 33, 13, 'Less')}
            <div class="tbp-ctl rdc-slider" style="${px(102, 59, 126, 31)}" role="slider" tabindex="0" aria-label="Remote desktop size">
                <div class="rdc-slider-track"></div>
                <div class="rdc-slider-ticks"></div>
                <div class="rdc-slider-thumb"></div>
            </div>
            ${text(234, 62, 63, 13, 'More')}
            ${text(110, 93, 109, 13, '', 'rdc-size-label')}
            ${group(3, 127, 375, 114, '<u>C</u>olors')}
            ${icon(20, 146, 'colors')}
            ${combo(65, 150, 169, ['256 Colors', 'High Color (15 bit)', 'High Color (16 bit)', 'True Color (24 bit)', 'Highest Quality (32 bit)'], 'Highest Quality (32 bit)')}
            <div class="tbp-ctl rdc-color-bar" style="${px(65, 177, 166, 15)}" aria-hidden="true"></div>
            ${text(65, 200, 300, 26, 'Note: Settings on the remote computer might override this<br>setting.', 'rdc-lines')}
            ${check(3, 250, 312, 19, '<u>D</u>isplay the connection bar when in full screen mode', true)}`;
    }

    function pageLocal() {
        return `
            ${group(3, 7, 375, 59, 'Remote com<u>p</u>uter sound')}
            ${icon(21, 24, 'sound')}
            ${combo(71, 29, 246, ['Bring to this computer', 'Leave at remote computer', 'Do not play'], 'Bring to this computer')}
            ${group(3, 70, 375, 80, '<u>K</u>eyboard')}
            ${icon(21, 86, 'keyboard')}
            ${text(71, 86, 258, 26, 'Apply Windows key combinations<br>(for example ALT+TAB)', 'rdc-lines')}
            ${combo(71, 120, 246, ['On the local computer', 'On the remote computer', 'In full screen mode only'], 'In full screen mode only')}
            ${group(3, 154, 375, 119, 'Local devices and resources')}
            ${icon(21, 171, 'devices')}
            ${text(71, 171, 300, 26, 'Select the devices and resources you want to use in your<br>remote session:', 'rdc-lines')}
            ${check(71, 208, 124, 13, 'Prin<u>t</u>ers', true)}
            ${check(210, 208, 125, 13, 'C<u>l</u>ipboard', true)}
            ${button(72, 235, 96, '<u>M</u>ore...')}`;
    }

    function pagePrograms() {
        return `
            ${group(3, 7, 375, 150, 'Start a program')}
            ${icon(20, 23, 'programs')}
            ${check(68, 26, 286, 19, '<u>S</u>tart the following program on connection', false)}
            ${text(68, 50, 282, 13, '<u>P</u>rogram path and file name:', 'is-disabled')}
            ${edit(68, 68, 282, 23)}
            ${text(68, 99, 282, 13, 'S<u>t</u>art in the following folder:', 'is-disabled')}
            ${edit(68, 117, 282, 23)}`;
    }

    function pageExperience() {
        const allow = [
            ['Desktop <u>b</u>ackground', 271, false], ['<u>F</u>ont smoothing', 271, false], ['<u>D</u>esktop composition', 271, false],
            ['<u>S</u>how contents of window while dragging', 277, false], ['<u>M</u>enu and window animation', 262, false],
            ['<u>T</u>hemes', 253, true], ['Bitm<u>a</u>p caching', 253, true]
        ];
        const tops = [96, 117, 138, 159, 180, 202, 223];
        return `
            ${group(3, 7, 375, 251, '<u>P</u>erformance')}
            ${icon(20, 26, 'experience')}
            ${text(65, 26, 301, 13, 'Choose your connection speed to optimize <u>p</u>erformance.')}
            ${combo(65, 46, 237, ['Modem (28.8 Kbps)', 'Modem (56 Kbps)', 'Broadband (128 Kbps - 1.5 Mbps)', 'LAN (10 Mbps or higher)', 'Custom'], 'Modem (56 Kbps)')}
            ${text(65, 76, 301, 13, 'Allow the following:')}
            ${allow.map(([label, w, on], i) => check(65, tops[i], w, 19, label, on)).join('')}
            ${check(3, 268, 254, 19, 'R<u>e</u>connect if connection is dropped', true)}`;
    }

    function pageAdvanced() {
        return `
            ${group(3, 7, 375, 176, 'Server authentication')}
            ${icon(20, 26, 'auth')}
            ${text(63, 24, 300, 65, 'Server authentication verifies that you are connecting to the<br>intended remote computer. The strength of the verification<br>required to connect is determined by your system security<br>policy.', 'rdc-lines')}
            ${text(63, 91, 300, 26, 'If the actual verification does not meet minimum policy<br>requirements:', 'rdc-lines')}
            ${combo(63, 122, 300, ['Connect and don\'t warn me', 'Warn me', 'Do not connect'], 'Warn me')}
            ${text(63, 153, 300, 13, '<span class="rdc-link">What are my server authentication options?</span>', 'rdc-link-row')}
            ${group(3, 189, 375, 87, 'Connect from anywhere')}
            ${icon(20, 210, 'gateway')}
            ${text(65, 208, 300, 26, 'Configure settings to connect through TS Gateway when I am<br>working remotely.', 'rdc-lines')}
            ${button(66, 243, 96, 'S<u>e</u>ttings...')}`;
    }

    // ---- the Display slider ----------------------------------------------------------------------

    /** The stops this screen can show: mstsc's sizes that fit it, then Full Screen. */
    function sizeStops() {
        const sw = (root.screen && root.screen.width) || 1920;
        const sh = (root.screen && root.screen.height) || 1200;
        return SIZES.filter((s, i) => !s || i === 0 || (s[0] <= sw && s[1] <= sh));
    }

    function readDisplay() {
        const saved = readSetting(DISPLAY_KEY, 'full');
        const m = /^(\d+)x(\d+)$/.exec(saved);
        return m ? [Number(m[1]), Number(m[2])] : null;
    }

    /** Thumb and ticks on the VM: a 99 px run from 8 px in, a stop every 99 / (stops - 1) px. */
    function renderSlider() {
        const stops = main.stops;
        const slider = main.content.querySelector('.rdc-slider');
        const last = stops.length - 1;
        const at = (i) => Math.round(99 * i / last);
        slider.querySelector('.rdc-slider-ticks').innerHTML = stops.map((s, i) =>
            `<i class="${i === 0 || i === last ? 'is-end' : ''}" style="left:${13 + at(i)}px"></i>`).join('');
        slider.querySelector('.rdc-slider-thumb').style.left = (8 + at(main.size)) + 'px';
        const size = stops[main.size];
        const label = size ? `${size[0]} by ${size[1]} pixels` : TEXT.fullScreen;
        main.content.querySelector('.rdc-size-label').textContent = label;
        slider.setAttribute('aria-valuemin', '0');
        slider.setAttribute('aria-valuemax', String(last));
        slider.setAttribute('aria-valuenow', String(main.size));
        slider.setAttribute('aria-valuetext', label);
    }

    function setSize(i) {
        main.size = Math.max(0, Math.min(main.stops.length - 1, i));
        const size = main.stops[main.size];
        writeSetting(DISPLAY_KEY, size ? size[0] + 'x' + size[1] : 'full');
        renderSlider();
    }

    function wireSlider() {
        const slider = main.content.querySelector('.rdc-slider');
        const thumb = slider.querySelector('.rdc-slider-thumb');
        const stopAt = (clientX) => {
            const r = slider.getBoundingClientRect();
            return Math.round((clientX - r.left - 13) / (99 / (main.stops.length - 1)));
        };
        slider.addEventListener('keydown', (ev) => {
            const step = { ArrowLeft: -1, ArrowUp: -1, PageUp: -1, ArrowRight: 1, ArrowDown: 1, PageDown: 1 }[ev.key];
            if (step) setSize(main.size + step);
            else if (ev.key === 'Home') setSize(0);
            else if (ev.key === 'End') setSize(main.stops.length - 1);
            else return;
            ev.preventDefault();
            ev.stopPropagation();
        });
        slider.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            ev.preventDefault();
            slider.focus();
            if (ev.target !== thumb) {
                // a click on the channel moves one stop toward it
                const to = stopAt(ev.clientX);
                if (to !== main.size) setSize(main.size + (to > main.size ? 1 : -1));
                return;
            }
            slider.setPointerCapture(ev.pointerId);
            slider.classList.add('is-dragging');
            const move = (e) => setSize(stopAt(e.clientX));
            const up = () => {
                slider.classList.remove('is-dragging');
                slider.removeEventListener('pointermove', move);
                slider.removeEventListener('pointerup', up);
                slider.removeEventListener('pointercancel', up);
            };
            slider.addEventListener('pointermove', move);
            slider.addEventListener('pointerup', up);
            slider.addEventListener('pointercancel', up);
        });
    }

    // ---- the main window -------------------------------------------------------------------------

    function buildMain() {
        const { modal, content, close } = makeWindow('remoteDesktopConnectionModal', 'Remote Desktop Connection', 'rdc-main', { appWindow: true });
        content.innerHTML = `
            ${banner()}
            <div class="rdc-options" hidden>
                <div class="tbp-tabs rdc-tabs" role="tablist">
                    ${TABS.map((t) => `<button type="button" class="tbp-tab" role="tab" data-tab="${t.id}" style="--rdc-tab-width:${t.width}px" aria-selected="false" tabindex="-1">${t.label}</button>`).join('')}
                </div>
                <div class="tbp-pane rdc-pane">
                    <div class="tbp-page" data-page="general" role="tabpanel">${pageGeneral()}</div>
                    <div class="tbp-page" data-page="display" role="tabpanel" hidden>${pageDisplay()}</div>
                    <div class="tbp-page" data-page="local" role="tabpanel" hidden>${pageLocal()}</div>
                    <div class="tbp-page" data-page="programs" role="tabpanel" hidden>${pagePrograms()}</div>
                    <div class="tbp-page" data-page="experience" role="tabpanel" hidden>${pageExperience()}</div>
                    <div class="tbp-page" data-page="advanced" role="tabpanel" hidden>${pageAdvanced()}</div>
                </div>
            </div>
            <label class="tbp-ctl tbp-static rdc-collapsed" style="${px(11, 91, 66, 13)}" for="rdcComputer"><u>C</u>omputer:</label>
            <div class="tbp-ctl rdc-combo" style="${px(81, 86, 237, 22)}">
                <input type="text" id="rdcComputer" class="rdc-combo-edit" autocomplete="off" spellcheck="false" placeholder="${TEXT.cue}" aria-label="Computer" role="combobox" aria-expanded="false" aria-controls="rdcComputerList">
                <button type="button" class="rdc-combo-drop" tabindex="-1" aria-label="Show history"></button>
                <div class="rdc-combo-list" id="rdcComputerList" role="listbox" hidden></div>
            </div>
            <label class="tbp-ctl tbp-static rdc-collapsed" style="${px(11, 91 + ROW, 66, 13)}" for="rdcProtocol"><u>P</u>rotocol:</label>
            <select id="rdcProtocol" class="tbp-ctl tbp-select rdc-protocol" style="${px(81, 86 + ROW, 237, 22)}" aria-label="Protocol">
                ${PROTOCOLS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}
            </select>
            <div class="tbp-ctl tbp-static rdc-collapsed" style="${px(11, 120 + ROW, 69, 13)}">User name:</div>
            <div class="tbp-ctl tbp-static rdc-collapsed rdc-user" style="${px(80, 120 + ROW, 231, 13)}">${TEXT.noUser}</div>
            <div class="tbp-ctl tbp-static rdc-collapsed rdc-cred-hint" style="${px(11, 146 + ROW, 294, 39)}"></div>
            <button type="button" class="tbp-ctl tbp-button rdc-foot" style="left:84px;width:73px;" data-action="connect" data-dialog-primary="1">Co<u>n</u>nect</button>
            <button type="button" class="tbp-ctl tbp-button rdc-foot rdc-cancel" style="left:162px;width:73px;" data-action="cancel">Cancel</button>
            <button type="button" class="tbp-ctl tbp-button rdc-foot" style="left:243px;width:73px;" data-action="help"><u>H</u>elp</button>
            <button type="button" class="tbp-ctl tbp-button rdc-foot" style="left:324px;width:73px;" data-action="options" aria-expanded="false"><u>O</u>ptions &gt;&gt;</button>`;
        const input = content.querySelector('#rdcComputer');
        const list = content.querySelector('.rdc-combo-list');
        const protocol = content.querySelector('#rdcProtocol');
        const user = content.querySelector('#rdcUserName');
        input.addEventListener('input', syncProtocol);
        user.addEventListener('input', syncUser);
        close.addEventListener('click', () => closeMain());
        content.addEventListener('click', (ev) => {
            const tab = ev.target.closest('.tbp-tab');
            if (tab) {
                selectTab(tab.dataset.tab, true);
                return;
            }
            const b = ev.target.closest('[data-action]');
            if (!b || b.disabled) return;
            if (b.dataset.action === 'connect') void connect();
            else if (b.dataset.action === 'cancel') closeMain();
            else if (b.dataset.action === 'help') callGlobal('openGrimoireApplet');
            else if (b.dataset.action === 'options') setExpanded(!main.expanded);
        });
        content.querySelector('.rdc-combo-drop').addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            toggleList(list.hidden);
            input.focus();
        });
        list.addEventListener('mousedown', (ev) => ev.preventDefault());
        list.addEventListener('click', (ev) => {
            const row = ev.target.closest('.rdc-combo-row');
            if (!row) return;
            if (row.dataset.browse) {
                toggleList(false);
                void browseForMore();
                return;
            }
            input.value = row.dataset.value;
            toggleList(false);
            syncProtocol();
        });
        input.addEventListener('blur', () => toggleList(false));
        modal.addEventListener('keydown', onMainKey);
        const stops = sizeStops();
        const saved = readDisplay();
        let size = stops.findIndex((s) => (s && saved ? s[0] === saved[0] && s[1] === saved[1] : s === saved));
        if (size < 0) size = stops.length - 1;
        return { modal, content, input, list, protocol, user, busy: false, expanded: false, tab: 'general', stops, size };
    }

    /** The collapsed window's "User name:" line follows the General tab's box. */
    function syncUser() {
        if (!main) return;
        main.content.querySelector('.rdc-user').textContent = main.user.value.trim() || TEXT.noUser;
    }

    /**
     * Options >> / Options <<: the window grows by GROW px from its top, and the Computer combo
     * and the Protocol drop-down move between the collapsed window and the General tab.
     */
    function setExpanded(on) {
        if (!main) return;
        main.expanded = on;
        toggleList(false);
        const c = main.content;
        c.classList.toggle('is-expanded', on);
        c.querySelector('.rdc-options').hidden = !on;
        c.querySelectorAll('.rdc-collapsed').forEach((n) => { n.hidden = on; });
        const comboBox = c.querySelector('.rdc-combo');
        const general = c.querySelector('[data-page="general"]');
        // (kept ahead of the User name box, or of the buttons, in the tab order)
        const before = on ? general.querySelector('label[for="rdcUserName"]') : c.querySelector('.rdc-foot');
        before.parentNode.insertBefore(comboBox, before);
        before.parentNode.insertBefore(main.protocol, before);
        comboBox.style.cssText = on ? px(135, 50, 218, 22) : px(81, 86, 237, 22);
        main.protocol.style.cssText = on ? px(135, 50 + ROW, 218, 22) : px(81, 86 + ROW, 237, 22);
        const options = c.querySelector('[data-action="options"]');
        options.innerHTML = on ? '<u>O</u>ptions &lt;&lt;' : '<u>O</u>ptions &gt;&gt;';
        options.setAttribute('aria-expanded', on ? 'true' : 'false');
        if (on) selectTab(main.tab, false);
        options.focus();
    }

    function selectTab(tab, focus) {
        if (!main) return;
        main.tab = tab;
        main.content.querySelectorAll('.rdc-tabs .tbp-tab').forEach((b) => {
            const sel = b.dataset.tab === tab;
            b.classList.toggle('is-selected', sel);
            b.setAttribute('aria-selected', sel ? 'true' : 'false');
            b.tabIndex = sel ? 0 : -1;
            if (sel && focus) b.focus();
        });
        main.content.querySelectorAll('.rdc-pane > .tbp-page').forEach((p) => { p.hidden = p.dataset.page !== tab; });
    }

    function toggleList(open) {
        if (!main) return;
        const { list, input } = main;
        if (open) {
            const history = readHistory();
            // mstsc ends the list with <Browse for more...>; here it opens Remote Desktop Manager
            list.innerHTML = history.map((h) => `<div class="rdc-combo-row" role="option" data-value="${esc(h)}">${esc(h)}</div>`).join('')
                + '<div class="rdc-combo-row" role="option" data-browse="1">&lt;Browse for more...&gt;</div>';
            const current = list.querySelector(`[data-value="${CSS.escape(input.value)}"]`);
            if (current) current.classList.add('is-selected');
        }
        list.hidden = !open;
        input.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    async function browseForMore() {
        // openDesktopGuac: public/scripts/comp/desktop-apps/guacRemote.js (featureLoader.js remote_desktop)
        if (root.featureLoader) await root.featureLoader.loadFeature('remote_desktop');
        callGlobal('openDesktopGuac');
    }

    function moveSelection(step) {
        const history = readHistory();
        if (!history.length) return;
        const i = history.findIndex((h) => h === main.input.value);
        const next = history[Math.min(history.length - 1, Math.max(0, i + step))];
        main.input.value = next;
        syncProtocol();
        main.list.querySelectorAll('.rdc-combo-row').forEach((r) => r.classList.toggle('is-selected', r.dataset.value === next));
        main.input.select();
    }

    function onMainKey(ev) {
        if (!main || main.modal.hasAttribute('inert')) return;
        if (ev.target === main.input && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
            ev.preventDefault();
            if (ev.altKey) toggleList(main.list.hidden);
            else moveSelection(ev.key === 'ArrowDown' ? 1 : -1);
            return;
        }
        if (ev.key === 'F4' && ev.target === main.input) {
            ev.preventDefault();
            toggleList(main.list.hidden);
            return;
        }
        if (ev.key === 'Escape') {
            ev.preventDefault();
            if (!main.list.hidden) toggleList(false);
            else closeMain();
        } else if (ev.key === 'Enter' && !ev.target.matches('button')) {
            ev.preventDefault();
            toggleList(false);
            void connect();
        } else if (ev.ctrlKey && main.expanded && (ev.key === 'Tab' || ev.key === 'PageDown' || ev.key === 'PageUp')) {
            // Ctrl+Tab / Ctrl+PageDown walk the property sheet's tabs
            ev.preventDefault();
            const back = ev.key === 'PageUp' || (ev.key === 'Tab' && ev.shiftKey);
            const i = TABS.findIndex((t) => t.id === main.tab);
            selectTab(TABS[(i + (back ? TABS.length - 1 : 1)) % TABS.length].id, ev.target.matches('.tbp-tab'));
        } else if (ev.target.matches('.rdc-tabs .tbp-tab') && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
            ev.preventDefault();
            const i = TABS.findIndex((t) => t.id === main.tab);
            selectTab(TABS[(i + (ev.key === 'ArrowLeft' ? TABS.length - 1 : 1)) % TABS.length].id, true);
        } else if (ev.altKey && !ev.ctrlKey) {
            const key = ev.key.toLowerCase();
            if (key === 'c') {
                if (main.expanded) selectTab('general', false);
                main.input.focus();
            } else if (key === 'p') {
                if (main.expanded) selectTab('general', false);
                main.protocol.focus();
            } else if (key === 'o') setExpanded(!main.expanded);
            else if (key === 'r' && main.expanded) {
                selectTab('display', false);
                main.content.querySelector('.rdc-slider').focus();
            }
            else if (key === 'n') void connect();
            else if (key === 'h') callGlobal('openGrimoireApplet');
            else return;
            ev.preventDefault();
        }
    }

    function setBusy(on) {
        if (!main) return;
        main.busy = on;
        main.content.querySelectorAll('[data-action="connect"], #rdcComputer, #rdcProtocol').forEach((n) => { n.disabled = on; });
        main.modal.classList.toggle('rdc-busy', on);
    }

    async function postJson(url, body) {
        const response = await fetch(url, {
            method: body ? 'POST' : 'GET',
            credentials: 'same-origin',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined
        });
        const payload = await response.json().catch(() => null);
        return { response, payload: payload || {} };
    }

    async function connect() {
        if (!main || main.busy) return;
        const typed = main.input.value.trim();
        const target = parseComputer(typed);
        if (target.error) {
            await showError(target.error);
            if (main) main.input.focus();
            return;
        }
        target.protocol = target.protocol || main.protocol.value;
        // the General tab's User name fills Windows Security's first box
        target.username = main.user.value.trim();
        // after an attempt mstsc's Cancel reads Close
        main.content.querySelector('.rdc-cancel').textContent = 'Close';
        setBusy(true);
        try {
            if (await quickConnect(target)) {
                remember(typed, target.protocol);
                // kept like mstsc keeps it in Default.rdp
                writeSetting(USER_KEY, target.username);
                closeMain();
            }
        } finally {
            setBusy(false);
        }
    }

    /**
     * Gateway check, Windows Security, POST /api/desktop-guac/quick, then the session window.
     * Shared by Connect and the desktop shortcuts the session bar makes (connectTo).
     */
    async function quickConnect(target) {
        // quick connect needs Guacamole's quickconnect extension on the gateway
        let status;
        try {
            status = await postJson('/api/desktop-guac/quick/status');
        } catch (_) {
            status = null;
        }
        if (status && status.response.status === 403) {
            await showError(TEXT.denied);
            return false;
        }
        if (!status || status.response.status === 404 || (status.payload.ok && !status.payload.available)) {
            await showError(TEXT.unavailable);
            return false;
        }
        if (!status.payload.ok) {
            await showError(TEXT.noServer);
            return false;
        }
        const creds = await askCredentials(target);
        if (!creds) return false;
        let result;
        try {
            result = await postJson('/api/desktop-guac/quick', {
                host: target.host,
                port: target.port || undefined,
                protocol: target.protocol,
                username: creds.username,
                password: creds.password
            });
        } catch (_) {
            await showError(TEXT.noServer);
            return false;
        }
        const p = result.payload;
        if (!result.response.ok || !p.ok || !p.url) {
            // modules/guacRemoteBridge.js codes; a 403 without one is the full-sign-in check
            const code = p.code || (result.response.status === 403 ? 'denied' : '');
            const known = ['unavailable', 'blank', 'invalid', 'refused', 'blocked', 'denied', 'busy'];
            await showError(known.includes(code) ? TEXT[code] : code === 'gateway' ? TEXT.noServer : TEXT.generic);
            return false;
        }
        openSession(p, target);
        return true;
    }

    /** A desktop shortcut's saved computer ({ host, port, protocol }); credentials are asked again. */
    async function connectTo(saved) {
        const host = String(saved && saved.host || '');
        const port = Number(saved && saved.port) || 0;
        const target = parseComputer(port ? (host.indexOf(':') !== -1 ? '[' + host + ']' : host) + ':' + port : host);
        if (target.error) {
            await showError(target.error);
            return false;
        }
        target.protocol = PROTOCOLS.some((p) => p.id === saved.protocol) ? saved.protocol : 'rdp';
        target.username = readSetting(USER_KEY, '');
        return quickConnect(target);
    }

    /** The session opens in Remote Desktop Manager's session window (guacRemote.js). */
    function openSession(p, target) {
        const proto = PROTOCOLS.find((x) => x.id === target.protocol) || PROTOCOLS[0];
        const key = 'quick:' + target.protocol + ':' + p.name.toLowerCase();
        const size = readDisplay();
        callGlobal('openDesktopGuacFrame', {
            key: key,
            modalId: 'desktopGuacSession_quick_' + key.replace(/[^A-Za-z0-9_-]/g, '_'),
            windowIdentifier: 'desktopGuacSession',
            title: p.name + ' - Remote Desktop',
            iconClass: proto.icon,
            protocol: target.protocol,
            image: ICON,
            url: p.url,
            // Options > Display: the remote desktop's size in pixels, or the full screen
            display: size ? { width: size[0], height: size[1] } : { fullScreen: true },
            // the session bar's Add to Desktop (guacRemote.js) saves the computer, never the credentials
            shortcut: {
                name: p.name,
                type: 'remote-desktop',
                data: { quick: { host: target.host, port: target.port || 0, protocol: target.protocol }, protocol: target.protocol }
            }
        });
    }

    function closeMain() {
        if (!main) return;
        const modal = main.modal;
        main = null;
        closeWindow(modal);
    }

    function open() {
        if (!doc) return;
        if (main) {
            if (main.modal.classList.contains('minimised')) callGlobal('restoreMinimizedModal', main.modal);
            callGlobal('openModal', main.modal);
            callGlobal('bringModalToFront', main.modal);
            return;
        }
        main = buildMain();
        main.input.value = readHistory()[0] || '';
        main.user.value = readSetting(USER_KEY, '');
        syncProtocol();
        syncUser();
        wireSlider();
        renderSlider();
        showWindow(main.modal, null);
        root.requestAnimationFrame(() => {
            if (!main) return;
            main.input.focus();
            main.input.select();
        });
    }

    const api = {
        open,
        connectTo,
        isOpen: () => !!main,
        _test: { parseComputer, readHistory, askCredentials, showError }
    };
    root.remoteDesktopConnection = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
