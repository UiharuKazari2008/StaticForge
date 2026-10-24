/**
 * The Contacts folder in Explorer (Yozora #632): Vista's Melaton Contacts is an Explorer folder, so
 * /Workspaces/<ws>/Contacts gets the folder's own face here instead of a window of its own.
 * Measured on the Vista VM (refs in ~/.cache/vista-vm/contacts-ref):
 *
 *   columns         Name, E-mail Address, Business phone, Home phone (the cards' fields)
 *   view            Tiles by default (the picture, the name, the e-mail address and a phone)
 *   pictures        the contact's photo (else wab32res bitmap 4140) in wab32res's glass frame
 *                   (PNG 4145-4150) with the contact badge (wab.exe icon 1)
 *   command bar     nothing chosen: New Contact, New Contact Group, Import, Export; a contact:
 *                   Open (Melaton Contacts / Choose Default Program...), E-Mail, New Contact,
 *                   New Contact Group, Edit, Delete, Print, Import, Export; what does not fit
 *                   goes under >> (wab.exe icons 0, 4-9; shell32 16 for Print)
 *   preview pane    the picture in the 128 px frame, the name, "Trusted Contact"
 *   context menu    Open, Print, Action > (Send E-mail, Send E-mail To, Call This Contact...),
 *                   This Is Me, Send Contact, then Explorer's own
 *
 * The cards are read here (melatonVCard, vcard.js); the sheets and dialogs are the contacts
 * package's (apps/contacts), started with an action: melatonApps.launch({ packageId: 'contacts',
 * args: { action, files, folder } }).
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-contacts';
    const FRAMES = [16, 31, 62, 96, 128, 256];
    // a frame's glass opening, as a fraction of its side (measured on wab32res PNG 4147-4150)
    const OPENING = 0.13;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const V = () => root.melatonVCard;
    // explorerApplet.js keeps its one window in a top-level let, not on window
    const vfs = () => root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef
    const currentApp = () => (typeof explorerApplet !== 'undefined' && explorerApplet ? explorerApplet : null); // eslint-disable-line no-undef

    function isPath(path) {
        return /^\/Workspaces\/[^/]+\/Contacts$/i.test(String(path || '').replace(/\/+$/, ''));
    }

    function active(app) {
        return !!(app && isPath(app.currentPath));
    }

    function isCardFile(item) {
        return !!item && item.targetKind === 'user-file' && /\.vcf$/i.test(item.name || '');
    }

    function fileIdOf(item) {
        return item.targetId || item.id;
    }

    // ---- the cards ---------------------------------------------------------------------------

    const cards = new Map(); // file id -> { stamp, card }
    const loading = new Map(); // file id -> promise

    function cardOf(item) {
        if (!isCardFile(item)) return null;
        const hit = cards.get(fileIdOf(item));
        return hit ? hit.card : null;
    }

    async function readCard(item) {
        const id = fileIdOf(item);
        const stamp = `${item.modifiedAt || ''}|${item.size || ''}`;
        const hit = cards.get(id);
        if (hit && hit.stamp === stamp) return hit.card;
        if (loading.has(id)) return loading.get(id);
        const p = (async () => {
            try {
                const r = await vfs().downloadFile(id);
                const text = await (await fetch(r.downloadUrl, { credentials: 'same-origin' })).text();
                const card = (V() && V().parseVcf(text)[0]) || null;
                cards.set(id, { stamp, card });
                return card;
            } catch (err) {
                console.warn('Contacts: could not read', item.name, err);
                // the next listing tries again
                cards.set(id, { stamp: '!failed', card: null });
                return null;
            } finally {
                loading.delete(id);
            }
        })();
        loading.set(id, p);
        return p;
    }

    /** After a listing: read the cards not read yet, then redraw what shows them. */
    async function onItems(app, items) {
        if (!active(app) || !V()) return;
        const want = (items || []).filter(isCardFile).filter((it) => {
            const hit = cards.get(fileIdOf(it));
            return !hit || hit.stamp !== `${it.modifiedAt || ''}|${it.size || ''}`;
        });
        if (!want.length) return;
        await Promise.all(want.map(readCard));
        if (!active(app)) return;
        if (app.grid) app.grid.repaint();
        const sel = app.grid ? app.grid.getSelectedItems() : [];
        syncPreview(app, sel);
        if (app.vista) app.updateToolbarState(sel);
    }

    // ---- the grid ----------------------------------------------------------------------------

    function labelFor(app, item) {
        if (!active(app) || !isCardFile(item)) return null;
        const c = cardOf(item);
        return c ? V().displayName(c) : String(item.name || '').replace(/\.vcf$/i, '');
    }

    /** Details: the three slots after Name hold E-mail Address, Business phone and Home phone. */
    function columnText(app, item, field) {
        if (!active(app)) return null;
        const c = cardOf(item);
        if (!c) return isCardFile(item) || item.kind !== 'folder' ? '' : null;
        if (field === 'date') return c.group ? '' : V().email(c);
        if (field === 'type') return c.work.phone || '';
        return c.home.phone || '';
    }

    function tileLines(app, item) {
        if (!active(app) || !isCardFile(item)) return null;
        const c = cardOf(item);
        if (!c) return ['', ''];
        if (c.group) return [`${c.members.length} Member(s)`, ''];
        return [V().email(c), c.work.phone || c.home.phone || ''];
    }

    const HEADER = [['name', 'Name'], ['date', 'E-mail Address'], ['type', 'Business phone'], ['size', 'Home phone']];
    const PLAIN = { name: 'Name', date: 'Date modified', type: 'Type', size: 'Size' };

    /** The column headers: the folder's own, or Explorer's again on the way out. */
    function syncHeader(app) {
        const head = doc && doc.getElementById('explorerDetailsHeader');
        if (!head) return;
        const on = active(app);
        head.classList.toggle('explorer-contacts-header', on);
        head.querySelectorAll('.explorer-details-sort-col').forEach((b) => {
            const f = b.dataset.sortField;
            const label = b.querySelector('.explorer-details-col-label');
            const want = on ? (HEADER.find((h) => h[0] === f) || [f, PLAIN[f]])[1] : PLAIN[f];
            if (label && want && label.textContent !== want) label.textContent = want;
        });
    }

    // ---- pictures ----------------------------------------------------------------------------

    const frameImages = new Map();
    const pictureCache = new Map();

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    function frameFor(side) {
        const size = FRAMES.find((s) => s >= side) || 256;
        if (!frameImages.has(size)) frameImages.set(size, loadImage(`${ART}/frame-${size}.png`));
        return frameImages.get(size);
    }

    /** The card's picture in the glass frame, side px square, as a data URL (cached per card). */
    async function framedPicture(card, side) {
        const key = `${card ? card.uid : '-'}|${card && card.photo ? card.photo.length : 0}|${side}`;
        if (pictureCache.has(key)) return pictureCache.get(key);
        const p = (async () => {
            const [photo, frame] = await Promise.all([
                loadImage(card && card.photo ? card.photo : `${ART}/default-picture.png`),
                frameFor(side)
            ]);
            const cv = doc.createElement('canvas');
            cv.width = side;
            cv.height = side;
            const x = cv.getContext('2d');
            x.imageSmoothingQuality = 'high';
            const inset = Math.round(side * OPENING);
            const s = Math.min(photo.naturalWidth, photo.naturalHeight);
            x.drawImage(photo, (photo.naturalWidth - s) / 2, (photo.naturalHeight - s) / 2, s, s, inset, inset, side - inset * 2, side - inset * 2);
            x.drawImage(frame, 0, 0, side, side);
            return cv.toDataURL('image/png');
        })();
        pictureCache.set(key, p);
        return p;
    }

    /**
     * An item's icon box in the Contacts folder: a card's framed picture with the contact badge
     * (a group: wab.exe icon 2). Returns false for what Explorer draws itself.
     */
    function populateIcon(app, box, item) {
        if (!active(app) || !isCardFile(item)) return false;
        const c = cardOf(item);
        const row = box.classList.contains('explorer-item-icon-box-row');
        box.classList.add('explorer-contact-icon');
        if (row || !c) {
            box.innerHTML = `<img class="explorer-contact-badge-only" src="${ART}/${c && c.group ? 'group' : 'contact'}-16.png" alt="">`;
            // not read yet (and not being read): read it once, then draw again
            if (!c && !cards.has(fileIdOf(item)) && !loading.has(fileIdOf(item))) void readCard(item).then((card) => { if (card && app.grid) app.grid.repaint(); });
            return true;
        }
        if (c.group) {
            box.innerHTML = `<img class="explorer-contact-group" src="${ART}/group-48.png" alt="">`;
            return true;
        }
        const big = box.classList.contains('explorer-item-icon-box-xl') || box.classList.contains('explorer-item-icon-box-lg');
        // the details pane draws it larger than a tile (56 px on the VM)
        const side = big ? 96 : box.classList.contains('explorer-details-icon') ? 56 : 40;
        const stamp = `${c.uid}|${side}`;
        box.dataset.contactStamp = stamp;
        void framedPicture(c, side).then((url) => {
            if (box.dataset.contactStamp !== stamp) return;
            box.innerHTML = `<img class="explorer-contact-picture" src="${url}" alt="" style="width:${side}px;height:${side}px"><img class="explorer-contact-badge" src="${ART}/contact-16.png" alt="">`;
        });
        return true;
    }

    // ---- the preview pane --------------------------------------------------------------------

    function previewPane() {
        return doc && doc.getElementById('explorerPreviewPane');
    }

    function syncPreview(app, sel) {
        const pane = previewPane();
        if (!pane) return;
        const on = active(app);
        pane.classList.toggle('hidden', !on);
        if (app && app.modal) app.modal.classList.toggle('explorer-in-contacts', on);
        if (!on) return;
        const one = Array.isArray(sel) && sel.length === 1 && isCardFile(sel[0]) ? sel[0] : null;
        const c = one ? cardOf(one) : null;
        if (!c) {
            if (pane.dataset.uid !== '') {
                pane.dataset.uid = '';
                pane.innerHTML = '<div class="explorer-preview-empty">Select a file to preview.</div>';
            }
            return;
        }
        const stamp = `${c.uid}|${c.photo ? c.photo.length : 0}|${V().displayName(c)}`;
        if (pane.dataset.uid === stamp) return;
        pane.dataset.uid = stamp;
        pane.innerHTML = `<div class="explorer-preview-contact">
            <div class="explorer-preview-picture"><img class="explorer-preview-photo" alt=""><img class="explorer-preview-badge" src="${ART}/contact-32.png" alt=""></div>
            <div class="explorer-preview-name">${esc(V().displayName(c))}</div>
            ${c.group ? '' : '<a href="#" class="explorer-preview-link" data-contact-action="open">Trusted Contact</a>'}
        </div>`;
        void framedPicture(c, 128).then((url) => {
            const img = pane.querySelector('.explorer-preview-photo');
            if (img && pane.dataset.uid === stamp) img.src = url;
        });
        const link = pane.querySelector('.explorer-preview-link');
        if (link) link.addEventListener('click', (ev) => { ev.preventDefault(); void run(app, 'open', [one]); });
    }

    // ---- the command bar ---------------------------------------------------------------------

    const COMMANDS = [
        // id, label, icon, tooltip (wab32res.dll.mui strings 70-81), shown for: 'none' | 'sel' | 'both'
        ['open', 'Open', 'cmd-open', 'Open the selected item with Melaton Contacts.', 'sel'],
        ['email', 'E-Mail', 'cmd-email', 'Start composing a new e-mail message to the selected contact(s).', 'sel'],
        ['new', 'New Contact', 'cmd-new-contact', 'Create a new contact.', 'both'],
        ['new-group', 'New Contact Group', 'cmd-new-group', 'Create a new contact group.', 'both'],
        ['edit', 'Edit', 'cmd-edit', 'Edit properties for the selected entry.', 'sel'],
        ['delete', 'Delete', '../vista-cmdbar/delete', 'Deletes the current selection from Contacts.', 'sel'],
        ['print', 'Print', 'cmd-print', 'Print the selected contacts.', 'sel'],
        ['import', 'Import', 'cmd-import', 'Import your contacts from another format.', 'both'],
        ['export', 'Export', 'cmd-export', 'Export your contacts to another format.', 'both']
    ];

    function commandButton(id) {
        return doc && doc.getElementById(`explorerContact-${id}`);
    }

    /** Make the folder's buttons once, after Explorer's own (app.html's command set). */
    function ensureCommands(app) {
        const set = doc && doc.querySelector('#explorerModal .explorer-command-set');
        if (!set || set.querySelector('.explorer-contact-cmd')) return set;
        COMMANDS.forEach(([id, label, icon, tip]) => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.id = `explorerContact-${id}`;
            b.className = `explorer-command-btn explorer-contact-cmd hidden${id === 'open' ? ' has-menu is-split' : ''}`;
            b.title = tip;
            b.innerHTML = `<img class="explorer-command-icon" src="${ART}/${icon}.png" alt="">${esc(label)}${id === 'open' ? '<span class="explorer-command-glyph" aria-hidden="true"></span>' : ''}`;
            b.addEventListener('click', (ev) => {
                // the Open button is split: its arrow opens the programs menu (wired below)
                if (ev.target.closest('.explorer-command-glyph')) return;
                const a = currentApp() || app;
                void run(a, id, a.grid ? a.grid.getSelectedItems() : []);
            });
            set.appendChild(b);
            if (id === 'open') {
                menuOn(b.querySelector('.explorer-command-glyph'), () => [
                    { text: 'Melaton Contacts', action: 'open', image: `${ART}/cmd-open.png` },
                    { separator: true },
                    { text: 'Choose Default Program...', action: 'default-program' }
                ]);
            }
        });
        const more = doc.createElement('button');
        more.type = 'button';
        more.id = 'explorerContact-more';
        more.className = 'explorer-command-btn explorer-contact-cmd explorer-command-more hidden';
        more.title = 'More';
        more.innerHTML = '<span class="explorer-command-chevrons" aria-hidden="true"></span>';
        set.appendChild(more);
        menuOn(more, () => (more._overflow || []).map(([id, label, icon]) => ({ text: label, action: id, image: `${ART}/${icon}.png` })));
        return set;
    }

    /** A click menu under el (contextMenu's anchored click menus); its picks run on the selection. */
    function menuOn(el, items) {
        const cm = root.contextMenu;
        if (!cm || !el) return;
        cm.attachClickMenuToElement(el, {
            position: 'anchor',
            anchorAlign: 'start',
            sections: [{ type: 'list', initfn: (s) => { s.items = items(); } }],
            onAction: (action) => {
                const a = currentApp();
                if (a) void run(a, action, a.grid ? a.grid.getSelectedItems() : []);
            }
        });
    }

    /** Explorer's updateToolbarState: the folder's buttons, Explorer's own hidden while inside. */
    function syncCommands(app, sel) {
        if (!doc) return;
        const on = active(app);
        const set = on ? ensureCommands(app) : doc.querySelector('#explorerModal .explorer-command-set');
        if (!set) return;
        syncHeader(app);
        syncPreview(app, sel);
        const cards = (sel || []).filter(isCardFile);
        const hasSel = on && cards.length > 0;
        set.querySelectorAll('.explorer-contact-cmd').forEach((b) => b.classList.add('hidden'));
        if (!on) return;
        ['explorerUploadCmd', 'explorerDownloadCmd', 'explorerReplaceCmd', 'explorerPreviewCmd'].forEach((id) => {
            const b = doc.getElementById(id);
            if (b) b.classList.add('hidden');
        });
        const want = COMMANDS.filter((c) => c[4] === 'both' || (c[4] === 'sel' && hasSel));
        want.forEach(([id]) => { const b = commandButton(id); if (b) b.classList.remove('hidden'); });
        const one = cards.length === 1;
        ['open', 'edit'].forEach((id) => { const b = commandButton(id); if (b) b.disabled = !one; });
        fitCommands(set, want);
    }

    /** What does not fit before the bar's end goes under >> (Vista's command bar overflow). */
    function fitCommands(set, want) {
        const more = commandButton('more');
        if (!more) return;
        more.classList.add('hidden');
        more._overflow = [];
        const limit = set.parentElement ? set.parentElement.getBoundingClientRect().right - 34 : Infinity;
        const shown = want.slice();
        const over = [];
        const lastRight = () => {
            const b = commandButton(shown[shown.length - 1][0]);
            return b ? b.getBoundingClientRect().right : 0;
        };
        while (shown.length > 1 && lastRight() > limit) {
            const c = shown.pop();
            over.unshift(c);
            const b = commandButton(c[0]);
            if (b) b.classList.add('hidden');
            more.classList.remove('hidden');
        }
        more._overflow = over;
    }

    // ---- the context menu ----------------------------------------------------------------------

    /** Items under Open for a card (explorerApplet buildContextMenuSections). */
    function contextItems(app, item) {
        if (!isCardFile(item)) return null;
        const c = cardOf(item);
        const hasMail = !!(c && (c.group || V().email(c)));
        return [
            { text: 'Print', action: 'explorer-contact-print' },
            { text: 'Action', hasSubmenu: true, submenu: [
                { text: 'Send E-mail', action: 'explorer-contact-email', disabled: !hasMail },
                { text: 'Send E-mail To...', disabled: true },
                { text: 'Call This Contact...', action: 'explorer-contact-call', disabled: !(c && (c.home.phone || c.work.phone || c.home.mobile)) }
            ] },
            { text: 'This Is Me', action: 'explorer-contact-me', image: `${ART}/contact-16.png`, disabled: !!(c && c.group) },
            { text: 'Send Contact', action: 'explorer-contact-send', disabled: !!(c && c.group) }
        ];
    }

    async function handleAction(action, item, app) {
        const sel = app.grid ? app.grid.getSelectedItems() : [];
        const files = sel.length ? sel : (item ? [item] : []);
        const verb = action.replace(/^explorer-contact-/, '');
        await run(app, verb, files);
        return true;
    }

    // ---- actions ------------------------------------------------------------------------------

    function fileRefs(app, items) {
        return (items || []).filter(isCardFile).map((it) => ({ id: fileIdOf(it), name: it.name, path: app.currentPath }));
    }

    async function run(app, verb, items) {
        if (!app) return;
        if (verb === 'delete') { await app.deleteSelection(); return; }
        if (verb === 'default-program') {
            if (root.melatonControlPanel) root.melatonControlPanel.open('default-programs-assoc');
            return;
        }
        if (!root.melatonApps) return;
        const action = verb === 'edit' ? 'open' : verb;
        await root.melatonApps.launch({ packageId: 'contacts', args: { action, files: fileRefs(app, items), folder: app.currentPath } });
    }

    /** Explorer's openItem: a card opens in its Properties, wherever it is. */
    async function open(app, item) {
        if (!isCardFile(item) || !root.melatonApps) return false;
        await root.melatonApps.launch({ packageId: 'contacts', args: { action: 'open', files: fileRefs(app, [item]), folder: app.currentPath } });
        return true;
    }

    /** The details pane's name for a card (Vista shows the contact, not the file). */
    function detailsName(app, item) {
        return labelFor(app, item);
    }

    /** The package saved or removed cards: forget them and list the folder again. */
    function changed() {
        cards.clear();
        const app = currentApp();
        if (app && active(app) && typeof app.softRefresh === 'function') void app.softRefresh();
    }

    const api = {
        isPath,
        active,
        isCardFile,
        cardOf,
        onItems,
        labelFor,
        columnText,
        tileLines,
        syncHeader,
        populateIcon,
        syncPreview,
        syncCommands,
        contextItems,
        handleAction,
        open,
        detailsName,
        changed,
        framedPicture,
        ART
    };
    root.explorerContacts = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
