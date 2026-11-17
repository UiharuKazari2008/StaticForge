/**
 * Ledge on the phone: a session's desks of prints as folders in Pictures & Videos (wmShell.js
 * registerGalleryApp, its storage cards in wmPhoneGallery.js). My Device > Ledge holds one folder per
 * desk ("<chat name> (24)"); a desk is a grid of its pictures at the gallery's density, a check mark
 * on the checked ones. The desktop Ledge window (ledgeDesk.js) is never built on a phone.
 *
 * Desks are the user's, per workspace, on the server (modules/ledgeDesk.js). This device reads them
 * with ledge_list / ledge_get and changes them with ledge_checks / ledge_remove / ledge_clear /
 * ledge_rename / ledge_dispose. The server pushes ledge_state to the desk's owner only (the device
 * the Director session runs on); ledgeDesk.js merges it and calls present(desk, packet) here.
 * When the owner is this phone: a desk's first prints open Pictures & Videos at that desk, later
 * ones are added quietly, with a WM notification only when Pictures & Videos is not on screen.
 *
 *   window.wmLedge = {
 *     present(desk, packet)       ledgeDesk.js: the merged desk after a ledge_state packet
 *     init(onChange)              the workspace's desks (ledge_list); onChange() when they change
 *     available()                 there is a Ledge folder to show (desks, or Ledge on screen)
 *     active() / location()       Ledge on screen: { desk: sessionId | null } (null = the Ledge folder)
 *     open(deskId) / leave()      show the Ledge folder or a desk / back to the gallery's own folders
 *     folderItems()               the folder drop-down's rows (Ledge and its desks)
 *     barLabel() / render(page, force) / softKeys(page) / sortItems(page) / sortLabel()
 *     viewerSoftKeys(item) / viewbarState(act, item) / viewbarPress(act, item)
 *                                 the picture view of a desk's picture (slide data.wmKit = 'wmLedge')
 *   }
 */
(function () {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const TITLE = 'Pictures & Videos';
    const CHUNK = 60;
    const SEEN_KEY = 'wmLedgeSeen';
    const SORTS = [['date', 'Date'], ['name', 'Name']];

    let sh = null;
    let heads = [];           // the workspace's desks: { sessionId, name, count, rev, checked, ... }
    const desks = new Map();  // sessionId -> the whole desk (items with index, checked)
    let at = null;            // null = not on screen; { desk: null } = the Ledge folder; { desk: id }
    let selected = null;      // an item id on a desk, 'desk:<id>' in the Ledge folder
    let sortBy = 'date';
    let gridSig = '';
    let onChange = () => {};
    let noteTimer = null;
    const pendingNote = new Map(); // sessionId -> pictures added while Pictures & Videos was away

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const wsc = () => window.wsClient || null;
    const shell = () => (sh = window.wmShell || sh);
    const workspace = () => (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null); // eslint-disable-line no-undef
    const headOf = (id) => heads.find((h) => h.sessionId === id) || null;
    const deskLabel = (h) => `${h.name || 'Ledge'} (${Number(h.count) || 0})`;
    const changed = () => { gridSig = ''; try { onChange(); } catch (err) { console.warn('[wmLedge]', err); } };

    // desks this device has put on screen once (its later prints come in quietly)
    function seen() {
        try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch (_) { return new Set(); }
    }
    function markSeen(id) {
        const s = seen();
        if (s.has(id)) return;
        s.add(id);
        try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200))); } catch (_) { /* storage off: shown again next time */ }
    }

    // ---------------------------------------------------------------- server

    async function call(type, payload) {
        const c = wsc();
        if (!c || typeof c.sendMessage !== 'function') throw new Error('The server is not reachable.');
        const reply = await c.sendMessage(type, payload || {}, false);
        const data = reply && reply.data && typeof reply.data === 'object' ? reply.data : reply;
        if (!data || data.success === false) throw new Error((data && data.error) || 'The server did not answer.');
        return data;
    }

    function keepDesk(raw) {
        if (!raw || !raw.sessionId) return null;
        const desk = Object.assign({}, raw, { items: (raw.items || []).map((item, index) => Object.assign({}, item, { index })) });
        delete desk.present;
        desk.count = desk.items.length;
        desk.checked = desk.items.filter((item) => item.checked).map((item) => item.id);
        desks.set(desk.sessionId, desk);
        const head = headOf(desk.sessionId);
        const h = { sessionId: desk.sessionId, name: desk.name, workspaceId: desk.workspaceId, kind: desk.kind, chatId: desk.chatId, count: desk.count, rev: desk.rev, updatedAt: desk.updatedAt, checked: desk.checked };
        if (head) Object.assign(head, h); else heads.unshift(h);
        return desk;
    }

    function dropDesk(id) {
        desks.delete(id);
        heads = heads.filter((h) => h.sessionId !== id);
        if (at && at.desk === id) { at = { desk: null }; selected = null; }
        if (selected === `desk:${id}`) selected = null;
    }

    async function loadHeads() {
        try {
            const data = await call('ledge_list', {});
            const list = Array.isArray(data.sessions) ? data.sessions : [];
            // newest first, as the server keeps them
            list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
            // the desk on screen stays, also one of another workspace (the Director's, pushed here)
            const keep = at && at.desk && !list.some((h) => h.sessionId === at.desk) ? headOf(at.desk) : null;
            heads = keep ? [keep].concat(list) : list;
            for (const id of [...desks.keys()]) if (!heads.some((h) => h.sessionId === id)) desks.delete(id);
        } catch (_) { /* signed out or offline: the desks already held */ }
        if (at && at.desk && !headOf(at.desk)) { at = { desk: null }; selected = null; }
        return heads;
    }

    async function loadDesk(id) {
        const data = await call('ledge_get', { sessionId: id });
        return keepDesk(data.session);
    }

    // ---------------------------------------------------------------- push (ledgeDesk.js)

    function galleryOnScreen() {
        const s = shell();
        return !!(s && s.currentApp() === 'gallery' && document.visibilityState === 'visible' && !document.documentElement.hasAttribute('data-wm-behind'));
    }

    /** Pictures & Videos at this desk (the desk's first prints on this device). */
    function bringUp(id) {
        const s = shell();
        if (!s) return;
        at = { desk: id };
        selected = null;
        gridSig = '';
        const shown = s.currentApp() === 'gallery' ? true : s.open('gallery');
        if (shown === false) { noteLater(id, 0); return; }
        changed();
        if (document.visibilityState !== 'visible') {
            const h = headOf(id);
            void s.notify({ title: TITLE, icon: 'info', asNote: true, text: `${h ? h.name : 'Ledge'}: Opened in the background.` });
        }
    }

    /** One notification for the pictures that came in while Pictures & Videos was away. */
    function noteLater(id, n) {
        pendingNote.set(id, (pendingNote.get(id) || 0) + n);
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => {
            const s = shell();
            const list = [...pendingNote.entries()];
            pendingNote.clear();
            if (!s || galleryOnScreen()) return;
            for (const [deskId, count] of list) {
                const h = headOf(deskId);
                const name = h ? h.name : 'Ledge';
                const text = count > 1 ? `${count} new pictures on ${name}.` : (count === 1 ? `A new picture on ${name}.` : `${name} is ready.`);
                void s.notify({
                    title: TITLE, icon: 'info', text, asNote: true,
                    buttons: [{ text: 'Show', onClick: () => bringUp(deskId) }]
                });
            }
        }, 1200);
    }

    function present(desk, packet) {
        const data = packet || {};
        if (!desk || !desk.sessionId) return;
        if (desk.disposed) { dropDesk(desk.sessionId); changed(); return; }
        const id = desk.sessionId;
        const before = desks.get(id);
        keepDesk(desk);
        if (data.present) {
            const added = data.reason === 'add' ? (data.added || []).length : 0;
            // an agent's open (or a desk's first prints here) brings it up; later prints come in quietly
            if (data.reason === 'open' || !seen().has(id)) {
                markSeen(id);
                bringUp(id);
                return;
            }
            if (!galleryOnScreen()) noteLater(id, added || Math.max(0, desk.items.length - ((before && before.items.length) || 0)));
        }
        changed();
    }

    // ---------------------------------------------------------------- the folder

    async function open(id) {
        at = { desk: id || null };
        selected = null;
        gridSig = '';
        changed();
        // another device may own the desk (its changes are not pushed here): the desk as it is now
        if (id) {
            try { await loadDesk(id); } catch (err) { if (/unknown/i.test(String(err && err.message))) dropDesk(id); }
        } else {
            await loadHeads();
        }
        changed();
    }

    function leave() {
        if (!at) return;
        at = null;
        selected = null;
        gridSig = '';
    }

    function itemsNow(desk) {
        const list = desk ? desk.items.slice() : [];
        if (sortBy === 'name') list.sort((a, b) => String(a.text || a.filename || a.src).localeCompare(String(b.text || b.filename || b.src), undefined, { numeric: true, sensitivity: 'base' }));
        return list;
    }

    const stemOf = (f) => String(f || '').split('/').pop().replace(/\.(png|jpe?g|webp)$/i, '');
    function thumbOf(item) {
        if (item.src && !item.filename) return { src: item.src, fallback: '' };
        const stem = stemOf(item.filename);
        const full = typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(item.filename) : `/images/${encodeURIComponent(item.filename)}`; // eslint-disable-line no-undef
        return { src: stem ? `/previews/${encodeURIComponent(`${stem}@fit.webp`)}` : full, fallback: full };
    }
    const fullOf = (item) => (item.filename ? (typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(item.filename) : `/images/${encodeURIComponent(item.filename)}`) : item.src); // eslint-disable-line no-undef

    function folderArt() {
        const a = shell() && sh.art;
        return a ? `<img src="${a.url2x ? a.url2x('fe-folder') : a.url('fe-folder')}" alt="" draggable="false">` : '';
    }

    function deskCell(h) {
        const sel = selected === `desk:${h.sessionId}` ? ' is-selected' : '';
        return `<button type="button" class="wm-pv-cell wm-pv-dir${sel}" data-desk="${esc(h.sessionId)}" aria-label="${esc(deskLabel(h))}">${folderArt()}<span class="wm-pv-name">${esc(deskLabel(h))}</span></button>`;
    }

    function itemCell(item) {
        const t = thumbOf(item);
        const cls = (item.id === selected ? ' is-selected' : '') + (item.checked ? ' is-picked' : '');
        const label = item.text || item.filename || 'Picture';
        return `<button type="button" class="wm-pv-cell wm-photo${cls}" data-item="${esc(item.id)}" aria-label="${esc(label)}" aria-pressed="${item.checked ? 'true' : 'false'}"><img src="${esc(t.src)}"${t.fallback && t.fallback !== t.src ? ` data-fallback="${esc(t.fallback)}"` : ''} alt="" loading="lazy" decoding="async" draggable="false"></button>`;
    }

    function host(page) {
        let box = page.querySelector('.wm-pv-ledge');
        if (box) return box;
        page.querySelector('.wm-pv-scroll').insertAdjacentHTML('beforeend', '<div class="wm-pv-ledge" hidden></div><p class="wm-photos-empty wm-pv-ledge-empty" hidden></p>');
        box = page.querySelector('.wm-pv-ledge');
        box.addEventListener('click', (ev) => onTap(page, ev));
        box.addEventListener('contextmenu', (ev) => onHold(page, ev));
        // a print without a fit preview: the picture itself
        box.addEventListener('error', (ev) => {
            const img = ev.target;
            if (img && img.tagName === 'IMG' && img.dataset.fallback) { const f = img.dataset.fallback; delete img.dataset.fallback; img.src = f; }
        }, true);
        return box;
    }

    /** Draw Ledge into the page; false when Ledge is not on screen (its box hidden). */
    function render(page, force) {
        const box = host(page);
        const empty = page.querySelector('.wm-pv-ledge-empty');
        if (!at) {
            box.hidden = true;
            empty.hidden = true;
            return false;
        }
        box.hidden = false;
        const desk = at.desk ? desks.get(at.desk) : null;
        const cells = at.desk ? itemsNow(desk) : heads;
        const sig = at.desk
            ? `d|${at.desk}|${desk ? desk.rev : '-'}|${cells.map((i) => `${i.id}${i.checked ? '+' : ''}`).join(',')}|${sortBy}`
            : `f|${heads.map((h) => `${h.sessionId}:${h.name}:${h.count}`).join(',')}`;
        if (force || sig !== gridSig) {
            gridSig = sig;
            const cols = Number(page.style.getPropertyValue('--wm-pv-cols')) || 3;
            const size = cols * Math.max(1, Math.round(CHUNK / cols));
            let html = '';
            for (let i = 0; i < cells.length; i += size) {
                html += '<div class="wm-pv-chunk">';
                for (const c of cells.slice(i, i + size)) html += at.desk ? itemCell(c) : deskCell(c);
                html += '</div>';
            }
            box.innerHTML = html;
            empty.textContent = at.desk ? (desk ? 'No pictures' : 'Loading...') : 'No desks';
            empty.hidden = cells.length > 0;
        }
        return true;
    }

    function redraw(page) {
        gridSig = '';
        if (page) render(page, true);
        if (shell() && sh.currentApp() === 'gallery') sh.refreshSoftKeys();
    }

    function select(page, key) {
        selected = key;
        page.querySelectorAll('.wm-pv-ledge .wm-pv-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
        const el = !key ? null : key.startsWith('desk:')
            ? page.querySelector(`.wm-pv-ledge [data-desk="${CSS.escape(key.slice(5))}"]`)
            : page.querySelector(`.wm-pv-ledge [data-item="${CSS.escape(key)}"]`);
        if (el) el.classList.add('is-selected');
        if (shell()) sh.refreshSoftKeys();
    }

    function onTap(page, ev) {
        const d = ev.target.closest('[data-desk]');
        if (d) {
            // WM: a tap on a folder selects and opens it
            select(page, `desk:${d.dataset.desk}`);
            void sh.busy(open(d.dataset.desk), { paint: true });
            return;
        }
        const cell = ev.target.closest('[data-item]');
        if (!cell) return;
        select(page, cell.dataset.item);
        void view(cell.dataset.item);
    }

    function onHold(page, ev) {
        const d = ev.target.closest('[data-desk]');
        const cell = ev.target.closest('[data-item]');
        if (!d && !cell) return;
        ev.preventDefault();
        if (d) {
            select(page, `desk:${d.dataset.desk}`);
            sh.menuAt(ev.clientX, ev.clientY, deskMenu(d.dataset.desk, page, true));
            return;
        }
        select(page, cell.dataset.item);
        const item = itemOf(cell.dataset.item);
        if (item) sh.menuAt(ev.clientX, ev.clientY, [{ label: 'View', action: () => view(item.id) }, '-', ...itemMenu(item, page)]);
    }

    const curDesk = () => (at && at.desk ? desks.get(at.desk) || null : null);
    const itemOf = (id, desk) => { const d = desk || curDesk(); return d ? d.items.find((i) => i.id === id) || null : null; };
    const fn = (f) => (typeof window[f] === 'function' ? window[f] : null);
    function imageOf(item) {
        if (!item || !item.filename) return null;
        let known = null;
        try { known = typeof findImageByFilename === 'function' ? findImageByFilename(item.filename) : null; } catch (_) { known = null; } // eslint-disable-line no-undef
        return known || { filename: item.filename, original: item.filename };
    }

    // ---------------------------------------------------------------- changes

    function errBox(text, err) {
        const why = err && err.message;
        return sh.messageBox({ title: TITLE, icon: 'error', text: why ? `${text} ${why}` : text });
    }

    async function setChecked(desk, ids, page) {
        const on = new Set(ids);
        desk.items.forEach((item) => { item.checked = on.has(item.id); });
        desk.checked = desk.items.filter((item) => item.checked).map((item) => item.id);
        const head = headOf(desk.sessionId);
        if (head) head.checked = desk.checked.slice();
        redraw(page);
        try {
            const data = await call('ledge_checks', { sessionId: desk.sessionId, checked: desk.checked });
            if (data.session && data.session.rev != null) desk.rev = data.session.rev;
        } catch (err) {
            await errBox('The marks could not be saved.', err);
            await loadDesk(desk.sessionId).catch(() => {});
            redraw(page);
        }
    }

    function toggleCheck(item, page) {
        const desk = curDesk();
        if (!desk || !item) return;
        const ids = new Set(desk.checked);
        if (ids.has(item.id)) ids.delete(item.id); else ids.add(item.id);
        return setChecked(desk, [...ids], page);
    }

    async function afterChange(id, page) {
        await loadDesk(id).catch(() => {});
        redraw(page);
    }

    async function removeItem(item, page) {
        const desk = curDesk();
        if (!desk || !item) return false;
        try {
            await sh.busy(call('ledge_remove', { sessionId: desk.sessionId, itemId: item.id }), { paint: true });
        } catch (err) { await errBox('The picture could not be taken off the desk.', err); return false; }
        if (selected === item.id) selected = null;
        await afterChange(desk.sessionId, page);
        return true;
    }

    async function ask(title, text) {
        return sh.messageBox({
            title, icon: 'warning', text,
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false
        });
    }

    async function clearDesk(id, page) {
        const h = headOf(id);
        if (!h || !(await ask('Clear Desk', `Take every picture off '${h.name}'? The pictures stay in the gallery.`))) return;
        try { await sh.busy(call('ledge_clear', { sessionId: id }), { paint: true }); } catch (err) { await errBox('The desk could not be cleared.', err); return; }
        selected = null;
        await afterChange(id, page);
    }

    async function deleteDesk(id, page) {
        const h = headOf(id);
        if (!h || !(await ask('Delete Desk', `Are you sure you want to delete the desk '${h.name}'? The pictures stay in the gallery.`))) return;
        try { await sh.busy(call('ledge_dispose', { sessionId: id }), { paint: true }); } catch (err) { await errBox('The desk could not be deleted.', err); return; }
        dropDesk(id);
        redraw(page);
        changed();
    }

    async function renameDesk(id, page) {
        const h = headOf(id);
        if (!h) return;
        const v = await sh.messageBox({
            title: 'Rename Desk', icon: null, text: `New name for ${h.name}:`, input: { value: h.name || '' },
            buttons: [{ text: 'OK', value: true }, { text: 'Cancel', value: false }], cancelValue: false
        });
        if (v === false || v == null || v === true) return;
        const name = String(v).trim();
        if (!name || name === h.name) return;
        try {
            const data = await sh.busy(call('ledge_rename', { sessionId: id, name }), { paint: true });
            h.name = (data.session && data.session.name) || name;
            const desk = desks.get(id);
            if (desk) desk.name = h.name;
        } catch (err) { await errBox('The desk could not be renamed.', err); return; }
        redraw(page);
        changed();
    }

    const toBase64 = (text) => {
        const bytes = new TextEncoder().encode(text);
        let bin = '';
        bytes.forEach((b) => { bin += String.fromCharCode(b); });
        return btoa(bin);
    };

    /** The desk as a JSON file in My Documents (the desktop window's Save writes the same file to its desktop). */
    async function saveDesk(id) {
        const vfs = typeof vfsClient !== 'undefined' ? vfsClient : window.vfsClient; // eslint-disable-line no-undef
        const ws = workspace();
        if (!vfs || typeof vfs.uploadFile !== 'function' || !ws) { await errBox('My Documents is not reachable right now.'); return; }
        let desk;
        try { desk = await sh.busy(loadDesk(id), { paint: true }); } catch (err) { await errBox('The desk could not be read.', err); return; }
        const name = `ledge-${id}.json`;
        const body = { kind: 'ledge-session', sessionId: id, name: desk.name || '', items: desk.items.map((i) => ({ index: i.index, id: i.id, filename: i.filename || '', text: i.text || '', checked: !!i.checked })) };
        try {
            const r = await sh.busy(vfs.uploadFile(`/Workspaces/${ws}/`, toBase64(JSON.stringify(body, null, 2)), name, 'application/json'), { paint: true });
            if (r && r.success === false) throw new Error(r.error || r.message || '');
        } catch (err) { await errBox('The desk could not be saved.', err); return; }
        await sh.messageBox({ title: TITLE, icon: 'info', text: `${desk.name} was saved to My Documents as ${name}.` });
    }

    function openInStudio(item) {
        const img = imageOf(item);
        const f = fn('openManualModalWithContent');
        if (img && f) f({ type: 'image', image: img });
    }

    // ---------------------------------------------------------------- menus and soft keys

    function itemMenu(item, page) {
        return [
            { label: item.checked ? 'Uncheck' : 'Check', action: () => toggleCheck(item, page) },
            { label: 'Open in Studio', disabled: !item.filename || !fn('openManualModalWithContent'), action: () => openInStudio(item) },
            { label: 'Remove from Desk', action: () => removeItem(item, page) }
        ];
    }

    function deskMenu(id, page, withOpen) {
        return [
            ...(withOpen ? [{ label: 'Open', action: () => sh.busy(open(id), { paint: true }) }, '-'] : []),
            { label: 'Rename Desk...', action: () => renameDesk(id, page) },
            { label: 'Save Desk', action: () => saveDesk(id) },
            { label: 'Clear Desk', disabled: !(headOf(id) && headOf(id).count), action: () => clearDesk(id, page) },
            { label: 'Delete Desk', action: () => deleteDesk(id, page) }
        ];
    }

    /** Check | Menu on a desk; Open | Menu in the Ledge folder. */
    function softKeys(page) {
        if (at && !at.desk) {
            const id = selected && selected.startsWith('desk:') ? selected.slice(5) : null;
            return {
                left: { label: 'Open', disabled: !id, action: () => id && sh.busy(open(id), { paint: true }) },
                right: { label: 'Menu', menu: () => (id ? deskMenu(id, page, false) : [{ label: 'Rename Desk...', disabled: true }, { label: 'Delete Desk', disabled: true }]) }
            };
        }
        const desk = curDesk();
        const item = selected ? itemOf(selected) : null;
        const all = desk ? desk.items.length : 0;
        const nChecked = desk ? desk.checked.length : 0;
        return {
            left: { label: item && item.checked ? 'Uncheck' : 'Check', disabled: !item, action: () => item && toggleCheck(item, page) },
            right: {
                label: 'Menu',
                menu: () => [
                    { label: 'Open in Studio', disabled: !item || !item.filename || !fn('openManualModalWithContent'), action: () => openInStudio(item) },
                    { label: 'Remove from Desk', disabled: !item, action: () => removeItem(item, page) },
                    '-',
                    { label: 'Select All', disabled: !all || nChecked === all, action: () => setChecked(desk, desk.items.map((i) => i.id), page) },
                    ...(nChecked ? [{ label: 'Clear Selection', action: () => setChecked(desk, [], page) }] : []),
                    '-',
                    ...(desk ? deskMenu(desk.sessionId, page, false) : [])
                ]
            }
        };
    }

    function sortItems(page) {
        return SORTS.map(([k, label]) => ({ label, radio: sortBy === k, action: () => { sortBy = k; redraw(page); changed(); } }));
    }

    /**
     * The drop-down's rows: Ledge, and under it each of the workspace's desks with its count (the
     * one on screen with the dot).
     */
    function folderItems() {
        if (!available()) return [];
        const out = [{ label: 'Ledge', indent: 1, radio: !!(at && !at.desk), action: () => sh.busy(open(null), { paint: true }) }];
        for (const h of heads) {
            out.push({ label: deskLabel(h), indent: 2, radio: !!(at && at.desk === h.sessionId), action: () => sh.busy(open(h.sessionId), { paint: true }) });
        }
        return out;
    }

    function barLabel() {
        if (!at) return '';
        if (!at.desk) return 'Ledge';
        const h = headOf(at.desk);
        return h ? h.name : 'Ledge';
    }

    // ---------------------------------------------------------------- picture view

    function slideOf(desk, item) {
        const img = imageOf(item);
        let w = Number(img && img.width) || 0;
        let h = Number(img && img.height) || 0;
        if (!w || !h) {
            // the grid's thumbnail has the picture's proportions
            const el = document.querySelector(`.wm-pv-ledge [data-item="${CSS.escape(item.id)}"] img`);
            const nw = el && el.naturalWidth;
            const nh = el && el.naturalHeight;
            if (nw && nh) { const k = 2048 / Math.max(nw, nh); w = Math.round(nw * k); h = Math.round(nh * k); } else { w = 1024; h = 1024; }
        }
        const t = thumbOf(item);
        return {
            src: fullOf(item),
            msrc: t.src,
            width: w,
            height: h,
            data: { isStandalone: true, title: item.text || item.filename || 'Picture', filename: item.filename || undefined, ledgeDesk: desk.sessionId, ledgeItem: item.id, wmKit: 'wmLedge' }
        };
    }

    async function view(id) {
        const desk = curDesk();
        const open = fn('openStandalonePhotoSwipe') || (typeof openStandalonePhotoSwipe === 'function' ? openStandalonePhotoSwipe : null); // eslint-disable-line no-undef
        if (!desk || !open) return;
        const list = itemsNow(desk);
        const i = Math.max(0, list.findIndex((x) => x.id === id));
        if (!list.length) return;
        await sh.busy(Promise.resolve(open(list.map((x) => slideOf(desk, x)), i)), { paint: true });
        const p = window.pswp;
        if (p && typeof p.on === 'function') {
            // the grid follows the picture on screen (Check acts on it after Back)
            p.on('change', () => {
                const d = p.currSlide && p.currSlide.data && p.currSlide.data.data;
                if (d && d.ledgeItem) { const page = galleryPage(); if (page) select(page, d.ledgeItem); }
            });
        }
    }

    const galleryPage = () => (shell() && typeof sh.pageOf === 'function' ? sh.pageOf('gallery') : null);
    const slideItem = (d) => (d && d.ledgeDesk ? itemOf(d.ledgeItem, desks.get(d.ledgeDesk)) : null);

    function closeViewer() {
        const p = window.pswp;
        return new Promise((resolve) => {
            if (!p || p.isDestroying || typeof p.close !== 'function') { resolve(); return; }
            p.on('destroy', () => resolve());
            setTimeout(resolve, 800);
            try { p.close(); } catch (_) { resolve(); }
        });
    }

    function viewerSoftKeys(d) {
        const item = slideItem(d);
        const page = galleryPage();
        return {
            left: { label: item && item.checked ? 'Uncheck' : 'Check', disabled: !item, action: async () => { await toggleCheck(item, page); if (shell()) sh.refreshSoftKeys(); } },
            right: {
                label: 'Menu',
                // Zoom, Edit (DreamStudio / Director) and Pin are on the tool strip
                menu: () => [
                    { label: 'Remove from Desk', disabled: !item, action: async () => { await closeViewer(); await removeItem(item, page); } },
                    '-',
                    { label: 'Set as Today Background', disabled: !item || !item.filename, action: () => sh.setTodayBackground(item.filename, imageOf(item)) },
                    { label: 'Copy Lookback', disabled: !item || !item.filename || !fn('copyLookbackImage'), action: () => window.copyLookbackImage(item.filename) }
                ]
            }
        };
    }

    function pinned(item) {
        try { return !!(item && item.filename && typeof checkIfImageIsPinned === 'function' && checkIfImageIsPinned(item.filename)); } catch (_) { return false; } // eslint-disable-line no-undef
    }

    function viewbarState(act, d) {
        const item = slideItem(d);
        if (!item) return { enabled: false };
        if (act === 'zoom') return { enabled: true };
        if (act === 'studio') return { enabled: !!(item.filename && fn('openManualModalWithContent')) };
        if (act === 'director') return { enabled: !!(item.filename && fn('askWrenAboutImage')) };
        if (act === 'pin') return { enabled: !!(item.filename && fn('togglePinImage')), pressed: pinned(item) };
        // Delete: a desk deletes no file (Menu > Remove from Desk takes it off)
        return { enabled: false };
    }

    function viewbarPress(act, d) {
        const item = slideItem(d);
        if (!item) return;
        const p = window.pswp;
        if (act === 'zoom') { if (p && typeof p.toggleZoom === 'function') p.toggleZoom(); return; }
        if (act === 'studio') { openInStudio(item); return; }
        if (act === 'director') { window.askWrenAboutImage(item.filename); return; }
        if (act === 'pin') { try { window.togglePinImage(imageOf(item)); } catch (err) { console.warn('[wmLedge] pin', err); } }
    }

    // ---------------------------------------------------------------- set-up

    function available() {
        return !!at || heads.length > 0;
    }

    function init(cb) {
        if (typeof cb === 'function') onChange = cb;
        shell();
        return loadHeads().then(() => { changed(); return available(); });
    }

    // another workspace: its own desks
    document.addEventListener('workspaceSwitchComplete', () => {
        at = null;
        selected = null;
        void loadHeads().then(changed);
    }, { signal: appScopeSignal });

    window.wmLedge = {
        present,
        init,
        available,
        active: () => !!at,
        location: () => (at ? { desk: at.desk } : null),
        open: (id) => open(id),
        leave,
        folderItems,
        barLabel,
        render,
        softKeys,
        sortItems,
        sortLabel: () => (SORTS.find(([k]) => k === sortBy) || SORTS[0])[1],
        viewerSoftKeys,
        viewbarState,
        viewbarPress
    };
})();
