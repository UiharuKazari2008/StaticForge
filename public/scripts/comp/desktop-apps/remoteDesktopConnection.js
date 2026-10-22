/**
 * Remote Desktop Connection (Yukimi 2026-10-21): Vista's mstsc.exe dialog, measured on the Vista
 * Aero VM (mstsc.exe.mui dialog 15001, credential frame 15002, banner bitmaps 675-677 + 625 in
 * public/static_images/vista-mstsc/), for quick connections through Guacamole.
 *
 * Connect: the computer name may carry its protocol (rdp:// ssh:// vnc://) or a well-known port
 * (host:22, host:3389, host:5900-5999). Otherwise "Which connection do you want to use?" asks
 * (laid out on mstsc's "Who do you want to log on as?", dialog 13030). Windows Security asks for
 * the credentials, then POST /api/desktop-guac/quick (modules/guacRemoteBridge.js) opens a
 * temporary session in Guacamole's quickconnect extension, shown in Remote Desktop Manager's
 * session window (openDesktopGuacFrame, guacRemote.js). Nothing is stored but the computer names
 * in the Computer box's history (this browser only).
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
        notFound: 'This computer can’t connect to the remote computer.\n\nRemote Desktop cannot find the remote computer. Type the computer name or IP address again, and then try connecting. If the problem continues, contact the owner of the remote computer or your network administrator.',
        generic: 'This computer can\'t connect to the remote computer.\n\nTry connecting again. If the problem continues, contact the owner of the remote computer or your network administrator.',
        unavailable: 'This computer can\'t connect to the remote computer because quick connect is not available on the Remote Desktop Gateway. Contact your network administrator for assistance.',
        noServer: 'This computer can\'t connect to the remote computer because the Remote Desktop Gateway is temporarily unavailable. Try reconnecting later or contact your network administrator for assistance.',
        asked: 'You will be asked for credentials when you connect.'
    };

    let main = null; // { modal, content, input, list, busy }

    // dialog units -> px for MS Shell Dlg 8 (x * 6/4, y * 13/8): edges round, a bottom edge
    // drops its fraction, a push button's face sits 1 px inside its rectangle
    // (remoteAccessProperties.js dlu())
    function dlu(x, y, w, h, inset = 0) {
        const left = Math.round(x * 1.5);
        const top = Math.round(y * 1.625);
        let s = `left:${left + inset}px;top:${top + inset}px;`;
        if (w !== undefined) s += `width:${Math.round((x + w) * 1.5) - left - 2 * inset}px;`;
        if (h !== undefined) s += `height:${Math.floor((y + h) * 1.625) - top - 2 * inset}px;`;
        return s;
    }

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

    function button(x, y, w, h, label, action, extra = '') {
        return `<button type="button" class="tbp-ctl tbp-button" style="${dlu(x, y, w, h, 1)}" data-action="${action}"${extra}>${label}</button>`;
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

    function remember(computer) {
        const list = [computer].concat(readHistory().filter((v) => v.toLowerCase() !== computer.toLowerCase()));
        try {
            root.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
        } catch (_) { /* private window: no history */ }
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

    // ---- a modal sub-dialog (chooser, Windows Security, Disconnected) ----------------------------

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
            <div class="rdc-error-icon" aria-hidden="true"></div>
            <div class="tbp-ctl tbp-static rdc-error-text">${esc(message).replace(/\n/g, '<br>')}</div>
            <div class="rdc-error-buttons">
                <button type="button" class="tbp-button rdc-error-ok" data-result="ok" data-default>OK</button>
            </div>`;
        return subDialog('remoteDesktopConnectionErrorDialog', 'Remote Desktop Disconnected', 'rdc-error', html);
    }

    /** Which connection: mstsc's "Who do you want to log on as?" (13030) with one row per protocol. */
    function chooseProtocol(target) {
        const name = target.host + (target.port ? ':' + target.port : '');
        const rows = PROTOCOLS.map((p, i) => `
            <div class="tbp-ctl tbp-check rdc-choice" style="${dlu(17, 77 + i * 18, 236, 16)}">
                <input type="radio" name="rdc-protocol" id="rdc-protocol-${p.id}" value="${p.id}"${i === 0 ? ' checked autofocus' : ''}>
                <label for="rdc-protocol-${p.id}"><span>${p.label}${target.port ? '' : `, port ${p.port}`}</span></label>
            </div>`).join('');
        const bottom = 77 + PROTOCOLS.length * 18 + 3;
        const html = `
            ${banner()}
            <div class="tbp-ctl rdc-choice-icon" style="${dlu(13, 52, 20, 20)}" aria-hidden="true"></div>
            <div class="tbp-ctl tbp-static" style="${dlu(40, 56, 220, 16)}">Which connection do you want to use for ${esc(name)}?</div>
            ${rows}
            ${button(154, bottom, 50, 14, 'OK', '', ' data-result="ok" data-default')}
            ${button(209, bottom, 50, 14, 'Cancel', '', ' data-result="cancel"')}`;
        return subDialog('remoteDesktopConnectionChooserDialog', 'Remote Desktop Connection', 'rdc-chooser', html, {
            ready: (c) => { c.style.height = (Math.floor((bottom + 22) * 1.625)) + 'px'; },
            read: (c) => {
                const on = c.querySelector('input[name="rdc-protocol"]:checked');
                return on ? on.value : null;
            }
        });
    }

    /** Windows Security (credui.dll): "Enter your credentials" for the remote computer. */
    function askCredentials(target) {
        const name = target.host;
        const vnc = target.protocol === 'vnc';
        const html = `
            <div class="rdc-cred-body">
                <div class="rdc-cred-heading">Enter your credentials</div>
                <div class="rdc-cred-text">These credentials will be used to connect to ${esc(name)}.</div>
                <div class="rdc-cred-tile">
                    <div class="rdc-cred-picture" aria-hidden="true"></div>
                    <div class="rdc-cred-fields">
                        <input type="text" class="tbp-edit rdc-cred-user" placeholder="User name" aria-label="User name" autocomplete="off" spellcheck="false"${vnc ? '' : ' autofocus'}>
                        <input type="password" class="tbp-edit rdc-cred-pass" placeholder="Password" aria-label="Password" autocomplete="off"${vnc ? ' autofocus' : ''}>
                        ${vnc ? '<div class="rdc-cred-note">Leave the user name blank unless the computer asks for one.</div>' : ''}
                    </div>
                </div>
            </div>
            <div class="rdc-cred-footer">
                <button type="button" class="tbp-button rdc-cred-button" data-result="ok" data-default>OK</button>
                <button type="button" class="tbp-button rdc-cred-button" data-result="cancel">Cancel</button>
            </div>`;
        return subDialog('remoteDesktopConnectionCredentialDialog', 'Windows Security', 'rdc-cred', html, {
            read: (c) => ({
                username: c.querySelector('.rdc-cred-user').value,
                password: c.querySelector('.rdc-cred-pass').value
            })
        });
    }

    // ---- the main window -------------------------------------------------------------------------

    function buildMain() {
        const { modal, content, close } = makeWindow('remoteDesktopConnectionModal', 'Remote Desktop Connection', 'rdc-main', { appWindow: true });
        content.innerHTML = `
            ${banner()}
            <label class="tbp-ctl tbp-static" style="${dlu(7, 56, 44, 8)}" for="rdcComputer"><u>C</u>omputer:</label>
            <div class="tbp-ctl rdc-combo" style="${dlu(54, 53, 158)}">
                <input type="text" id="rdcComputer" class="rdc-combo-edit" autocomplete="off" spellcheck="false" aria-label="Computer" role="combobox" aria-expanded="false" aria-controls="rdcComputerList">
                <button type="button" class="rdc-combo-drop" tabindex="-1" aria-label="Show history"></button>
                <div class="rdc-combo-list" id="rdcComputerList" role="listbox" hidden></div>
            </div>
            <div class="tbp-group rdc-cred-frame" style="${dlu(7, 74, 206, 40)}"></div>
            <div class="tbp-ctl tbp-static" style="${dlu(13, 82, 38, 8)}">User name:</div>
            <div class="tbp-ctl tbp-static rdc-user" style="${dlu(59, 82, 154, 8)}">None specified</div>
            <div class="tbp-ctl tbp-static rdc-cred-hint" style="${dlu(13, 98, 196, 16)}">${TEXT.asked}</div>
            ${button(55, 116, 50, 14, 'Co<u>n</u>nect', 'connect', ' data-dialog-primary="1"')}
            ${button(107, 116, 50, 14, 'Cancel', 'cancel')}
            ${button(161, 116, 50, 14, '<u>H</u>elp', 'help')}
            ${button(215, 116, 50, 14, '<u>O</u>ptions &gt;&gt;', 'options', ' disabled title="Not available in this version"')}`;
        const input = content.querySelector('#rdcComputer');
        const list = content.querySelector('.rdc-combo-list');
        close.addEventListener('click', () => closeMain());
        content.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-action]');
            if (!b || b.disabled) return;
            if (b.dataset.action === 'connect') void connect();
            else if (b.dataset.action === 'cancel') closeMain();
            else if (b.dataset.action === 'help') callGlobal('openGrimoireApplet');
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
            input.value = row.dataset.value;
            toggleList(false);
        });
        input.addEventListener('blur', () => toggleList(false));
        modal.addEventListener('keydown', onMainKey);
        const history = readHistory();
        input.value = history[0] || '';
        return { modal, content, input, list, busy: false };
    }

    function toggleList(open) {
        if (!main) return;
        const { list, input } = main;
        if (open) {
            const history = readHistory();
            if (!history.length) return;
            list.innerHTML = history.map((h) => `<div class="rdc-combo-row" role="option" data-value="${esc(h)}">${esc(h)}</div>`).join('');
            const current = list.querySelector(`[data-value="${CSS.escape(input.value)}"]`);
            if (current) current.classList.add('is-selected');
        }
        list.hidden = !open;
        input.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function moveSelection(step) {
        const history = readHistory();
        if (!history.length) return;
        const i = history.findIndex((h) => h === main.input.value);
        const next = history[Math.min(history.length - 1, Math.max(0, i + step))];
        main.input.value = next;
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
        } else if (ev.altKey && !ev.ctrlKey) {
            const key = ev.key.toLowerCase();
            if (key === 'c') main.input.focus();
            else if (key === 'n') void connect();
            else if (key === 'h') callGlobal('openGrimoireApplet');
            else return;
            ev.preventDefault();
        }
    }

    function setBusy(on) {
        if (!main) return;
        main.busy = on;
        main.content.querySelectorAll('[data-action="connect"], #rdcComputer').forEach((n) => { n.disabled = on; });
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
            main.input.focus();
            return;
        }
        setBusy(true);
        try {
            // quick connect needs Guacamole's quickconnect extension on the gateway
            let status;
            try {
                status = await postJson('/api/desktop-guac/quick/status');
            } catch (_) {
                status = null;
            }
            if (!status || status.response.status === 404 || (status.payload.ok && !status.payload.available)) {
                await showError(TEXT.unavailable);
                return;
            }
            if (!status.payload.ok) {
                await showError(TEXT.noServer);
                return;
            }
            if (!target.protocol) {
                target.protocol = await chooseProtocol(target);
                if (!target.protocol) return;
            }
            const creds = await askCredentials(target);
            if (!creds) return;
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
                return;
            }
            const p = result.payload;
            if (!result.response.ok || !p.ok || !p.url) {
                const code = p.code;
                await showError(code === 'unavailable' ? TEXT.unavailable
                    : code === 'blank' ? TEXT.blank
                        : code === 'invalid' ? TEXT.invalid
                            : code === 'gateway' ? TEXT.noServer
                                : TEXT.generic);
                return;
            }
            remember(typed);
            openSession(p, target);
            closeMain();
        } finally {
            setBusy(false);
        }
    }

    /** The session opens in Remote Desktop Manager's session window (guacRemote.js). */
    function openSession(p, target) {
        const proto = PROTOCOLS.find((x) => x.id === target.protocol) || PROTOCOLS[0];
        const key = 'quick:' + target.protocol + ':' + p.name.toLowerCase();
        callGlobal('openDesktopGuacFrame', {
            key: key,
            modalId: 'desktopGuacSession_quick_' + key.replace(/[^A-Za-z0-9_-]/g, '_'),
            windowIdentifier: 'desktopGuacSession',
            title: p.name + ' - Remote Desktop',
            iconClass: proto.icon,
            protocol: target.protocol,
            url: p.url
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
        showWindow(main.modal, null);
        root.requestAnimationFrame(() => {
            if (!main) return;
            main.input.focus();
            main.input.select();
        });
    }

    const api = {
        open,
        isOpen: () => !!main,
        _test: { parseComputer, dlu, readHistory }
    };
    root.remoteDesktopConnection = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
