/**
 * Control Panel (Yozora #428, #429): a Vista Explorer-style window in Classic View (a flat icon
 * list, no categories) that settings move into over time, and the network tray icon's UI.
 *
 *   Network and Server Center   Vista's Network and Sharing Center for a PC joined to the
 *                               Dreamscape domain: the map This computer — <domain> — Internet,
 *                               the domain network box (Access, Connection = <connection name> +
 *                               View status, Customize = the network (domain) name) and the
 *                               server's own status from the public OPTIONS /status
 *   <connection> Status         Vista's Local Area Connection Status: device '<WAN|Ethernet>
 *                               Miniport (L-PPoP)', duration, latency, messages sent / received
 *   Tray flyout                 one click on the network tray icon: "Currently connected to:"
 *                               the domain network and the VPN connection, Connect or disconnect,
 *                               Network and Server Center; right-click = the tray menu
 *
 *   melatonControlPanel.open(page = 'home')    'home' | 'network'
 *   melatonControlPanel.registerItem({ id, name, icon, image, description, open })
 *   melatonControlPanel.registerPage(id, { title(), tasks(), body(), mount(main)?, unmount()?, parent? })
 *       parent: the page a subpage sits under, shown between Control Panel and it in the address
 *       a page that hosts live DOM (Personalization, Global Settings: the desktop settings forms,
 *       modalUtils.js) moves it in on mount and back out on unmount, before every re-render and
 *       when the window closes, so the forms keep their handlers
 *   melatonControlPanel.toggleTrayFlyout(anchor) / attachTrayMenu(anchor)
 *
 * Names: config.json userGlobalSettings.desktop.domainName (the network / domain, default
 * DREAMSCAPE) and desktop.connectionName (the interface, default VPN Connection), saved through
 * persistUserGlobalSettingsPatch (modalUtils.js); connection facts: melatonNetworkDialogs.js.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const STATUS_POLL_MS = 5000;
    const LIVE_TICK_MS = 1000;

    const items = [];
    const pages = {};
    let modal = null;
    let current = null;
    let mountedPage = null; // the page whose mount() ran last (unmount before the next render)
    const back = [];
    const forward = [];
    let liveTimer = null;
    let statusTimer = null;
    let lastStatus = null;   // last OPTIONS /status JSON
    let statusError = false; // last poll failed
    let statusModal = null;
    let statusTimerId = null;
    let customizeModal = null;

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function net() {
        return root.melatonNetworkDialogs || null;
    }

    function info() {
        const n = net();
        return n
            ? n.connectionInfo()
            : { domain: 'DREAMSCAPE', connectionName: 'VPN Connection', fqdn: root.location.hostname, connectionType: 'WAN', device: 'L-PPoP' };
    }

    function ws() {
        return root.wsClient || null;
    }

    function formatDuration(ms) {
        const total = Math.max(0, Math.floor((ms || 0) / 1000));
        const days = Math.floor(total / 86400);
        const h = String(Math.floor((total % 86400) / 3600)).padStart(2, '0');
        const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
        const s = String(total % 60).padStart(2, '0');
        return days > 0 ? `${days}.${h}:${m}:${s}` : `${h}:${m}:${s}`;
    }

    /** 'connected' | 'connecting' | 'auth' | 'disconnected' */
    function linkState() {
        const client = ws();
        if (!client) return 'disconnected';
        if (client.connectionPhase === 'auth') return 'auth';
        if (client.isConnected && client.isConnected()) return 'connected';
        if (client.isConnecting || client.connectionPhase === 'dialing') return 'connecting';
        return 'disconnected';
    }

    // ---- items (Classic View) ------------------------------------------------------------

    function registerItem(item) {
        if (!item || !item.id || items.some((i) => i.id === item.id)) return;
        items.push(item);
        items.sort((a, b) => a.name.localeCompare(b.name));
        if (modal && current === 'home') render();
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        if (typeof fn === 'function') return fn(...args);
        return undefined;
    }

    registerItem({
        id: 'network',
        name: 'Network and Server Center',
        image: '/static_images/melaton/net-globe.png',
        description: 'Check the connection to the domain and the server status.',
        open: () => navigate('network')
    });
    registerItem({
        id: 'personalization',
        name: 'Personalization',
        image: '/static_images/app_icons/64/vista-personalization.webp',
        description: 'Personalize appearance and sounds: window colour, desktop background, screen saver, sounds and theme.',
        open: () => navigate('personalization')
    });
    // Personalization's own pages and dialogs (cplPersonalization.js); Appearance Settings and
    // Keyboard host one group of the global settings forms each (modalUtils.js)
    registerItem({
        id: 'appearance',
        name: 'Window Color and Appearance',
        image: '/static_images/app_icons/64/vista-appearance.webp',
        description: 'Fine tune the color and style of your windows.',
        open: () => navigate(pages['window-color'] ? 'window-color' : 'appearance')
    });
    registerItem({
        id: 'sound',
        name: 'Sound',
        image: '/static_images/app_icons/64/vista-sound.webp',
        description: 'Change which sounds are heard for each event, or turn them off.',
        // Vista opens the Sound dialog's Sounds tab (personalizationDialogs.js)
        open: () => (root.personalizationDialogs ? root.personalizationDialogs.openSound() : navigate('sound'))
    });
    registerItem({
        id: 'taskbar',
        name: 'Taskbar and Start Menu',
        image: '/static_images/app_icons/64/vista-taskbar.webp',
        description: 'Customize the Start menu and the taskbar, such as the types of items to be displayed and how they should appear.',
        // Vista opens "Taskbar and Start Menu Properties" from here (public/scripts/comp/taskbarSettings.js)
        open: () => (root.taskbarSettings ? root.taskbarSettings.openProperties('taskbar') : undefined)
    });
    registerItem({
        id: 'keyboard',
        name: 'Keyboard',
        image: '/static_images/app_icons/64/vista-keyboard.webp',
        description: 'The virtual keyboard on touch devices.',
        // Vista's Keyboard Properties (cplDialogs.js); the on-screen keyboard page is under Ease of Access
        open: () => (root.cplDialogs ? doAction('dialog:keyboard') : navigate('keyboard'))
    });
    registerItem({
        id: 'remote-access',
        name: 'Remote Access',
        image: '/static_images/app_icons/64/vista-remote-desktop.webp',
        description: 'Choose how agents deliver and open images on this computer.',
        // Remote Access Properties (remoteAccessProperties.js), as Vista opens System Properties' Remote tab
        open: () => { if (root.remoteAccessProperties) root.remoteAccessProperties.open(); }
    });
    registerItem({
        id: 'system',
        name: 'System',
        image: '/static_images/app_icons/64/vista-system.webp',
        description: 'View basic information about your computer: the edition, the server host, the session and activation.',
        // the page is cplSystem.js (Vista's System); without it, the About box as before
        open: () => (pages.system ? navigate('system') : callGlobal('openAboutMelatoninModal'))
    });
    registerItem({
        id: 'runes',
        name: 'Runes',
        image: '/static_images/app_icons/64/vista-regedit.webp',
        description: 'Edit the server configuration directly.',
        open: async () => {
            /* global featureLoader, configEditorApplet */
            if (typeof featureLoader === 'undefined') return;
            await featureLoader.loadFeature('config_editor');
            if (typeof configEditorApplet !== 'undefined') configEditorApplet.open();
        }
    });
    registerItem({
        id: 'dreamscape-services',
        name: 'Management Tools',
        image: '/static_images/vista-cpl/management-tools-32.png',
        description: 'Data management, security and the other Dreamscape service pages.',
        open: () => callGlobal('openDsapInGrimoire', 'dsap://dreamscape.jp/')
    });

    // ---- window ----------------------------------------------------------------------------

    function el(selector) {
        return modal ? modal.querySelector(selector) : null;
    }

    function ensureModal() {
        if (modal || !doc) return modal;
        modal = doc.createElement('div');
        modal.id = 'melatonControlPanelModal';
        modal.className = 'modal hidden resizeable-window toolbar-visible control-panel-window';
        modal.dataset.windowIdentifier = 'melatonControlPanel';
        modal.dataset.windowMinWidth = '640';
        modal.dataset.windowMinHeight = '420';
        modal.dataset.windowDefaultWidth = '880';
        modal.dataset.windowDefaultHeight = '600';
        modal.dataset.windowMaxWidth = '1600';
        modal.dataset.windowMaxHeight = '1100';
        modal.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main">
                    <i class="fas fa-sliders icon-fa"></i>
                    <img src="/static_images/app_icons/24/vista-control-panel.webp" srcset="/static_images/app_icons/24/vista-control-panel.webp 1x, /static_images/app_icons/48/vista-control-panel.webp 2x" alt="" class="icon-image">
                    <span class="cpl-window-title">Control Panel</span>
                </div>
                <div class="modal-window-title-toolbar">
                    <div class="button-group naxt-nav-group">
                        <button type="button" class="btn-secondary toolbar-input-segment cpl-back" title="Back"><i class="fas fa-arrow-left"></i></button>
                        <button type="button" class="btn-secondary toolbar-input-segment cpl-forward" title="Forward"><i class="fas fa-arrow-right"></i></button>
                        <button type="button" class="btn-secondary toolbar-input-segment explorer-recent-pages-btn cpl-recent" title="Recent Pages" aria-label="Recent Pages"></button>
                    </div>
                    <div class="button-group cpl-address-group">
                        <div class="form-control colored toolbar-input-segment cpl-address" role="navigation" aria-label="Address"></div>
                        <button type="button" class="btn-secondary toolbar-input-segment cpl-refresh" title="Refresh"><i class="fas fa-sync"></i></button>
                    </div>
                    <div class="button-group">
                        <input type="text" class="form-control colored toolbar-input-segment cpl-search" placeholder="Search"
                            spellcheck="false" autocapitalize="off" autocorrect="off">
                    </div>
                </div>
            </div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                <button type="button" class="btn-danger close-btn btn-small cpl-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content dark cpl-content win7">
                <aside class="cpl-tasks"></aside>
                <section class="cpl-main"></section>
            </div>`;
        doc.body.appendChild(modal);
        el('.cpl-back').addEventListener('click', goBack);
        el('.cpl-forward').addEventListener('click', goForward);
        el('.cpl-recent').addEventListener('mousedown', (ev) => recentPagesMenu(ev));
        el('.cpl-refresh').addEventListener('click', () => {
            if (current === 'network') pollStatus();
            render();
        });
        el('.cpl-close').addEventListener('click', close);
        el('.cpl-search').addEventListener('input', () => {
            if (current !== 'home') navigate('home');
            else render();
        });
        // One delegated click for links in the task pane, the address bar and the page
        modal.addEventListener('click', (ev) => {
            const target = ev.target.closest('[data-cpl-action]');
            if (!target || !modal.contains(target)) return;
            ev.preventDefault();
            runAction(target.dataset.cplAction, target.dataset.cplArg);
        });
        modal.addEventListener('keydown', (ev) => {
            const item = ev.target.closest && ev.target.closest('[data-cpl-item]');
            if (item && ev.key === 'Enter') {
                ev.preventDefault();
                openItem(item.dataset.cplItem);
            }
            if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); goBack(); }
            if (ev.altKey && ev.key === 'ArrowRight') { ev.preventDefault(); goForward(); }
        });
        return modal;
    }

    function openItem(id) {
        const item = items.find((i) => i.id === id);
        if (item && typeof item.open === 'function') {
            item.open();
            return;
        }
        // an item only the catalog has (cplCatalog.js): its open is an action string
        const c = root.cplCatalog && root.cplCatalog.ITEMS.find((i) => i.id === id);
        if (c && c.open) doAction(c.open);
    }

    function runAction(action, arg) {
        switch (action) {
            case 'nav': navigate(arg); break;
            case 'item': openItem(arg); break;
            // one click opens an item (Yukimi: Classic View's double-click felt like nothing happened)
            case 'open': {
                const node = el(`[data-cpl-item="${arg}"]`);
                modal.querySelectorAll('.cpl-icon.selected').forEach((n) => n.classList.remove('selected'));
                if (node) node.classList.add('selected');
                openItem(arg);
                break;
            }
            case 'select': {
                const node = el(`[data-cpl-item="${arg}"]`);
                modal.querySelectorAll('.cpl-icon.selected').forEach((n) => n.classList.remove('selected'));
                if (node) { node.classList.add('selected'); node.focus(); }
                // one click opens (Yukimi: Classic View's double-click felt like nothing happened)
                openItem(arg);
                break;
            }
            case 'do': doAction(arg); break;
            case 'view-category':
                setView(true);
                el('.cpl-search').value = '';
                navigate('home', { replace: current === 'home' });
                break;
            case 'view-classic':
                setView(false);
                el('.cpl-search').value = '';
                navigate('home', { replace: current === 'home' });
                break;
            case 'sort':
                classicSort = classicSort.col === arg ? { col: arg, dir: -classicSort.dir } : { col: arg, dir: 1 };
                render();
                break;
            case 'connect': connectToDomain(); break;
            case 'disconnect': disconnectFromDomain(); break;
            case 'status': openStatusDialog(); break;
            case 'customize': openCustomizeDialog('network'); break;
            case 'rename': openCustomizeDialog('connection'); break;
            case 'diagnose': diagnose(); break;
            default: break;
        }
    }

    function open(page = 'home') {
        if (!ensureModal()) return;
        const wasHidden = modal.classList.contains('hidden');
        if (wasHidden) {
            back.length = 0;
            forward.length = 0;
            current = null;
        }
        navigate(page, { replace: wasHidden });
        if (typeof root.openModal === 'function') root.openModal(modal);
        else modal.classList.remove('hidden');
        startTimers();
    }

    function unmountPage() {
        if (mountedPage && typeof mountedPage.unmount === 'function') {
            try { mountedPage.unmount(); } catch (err) { console.error('Control Panel page unmount', err); }
        }
        mountedPage = null;
    }

    function close() {
        stopTimers();
        unmountPage();
        if (!modal) return;
        if (typeof root.closeModal === 'function') root.closeModal(modal);
        else modal.classList.add('hidden');
    }

    function navigate(page, { replace = false, fromHistory = false } = {}) {
        if (!pages[page]) page = 'home';
        if (current && current !== page && !replace && !fromHistory) {
            back.push(current);
            forward.length = 0;
        }
        if (page !== 'home') {
            const search = el('.cpl-search');
            if (search) search.value = '';
        }
        current = page;
        addressLoad(0.4);
        if (page === 'network') pollStatus();
        render();
        requestAnimationFrame(() => addressLoad(1));
    }

    /** Recent Pages ▾: the trail (back, current, forward) as Explorer's menu; a pick rewinds or advances. */
    function recentPagesMenu(ev) {
        const cm = root.contextMenu;
        const btn = el('.cpl-recent');
        if (!cm || !btn || btn.disabled) return;
        const trail = back.concat([current], forward.slice().reverse());
        const at = back.length;
        const items = trail.map((page, i) => ({
            text: (pages[page] && pages[page].title()) || page,
            icon: i === at ? 'fas fa-check' : '',
            action: `cpl-recent-${i}`
        })).reverse();
        cm.attachClickMenuToElement(btn, {
            sections: [{ type: 'list', items }],
            onAction: (action) => {
                const j = Number(String(action).replace('cpl-recent-', ''));
                if (!Number.isInteger(j) || j === at) return;
                back.length = 0; back.push(...trail.slice(0, j));
                forward.length = 0; forward.push(...trail.slice(j + 1).reverse());
                navigate(trail[j], { fromHistory: true });
            }
        });
        if (typeof cm.showMenu === 'function') cm.showMenu(ev, btn);
    }

    /** Vista's address-bar progress (green fill) while a page comes in. */
    function addressLoad(value) {
        const group = el('.cpl-address-group');
        if (!group) return;
        clearTimeout(addressLoad.timer);
        group.style.setProperty('--vista-load', `${Math.round(value * 100)}%`);
        if (value < 1) {
            group.setAttribute('data-vista-loading', '');
            return;
        }
        addressLoad.timer = setTimeout(() => {
            group.removeAttribute('data-vista-loading'); // fades out (vista-explorer.css)
            addressLoad.timer = setTimeout(() => {
                group.classList.add('vista-load-reset');
                group.style.setProperty('--vista-load', '0%');
                void group.offsetWidth; // flush with no transition before the class goes
                setTimeout(() => group.classList.remove('vista-load-reset'), 50);
            }, 400);
        }, 350);
    }

    function goBack() {
        if (!back.length) return;
        forward.push(current);
        navigate(back.pop(), { fromHistory: true });
    }

    function goForward() {
        if (!forward.length) return;
        back.push(current);
        navigate(forward.pop(), { fromHistory: true });
    }

    function render() {
        if (!modal || !current) return;
        const page = pages[current];
        el('.cpl-window-title').textContent = page.title();
        el('.cpl-back').disabled = back.length === 0;
        el('.cpl-forward').disabled = forward.length === 0;
        el('.cpl-recent').disabled = back.length === 0 && forward.length === 0;
        el('.cpl-address').innerHTML = renderAddress(page);
        el('.cpl-tasks').innerHTML = page.tasks();
        // a wrapped task-pane name: its row is 1 px shorter (cpl-catalog.css); measured once the
        // window shows (render runs before openModal on the first open)
        const markWrapped = () => el('.cpl-tasks').querySelectorAll('.cpl-nav > li').forEach((li) => {
            li.classList.toggle('is-wrapped', li.offsetHeight > 20);
        });
        markWrapped();
        requestAnimationFrame(markWrapped);
        unmountPage();
        const main = el('.cpl-main');
        main.innerHTML = page.body();
        if (typeof page.mount === 'function') {
            mountedPage = page;
            try { page.mount(main); } catch (err) { console.error('Control Panel page mount', err); }
        }
        modal.dataset.page = current;
        // a folder page (Printers, Fonts, Administrative Tools) has Explorer's panes (cplPages3.js)
        if (page.kind) modal.dataset.pageKind = page.kind;
        else delete modal.dataset.pageKind;
    }

    /** A page from outside (see the header): ids already taken are refused. */
    function registerPage(id, page) {
        if (!id || pages[id] || !page || typeof page.title !== 'function' || typeof page.body !== 'function') return false;
        pages[id] = { tasks: () => '', ...page };
        if (modal && current === id) render();
        return true;
    }

    /** Vista's address bar shows the page's own 16 px icon: Control Panel, the category, the item. */
    function addressIcon(page) {
        if (page && page.icon16) return page.icon16;
        const cat = root.cplCatalog;
        if (cat && current && current !== 'home') {
            const it = cat.ITEMS.find((i) => i.art && (i.id === current || i.open === `page:${current}`));
            if (it) return cat.art(it.art, 16);
        }
        return '/static_images/app_icons/16/vista-control-panel.webp';
    }

    function renderAddress(page) {
        const crumbs = [`<img class="cpl-address-icon cpl-address-img" src="${esc(addressIcon(page))}" alt="" draggable="false">`];
        crumbs.push('<span class="cpl-crumb-sep" aria-hidden="true">&#9656;</span>');
        crumbs.push(`<button type="button" class="cpl-crumb" data-cpl-action="nav" data-cpl-arg="home">Control Panel</button>`);
        if (current !== 'home') {
            // a subpage (parent: its page id) shows the trail through it, as Vista's
            // Control Panel > Personalization > Window Color and Appearance
            const trail = [];
            for (let id = page.parent; id && pages[id] && id !== 'home' && !trail.includes(id); id = pages[id].parent) trail.unshift(id);
            trail.forEach((id) => {
                crumbs.push('<span class="cpl-crumb-sep" aria-hidden="true">&#9656;</span>');
                crumbs.push(`<button type="button" class="cpl-crumb" data-cpl-action="nav" data-cpl-arg="${esc(id)}">${esc(pages[id].title())}</button>`);
            });
            crumbs.push('<span class="cpl-crumb-sep" aria-hidden="true">&#9656;</span>');
            crumbs.push(`<button type="button" class="cpl-crumb" data-cpl-action="nav" data-cpl-arg="${esc(current)}">${esc(page.title())}</button>`);
        }
        return crumbs.join('');
    }

    function taskLink(label, action, arg) {
        return `<li><button type="button" class="cpl-link" data-cpl-action="${action}"${arg ? ` data-cpl-arg="${esc(arg)}"` : ''}>${esc(label)}</button></li>`;
    }

    // ---- the catalog (cplCatalog.js): Category View, the category pages, Classic View --------

    const VIEW_KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Explorer\\ControlPanel';
    const SHIELD = '/static_images/vista-cpl/shield-uac-16.png';

    function catalog() {
        return root.cplCatalog || { CATEGORIES: [], ITEMS: [], art: () => '', categoryArt: () => '' };
    }

    /** Vista's RecentView: 1 Category View (the default), 0 Classic View. */
    function categoryView() {
        const reg = root.melatonRegistry;
        return !reg || reg.get(VIEW_KEY, 'RecentView', 1) !== 0;
    }

    function setView(category) {
        const reg = root.melatonRegistry;
        if (reg) void reg.set(VIEW_KEY, { RecentView: category ? 1 : 0 });
    }

    /** Every item: the registered ones with the catalog's art, name and categories, then the catalog's own. */
    function allItems() {
        const cat = catalog();
        const byId = new Map(cat.ITEMS.map((c) => [c.id, c]));
        const out = items.map((i) => {
            const c = byId.get(i.id) || {};
            return {
                ...i,
                name: c.name || i.name,
                cats: c.cats || i.cats || ['additional'],
                tip: c.tip || i.description || i.name,
                art: c.art || null,
                hidden: c.hidden === true
            };
        });
        cat.ITEMS.forEach((c) => {
            if (!c.name || out.some((i) => i.id === c.id)) return;
            out.push({ ...c, catalogOpen: c.open, description: c.tip });
        });
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }

    function findItem(id) {
        return allItems().find((i) => i.id === id) || null;
    }

    function itemArt(item, size) {
        if (item.art) return catalog().art(item.art, size);
        return item.image || '';
    }

    // globals the catalog's 'call:' actions name, with what Melaton has for them
    const CALLS = {
        openWelcomeCenter: () => callGlobal('openWelcomeCenter'),
        openDeviceManager: () => callGlobal('openDeviceManager'),
        openDataManagementDsap: () => callGlobal('openDataManagementDsap'),
        openEventViewerApplet: () => launchApp('event-viewer'),
        openSecurityCenter: () => callGlobal('openSecurityCenterDsap'),
        openSidebarGadgetGallery: () => callGlobal('openVistaGadgetGallery'),
        openScreenSaverSettings: () => root.personalizationDialogs && root.personalizationDialogs.openScreenSaver(),
        openThemeSettings: () => root.personalizationDialogs && root.personalizationDialogs.openTheme(),
        openStartMenuProperties: () => root.taskbarSettings && root.taskbarSettings.openProperties('start'),
        openVolumeMixer: () => root.personalizationDialogs && root.personalizationDialogs.openSound(),
        toggleMelatonConnectDialog: () => net() && net().connect && net().connect.open(),
        openHelpAndSupport: () => {
            const places = callGlobal('getStartMenuPlaces') || [];
            const help = places.find((p) => p && p.id === 'help');
            if (help && typeof help.action === 'function') help.action();
        },
        openExplorerApplet: (arg) => callGlobal('openExplorerApplet', arg),
        openDsapInGrimoire: (arg) => callGlobal('openDsapInGrimoire', arg)
    };

    function launchApp(launchId) {
        const item = callGlobal('findStartMenuLaunchableById', launchId);
        if (item) callGlobal('launchStartMenuItem', item);
    }

    /** A catalog action string (cplCatalog.js header). */
    function doAction(action) {
        const str = String(action || '');
        const i = str.indexOf(':');
        const kind = i < 0 ? str : str.slice(0, i);
        const rest = i < 0 ? '' : str.slice(i + 1);
        const j = rest.indexOf(':');
        const id = j < 0 ? rest : rest.slice(0, j);
        const arg = j < 0 ? undefined : rest.slice(j + 1);
        switch (kind) {
            case 'item': openItem(id); break;
            case 'cat': navigate(`cat-${id}`); break;
            case 'page':
                if (pages[id]) {
                    pageArgs[id] = arg;
                    navigate(id);
                } else console.warn('Control Panel: no page', id);
                break;
            case 'dialog':
                if (root.cplDialogs) root.cplDialogs.open(id, arg, modal);
                else console.warn('Control Panel: cplDialogs.js is not loaded');
                break;
            case 'call': {
                const fn = CALLS[id];
                if (fn) fn(arg);
                else callGlobal(id, arg);
                break;
            }
            default: break;
        }
    }

    const pageArgs = {};

    /** The argument the last 'page:<id>:<arg>' link gave a page (a tab, a section), once. */
    function takePageArg(id) {
        const a = pageArgs[id];
        delete pageArgs[id];
        return a;
    }

    function link(l, cls = 'cpl-link') {
        const shield = l.s ? `<img class="cpl-shield" src="${SHIELD}" alt="" draggable="false">` : '';
        return `<button type="button" class="${cls}" data-cpl-action="do" data-cpl-arg="${esc(l.a)}">${shield}${esc(l.t)}</button>`;
    }

    /** Vista's links under a title: one run, wrapping, a thin grey bar between two. */
    function linkRun(links) {
        if (!links || !links.length) return '';
        return `<div class="cpl-links">${links.map((l, n) => `<span class="cpl-links-cell">${link(l)}${n < links.length - 1 ? '<span class="cpl-links-sep" aria-hidden="true"></span>' : ''}</span>`).join('')}</div>`;
    }

    /** The task pane of Control Panel Home and the category pages. */
    function homeTasks(currentCat) {
        const cats = catalog().CATEGORIES;
        const classic = !currentCat && !categoryView();
        const homeCurrent = !currentCat && !classic;
        const row = (label, current, action, arg) => current
            ? `<li class="cpl-nav-current">${esc(label)}</li>`
            : `<li><button type="button" class="cpl-link" data-cpl-action="${action}"${arg ? ` data-cpl-arg="${esc(arg)}"` : ''}>${esc(label)}</button></li>`;
        return `
            <ul class="cpl-nav">
                ${row('Control Panel Home', homeCurrent, 'view-category')}
            </ul>
            ${currentCat ? `<ul class="cpl-nav cpl-nav-cats">${cats.map((c) => row(c.name, c.id === currentCat, 'nav', `cat-${c.id}`)).join('')}</ul>` : ''}
            <ul class="cpl-nav cpl-nav-classic">
                ${row('Classic View', classic, 'view-classic')}
            </ul>`;
    }

    function categoryHome() {
        const cats = catalog().CATEGORIES;
        const cell = (c) => `
            <div class="cpl-cat">
                <img class="cpl-cat-icon" src="${catalog().categoryArt(c, 48)}" alt="" draggable="false">
                <div class="cpl-cat-text">
                    <button type="button" class="cpl-cat-title" data-cpl-action="nav" data-cpl-arg="cat-${esc(c.id)}">${esc(c.name)}</button>
                    ${c.home.map((l) => `<div class="cpl-cat-link">${link(l)}</div>`).join('')}
                </div>
            </div>`;
        // Vista fills the first column with the first five, the second with the rest
        const half = Math.ceil(cats.length / 2);
        return `<div class="cpl-cat-home">
            <div class="cpl-cat-col">${cats.slice(0, half).map(cell).join('')}</div>
            <div class="cpl-cat-col">${cats.slice(half).map(cell).join('')}</div>
        </div>`;
    }

    function itemRows(rows) {
        return `<div class="cpl-task-items">${rows.map(({ item, links }) => {
            if (!item) return '';
            return `
            <div class="cpl-task-item">
                <img class="cpl-task-item-icon" src="${esc(itemArt(item, 32))}" alt="" draggable="false">
                <div class="cpl-task-item-text">
                    <button type="button" class="cpl-task-item-title" data-cpl-action="open" data-cpl-arg="${esc(item.id)}">${esc(item.name)}</button>
                    ${linkRun(links)}
                </div>
            </div>`;
        }).join('')}</div>`;
    }

    /**
     * A list view icon's name as Vista draws it (DrawText word break + end ellipsis): at most two
     * lines of about 66 px in Segoe UI 9 pt (whole words up to 72); a word wider than a line ends in "..." on its own line
     * ("Administrat..." / "Tools"), and text past the second line ellipsizes it ("Sharing Ce...").
     */
    // Vista's own breaks for its names (the Classic View capture, 2026-10-22): GDI's ellipsis
    // widths differ from the browser's, so these are copied rather than measured
    const VISTA_LABELS = {
        'Add Hardware': ['Add', 'Hardware'],
        'Administrative Tools': ['Administrat...', 'Tools'],
        'Backup and Restore Center': ['Backup and', 'Restore C...'],
        'BitLocker Drive Encryption': ['BitLocker', 'Drive En...'],
        'Bluetooth Devices': ['Bluetooth', 'Devices'],
        'Color Management': ['Color', 'Management'],
        'Date and Time': ['Date and', 'Time'],
        'Default Programs': ['Default', 'Programs'],
        'Device Manager': ['Device', 'Manager'],
        'Ease of Access Center': ['Ease of', 'Acce...'],
        'Folder Options': ['Folder', 'Options'],
        'Game Controllers': ['Game', 'Controllers'],
        'Indexing Options': ['Indexing', 'Options'],
        'Internet Options': ['Internet', 'Options'],
        'iSCSI Initiator': ['iSCSI Initiator'],
        'Offline Files': ['Offline Files'],
        'Parental Controls': ['Parental', 'Controls'],
        'Pen and Input Devices': ['Pen and', 'Input Devices'],
        'People Near Me': ['People Near', 'Me'],
        'Performance Information and Tools': ['Performance', 'Informatio...'],
        'Personalization': ['Personaliz...'],
        'Phone and Modem Options': ['Phone and', 'Modem ...'],
        'Power Options': ['Power', 'Options'],
        'Problem Reports and Solutions': ['Problem', 'Reports a...'],
        'Programs and Features': ['Programs', 'and Features'],
        'Regional and Language Options': ['Regional and', 'Language ...'],
        'Scanners and Cameras': ['Scanners and', 'Cameras'],
        'Security Center': ['Security', 'Center'],
        'Speech Recognition Options': ['Speech', 'Recogniti...'],
        'Sync Center': ['Sync Center'],
        'Tablet PC Settings': ['Tablet PC', 'Settings'],
        'Taskbar and Start Menu': ['Taskbar and', 'Start Menu'],
        'Text to Speech': ['Text to', 'Speech'],
        'User Accounts': ['User', 'Accounts'],
        'Welcome Center': ['Welcome', 'Center']
    };

    let labelCtx = null;
    function vistaIconLabel(text, width = 66, maxLines = 2) {
        if (VISTA_LABELS[text]) return VISTA_LABELS[text];
        if (!labelCtx && doc) {
            labelCtx = doc.createElement('canvas').getContext('2d');
        }
        if (!labelCtx) return [text];
        labelCtx.font = '12px "Segoe UI", Tahoma, sans-serif';
        const w = (t) => labelCtx.measureText(t).width;
        const full = width + 6; // a whole word may run a little wider than a truncated one
        const fit = (t) => {
            if (w(t) <= full) return t;
            let n = t.length;
            while (n > 1 && w(`${t.slice(0, n).replace(/\s+$/, ' ')}...`) > width) n -= 1;
            return `${t.slice(0, n)}...`;
        };
        const words = String(text).split(/\s+/).filter(Boolean);
        const lines = [];
        let line = '';
        for (let k = 0; k < words.length; k += 1) {
            const word = words[k];
            const next = line ? `${line} ${word}` : word;
            if (w(next) <= full) {
                line = next;
                continue;
            }
            if (line) lines.push(line);
            line = w(word) <= full ? word : fit(word);
            if (lines.length === maxLines - 1) {
                // the last line takes the rest of the text and ellipsizes it
                line = fit(words.slice(k).join(' '));
                lines.push(line);
                return lines;
            }
            if (line.endsWith('...') && w(word) > full) {
                lines.push(line);
                line = '';
            }
        }
        if (line) lines.push(line);
        return lines.slice(0, maxLines);
    }

    let classicSort = { col: 'name', dir: 1 };

    function classicView(search) {
        const catName = (id) => (catalog().CATEGORIES.find((c) => c.id === id) || {}).name || '';
        let list = allItems().filter((i) => !i.hidden);
        if (classicSort.col === 'category') {
            list = list.slice().sort((a, b) => catName(a.cats[0]).localeCompare(catName(b.cats[0])) * classicSort.dir || a.name.localeCompare(b.name));
        } else if (classicSort.dir < 0) list = list.slice().reverse();
        const col = (id, label) => `<button type="button" class="cpl-col${classicSort.col === id ? ' is-sorted' : ''}" data-cpl-action="sort" data-cpl-arg="${id}">${classicSort.col === id ? `<span class="cpl-col-arrow${classicSort.dir < 0 ? ' is-down' : ''}"></span>` : ''}${label}</button>`;
        return `
            <div class="cpl-classic">
                <div class="cpl-classic-header">${col('name', 'Name')}${col('category', 'Category')}<span class="cpl-col-rest"></span></div>
                <div class="cpl-classic-grid" role="list">${list.map((i) => `
                    <div class="cpl-icon" role="listitem" tabindex="0" data-cpl-item="${esc(i.id)}"
                        data-cpl-action="select" data-cpl-arg="${esc(i.id)}" title="${esc(i.tip || i.name)}">
                        <img src="${esc(itemArt(i, 48))}" alt="" draggable="false">
                        <span class="cpl-icon-label">${vistaIconLabel(i.name).map(esc).join('<br>')}</span>
                    </div>`).join('')}</div>
            </div>`;
    }

    /** Search results, as Vista lists them: each matching item with its matching tasks. */
    function searchResults(search) {
        const q = search.toLowerCase();
        const hit = (t) => String(t || '').toLowerCase().includes(q);
        const byItem = new Map();
        catalog().CATEGORIES.forEach((c) => c.items.forEach(({ item, links }) => {
            const it = findItem(item);
            if (!it) return;
            const entry = byItem.get(item) || { item: it, links: [], self: false };
            links.forEach((l) => {
                if (hit(l.t) && !entry.links.some((x) => x.t === l.t)) entry.links.push(l);
            });
            byItem.set(item, entry);
        }));
        allItems().forEach((it) => {
            const entry = byItem.get(it.id) || { item: it, links: [], self: false };
            entry.self = hit(it.name) || hit(it.tip);
            byItem.set(it.id, entry);
        });
        const rows = Array.from(byItem.values()).filter((e) => e.self || e.links.length)
            .sort((a, b) => a.item.name.localeCompare(b.item.name));
        if (!rows.length) return `<p class="cpl-empty">No items match your search.</p>`;
        return itemRows(rows);
    }

    pages.home = {
        title: () => 'Control Panel',
        tasks: () => homeTasks(null),
        body: () => {
            const search = (el('.cpl-search') && el('.cpl-search').value || '').trim();
            if (search) return searchResults(search);
            return categoryView() ? categoryHome() : classicView();
        },
        mount: (main) => {
            if (modal) modal.dataset.cplView = categoryView() ? 'category' : 'classic';
            main.classList.toggle('cpl-main--classic', !categoryView());
        },
        unmount: () => {
            const main = el('.cpl-main');
            if (main) main.classList.remove('cpl-main--classic');
            if (modal) delete modal.dataset.cplView;
        }
    };

    function registerCategoryPages() {
        catalog().CATEGORIES.forEach((c) => {
            pages[`cat-${c.id}`] = {
                title: () => c.name,
                icon16: catalog().categoryArt(c, 16),
                tasks: () => homeTasks(c.id),
                body: () => itemRows(c.items.map(({ item, links }) => ({ item: findItem(item), links })))
            };
        });
    }
    registerCategoryPages();

    // ---- Network and Server Center ---------------------------------------------------------

    function accessText(state) {
        switch (state) {
            case 'connected': return 'Local and Internet';
            case 'connecting': return 'Connecting...';
            case 'auth': return 'Logon required';
            default: return 'Not connected';
        }
    }

    function serverRows() {
        const status = lastStatus || (ws() && ws().lastServerStartupStatus) || null;
        if (!status || statusError) {
            return [{ label: 'Domain controller', dot: 'off', value: statusError ? 'Not responding' : 'Checking...' }];
        }
        const caps = status.capabilities || {};
        const onOff = (on) => (on ? 'on' : 'off');
        const rows = [
            {
                label: 'Domain controller',
                dot: status.isReady ? 'on' : 'busy',
                value: status.isReady ? 'Ready' : `Starting (${status.stageMessage || 'please wait'})`
            },
            { label: 'Server uptime', value: formatDuration(status.uptime) },
            { label: 'Session service', dot: onOff(caps.websocket), value: caps.websocket ? 'On' : 'Off' },
            { label: 'Image generation', dot: onOff(caps.generation), value: caps.generation ? 'On' : 'Off' },
            { label: 'Static content', dot: onOff(caps.staticAssets), value: caps.staticAssets ? 'On' : 'Off' }
        ];
        if (status.runtimeCompileComplete !== undefined) {
            rows.push({
                label: 'Client files',
                dot: status.runtimeCompileComplete ? 'on' : 'busy',
                value: status.runtimeCompileComplete ? 'Up to date' : 'Compiling'
            });
        }
        return rows;
    }

    function mapNode(image, label, sub) {
        return `<div class="cpl-map-node"><img src="${image}" alt="" draggable="false"><span class="cpl-map-label">${esc(label)}</span>${sub ? `<span class="cpl-map-sub">${esc(sub)}</span>` : ''}</div>`;
    }

    function mapLink(state, title) {
        return `<div class="cpl-map-link cpl-map-link--${state}" title="${esc(title)}"><span class="cpl-map-line"></span>${state === 'down' ? '<span class="cpl-map-x" aria-hidden="true">&#10005;</span>' : ''}</div>`;
    }

    pages.network = {
        title: () => 'Network and Server Center',
        tasks: () => {
            const state = linkState();
            const i = info();
            return `
            <div class="cpl-task-group">
                <h3 class="cpl-task-heading">Tasks</h3>
                <ul class="cpl-task-list">
                    ${state === 'connected' || state === 'connecting'
                        ? taskLink(`Disconnect ${i.connectionName}`, 'disconnect')
                        : taskLink(`Connect ${i.connectionName}`, 'connect')}
                    ${taskLink('Manage network connections', 'status')}
                    ${taskLink('Customize network name', 'customize')}
                    ${taskLink('Rename this connection', 'rename')}
                    ${taskLink('Diagnose and repair', 'diagnose')}
                </ul>
            </div>
            <div class="cpl-task-group cpl-task-group--see-also">
                <h3 class="cpl-task-heading">See also</h3>
                <ul class="cpl-task-list">
                    ${taskLink('Personalization', 'item', 'personalization')}
                    ${taskLink('Remote Access', 'item', 'remote-access')}
                </ul>
            </div>`;
        },
        body: () => {
            const state = linkState();
            const i = info();
            const reachable = !!lastStatus && !statusError;
            const clientLink = state === 'connected' ? 'ok' : state === 'disconnected' ? 'down' : 'busy';
            const serverLink = reachable ? 'ok' : 'unknown';
            const dots = serverRows().map((r) => `
                <div class="cpl-row">
                    <span class="cpl-row-label">${esc(r.label)}</span>
                    <span class="cpl-row-value">${r.dot ? `<span class="cpl-dot cpl-dot--${r.dot}" aria-hidden="true"></span>` : ''}${esc(r.value)}</span>
                </div>`).join('');
            return `
            <div class="cpl-page cpl-network">
                <h1 class="cpl-page-title">Network and Server Center</h1>
                <div class="cpl-map">
                    ${mapNode('/static_images/melaton/net-laptop.png', 'This computer')}
                    ${mapLink(clientLink, state === 'connected' ? `Connected through ${i.connectionName}` : accessText(state))}
                    ${mapNode('/static_images/melaton/net-server.png', i.domain, 'Domain controller')}
                    ${mapLink(serverLink, reachable ? 'Connected' : 'Unknown')}
                    ${mapNode('/static_images/melaton/net-globe.png', 'Internet')}
                </div>
                <div class="cpl-box">
                    <div class="cpl-box-head">
                        <img src="/static_images/melaton/net-server.png" alt="" class="cpl-box-icon" draggable="false">
                        <span class="cpl-box-title">${esc(i.domain)} <span class="cpl-box-kind">(Domain network)</span></span>
                        <button type="button" class="cpl-link cpl-box-action" data-cpl-action="customize">Customize</button>
                    </div>
                    <div class="cpl-row">
                        <span class="cpl-row-label">Access</span>
                        <span class="cpl-row-value">${esc(accessText(state))}</span>
                    </div>
                    <div class="cpl-row">
                        <span class="cpl-row-label">Connection</span>
                        <span class="cpl-row-value">${esc(i.connectionName)}</span>
                        <button type="button" class="cpl-link cpl-row-action" data-cpl-action="status">View status</button>
                    </div>
                    <div class="cpl-row">
                        <span class="cpl-row-label">Server name</span>
                        <span class="cpl-row-value">${esc(i.fqdn)}</span>
                    </div>
                    ${state === 'auth' ? `
                    <div class="cpl-row">
                        <span class="cpl-row-label"></span>
                        <button type="button" class="cpl-link" data-cpl-action="connect">Log on to the domain...</button>
                    </div>` : ''}
                </div>
                <h2 class="cpl-section-title">Server status</h2>
                <div class="cpl-box cpl-box--rows">${dots}</div>
            </div>`;
        }
    };

    // ---- actions -------------------------------------------------------------------------

    function connectToDomain() {
        const client = ws();
        if (!client) return;
        if (client.connectionPhase === 'auth' && net()) {
            net().connect.show();
            return;
        }
        if (typeof client.manualReconnect === 'function') client.manualReconnect();
        setTimeout(render, 50);
    }

    function disconnectFromDomain() {
        const client = ws();
        if (client && typeof client.cancelConnectionFromUser === 'function') client.cancelConnectionFromUser();
        setTimeout(render, 50);
    }

    async function fetchStatus() {
        const response = await root.fetch('/status', {
            method: 'OPTIONS',
            cache: 'no-store',
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    async function pollStatus() {
        try {
            lastStatus = await fetchStatus();
            statusError = false;
            const client = ws();
            if (client && lastStatus && lastStatus.melaton) client.melatonConnection = lastStatus.melaton;
        } catch (_) {
            statusError = true;
        }
        if (modal && current === 'network' && !modal.classList.contains('hidden')) render();
    }

    async function diagnose() {
        const box = root.bootMessageBox;
        await pollStatus();
        const i = info();
        const state = linkState();
        let icon = 'info';
        let message;
        if (statusError) {
            icon = 'error';
            message = 'The domain controller did not respond. Check that this computer is connected to the network and that the server is running, then try again.';
        } else if (lastStatus && !lastStatus.isReady) {
            icon = 'warning';
            message = `The domain controller is starting (${lastStatus.stageMessage || 'please wait'}). This computer connects again when it is ready.`;
        } else if (state === 'auth') {
            icon = 'warning';
            message = 'The domain controller is available, but this computer must log on again. Click "Log on to the domain..." in the Network and Server Center.';
        } else if (state !== 'connected') {
            icon = 'warning';
            message = `The domain controller is available, but ${i.connectionName} is not connected. Click "Connect ${i.connectionName}" to connect.`;
        } else {
            message = "Melaton did not find any problems with this computer's connection to the domain controller.";
        }
        if (box) {
            await box.show({
                title: 'Melaton Network Diagnostics',
                icon,
                message,
                buttons: [{ label: 'Close', value: 'close', default: true, cancel: true }]
            });
        }
    }

    function startTimers() {
        stopTimers();
        liveTimer = setInterval(() => {
            if (!modal || modal.classList.contains('hidden')) { stopTimers(); return; }
            if (current === 'network') {
                // Only the parts that change; keep the selection / focus elsewhere intact
                const tasks = pages.network.tasks();
                const body = pages.network.body();
                const tasksEl = el('.cpl-tasks');
                const mainEl = el('.cpl-main');
                if (tasksEl.innerHTML !== tasks) tasksEl.innerHTML = tasks;
                if (mainEl.innerHTML !== body) mainEl.innerHTML = body;
            }
        }, LIVE_TICK_MS);
        statusTimer = setInterval(() => {
            if (current === 'network' && modal && !modal.classList.contains('hidden')) pollStatus();
        }, STATUS_POLL_MS);
    }

    function stopTimers() {
        if (liveTimer) clearInterval(liveTimer);
        if (statusTimer) clearInterval(statusTimer);
        liveTimer = null;
        statusTimer = null;
    }

    // ---- <domain> Status (Vista Local Area Connection Status) ----------------------------

    function sel(root2, selector) {
        return root2 ? root2.querySelector(selector) : null;
    }

    function ensureStatusModal() {
        if (statusModal || !doc) return statusModal;
        statusModal = doc.createElement('div');
        statusModal.id = 'melatonConnectionStatusModal';
        statusModal.className = 'modal hidden vpn-dialog connection-status-modal';
        statusModal.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main">
                    <i class="fas fa-network-wired icon-fa"></i>
                    <img src="/static_images/melaton/net-globe.png" alt="" class="icon-image">
                    <span class="connection-status-title">Status</span>
                </div>
            </div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-danger close-btn btn-small connection-status-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content vpn-dialog-content connection-status-content">
                <div class="vpn-tabs" role="tablist"><span class="vpn-tab active" role="tab" aria-selected="true">General</span></div>
                <div class="vpn-tab-page">
                    <fieldset class="vpn-group">
                        <legend>Connection</legend>
                        <div class="vpn-kv"><span>Domain:</span><span class="cs-domain"></span></div>
                        <div class="vpn-kv"><span>Server name:</span><span class="cs-server"></span></div>
                        <div class="vpn-kv"><span>Device:</span><span class="cs-device"></span></div>
                        <div class="vpn-kv"><span>Media State:</span><span class="cs-media"></span></div>
                        <div class="vpn-kv"><span>Duration:</span><span class="cs-duration"></span></div>
                        <div class="vpn-kv"><span>Latency:</span><span class="cs-latency"></span></div>
                        <div class="vpn-kv"><span>Encryption:</span><span class="cs-encryption"></span></div>
                    </fieldset>
                    <fieldset class="vpn-group">
                        <legend>Activity</legend>
                        <div class="cs-activity">
                            <span class="cs-activity-side">Sent</span>
                            <span class="cs-activity-art">
                                <i class="fas fa-arrow-up websocket-arrow-up" id="connectionTrafficUp"></i>
                                <img src="/static_images/melaton/net-laptop.png" alt="" draggable="false">
                                <i class="fas fa-arrow-down websocket-arrow-down" id="connectionTrafficDown"></i>
                            </span>
                            <span class="cs-activity-side">Received</span>
                        </div>
                        <div class="cs-activity-counts">
                            <span>Messages:</span><span class="cs-out"></span><span class="cs-sep"></span><span class="cs-in"></span>
                        </div>
                    </fieldset>
                    <div class="vpn-buttons vpn-buttons--left">
                        <button type="button" class="btn-standard cs-toggle">Disconnect</button>
                        <button type="button" class="btn-standard cs-diagnose">Diagnose</button>
                    </div>
                </div>
                <div class="vpn-buttons">
                    <button type="button" class="btn-standard cs-close-btn">Close</button>
                </div>
            </div>`;
        doc.body.appendChild(statusModal);
        const closeIt = () => closeStatusDialog();
        sel(statusModal, '.connection-status-close').addEventListener('click', closeIt);
        sel(statusModal, '.cs-close-btn').addEventListener('click', closeIt);
        sel(statusModal, '.cs-diagnose').addEventListener('click', () => diagnose());
        sel(statusModal, '.cs-toggle').addEventListener('click', () => {
            const state = linkState();
            if (state === 'connected' || state === 'connecting') disconnectFromDomain();
            else connectToDomain();
            setTimeout(updateStatusDialog, 50);
        });
        statusModal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); closeIt(); }
        });
        return statusModal;
    }

    function updateStatusDialog() {
        if (!statusModal || statusModal.classList.contains('hidden')) return;
        const client = ws();
        const i = info();
        const state = linkState();
        const connected = state === 'connected';
        const stats = (client && client.connectionStats) || {};
        sel(statusModal, '.connection-status-title').textContent = `${i.connectionName} Status`;
        sel(statusModal, '.cs-domain').textContent = i.domain;
        sel(statusModal, '.cs-server').textContent = i.fqdn;
        sel(statusModal, '.cs-device').textContent = net() ? net().miniportLabel(i) : `${i.connectionType} Miniport (${i.device})`;
        sel(statusModal, '.cs-media').textContent = connected ? 'Enabled' : accessText(state);
        sel(statusModal, '.cs-duration').textContent = connected && stats.connectedAt
            ? formatDuration(Date.now() - stats.connectedAt)
            : '—';
        let latency = '—';
        if (connected && client && client.currentRtt !== null && client.currentRtt !== undefined) {
            latency = `${Math.round(client.currentRtt / 10) * 10} ms`;
            if (client.rttVariability !== null && client.rttVariability !== undefined && client.currentRtt > 0) {
                latency += ` (±${Math.round((client.rttVariability / client.currentRtt) * 100)}%)`;
            }
        }
        sel(statusModal, '.cs-latency').textContent = latency;
        sel(statusModal, '.cs-encryption').textContent = root.location.protocol === 'https:' ? 'TLS (HTTPS)' : 'None';
        sel(statusModal, '.cs-out').textContent = Number(stats.messagesOut || 0).toLocaleString();
        sel(statusModal, '.cs-in').textContent = Number(stats.messagesIn || 0).toLocaleString();
        sel(statusModal, '.cs-toggle').textContent = connected || state === 'connecting' ? 'Disconnect' : 'Connect';
    }

    function openStatusDialog() {
        if (!ensureStatusModal()) return;
        if (typeof root.openModal === 'function') root.openModal(statusModal);
        else statusModal.classList.remove('hidden');
        updateStatusDialog();
        if (statusTimerId) clearInterval(statusTimerId);
        statusTimerId = setInterval(() => {
            if (!statusModal || statusModal.classList.contains('hidden')) {
                clearInterval(statusTimerId);
                statusTimerId = null;
                return;
            }
            updateStatusDialog();
        }, LIVE_TICK_MS);
    }

    function closeStatusDialog() {
        if (statusTimerId) clearInterval(statusTimerId);
        statusTimerId = null;
        if (!statusModal) return;
        if (typeof root.closeModal === 'function') root.closeModal(statusModal);
        else statusModal.classList.add('hidden');
    }

    // ---- Customize network settings / Rename this connection ------------------------------
    //   'network'     the domain network's name (desktop.domainName), Vista's Set Network Location
    //   'connection'  the network interface's name (desktop.connectionName), Rename Connection

    const NAME_MODES = {
        network: {
            title: 'Set Network Location',
            heading: 'Customize network settings',
            label: 'Network name:',
            key: 'domainName',
            infoKey: 'domain',
            connKey: 'domain',
            note: 'This computer is joined to the domain, so the location type is set by the domain controller. '
                + 'The network name is the domain: it shows in the Domain box of the logon dialogs, on the lock screen and here.',
            empty: 'Type a network name.',
            failed: 'The network name could not be saved.'
        },
        connection: {
            title: 'Rename Connection',
            heading: 'Rename this connection',
            label: 'Connection name:',
            key: 'connectionName',
            infoKey: 'connectionName',
            connKey: 'connectionName',
            note: 'The connection is the network interface this computer reaches the domain controller through. '
                + 'Its name shows in the Connecting and Connect dialogs, the tray and here.',
            empty: 'Type a connection name.',
            failed: 'The connection name could not be saved.'
        }
    };
    let customizeMode = 'network';

    function ensureCustomizeModal() {
        if (customizeModal || !doc) return customizeModal;
        customizeModal = doc.createElement('div');
        customizeModal.id = 'domainCustomizeModal';
        customizeModal.className = 'modal hidden vpn-dialog domain-customize-modal';
        customizeModal.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main">
                    <i class="fas fa-network-wired icon-fa"></i>
                    <img src="/static_images/melaton/net-server.png" alt="" class="icon-image">
                    <span class="customize-title">Set Network Location</span>
                </div>
            </div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-danger close-btn btn-small customize-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content vpn-dialog-content">
                <form class="vpn-form customize-form" autocomplete="off">
                    <h2 class="vpn-heading customize-heading">Customize network settings</h2>
                    <label class="vpn-form-row"><span class="customize-label">Network name:</span>
                        <input class="vpn-input customize-name" type="text" maxlength="64" spellcheck="false"></label>
                    <div class="vpn-form-row customize-location"><span>Location type:</span>
                        <span class="vpn-static">Domain network</span></div>
                    <p class="vpn-note customize-note"></p>
                    <p class="vpn-form-status customize-status" aria-live="polite"></p>
                    <div class="vpn-buttons">
                        <button type="submit" class="btn-standard customize-ok">OK</button>
                        <button type="button" class="btn-standard customize-cancel">Cancel</button>
                    </div>
                </form>
            </div>`;
        doc.body.appendChild(customizeModal);
        const closeIt = () => {
            if (typeof root.closeModal === 'function') root.closeModal(customizeModal);
            else customizeModal.classList.add('hidden');
        };
        sel(customizeModal, '.customize-close').addEventListener('click', closeIt);
        sel(customizeModal, '.customize-cancel').addEventListener('click', closeIt);
        customizeModal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); closeIt(); }
        });
        sel(customizeModal, '.customize-form').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const mode = NAME_MODES[customizeMode];
            const name = sel(customizeModal, '.customize-name').value.trim().slice(0, 64);
            const status = sel(customizeModal, '.customize-status');
            if (!name) {
                status.textContent = mode.empty;
                return;
            }
            try {
                // persistUserGlobalSettingsPatch: public/scripts/comp/modalUtils.js (config.json
                // userGlobalSettings.desktop.domainName / connectionName)
                if (typeof root.persistUserGlobalSettingsPatch === 'function') {
                    await root.persistUserGlobalSettingsPatch({ desktop: { [mode.key]: name } });
                }
                const client = ws();
                if (client && client.melatonConnection) {
                    client.melatonConnection = { ...client.melatonConnection, [mode.connKey]: name };
                }
                closeIt();
                render();
                updateStatusDialog();
                renderFlyout();
                if (client && typeof client._updateModemTrayIcon === 'function') client._updateModemTrayIcon();
            } catch (err) {
                status.textContent = `${mode.failed} ${err && err.message ? err.message : ''}`.trim();
            }
        });
        return customizeModal;
    }

    function openCustomizeDialog(which = 'network') {
        if (!ensureCustomizeModal()) return;
        customizeMode = NAME_MODES[which] ? which : 'network';
        const mode = NAME_MODES[customizeMode];
        sel(customizeModal, '.customize-title').textContent = mode.title;
        sel(customizeModal, '.customize-heading').textContent = mode.heading;
        sel(customizeModal, '.customize-label').textContent = mode.label;
        sel(customizeModal, '.customize-note').textContent = mode.note;
        sel(customizeModal, '.customize-location').classList.toggle('hidden', customizeMode !== 'network');
        const input = sel(customizeModal, '.customize-name');
        input.value = info()[mode.infoKey];
        sel(customizeModal, '.customize-status').textContent = '';
        if (typeof root.openModal === 'function') root.openModal(customizeModal);
        else customizeModal.classList.remove('hidden');
        setTimeout(() => { input.focus(); input.select(); }, 0);
    }

    // ---- Network tray flyout (one click) and menu (right-click) -----------------------------

    let flyout = null;
    let flyoutAnchor = null;
    let flyoutTimer = null;

    function flyoutStateText(state) {
        switch (state) {
            case 'connected': return 'Connected';
            case 'connecting': return 'Connecting...';
            case 'auth': return 'Logon required';
            default: return 'Disconnected';
        }
    }

    function ensureFlyout() {
        if (flyout || !doc) return flyout;
        flyout = doc.createElement('div');
        flyout.id = 'networkTrayFlyout';
        flyout.className = 'network-flyout hidden';
        flyout.setAttribute('role', 'dialog');
        flyout.setAttribute('aria-label', 'Network');
        flyout.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const link = ev.target.closest('[data-flyout-action]');
            if (!link) return;
            const action = link.dataset.flyoutAction;
            hideFlyout();
            if (action === 'toggle') {
                const state = linkState();
                if (state === 'connected' || state === 'connecting') openStatusDialog();
                else connectToDomain();
            } else if (action === 'center') {
                open('network');
            }
        });
        doc.body.appendChild(flyout);
        // Outside click / Escape closes it, like Vista's flyouts
        doc.addEventListener('pointerdown', (ev) => {
            if (!flyout || flyout.classList.contains('hidden')) return;
            if (flyout.contains(ev.target) || (flyoutAnchor && flyoutAnchor.contains(ev.target))) return;
            hideFlyout();
        }, true);
        doc.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && flyout && !flyout.classList.contains('hidden')) hideFlyout();
        }, true);
        return flyout;
    }

    function renderFlyout() {
        if (!flyout || flyout.classList.contains('hidden')) return;
        const i = info();
        const state = linkState();
        const connected = state === 'connected';
        const html = `
            <div class="network-flyout-body">
                <div class="network-flyout-heading">${connected ? 'Currently connected to:' : 'Not connected'}</div>
                <div class="network-flyout-item">
                    <img src="/static_images/melaton/net-server.png" alt="" draggable="false">
                    <div class="network-flyout-text">
                        <span class="network-flyout-name">${esc(i.domain)}</span>
                        <span class="network-flyout-sub">Access: ${connected ? 'Local and Internet' : state === 'auth' ? 'Logon required' : 'No network access'}</span>
                    </div>
                </div>
                <div class="network-flyout-item">
                    <img src="/static_images/melaton/net-laptop.png" alt="" draggable="false">
                    <div class="network-flyout-text">
                        <span class="network-flyout-name">${esc(i.connectionName)}</span>
                        <span class="network-flyout-sub">${esc(flyoutStateText(state))}</span>
                    </div>
                </div>
            </div>
            <div class="network-flyout-links">
                <button type="button" class="network-flyout-link" data-flyout-action="toggle">Connect or disconnect</button>
                <button type="button" class="network-flyout-link" data-flyout-action="center">Network and Server Center</button>
            </div>`;
        if (flyout.innerHTML !== html) flyout.innerHTML = html;
    }

    function positionFlyout() {
        if (!flyout) return;
        const width = flyout.offsetWidth || 280;
        const margin = 8;
        let rect = flyoutAnchor ? flyoutAnchor.getBoundingClientRect() : null;
        if (!rect || !rect.width) {
            // No visible anchor (tray still hidden during boot): the notification-area corner
            const taskbar = doc.getElementById('desktopTaskbar');
            const top = taskbar && taskbar.getBoundingClientRect().height ? taskbar.getBoundingClientRect().top : root.innerHeight - 40;
            rect = { right: root.innerWidth - margin, top };
        }
        const right = Math.max(margin, root.innerWidth - rect.right - 12);
        const left = Math.min(root.innerWidth - width - margin, root.innerWidth - right - width);
        flyout.style.left = `${Math.max(margin, left)}px`;
        flyout.style.bottom = `${Math.max(margin, root.innerHeight - rect.top + 6)}px`;
    }

    function showFlyout(anchor) {
        if (!ensureFlyout()) return;
        flyoutAnchor = anchor || null;
        flyout.classList.remove('hidden');
        renderFlyout();
        positionFlyout();
        if (flyoutTimer) clearInterval(flyoutTimer);
        flyoutTimer = setInterval(() => {
            if (!flyout || flyout.classList.contains('hidden')) { clearInterval(flyoutTimer); flyoutTimer = null; return; }
            renderFlyout();
        }, LIVE_TICK_MS);
    }

    function hideFlyout() {
        if (flyoutTimer) clearInterval(flyoutTimer);
        flyoutTimer = null;
        if (flyout) flyout.classList.add('hidden');
    }

    /** One click on the network tray icon (websocket.js _setupConnectionDialModalHandlers). */
    function toggleTrayFlyout(anchor) {
        if (flyout && !flyout.classList.contains('hidden')) {
            hideFlyout();
            return;
        }
        showFlyout(anchor);
    }

    /** Right-click on the network tray icon: Vista's network tray menu (contextMenu.js). */
    function attachTrayMenu(anchor) {
        if (!anchor || anchor.dataset.networkMenu === '1' || typeof root.contextMenu === 'undefined' || !root.contextMenu) return;
        anchor.dataset.networkMenu = '1';
        root.contextMenu.attachToElement(anchor, {
            sections: [{
                type: 'list',
                items: [
                    {
                        icon: 'fas fa-network-wired',
                        text: 'Connect or disconnect',
                        action: 'network-toggle',
                        loadfn: (item) => {
                            const state = linkState();
                            const i = info();
                            item.text = state === 'connected' || state === 'connecting'
                                ? `Disconnect ${i.connectionName}`
                                : `Connect ${i.connectionName}`;
                        }
                    },
                    { icon: 'fas fa-sliders', text: 'Network and Server Center', action: 'network-center' },
                    // the WebSocket indicator's old click: requests in Periscope's task list
                    { icon: 'fas fa-arrow-right-arrow-left', text: 'Network activity', action: 'network-activity' },
                    { separator: true },
                    { icon: 'fas fa-stethoscope', text: 'Diagnose and repair', action: 'network-diagnose' }
                ]
            }],
            onAction: (action) => {
                hideFlyout();
                if (action === 'network-toggle') {
                    const state = linkState();
                    if (state === 'connected' || state === 'connecting') disconnectFromDomain();
                    else connectToDomain();
                } else if (action === 'network-center') {
                    open('network');
                } else if (action === 'network-diagnose') {
                    diagnose();
                } else if (action === 'network-activity') {
                    if (root.wsClient && typeof root.wsClient.openRequestsModal === 'function') root.wsClient.openRequestsModal();
                }
            }
        });
    }

    const api = {
        open,
        close,
        navigate,
        registerItem,
        registerPage,
        taskLinkHtml: (label, action, arg) => taskLink(label, action, arg),
        openStatusDialog,
        openCustomizeDialog,
        diagnose,
        toggleTrayFlyout,
        hideTrayFlyout: hideFlyout,
        attachTrayMenu,
        isOpen: () => !!(modal && !modal.classList.contains('hidden')),
        goBack,
        currentPage: () => current,
        // a catalog action (cplCatalog.js) or an item, from outside the window (dialogs, Run)
        doAction: (action) => {
            if (!modal || modal.classList.contains('hidden')) open('home');
            doAction(action);
        },
        openItem: (id) => openItem(id),
        pageArg: (id) => takePageArg(id),
        _test: { pages, items, linkState, accessText, serverRows, formatDuration, setStatus: (s, e = false) => { lastStatus = s; statusError = e; } }
    };
    if (root) root.melatonControlPanel = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    // featureLoader brings this file in long after DOMContentLoaded, so the pages modalUtils.js
    // hosts (Personalization, the Global Settings items) register here
    callGlobal('registerDesktopSettingsControlPanelPages');
})(typeof window !== 'undefined' ? window : globalThis);
