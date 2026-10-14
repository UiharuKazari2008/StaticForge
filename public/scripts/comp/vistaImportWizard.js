/**
 * Import as a Vista Aero Wizard (Yozora #494). On the Vista desktop (body.desktop-mode, not the
 * Classic theme) #unifiedUploadModal, Toolbox > Import, is an Aero Wizard: this module gives the
 * window the wizard caption (the round Back button, the Easy Transfer icon and the title in the
 * shared glass caption) and keeps the page state on the window; the look is
 * public/css/vista-import-wizard.css. Loaded after vistaDialogs.js, which already tags the window
 * as a light form dialog (data-window-client="light", .win7 on the client, .vista-dialog-footer).
 *
 *   data-wizard-page="1"   What do you want to import? The four modes as command links.
 *   data-wizard-page="2"   Where is the file? Select File and Clipboard as command links.
 *   data-wizard-page="3"   The preview and its options: a file, a download or a pending URL is loaded.
 *
 * The page is read from the DOM the handlers in referenceManager.js drive: data-mode on the modal
 * exists only while content is loaded (page 3); without it the wizard is on page 2 when a mode was
 * chosen on page 1 in this session, else on page 1. The command links click the existing buttons
 * (.mode-slider-btn[data-mode], #unifiedUploadSelectBtn, #unifiedUploadClipboardBtn). Back on page 3
 * resets through unifiedUploadModalManager.reset() and re-picks the chosen mode (page 2); Back on
 * page 2 forgets the mode (page 1). Cancel closes the wizard, as Vista's does; the window's close
 * box and reset keep their handlers. Outside the Vista desktop the caption and the attribute come
 * off and the existing two-panel layout stays.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const MODAL_ID = 'unifiedUploadModal';
    const PAGE_ATTR = 'data-wizard-page';
    const TITLE = 'Import';
    // the runtime's 32 px variant of the Easy Transfer icon (modalUtils.js resolveAppIconPath sizes), drawn at 16 px
    const ICON = '/static_images/app_icons/32/vista-easy-transfer.png';

    let modal = null;
    let caption = null;
    let backBtn = null;
    let pageObserver = null;
    let bodyObserver = null;
    let active = false;
    // the mode picked on page 1 in this session; null until then and again when the wizard closes
    let chosenMode = null;

    function isVista() {
        return !!doc && doc.body.classList.contains('desktop-mode') && !doc.body.classList.contains('windows-classic-theme');
    }

    /** 3 while content is loaded (data-mode), else 2 after a mode was chosen, else 1. */
    function pageNumber() {
        if (!modal) return 1;
        if (modal.hasAttribute('data-mode')) return 3;
        return chosenMode ? 2 : 1;
    }

    function sync() {
        if (!modal || !active) return;
        if (modal.classList.contains('hidden')) chosenMode = null;
        const page = String(pageNumber());
        if (modal.getAttribute(PAGE_ATTR) !== page) modal.setAttribute(PAGE_ATTR, page);
        if (backBtn) backBtn.disabled = page === '1';
    }

    function clickMode(mode) {
        const btn = modal.querySelector('.mode-slider-btn[data-mode="' + mode + '"]');
        if (btn) btn.click();
    }

    function back() {
        const page = pageNumber();
        if (page === 3) {
            const mode = chosenMode;
            // unifiedUploadModalManager: public/scripts/comp/referenceManager.js
            unifiedUploadModalManager.reset();
            if (mode) clickMode(mode);
        } else if (page === 2) {
            chosenMode = null;
        }
        sync();
    }

    function onClick(event) {
        if (!active) return;
        const link = event.target.closest('.vista-command-link[data-wizard-mode]');
        if (link) {
            chosenMode = link.dataset.wizardMode;
            clickMode(chosenMode);
            sync();
            return;
        }
        // Vista's Cancel leaves the wizard; the handlers' own reset on it still runs
        if (event.target.closest('#unifiedUploadCancelBtn')) unifiedUploadModalManager.hide();
    }

    /**
     * The wizard caption: Back, the Easy Transfer icon and the title, in the shared glass caption.
     * The taskbar reads the caption's icons (modalUtils.js getModalIcons: the <i> for the Luna and
     * workspace taskbars, the img.icon-image for the orb one), so both are here, as the launchable
     * declares them (buildToolsSubmenuItems: nai-import + vista-easy-transfer.png); on the Vista
     * desktop the caption shows the image and vista-dialogs.css hides the <i>.
     */
    function ensureCaption() {
        if (caption) return;
        caption = doc.createElement('div');
        caption.className = 'modal-window-title';
        caption.innerHTML = '<div class="modal-window-title-main">'
            + '<button type="button" class="vista-wizard-back" title="Back" disabled></button>'
            + '<i class="nai-import icon-fa"></i>'
            + '<img class="icon-image" alt="" src="' + ICON + '">'
            + '<span>' + TITLE + '</span></div>';
        backBtn = caption.querySelector('.vista-wizard-back');
        backBtn.addEventListener('click', back);
        modal.prepend(caption);
    }

    function tag() {
        if (active) return;
        active = true;
        ensureCaption();
        chosenMode = null;
        sync();
        // the page follows data-mode (content loaded) and class (opened / closed)
        pageObserver = new MutationObserver(sync);
        pageObserver.observe(modal, { attributes: true, attributeFilter: ['data-mode', 'class'] });
    }

    function untag() {
        if (!active) return;
        active = false;
        if (pageObserver) pageObserver.disconnect();
        pageObserver = null;
        if (caption) caption.remove();
        caption = null;
        backBtn = null;
        chosenMode = null;
        modal.removeAttribute(PAGE_ATTR);
    }

    function apply() {
        if (!doc) return;
        if (!modal) modal = doc.getElementById(MODAL_ID);
        if (!modal) return;
        if (isVista()) tag(); else untag();
    }

    function init() {
        if (!doc || bodyObserver) return;
        apply();
        if (modal) modal.addEventListener('click', onClick);
        bodyObserver = new MutationObserver(apply);
        bodyObserver.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    }

    const api = { apply, back, pageNumber, isVista, PAGE_ATTR };
    if (root) {
        root.vistaImportWizard = api;
        if (doc && doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
        else if (doc) init();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
