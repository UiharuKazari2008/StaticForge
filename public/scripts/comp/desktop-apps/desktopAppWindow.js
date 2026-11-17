// Shared helper for desktop-app windows (Yozora #642): used by the Melaton app packages (Calculator,
// Alarm) and any other desktop app. Loaded globally from app.html, so every app can size its window
// the same way, whether it is in the monolith or a package. Previously it lived inside calculator.js.

// Measures the window's natural (hug) height at its default width and records it as the default
// and minimum height. The stretching parts are frozen for the measure; a fixed layout (the Vista
// calculator: every row and key has its pixel size) passes fixed = true so only the window and its
// client are unfrozen and the keys keep their size.
function desktopAppApplyContentHeight(modal, fixed) {
    // beginModalLayoutMeasure / endModalLayoutMeasure: public/scripts/comp/modalUtils.js
    const width = parseInt(modal.dataset.windowDefaultWidth, 10);
    const state = beginModalLayoutMeasure(modal);
    const content = modal.querySelector('.modal-content');
    const freeze = [modal];
    if (content) {
        freeze.push(content);
        const stretching = fixed ? '.modal-body, .form-col' : '.modal-body, .form-col, .form-section, .form-row, .form-group, .form-control, button, h2, h3';
        content.querySelectorAll(stretching).forEach((node) => {
            freeze.push(node);
        });
    }
    const saved = freeze.map((node) => ({
        node: node,
        flex: node.style.flex,
        height: node.style.height,
        maxHeight: node.style.maxHeight
    }));
    const previousWidth = modal.style.width;
    if (width > 0) modal.style.width = width + 'px';
    saved.forEach((item) => {
        item.node.style.flex = '0 0 auto';
        item.node.style.height = 'auto';
        item.node.style.maxHeight = 'none';
    });
    // offsetHeight: the open animation scales the window, a client rect would read the scaled box.
    // The client's scrollHeight is its content's real extent even when the frame is constrained
    // mid-boot (a top/bottom anchored box) and the client's flex children shrank into it.
    void modal.offsetHeight;
    const hug = content ? modal.offsetHeight - content.offsetHeight + content.scrollHeight : modal.offsetHeight;
    if (previousWidth) modal.style.width = previousWidth;
    else modal.style.removeProperty('width');
    saved.forEach((item) => {
        if (item.flex) item.node.style.flex = item.flex;
        else item.node.style.removeProperty('flex');
        if (item.height) item.node.style.height = item.height;
        else item.node.style.removeProperty('height');
        if (item.maxHeight) item.node.style.maxHeight = item.maxHeight;
        else item.node.style.removeProperty('max-height');
    });
    endModalLayoutMeasure(modal, state);
    if (hug >= 80) {
        modal.dataset.windowDefaultHeight = String(hug);
        modal.dataset.windowMinHeight = String(hug);
    }
}

/**
 * A built-in desktop program's window (`app` kind: the light client with the kit's controls), for
 * programs that are not packages (they must work offline, e.g. the Nightshade Network Client, #895)
 * until the shared openWindow lands (#851 slice 3). Writes the caption with the image icon, the
 * caption buttons, the focus overlay and the client; the caller fills the client and opens it.
 *   desktopAppCreateWindow({ id, identifier, title, icon16, taskbarIcon, className, fixed, minimize })
 *   -> { modal, content, close } (content: .modal-content.win7, empty; close: the caption's X)
 */
function desktopAppCreateWindow(opts) {
    const o = opts || {};
    const modal = document.createElement('div');
    modal.id = o.id;
    modal.className = `modal hidden${o.className ? ` ${o.className}` : ''}`;
    modal.dataset.windowIdentifier = o.identifier || o.id;
    modal.dataset.windowClient = 'light';
    if (o.fixed) {
        modal.dataset.windowFixedSize = 'true';
        modal.dataset.windowRestoreSize = 'false';
    }
    if (o.taskbarIcon) modal.dataset.taskbarIcon = o.taskbarIcon;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', o.title || '');
    const title = document.createElement('div');
    title.className = 'modal-window-title';
    const main = document.createElement('div');
    main.className = 'modal-window-title-main';
    const img = document.createElement('img');
    img.className = 'icon-image';
    img.alt = '';
    img.src = o.icon16 || '/static_images/vista-icons/application-48.png';
    const text = document.createElement('span');
    text.textContent = o.title || '';
    main.append(img, text);
    title.appendChild(main);
    const focus = document.createElement('div');
    focus.className = 'modal-focus-overlay';
    const controls = document.createElement('div');
    controls.className = 'modal-window-controls';
    const button = (cls, label, glyph) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.title = label;
        const i = document.createElement('i');
        i.className = glyph;
        b.appendChild(i);
        return b;
    };
    if (o.minimize) controls.appendChild(button('btn-secondary minimize-btn btn-small', 'Minimize', 'fa-regular fa-window-minimize'));
    const close = button('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
    controls.appendChild(close);
    const content = document.createElement('div');
    content.className = 'modal-content win7';
    modal.append(title, focus, controls, content);
    document.body.appendChild(modal);
    return { modal, content, close };
}
window.desktopAppCreateWindow = desktopAppCreateWindow;
