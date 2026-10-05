// Ledge: one stage-results window per session, cloned from #ledgeDeskTemplate.
// Server sessions live in modules/ledgeDesk.js.

const ledgeWindows = new Map();
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
    config.beforeShow = (_event, target) => {
        const item = target && target.closest ? target.closest('.gallery-item') : null;
        ledgeMenuImage = ledgeImageForItem(item);
        if (ledgeMenuImage) window.currentManualPreviewImage = ledgeMenuImage;
    };
    config.sections.forEach((section) => {
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
        const galleryItem = target && target.closest ? target.closest('.gallery-item') : null;
        const image = ledgeImageForItem(galleryItem);
        if (image) window.currentManualPreviewImage = image;
        // studioIsPreviewMenuAction: public/scripts/comp/imageGenerationSettings.js
        if (studioIsPreviewMenuAction(action)) {
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
        showGlassToast('success', null, `Saved ${name} to the desktop`, false, 2500, '<i class="fas fa-check"></i>');
    } catch (err) {
        showGlassToast('error', null, (err && err.message) || 'Could not save this desk', false, 3000, '<i class="fas fa-xmark"></i>');
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
    const menuBtn = host.querySelector('.ledge-desk-menu');
    if (menuBtn && contextMenu) {
        contextMenu.attachClickMenuToElement(menuBtn, {
            position: 'anchor',
            anchorAlign: 'end',
            sections: [{
                type: 'list',
                items: [{ text: 'Save', icon: 'fas fa-floppy-disk', action: 'ledge-save' }]
            }],
            onAction: (action) => {
                if (action === 'ledge-save') void ledgeSave(host);
            }
        });
    }
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
    const gallery = host.querySelector('.gallery');
    if (!gallery) return;
    gallery.replaceChildren();
    (session.items || []).forEach((item) => {
        const filename = item.filename || '';
        const card = document.createElement('div');
        card.className = 'gallery-item fade-in';
        card.dataset.itemId = item.id || '';
        card.dataset.filename = filename;
        card.dataset.stageFilename = filename;
        card.dataset.note = item.text || '';
        if (item.checked) card.classList.add('selected');

        const picture = document.createElement('img');
        // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        picture.src = item.src || (filename ? localGalleryImageUrl(filename) : '');
        picture.alt = item.text || filename || 'Item';

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
        gallery.appendChild(card);
    });
    ledgeReflow(host);
}

function ledgeCloneTemplate() {
    const template = document.getElementById('ledgeDeskTemplate');
    if (!template || !template.content || !template.content.firstElementChild) return null;
    return template.content.firstElementChild.cloneNode(true);
}

function ledgeEnsureWindow(session) {
    const id = session && session.sessionId;
    if (!id) return null;
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

function presentLedge(data) {
    if (!data) return;
    if (data.disposed || data.reason === 'dispose') {
        ledgeClose(data.sessionId);
        return;
    }
    if (!data.sessionId) return;
    if (data.reason === 'checks') {
        const host = ledgeWindows.get(data.sessionId);
        if (host) ledgeRender(host, data);
        return;
    }
    ledgeEnsureWindow(data);
}

if (window.wsClient && window.wsClient.on) {
    window.wsClient.on('ledge_state', (packet) => {
        presentLedge((packet && packet.data) || packet || {});
    });
}
