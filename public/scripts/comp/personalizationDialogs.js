/**
 * Personalization's dialogs (Yukimi 2026-10-21), the two Vista opens from the hub as property
 * sheets, measured on the Vista Aero VM and placed by dialog units like Taskbar Properties:
 *
 *   Screen Saver Settings   themeui.dll.mui dialog 1015 (252 x 218): the monitor picture with the
 *                           saver running in it (themeui bitmap 126), Screen saver ▾, Settings...,
 *                           Preview, Wait [n] minutes, On resume, display logon screen, Power
 *                           management. The savers run in screenSaver.js.
 *   Sound                   mmsys.cpl.mui: Playback / Recording (no devices) and Sounds (dialog
 *                           112): Sound Scheme ▾ (Windows Default / No Sounds), Program Events (a
 *                           tree of this desktop's sound events), Play Windows Startup sound,
 *                           Sounds ▾ ((None) or any of the scheme's WAVs), Test.
 *
 * Screen Saver Settings is laid out in Segoe UI 9 pt dialog units (x * 7/4, y * 15/8; its client
 * 461x478, the pane 447x414): every control on the VM lands on that grid. Sound keeps Taskbar
 * Properties' Tahoma grid (x * 6/4, y * 13/8; 398x423) with Segoe UI 9 pt text, as mmsys draws it.
 *
 *   Photos Screen Saver Settings   PhotoScreensaver.scr.mui dialog 2004 (Segoe units), Settings...
 *                           for Photos: Windows Pictures, workspace images (current / all / one
 *                           workspace, an age limit, favorites only), an Image Search saved from
 *                           Image Search's Save (frame=screensaver), or a VFS folder (Browse For
 *                           Folder); the theme, the speed, Shuffle contents and Monotone.
 *   Theme Settings          themeui.dll.mui dialog 1000 (Themes: the theme of any workspace, with
 *                           Vista's Sample picture) plus an Appearance tab for this workspace's
 *                           name, colours and fonts.
 *
 * Both save to the workspace (desktopPersonalization.js) on Apply / OK; Cancel drops the changes.
 * The combo boxes open their lists through the app's context menu (contextMenu.attachPickerMenu),
 * so a list is never clipped by the dialog. The dialogs are ordinary windows (not always on top);
 * their message boxes are the app's Vista message box (confirmationDialog.js, vistaDialogs.js),
 * with Vista's own icons.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-personalization';

    const SAVER_NAMES = {
        none: '(None)',
        aurora: 'Aurora',
        blank: 'Blank',
        bubbles: 'Bubbles',
        focus: 'Focus Cover',
        logo: 'Melaton Logo',
        mystify: 'Mystify',
        photos: 'Photos',
        ribbons: 'Ribbons'
    };
    // Vista's list order: (None), then by name
    const SAVER_ORDER = ['none', 'aurora', 'blank', 'bubbles', 'focus', 'mystify', 'photos', 'ribbons', 'logo'];

    // the Program Events tree: Vista's names where an event matches one of Windows', ours otherwise
    const EVENT_GROUPS = [
        { name: 'Melaton', events: [
            ['critical-stop', 'Critical Stop'],
            ['dialog', 'Default Beep'],
            ['warning', 'Exclamation'],
            ['shutdown', 'Exit Melaton'],
            ['notify', 'New Mail Notification'],
            ['balloon', 'Notification'],
            ['print-complete', 'Print Complete'],
            ['error', 'Program Error'],
            ['unlock', 'Unlock Computer'],
            ['lock', 'Melaton Logoff'],
            ['logon', 'Melaton Logon'],
            ['uac', 'Melaton User Account Control']
        ] },
        { name: 'Melaton Explorer', events: [
            ['recycle', 'Empty Recycle Bin'],
            ['navigate', 'Start Navigation']
        ] },
        { name: 'Dreamscape', events: [
            ['planet-enter', 'Open Planet Switcher'],
            ['planet-activate', 'Planet Selected'],
            ['planet-switch', 'Planet Switched'],
            ['print-error', 'Print Failed']
        ] }
    ];

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function pers() {
        return root.desktopPersonalization || null;
    }

    function sounds() {
        return root.desktopSounds || null;
    }

    // ---- dialog units (taskbarProperties.js / remoteAccessProperties.js) -----------------------
    // the grid the markup below is being built on; each dialog sets it before it builds

    const TAHOMA = { x: 1.5, y: 1.625 };
    const SEGOE = { x: 1.75, y: 1.875 };
    let units = TAHOMA;

    function bottomPx(y, h) {
        return Math.floor((y + h) * units.y);
    }

    function dlu(x, y, w, h, inset = 0) {
        const left = Math.round(x * units.x);
        const top = Math.round(y * units.y);
        let s = `left:${left + inset}px;top:${top + inset}px;`;
        if (w !== undefined) s += `width:${Math.round((x + w) * units.x) - left - 2 * inset}px;`;
        if (h !== undefined) s += `height:${bottomPx(y, h) - top - 2 * inset}px;`;
        return s;
    }

    function checkStyle(x, y, w, h) {
        const top = Math.round(y * units.y);
        const height = bottomPx(y, h) - top;
        return `${dlu(x, y, w, h)}padding-top:${Math.max(0, Math.floor((height - 13) / 2))}px;`;
    }

    function group(x, y, w, h, label) {
        return `<div class="tbp-group" style="${dlu(x, y, w, h)}"><span class="tbp-group-label">${label}</span></div>`;
    }

    function text(x, y, w, h, body, cls = '') {
        return `<div class="tbp-ctl tbp-static ${cls}" style="${dlu(x, y, w, h)}">${body}</div>`;
    }

    function button(x, y, w, h, label, action) {
        return `<button type="button" class="tbp-ctl tbp-button" style="${dlu(x, y, w, h, 1)}" data-action="${action}">${label}</button>`;
    }

    function check(id, x, y, w, h, label) {
        return `<div class="tbp-ctl tbp-check" style="${checkStyle(x, y, w, h)}"><input type="checkbox" id="${id}"><label for="${id}"><span>${label}</span></label></div>`;
    }

    /** A drop-down list (CBS_DROPDOWNLIST): the closed box; the list is a context-menu picker. */
    function combo(cls, x, y, w, label) {
        return `<div class="tbp-ctl cpl-pers-combo ${cls}" style="${dlu(x, y, w)}" role="combobox" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(label)}"><span class="cpl-pers-combo-text"></span></div>`;
    }

    // ---- windows (remoteAccessProperties.js makeWindow / showWindow) ---------------------------

    function el(tag, className, textContent) {
        const n = doc.createElement(tag);
        if (className) n.className = className;
        if (textContent !== undefined) n.textContent = textContent;
        return n;
    }

    function makeWindow(id, title, clientClass, iconUrl, sheet) {
        const modal = el('div', `modal hidden tbp-window ${clientClass}-window`);
        modal.id = id;
        modal.dataset.windowIdentifier = id;
        modal.dataset.windowRestorePosition = 'false';
        modal.dataset.windowRestoreSize = 'false';
        modal.dataset.windowFixedSize = 'true';
        modal.dataset.vistaDialog = 'form';
        modal.dataset.windowClient = 'light';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', title);
        const cap = el('div', 'modal-window-title');
        const main = el('div', 'modal-window-title-main');
        // both show their 16 px icon in the caption on the VM
        if (iconUrl) {
            const img = el('img', 'icon-image');
            img.src = iconUrl;
            img.alt = '';
            img.width = 16;
            img.height = 16;
            main.appendChild(img);
        } else {
            modal.dataset.captionIcon = 'none';
        }
        main.appendChild(el('span', '', title));
        cap.appendChild(main);
        const controls = el('div', 'modal-window-controls');
        const close = el('button', 'btn-danger close-btn btn-small');
        close.type = 'button';
        close.title = 'Close';
        const x = el('i', 'fa-regular fa-xmark-large');
        x.setAttribute('aria-hidden', 'true');
        close.appendChild(x);
        controls.appendChild(close);
        const content = el('div', `modal-content win7 tbp-client ${sheet === false ? '' : 'tbp-sheet '}${clientClass}`);
        modal.append(cap, el('div', 'modal-focus-overlay'), controls, content);
        doc.body.appendChild(modal);
        return { modal, content, close };
    }

    function showWindow(modal, ownerEl) {
        // the taskbar button shows Control Panel's icon (ensureModalApplicationIcon)
        const owner = ownerEl || doc.getElementById('melatonControlPanelModal');
        if (owner && !owner.classList.contains('hidden')) modal.dataset.iconOwnerId = owner.id;
        callGlobal('openModal', modal);
        if (modal.classList.contains('hidden')) modal.classList.remove('hidden');
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

    function closeWindow(modal) {
        if (!modal) return;
        try {
            callGlobal('closeModal', modal);
        } catch (_) { /* window manager gone */ }
        setTimeout(() => { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 400);
    }

    /** A Vista message box over `owner`: the app's confirmation dialog in its message form. */
    function message(title, text, owner, kind = 'info') {
        const icon = { info: 'fas fa-info-circle', warning: 'fas fa-exclamation-triangle', error: 'fas fa-times-circle', question: 'fas fa-question-circle' }[kind];
        if (typeof root.showConfirmationDialog === 'function') {
            const r = owner && owner.getBoundingClientRect ? owner.getBoundingClientRect() : null;
            const at = r ? { target: owner, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 } : null;
            return root.showConfirmationDialog(text, [{ text: 'OK', value: true, className: 'btn-standard primary' }], at, { title, icon, showCloseButton: true });
        }
        const box = root.bootMessageBox;
        return box ? box.show({ title, icon: kind === 'question' ? 'info' : kind, message: text }) : Promise.resolve(null);
    }

    function sheetHtml(tabs, selected, pages) {
        return `
            <div class="tbp-tabs" role="tablist">
                ${tabs.map((t, i) => `<button type="button" class="tbp-tab${i === selected ? ' is-selected' : ''}" role="tab" aria-selected="${i === selected}" data-tab="${i}" tabindex="${i === selected ? 0 : -1}">${t}</button>`).join('')}
            </div>
            <div class="tbp-pane">
                ${pages.map((p, i) => `<div class="tbp-page" role="tabpanel"${i === selected ? '' : ' hidden'} data-page="${i}">${p}</div>`).join('')}
            </div>
            <div class="tbp-footer">
                <button type="button" class="tbp-button tbp-footer-button" data-action="ok" data-dialog-primary="1">OK</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="cancel">Cancel</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="apply" disabled>Apply</button>
            </div>`;
    }

    /** One property sheet: tabs, OK / Cancel / Apply, Escape and Enter. */
    function makeSheet({ id, title, cls, icon, tabs, selected, pages, onApply, onClose, onAction }) {
        const { modal, content, close } = makeWindow(id, title, cls, icon);
        content.innerHTML = sheetHtml(tabs, selected, pages);
        const sheet = { modal, content, dirty: false };
        sheet.setDirty = (on) => {
            sheet.dirty = on;
            const apply = content.querySelector('[data-action="apply"]');
            if (apply) apply.disabled = !on;
        };
        sheet.finish = () => {
            if (onClose) onClose();
            closeWindow(modal);
        };
        const apply = () => {
            if (sheet.dirty) onApply();
            sheet.setDirty(false);
        };
        close.addEventListener('click', sheet.finish);
        content.addEventListener('click', (ev) => {
            const tab = ev.target.closest('.tbp-tab');
            if (tab) {
                const i = Number(tab.dataset.tab);
                content.querySelectorAll('.tbp-tab').forEach((t) => {
                    const on = t === tab;
                    t.classList.toggle('is-selected', on);
                    t.setAttribute('aria-selected', String(on));
                    t.tabIndex = on ? 0 : -1;
                });
                content.querySelectorAll('.tbp-page').forEach((p) => { p.hidden = Number(p.dataset.page) !== i; });
                return;
            }
            const b = ev.target.closest('[data-action]');
            if (!b || b.disabled) return;
            const action = b.dataset.action;
            if (action === 'ok') { apply(); sheet.finish(); return; }
            if (action === 'cancel') { sheet.finish(); return; }
            if (action === 'apply') { apply(); return; }
            if (onAction) onAction(action, b, ev);
        });
        modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                sheet.finish();
            } else if (ev.key === 'Enter' && !ev.target.matches('button, select, textarea, [role="combobox"], [role="tree"], [role="treeitem"]')) {
                ev.preventDefault();
                apply();
                sheet.finish();
            }
        });
        return sheet;
    }

    function wireCombo(node, items, value, onSelect) {
        const cm = root.contextMenu;
        const label = node.querySelector('.cpl-pers-combo-text');
        const sync = () => {
            const cur = items().find((i) => String(i.value) === String(value()));
            label.textContent = cur ? cur.text : '';
        };
        sync();
        if (cm && typeof cm.attachPickerMenu === 'function') {
            cm.attachPickerMenu(node, {
                maxHeight: true,
                items,
                value,
                onSelect: (v, item) => { onSelect(v, item); sync(); }
            });
        }
        // the keyboard steps through the list, as a closed Vista drop-down list does
        node.addEventListener('keydown', (ev) => {
            if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
            ev.preventDefault();
            const list = items().filter((i) => !i.separator && !i.disabled);
            const at = list.findIndex((i) => String(i.value) === String(value()));
            const next = list[Math.min(list.length - 1, Math.max(0, at + (ev.key === 'ArrowDown' ? 1 : -1)))];
            if (next) { onSelect(next.value, next); sync(); }
        });
        return sync;
    }

    // ---- Screen Saver Settings ------------------------------------------------------------------

    let saverDlg = null;

    function screenSaverPage() {
        return `
            <div class="tbp-ctl cpl-pers-monitor" style="${dlu(63, 7, 125, 107)}">
                <img src="${ART}/monitor.png" width="185" height="163" alt="" draggable="false">
                <canvas class="cpl-pers-monitor-screen" aria-hidden="true"></canvas>
            </div>
            ${group(7, 113, 238, 48, '<u>S</u>creen saver')}
            ${combo('cpl-pers-saver', 13, 124, 115, 'Screen saver')}
            ${button(132, 123, 50, 14, 'Se<u>t</u>tings...', 'saver-settings')}
            ${button(186, 123, 50, 14, 'Pre<u>v</u>iew', 'saver-preview')}
            ${text(13, 144, 17, 9, '<u>W</u>ait:', 'cpl-pers-wait-label')}
            <div class="tbp-ctl tbp-spinedit cpl-pers-wait" style="${dlu(32, 142, 33, 12)}">
                <input type="text" class="tbp-edit" inputmode="numeric" maxlength="4" aria-label="Wait, in minutes">
                <span class="tbp-spin tbp-spin-up" data-action="wait-up" aria-hidden="true"></span>
                <span class="tbp-spin tbp-spin-down" data-action="wait-down" aria-hidden="true"></span>
            </div>
            ${text(69, 144, 28, 9, 'minutes', 'cpl-pers-wait-unit')}
            ${check('cplPersResume', 97, 144, 135, 9, 'On <u>r</u>esume, display logon screen')}
            ${group(7, 163, 238, 49, 'Power management')}
            ${text(13, 175, 200, 16, 'Conserve energy or maximize performance by adjusting display brightness and other power settings.')}
            <div class="tbp-ctl tbp-link-row" style="${dlu(13, 195, 200, 14)}"><button type="button" class="tbp-link" data-action="power">Change power settings...</button></div>`;
    }

    function saverItems() {
        return SAVER_ORDER.map((id) => ({ value: id, text: SAVER_NAMES[id] }));
    }

    function restartSaverPreview() {
        if (!saverDlg) return;
        if (saverDlg.preview) saverDlg.preview.stop();
        saverDlg.preview = null;
        const canvas = saverDlg.content.querySelector('.cpl-pers-monitor-screen');
        const ss = root.screenSaver;
        const id = saverDlg.pending.id;
        // (None) and the focus cover show the desktop in the monitor, as Vista's (None) does;
        // Bubbles draws over it (screenSaver.js paints the desktop picture into the canvas)
        if (ss) saverDlg.preview = ss.attachPreview(canvas, id === 'none' || id === 'focus' ? 'desktop' : id, { photos: saverDlg.pending.photos });
    }

    function syncSaverControls() {
        const c = saverDlg.content;
        const p = saverDlg.pending;
        const none = p.id === 'none';
        c.querySelector('.cpl-pers-wait input').value = String(p.wait);
        c.querySelector('#cplPersResume').checked = p.resumeLogon;
        // Vista greys Settings, Preview, Wait and the check box while (None) is chosen
        ['saver-settings', 'saver-preview'].forEach((a) => { c.querySelector(`[data-action="${a}"]`).disabled = none; });
        c.querySelector('.cpl-pers-wait input').disabled = none;
        c.querySelector('.cpl-pers-wait').classList.toggle('is-disabled', none);
        c.querySelector('#cplPersResume').disabled = none;
        c.querySelector('.cpl-pers-wait-label').classList.toggle('is-disabled', none);
        c.querySelector('.cpl-pers-wait-unit').classList.toggle('is-disabled', none);
        if (saverDlg.syncCombo) saverDlg.syncCombo();
    }

    function setWait(n) {
        const v = Math.min(9999, Math.max(1, Math.round(Number(n) || 1)));
        if (v === saverDlg.pending.wait) {
            saverDlg.content.querySelector('.cpl-pers-wait input').value = String(v);
            return;
        }
        saverDlg.pending.wait = v;
        saverDlg.sheet.setDirty(true);
        syncSaverControls();
    }

    function openScreenSaver() {
        if (!doc) return;
        if (saverDlg) { callGlobal('openModal', saverDlg.modal); return; }
        const P = pers();
        const saved = P ? JSON.parse(JSON.stringify(P.get().screenSaver)) : { id: 'none', wait: 10, resumeLogon: false, photos: {} };
        units = SEGOE;
        const page = screenSaverPage();
        units = TAHOMA;
        const sheet = makeSheet({
            id: 'screenSaverSettingsDialog',
            title: 'Screen Saver Settings',
            cls: 'cpl-pers-saver-sheet',
            icon: `${ART}/personalization-16.png`,
            tabs: ['Screen Saver'],
            selected: 0,
            pages: [page],
            onApply: () => { if (P) P.update({ screenSaver: JSON.parse(JSON.stringify(saverDlg.pending)) }); },
            onClose: () => {
                if (saverDlg && saverDlg.preview) saverDlg.preview.stop();
                if (photosDlg) closePhotoSettings(false);
                saverDlg = null;
            },
            onAction: (action) => {
                const p = saverDlg.pending;
                if (action === 'wait-up') setWait(p.wait + 1);
                else if (action === 'wait-down') setWait(p.wait - 1);
                else if (action === 'saver-preview' && root.screenSaver) root.screenSaver.preview(p.id, { photos: p.photos });
                else if (action === 'saver-settings') {
                    // only Photos has settings in Vista; the others say so (ssBranded.scr string 302)
                    if (p.id === 'photos') openPhotoSettings();
                    else message(SAVER_NAMES[p.id], 'This screen saver has no options that you can set.', saverDlg.modal);
                } else if (action === 'power') {
                    message('Power Options', 'Power Options is not available in Melaton yet.', saverDlg.modal);
                }
            }
        });
        saverDlg = { sheet, modal: sheet.modal, content: sheet.content, saved, pending: JSON.parse(JSON.stringify(saved)), preview: null, syncCombo: null };
        const c = sheet.content;
        saverDlg.syncCombo = wireCombo(c.querySelector('.cpl-pers-saver'), saverItems, () => saverDlg.pending.id, (id) => {
            if (id === saverDlg.pending.id) return;
            saverDlg.pending.id = id;
            sheet.setDirty(true);
            syncSaverControls();
            restartSaverPreview();
        });
        const wait = c.querySelector('.cpl-pers-wait input');
        wait.addEventListener('change', () => setWait(wait.value));
        // Enter or OK right after typing must keep the number (change fires only on blur)
        wait.addEventListener('input', () => {
            const n = Math.round(Number(wait.value));
            if (!Number.isFinite(n) || n < 1) return;
            saverDlg.pending.wait = Math.min(9999, n);
            sheet.setDirty(true);
        });
        wait.addEventListener('keydown', (ev) => {
            if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
                ev.preventDefault();
                setWait(saverDlg.pending.wait + (ev.key === 'ArrowUp' ? 1 : -1));
            }
        });
        c.querySelector('#cplPersResume').addEventListener('change', (ev) => {
            saverDlg.pending.resumeLogon = ev.target.checked;
            sheet.setDirty(true);
        });
        syncSaverControls();
        showWindow(sheet.modal);
        // after layout, so the monitor's canvas has its size
        root.requestAnimationFrame(() => root.requestAnimationFrame(restartSaverPreview));
    }

    // ---- Photos Screen Saver Settings -----------------------------------------------------------
    // PhotoScreensaver.scr.mui dialog 2004 in Segoe UI 9 pt units: Vista's two picture sources
    // become four (Windows Pictures, workspace images, an Image Search, a folder); the theme, the
    // speed and Shuffle contents are Vista's, Monotone is ours. Save keeps the choices in the Screen
    // Saver Settings sheet (its Apply / OK store them).

    let photosDlg = null;

    const PHOTO_THEME_NAMES = [['random', 'Random'], ['classic', 'Classic'], ['fade', 'Fade'], ['panzoom', 'Pan and zoom'],
        ['travel', 'Travel'], ['frame', 'Frame'], ['stack', 'Stack']];
    const PHOTO_SPEED_NAMES = [['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']];
    const PHOTO_AGE_NAMES = [['any', 'Any time'], ['day', 'The past day'], ['week', 'The past week'], ['month', 'The past month'], ['year', 'The past year']];

    function radio(id, name, value, x, y, w, h, label) {
        return `<div class="tbp-ctl tbp-check" style="${checkStyle(x, y, w, h)}"><input type="radio" id="${id}" name="${name}" value="${value}"><label for="${id}"><span>${label}</span></label></div>`;
    }

    function rule(x, y, w) {
        return `<div class="tbp-ctl cpl-pers-rule" style="${dlu(x, y, w, 1)}"></div>`;
    }

    function photoPage() {
        return `
            ${radio('cplPhSrcWindows', 'cplPhSrc', 'windows', 19, 7, 279, 10, 'Use pictures from <u>W</u>indows Pictures')}
            ${radio('cplPhSrcWorkspace', 'cplPhSrc', 'workspace', 19, 23, 279, 10, 'Use pictures from wor<u>k</u>space images')}
            ${text(42, 38, 80, 8, 'Wor<u>k</u>space:', 'cpl-ph-ws')}
            ${combo('cpl-ph-workspace cpl-ph-ws', 126, 36, 150, 'Workspace')}
            ${text(42, 56, 80, 8, 'Ta<u>k</u>en within:', 'cpl-ph-ws')}
            ${combo('cpl-ph-age cpl-ph-ws', 126, 54, 110, 'Taken within')}
            ${check('cplPhFavorites', 42, 72, 200, 10, '<u>F</u>avorites only')}
            ${radio('cplPhSrcSearch', 'cplPhSrc', 'search', 19, 90, 279, 10, 'Use pictures from an Image <u>S</u>earch:')}
            ${text(42, 104, 186, 10, '', 'cpl-ph-search-label cpl-ph-se')}
            ${button(235, 101, 55, 12, 'Se<u>a</u>rch...', 'photo-search')}
            ${radio('cplPhSrcFolder', 'cplPhSrc', 'folder', 19, 120, 279, 10, 'Use pictures from a f<u>o</u>lder:')}
            ${text(42, 134, 186, 10, '', 'cpl-ph-folder-label cpl-ph-fo')}
            ${button(235, 131, 55, 12, '<u>B</u>rowse...', 'photo-browse')}
            ${rule(12, 153, 283)}
            ${text(21, 164, 104, 8, 'Use this t<u>h</u>eme:')}
            ${combo('cpl-ph-theme', 126, 162, 93, 'Theme')}
            ${text(21, 182, 104, 8, 'Slide Show sp<u>e</u>ed:')}
            ${combo('cpl-ph-speed', 126, 180, 71, 'Slide Show speed')}
            ${check('cplPhShuffle', 126, 200, 160, 9, 'Shu<u>f</u>fle contents')}
            ${check('cplPhMonotone', 126, 213, 160, 9, '<u>M</u>onotone (black and white)')}
            <div class="tbp-ctl tbp-link-row" style="${dlu(12, 232, 250, 14)}"><button type="button" class="tbp-link" data-action="photo-help">How do I customize my screen saver?</button></div>
            ${rule(0, 252, 305)}
            <button type="button" class="tbp-ctl tbp-button" style="${dlu(192, 259, 50, 12, 1)}" data-action="photo-save" data-dialog-primary="1"><u>S</u>ave</button>
            <button type="button" class="tbp-ctl tbp-button" style="${dlu(246, 259, 50, 12, 1)}" data-action="photo-cancel">Cancel</button>`;
    }

    function workspaceChoices() {
        /* global workspaces */
        const list = typeof workspaces !== 'undefined' && workspaces ? workspaces : {};
        return [{ value: 'current', text: 'This workspace' }, { value: 'all', text: 'All workspaces' }, { separator: true }]
            .concat(Object.keys(list).map((id) => ({ value: id, text: (list[id] && list[id].name) || id })));
    }

    function syncPhotoControls() {
        const c = photosDlg.content;
        const p = photosDlg.pending;
        c.querySelectorAll('input[name="cplPhSrc"]').forEach((r) => { r.checked = r.value === p.source; });
        c.querySelector('#cplPhFavorites').checked = p.favorites;
        c.querySelector('#cplPhShuffle').checked = p.shuffle;
        c.querySelector('#cplPhMonotone').checked = p.monotone;
        c.querySelector('.cpl-ph-search-label').textContent = p.search ? (p.search.label || 'Saved search') + (p.search.total ? ` (${p.search.total} pictures)` : '') : 'No search saved';
        c.querySelector('.cpl-ph-folder-label').textContent = p.folder ? (p.folder.label || p.folder.path) : 'No folder chosen';
        // a source's own controls are greyed while another source is chosen, as Vista greys its Gallery options
        const groups = { workspace: '.cpl-ph-ws', search: '.cpl-ph-se', folder: '.cpl-ph-fo' };
        Object.keys(groups).forEach((src) => {
            const off = p.source !== src;
            c.querySelectorAll(groups[src]).forEach((n) => n.classList.toggle('is-disabled', off));
        });
        c.querySelector('#cplPhFavorites').disabled = p.source !== 'workspace';
        c.querySelector('[data-action="photo-search"]').disabled = p.source !== 'search';
        c.querySelector('[data-action="photo-browse"]').disabled = p.source !== 'folder';
        photosDlg.syncs.forEach((fn) => fn());
    }

    function closePhotoSettings(save) {
        if (!photosDlg) return;
        const dlg = photosDlg;
        photosDlg = null;
        if (save && saverDlg) {
            saverDlg.pending.photos = JSON.parse(JSON.stringify(dlg.pending));
            saverDlg.sheet.setDirty(true);
            restartSaverPreview();
        }
        if (dlg.owner) dlg.owner.removeAttribute('inert');
        closeWindow(dlg.modal);
        if (dlg.owner) callGlobal('openModal', dlg.owner);
    }

    function openPhotoSettings() {
        if (!doc || !saverDlg) return;
        if (photosDlg) { callGlobal('openModal', photosDlg.modal); return; }
        const P = pers();
        const base = P && typeof P.normalizePhotos === 'function' ? P.normalizePhotos(saverDlg.pending.photos) : (saverDlg.pending.photos || {});
        units = SEGOE;
        const html = photoPage();
        units = TAHOMA;
        const { modal, content, close } = makeWindow('photoScreenSaverSettingsDialog', 'Photos Screen Saver Settings', 'cpl-pers-photos', null, false);
        content.innerHTML = html;
        const owner = saverDlg.modal;
        owner.setAttribute('inert', '');
        photosDlg = { modal, content, owner, pending: JSON.parse(JSON.stringify(base)), syncs: [] };
        const p = () => photosDlg.pending;
        photosDlg.syncs.push(
            wireCombo(content.querySelector('.cpl-ph-workspace'), workspaceChoices, () => p().workspace, (v) => { p().workspace = v; }),
            wireCombo(content.querySelector('.cpl-ph-age'), () => PHOTO_AGE_NAMES.map(([value, t]) => ({ value, text: t })), () => p().age, (v) => { p().age = v; }),
            wireCombo(content.querySelector('.cpl-ph-theme'), () => PHOTO_THEME_NAMES.map(([value, t]) => ({ value, text: t })), () => p().theme, (v) => { p().theme = v; }),
            wireCombo(content.querySelector('.cpl-ph-speed'), () => PHOTO_SPEED_NAMES.map(([value, t]) => ({ value, text: t })), () => p().speed, (v) => { p().speed = v; })
        );
        content.addEventListener('change', (ev) => {
            const t = ev.target;
            if (t.name === 'cplPhSrc' && t.checked) p().source = t.value;
            else if (t.id === 'cplPhFavorites') p().favorites = t.checked;
            else if (t.id === 'cplPhShuffle') p().shuffle = t.checked;
            else if (t.id === 'cplPhMonotone') p().monotone = t.checked;
            else return;
            syncPhotoControls();
        });
        content.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-action]');
            if (!b || b.disabled) return;
            const a = b.dataset.action;
            if (a === 'photo-save') closePhotoSettings(true);
            else if (a === 'photo-cancel') closePhotoSettings(false);
            else if (a === 'photo-search') void openPhotoSearch();
            else if (a === 'photo-browse') openFolderBrowser(modal, p().folder && p().folder.path, (folder) => { p().folder = folder; syncPhotoControls(); });
            else if (a === 'photo-help') callGlobal('openGrimoireApplet');
        });
        close.addEventListener('click', () => closePhotoSettings(false));
        modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePhotoSettings(false); }
        });
        syncPhotoControls();
        showWindow(modal, owner);
    }

    /** Search...: Image Search with a Save that hands its search back here (frame=screensaver). */
    async function openPhotoSearch() {
        /* global loadDsapEntryAssets, resolveDsap, openIspyDsap, activeWorkspace */
        if (typeof resolveDsap !== 'function' || typeof openIspyDsap !== 'function') {
            message('Image Search', 'Image Search is not available.', photosDlg && photosDlg.modal, 'warning');
            return;
        }
        // resolveDsap, loadDsapEntryAssets: public/scripts/comp/dsapRegistry.js (Image Search loads on demand)
        await loadDsapEntryAssets(resolveDsap('dsap://ispy.dreamscape.jp/').entry);
        const saved = photosDlg && photosDlg.pending.search;
        const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) || 'default';
        // openIspyDsap: public/scripts/comp/omegasearchDsapApplet.js
        openIspyDsap(saved ? { ...saved, view: 'gallery', frame: 'screensaver' } : { workspaceId: ws, view: 'search', frame: 'screensaver' });
    }

    /** Image Search's Save (omegasearchDsapApplet.js) for frame=screensaver. */
    function setPhotoSearch(search, total) {
        if (!search) return false;
        const value = { ...search, total: Number(total) || 0 };
        if (photosDlg) {
            photosDlg.pending.search = value;
            photosDlg.pending.source = 'search';
            syncPhotoControls();
            callGlobal('openModal', photosDlg.modal);
            return true;
        }
        if (saverDlg) {
            saverDlg.pending.photos = { ...(saverDlg.pending.photos || {}), source: 'search', search: value };
            saverDlg.sheet.setDirty(true);
            restartSaverPreview();
            return true;
        }
        const P = pers();
        if (!P) return false;
        const cur = P.get().screenSaver;
        P.update({ screenSaver: { ...cur, photos: { ...(cur.photos || {}), source: 'search', search: value } } });
        return true;
    }

    // ---- Browse For Folder: a VFS folder (Explorer's paths, vfsClient.js) ------------------------

    function folderNavPath(item, parent) {
        if (item.navPath) return item.navPath;
        if (item.targetKind === 'workspace') return `/Workspaces/${item.targetId}`;
        if (item.targetKind === 'system-folder') {
            const tid = item.targetId || item.id;
            if (tid === '@workspaces' || item.name === 'Workspaces') return '/Workspaces';
            if (tid === '@system' || item.name === 'System') return '/System';
            if (item.workspaceId && item.name) return `/Workspaces/${item.workspaceId}/${item.name}`;
        }
        const id = item.targetId || item.id || item.name;
        const base = String(parent || '/').replace(/\/+$/, '');
        return `${base}/${id}`;
    }

    function isFolder(item) {
        return item && (item.kind === 'folder' || item.targetKind === 'system-folder' || item.targetKind === 'workspace' || item.targetKind === 'vfs-folder');
    }

    function openFolderBrowser(ownerModal, current, onPick) {
        /* global vfsClient */
        const { modal, content, close } = makeWindow('browseForFolderDialog', 'Browse For Folder', 'cpl-pers-folders', null, false);
        content.innerHTML = `
            <div class="cpl-bf-text">Choose a folder that contains the pictures you want to include in the Photos Screen Saver, and then click OK.</div>
            <div class="cpl-bf-tree tbp-list" tabindex="0" aria-label="Folders"></div>
            <div class="cpl-bf-buttons">
                <button type="button" class="tbp-button tbp-footer-button" data-action="bf-ok" data-dialog-primary="1" disabled>OK</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="bf-cancel">Cancel</button>
            </div>`;
        ownerModal.setAttribute('inert', '');
        const tree = content.querySelector('.cpl-bf-tree');
        let selected = null;
        const finish = (pick) => {
            ownerModal.removeAttribute('inert');
            closeWindow(modal);
            callGlobal('openModal', ownerModal);
            if (pick && selected) onPick({ path: selected.path, label: selected.label });
        };
        const nodeHtml = (path, name, depth) => `
            <div class="cpl-bf-node" data-path="${esc(path)}" data-label="${esc(name)}">
                <div class="cpl-bf-row" style="padding-left:${4 + depth * 16}px"><span class="cpl-bf-twisty" aria-hidden="true"></span><span class="cpl-bf-icon" aria-hidden="true"></span><span class="cpl-bf-name">${esc(name)}</span></div>
                <div class="cpl-bf-children" hidden></div>
            </div>`;
        async function expand(node) {
            const kids = node.querySelector(':scope > .cpl-bf-children');
            if (node.classList.contains('is-open')) { node.classList.remove('is-open'); kids.hidden = true; return; }
            node.classList.add('is-open');
            kids.hidden = false;
            if (kids.dataset.loaded) return;
            kids.dataset.loaded = '1';
            kids.innerHTML = '<div class="cpl-bf-loading">Loading...</div>';
            let res = null;
            try { res = typeof vfsClient !== 'undefined' ? await vfsClient.listDirectory(node.dataset.path, { offset: 0, limit: 500 }) : null; } catch (_) { res = null; }
            const depth = (node.dataset.path.split('/').filter(Boolean).length);
            const folders = ((res && res.items) || []).filter(isFolder);
            kids.innerHTML = folders.length
                ? folders.map((f) => nodeHtml(folderNavPath(f, node.dataset.path), f.name || f.targetId || 'Folder', depth)).join('')
                : '';
            if (!folders.length) node.classList.add('is-leaf');
        }
        tree.innerHTML = nodeHtml('/', 'Computer', 0);
        tree.addEventListener('click', (ev) => {
            const row = ev.target.closest('.cpl-bf-row');
            if (!row) return;
            const node = row.parentElement;
            tree.querySelectorAll('.cpl-bf-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
            row.classList.add('is-selected');
            // the label as Explorer's address bar names it: Workspaces\Default\Pictures
            const names = [];
            for (let n = node; n && n.classList.contains('cpl-bf-node'); n = n.parentElement.closest('.cpl-bf-node')) {
                if (n.dataset.path !== '/') names.unshift(n.dataset.label);
            }
            selected = node.dataset.path === '/' ? null : { path: node.dataset.path, label: names.join('\\') };
            content.querySelector('[data-action="bf-ok"]').disabled = !selected;
            if (ev.target.closest('.cpl-bf-twisty') || ev.detail === 2 || node.dataset.path === '/') void expand(node);
        });
        tree.addEventListener('dblclick', (ev) => {
            const row = ev.target.closest('.cpl-bf-row');
            if (row) void expand(row.parentElement);
        });
        content.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-action]');
            if (!b || b.disabled) return;
            if (b.dataset.action === 'bf-ok') finish(true);
            else if (b.dataset.action === 'bf-cancel') finish(false);
        });
        close.addEventListener('click', () => finish(false));
        modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
        });
        showWindow(modal, ownerModal);
        void expand(tree.querySelector('.cpl-bf-node'));
        if (current) selected = { path: current, label: current };
    }

    // ---- Theme Settings ---------------------------------------------------------------------------
    // themeui.dll.mui dialog 1000 (Tahoma units, the Taskbar-sized sheet). A theme is a workspace's
    // look: picking another workspace's theme and applying copies its colours, fonts, desktop
    // background, window colour, sounds and screen saver to this workspace. The Appearance tab
    // holds this workspace's name, colours and fonts (the old Theme page).

    let themeDlg = null;

    function wallpaperUrlFor(ws) {
        /* global localGalleryImageUrl, localCacheUploadUrl, localCachePreviewUrl */
        const path = ws && ws.wallpaper;
        if (!path) return '/static_images/wallpapers/aurora.webp';
        const [type, ...rest] = String(path).split(':');
        const id = rest.join(':');
        switch (type) {
            case 'url': return id;
            case 'wallpaper': return `/cache/wallpapers/${encodeURIComponent(`${id}.png`)}`;
            case 'file': return typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(id) : `/images/${encodeURIComponent(id)}`;
            case 'cache': return typeof localCacheUploadUrl === 'function' ? localCacheUploadUrl(id) : '';
            case 'cache-preview': return typeof localCachePreviewUrl === 'function' ? localCachePreviewUrl(id) : '';
            case 'vibe': return `/cache/vibe/${id}`;
            default: return '/static_images/wallpapers/aurora.webp';
        }
    }

    function themesPage() {
        return `
            ${text(7, 5, 228, 24, 'A theme is a background plus a set of sounds, icons, and other elements to help you personalize your computer with one click.')}
            ${text(7, 31, 100, 9, '<u>T</u>heme:')}
            ${combo('cpl-th-theme', 7, 42, 128, 'Theme')}
            ${button(140, 41, 50, 14, '<u>S</u>ave As...', 'theme-saveas')}
            ${button(194, 41, 50, 14, '<u>D</u>elete', 'theme-delete')}
            ${text(7, 61, 100, 9, 'Sample:')}
            <div class="tbp-ctl cpl-th-sample" style="${dlu(7, 70, 238, 141)}">
                <div class="cpl-th-sample-win">
                    <div class="cpl-th-sample-caption"><span>Active Window</span><i class="cpl-th-sample-btns" aria-hidden="true"><b class="is-min"></b><b class="is-max"></b><b class="is-close"></b></i></div>
                    <div class="cpl-th-sample-client"><span>Window Text</span><i class="cpl-th-sample-scroll" aria-hidden="true"></i></div>
                </div>
                <img class="cpl-th-sample-bin" src="/static_images/vista-icons/explorer/recycle-32.png" width="32" height="32" alt="" draggable="false">
            </div>`;
    }

    function appearancePage() {
        return `
            ${text(7, 7, 238, 28, 'The name, colours and fonts of this workspace. The window colour, desktop background, screen saver and sounds have their own pages in Personalization.')}
            ${text(7, 44, 62, 8, '<u>N</u>ame:')}
            <input type="text" class="tbp-ctl tbp-edit cpl-th-name" style="${dlu(72, 42, 173, 14)}" maxlength="50" aria-label="Name">
            ${text(7, 64, 62, 8, '<u>A</u>ccent color:')}
            <input type="color" class="tbp-ctl cpl-th-color" style="${dlu(72, 62, 40, 14)}" aria-label="Accent color">
            ${text(7, 82, 62, 8, '<u>G</u>lass color:')}
            <input type="color" class="tbp-ctl cpl-th-bg" style="${dlu(72, 80, 40, 14)}" aria-label="Glass color">
            ${text(7, 104, 62, 8, '<u>P</u>rimary font:')}
            ${combo('cpl-th-font', 72, 102, 173, 'Primary font')}
            ${text(7, 124, 62, 8, 'Te<u>x</u>tarea font:')}
            ${combo('cpl-th-mono', 72, 122, 173, 'Textarea font')}`;
    }

    function currentWorkspaceId() {
        /* global activeWorkspace */
        return (typeof activeWorkspace !== 'undefined' && activeWorkspace) || root.currentWorkspace || 'default';
    }

    function workspaceList() {
        /* global workspaces */
        return typeof workspaces !== 'undefined' && workspaces ? workspaces : {};
    }

    function paintSample() {
        const t = themeDlg;
        const id = t.pending.theme || currentWorkspaceId();
        const ws = workspaceList()[id] || {};
        const sample = t.content.querySelector('.cpl-th-sample');
        sample.style.backgroundImage = `url("${wallpaperUrlFor(ws)}")`;
        const P = pers();
        let color = 'rgb(116 128 140 / 0.3)';
        if (P) {
            const fc = P.frameColor(P.read(id), id);
            if (fc.rgb) color = `rgb(${fc.rgb[0]} ${fc.rgb[1]} ${fc.rgb[2]} / ${Math.max(0.15, fc.alpha)})`;
        }
        sample.style.setProperty('--cpl-th-frame', color);
    }

    function openTheme() {
        if (!doc) return;
        if (themeDlg) { callGlobal('openModal', themeDlg.modal); return; }
        const id = currentWorkspaceId();
        const ws = workspaceList()[id] || {};
        // the font lists the settings forms use (classic-script globals)
        /* global AVAILABLE_PRIMARY_FONTS, AVAILABLE_TEXTAREA_FONTS */
        const primary = typeof AVAILABLE_PRIMARY_FONTS !== 'undefined' ? AVAILABLE_PRIMARY_FONTS : [{ value: '', label: 'Default' }];
        const mono = typeof AVAILABLE_TEXTAREA_FONTS !== 'undefined' ? AVAILABLE_TEXTAREA_FONTS : [{ value: '', label: 'Default' }];
        units = TAHOMA;
        const saved = { theme: '', name: ws.name || '', color: ws.color || '#102040', backgroundColor: ws.backgroundColor || '#0a1a2a', primaryFont: ws.primaryFont || '', textareaFont: ws.textareaFont || '' };
        const sheet = makeSheet({
            id: 'themeSettingsDialog',
            title: 'Theme Settings',
            cls: 'cpl-pers-theme-sheet',
            icon: `${ART}/personalization-16.png`,
            tabs: ['Themes', 'Appearance'],
            selected: 0,
            pages: [themesPage(), appearancePage()],
            onApply: () => applyTheme(),
            onClose: () => { themeDlg = null; },
            onAction: (action) => {
                if (action === 'theme-saveas' || action === 'theme-delete') {
                    message('Theme Settings', 'Each workspace keeps one theme of its own: change it here and click Apply.', themeDlg.modal);
                }
            }
        });
        themeDlg = { sheet, modal: sheet.modal, content: sheet.content, saved, pending: { ...saved } };
        const c = sheet.content;
        const p = () => themeDlg.pending;
        const themeItems = () => {
            const list = workspaceList();
            const cur = list[id] || {};
            return [{ value: '', text: `${cur.name || 'This workspace'} (current)` }]
                .concat(Object.keys(list).filter((k) => k !== id).map((k) => ({ value: k, text: list[k].name || k })));
        };
        wireCombo(c.querySelector('.cpl-th-theme'), themeItems, () => p().theme, (v) => {
            p().theme = v;
            sheet.setDirty(true);
            paintSample();
        });
        const face = (f, generic) => (f.value ? `'${f.value}', ${generic}` : '');
        const fontItems = (list, generic) => () => list.map((f) => ({ value: f.value || '', text: f.label, content: () => {
            const box = doc.createElement('div');
            box.className = 'context-menu-item-text-container';
            const span = doc.createElement('span');
            span.className = 'context-menu-item-text';
            span.textContent = f.label;
            if (f.value) span.style.fontFamily = face(f, generic);
            box.appendChild(span);
            return box;
        } }));
        wireCombo(c.querySelector('.cpl-th-font'), fontItems(primary, 'sans-serif'), () => p().primaryFont, (v) => { p().primaryFont = v; sheet.setDirty(true); });
        wireCombo(c.querySelector('.cpl-th-mono'), fontItems(mono, 'monospace'), () => p().textareaFont, (v) => { p().textareaFont = v; sheet.setDirty(true); });
        const name = c.querySelector('.cpl-th-name');
        name.value = saved.name;
        name.disabled = id === 'default';
        c.querySelector('.cpl-th-color').value = saved.color;
        c.querySelector('.cpl-th-bg').value = saved.backgroundColor;
        c.addEventListener('input', (ev) => {
            const t = ev.target;
            if (t === name) p().name = name.value;
            else if (t.classList.contains('cpl-th-color')) p().color = t.value;
            else if (t.classList.contains('cpl-th-bg')) p().backgroundColor = t.value;
            else return;
            sheet.setDirty(true);
        });
        paintSample();
        showWindow(sheet.modal);
    }

    async function applyTheme() {
        const t = themeDlg;
        if (!t) return;
        const id = currentWorkspaceId();
        const list = workspaceList();
        const client = root.wsClient;
        const settings = {};
        const p = t.pending;
        const s = t.saved;
        if (p.theme && list[p.theme]) {
            // another workspace's look, copied whole
            const src = list[p.theme];
            ['color', 'backgroundColor', 'primaryFont', 'textareaFont', 'wallpaper', 'wallpaperPosition'].forEach((k) => {
                settings[k] = src[k] === undefined ? null : src[k];
            });
            const P = pers();
            if (P) {
                const look = P.read(p.theme);
                settings.personalization = look;
                P.update(look, { save: false, id });
            }
            p.color = settings.color || p.color;
            p.backgroundColor = settings.backgroundColor || p.backgroundColor;
            p.primaryFont = settings.primaryFont || '';
            p.textareaFont = settings.textareaFont || '';
            p.theme = '';
            t.content.querySelector('.cpl-th-color').value = p.color;
            t.content.querySelector('.cpl-th-bg').value = p.backgroundColor;
        } else {
            if (p.name.trim() && p.name !== s.name && id !== 'default') settings.name = p.name.trim();
            if (p.color !== s.color) settings.color = p.color;
            if (p.backgroundColor !== s.backgroundColor) settings.backgroundColor = p.backgroundColor;
            if (p.primaryFont !== s.primaryFont) settings.primaryFont = p.primaryFont || null;
            if (p.textareaFont !== s.textareaFont) settings.textareaFont = p.textareaFont || null;
        }
        if (!Object.keys(settings).length || !client || typeof client.updateWorkspaceSettings !== 'function') return;
        try {
            // the server's settings_updated broadcast repaints this workspace (workspaceUtils.js)
            await client.updateWorkspaceSettings(id, settings);
            if (settings.personalization) {
                const P = pers();
                if (P) P.update(settings.personalization, { id });
            }
            t.saved = { ...p };
            paintSample();
        } catch (err) {
            message('Theme Settings', `The theme could not be saved: ${(err && err.message) || err}`, t.modal, 'error');
        }
    }

    // ---- Sound ------------------------------------------------------------------------------------

    let soundDlg = null;

    // ---- Playback / Recording: the browser's own output and input (Yukimi 2026-10-21) ----------
    // Vista's tile list (mmsys dialogs 110 / 111): the 48 px device icon with the default-device
    // check, the name, the hardware and the state, and a level meter. The hardware is named after
    // the browser ("Microsoft Edge Sound Device"); the devices are Built-In Sound Output / Input.

    /** The browser's name, from its client hints when it has them, else from the user agent. */
    function browserName() {
        const nav = root.navigator || {};
        const brands = (nav.userAgentData && nav.userAgentData.brands) || [];
        const known = [
            [/Edge/i, 'Microsoft Edge'], [/Opera|OPR/i, 'Opera'], [/Brave/i, 'Brave'], [/Vivaldi/i, 'Vivaldi'],
            [/Yandex/i, 'Yandex Browser'], [/Google Chrome/i, 'Google Chrome']
        ];
        for (const [re, name] of known) if (brands.some((b) => re.test(b.brand))) return name;
        const ua = String(nav.userAgent || '');
        if (/Edg\//.test(ua)) return 'Microsoft Edge';
        if (/OPR\//.test(ua)) return 'Opera';
        if (/Firefox\//.test(ua)) return 'Mozilla Firefox';
        if (/Chrome\//.test(ua)) return brands.some((b) => /Chromium/i.test(b.brand)) && !/Google/i.test(ua) ? 'Chromium' : 'Google Chrome';
        if (/Safari\//.test(ua)) return 'Safari';
        return 'Web Browser';
    }

    const DEVICES = {
        playback: { name: 'Built-In Sound Output', icon: 'device-speakers-48.png' },
        recording: { name: 'Built-In Sound Input', icon: 'device-microphone-48.png' }
    };

    function devicesPage(kind) {
        const dev = DEVICES[kind];
        return `
            ${text(7, 7, 245, 12, `Select a ${kind} device below to modify its settings:`)}
            <div class="tbp-ctl tbp-list cpl-pers-devices" style="${dlu(7, 21, 238, 171)}" tabindex="0" aria-label="${kind} devices">
                <div class="cpl-pers-device" data-device="${kind}">
                    <span class="cpl-pers-device-icon"><img src="${ART}/${dev.icon}" width="48" height="48" alt="" draggable="false"><img class="cpl-pers-device-default" src="${ART}/device-default-16.png" width="16" height="16" alt="Default device" draggable="false"></span>
                    <span class="cpl-pers-device-text">
                        <span class="cpl-pers-device-name">${esc(dev.name)}</span>
                        <span class="cpl-pers-device-sub">${esc(browserName())} Sound Device</span>
                        <span class="cpl-pers-device-sub cpl-pers-device-state">Working</span>
                    </span>
                    <span class="cpl-pers-meter" aria-hidden="true">${'<i></i>'.repeat(10)}</span>
                </div>
            </div>
            ${button(7, 199, 50, 14, '<u>C</u>onfigure', 'device-configure')}
            ${button(131, 199, 60, 14, '<u>S</u>et Default', 'device-default')}
            ${button(195, 199, 50, 14, '<u>P</u>roperties', 'device-properties')}`;
    }

    /** Select (or clear) a tab's device row; the buttons follow, as Vista's do. */
    function selectDevice(page, on) {
        const row = page.querySelector('.cpl-pers-device');
        if (!row) return;
        // a class, not role=option / aria-selected: 7.css paints those rows blue
        row.classList.toggle('is-selected', on);
        // Configure: there is no speaker setup to run; Set Default: it already is the default
        page.querySelector('[data-action="device-configure"]').disabled = true;
        page.querySelector('[data-action="device-default"]').disabled = true;
        page.querySelector('[data-action="device-properties"]').disabled = !on;
    }

    function wireDevices(content) {
        content.querySelectorAll('.tbp-page').forEach((page) => {
            if (!page.querySelector('.cpl-pers-device')) return;
            selectDevice(page, false);
            const list = page.querySelector('.cpl-pers-devices');
            list.addEventListener('click', (ev) => selectDevice(page, !!ev.target.closest('.cpl-pers-device')));
            list.addEventListener('dblclick', (ev) => { if (ev.target.closest('.cpl-pers-device')) deviceProperties(page); });
            list.addEventListener('keydown', (ev) => {
                if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Home') { ev.preventDefault(); selectDevice(page, true); }
            });
        });
        // the input: "Not plugged in" when the browser reports no microphone (no permission is asked)
        const md = root.navigator && root.navigator.mediaDevices;
        if (md && typeof md.enumerateDevices === 'function') {
            md.enumerateDevices().then((list) => {
                const hasInput = list.some((d) => d.kind === 'audioinput');
                const row = content.querySelector('.cpl-pers-device[data-device="recording"]');
                if (!row || hasInput) return;
                row.querySelector('.cpl-pers-device-state').textContent = 'Not plugged in';
                row.classList.add('is-unplugged');
                // Vista's red down arrow (mmsys PNG 249) in place of the default check
                const mark = row.querySelector('.cpl-pers-device-default');
                mark.src = `${ART}/device-unplugged-16.png`;
                mark.alt = 'Not plugged in';
            }).catch(() => {});
        }
    }

    function deviceProperties(page) {
        const row = page.querySelector('.cpl-pers-device');
        if (!row) return;
        const name = row.querySelector('.cpl-pers-device-name').textContent;
        const hw = row.querySelectorAll('.cpl-pers-device-sub')[0].textContent;
        const unplugged = row.classList.contains('is-unplugged');
        message(`${name} Properties`, `${hw}: ${unplugged ? 'this device is not plugged in.' : 'this device is working properly.'} Its volume follows the browser and the computer's own sound settings.`, page.closest('.modal'));
    }

    /** The level meters: the output follows every desktop sound (desktopSounds.outputLevel); the
        input stays still, as no microphone is opened. */
    function runMeters(content) {
        const S = sounds();
        const bars = content.querySelectorAll('.cpl-pers-device[data-device="playback"] .cpl-pers-meter i');
        let shown = -1;
        const tick = () => {
            if (!soundDlg || soundDlg.content !== content) return;
            const page = bars.length && bars[0].closest('.tbp-page');
            if (page && !page.hidden) {
                const level = S && typeof S.outputLevel === 'function' ? S.outputLevel() : 0;
                // a decibel scale, as Vista's meters: -50 dB lights nothing, 0 dB all ten
                const db = level > 0 ? 20 * Math.log10(level) : -100;
                const lit = Math.max(0, Math.min(10, Math.round((db + 50) / 5)));
                if (lit !== shown) {
                    shown = lit;
                    // lit from the bottom up
                    bars.forEach((b, i) => b.classList.toggle('is-lit', 9 - i < lit));
                }
            }
            soundDlg.meterRaf = root.requestAnimationFrame(tick);
        };
        tick();
    }

    function soundsPage() {
        return `
            ${text(10, 7, 232, 29, 'A sound theme is a set of sounds applied to events in Melaton and programs.  You can select an existing scheme or save one you have modified.')}
            ${text(10, 35, 100, 8, 'Sound Sc<u>h</u>eme:')}
            ${combo('cpl-pers-scheme', 10, 47, 125, 'Sound Scheme')}
            ${button(140, 46, 50, 14, 'Sa<u>v</u>e As...', 'scheme-save')}
            ${button(192, 46, 50, 14, '<u>D</u>elete', 'scheme-delete')}
            ${text(10, 64, 232, 26, 'To change sounds, click a program event in the following list and then select a sound to apply.  You can save the changes as a new sound scheme.')}
            ${text(10, 91, 54, 8, '<u>P</u>rogram')}
            <div class="tbp-ctl tbp-list cpl-pers-events" style="${dlu(10, 103, 232, 60)}" role="tree" tabindex="0" aria-label="Program Events"></div>
            ${check('cplPersStartup', 10, 169, 232, 8, 'Play <u>W</u>indows Startup sound')}
            ${text(10, 183, 27, 8, '<u>S</u>ounds:', 'cpl-pers-sounds-label')}
            ${combo('cpl-pers-sound', 10, 194, 125, 'Sounds')}
            ${button(140, 194, 50, 14, '<span class="cpl-pers-play" aria-hidden="true"></span><u>T</u>est', 'sound-test')}
            ${button(192, 194, 50, 14, '<u>B</u>rowse...', 'sound-browse')}`;
    }

    // Vista lists the files by name, .wav and all
    function soundName(file) {
        return file || '(None)';
    }

    /** The file an event plays with the pending choices ('' = none). */
    function pendingFile(eventId) {
        const p = soundDlg.pending;
        if (Object.prototype.hasOwnProperty.call(p.sounds, eventId)) return p.sounds[eventId];
        const S = sounds();
        return S && S.SCHEME[eventId] ? S.SCHEME[eventId] : '';
    }

    function isModified() {
        const p = soundDlg.pending;
        const S = sounds();
        return Object.keys(p.sounds).some((k) => S && p.sounds[k] !== S.SCHEME[k]);
    }

    function schemeItems() {
        const items = [{ value: 'none', text: 'No Sounds' }, { value: 'default', text: 'Melaton Default' }];
        if (soundDlg && soundDlg.pending.soundScheme === 'default' && isModified()) {
            items.push({ value: 'modified', text: 'Melaton Default (modified)' });
        }
        return items;
    }

    function schemeValue() {
        const p = soundDlg.pending;
        if (p.soundScheme === 'none') return 'none';
        return isModified() ? 'modified' : 'default';
    }

    function soundItems() {
        const S = sounds();
        const files = S ? S.FILES : [];
        return [{ value: '', text: '(None)' }].concat(files.map((f) => ({ value: f, text: soundName(f) })));
    }

    function renderEvents() {
        const list = soundDlg.content.querySelector('.cpl-pers-events');
        const sel = soundDlg.selected;
        list.innerHTML = EVENT_GROUPS.map((g) => `
            <div class="cpl-pers-tree-group" role="treeitem" aria-expanded="true">
                <div class="cpl-pers-tree-row cpl-pers-tree-root"><span class="cpl-pers-tree-icon is-program" aria-hidden="true"></span><span class="cpl-pers-tree-name">${esc(g.name)}</span></div>
                <div role="group">${g.events.map(([id, name]) => {
                    const has = soundDlg.pending.soundScheme !== 'none' && !!pendingFile(id);
                    return `<div class="cpl-pers-tree-row cpl-pers-tree-event${id === sel ? ' is-selected' : ''}" role="treeitem" aria-selected="${id === sel}" data-event="${id}"><span class="cpl-pers-tree-icon${has ? ' is-sound' : ''}" aria-hidden="true"></span><span class="cpl-pers-tree-name">${esc(name)}</span></div>`;
                }).join('')}</div>
            </div>`).join('');
    }

    function syncSoundControls() {
        const c = soundDlg.content;
        const p = soundDlg.pending;
        const none = p.soundScheme === 'none';
        const sel = soundDlg.selected;
        c.querySelector('#cplPersStartup').checked = p.startupSound;
        const soundBox = c.querySelector('.cpl-pers-sound');
        const hasEvent = !!sel;
        soundBox.classList.toggle('is-disabled', !hasEvent);
        soundBox.setAttribute('aria-disabled', String(!hasEvent));
        // greyed until an event is picked: the picker opens from data-click-menu (contextMenu.js)
        if (!hasEvent && soundBox.hasAttribute('data-click-menu')) {
            soundBox.dataset.pickerId = soundBox.getAttribute('data-click-menu');
            soundBox.removeAttribute('data-click-menu');
        } else if (hasEvent && !soundBox.hasAttribute('data-click-menu') && soundBox.dataset.pickerId) {
            soundBox.setAttribute('data-click-menu', soundBox.dataset.pickerId);
        }
        c.querySelector('.cpl-pers-sounds-label').classList.toggle('is-disabled', !hasEvent);
        const file = hasEvent && !none ? pendingFile(sel) : '';
        c.querySelector('[data-action="sound-test"]').disabled = !hasEvent || !file;
        c.querySelector('[data-action="sound-browse"]').disabled = true;
        c.querySelector('[data-action="scheme-save"]').disabled = true;
        c.querySelector('[data-action="scheme-delete"]').disabled = true;
        renderEvents();
        if (soundDlg.syncScheme) soundDlg.syncScheme();
        if (soundDlg.syncSound) soundDlg.syncSound();
    }

    function selectEvent(id) {
        soundDlg.selected = id;
        syncSoundControls();
        const row = soundDlg.content.querySelector(`.cpl-pers-tree-event[data-event="${id}"]`);
        if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }

    function openSound() {
        if (!doc) return;
        if (soundDlg) { callGlobal('openModal', soundDlg.modal); return; }
        const P = pers();
        const cur = P ? P.get() : { soundScheme: 'default', sounds: {}, startupSound: true };
        const S = sounds();
        // the browser-wide switch (desktopSounds.setEnabled) off reads as No Sounds too
        const masterOff = S && typeof S.isEnabled === 'function' && !S.isEnabled();
        const saved = { soundScheme: masterOff ? 'none' : cur.soundScheme, sounds: { ...cur.sounds }, startupSound: cur.startupSound };
        units = TAHOMA;
        const sheet = makeSheet({
            id: 'soundPropertiesDialog',
            title: 'Sound',
            cls: 'cpl-pers-sound-sheet',
            icon: `${ART}/sound-16.png`,
            tabs: ['Playback', 'Recording', 'Sounds'],
            selected: 2,
            pages: [devicesPage('playback'), devicesPage('recording'), soundsPage()],
            onApply: () => {
                const p = soundDlg.pending;
                if (P) P.update({ soundScheme: p.soundScheme, sounds: { ...p.sounds }, startupSound: p.startupSound });
                // choosing a scheme turns the browser-wide switch back on
                if (p.soundScheme !== 'none' && S && typeof S.isEnabled === 'function' && !S.isEnabled()) S.setEnabled(true);
            },
            onClose: () => {
                if (soundDlg && soundDlg.meterRaf) root.cancelAnimationFrame(soundDlg.meterRaf);
                soundDlg = null;
            },
            onAction: (action, b) => {
                if (action === 'device-properties') { deviceProperties(b.closest('.tbp-page')); return; }
                if (action === 'sound-test') {
                    const file = soundDlg.selected ? pendingFile(soundDlg.selected) : '';
                    if (file && S && typeof S.playFile === 'function') S.playFile(file);
                }
            }
        });
        soundDlg = { sheet, modal: sheet.modal, content: sheet.content, saved, pending: JSON.parse(JSON.stringify(saved)), selected: null };
        const c = sheet.content;
        soundDlg.syncScheme = wireCombo(c.querySelector('.cpl-pers-scheme'), schemeItems, schemeValue, (v) => {
            const p = soundDlg.pending;
            if (v === 'modified') return;
            if (v === 'none') p.soundScheme = 'none';
            else { p.soundScheme = 'default'; p.sounds = {}; }
            sheet.setDirty(true);
            syncSoundControls();
        });
        soundDlg.syncSound = wireCombo(c.querySelector('.cpl-pers-sound'), soundItems,
            () => (soundDlg.selected && soundDlg.pending.soundScheme !== 'none' ? pendingFile(soundDlg.selected) : ''),
            (file) => {
                const p = soundDlg.pending;
                const id = soundDlg.selected;
                if (!id) return;
                if (p.soundScheme === 'none') { p.soundScheme = 'default'; p.sounds = {}; }
                if (S && S.SCHEME[id] === file) delete p.sounds[id];
                else p.sounds[id] = file;
                sheet.setDirty(true);
                syncSoundControls();
                // Vista plays the new choice
                if (file && S && typeof S.playFile === 'function') S.playFile(file);
            });
        const tree = c.querySelector('.cpl-pers-events');
        tree.addEventListener('click', (ev) => {
            const row = ev.target.closest('.cpl-pers-tree-event');
            if (row) selectEvent(row.dataset.event);
        });
        tree.addEventListener('dblclick', (ev) => {
            const row = ev.target.closest('.cpl-pers-tree-event');
            const file = row ? pendingFile(row.dataset.event) : '';
            if (file && soundDlg.pending.soundScheme !== 'none' && S) S.playFile(file);
        });
        tree.addEventListener('keydown', (ev) => {
            if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
            ev.preventDefault();
            const ids = EVENT_GROUPS.flatMap((g) => g.events.map(([id]) => id));
            const at = ids.indexOf(soundDlg.selected);
            selectEvent(ids[Math.min(ids.length - 1, Math.max(0, at + (ev.key === 'ArrowDown' ? 1 : (at < 0 ? 1 : -1))))]);
        });
        c.querySelector('#cplPersStartup').addEventListener('change', (ev) => {
            soundDlg.pending.startupSound = ev.target.checked;
            sheet.setDirty(true);
        });
        syncSoundControls();
        wireDevices(c);
        showWindow(sheet.modal);
        runMeters(c);
    }

    const api = {
        openScreenSaver,
        openSound,
        openTheme,
        openPhotoSettings,
        setPhotoSearch,
        SAVER_NAMES,
        EVENT_GROUPS,
        _test: { dlu, screenSaverPage, soundsPage, devicesPage, browserName }
    };
    root.personalizationDialogs = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
