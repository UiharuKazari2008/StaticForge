/**
 * Boot message box: a Windows message box for errors while the desktop boots or is locked
 * (logon-phase init failures, websocket.js _showLogonInitError). Icon on the left, the
 * message, an XP-style "DETAIL - ..." line, centred 75x23 buttons. It is a boot dialog
 * (.on-top .boot-dialog), so it shows over the logon dialog, above the lock cover, and in
 * Windows Classic while the boot still has that theme. Yozora #421.
 *
 *   bootMessageBox.show({ title, icon: 'error' | 'warning' | 'info', message, detail,
 *       buttons: [{ label, value, default?: true, cancel?: true }] }) → Promise<value>
 */
(function (root) {
    'use strict';

    const ICONS = {
        error: '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><radialGradient id="bmbErr" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ff6a5c"/><stop offset="0.6" stop-color="#e01b0f"/><stop offset="1" stop-color="#9a0d06"/></radialGradient></defs><circle cx="16" cy="16" r="14.5" fill="url(#bmbErr)" stroke="#6e0a05" stroke-width="1"/><path d="M10.6 10.6l10.8 10.8M21.4 10.6L10.6 21.4" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>',
        warning: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.5L30 28.5H2z" fill="#ffd21f" stroke="#7a5b00" stroke-width="1.2" stroke-linejoin="round"/><path d="M16 11v9" stroke="#000" stroke-width="3.2" stroke-linecap="round"/><circle cx="16" cy="24.2" r="1.9" fill="#000"/></svg>',
        info: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5" fill="#fff" stroke="#1f4fbf" stroke-width="1.4"/><circle cx="16" cy="9.5" r="2.3" fill="#1f4fbf"/><path d="M16 14v10" stroke="#1f4fbf" stroke-width="3.6" stroke-linecap="round"/></svg>'
    };

    const doc = typeof document !== 'undefined' ? document : null;
    let box = null;
    let current = null;

    function ensureBox() {
        if (box || !doc) return box;
        box = doc.createElement('div');
        box.id = 'bootMessageBox';
        box.className = 'modal hidden on-top boot-dialog boot-message-box';
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-modal', 'true');
        box.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main"><span class="boot-message-box-title"></span></div>
            </div>
            <div class="modal-window-controls"></div>
            <div class="modal-content boot-message-box-content">
                <div class="boot-message-box-body">
                    <div class="boot-message-box-icon"></div>
                    <div class="boot-message-box-text">
                        <p class="boot-message-box-message"></p>
                        <p class="boot-message-box-detail"></p>
                    </div>
                </div>
                <div class="boot-message-box-buttons"></div>
            </div>`;
        doc.body.appendChild(box);
        box.addEventListener('keydown', (ev) => {
            if (!current) return;
            if (ev.key === 'Escape') {
                const cancel = current.buttons.find((b) => b.cancel);
                if (cancel) {
                    ev.preventDefault();
                    finish(cancel.value);
                }
            }
        });
        return box;
    }

    function finish(value) {
        if (!current) return;
        const { resolve } = current;
        current = null;
        if (typeof root.closeModal === 'function') root.closeModal(box);
        else box.classList.add('hidden');
        resolve(value);
    }

    function show(options = {}) {
        const el = ensureBox();
        if (!el) return Promise.resolve(null);
        if (current) finish(null); // one box at a time; a newer message replaces the old one
        const buttons = Array.isArray(options.buttons) && options.buttons.length
            ? options.buttons
            : [{ label: 'OK', value: 'ok', default: true, cancel: true }];
        el.querySelector('.boot-message-box-title').textContent = options.title || 'MeletonFX';
        el.querySelector('.boot-message-box-icon').innerHTML = ICONS[options.icon] || ICONS.error;
        el.querySelector('.boot-message-box-message').textContent = options.message || '';
        el.querySelector('.boot-message-box-detail').textContent = options.detail || '';
        const row = el.querySelector('.boot-message-box-buttons');
        row.replaceChildren();
        let defaultButton = null;
        buttons.forEach((spec) => {
            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-secondary';
            btn.textContent = spec.label;
            btn.addEventListener('click', () => finish(spec.value));
            row.appendChild(btn);
            if (spec.default || !defaultButton) defaultButton = spec.default ? btn : (defaultButton || btn);
        });
        return new Promise((resolve) => {
            current = { resolve, buttons };
            // desktopSounds.play: public/scripts/comp/desktopSounds.js
            desktopSounds.play(desktopSounds.bootIconEvent(options.icon));
            if (typeof root.openModal === 'function') root.openModal(el);
            else el.classList.remove('hidden');
            if (typeof root.bringModalToFront === 'function') root.bringModalToFront(el);
            if (defaultButton) setTimeout(() => defaultButton.focus(), 0);
        });
    }

    function isOpen() {
        return !!current;
    }

    const api = { show, isOpen, ICONS };
    if (root) root.bootMessageBox = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
