// Ledge: one stage-results window per session, cloned from #ledgeDeskTemplate.
// Server sessions live in modules/ledgeDesk.js. The server sends ledge_state only to a desk's owner
// client (the device the Director session runs on); a phone never hosts this window and hands the
// desk to window.wmLedge instead.

const ledgeWindows = new Map();
// the desks this client holds, kept from ledge_state (full desks and deltas on top of them)
const ledgeDesks = new Map();
let ledgeQueue = Promise.resolve();
// Vista art for the balloons (.cursor/rules/vista-icons-not-fa.mdc)
const LEDGE_TOAST_ICONS = {
    saved: '<img src="/static_images/vista-icons/info-32.png" width="32" height="32" alt="">',
    error: '<img src="/static_images/vista-icons/error-32.png" width="32" height="32" alt="">'
};
let ledgeMenuImage = null;
let ledgeItemMenu = null;

function ledgeSendChecks(sessionId, host) {
    const checked = [];
    host.querySelectorAll('.gallery-item').forEach((item) => {
        const box = item.querySelector('.gallery-item-checkbox');
        if (box && box.checked && item.dataset.itemId) checked.push(item.dataset.itemId);
    });
    if (!window.wsClient || !window.wsClient.isConnected()) return;
    window.wsClient.send({
        type: 'ledge_checks',
        requestId: Date.now().toString(),
        sessionId,
        checked
    });
}

function ledgeImageForItem(item) {
    if (!item) return null;
    const filename = item.dataset.filename || item.dataset.stageFilename || '';
    if (!filename) return null;
    // findImageByFilename: public/scripts/comp/galleryView.js
    const known = typeof findImageByFilename === 'function' ? findImageByFilename(filename) : null;
    return known || { filename, original: filename };
}

function ledgeItemMenuConfig() {
    if (ledgeItemMenu) return ledgeItemMenu;
    // createManualPreviewImageContextMenuConfig: public/scripts/comp/manualModalManager.js
    const config = createManualPreviewImageContextMenuConfig();
    // The menu is the Studio preview's; it reads window.currentManualPreviewImage for its states,
    // which is the Studio's picture and must stay so (a right-click here used to replace it, so
    // the Studio's own commands then acted on the Ledge card). Its readers are pointed at the card.
    config.beforeShow = (_event, target) => {
        const item = target && target.closest ? target.closest('.gallery-item') : null;
        ledgeMenuImage = ledgeImageForItem(item);
    };
    config.sections.forEach((section) => {
        if (section.items) {
            // getImageGenerationTransparencySubmenu: public/scripts/comp/imageGenerationSettings.js
            section.items = section.items.filter((menuItem) => menuItem.optionsfn !== getImageGenerationTransparencySubmenu);
            section.items.forEach((menuItem, index) => {
                if (menuItem.action === 'view-image-data') menuItem.disabled = () => !ledgeMenuImage;
                if (menuItem.text === 'Original') {
                    // buildUnupscaledOriginalContextMenuItem: public/scripts/comp/galleryView.js
                    section.items[index] = buildUnupscaledOriginalContextMenuItem(() => ledgeMenuImage);
                }
            });
        }
        if (!section.icons) return;
        section.icons.forEach((icon) => {
            if (icon.action !== 'toggle-favorite') return;
            icon.loadfn = (menuItem) => {
                const image = ledgeMenuImage;
                const filename = image && (image.filename || image.original || image.upscaled);
                // checkIfImageIsPinned: public/scripts/comp/galleryView.js
                const pinned = filename ? checkIfImageIsPinned(filename) : false;
                menuItem.icon = pinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
                menuItem.tooltip = pinned ? 'Unfavorite' : 'Favorite';
            };
        });
    });
    config.onAction = (action, target, item) => {
        // stageResultIsImageAction: public/scripts/comp/stageResultsReview.js
        if (stageResultIsImageAction(action)) {
            // stageResultsReviewManager.runImageAction: public/scripts/comp/stageResultsReview.js
            void stageResultsReviewManager.runImageAction(action, target);
            return;
        }
        // handleImageGenerationSettingsMenuAction: public/scripts/comp/imageGenerationSettings.js
        handleImageGenerationSettingsMenuAction(action, target, item);
    };
    ledgeItemMenu = config;
    return config;
}

function ledgeActionButton(iconClass, title, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary round-button';
    btn.title = title;
    btn.innerHTML = `<i class="${iconClass}"></i>`;
    btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick(event);
    });
    return btn;
}

function ledgeEncodeJson(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 2));
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
}

async function ledgeSave(host) {
    const sessionId = host.dataset.sessionId || 'ledge';
    const items = [];
    host.querySelectorAll('.gallery-item').forEach((card, index) => {
        const box = card.querySelector('.gallery-item-checkbox');
        items.push({
            index,
            id: card.dataset.itemId || '',
            filename: card.dataset.filename || '',
            text: card.dataset.note || '',
            checked: !!(box && box.checked)
        });
    });
    const name = `ledge-${sessionId}.json`;
    try {
        // vfsClient.resolvePath / uploadFile: public/scripts/comp/vfsClient.js
        const folder = await vfsClient.resolvePath('@desktop');
        const saved = await vfsClient.uploadFile(folder, ledgeEncodeJson({
            kind: 'ledge-session',
            sessionId,
            name: host.dataset.sessionName || '',
            items
        }), name, 'application/json');
        if (saved && saved.success === false) throw new Error(saved.error || 'Save failed');
        showGlassToast('success', null, `Saved ${name} to the desktop`, false, 2500, LEDGE_TOAST_ICONS.saved);
    } catch (err) {
        showGlassToast('error', null, (err && err.message) || 'Could not save this desk', false, 3000, LEDGE_TOAST_ICONS.error);
    }
}

function ledgeWireWindow(host) {
    const closeBtn = host.querySelector('.ledge-desk-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            // closeModal: public/scripts/comp/modalUtils.js
            closeModal(host);
        });
    }
    // Save sits on the floating bar (the Workspace window's design), not in a caption menu
    const saveBtn = host.querySelector('.ledge-desk-save');
    if (saveBtn) saveBtn.addEventListener('click', () => void ledgeSave(host));
}

function ledgeReflow(host) {
    const shell = host.querySelector('.stage-results-scroll-shell');
    if (!shell || typeof customScrollbar === 'undefined') return;
    // customScrollbar.forceReinit: public/scripts/comp/customScrollbar.js
    setTimeout(() => customScrollbar.forceReinit(shell), 0);
}

function ledgeRender(host, session) {
    const title = host.querySelector('.ledge-desk-title');
    host.dataset.sessionName = session.name || '';
    if (title) title.textContent = session.name ? `Ledge [${session.name}]` : 'Ledge';
    // the floating bar's "Ledge • <name>", as the Workspace window's "Dreamscape • <workspace>"
    const barName = host.querySelector('.ledge-desk-name');
    if (barName) barName.textContent = session.name || 'Desk';
    const gallery = host.querySelector('.gallery');
    if (!gallery) return;
    // Cards are kept by item id while their picture and note are the same: an add or remove used
    // to rebuild every card, reloading every picture and resetting the scroll position
    const existing = new Map();
    gallery.querySelectorAll('.gallery-item').forEach((card) => {
        if (card.dataset.itemId) existing.set(card.dataset.itemId, card);
    });
    const cards = (session.items || []).map((item) => {
        const kept = item.id ? existing.get(item.id) : null;
        if (kept && kept.dataset.key === ledgeItemKey(item)) {
            existing.delete(item.id);
            ledgeSetCardChecked(kept, item.checked === true);
            return kept;
        }
        return ledgeBuildCard(host, session, item);
    });
    gallery.replaceChildren(...cards);
    ledgeReflow(host);
}

function ledgeItemKey(item) {
    return `${item.filename || ''}\n${item.src || ''}\n${item.text || ''}`;
}

function ledgeSetCardChecked(card, checked) {
    const box = card.querySelector('.gallery-item-checkbox');
    if (box) box.checked = checked;
    card.classList.toggle('selected', checked);
}

/** Someone checked a card (here or in another tab): the boxes follow, nothing is rebuilt. */
function ledgeSyncChecks(host, session) {
    const checked = new Set(Array.isArray(session.checked)
        ? session.checked
        : (session.items || []).filter((item) => item.checked).map((item) => item.id));
    host.querySelectorAll('.gallery-item').forEach((card) => {
        ledgeSetCardChecked(card, checked.has(card.dataset.itemId));
    });
}

function ledgeBuildCard(host, session, item) {
    const filename = item.filename || '';
    const card = document.createElement('div');
    card.dataset.key = ledgeItemKey(item);
    card.className = 'gallery-item fade-in';
    card.dataset.itemId = item.id || '';
    card.dataset.filename = filename;
    card.dataset.stageFilename = filename;
    card.dataset.note = item.text || '';
    if (item.checked) card.classList.add('selected');

    const picture = document.createElement('img');
    picture.alt = item.text || filename || 'Item';
    picture.decoding = 'async';
    picture.loading = 'lazy';
    if (item.src) {
        picture.src = item.src;
    } else if (filename) {
        // the Studio preview WebP at the picture's own size (#648), the PNG only when there is none
        // localGalleryImageUrl / studioPreviewDisplayUrl: public/scripts/comp/assetUrlResolver.js
        const full = localGalleryImageUrl(filename);
        picture.addEventListener('error', () => {
            if (!picture.src.endsWith(full)) picture.src = full;
        }, { once: true });
        picture.src = studioPreviewDisplayUrl(full);
    }

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'gallery-item-checkbox';
    box.checked = item.checked === true;
    box.title = 'Mark this item';
    box.addEventListener('click', (event) => event.stopPropagation());
    box.addEventListener('change', () => {
        card.classList.toggle('selected', box.checked);
        ledgeSendChecks(session.sessionId, host);
    });

    const overlay = document.createElement('div');
    overlay.className = 'gallery-item-overlay';
    const label = document.createElement('div');
    label.className = 'gallery-item-title';
    label.textContent = item.text || filename || 'Item';
    const info = document.createElement('div');
    info.className = 'gallery-item-info';
    info.textContent = item.text ? filename : '';
    overlay.append(label, info);

    const actions = document.createElement('div');
    actions.className = 'gallery-actions';
    const image = ledgeImageForItem(card);
    actions.append(
        ledgeActionButton('fas fa-arrow-left', 'Modify', () => {
            const known = ledgeImageForItem(card);
            if (!known) return;
            // openManualModalWithContent: public/scripts/comp/manualModalManager.js
            openManualModalWithContent({ type: 'image', image: known });
        }),
        ledgeActionButton('fa-regular fa-star', 'Favorite', () => {
            const known = ledgeImageForItem(card);
            if (!known) return;
            const pinBtn = actions.querySelector('.ledge-pin');
            // togglePinImage / checkIfImageIsPinned / applyPinButtonState: public/scripts/comp/galleryView.js
            togglePinImage(known, pinBtn).then(() => {
                const pinned = checkIfImageIsPinned(known.filename || known.original);
                applyPinButtonState(pinBtn, pinned);
                pinBtn.title = pinned ? 'Unfavorite' : 'Favorite';
            });
        }),
        ledgeActionButton('fas fa-download', 'Download', () => {
            const known = ledgeImageForItem(card);
            if (!known) return;
            // downloadImage: public/scripts/comp/galleryView.js
            downloadImage({ filename: known.filename, original: known.original || known.filename, upscaled: known.upscaled });
        })
    );
    const pinBtn = actions.children[1];
    pinBtn.classList.add('ledge-pin');
    if (image) {
        const pinned = checkIfImageIsPinned(image.filename || image.original);
        applyPinButtonState(pinBtn, pinned);
        pinBtn.title = pinned ? 'Unfavorite' : 'Favorite';
    }
    overlay.appendChild(actions);

    card.addEventListener('click', (event) => {
        if (event.target.closest('.gallery-item-checkbox, .gallery-actions')) return;
        if (!filename) return;
        const known = ledgeImageForItem(card);
        // openGalleryImageInViewer: public/scripts/comp/imageViewer.js
        openGalleryImageInViewer(known || { filename, original: filename });
    });
    card.append(picture, box, overlay);
    if (contextMenu) contextMenu.attachToElement(card, ledgeItemMenuConfig());
    return card;
}

function ledgeCloneTemplate() {
    const template = document.getElementById('ledgeDeskTemplate');
    if (!template || !template.content || !template.content.firstElementChild) return null;
    return template.content.firstElementChild.cloneNode(true);
}

function ledgeEnsureWindow(session) {
    const id = session && session.sessionId;
    if (!id || ledgeIsPhone()) return null;
    let host = ledgeWindows.get(id);
    if (host && host.isConnected) {
        ledgeRender(host, session);
        // openModal / bringModalToFront: public/scripts/comp/modalUtils.js
        openModal(host);
        bringModalToFront(host);
        return host;
    }
    host = ledgeCloneTemplate();
    if (!host) return null;
    host.id = `ledgeDesk_${id}`;
    host.dataset.windowIdentifier = `ledge-${id}`;
    host.dataset.sessionId = id;
    document.body.appendChild(host);
    ledgeWireWindow(host);
    ledgeWindows.set(id, host);
    ledgeRender(host, session);
    openModal(host);
    bringModalToFront(host);
    return host;
}

function ledgeClose(sessionId) {
    const host = ledgeWindows.get(sessionId);
    if (!host) return;
    closeModal(host);
    host.remove();
    ledgeWindows.delete(sessionId);
}

function ledgeIsPhone() {
    return window.uiShell === 'mobile' || document.documentElement.classList.contains('ui-mobile');
}

/** The server addresses the owner client only; a packet naming another client is not for this one. */
function ledgeIsOwner(data) {
    let mine = null;
    try {
        // WebSocketClient.readStoredAgentClientId: public/scripts/websocket.js
        mine = typeof WebSocketClient !== 'undefined' ? WebSocketClient.readStoredAgentClientId() : null;
    } catch (_) {
        mine = null;
    }
    return !data.ownerClientId || !mine || data.ownerClientId === mine;
}

function ledgeIndexItems(desk) {
    desk.items.forEach((item, index) => { item.index = index; });
    desk.count = desk.items.length;
    desk.checked = desk.items.filter((item) => item.checked).map((item) => item.id);
}

function ledgeKeep(data) {
    const desk = Object.assign({}, data, { items: (data.items || []).map((item) => Object.assign({}, item)) });
    delete desk.present;
    ledgeIndexItems(desk);
    ledgeDesks.set(desk.sessionId, desk);
    return desk;
}

async function ledgeFetch(sessionId) {
    if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function') return null;
    const reply = await window.wsClient.sendMessage('ledge_get', { sessionId }, false);
    const data = reply && reply.data && typeof reply.data === 'object' ? reply.data : reply;
    return data && data.success && data.session ? ledgeKeep(data.session) : null;
}

/** The whole desk after this packet: a full desk replaces, a delta applies on the rev it builds on. */
async function ledgeMerge(data) {
    const id = data.sessionId;
    if (data.disposed || data.reason === 'dispose') {
        ledgeDesks.delete(id);
        return { sessionId: id, disposed: true };
    }
    if (Array.isArray(data.items)) return ledgeKeep(data);
    const desk = ledgeDesks.get(id);
    // not held here, or a change was missed (another client was the owner meanwhile): the whole desk
    if (!desk || desk.rev !== data.baseRev) return ledgeFetch(id);
    if (data.reason === 'add') {
        const trimmed = new Set(data.trimmed || []);
        const items = desk.items.filter((item) => !trimmed.has(item.id));
        (data.added || []).forEach((item) => {
            items.splice(Math.min(item.index, items.length), 0, Object.assign({}, item));
        });
        desk.items = items;
    } else if (data.reason === 'remove' && data.removed) {
        desk.items = desk.items.filter((item) => item.id !== data.removed.id);
    } else if (data.reason === 'checks') {
        const on = new Set(data.checked || []);
        desk.items.forEach((item) => { item.checked = on.has(item.id); });
    } else if (data.reason === 'clear') {
        desk.items = [];
    }
    ['name', 'workspaceId', 'kind', 'chatId', 'rev', 'updatedAt', 'ownerClientId'].forEach((key) => {
        if (data[key] !== undefined) desk[key] = data[key];
    });
    ledgeIndexItems(desk);
    return desk;
}

function ledgeShow(desk, data) {
    if (!desk) return;
    if (ledgeIsPhone()) {
        // Melaton Mobile shows desks its own way (wmLedge); the desktop window is never hosted here
        const phone = window.wmLedge;
        if (phone && typeof phone.present === 'function') phone.present(desk, data);
        return;
    }
    if (desk.disposed) {
        ledgeClose(desk.sessionId);
        return;
    }
    if (data.present) {
        ledgeEnsureWindow(desk);
        return;
    }
    const host = ledgeWindows.get(desk.sessionId);
    if (!host) return;
    if (data.reason === 'checks') ledgeSyncChecks(host, desk);
    else ledgeRender(host, desk);
}

function presentLedge(data) {
    if (!data || !data.sessionId || !ledgeIsOwner(data)) return;
    // in order: a delta must not apply before the fetch of the desk it builds on
    ledgeQueue = ledgeQueue
        .then(() => ledgeMerge(data))
        .then((desk) => ledgeShow(desk, data))
        .catch((err) => console.warn('[ledge]', (err && err.message) || err));
}

if (window.wsClient && window.wsClient.on) {
    window.wsClient.on('ledge_state', (packet) => {
        presentLedge((packet && packet.data) || packet || {});
    });
}
