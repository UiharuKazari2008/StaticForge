/**
 * Mail Options: Dovecote Express's Tools > Options..., Windows Mail's Options property sheet with
 * the tabs Dovecote has settings for (Yukimi, Oct 22 2026). Control Panel's Mail item opens it too
 * (cplMail.js) instead of a page of its own. Lazy feature "mail_options" (featureLoader.js),
 * opened through openDovecoteMailOptions (desktop-apps/dovecote.js):
 *
 *   mailOptions.open(tab)   'general' | 'signatures'
 *
 *   General      Send / Receive Messages: "Play sound when new messages arrive" and "Show a
 *                notification when new messages arrive" (this computer only)
 *   Signatures   Windows Mail's "Signature settings" check boxes and an Edit Signature box: the
 *                signature goes at the bottom of new messages and replies (saved with the user's
 *                settings on the server, window.dovecoteMailSettings)
 *
 * The sheet uses Taskbar Properties' Vista controls (public/css/taskbar-properties.css, tbp-*),
 * placed in MS Shell Dlg 8 dialog units like the other property sheets; its own sizes are in
 * public/css/mail-options.css. Changes go to a pending copy; Apply saves (and greys out until the
 * next change), OK saves and closes, Cancel and the close box drop it.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ICON_16 = '/static_images/app_icons/16/vista-mail.webp';
    const ICON_32 = '/static_images/app_icons/32/vista-mail.webp';
    const OWNER_ID = 'desktopDovecoteModal';
    const TABS = [
        { id: 'general', label: 'General' },
        { id: 'signatures', label: 'Signatures' }
    ];

    // dialog units -> px (MS Shell Dlg 8 at 96 dpi: x * 6/4, y * 13/8), edges rounded, a bottom
    // edge drops its fraction; inset pulls a push button's face 1 px inside (taskbarProperties.js dlu())
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

    function checkStyle(x, y, w, h) {
        const height = bottomPx(y, h) - Math.round(y * 1.625);
        return `${dlu(x, y, w, h)}padding-top:${Math.max(0, Math.floor((height - 13) / 2))}px;`;
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function settingsApi() {
        // window.dovecoteMailSettings: public/scripts/comp/desktop-apps/dovecote.js
        return root.dovecoteMailSettings || null;
    }

    function readState() {
        const api = settingsApi();
        const sig = api ? api.signature() : { signature: '', signatureOutgoing: true, signatureSkipReplies: false };
        return {
            sound: api ? api.soundOn() : true,
            notify: api ? api.notifyOn() : true,
            signature: sig.signature || '',
            signatureOutgoing: sig.signatureOutgoing !== false,
            signatureSkipReplies: sig.signatureSkipReplies === true
        };
    }

    let dlg = null; // { modal, content, saved, pending, tab, dirty }

    // ---- markup ----------------------------------------------------------------------------

    function check(id, x, y, w, label, key) {
        return `<div class="tbp-ctl tbp-check" style="${checkStyle(x, y, w, 10)}"><input type="checkbox" id="mo-${id}" data-key="${key}"><label for="mo-${id}"><span>${label}</span></label></div>`;
    }

    function group(x, y, w, h, label) {
        return `<div class="tbp-group" style="${dlu(x, y, w, h)}"><span class="tbp-group-label">${label}</span></div>`;
    }

    function text(x, y, w, h, body) {
        return `<div class="tbp-ctl tbp-static" style="${dlu(x, y, w, h)}">${body}</div>`;
    }

    // Windows Mail's pages put the program's picture at the left of each group
    function icon(x, y) {
        return `<img class="tbp-ctl mo-icon" style="${dlu(x, y)}" src="${ICON_32}" alt="">`;
    }

    function pageGeneral() {
        return `
            ${group(7, 7, 243, 52, 'Send / Receive Messages')}
            ${icon(14, 21)}
            ${check('sound', 46, 21, 196, 'Play <u>s</u>ound when new messages arrive', 'sound')}
            ${check('notify', 46, 36, 196, 'Show a <u>n</u>otification when new messages arrive', 'notify')}`;
    }

    function pageSignatures() {
        return `
            ${group(7, 7, 243, 52, 'Signature settings')}
            ${icon(14, 21)}
            ${check('outgoing', 46, 21, 196, '<u>A</u>dd signatures to all outgoing messages', 'signatureOutgoing')}
            ${check('skip-replies', 46, 36, 196, '<u>D</u>on\'t add signatures to Replies and Forwards', 'signatureSkipReplies')}
            ${group(7, 65, 243, 156, 'Edit Signature')}
            ${text(14, 79, 228, 8, '<label for="mo-signature-text"><u>T</u>ext, added at the bottom of your messages:</label>')}
            <textarea class="tbp-ctl mo-signature" id="mo-signature-text" style="${dlu(14, 91, 229, 122)}" spellcheck="true"></textarea>`;
    }

    // ---- the window ------------------------------------------------------------------------

    function el(tag, className, textContent) {
        const n = doc.createElement(tag);
        if (className) n.className = className;
        if (textContent !== undefined) n.textContent = textContent;
        return n;
    }

    function buildSheet() {
        const modal = el('div', 'modal hidden tbp-window mo-window');
        modal.id = 'mailOptionsDialog';
        modal.dataset.windowIdentifier = 'mailOptionsDialog';
        modal.dataset.windowRestorePosition = 'false';
        modal.dataset.windowRestoreSize = 'false';
        modal.dataset.windowFixedSize = 'true';
        modal.dataset.vistaDialog = 'form';
        modal.dataset.windowClient = 'light';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', 'Options');
        const cap = el('div', 'modal-window-title');
        const main = el('div', 'modal-window-title-main');
        const img = el('img', 'icon-image');
        img.alt = '';
        img.src = ICON_16;
        main.append(img, el('span', '', 'Options'));
        cap.appendChild(main);
        const controls = el('div', 'modal-window-controls');
        const close = el('button', 'btn-danger close-btn btn-small');
        close.type = 'button';
        close.title = 'Close';
        const x = el('i', 'fa-regular fa-xmark-large');
        x.setAttribute('aria-hidden', 'true');
        close.appendChild(x);
        controls.appendChild(close);
        const content = el('div', 'modal-content win7 tbp-client mo-sheet');
        content.innerHTML = `
            <div class="tbp-tabs" role="tablist">
                ${TABS.map((t) => `<button type="button" class="tbp-tab" role="tab" data-tab="${t.id}" aria-selected="false">${t.label}</button>`).join('')}
            </div>
            <div class="tbp-pane">
                <div class="tbp-page" data-page="general" role="tabpanel">${pageGeneral()}</div>
                <div class="tbp-page" data-page="signatures" role="tabpanel">${pageSignatures()}</div>
            </div>
            <div class="tbp-footer">
                <button type="button" class="tbp-button tbp-footer-button" data-action="ok" data-dialog-primary="1">OK</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="cancel">Cancel</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="apply" disabled>Apply</button>
            </div>`;
        modal.append(cap, el('div', 'modal-focus-overlay'), controls, content);
        doc.body.appendChild(modal);
        close.addEventListener('click', () => finish());
        content.addEventListener('click', onClick);
        content.addEventListener('change', onChange);
        content.addEventListener('input', onInput);
        modal.addEventListener('keydown', onKey);
        return { modal, content };
    }

    function showWindow(modal) {
        const owner = doc.getElementById(OWNER_ID);
        const ownerShown = owner && !owner.classList.contains('hidden') && !owner.classList.contains('minimised');
        // the taskbar button takes Dovecote's image icon (ensureModalApplicationIcon, modalUtils.js)
        if (owner) modal.dataset.iconOwnerId = OWNER_ID;
        callGlobal('openModal', modal);
        if (modal.classList.contains('hidden')) modal.classList.remove('hidden');
        callGlobal('bringModalToFront', modal);
        // centred over Dovecote when it is open, else over the screen, as Vista places a sheet
        requestAnimationFrame(() => {
            const r = modal.getBoundingClientRect();
            let cx = root.innerWidth / 2;
            let cy = (root.innerHeight - 35) / 2;
            if (ownerShown) {
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
        let closing = Promise.resolve();
        try {
            if (typeof root.closeModal === 'function') closing = Promise.resolve(root.closeModal(modal));
        } catch (_) { /* window manager gone */ }
        const fallback = new Promise((resolve) => setTimeout(resolve, 600));
        return Promise.race([closing.catch(() => {}), fallback]).then(() => {
            if (modal.parentNode) modal.parentNode.removeChild(modal);
        });
    }

    // ---- state <-> controls ----------------------------------------------------------------

    function syncControls() {
        const p = dlg.pending;
        dlg.content.querySelectorAll('input[type="checkbox"][data-key]').forEach((box) => {
            box.checked = p[box.dataset.key] === true;
        });
        const skip = dlg.content.querySelector('#mo-skip-replies');
        skip.disabled = !p.signatureOutgoing;
        const area = dlg.content.querySelector('#mo-signature-text');
        if (area.value !== p.signature) area.value = p.signature;
        const api = settingsApi();
        if (api) area.maxLength = api.SIGNATURE_MAX;
    }

    function setDirty(on) {
        dlg.dirty = on;
        dlg.content.querySelector('[data-action="apply"]').disabled = !on;
    }

    function selectTab(tab) {
        if (!TABS.some((t) => t.id === tab)) tab = 'general';
        dlg.tab = tab;
        dlg.content.querySelectorAll('.tbp-tab').forEach((b) => {
            const on = b.dataset.tab === tab;
            b.classList.toggle('is-selected', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
        });
        dlg.content.querySelectorAll('.tbp-page').forEach((p) => { p.hidden = p.dataset.page !== tab; });
        dlg.modal.dataset.tab = tab;
    }

    function onChange(ev) {
        const t = ev.target;
        if (!t.matches('input[type="checkbox"][data-key]')) return;
        dlg.pending[t.dataset.key] = t.checked;
        syncControls();
        setDirty(true);
    }

    function onInput(ev) {
        if (ev.target.id !== 'mo-signature-text') return;
        dlg.pending.signature = ev.target.value;
        setDirty(true);
    }

    function onClick(ev) {
        const tab = ev.target.closest('.tbp-tab');
        if (tab) {
            selectTab(tab.dataset.tab);
            return;
        }
        const b = ev.target.closest('[data-action]');
        if (!b || b.disabled) return;
        if (b.dataset.action === 'ok') void ok();
        else if (b.dataset.action === 'cancel') finish();
        else if (b.dataset.action === 'apply') void applyPending();
    }

    function onKey(ev) {
        if (ev.key === 'Escape') {
            ev.preventDefault();
            finish();
        } else if (ev.key === 'Enter' && !ev.target.matches('button, select, textarea')) {
            ev.preventDefault();
            void ok();
        } else if (ev.ctrlKey && ev.key === 'Tab') {
            ev.preventDefault();
            ev.stopPropagation();
            const i = TABS.findIndex((t) => t.id === dlg.tab);
            selectTab(TABS[(i + (ev.shiftKey ? TABS.length - 1 : 1)) % TABS.length].id);
        }
    }

    async function applyPending() {
        if (!dlg) return;
        const api = settingsApi();
        const p = { ...dlg.pending };
        const s = dlg.saved;
        if (api) {
            if (p.sound !== s.sound) api.setSound(p.sound);
            if (p.notify !== s.notify) api.setNotify(p.notify);
            if (p.signature !== s.signature || p.signatureOutgoing !== s.signatureOutgoing || p.signatureSkipReplies !== s.signatureSkipReplies) {
                // saves on this computer at once; the server copy follows (dovecote.js)
                api.saveSignature({
                    signature: p.signature,
                    signatureOutgoing: p.signatureOutgoing,
                    signatureSkipReplies: p.signatureSkipReplies
                });
            }
        }
        dlg.saved = p;
        setDirty(false);
    }

    async function ok() {
        if (dlg && dlg.dirty) await applyPending();
        finish();
    }

    function finish() {
        if (!dlg) return;
        const modal = dlg.modal;
        dlg = null;
        closeWindow(modal);
    }

    function open(tab = 'general') {
        if (!doc) return;
        if (dlg) {
            selectTab(tab);
            showWindow(dlg.modal);
            return;
        }
        const saved = readState();
        const { modal, content } = buildSheet();
        dlg = { modal, content, saved, pending: { ...saved }, tab, dirty: false };
        syncControls();
        selectTab(tab);
        showWindow(modal);
    }

    root.mailOptions = { open };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.mailOptions;
})(typeof window !== 'undefined' ? window : globalThis);
