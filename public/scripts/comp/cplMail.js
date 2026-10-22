/**
 * Control Panel Mail: the item opens Dovecote Express's Mail Options dialog
 * (public/scripts/comp/mailOptions.js, lazy feature mail_options) instead of a page of its own,
 * as Vista's Mail item opens Mail's own setup dialog (Yukimi, Oct 22 2026). The settings it used
 * to show (new mail sound and notification) live on that dialog's General tab now; their store
 * is desktop-apps/dovecote.js (window.dovecoteMailSettings, same localStorage keys as before).
 */
(function (root) {
    'use strict';

    let registered = false;

    function open(tab) {
        // openDovecoteMailOptions: public/scripts/comp/desktop-apps/dovecote.js
        if (typeof root.openDovecoteMailOptions !== 'function') return false;
        root.openDovecoteMailOptions(tab);
        return true;
    }

    function register() {
        if (registered) return true;
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerItem !== 'function') return false;
        registered = true;
        cpl.registerItem({
            id: 'mail',
            name: 'Mail',
            image: '/static_images/app_icons/64/vista-mail.webp',
            description: 'Change Dovecote Express options: the new mail sound and notification, and your signature.',
            open: () => open()
        });
        return true;
    }

    root.cplMail = { register, open };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplMail;
})(typeof window !== 'undefined' ? window : globalThis);
