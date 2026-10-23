/**
 * Welcome Center (Yozora #632): Vista's oobefldr.dll folder, 1:1 from the VM (UIFILE 2 and 3, the
 * task list XML 1, string table, bitmaps 100-107, shell32's FTR 201 flare), Windows -> Melaton and
 * Microsoft -> Xyridian:
 *
 *   the band (196 px)   bitmap 102 stretched, PreviewFlare on the right, then either
 *                       the details: title band (bitmap 104) with the account picture (frame 103)
 *                       and name, the computer picture, edition / processor / memory / graphics /
 *                       computer name, "Show more details", and "welcome" (Segoe UI 56 pt) fading
 *                       in after a long delay;
 *                       or the selected task's preview: its 128 px picture, title, paragraphs and
 *                       bullets, and its start link
 *   the list            "1. Get started with Melaton (13)", "2. Offers from Xyridian (7)": 48 px
 *                       items in 223 px columns, two rows until "Show all N items..."
 *   the footer          Run at startup: HKCU\...\Welcome Center\RunAtStartup (Melaton starts with it
 *                       off; Vista's default is on)
 *
 * Timing (VM recordings, window animation off): the band's text is there at once and the computer
 * picture grows from its top-left corner; the flare is shell32 FTR 201 replayed from its own frames
 * (flare.png: frame minus band, plus-lighter over it), ending on its resting lines; "welcome" fades
 * to its 27% from 1.6 s to 3.0 s. A new selection drops the old content at once, fades the new in
 * (DUI "fast") and grows its picture; the flare does not replay.
 *
 *   openWelcomeCenter()
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Welcome Center';
    const ART = '/static_images/vista-welcome';

    // FTR 201, as recorded: frame i shows from FLARE_TIMES[i] ms after the band appears; the last
    // frame is the flare at rest (its lines stay on the band)
    const FLARE_TIMES = [0, 45, 98, 165, 197, 226, 294, 346, 389, 397, 450, 466, 512, 528, 579, 593, 671, 679, 718, 740, 795, 804, 844, 912, 954, 1005, 1055, 1162];
    const FLARE_H = 192;

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

    function icon(id, size) {
        return `${ART}/task-${id}-${size}.png`;
    }

    // "Windows Vista Ultimate" lines name the edition (cplSystem.js)
    function edition() {
        return (facts && facts.edition) || 'Melaton';
    }

    // oobefldr.dll XML 1, the tasks Vista Ultimate shows on a workgroup PC, in sortPriority order
    const TASKS = [
        { id: 'details', name: 'View computer details', tip: 'View information about your computer including the model, manufacturer, processor, memory, and Melaton edition.', run: () => cp().doAction('item:system') },
        {
            id: 'transfer', name: 'Transfer files and settings', tip: 'Use Melaton Easy Transfer to move files and settings from one computer to another.',
            title: 'Melaton Easy Transfer', start: 'Start Melaton Easy Transfer',
            body: [['Transfer files and settings from one computer to another.'], ['You can transfer:'], ['User accounts', 1], ['Files and folders', 1], ['Program settings', 1], ['Internet settings and favorites', 1], ['E-mail settings, contacts, and messages', 1]],
            run: () => callGlobal('openVistaImportWizard') || launch('import')
        },
        {
            id: 'users', name: 'Add new users', tip: 'Add user accounts to your computer.',
            title: 'Add new users', start: 'Add user accounts',
            body: [['Each person using this computer can have a user account with personal settings.'], ['With user accounts you can:'], ['Help secure and protect your computer', 1], ['Customize settings for the time you spend on the computer', 1], ['Set up Parental Controls', 1]],
            run: () => cp().doAction('item:user-accounts')
        },
        {
            id: 'internet', name: 'Connect to the Internet', tip: 'Get assistance with setting up a connection to the Internet.',
            title: 'Connect to the Internet', start: 'Connect to the Internet',
            body: [['Follow the steps to set up an Internet connection.'], ['Have your Internet service provider (ISP) information ready before you start. If you don\'t have an ISP yet, the wizard can help you get one.']],
            run: () => cp().open('network')
        },
        {
            id: 'whatsnew', name: 'What\'s new in Melaton', tip: 'Discover new features that can help you be more productive, stay safe, and have fun.',
            title: () => `What's new in ${edition()}`, start: 'See more new features',
            body: [['Search from within folders', 1], ['Organize files in new ways', 1], ['Keep devices in sync', 1], ['Back up and encrypt files', 1], ['Fax and scan documents', 1], ['Start, join, and broadcast online meetings', 1], ['View, edit, and organize pictures', 1], ['Get mobile PC capabilities', 1], ['Use improved networking features', 1], ['Provide guidance with Parental Controls', 1]],
            run: () => cp().doAction('page:update')
        },
        {
            id: 'personalize', name: 'Personalize Melaton', tip: 'Change your desktop background, change your screen saver, and add another monitor.',
            title: 'Personalize Melaton', start: 'Personalize Melaton',
            body: [['Customize features-for example, you can:'], ['Change your desktop background', 1], ['Change your screen saver', 1], ['Add or change sounds', 1], ['Change fonts', 1]],
            run: () => cp().doAction('item:personalization')
        },
        {
            id: 'register', name: 'Register Melaton online', tip: 'Register Melaton online to get more value and benefits, including the latest tips and tools.',
            title: 'Register Melaton', start: 'Register Melaton online',
            body: [[() => `Register online to get the most out of ${edition()}.`]],
            run: () => cp().doAction('item:system')
        },
        {
            id: 'mediacenter', name: 'Melaton Media Center', tip: 'Set up Melaton Media Center so you can watch television and DVDs, listen to music, and experience the latest online entertainment.',
            title: 'Set up Melaton Media Center', start: 'Set up Melaton Media Center',
            body: [['With Melaton Media Center you can:'], ['Watch, pause, and record television', 1], ['Explore and listen to music', 1], ['View, edit, and share your photos', 1], ['Play DVDs and digital videos', 1]],
            run: () => launch('media-player')
        },
        {
            id: 'basics', name: 'Melaton Basics', tip: 'Learn the basics of using Melaton, including how to use the mouse and keyboard, and how to work with files and folders.',
            title: 'Melaton Basics', start: 'Open Melaton Basics',
            body: [['Learn how to:'], ['Use the mouse and keyboard', 1], ['Work with files and programs', 1], ['Use e-mail', 1], ['Connect to and explore the Internet', 1], ['Help keep your computer more secure', 1], ['Work with digital pictures', 1]],
            run: () => callGlobal('openHelpAndSupport', 'basics')
        },
        {
            id: 'access', name: 'Ease of Access Center', tip: 'Make your computer easier to see, hear, and use.',
            title: 'Ease of Access Center', start: 'Open Ease of Access Center',
            body: [['Make your computer easier to see, hear, and use. Adjust the visual display, use an input device, get recommendations for settings, and more.']],
            run: () => cp().doAction('item:ease-of-access')
        },
        {
            id: 'backup', name: 'Back Up and Restore Center', tip: 'Save copies of your files to a CD, DVD, hard disk, or USB flash drive.',
            title: 'Back Up and Restore Center', start: 'Open Back Up and Restore Center',
            body: [['Automatically save copies of your photos, music, and other files to a CD, DVD, hard disk, USB flash drive, or file server. Once a backup is set up, it runs on the schedule you choose.'], ['Or use CompletePC Backup to save a full image of your computer, which you can use to recover from a problem such as a hardware failure.']],
            run: () => cp().doAction('item:backup')
        },
        {
            id: 'demos', name: 'Melaton Demos', tip: 'Watch video demos to learn how to get started with Melaton.',
            title: 'Melaton Demos', start: 'Open Melaton Demos',
            body: [['Watch video demos to learn how to:'], ['Work with programs, files, and folders', 1], ['Use e-mail and the Internet', 1], ['Print documents', 1], ['Help keep your computer more secure', 1], ['Set up user accounts', 1], ['Solve problems using Help', 1]],
            run: () => callGlobal('openHelpAndSupport', 'demos')
        },
        {
            id: 'cpl', name: 'Control Panel', tip: 'Use Control Panel to add, remove, or change something on your computer.',
            title: 'Control Panel', start: 'Open Control Panel',
            body: [['Use Control Panel to change your computer\'s settings. To find what you\'re looking for, use the new Search box or click the links under each category.']],
            run: () => cp().open('home')
        }
    ];

    // Vista's offers (Windows Live, Marketplace, support) lead to the Dreamscape services
    const OFFERS = [
        {
            id: 'live', name: 'Go online to learn about Melaton Live', tip: 'Learn about Melaton Live: an innovative set of products and services that brings your online world together.',
            title: 'Melaton Live', start: 'Learn more online',
            body: [['Melaton Live is an innovative set of services that brings your online world together. Finally, the information you need, the people you care about, and powerful protection-all at your fingertips.'], ['Go online to learn how Melaton Live products and services can help you:'], ['Find the information you\'re looking for, fast', 1], ['Connect and share with friends and family', 1], ['Protect your PC', 1]],
            run: () => callGlobal('openDsapInGrimoire', 'dsap://dreamscape.jp/')
        },
        {
            id: 'search', name: 'Go online to find it fast with Melaton Live', tip: 'Search your way. Get all the search tools you need in one place with Melaton Live.',
            title: 'Find it fast with Melaton Live', start: 'Learn more online',
            body: [['Search your way. Get all the search tools you need in one place. Find images quickly and get detailed maps and directions together with local business listings.']],
            run: () => callGlobal('openGrimoireApplet')
        },
        {
            id: 'onecare', name: 'Go online to help protect your PC with Melaton Live', tip: 'Help protect your PC and keep it running smoothly with Melaton Live.',
            title: 'Help protect your PC with Melaton Live', start: 'Learn more online',
            body: [['Help protect your PC and keep it running smoothly with an innovative set of products and services from Melaton Live. Spend less time worrying about your PC and more time connecting with the people, interests, and information you care about most.']],
            run: () => callGlobal('openDsapInGrimoire', 'dsap://security.dreamscape.jp/')
        },
        {
            id: 'market', name: 'Go online to Melaton Marketplace', tip: 'Go online to Melaton Marketplace to browse the large selection of software and hardware for your Melaton PC.',
            title: 'Melaton Marketplace', start: 'Go online to Melaton Marketplace',
            body: [['Melaton Marketplace makes it easy to try, buy, and download software. Browse the large selection of software and hardware at Melaton Marketplace and use the resources (reviews, compatibility information, and more) to find exactly what you want. Melaton Marketplace enables you to purchase and download your software in a secure environment.']],
            run: () => callGlobal('openDsapInGrimoire', 'dsap://vibes.novelai.net')
        },
        {
            id: 'share', name: 'Go online to connect and share with Melaton Live', tip: 'Connect with friends and express yourself with Melaton Live.',
            title: 'Connect and share with Melaton Live', start: 'Learn more online',
            body: [['Instantly connect with friends using text, voice, and video. Start your own blog in minutes and easily share photos. Get fast, simple e-mail. Everything works together smoothly. Communicate and share like never before with Melaton Live.']],
            run: () => launch('dovecote')
        },
        {
            id: 'protect', name: 'Go online to find more ways to help protect your PC', tip: 'Help protect your PC and keep it running smoothly.',
            title: 'Find more ways to help protect your PC', start: 'Learn more online',
            body: [['Help protect your PC from security threats. Go online to learn more and find a solution that meets your needs.']],
            run: () => cp().doAction('item:security-center')
        },
        {
            id: 'support', name: 'Sign up online for technical support', tip: 'Sign up to get technical assistance from Xyridian experts.',
            title: 'Xyridian technical support', start: 'Sign up online for technical support',
            body: [['Choose from a variety of technical support packages from Xyridian.'], ['Sign up online and connect with Xyridian experts who are ready to help you.']],
            run: () => callGlobal('openHelpAndSupport')
        }
    ];

    const GROUPS = [
        { id: 'tasks', title: 'Get started with Melaton', list: TASKS },
        { id: 'offers', title: 'Offers from Xyridian', list: OFFERS }
    ];

    const COL_W = 223; // a cell and its gap, as the VM's 220 x 50 items sit
    const ROWS_SHOWN = 2;

    let selected = null;
    const expanded = {};
    const collapsed = {};
    let facts = null;
    let factsLoading = false;
    let mounted = null; // { main, timers: [], raf, ro }

    function findTask(id) {
        return TASKS.concat(OFFERS).find((x) => x.id === id) || null;
    }

    function val(v) {
        return typeof v === 'function' ? v() : v;
    }

    function formatMemory(mem) {
        const m = /^([\d.]+)\s*(GB|MB)/i.exec(String(mem || ''));
        if (!m) return mem ? `${mem} RAM` : '';
        const gb = m[2].toUpperCase() === 'MB' ? Number(m[1]) / 1024 : Number(m[1]);
        return `${gb.toFixed(2)} GB RAM`;
    }

    async function loadFacts() {
        if (facts || factsLoading) return;
        factsLoading = true;
        let version = null;
        let sys = null;
        try {
            if (typeof root.loadMeletonVersionInfo === 'function') version = await root.loadMeletonVersionInfo();
            sys = version && version.systemInfo;
            const ws = root.wsClient;
            if (!sys && ws && ws.isConnected && ws.isConnected()) sys = await ws.sendMessage('get_system_info', {});
        } catch (_) { /* below */ }
        const T = root.cplSystem && root.cplSystem._test;
        const ed = T ? T.edition(version, sys) : { name: 'Melaton' };
        const host = T && sys ? T.hostFacts(sys) : {};
        let gpu = '';
        try { gpu = root.melatonDeviceManager ? root.melatonDeviceManager.gpuName() : ''; } catch (_) { /* none */ }
        facts = { edition: ed.name, processor: host.processor || '', memory: formatMemory(host.memory), graphics: gpu, computer: String(host.hostname || '').toUpperCase() };
        factsLoading = false;
        if (mounted && !selected) {
            const box = mounted.main.querySelector('.wc-facts');
            if (box) box.innerHTML = factsHtml();
        }
    }

    function factsHtml() {
        const f = facts || {};
        const lines = [f.edition || 'Melaton', f.processor, f.memory, f.graphics, f.computer ? `Computer Name: ${f.computer}` : ''];
        return lines.map((l) => `<div class="wc-fact">${esc(l || '')}</div>`).join('');
    }

    function accountName() {
        const a = root.meletonAccounts;
        return a ? a.name() : '';
    }

    function accountPicture() {
        const a = root.meletonAccounts;
        return a ? a.pictureUrl() : '';
    }

    function detailsHtml() {
        return `<div class="wc-band-content wc-details">
            <div class="wc-titleband">
                <span class="wc-userframe"><img class="wc-userpic" src="${esc(accountPicture())}" alt="" draggable="false" onerror="this.style.visibility='hidden'"></span>
                <span class="wc-username">${esc(accountName())}</span>
            </div>
            <img class="wc-pic wc-computerpic" src="${icon('details', 128)}" alt="Computer" draggable="false">
            <button type="button" class="wc-command wc-more" data-wc="more"><span class="wc-glyph"></span><span class="wc-command-text">Show more details</span></button>
            <div class="wc-facts">${factsHtml()}</div>
        </div>`;
    }

    function previewHtml(t) {
        const body = (t.body || []).map(([text, bullet]) => `<div class="wc-para${bullet ? ' is-bullet' : ''}">${esc(val(text))}</div>`).join('');
        return `<div class="wc-band-content wc-preview">
            <img class="wc-pic wc-previewpic" src="${icon(t.id, 128)}" alt="" draggable="false">
            <div class="wc-preview-title">${esc(val(t.title))}</div>
            <div class="wc-preview-main">${body}</div>
            <button type="button" class="wc-command wc-start" data-wc="run" data-id="${esc(t.id)}"><span class="wc-glyph"></span><span class="wc-command-text">${esc(val(t.start))}</span></button>
        </div>`;
    }

    function itemHtml(t) {
        return `<div class="wc-item${t.id === selected ? ' is-selected' : ''}" role="option" tabindex="-1" data-wc="pick" data-id="${esc(t.id)}" title="${esc(t.tip)}">
            <img src="${icon(t.id, 48)}" alt="" draggable="false"><span class="wc-item-label">${esc(t.name)}</span>
        </div>`;
    }

    function groupHtml(g, n) {
        return `<div class="wc-group${collapsed[g.id] ? ' is-collapsed' : ''}${expanded[g.id] ? ' is-expanded' : ''}" data-group="${g.id}">
            <div class="wc-group-head"><span class="wc-group-title">${n}. ${esc(g.title)} (${g.list.length})</span><button type="button" class="wc-group-toggle" data-wc="collapse" aria-label="Collapse"></button></div>
            <div class="wc-items">${g.list.map(itemHtml).join('')}</div>
            <div class="wc-showall"><button type="button" class="wc-showall-link" data-wc="all">Show all ${g.list.length} items...</button></div>
        </div>`;
    }

    const page = {
        kind: 'welcome',
        title: () => 'Welcome Center',
        tasks: () => '',
        body: () => {
            void loadFacts();
            const t = selected && selected !== 'details' ? findTask(selected) : null;
            return `<div class="wc-page">
                <div class="wc-band">
                    <div class="wc-band-bg"></div>
                    <div class="wc-flare" aria-hidden="true"></div>
                    <div class="wc-welcome" aria-hidden="true">welcome</div>
                    <div class="wc-band-host">${t ? previewHtml(t) : detailsHtml()}</div>
                </div>
                <div class="wc-view" role="listbox">${GROUPS.map((g, i) => groupHtml(g, i + 1)).join('')}</div>
                <div class="wc-foot"><input type="checkbox" id="wcRunAtStartup"${reg('RunAtStartup', false) ? ' checked' : ''}><label for="wcRunAtStartup">Run at startup (Welcome Center can be found in Control Panel, System and Maintenance)</label></div>
            </div>`;
        },
        mount: (main) => {
            mounted = { main, timers: [], raf: 0, ro: null };
            const view = main.querySelector('.wc-view');
            if (view && typeof ResizeObserver === 'function') {
                mounted.ro = new ResizeObserver(() => subset(main));
                mounted.ro.observe(view);
            }
            subset(main);
            playOpen(main);
        },
        unmount: () => {
            stopAnimations();
            if (mounted && mounted.ro) mounted.ro.disconnect();
            mounted = null;
        }
    };

    /** Group subsetting: two rows of the columns that fit, then "Show all N items...". */
    function subset(main) {
        const view = main.querySelector('.wc-view');
        if (!view) return;
        const cols = Math.max(1, Math.floor((view.clientWidth - 6) / COL_W));
        view.style.setProperty('--wc-cols', cols);
        view.querySelectorAll('.wc-group').forEach((g) => {
            const items = g.querySelectorAll('.wc-item');
            const all = expanded[g.dataset.group] || items.length <= cols * ROWS_SHOWN;
            items.forEach((it, i) => { it.hidden = !all && i >= cols * ROWS_SHOWN; });
            g.classList.toggle('has-more', !all);
        });
    }

    function stopAnimations() {
        if (!mounted) return;
        mounted.timers.forEach(clearTimeout);
        mounted.timers = [];
        if (mounted.raf) cancelAnimationFrame(mounted.raf);
        mounted.raf = 0;
    }

    function reducedMotion() {
        return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    /**
     * The band's picture grows from its top-left corner and (details only) "welcome" fades in
     * (VM: from 1.6 s to 3.0 s). On open the text is there at once; a new selection fades it in.
     */
    function animateContent(band, details, opening) {
        const content = band.querySelector('.wc-band-content');
        const pic = band.querySelector('.wc-pic');
        const word = band.querySelector('.wc-welcome');
        word.getAnimations().forEach((a) => a.cancel());
        word.style.opacity = '0';
        if (reducedMotion()) {
            if (details) word.style.opacity = '';
            return;
        }
        if (content && !opening) content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-in-out' });
        if (pic) pic.animate([{ transform: 'scale(0.125)' }, { transform: 'none' }], { duration: 200, delay: opening ? 60 : 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' });
        if (details) {
            word.animate([{ opacity: 0 }, { opacity: 0.267 }], { duration: 1400, delay: 1600, easing: 'ease-in-out', fill: 'forwards' })
                .finished.then(() => { word.style.opacity = ''; }).catch(() => { /* cancelled */ });
        }
    }

    function showFlareFrame(flare, i) {
        flare.style.backgroundPosition = `0 ${-i * FLARE_H}px`;
        flare.style.visibility = 'visible';
    }

    function playFlare(band) {
        const flare = band.querySelector('.wc-flare');
        if (!flare) return;
        if (reducedMotion()) {
            showFlareFrame(flare, FLARE_TIMES.length - 1);
            return;
        }
        const start = performance.now();
        let shown = -1;
        const step = (now) => {
            const t = now - start;
            let i = shown < 0 ? 0 : shown;
            while (i + 1 < FLARE_TIMES.length && FLARE_TIMES[i + 1] <= t) i += 1;
            if (i !== shown) {
                showFlareFrame(flare, i);
                shown = i;
            }
            mounted.raf = i < FLARE_TIMES.length - 1 ? requestAnimationFrame(step) : 0;
        };
        mounted.raf = requestAnimationFrame(step);
    }

    function playOpen(main) {
        const band = main.querySelector('.wc-band');
        if (!band) return;
        stopAnimations();
        animateContent(band, !band.querySelector('.wc-preview'), true);
        playFlare(band);
    }

    /** A new selection: Vista swaps the band's content in place (the flare does not replay). */
    function select(id) {
        if (selected === id) return;
        selected = id;
        if (!mounted) return;
        const main = mounted.main;
        main.querySelectorAll('.wc-item').forEach((it) => it.classList.toggle('is-selected', it.dataset.id === id));
        const band = main.querySelector('.wc-band');
        const host = band && band.querySelector('.wc-band-host');
        if (!host) return;
        const t = id && id !== 'details' ? findTask(id) : null;
        host.innerHTML = t ? previewHtml(t) : detailsHtml();
        animateContent(band, !t, false);
    }

    function wire() {
        if (!doc || wire.done) return;
        wire.done = true;
        const inPage = (ev, sel) => ev.target.closest && ev.target.closest(`#melatonControlPanelModal .wc-page ${sel}`);
        doc.addEventListener('click', (ev) => {
            if (!inPage(ev, '')) return;
            const t = inPage(ev, '[data-wc]');
            if (!t) {
                if (inPage(ev, '.wc-view')) select(null);
                return;
            }
            ev.preventDefault();
            const what = t.dataset.wc;
            if (what === 'pick') select(t.dataset.id);
            else if (what === 'run') {
                const task = findTask(t.dataset.id);
                if (task) task.run();
            } else if (what === 'more') {
                cp().doAction('item:system');
            } else if (what === 'all') {
                const g = t.closest('.wc-group');
                expanded[g.dataset.group] = true;
                g.classList.add('is-expanded');
                if (mounted) subset(mounted.main);
            } else if (what === 'collapse') {
                const g = t.closest('.wc-group');
                collapsed[g.dataset.group] = !collapsed[g.dataset.group];
                g.classList.toggle('is-collapsed', collapsed[g.dataset.group]);
            }
        });
        // a double-click or Enter opens the task, as Vista's folder does
        doc.addEventListener('dblclick', (ev) => {
            const t = inPage(ev, '.wc-item');
            if (!t) return;
            const task = findTask(t.dataset.id);
            if (task) task.run();
        });
        doc.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            const t = inPage(ev, '.wc-item');
            if (!t) return;
            const task = findTask(t.dataset.id);
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
