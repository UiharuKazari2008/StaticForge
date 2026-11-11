/**
 * Melaton Mobile: operation dialogs (Yozora #709).
 *
 * An operation started outside Studio (Pictures & Videos, Today's prints, File Explorer, a Director
 * card: anything that opens the picture view) asks its questions through desktop dialogs, and under
 * ui-mobile wm-shell.css hides every top-level desktop window, so the operation waited on a dialog
 * nobody could see. Here those questions are WM screens, everywhere on the phone (Studio too):
 *
 *   the Anlas question  showCreditCostDialog's plain confirm (a print, Recast of an upscaled
 *                       picture, Paint, Spellbook) is the shell's WM message box: Generate resolves
 *                       true, Cancel / back false. The cost and output size are the desktop's.
 *   form dialogs        the upscale choices (#creditCostDialog with isUpscaling: Scale, Delivery) and
 *                       Expand Canvas (#imageExpansionDialog) are re-hosted in a full-screen WM form
 *                       (this file's app, not in Start): title bar = the dialog's title, the desktop's
 *                       own fields restyled WM (wm-dialogs.css), soft keys Cancel | Upscale / Expand.
 *                       The soft keys press the dialog's own buttons, so the operation's code (cost,
 *                       Allow Charge, validation, the request) is the desktop's, unchanged.
 *   child windows       a window opened from a hosted dialog (Expand's compiled prompt editor,
 *                       data-parent-modal-id) stacks over it as a sub-page with Done.
 *   pickers / combos    contextMenu click menus (Scale, Delivery) and custom drop-downs inside the form
 *                       are WM drop-downs; a pick runs the desktop row's own handler.
 *   cancel              Cancel, the title X, the back key and Escape (the Android app's back) press the
 *                       dialog's own Cancel / close, so its promise resolves as a cancel and nothing
 *                       waits. Leaving the form for another app (Start menu) cancels it too: a desktop
 *                       dialog never stays open unseen.
 *   paid safety         the phone's upscale form starts on a free delivery (Fast: Ruiko or G10) when
 *                       NovelAI's Instant would spend Anlas; picking Instant shows the desktop's own
 *                       "Upscale (N credits)" on the soft key, and nothing runs until it is pressed.
 *
 * Studio (wmStudio.js) leaves windows this file claims (wmDialogs.claims) alone. Only on phones: does
 * nothing unless window.uiShell is 'mobile'. Styles: public/css/wm-dialogs.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'wm-op';
    const root = document.documentElement;

    // the desktop dialogs drawn as WM forms: what their soft keys press
    const FORMS = {
        creditCostDialog: {
            ok: (win) => win.querySelector('.credit-cost-confirm-btn'),
            cancel: (win) => win.querySelector('.credit-cost-cancel-btn'),
            // the desktop's own text: "Upscale (12 credits)" while Instant would spend Anlas
            label: (btn) => (btn && btn.textContent.replace(/\s+/g, ' ').trim()) || 'OK'
        },
        imageExpansionDialog: {
            ok: () => document.getElementById('submitExpansionBtn'),
            cancel: () => document.getElementById('closeExpansionModalBtn'),
            // over 1 MP or with upscale after, the Anlas show on the key (and are asked before
            // anything runs: submitImageExpansion's showCreditCostDialog, a WM message box here)
            label: () => {
                let cost = 0;
                try { cost = typeof getExpansionCostInfo === 'function' ? getExpansionCostInfo().cost : 0; } catch (_) { cost = 0; }
                return cost > 0 ? `Expand (${cost} Anlas)` : 'Expand';
            },
            // what changes the price: the target size, upscale after, the model / steps
            watch: (win) => win
        },
        // the Director's question (request_form, requestForm.js): its fields as a WM form, the
        // form's own Send on the soft key; Cancel / back / leaving answers it as closed
        requestFormWindow: {
            ok: (win) => win.querySelector('#requestFormFooter [data-form-send]'),
            cancel: () => document.getElementById('requestFormCloseBtn'),
            label: (btn) => (btn && btn.textContent.replace(/\s+/g, ' ').trim()) || 'Send'
        }
    };

    let ws = null; // window.wmShell
    let page = null;
    const layers = []; // [{ win, parent, next, form, obs }] hosted windows, the last on top
    const dismissed = new WeakSet(); // windows being cancelled: pressed once

    const isCurrent = () => !!(ws && ws.current === APP_ID);
    const top = () => layers[layers.length - 1] || null;
    const hosted = (el) => layers.some((l) => l.win === el);

    function isOpen(el) {
        return !!(el && el.isConnected && !el.classList.contains('hidden') && !el.classList.contains('hidden-alt')
            && !el.classList.contains('closing') && !el.classList.contains('minimised'));
    }

    /** A window this file shows: an operation form, or a window opened from a hosted one. */
    function claims(el) {
        if (!el || el.nodeType !== 1) return false;
        if (FORMS[el.id] || hosted(el)) return true;
        const parentId = el.dataset && el.dataset.parentModalId;
        return !!(parentId && layers.some((l) => l.win.id === parentId));
    }

    function windowTitle(win) {
        const t = win.querySelector(':scope > .modal-window-title .modal-window-title-main span, :scope > .modal-window-title span')
            || win.querySelector('.credit-cost-header span, .modal-header h3, .modal-header h2');
        const text = t && t.textContent.replace(/\s+/g, ' ').trim();
        return text || 'Melaton Mobile';
    }

    // ---------------------------------------------------------------- hosting

    function paint() {
        if (!page) return;
        layers.forEach((l, i) => {
            if (i === layers.length - 1) l.win.removeAttribute('data-wmo-under');
            else l.win.setAttribute('data-wmo-under', '');
        });
        // the Director's question on top: its drop-down rows may wrap (wm-dialogs.css), long
        // choices are whole sentences there
        if (top() && top().win.id === 'requestFormWindow') root.setAttribute('data-wmo-form', 'request');
        else root.removeAttribute('data-wmo-form');
        if (!isCurrent() || root.hasAttribute('data-wm-viewer')) return;
        const t = top();
        ws.setTitle(t ? windowTitle(t.win) : 'Melaton Mobile');
        ws.refreshSoftKeys();
    }

    function host(win) {
        if (!ws || root.dataset.wmBoot !== 'done' || hosted(win) || !isOpen(win)) return;
        if (!layers.length && !isCurrent()) ws.open(APP_ID);
        if (!page) return;
        const layer = { win, parent: win.parentNode, next: win.nextSibling, form: FORMS[win.id] || null, obs: null };
        layers.push(layer);
        page.querySelector('.wmo-host').appendChild(win);
        dismissed.delete(win);
        // closing (its own buttons, Escape handlers, closeModal) puts it back
        layer.obs = new MutationObserver(() => { if (!isOpen(win)) release(win); });
        layer.obs.observe(win, { attributes: true, attributeFilter: ['class'] });
        // the upscale form's confirm text follows Scale / Delivery: the soft key with it
        const ok = layer.form && layer.form.ok(win);
        if (ok) {
            const ko = new MutationObserver(() => { if (isCurrent() && top() === layer) ws.refreshSoftKeys(); });
            ko.observe(ok, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
            layer.okObs = ko;
        }
        const watched = layer.form && layer.form.watch && layer.form.watch(win);
        if (watched) {
            const wo = new MutationObserver(refreshLater);
            wo.observe(watched, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'disabled'] });
            watched.addEventListener('input', refreshLater);
            layer.watchObs = wo;
            layer.watched = watched;
        }
        const scroll = win.querySelector('.modal-content, .credit-cost-content');
        if (scroll) scroll.scrollTop = 0;
        paint();
        if (isCurrent()) ws.syncHistory();
    }

    /** A hosted window closed: back where the desktop keeps it; the last one closing ends the form. */
    function release(win) {
        const i = layers.findIndex((l) => l.win === win);
        if (i < 0) return;
        const [layer] = layers.splice(i, 1);
        if (layer.obs) layer.obs.disconnect();
        if (layer.okObs) layer.okObs.disconnect();
        if (layer.watchObs) layer.watchObs.disconnect();
        if (layer.watched) layer.watched.removeEventListener('input', refreshLater);
        if (layer.cancelTimer) clearTimeout(layer.cancelTimer);
        win.removeAttribute('data-wmo-under');
        if (win.id === 'requestFormWindow') root.removeAttribute('data-wmo-form');
        if (win.isConnected) {
            try {
                if (layer.next && layer.next.parentNode === layer.parent) layer.parent.insertBefore(win, layer.next);
                else (layer.parent && layer.parent.isConnected ? layer.parent : document.body).appendChild(win);
            } catch (_) { document.body.appendChild(win); }
        }
        if (!isCurrent()) return;
        if (!layers.length) { ws.back({ app: true }); return; }
        paint();
        ws.syncHistory();
    }

    /** Cancel / Done / back on a window: its own Cancel or close, so its code resolves as a cancel. */
    function cancel(layer) {
        if (!layer || dismissed.has(layer.win)) return;
        const win = layer.win;
        dismissed.add(win);
        const btn = (layer.form && layer.form.cancel(win))
            || win.querySelector('.modal-window-controls .close-btn, .modal-window-controls [id^="close"], [data-action="close"]')
            || Array.from(win.querySelectorAll('button')).find((b) => /^\s*(cancel|close)\s*$/i.test(b.textContent || ''));
        if (btn) btn.click();
        else if (typeof window.closeModal === 'function') { try { window.closeModal(win); } catch (_) { /* below */ } }
        // a window that keeps itself open after its close is let go anyway: this hosting of it only
        // (released and opened again within the second, the new form stays)
        if (layer.cancelTimer) clearTimeout(layer.cancelTimer);
        layer.cancelTimer = setTimeout(() => {
            layer.cancelTimer = null;
            if (!layers.includes(layer)) return;
            if (!win.classList.contains('hidden')) win.classList.add('hidden');
            release(win);
        }, 1000); // after closeModal's own 600 ms fallback (modalUtils.js)
    }

    function cancelTop() { cancel(top()); }

    let refreshQueued = false;
    function refreshLater() {
        if (refreshQueued) return;
        refreshQueued = true;
        setTimeout(() => { refreshQueued = false; if (isCurrent()) ws.refreshSoftKeys(); }, 120);
    }

    function cancelAll() {
        for (let i = layers.length - 1; i >= 0; i--) cancel(layers[i]);
    }

    function okKey(layer) {
        const btn = layer.form.ok(layer.win);
        const usable = !!(btn && !btn.disabled && !btn.classList.contains('hidden'));
        return {
            label: layer.form.label(btn),
            disabled: !usable,
            action: () => {
                const b = layer.form.ok(layer.win);
                if (b && !b.disabled) b.click();
            }
        };
    }

    function softKeys() {
        const t = top();
        if (!t) return { left: null, right: null };
        if (!t.form) return { left: { label: 'Done', action: cancelTop }, right: null };
        return { left: { label: 'Cancel', action: cancelTop }, right: okKey(t) };
    }

    /**
     * Every route that opens a window (openModal): an operation form opening, or a window opened from
     * a hosted one, comes into the form. openModal on a hosted window (asked for again) only repaints.
     */
    function wrapOpenModal() {
        const orig = window.openModal;
        if (typeof orig !== 'function' || orig._wmOp) return;
        const wrapped = function (m) {
            const out = orig.apply(this, arguments);
            try {
                if (m && m.nodeType === 1 && claims(m)) {
                    if (m.id === 'creditCostDialog') lastCredit = m;
                    if (hosted(m)) paint(); else host(m);
                }
            } catch (err) { console.warn('[wmDialogs] host', err); }
            return out;
        };
        wrapped._wmOp = true;
        window.openModal = wrapped;
    }

    /**
     * Expand Canvas (imageExpansion.js) builds its dialog and reads the picture's metadata before the
     * form can be used (~250 ms of script on a throttled phone, then a round trip): the shell's wait
     * cursor from the tap until it is ready, painted first (the dialog's own cover spinner is hidden in
     * wm-dialogs.css). Every caller goes through the global, so the picture menu, Studio and Spellbook too.
     */
    function wrapExpansion() {
        const orig = window.openImageExpansionModal;
        if (typeof orig !== 'function' || orig._wmOp) return;
        const wrapped = function () {
            const args = arguments;
            const self = this;
            let result = null;
            // the cursor ends when the form is usable (its cover drops .show), not when the whole
            // call settles: the prompt compile after it runs in the background (#723 review)
            const ready = ws.busy(() => {
                try { result = Promise.resolve(orig.apply(self, args)); } catch (err) { result = Promise.reject(err); }
                const cover = document.querySelector('.gallery-move-right-panel-cover.show');
                if (!cover || typeof MutationObserver !== 'function') return result;
                return new Promise((resolve) => {
                    const mo = new MutationObserver(() => { if (!cover.classList.contains('show')) { mo.disconnect(); resolve(); } });
                    mo.observe(cover, { attributes: true, attributeFilter: ['class'] });
                    result.then(() => { mo.disconnect(); resolve(); }, () => { mo.disconnect(); resolve(); });
                });
            }, { paint: true });
            // callers still get the call's own promise (and its errors)
            return ready.then(() => result);
        };
        wrapped._wmOp = true;
        window.openImageExpansionModal = wrapped;
    }

    // ---------------------------------------------------------------- the Anlas question

    let lastCredit = null; // the #creditCostDialog the last openModal showed

    /**
     * showCreditCostDialog (creditCostDialog.js): the plain confirm is a WM message box; the upscale
     * form is the desktop's, hosted above (openModal), starting on a free delivery when Instant costs.
     */
    function wrapCreditCost() {
        /* global showCreditCostDialog */
        if (typeof showCreditCostDialog !== 'function' || showCreditCostDialog._wmOp) return;
        const orig = showCreditCostDialog;
        const wrapped = function (cost, event, outputResolution, isUpscaling, imageWidth, imageHeight, isFreeUpscaling) {
            if (!isUpscaling) {
                let text = `This will cost ${cost} Anlas to generate`;
                if (outputResolution && outputResolution.width && outputResolution.height) text += ` (${outputResolution.width} x ${outputResolution.height})`;
                text += '.';
                return ws.messageBox({
                    title: 'Payment Required',
                    text,
                    icon: 'question',
                    buttons: [{ text: 'Generate', value: true, default: true }, { text: 'Cancel', value: false }],
                    cancelValue: false
                }).then((v) => v === true);
            }
            lastCredit = null;
            const out = orig.apply(this, arguments);
            if (!isFreeUpscaling && lastCredit) freeDelivery(lastCredit);
            return out;
        };
        wrapped._wmOp = true;
        window.showCreditCostDialog = wrapped;
    }

    /** Delivery Instant (NovelAI, spends Anlas) -> Fast, through the desktop picker's own select. */
    function freeDelivery(dialog) {
        try {
            const btns = dialog.querySelectorAll('.custom-dropdown-btn[data-click-menu]');
            const speed = btns[1];
            if (!speed || !/^\s*instant\s*$/i.test(speed.textContent || '')) return;
            /* global contextMenu */
            const cfg = contextMenu.clickMenuConfigs && contextMenu.clickMenuConfigs[speed.dataset.clickMenu];
            if (cfg && typeof cfg.onAction === 'function') cfg.onAction('picker-select', speed, { value: 'fast' });
        } catch (err) { console.warn('[wmDialogs] delivery', err); }
    }

    // ---------------------------------------------------------------- pickers and drop-downs

    const resolveV = (v, target) => { try { return typeof v === 'function' ? v(target) : v; } catch (_) { return undefined; } };

    /** A contextMenu click menu (attachPickerMenu: Scale, Delivery) as WM drop-down rows. */
    function itemsFromConfig(config, target) {
        const run = (action, item) => {
            if (typeof config.onAction === 'function') config.onAction(action, target, item);
            else document.dispatchEvent(new CustomEvent('contextMenuAction', { detail: { action, target, item, menu: contextMenu } }));
        };
        try { if (typeof config.beforeShow === 'function') config.beforeShow(null, target, true); } catch (_) { /* as is */ }
        const out = [];
        for (const section of config.sections || []) {
            if (!section || !Array.isArray(section.items)) continue;
            if (out.length && out[out.length - 1] !== '-') out.push('-');
            for (const item of section.items) {
                if (!item) continue;
                if (item.separator) { if (out.length && out[out.length - 1] !== '-') out.push('-'); continue; }
                if (resolveV(item.hidden, target) === true) continue;
                let label = resolveV(item.text, target);
                if (!label) continue;
                const sub = resolveV(item.subtext, target);
                // a short note (Instant: NovelAI) stays with the row; long hints have no WM room
                if (sub && String(sub).length <= 16) label = `${label} (${sub})`;
                const row = { label: String(label).replace(/\s+/g, ' ').trim(), disabled: !!resolveV(item.disabled, target) };
                if (item.indicatorMark === 'radio') row.radio = !!item.checked;
                else if (item.showIndicator) row.checked = !!item.checked;
                row.action = () => { run(item.action, item); setTimeout(paint, 0); };
                out.push(row);
            }
        }
        while (out.length && out[out.length - 1] === '-') out.pop();
        while (out.length && out[0] === '-') out.shift();
        return out;
    }

    let lastPicker = { el: null, at: 0 };

    /** The combo's width given to the shell's popup goes with its drop-down (other menus share it). */
    function clearPopupWidth() {
        const pop = document.querySelector('#wmShell > .wm-popup');
        if (pop) pop.style.minWidth = '';
    }

    function patchContextMenu() {
        if (typeof contextMenu === 'undefined' || !contextMenu || typeof contextMenu._openMenu !== 'function') return false;
        if (contextMenu._wmOpPatched) return true;
        contextMenu._wmOpPatched = true;
        const prev = contextMenu._openMenu;
        contextMenu._openMenu = function (event, target, trigger) {
            if (!isCurrent() || !page || !target || !page.contains(target)) return prev.apply(this, arguments);
            const config = trigger === 'click'
                ? (this.clickMenuConfigs && this.clickMenuConfigs[target.dataset.clickMenu])
                : (this.configs && this.configs[target.dataset.contextMenu]);
            if (!config) return undefined;
            // a touch raises the desktop menu twice (touch, then its click): the second would close it
            const pop = document.querySelector('#wmShell > .wm-popup');
            if (pop && !pop.hidden && lastPicker.el === target && Date.now() - lastPicker.at < 600) return undefined;
            lastPicker = { el: target, at: Date.now() };
            let items = [];
            try { items = itemsFromConfig(config, target); } catch (err) { console.warn('[wmDialogs] menu', err); }
            if (!items.length) return undefined;
            ws.dropdown(target, items, 'left', () => {
                clearPopupWidth();
                if (typeof config.onHide === 'function') { try { config.onHide(target); } catch (_) { /* best effort */ } }
            });
            const p = document.querySelector('#wmShell > .wm-popup');
            if (p && !p.hidden) p.style.minWidth = `${Math.round(target.getBoundingClientRect().width)}px`;
            return undefined;
        };
        return true;
    }

    let proxying = false;

    /**
     * A desktop custom drop-down (setupDropdown: Expansion Mode, Target Resolution, Image Position,
     * Model, Sampler ...) that just opened: its rows as a WM drop-down (groups as greyed headings, the
     * selected row with the dot); a pick clicks the desktop row, so its handler does the work.
     */
    function proxyDropdown(btn) {
        const box = btn.closest('.custom-dropdown');
        const menu = box && box.querySelector(':scope > .custom-dropdown-menu');
        if (!menu || menu.classList.contains('hidden') || getComputedStyle(menu).display === 'none') return;
        const rows = Array.from(menu.querySelectorAll('.custom-dropdown-group, .custom-dropdown-option'));
        if (!rows.some((r) => r.classList.contains('custom-dropdown-option'))) return;
        let picked = false;
        const items = [];
        for (const r of rows) {
            // Image Position names its cell; Expansion Mode's description stays out of the row
            const named = r.querySelector('.mask-bias-label') || r.querySelector(':scope > div > span:first-child');
            const text = ((named && r.classList.contains('custom-dropdown-option')) ? named : r).textContent.replace(/\s+/g, ' ').trim();
            if (!text || r.classList.contains('hidden')) continue;
            if (r.classList.contains('custom-dropdown-group')) {
                if (items.length) items.push('-');
                items.push({ label: text, disabled: true, heading: true });
                continue;
            }
            items.push({
                label: text,
                radio: r.classList.contains('selected') || r.getAttribute('aria-selected') === 'true',
                disabled: r.classList.contains('disabled') || r.getAttribute('aria-disabled') === 'true' || r.style.opacity === '0.5',
                action: () => { picked = true; r.click(); setTimeout(paint, 60); }
            });
        }
        // the desktop list leaves the layout first, so the combo is measured where it sits
        menu.classList.add('wmo-dd-proxied');
        ws.dropdown(box, items, 'left', () => {
            clearPopupWidth();
            menu.classList.remove('wmo-dd-proxied');
            // closed without a pick: the desktop list closes too
            setTimeout(() => {
                if (picked || menu.classList.contains('hidden')) return;
                proxying = true;
                try { btn.click(); } finally { proxying = false; }
                if (!menu.classList.contains('hidden')) menu.classList.add('hidden');
                box.classList.remove('open', 'active');
            }, 0);
        });
        const pop = document.querySelector('#wmShell > .wm-popup');
        if (pop && !pop.hidden) pop.style.minWidth = `${Math.round(box.getBoundingClientRect().width)}px`;
    }

    // ---------------------------------------------------------------- app

    function mount(p) {
        page = p;
        page.classList.add('wm-op');
        page.innerHTML = '<div class="wmo-host"></div>';
        page.addEventListener('click', (e) => {
            if (proxying || !e.target.closest) return;
            const btn = e.target.closest('.custom-dropdown > button, .custom-dropdown > .custom-dropdown-btn');
            if (!btn || !page.contains(btn) || btn.hasAttribute('data-click-menu')) return;
            setTimeout(() => proxyDropdown(btn), 0);
        }, true);
        // a toggle or field that changes the dialog (Advanced, Director) can change what OK does
        page.addEventListener('click', () => setTimeout(() => { if (isCurrent()) ws.refreshSoftKeys(); }, 60));
    }

    function register() {
        ws = window.wmShell;
        if (!ws || typeof ws.registerApp !== 'function') return;
        ws.registerApp({
            id: APP_ID,
            title: 'Melaton Mobile',
            icon: 'app-programs',
            inStart: false,
            sip: true,
            mount,
            show(p) {
                page = p;
                patchContextMenu();
                paint();
            },
            // the shell's title when the picture view closes over a form: the form's own, not
            // "Melaton Mobile" for a frame (Expand Canvas from the viewer, #723)
            titleNow() {
                const t = top();
                return t ? windowTitle(t.win) : null;
            },
            hide() {
                // another app replaces the form: its dialogs cancel (none stays open unseen)
                const a = document.activeElement;
                if (a && page && page.contains(a) && typeof a.blur === 'function') a.blur();
                cancelAll();
            },
            softKeys,
            historyDepth() { return Math.max(0, layers.length - 1); },
            onBack() {
                // a window opened from the form closes first; then the form cancels and the app closes
                if (layers.length > 1) { cancelTop(); return true; }
                cancelTop();
                return false;
            },
            // WM: a form with its own Cancel / OK soft keys has no corner button (as the Logon and
            // connection dialogs); a window shown without a form (Done) has ok, which does Done
            titleKind() {
                const t = top();
                return t && !t.form ? 'ok' : null;
            },
            onTitleOk() {
                if (!top()) return false;
                cancelTop();
                return true;
            }
        });
        wrapOpenModal();
        wrapCreditCost();
        wrapExpansion();
        if (!patchContextMenu()) {
            const t = setInterval(() => { if (patchContextMenu()) clearInterval(t); }, 1000);
            setTimeout(() => clearInterval(t), 60000);
        }
        // the shell puts the app title back when the picture view closes: the form keeps the dialog's
        if (typeof MutationObserver === 'function') {
            new MutationObserver(() => { if (!root.hasAttribute('data-wm-viewer')) paint(); })
                .observe(root, { attributes: true, attributeFilter: ['data-wm-viewer'] });
        }
    }

    window.wmDialogs = { claims, get open() { return layers.length > 0; } };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
