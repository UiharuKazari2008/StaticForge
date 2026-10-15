/**
 * Control Panel Mail (Windows Mail's Tools > Options, General, "Send / Receive Messages"
 * on the Vista VM). Two checkboxes, saved on this computer:
 *   Play sound when new messages arrive
 *   Show a notification when new messages arrive
 * Both default on. localStorage dovecote-mail-sound / dovecote-mail-dialog (`off` mutes).
 * The notification is a tray balloon (desktop-apps/dovecote.js).
 */
(function (root) {
    'use strict';

    const SOUND_KEY = 'dovecote-mail-sound';
    const DIALOG_KEY = 'dovecote-mail-dialog';
    let registered = false;

    function storeOf(storage) {
        if (storage) return storage;
        try {
            return root.localStorage || null;
        } catch (_err) {
            return null;
        }
    }

    function flagOn(key, storage) {
        try {
            const store = storeOf(storage);
            if (!store) return true;
            return store.getItem(key) !== 'off';
        } catch (_err) {
            return true;
        }
    }

    function writeFlag(key, on, storage) {
        try {
            const store = storeOf(storage);
            if (!store) return;
            store.setItem(key, on ? 'on' : 'off');
        } catch (_err) { /* quota / private mode */ }
    }

    function soundOn(storage) {
        return flagOn(SOUND_KEY, storage);
    }

    function dialogOn(storage) {
        return flagOn(DIALOG_KEY, storage);
    }

    function setSound(on, storage) {
        writeFlag(SOUND_KEY, on, storage);
    }

    function setDialog(on, storage) {
        writeFlag(DIALOG_KEY, on, storage);
    }

    function mount(main) {
        if (!main) return;
        main.querySelectorAll('[data-dove-mail]').forEach((box) => {
            const which = box.dataset.doveMail;
            box.checked = which === 'dialog' ? dialogOn() : soundOn();
            box.addEventListener('change', () => {
                if (which === 'dialog') setDialog(box.checked);
                else setSound(box.checked);
            });
        });
        const modal = main.closest('.modal');
        if (modal && !modal.dataset.cplMailWired) {
            modal.dataset.cplMailWired = '1';
            modal.addEventListener('click', (ev) => {
                const button = ev.target.closest && ev.target.closest('[data-cpl-mail="open"]');
                if (!button || !modal.contains(button)) return;
                // openDesktopDovecote: public/scripts/comp/desktop-apps/dovecote.js
                if (typeof root.openDesktopDovecote === 'function') root.openDesktopDovecote();
            });
        }
    }

    function register() {
        if (registered) return true;
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerPage !== 'function') return false;
        registered = true;
        cpl.registerItem({
            id: 'mail',
            name: 'Mail',
            image: '/static_images/app_icons/vista-mail.webp',
            description: 'Play a sound or show a tray notification when a new message arrives.',
            open: () => cpl.open('mail')
        });
        cpl.registerPage('mail', {
            title: () => 'Mail',
            tasks: () => `
                <div class="cpl-task-group">
                    <h3 class="cpl-task-heading">Tasks</h3>
                    <ul class="cpl-task-list">
                        <li><button type="button" class="cpl-link" data-cpl-mail="open">Open Dovecote</button></li>
                    </ul>
                </div>
                <div class="cpl-task-group cpl-task-group--see-also">
                    <h3 class="cpl-task-heading">See also</h3>
                    <ul class="cpl-task-list">
                        ${cpl.taskLinkHtml('Sound', 'nav', 'sound')}
                    </ul>
                </div>`,
            body: () => `
                <div class="cpl-mail-page">
                    <h1 class="cpl-page-title">Mail</h1>
                    <p>Choose what happens when a new message arrives.</p>
                    <h2 class="cpl-section-title">Send / Receive Messages</h2>
                    <div class="cpl-mail-options">
                        <div><input type="checkbox" id="cplMailSound" data-dove-mail="sound"><label for="cplMailSound">Play sound when new messages arrive</label></div>
                        <div><input type="checkbox" id="cplMailDialog" data-dove-mail="dialog"><label for="cplMailDialog">Show a notification when new messages arrive</label></div>
                    </div>
                </div>`,
            mount
        });
        return true;
    }

    function open() {
        if (!register()) return false;
        root.melatonControlPanel.open('mail');
        return true;
    }

    root.cplMail = {
        register,
        open,
        soundOn,
        dialogOn,
        setSound,
        setDialog,
        SOUND_KEY,
        DIALOG_KEY
    };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplMail;
})(typeof window !== 'undefined' ? window : globalThis);
