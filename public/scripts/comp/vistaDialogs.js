/**
 * Dialog boxes in the Vista design (Yozora #465). On the Vista desktop (body.desktop-mode, not
 * the Classic theme) every dialog box becomes a light Vista dialog: this module tags them and
 * public/css/vista-dialogs.css draws them.
 *
 *   data-vista-dialog="message"   message boxes: the plain confirmation, the credit cost and
 *                                 client update dialogs, the alert-theme modals (white content
 *                                 over the grey footer, the icon left of the text)
 *   data-vista-dialog="task"      the confirmation dialog when it carries a form (input dialog,
 *                                 enhance, studio change, explore publish), and the name prompts
 *                                 built like it (Studio's Save to Desktop / Save Preset): white
 *                                 content, grey footer, no icon
 *   data-vista-dialog="form"      the tool-window form dialogs (presets, replacements,
 *                                 workspaces, uploads, vibes ...): Vista's property sheet
 *   data-vista-icon               question | warning | error | info, from the caption's icon
 *   data-window-client="light" + .win7 on the client: the light-client mechanism
 *                                 (vista-glass-controls.css), so 7.css paints the native controls
 *   .vista-dialog-footer          the row that holds the buttons
 *
 * The tags come off again when the desktop leaves Vista mode. JS-created dialogs (confirmation,
 * credit cost) are caught by a body observer; each dialog is re-read when it opens, since the
 * confirmation dialog changes its icon and content per call.
 *
 * ownerCenter(event): where a Vista dialog opens, the centre of the window the click came from
 * (confirmationDialog.js uses it instead of the click point on the desktop).
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;

    const MESSAGE_IDS = ['confirmationDialog', 'creditCostDialog', 'agentClientUpdateDialog', 'biasAdjustmentConfirmDialog',
        'baseImageChangeAlertModal', 'imageBiasMaskAlertModal', 'dovecoteNewMailModal'];
    const FORM_IDS = ['positionDialog', 'createTextReplacementModal', 'createRequestBodyReplacementModal', 'updatePresetModal',
        'workspaceEditModal', 'workspaceDumpModal', 'unifiedUploadModal', 'vibeEncodingModal',
        'bulkChangePresetModal', 'cacheMetadataModal', 'timeDateModal', 'weatherLocationModal',
        'tokenDisplayModal', 'naxtCustomTagModal',
        'vfsImportChoiceModal', 'directorFeedbackModal', 'compiledPromptModal', 'chatModal', 'updateNoteModal',
        'requestFormWindow'];
    // forms with Studio's prompt boxes: no 7.css on the client (its textarea and button rules would
    // move the text off the emphasis overlay and restyle the prompt toolbar)
    const PROMPT_IDS = ['createTextReplacementModal', 'createRequestBodyReplacementModal', 'cacheMetadataModal', 'requestFormWindow'];
    // name prompts laid out as the input dialog (a task dialog)
    const TASK_IDS = ['studioSaveNameModal'];
    const ALL_IDS = MESSAGE_IDS.concat(FORM_IDS, TASK_IDS);
    // the confirmation dialog is a task dialog (form inside) rather than a message box when
    const TASK_CLASSES = ['enhance-dialog-modal', 'studio-change-dialog-modal', 'explore-publish-dialog-modal'];
    const TASK_CONTENT = 'input, select, textarea, form, .form-group, .form-row, [data-custom-scrollbar], img, table, .custom-dropdown';
    const ICON_RULES = [
        [/question/i, 'question'],
        [/triangle-exclamation|exclamation-triangle|fa-warning|trash|eraser|skull|radiation/i, 'warning'],
        [/circle-xmark|times-circle|xmark-circle|fa-ban|fa-bug|exclamation-circle|circle-exclamation/i, 'error']
    ];
    const FOOTER_SELECTOR = '.confirmation-controls, .credit-cost-buttons, .bias-confirm-actions, .modal-actions, .form-actions, .dialog-actions, .modal-footer, .modal-footer-colored, .button-row, [class$="-actions"], [class$="-buttons"], [class$="-controls"]';

    const tagged = new Set();
    const openObservers = new WeakMap();
    let bodyObserver = null;

    function isVista() {
        return !!doc && doc.body.classList.contains('desktop-mode') && !doc.body.classList.contains('windows-classic-theme');
    }

    function clientOf(el) {
        return el.querySelector(':scope > .modal-content') || el.querySelector(':scope > .credit-cost-content');
    }

    function iconFor(el) {
        const i = el.querySelector(':scope > .modal-window-title > .modal-window-title-main > i');
        const cls = i ? i.className : '';
        for (const [re, name] of ICON_RULES) if (re.test(cls)) return name;
        return 'info';
    }

    function kindOf(el) {
        if (FORM_IDS.includes(el.id)) return 'form';
        if (TASK_IDS.includes(el.id)) return 'task';
        if (el.id !== 'confirmationDialog') return 'message';
        if (TASK_CLASSES.some((c) => el.classList.contains(c))) return 'task';
        const message = el.querySelector('#confirmationMessage');
        return message && message.querySelector(TASK_CONTENT) ? 'task' : 'message';
    }

    /** The credit cost dialog has no caption of its own: give it the shared one, titled from its header. */
    function ensureCaption(el) {
        if (el.id !== 'creditCostDialog' || el.querySelector(':scope > .modal-window-title')) return;
        const header = el.querySelector('.credit-cost-header span');
        const title = doc.createElement('div');
        title.className = 'modal-window-title';
        title.innerHTML = '<div class="modal-window-title-main"><span></span></div>';
        title.querySelector('span').textContent = header ? header.textContent : 'Dreamscape';
        const controls = doc.createElement('div');
        controls.className = 'modal-window-controls';
        el.prepend(title, controls);
        const content = el.querySelector(':scope > .credit-cost-content');
        if (content) content.classList.add('modal-content');
    }

    /** The row with the buttons becomes the footer; the confirmation text gets its grid cell. */
    function markParts(el) {
        const content = clientOf(el);
        if (!content) return;
        if (!PROMPT_IDS.includes(el.id)) content.classList.add('win7');
        // the button row: the last element (at any depth) that is a known actions row, or whose
        // element children are all buttons; never one that holds a field
        const isRow = (el) => {
            if (!el.querySelector('button') || el.querySelector('input, select, textarea')) return false;
            if (el.matches(FOOTER_SELECTOR)) return true;
            const kids = Array.from(el.children);
            return kids.length > 0 && kids.every((k) => k.tagName === 'BUTTON' || (k.tagName === 'DIV' && k.children.length > 0 && Array.from(k.children).every((g) => g.tagName === 'BUTTON')));
        };
        let footer = null;
        for (const el of Array.from(content.querySelectorAll('*')).reverse()) {
            if (el.closest('.custom-dropdown, .custom-dropdown-menu, .modal-window-title, .modal-window-controls') || el.querySelector(':scope > .custom-dropdown-btn')) continue;
            if (isRow(el)) { footer = el; break; }
        }
        // the outermost row: a .btn-group inside .modal-actions is part of the actions row
        while (footer && footer.parentElement && footer.parentElement !== content && isRow(footer.parentElement)) footer = footer.parentElement;
        for (const el of content.querySelectorAll('.vista-dialog-footer')) if (el !== footer) el.classList.remove('vista-dialog-footer');
        if (footer) footer.classList.add('vista-dialog-footer');
        if (el.id === 'confirmationDialog' && el.dataset.vistaDialog === 'message') {
            const message = content.querySelector('#confirmationMessage');
            if (message && !(message.children.length === 1 && message.firstElementChild.classList.contains('vista-dialog-text'))) {
                const wrap = doc.createElement('div');
                wrap.className = 'vista-dialog-text';
                while (message.firstChild) wrap.appendChild(message.firstChild);
                message.appendChild(wrap);
            }
        }
    }

    function unwrapText(el) {
        const wrap = el.querySelector('#confirmationMessage > .vista-dialog-text');
        if (!wrap) return;
        const message = wrap.parentNode;
        while (wrap.firstChild) message.insertBefore(wrap.firstChild, wrap);
        message.removeChild(wrap);
    }

    function tag(el) {
        ensureCaption(el);
        el.dataset.vistaDialog = kindOf(el);
        el.dataset.vistaIcon = iconFor(el);
        if (!el.dataset.windowClient) { el.dataset.windowClient = 'light'; el.dataset.vistaDialogLight = '1'; }
        // ensureModalApplicationIcon: public/scripts/comp/modalUtils.js
        if (typeof ensureModalApplicationIcon === 'function') ensureModalApplicationIcon(el);
        markParts(el);
        if (!tagged.has(el)) {
            tagged.add(el);
            // re-read when it opens (hidden comes off) and when its variant class changes
            const mo = new MutationObserver(() => { if (isVista() && !el.classList.contains('hidden')) { el.dataset.vistaDialog = kindOf(el); el.dataset.vistaIcon = iconFor(el); markParts(el); } });
            mo.observe(el, { attributes: true, attributeFilter: ['class'] });
            openObservers.set(el, mo);
        }
    }

    function untag(el) {
        if (!tagged.has(el)) return;
        const mo = openObservers.get(el);
        if (mo) mo.disconnect();
        openObservers.delete(el);
        tagged.delete(el);
        delete el.dataset.vistaDialog;
        delete el.dataset.vistaIcon;
        if (el.dataset.vistaDialogLight) { delete el.dataset.windowClient; delete el.dataset.vistaDialogLight; }
        const content = clientOf(el);
        if (content) {
            content.classList.remove('win7');
            for (const row of content.querySelectorAll('.vista-dialog-footer')) row.classList.remove('vista-dialog-footer');
        }
        unwrapText(el);
    }

    function apply() {
        if (!doc) return;
        const vista = isVista();
        for (const id of ALL_IDS) {
            const el = doc.getElementById(id);
            if (!el) continue;
            if (vista) tag(el); else untag(el);
        }
        for (const el of Array.from(tagged)) if (!el.isConnected) untag(el);
    }

    /** The centre of the window a click came from, for placing a dialog over its owner. */
    function ownerCenter(event) {
        if (!isVista()) return null;
        const target = event && event.target && event.target.closest ? event.target : null;
        let owner = target ? target.closest('.modal:not(#confirmationDialog), .gallery-window') : null;
        if (!owner) owner = doc.querySelector('.modal.active-window:not(#confirmationDialog):not(.hidden)');
        if (owner && owner.classList.contains('hidden')) owner = null;
        const rect = owner ? owner.getBoundingClientRect() : null;
        if (!rect || !rect.width || !rect.height) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        return {
            x: Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth),
            y: Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight)
        };
    }

    function init() {
        if (!doc || bodyObserver) return;
        apply();
        bodyObserver = new MutationObserver((records) => {
            let hit = false;
            for (const r of records) {
                if (r.type === 'attributes') { hit = true; break; }
                for (const n of r.addedNodes) if (n.nodeType === 1 && (ALL_IDS.includes(n.id) || n.querySelector)) { hit = true; break; }
                if (hit) break;
            }
            if (hit) apply();
        });
        bodyObserver.observe(doc.body, { childList: true, attributes: true, attributeFilter: ['class'] });
    }

    const api = { apply, ownerCenter, isVista, MESSAGE_IDS, FORM_IDS, TASK_IDS };
    if (root) {
        root.vistaDialogs = api;
        if (doc && doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
        else if (doc) init();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
