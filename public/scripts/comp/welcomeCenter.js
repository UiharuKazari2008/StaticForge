/**
 * Welcome Center (Yozora #632): Vista's first-run hub (oobefldr.dll's folder, shown in the Control
 * Panel frame under System and Maintenance), Windows -> Melaton:
 *
 *   the details band   the edition, the copyright, Processor / Memory / Graphics / Computer name
 *                      (System's facts: cplSystem.js), "Show more details" (System)
 *   Get started with Melaton    the tasks, each with its own description in the band when chosen
 *                               and a link that opens it ("Show all N items" folds the rest away)
 *   Offers from Xyridian        the Dreamscape services
 *   Run at startup              HKCU\...\Welcome Center\RunAtStartup; when set, Welcome Center opens
 *                               once each logon (Vista's default is on; Melaton starts with it off)
 *
 *   openWelcomeCenter()
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Welcome Center';
    const ITEMS = '/static_images/vista-cpl/items';
    const APP = '/static_images/app_icons/32';

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function reg(name, def) {
        const r = root.melatonRegistry;
        return r ? r.get(KEY, name, def) : def;
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function cp() {
        return root.melatonControlPanel || null;
    }

    function launch(id) {
        const item = callGlobal('findStartMenuLaunchableById', id);
        if (item) callGlobal('launchStartMenuItem', item);
        return !!item;
    }

    const TASKS = [
        { id: 'details', name: 'View computer details', icon: `${ITEMS}/system-32.png`, text: 'Use the System page to see your computer\'s processor, memory and Melaton edition, change its name, and check its Melaton Experience Index.', open: 'Show more details', run: () => cp().doAction('item:system') },
        { id: 'transfer', name: 'Transfer files and settings', icon: `${APP}/vista-easy-transfer.webp`, text: 'Bring your pictures, prompts and files from another computer or archive into Melaton.', open: 'Open Melaton Easy Transfer', run: () => callGlobal('openVistaImportWizard') || launch('import') },
        { id: 'users', name: 'Add new users', icon: `${ITEMS}/user-accounts-32.png`, text: 'Change the names and pictures of the two accounts that share this computer.', open: 'Open User Accounts', run: () => cp().doAction('item:user-accounts') },
        { id: 'internet', name: 'Connect to the Internet', icon: `${ITEMS}/network-and-sharing-center-32.png`, text: 'Melaton reaches the Dreamscape server through its domain network. See the connection and the server\'s status.', open: 'Open Network and Server Center', run: () => cp().open('network') },
        { id: 'studio', name: 'Get started with DreamStudio', icon: `${APP}/vista-photo-gallery.webp`, text: 'Write a prompt, choose a model and print your first image. DreamStudio is where Dreamscape makes pictures.', open: 'Open DreamStudio', run: () => launch('studio') },
        { id: 'workspaces', name: 'Explore your Workspaces', icon: `${APP}/vista-folder.webp`, text: 'Every planet keeps its own gallery of prints. Teleport between them from the Start menu.', open: 'Open Workspaces', run: () => launch('workspace') },
        { id: 'whatsnew', name: 'What\'s new in Melaton', icon: `${APP}/vista-help.webp`, text: 'Read about the changes in this build of Melaton in Melaton Update\'s history.', open: 'Show what\'s new', run: () => cp().doAction('page:update') },
        { id: 'personalize', name: 'Personalize Melaton', icon: `${ITEMS}/personalization-32.png`, text: 'Change your desktop background, the color of your windows, your screen saver and your sounds.', open: 'Personalize Melaton', run: () => cp().doAction('item:personalization') },
        { id: 'register', name: 'Register Melaton online', icon: `${ITEMS}/internet-options-32.png`, text: 'See the Melaton edition and the product ID of this computer.', open: 'Show registration', run: () => cp().doAction('item:system') },
        { id: 'basics', name: 'Melaton Basics', icon: `${APP}/vista-help.webp`, text: 'Learn how to use the desktop, windows, the Start menu and Cartograph.', open: 'Open Help and Support', run: () => callGlobal('openHelpAndSupport', 'basics') },
        { id: 'access', name: 'Ease of Access Center', icon: `${ITEMS}/ease-of-access-center-32.png`, text: 'Make the computer easier to see, hear and use: the On-Screen Keyboard, Narrator and High Contrast.', open: 'Open Ease of Access Center', run: () => cp().doAction('item:ease-of-access') },
        { id: 'backup', name: 'Back Up and Restore Center', icon: `${ITEMS}/backup-and-restore-center-32.png`, text: 'Your files are kept on the Dreamscape server and its replicas. See the backups and restore from them.', open: 'Open Backup and Restore Center', run: () => cp().doAction('item:backup') },
        { id: 'cpl', name: 'Control Panel', icon: `${APP}/vista-control-panel.webp`, text: 'Change the settings of Melaton and the programs that came with it.', open: 'Open Control Panel', run: () => cp().open('home') },
        { id: 'demos', name: 'Melaton Demos', icon: `${APP}/vista-help.webp`, text: 'See how to print, browse and organize with short guides in the Grimoire.', open: 'Show Melaton Demos', run: () => callGlobal('openHelpAndSupport', 'demos') }
    ];

    const OFFERS = [
        { id: 'services', name: 'Dreamscape services', icon: '/static_images/vista-cpl/management-tools-32.png', text: 'Data Management, the Security Center and the other Dreamscape service pages.', open: 'Open the Dreamscape services', run: () => callGlobal('openDsapInGrimoire', 'dsap://dreamscape.jp/') },
        { id: 'agora', name: 'Agora', icon: `${APP}/vista-iexplore.webp`, text: 'See what the NovelAI community is making, and bring their prompts into DreamStudio.', open: 'Open Agora', run: () => launch('agora') || launch('explore') },
        { id: 'grimoire', name: 'The Grimoire', icon: `${APP}/vista-iexplore.webp`, text: 'The Dreamscape wiki: tags, artists and guides for writing prompts.', open: 'Open the Grimoire', run: () => callGlobal('openGrimoireApplet') }
    ];

    const FOLDED = 6; // Vista shows the first row or two until "Show all N items"

    let selected = null;
    let showAllTasks = false;
    let showAllOffers = false;
    let facts = null;

    async function loadFacts() {
        let version = null;
        let sys = null;
        try {
            if (typeof root.loadMeletonVersionInfo === 'function') version = await root.loadMeletonVersionInfo();
            sys = version && version.systemInfo;
            const ws = root.wsClient;
            if (!sys && ws && ws.isConnected && ws.isConnected()) sys = await ws.sendMessage('get_system_info', {});
        } catch (_) { /* below */ }
        const T = root.cplSystem && root.cplSystem._test;
        const ed = T ? T.edition(version, sys) : { name: 'Melaton', copyright: '' };
        const host = T && sys ? T.hostFacts(sys) : {};
        let gpu = '';
        try { gpu = root.melatonDeviceManager ? root.melatonDeviceManager.gpuName() : ''; } catch (_) { /* none */ }
        facts = { edition: ed.name, copyright: ed.copyright, processor: host.processor || '', memory: host.memory || '', graphics: gpu, computer: host.hostname || '' };
        const c = cp();
        if (c && c.currentPage() === 'welcome-center') c.navigate('welcome-center', { replace: true });
    }

    function band() {
        if (selected) {
            const t = TASKS.concat(OFFERS).find((x) => x.id === selected);
            if (t) {
                return `<div class="wc-band is-task">
                    <img class="wc-band-icon" src="${esc(t.icon)}" alt="" onerror="this.style.visibility='hidden'">
                    <div class="wc-band-text"><h2>${esc(t.name)}</h2><p>${esc(t.text)}</p></div>
                    <button type="button" class="cpl-vlink wc-band-open" data-wc="run" data-id="${esc(t.id)}">${esc(t.open)}</button>
                </div>`;
            }
        }
        const f = facts || {};
        const v = (x) => (x ? esc(x) : '<span class="wc-na">Checking...</span>');
        return `<div class="wc-band">
            <img class="wc-band-logo" src="/static_images/melaton/melaton-orb-system.png" alt="">
            <div class="wc-band-text">
                <h2>${esc(f.edition || 'Melaton')}</h2>
                <p>${esc(f.copyright || '')}</p>
                <div class="wc-facts">
                    <span>Processor:</span><span>${v(f.processor)}</span>
                    <span>Memory:</span><span>${v(f.memory)}</span>
                    <span>Graphics:</span><span>${v(f.graphics)}</span>
                    <span>Computer name:</span><span>${v(f.computer)}</span>
                </div>
            </div>
            <button type="button" class="cpl-vlink wc-band-open" data-wc="run" data-id="details">Show more details</button>
        </div>`;
    }

    function grid(list, all) {
        const shown = all ? list : list.slice(0, FOLDED);
        return `<div class="wc-grid">${shown.map((t) => `<button type="button" class="wc-task${t.id === selected ? ' is-selected' : ''}" data-wc="pick" data-id="${esc(t.id)}"><img src="${esc(t.icon)}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(t.name)}</span></button>`).join('')}</div>`;
    }

    function section(title, list, all, flag) {
        return `<div class="wc-section">
            <div class="wc-head"><h3>${esc(title)}</h3>${list.length > FOLDED ? `<button type="button" class="cpl-vlink" data-wc="${flag}">${all ? `Show ${FOLDED} items` : `Show all ${list.length} items`}</button>` : ''}</div>
            ${grid(list, all)}
        </div>`;
    }

    const page = {
        parent: 'cat-system',
        kind: 'welcome',
        title: () => 'Welcome Center',
        tasks: () => '',
        body: () => {
            if (!facts) void loadFacts();
            return `<div class="wc-page">
                ${band()}
                ${section('Get started with Melaton', TASKS, showAllTasks, 'all-tasks')}
                ${section('Offers from Xyridian', OFFERS, showAllOffers, 'all-offers')}
                <div class="wc-foot"><input type="checkbox" id="wcRunAtStartup"${reg('RunAtStartup', false) ? ' checked' : ''}><label for="wcRunAtStartup">Run at startup (found in Control Panel System and Maintenance)</label></div>
            </div>`;
        }
    };

    function rerender() {
        const c = cp();
        if (c && c.currentPage() === 'welcome-center') c.navigate('welcome-center', { replace: true });
    }

    function wire() {
        if (!doc || wire.done) return;
        wire.done = true;
        doc.addEventListener('click', (ev) => {
            const t = ev.target.closest && ev.target.closest('#melatonControlPanelModal [data-wc]');
            if (!t) return;
            ev.preventDefault();
            const what = t.dataset.wc;
            if (what === 'pick') {
                selected = selected === t.dataset.id ? null : t.dataset.id;
                rerender();
            } else if (what === 'run') {
                const task = TASKS.concat(OFFERS).find((x) => x.id === t.dataset.id);
                if (task) task.run();
            } else if (what === 'all-tasks') {
                showAllTasks = !showAllTasks;
                rerender();
            } else if (what === 'all-offers') {
                showAllOffers = !showAllOffers;
                rerender();
            }
        });
        // a double-click opens the task, as Vista's folder does
        doc.addEventListener('dblclick', (ev) => {
            const t = ev.target.closest && ev.target.closest('#melatonControlPanelModal .wc-task');
            if (!t) return;
            const task = TASKS.concat(OFFERS).find((x) => x.id === t.dataset.id);
            if (task) task.run();
        });
        doc.addEventListener('change', (ev) => {
            if (ev.target && ev.target.id === 'wcRunAtStartup' && root.melatonRegistry) void root.melatonRegistry.set(KEY, { RunAtStartup: ev.target.checked });
        });
    }

    function register() {
        const c = cp();
        if (!c) return false;
        c.registerPage('welcome-center', page);
        wire();
        return true;
    }

    async function openWelcomeCenter() {
        if (root.featureLoader) await root.featureLoader.loadFeature('control_panel');
        register();
        selected = null;
        cp().open('welcome-center');
    }

    /** Run at startup: once per logon, after the desktop is ready. */
    function startupCheck() {
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            const state = typeof root.getClientDesktopState === 'function' ? root.getClientDesktopState() : null;
            if (state !== 'desktop' && tries < 240) return;
            clearInterval(timer);
            if (state !== 'desktop') return;
            let shown = false;
            try { shown = root.sessionStorage.getItem('welcomeCenterShown') === '1'; } catch (_) { /* none */ }
            if (shown || !reg('RunAtStartup', false)) return;
            try { root.sessionStorage.setItem('welcomeCenterShown', '1'); } catch (_) { /* none */ }
            void openWelcomeCenter();
        }, 1000);
    }

    root.openWelcomeCenter = openWelcomeCenter;
    root.welcomeCenter = { open: openWelcomeCenter, register, TASKS, OFFERS, startupCheck };
    register();
    if (doc && !root.__welcomeCenterBoot) {
        root.__welcomeCenterBoot = true;
        startupCheck();
    }
})(typeof window !== 'undefined' ? window : globalThis);
