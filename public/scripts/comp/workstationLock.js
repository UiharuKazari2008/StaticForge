/**
 * Workstation lock (Yozora #423): the start menu's Lock and Ctrl+Alt+L lock the desktop like
 * Windows XP Classic. desktopBoot.lockWorkstation() hides and pauses everything over the
 * wallpaper (body.workstation-locked); this module shows the Classic dialogs on top:
 *
 *   Computer Locked  "This computer is in use and has been locked." Ctrl+Alt+Delete (or
 *                    Ctrl+Alt+End, the Remote Desktop stand-in the browser can receive), Enter,
 *                    or a click / tap opens Unlock Computer
 *   Unlock Computer  user name + password, OK / Cancel; the password is checked with the
 *                    server's login (the same call as the logon dialog). A wrong one gets XP's
 *                    "could not log you on" message box (bootMessageBox.js)
 *
 * With User Accounts "Use Vista Logon" (desktopBoot.isVistaLogon) the lock is Vista's instead:
 * the logon dialog's Welcome screen (#desktopPreStartupModal), locked (desktop-boot.css under
 * body.workstation-locked): tile, name, "Locked", the password box straight away. Its arrow and
 * Enter come here through websocket.js _submitPreStartupCredentials; a wrong password is the
 * screen's own message view.
 *
 * While locked, a critical top-priority keyboard listener swallows every app shortcut. The
 * lock survives reloads (localStorage): the next boot asks for the password in the logon
 * dialog before the desktop comes back (websocket.js), like Windows after a restart.
 */
(function (root) {
    'use strict';

    const STORAGE_KEY = 'melatonWorkstationLocked';
    const DOMAIN = 'DREAMSCAPE'; // fallback; the configured name comes from melatonDomainName()
    const USER = 'Administrator';

    const LOCK_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true">'
        + '<rect x="2.5" y="3.5" width="22" height="16" rx="1" fill="#d4d0c8" stroke="#404040"/>'
        + '<rect x="4.5" y="5.5" width="18" height="12" fill="#1f5fbf"/>'
        + '<path d="M10 19.5h7l1.5 3.5h-10z" fill="#a8a49c" stroke="#404040" stroke-width="0.8"/>'
        + '<path d="M19.5 18v-3.2a4.5 4.5 0 0 1 9 0V18" fill="none" stroke="#7a7a7a" stroke-width="2.2"/>'
        + '<rect x="17.5" y="17.5" width="13" height="11" rx="1.5" fill="#f2c230" stroke="#7a5b00"/>'
        + '<circle cx="24" cy="22.2" r="1.6" fill="#5a4300"/><path d="M24 23.2v2.6" stroke="#5a4300" stroke-width="1.4"/>'
        + '</svg>';

    const VISTA_BAD_PASSWORD = 'The user name or password is incorrect.';

    const doc = typeof document !== 'undefined' ? document : null;
    let modal = null;
    let busy = false;
    let vista = false; // this lock is on the Vista Welcome screen (fixed when it locks)

    function readPending() {
        try { return root.localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return false; }
    }

    function writePending(on) {
        try {
            if (on) root.localStorage.setItem(STORAGE_KEY, '1');
            else root.localStorage.removeItem(STORAGE_KEY);
        } catch (_) { /* the lock just does not survive a reload */ }
    }

    function el(id) {
        return modal ? modal.querySelector(id) : null;
    }

    function ensureModal() {
        if (modal || !doc) return modal;
        modal = doc.createElement('div');
        modal.id = 'workstationLockModal';
        modal.className = 'modal hidden on-top boot-dialog workstation-lock-modal';
        modal.dataset.view = 'locked';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main"><span class="workstation-lock-title">Computer Locked</span></div>
            </div>
            <div class="modal-window-controls"></div>
            <div class="modal-content workstation-lock-content">
                <div class="workstation-lock-hero">
                    <img src="/static_images/logo_icon.png" alt="" draggable="false">
                    <span class="workstation-lock-brand">Dreamscape</span>
                </div>
                <div class="workstation-lock-strip"></div>
                <div class="workstation-lock-main">
                    <div class="workstation-lock-icon">${LOCK_ICON}</div>
                    <div class="workstation-lock-text">
                        <p>This computer is in use and has been locked.</p>
                        <p class="workstation-lock-who"></p>
                        <p class="workstation-lock-hint">Press Ctrl+Alt+Delete to unlock this computer.</p>
                        <form class="workstation-lock-form" autocomplete="off">
                            <label class="workstation-lock-row"><span>User name:</span>
                                <input class="workstation-lock-user" type="text" value="${USER}" readonly tabindex="-1"></label>
                            <label class="workstation-lock-row"><span>Password:</span>
                                <input class="workstation-lock-password" type="password" autocomplete="current-password"></label>
                            <div class="workstation-lock-actions">
                                <button type="submit" class="btn-secondary workstation-lock-ok">OK</button>
                                <button type="button" class="btn-secondary workstation-lock-cancel">Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>`;
        doc.body.appendChild(modal);
        modal.addEventListener('click', () => {
            if (modal.dataset.view === 'locked') showView('unlock');
        });
        el('.workstation-lock-form').addEventListener('submit', (ev) => {
            ev.preventDefault();
            submit();
        });
        el('.workstation-lock-cancel').addEventListener('click', (ev) => {
            ev.stopPropagation();
            showView('locked');
        });
        return modal;
    }

    function domainName() {
        return typeof root.melatonDomainName === 'function' ? root.melatonDomainName() : DOMAIN;
    }

    function showView(view) {
        if (!ensureModal()) return;
        modal.dataset.view = view;
        el('.workstation-lock-who').textContent = `Only ${domainName()}\\${USER} or an administrator can unlock this computer.`;
        el('.workstation-lock-title').textContent = view === 'unlock' ? 'Unlock Computer' : 'Computer Locked';
        const password = el('.workstation-lock-password');
        password.value = '';
        if (view === 'unlock') setTimeout(() => password.focus(), 0);
        // placeWindowsLogonDialog: public/scripts/comp/modalUtils.js
        placeWindowsLogonDialog(modal);
    }

    function openDialog() {
        if (vista) {
            showVistaScreen();
            return;
        }
        if (!ensureModal()) return;
        showView('locked');
        if (typeof root.openModal === 'function') root.openModal(modal);
        else modal.classList.remove('hidden');
        // placeWindowsLogonDialog: public/scripts/comp/modalUtils.js
        placeWindowsLogonDialog(modal);
    }

    function closeDialog() {
        if (vista) {
            // closeModal: public/scripts/comp/modalUtils.js
            root.closeModal(doc.getElementById('desktopPreStartupModal'));
            return;
        }
        if (!modal) return;
        if (typeof root.closeModal === 'function') root.closeModal(modal);
        else modal.classList.add('hidden');
    }

    /** The Welcome screen, locked: the password box straight away (desktop-boot.css does the look). */
    function showVistaScreen() {
        const screen = doc.getElementById('desktopPreStartupModal');
        const password = doc.getElementById('desktopPreStartupPassword');
        screen.classList.add('auth-active');
        screen.classList.remove('auth-busy');
        doc.getElementById('desktopPreStartupAuth').classList.remove('hidden');
        doc.getElementById('desktopPreStartupUsername').value = USER;
        // The logon's last render (websocket.js _renderPreStartupDialog) left both disabled
        password.disabled = false;
        doc.getElementById('desktopPreStartupLoginBtn').disabled = false;
        password.value = '';
        // _updatePreStartupAuthError: public/scripts/websocket.js (the screen's message view)
        root.wsClient._updatePreStartupAuthError('');
        if (screen.classList.contains('hidden') || screen.classList.contains('closing')) {
            // openModal: public/scripts/comp/modalUtils.js
            root.openModal(screen);
        }
        // An invisible screen cannot take the focus: wait for its art (websocket.js _whenVistaLogonArtReady)
        root.wsClient._whenVistaLogonArtReady().then(() => {
            if (ownsLogonScreen()) password.focus();
        });
    }

    /** True while this lock owns the Welcome screen (a restart lock over it is the logon's). */
    function ownsLogonScreen() {
        const boot = root.desktopBoot;
        return vista && !!boot && boot.isWorkstationLocked() && !boot.isSuspended();
    }

    /** The Welcome screen's arrow / Enter (websocket.js _submitPreStartupCredentials): "Welcome" while it checks. */
    async function submitVista() {
        if (busy) return;
        const screen = doc.getElementById('desktopPreStartupModal');
        const password = doc.getElementById('desktopPreStartupPassword');
        const value = password.value;
        busy = true;
        screen.classList.add('auth-busy');
        doc.getElementById('desktopPreStartupStatus').textContent = 'Welcome';
        let ok = false;
        try {
            ok = value ? await verifyPassword(value) : false;
        } catch (_) {
            ok = false;
        } finally {
            busy = false;
        }
        if (ok) {
            unlock();
            return;
        }
        screen.classList.remove('auth-busy');
        password.value = '';
        root.wsClient._updatePreStartupAuthError(VISTA_BAD_PASSWORD);
    }

    /** websocket.js after a restart lock's logon: a Vista lock still up takes its screen back. */
    function reshowAfterRestart() {
        if (ownsLogonScreen()) showVistaScreen();
    }

    /** Lock the workstation (start menu Lock, Ctrl+Alt+L). */
    function lock() {
        const boot = root.desktopBoot;
        if (!boot || !root.isDesktop || boot.isWorkstationLocked()) return false;
        if (!boot.lockWorkstation()) return false;
        writePending(true);
        vista = boot.isVistaLogon();
        openDialog(); // built under the session-switch black
        return true;
    }

    function unlock() {
        const boot = root.desktopBoot;
        writePending(false);
        if (boot) boot.unlockWorkstation(); // black first; the dialog closes under it
        closeDialog();
        vista = false;
    }

    async function verifyPassword(password) {
        const response = await root.fetch('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'login', data: { pin: password } })
        });
        let payload = null;
        try { payload = await response.json(); } catch (_) { /* treated as a failure */ }
        if (!response.ok || !payload || payload.success === false) return false;
        const expected = (() => { try { return root.localStorage.getItem('userType'); } catch (_) { return null; } })();
        return !expected || !payload.userType || payload.userType === expected;
    }

    async function submit() {
        if (busy) return;
        const password = el('.workstation-lock-password').value;
        busy = true;
        let ok = false;
        try {
            ok = password ? await verifyPassword(password) : false;
        } catch (_) {
            ok = false;
        } finally {
            busy = false;
        }
        if (ok) {
            unlock();
            return;
        }
        const retry = () => showView('unlock');
        if (root.bootMessageBox) {
            await root.bootMessageBox.show({
                title: 'Logon Message',
                icon: 'warning',
                message: 'The system could not log you on. Make sure your User name and domain are correct, then type your password again. Letters in passwords must be typed using the correct case.',
                buttons: [{ label: 'OK', value: 'ok', default: true, cancel: true }]
            });
        }
        retry();
    }

    function isUnlockCombo(ev) {
        return ev.ctrlKey && ev.altKey && (ev.key === 'Delete' || ev.key === 'End' || ev.code === 'Delete' || ev.code === 'End');
    }

    /** Ctrl+Alt+L locks; while locked every app shortcut is swallowed (typing still works). */
    function onKeydown(ev) {
        const boot = root.desktopBoot;
        if (!boot || !root.isDesktop) return false;
        if (!boot.isWorkstationLocked()) {
            const isL = ev.key === 'l' || ev.key === 'L' || ev.code === 'KeyL';
            if (ev.ctrlKey && ev.altKey && !ev.shiftKey && !ev.metaKey && isL && !ev.repeat) {
                ev.preventDefault();
                lock();
                return true;
            }
            return false;
        }
        if (boot.isSuspended()) return false; // the server-restart logon dialog has the keyboard
        if (vista) return true; // the Welcome screen's own controls take Enter (websocket.js)
        const view = modal ? modal.dataset.view : 'locked';
        if (view === 'locked') {
            if (isUnlockCombo(ev) || ev.key === 'Enter') {
                ev.preventDefault();
                showView('unlock');
            }
            return true;
        }
        if (ev.key === 'Escape') {
            ev.preventDefault();
            showView('locked');
        }
        return true; // form typing keeps its default action; nothing behind the lock runs
    }

    function wireKeyboard() {
        if (typeof root.registerKeyboardListener !== 'function') return;
        root.registerKeyboardListener({
            id: 'workstationLock.keys',
            handler: onKeydown,
            type: 'global',
            priority: 100,
            critical: true,
            label: 'Lock computer',
            keys: 'Ctrl+Alt+L',
            overlayIcon: 'fas fa-lock',
            overlayGroup: 'Window'
        });
    }

    if (doc) {
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', wireKeyboard);
        else wireKeyboard();
    }

    const api = {
        lock,
        unlock,
        isLocked: () => !!(root.desktopBoot && root.desktopBoot.isWorkstationLocked()),
        isLockPending: readPending,
        clearPending: () => writePending(false),
        ownsLogonScreen,
        submitVista,
        reshowAfterRestart,
        _test: { onKeydown, showView, submit, verifyPassword, STORAGE_KEY }
    };
    if (root) root.workstationLock = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
