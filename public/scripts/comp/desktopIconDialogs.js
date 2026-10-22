/**
 * Vista's desktop icon dialogs (Yukimi 2026-10-21: "for the desktop we want the copy vistas desktop
 * settings and also its icon selection 1:1"), measured on the Vista Aero VM and placed by dialog
 * units on Taskbar Properties' Tahoma grid (x * 6/4, y * 13/8; taskbar-properties.css tbp-*):
 *
 *   Desktop Icon Settings   Personalize > Change desktop icons. A property sheet (client 398x423)
 *                           with one page, shell32.dll.mui dialog 29952 "Desktop": the Desktop icons
 *                           group (Computer, User's Files, Network, Recycle Bin, Control Panel), the
 *                           icon list (Computer, the user's folder, Network, Recycle Bin full and
 *                           empty; 75x75 cells, 32 px icons, Tahoma labels on 13 px lines), Change
 *                           Icon... and Restore Default. OK / Apply put the checked icons on this
 *                           workspace's desktop and save the pictures (desktopIconView.js).
 *   Change Icon             shell32.dll.mui dialog 1060 (193x200 DLU, client 290x325): Look for
 *                           icons in this file [edit] Browse..., Select an icon from the list below:
 *                           a list box of 32 px icons in 36x44 cells, four rows, scrolling sideways,
 *                           OK / Cancel. The files are Vista's icon sheets (imageres.dll, shell32.dll,
 *                           NetworkExplorer.dll, extracted from the VM) and Melaton's own pictures.
 *                           Browse... lists those files.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function view() {
        return root.desktopIconView;
    }

    function shortcuts() {
        /* global desktopShortcuts */
        return typeof desktopShortcuts !== 'undefined' && desktopShortcuts ? desktopShortcuts : null;
    }

    function activeWorkspaceId() {
        /* global activeWorkspace */
        return (typeof activeWorkspace !== 'undefined' && activeWorkspace) || root.currentWorkspace || 'default';
    }

    function workspaceName(id = activeWorkspaceId()) {
        /* global workspaces */
        const ws = typeof workspaces !== 'undefined' && workspaces ? workspaces[id] : null;
        return (ws && ws.name) || id;
    }

    // ---- dialog units (personalizationDialogs.js, taskbarProperties.js) -------------------------

    const UNIT = { x: 1.5, y: 1.625 };

    function bottomPx(y, h) {
        return Math.floor((y + h) * UNIT.y);
    }

    function dlu(x, y, w, h, inset = 0) {
        const left = Math.round(x * UNIT.x);
        const top = Math.round(y * UNIT.y);
        let s = `left:${left + inset}px;top:${top + inset}px;`;
        if (w !== undefined) s += `width:${Math.round((x + w) * UNIT.x) - left - 2 * inset}px;`;
        if (h !== undefined) s += `height:${bottomPx(y, h) - top - 2 * inset}px;`;
        return s;
    }

    function checkStyle(x, y, w, h) {
        const top = Math.round(y * UNIT.y);
        const height = bottomPx(y, h) - top;
        return `${dlu(x, y, w, h)}padding-top:${Math.max(0, Math.floor((height - 13) / 2))}px;`;
    }

    function check(id, x, y, w, h, label) {
        return `<div class="tbp-ctl tbp-check" style="${checkStyle(x, y, w, h)}"><input type="checkbox" id="${id}"><label for="${id}"><span>${label}</span></label></div>`;
    }

    function button(x, y, w, h, label, action, extra = '') {
        return `<button type="button" class="tbp-ctl tbp-button" style="${dlu(x, y, w, h, 1)}" data-action="${action}"${extra}>${label}</button>`;
    }

    // ---- windows (personalizationDialogs.js makeWindow / showWindow) ----------------------------

    function el(tag, className, textContent) {
        const n = doc.createElement(tag);
        if (className) n.className = className;
        if (textContent !== undefined) n.textContent = textContent;
        return n;
    }

    function makeWindow(id, title, clientClass, iconUrl, sheet = true) {
        const old = doc.getElementById(id);
        if (old) old.remove();
        const modal = el('div', `modal hidden on-top tbp-window ${clientClass}-window`);
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
        const content = el('div', `modal-content win7 tbp-client${sheet ? ' tbp-sheet' : ''} ${clientClass}`);
        modal.append(cap, el('div', 'modal-focus-overlay'), controls, content);
        doc.body.appendChild(modal);
        return { modal, content, close };
    }

    function showWindow(modal, owner) {
        const anchor = owner && !owner.classList.contains('hidden') ? owner : doc.getElementById('melatonControlPanelModal');
        if (anchor && !anchor.classList.contains('hidden')) modal.dataset.iconOwnerId = anchor.id;
        callGlobal('openModal', modal);
        if (modal.classList.contains('hidden')) modal.classList.remove('hidden');
        root.requestAnimationFrame(() => {
            const r = modal.getBoundingClientRect();
            let cx = root.innerWidth / 2;
            let cy = (root.innerHeight - 35) / 2;
            if (anchor && !anchor.classList.contains('hidden')) {
                const o = anchor.getBoundingClientRect();
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

    function message(title, text, owner) {
        const box = root.bootMessageBox;
        if (box && typeof box.show === 'function') {
            return box.show({ title, icon: 'warning', message: text, owner });
        }
        root.alert(text);
        return Promise.resolve();
    }

    // ---- Change Icon ----------------------------------------------------------------------------

    const CI_ROWS = 4;
    const CI_CELL_W = 36;
    const CI_CELL_H = 44;
    let ci = null;

    function fileEntries(file) {
        const V = view();
        if (file === 'app') return V.appIconNames().map((name) => ({ file: 'app', name }));
        const f = V.ICON_FILES[file];
        const out = [];
        for (let i = 0; f && i < (f.count || 0); i++) out.push({ file, index: i });
        return out;
    }

    function sameRef(a, b) {
        if (!a || !b || a.file !== b.file) return false;
        return a.file === 'app' ? a.name === b.name : a.index === b.index;
    }

    function fileForPath(text) {
        const V = view();
        const want = String(text || '').trim().replace(/^"|"$/g, '').toLowerCase();
        if (!want) return null;
        const base = want.split(/[\\/]/).pop();
        return Object.keys(V.ICON_FILES).find((k) => {
            const p = V.ICON_FILES[k].path.toLowerCase();
            return p === want || p.split('\\').pop() === base;
        }) || null;
    }

    function changeIconHtml() {
        return `
            <div class="tbp-ctl tbp-static" style="${dlu(7, 7, 179, 10)}"><u>L</u>ook for icons in this file:</div>
            <input type="text" class="tbp-ctl tbp-edit dic-ci-path" style="${dlu(7, 17, 123, 14)}" spellcheck="false" aria-label="Look for icons in this file">
            ${button(135, 17, 50, 14, '<u>B</u>rowse...', 'ci-browse')}
            <div class="tbp-ctl tbp-static" style="${dlu(7, 36, 179, 10)}"><u>S</u>elect an icon from the list below:</div>
            <div class="tbp-ctl dic-ci-list" role="listbox" tabindex="0" aria-label="Select an icon from the list below" style="left:11px;top:76px;width:268px;height:199px;">
                <div class="dic-ci-scroll"><div class="dic-ci-grid"></div></div>
            </div>
            ${button(81, 179, 50, 14, 'OK', 'ci-ok', ' data-dialog-primary="1"')}
            ${button(135, 179, 50, 14, 'Cancel', 'ci-cancel')}`;
    }

    function ciSelect(i, scroll = true) {
        if (!ci) return;
        ci.selected = Math.max(0, Math.min(ci.entries.length - 1, i));
        const grid = ci.content.querySelector('.dic-ci-grid');
        const prev = grid.querySelector('.dic-ci-item.is-selected');
        if (prev) prev.classList.remove('is-selected');
        const cell = grid.children[ci.selected];
        if (cell) {
            cell.classList.add('is-selected');
            if (scroll) {
                // LB_SETCURSEL scrolls just far enough to show the item (once the window has laid out)
                const sc = ci.content.querySelector('.dic-ci-scroll');
                if (!sc.clientWidth) {
                    const tries = (ciSelect.tries || 0) + 1;
                    ciSelect.tries = tries;
                    if (tries < 40) setTimeout(() => { if (ci) ciSelect(ci.selected); }, 25);
                    return;
                }
                ciSelect.tries = 0;
                // a multi-column list box scrolls by whole columns (the VM: #103 shows as the 7th)
                const col = Math.floor(ci.selected / CI_ROWS);
                const visible = Math.max(1, Math.floor(sc.clientWidth / CI_CELL_W));
                let first = Math.round(sc.scrollLeft / CI_CELL_W);
                if (col < first) first = col;
                else if (col >= first + visible) first = col - visible + 1;
                sc.scrollLeft = first * CI_CELL_W;
            }
        }
    }

    function ciLoad(file, select) {
        const V = view();
        ci.file = file;
        ci.entries = fileEntries(file);
        ci.content.querySelector('.dic-ci-path').value = V.ICON_FILES[file].path;
        const grid = ci.content.querySelector('.dic-ci-grid');
        grid.textContent = '';
        const frag = doc.createDocumentFragment();
        ci.entries.forEach((ref, i) => {
            const cell = el('div', 'dic-ci-item');
            cell.setAttribute('role', 'option');
            cell.dataset.i = String(i);
            cell.appendChild(V.iconElement(ref, 32, 'dic-ci-icon'));
            frag.appendChild(cell);
        });
        grid.appendChild(frag);
        const at = select ? ci.entries.findIndex((r) => sameRef(r, select)) : -1;
        ciSelect(at >= 0 ? at : 0);
    }

    function ciClose(ok) {
        if (!ci) return;
        const done = ci;
        ci = null;
        if (done.owner) done.owner.removeAttribute('inert');
        closeWindow(done.modal);
        if (done.owner) callGlobal('openModal', done.owner);
        if (ok && done.onPick && done.entries[done.selected]) done.onPick({ ...done.entries[done.selected] });
    }

    /** Change Icon: options { current, defaultFile, owner, onPick(ref) }. */
    function openChangeIcon(options = {}) {
        const V = view();
        if (!V || !doc) return;
        if (ci) ciClose(false);
        const current = V.normalizeIconRef(options.current);
        const file = current ? current.file : (V.ICON_FILES[options.defaultFile] ? options.defaultFile : 'shell32');
        const { modal, content, close } = makeWindow('desktopChangeIconDialog', 'Change Icon', 'dic-change-icon',
            '/static_images/vista-personalization/personalization-16.png', false);
        content.innerHTML = changeIconHtml();
        const owner = options.owner || null;
        if (owner) owner.setAttribute('inert', '');
        ci = { modal, content, owner, onPick: options.onPick, file, entries: [], selected: 0 };
        ciLoad(file, current);

        const list = content.querySelector('.dic-ci-list');
        const pathBox = content.querySelector('.dic-ci-path');
        close.addEventListener('click', () => ciClose(false));
        content.addEventListener('click', (ev) => {
            const item = ev.target.closest('.dic-ci-item');
            if (item) {
                ciSelect(Number(item.dataset.i), false);
                list.focus();
                return;
            }
            const b = ev.target.closest('[data-action]');
            if (!b || b.disabled) return;
            if (b.dataset.action === 'ci-ok') ciClose(true);
            else if (b.dataset.action === 'ci-cancel') ciClose(false);
        });
        content.addEventListener('dblclick', (ev) => {
            if (ev.target.closest('.dic-ci-item')) ciClose(true);
        });
        const applyPath = () => {
            if (!ci) return true;
            const f = fileForPath(pathBox.value);
            if (f) {
                if (f !== ci.file) ciLoad(f, null);
                return true;
            }
            message('Change Icon', `The file ${pathBox.value.trim()} contains no icons.\n\nChoose an icon from the list or specify a different file.`, modal)
                .then(() => { if (ci) { pathBox.value = V.ICON_FILES[ci.file].path; pathBox.select(); } });
            return false;
        };
        pathBox.addEventListener('change', applyPath);
        // Browse...: the icon files there are (Vista opens a file dialog filtered to them)
        const browse = content.querySelector('[data-action="ci-browse"]');
        const cm = root.contextMenu;
        if (cm && typeof cm.attachPickerMenu === 'function') {
            cm.attachPickerMenu(browse, {
                items: () => Object.keys(V.ICON_FILES).map((k) => ({ value: k, text: V.ICON_FILES[k].path })),
                value: () => ci && ci.file,
                onSelect: (value) => { if (ci && value !== ci.file) ciLoad(value, null); }
            });
        }
        modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); ciClose(false); return; }
            if (ev.key === 'Enter') {
                ev.preventDefault();
                if (ev.target === pathBox && !applyPath()) return;
                ciClose(true);
                return;
            }
            if (ev.target !== list || !ci) return;
            const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: CI_ROWS, ArrowLeft: -CI_ROWS, Home: -Infinity, End: Infinity }[ev.key];
            if (step === undefined) return;
            ev.preventDefault();
            const next = step === -Infinity ? 0 : step === Infinity ? ci.entries.length - 1 : ci.selected + step;
            ciSelect(next);
        });
        showWindow(modal, owner);
        root.requestAnimationFrame(() => { pathBox.focus(); pathBox.select(); ciSelect(ci ? ci.selected : 0); });
    }

    // ---- Desktop Icon Settings ------------------------------------------------------------------

    let dis = null;

    /** Which system icons this workspace's desktop shows now (desktopShortcuts.js desktopIconKey). */
    function shownIcons() {
        const S = shortcuts();
        const shown = {};
        if (!S) return shown;
        S.shortcuts.forEach((s) => {
            if (s._isDeleted || s.folderId != null) return;
            const key = S.desktopIconKey(s);
            if (key) shown[key] = true;
        });
        return shown;
    }

    function slotLabel(slot) {
        if (slot.slot === 'user') return workspaceName();
        return slot.label;
    }

    function desktopPageHtml() {
        const V = view();
        const checks = [
            ['computer', 13, 17], ['user', 13, 31], ['network', 13, 45], ['recycle', 120, 17], ['control-panel', 120, 31]
        ].map(([key, x, y]) => {
            const s = V.SYSTEM_ICONS.find((i) => i.key === key);
            return check(`dicShow-${key}`, x, y, 105, 10, s.check);
        }).join('');
        return `
            <div class="tbp-group" style="${dlu(7, 5, 238, 54)}"><span class="tbp-group-label">Desktop icons</span></div>
            ${checks}
            <div class="tbp-ctl dic-list" role="listbox" tabindex="0" aria-label="Desktop Icons" style="${dlu(7, 68, 238, 100)}"></div>
            ${button(122, 172, 60, 15, 'C<u>h</u>ange Icon...', 'dis-change')}
            ${button(186, 172, 60, 15, 'Re<u>s</u>tore Default', 'dis-restore')}`;
    }

    function disRenderList() {
        const V = view();
        const list = dis.content.querySelector('.dic-list');
        list.textContent = '';
        V.SYSTEM_ICON_SLOTS.forEach((slot) => {
            const item = el('div', `dic-item${dis.selected === slot.slot ? ' is-selected' : ''}`);
            item.dataset.slot = slot.slot;
            item.setAttribute('role', 'option');
            const ref = dis.icons[slot.slot] || slot.icon;
            item.appendChild(V.iconElement(ref, 32, 'dic-item-icon'));
            item.appendChild(el('div', 'dic-item-label', slotLabel(slot)));
            list.appendChild(item);
        });
        disLayoutList();
    }

    /** LVS_ICON: 75x75 cells left to right, as many as fit the list's width. */
    function disLayoutList() {
        const list = dis.content.querySelector('.dic-list');
        const perRow = Math.max(1, Math.floor((list.clientWidth || 355) / 75));
        [...list.children].forEach((item, i) => {
            item.style.left = `${(i % perRow) * 75}px`;
            item.style.top = `${Math.floor(i / perRow) * 75}px`;
        });
    }

    function disSelect(slot) {
        dis.selected = slot;
        dis.content.querySelectorAll('.dic-item').forEach((item) => item.classList.toggle('is-selected', item.dataset.slot === slot));
    }

    function disSyncChecks() {
        view().SYSTEM_ICONS.forEach(({ key }) => {
            const box = dis.content.querySelector(`#dicShow-${key}`);
            if (box) box.checked = !!dis.shown[key];
        });
    }

    function systemShortcut(key) {
        const ws = activeWorkspaceId();
        switch (key) {
            case 'computer': return { name: 'Computer', type: 'system-folder', data: { navPath: '/', systemKey: 'computer', desktopIcon: key } };
            case 'user': return { name: workspaceName(ws), type: 'system-folder', data: { navPath: `/Workspaces/${ws}`, systemKey: 'user', desktopIcon: key } };
            case 'network': return { name: 'Network', type: 'system-folder', data: { navPath: '/', systemKey: 'network', desktopIcon: key } };
            case 'recycle': return { name: 'Recycle Bin', type: 'system-folder', data: { navPath: `/Workspaces/${ws}/Trash`, systemKey: 'trash', desktopIcon: key } };
            case 'control-panel': return { name: 'Control Panel', type: 'system-folder', data: { navPath: '/', systemKey: 'control-panel', desktopIcon: key } };
            default: return null;
        }
    }

    async function disApply() {
        const V = view();
        const S = shortcuts();
        V.update({ systemIcons: { ...dis.icons } });
        if (!S) return;
        const now = shownIcons();
        for (const { key } of V.SYSTEM_ICONS) {
            const want = !!dis.shown[key];
            if (want && !now[key]) {
                const sc = systemShortcut(key);
                if (sc) await S.addShortcut(sc);
            } else if (!want && now[key]) {
                const ids = S.shortcuts.filter((s) => !s._isDeleted && s.folderId == null && S.desktopIconKey(s) === key).map((s) => s.id);
                for (const id of ids) await S.removeShortcut(id);
            }
        }
        S.renderShortcuts();
    }

    function disChangeIcon() {
        const V = view();
        const slot = dis.selected || V.SYSTEM_ICON_SLOTS[0].slot;
        disSelect(slot);
        const current = dis.icons[slot] || V.systemSlotDefault(slot);
        openChangeIcon({
            current,
            owner: dis.modal,
            onPick: (ref) => {
                if (!dis) return;
                dis.icons[slot] = ref;
                disRenderList();
                dis.setDirty(true);
            }
        });
    }

    /** Desktop Icon Settings (Personalize > Change desktop icons). */
    function openDesktopIconSettings() {
        const V = view();
        if (!V || !doc) return;
        const existing = doc.getElementById('desktopIconSettingsDialog');
        if (existing && dis) {
            callGlobal('openModal', existing);
            return;
        }
        const viewNow = V.get();
        const { modal, content, close } = makeWindow('desktopIconSettingsDialog', 'Desktop Icon Settings', 'dic-settings',
            '/static_images/vista-personalization/personalization-16.png');
        content.innerHTML = `
            <div class="tbp-tabs" role="tablist">
                <button type="button" class="tbp-tab is-selected" role="tab" aria-selected="true" data-tab="0" tabindex="0">Desktop</button>
            </div>
            <div class="tbp-pane">
                <div class="tbp-page" role="tabpanel" data-page="0">${desktopPageHtml()}</div>
            </div>
            <div class="tbp-footer">
                <button type="button" class="tbp-button tbp-footer-button" data-action="ok" data-dialog-primary="1">OK</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="cancel">Cancel</button>
                <button type="button" class="tbp-button tbp-footer-button" data-action="apply" disabled>Apply</button>
            </div>`;
        dis = {
            modal,
            content,
            shown: shownIcons(),
            icons: { ...(viewNow.systemIcons || {}) },
            selected: null,
            dirty: false
        };
        dis.setDirty = (on) => {
            dis.dirty = on;
            content.querySelector('[data-action="apply"]').disabled = !on;
        };
        const finish = () => {
            if (ci && ci.owner === modal) ciClose(false);
            dis = null;
            closeWindow(modal);
        };
        const apply = async () => {
            if (dis && dis.dirty) await disApply();
            if (dis) dis.setDirty(false);
        };
        disSyncChecks();
        disRenderList();
        close.addEventListener('click', finish);
        content.addEventListener('change', (ev) => {
            const box = ev.target.closest('input[type="checkbox"][id^="dicShow-"]');
            if (!box || !dis) return;
            dis.shown[box.id.slice('dicShow-'.length)] = box.checked;
            dis.setDirty(true);
        });
        content.addEventListener('click', async (ev) => {
            const item = ev.target.closest('.dic-item');
            if (item) {
                disSelect(item.dataset.slot);
                content.querySelector('.dic-list').focus();
                return;
            }
            if (ev.target.closest('.dic-list')) disSelect(null);
            const b = ev.target.closest('[data-action]');
            if (!b || b.disabled || !dis) return;
            switch (b.dataset.action) {
                case 'ok': await apply(); finish(); break;
                case 'cancel': finish(); break;
                case 'apply': await apply(); break;
                case 'dis-change': disChangeIcon(); break;
                case 'dis-restore': {
                    const slot = dis.selected || V.SYSTEM_ICON_SLOTS[0].slot;
                    disSelect(slot);
                    if (dis.icons[slot]) {
                        delete dis.icons[slot];
                        disRenderList();
                        dis.setDirty(true);
                    }
                    break;
                }
                default: break;
            }
        });
        content.addEventListener('dblclick', (ev) => {
            if (ev.target.closest('.dic-item')) disChangeIcon();
        });
        modal.addEventListener('keydown', async (ev) => {
            if (ev.target.closest && ev.target.closest('#desktopChangeIconDialog')) return;
            if (ev.key === 'Escape') {
                ev.preventDefault();
                finish();
            } else if (ev.key === 'Enter' && !ev.target.matches('button, textarea')) {
                ev.preventDefault();
                await apply();
                finish();
            } else if (ev.target.classList.contains('dic-list') && /^Arrow/.test(ev.key)) {
                ev.preventDefault();
                const slots = V.SYSTEM_ICON_SLOTS.map((s) => s.slot);
                const at = slots.indexOf(dis.selected);
                const perRow = Math.max(1, Math.floor(content.querySelector('.dic-list').clientWidth / 75));
                const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow, ArrowUp: -perRow }[ev.key];
                disSelect(slots[Math.max(0, Math.min(slots.length - 1, (at < 0 ? 0 : at + d)))]);
            }
        });
        showWindow(modal);
        root.requestAnimationFrame(() => {
            if (!dis) return;
            disLayoutList();
            const first = content.querySelector('#dicShow-computer');
            if (first) first.focus();
        });
    }

    const api = {
        openDesktopIconSettings,
        openChangeIcon,
        _test: { dlu, fileForPath, changeIconHtml, desktopPageHtml, systemShortcut }
    };
    root.desktopIconDialogs = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
