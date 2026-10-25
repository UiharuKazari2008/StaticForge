/**
 * Control Panel's Vista pages, second set (Yozora #632; cplPages.js has the kit): Performance
 * Information and Tools (the Melaton Experience Index, experienceIndex.js), Problem Reports and
 * Solutions (the server's fault reports, GET /api/fault-reports), Programs and Features (the
 * Start menu's programs), Ease of Access Center (the on-screen keyboard, a narrator over the
 * browser's speech, High Contrast), AutoPlay, Melaton Firewall, BitLocker Drive Encryption,
 * Parental Controls, Sync Center, Melaton SideShow (its devices: modules/slideshowDevices.js) and
 * Melaton CardSpace.
 */
(function (root) {
    'use strict';

    const K = root.cplPages;
    if (!K) return;
    const { tasks, help, handlers, msg, esc, reg } = K;
    const doc = typeof document !== 'undefined' ? document : null;
    const R = () => root.melatonRegistry;
    const CP = () => root.melatonControlPanel;
    const ITEMS = '/static_images/vista-cpl/items';
    const SHIELD = '/static_images/vista-cpl/shield-uac-16.png';

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function nav(id) {
        if (CP()) CP().navigate(id);
    }

    function main() {
        return doc.querySelector('#melatonControlPanelModal .cpl-main');
    }

    function rerender() {
        const cp = CP();
        if (cp && cp.currentPage()) cp.navigate(cp.currentPage(), { replace: true });
    }

    const pages = {};

    // ---- Performance Information and Tools -----------------------------------------------------

    const WEI_ROWS = [
        ['processor', 'Processor:', 'Calculations per second'],
        ['memory', 'Memory (RAM):', 'Memory operations per second'],
        ['graphics', 'Graphics:', 'Desktop performance for Melaton Aero'],
        ['gaming', 'Gaming graphics:', '3D business and gaming graphics performance'],
        ['disk', 'Primary hard disk:', 'Disk data transfer rate']
    ];
    let wei = null;

    function weiNumber(v) {
        return typeof v === 'number' && isFinite(v) ? v.toFixed(1) : '';
    }

    pages.performance = {
        title: () => 'Performance Information and Tools',
        tasks: () => tasks([[
            { t: 'Manage startup programs', a: 'item:windows-defender' },
            { t: 'Adjust visual effects', a: 'item:appearance' },
            { t: 'Adjust indexing options', a: 'item:melaton-search' },
            { t: 'Adjust power settings', a: 'item:power-options' },
            { t: 'Open Disk Cleanup', a: 'js:cleanup' },
            { t: 'Advanced tools', a: 'js:advanced' }
        ]], [{ t: 'Problem Reports and Solutions', a: 'item:problem-reports' }]),
        body: () => {
            const ex = root.meletonExperienceIndex;
            if (!wei && ex) {
                wei = ex.cached && ex.cached();
                if (!wei && ex.assess) ex.assess().then((r) => { wei = r; if (CP() && CP().currentPage() === 'performance') rerender(); }).catch(() => {});
            }
            const scores = (wei && wei.scores) || {};
            const base = wei ? weiNumber(wei.base) : '';
            const lowest = Object.keys(scores).reduce((a, k) => (a === null || scores[k] < scores[a] ? k : a), null);
            return `<div class="cpl-vpage cpl-wei">${help('performance')}
                <h1 class="cpl-vtitle">Rate and improve your computer's performance</h1>
                <p class="cpl-vtext">Not sure where to start? <a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="help" data-topic="performance">Learn how you can improve your computer's performance.</a></p>
                <table class="cpl-wei-table">
                    <tr class="cpl-wei-head"><td>Component</td><td>What is rated</td><td>Subscore</td><td>Base score</td></tr>
                    ${WEI_ROWS.map(([k, comp, what], i) => `<tr${k === lowest ? ' class="is-lowest"' : ''}><td>${esc(comp)}</td><td>${esc(what)}</td><td class="cpl-wei-sub">${weiNumber(scores[k]) || '-'}</td>${i === 0 ? `<td rowspan="5" class="cpl-wei-base"><span class="cpl-wei-badge">${base || '?'}</span><span>Determined by<br>lowest subscore</span></td>` : ''}</tr>`).join('')}
                </table>
                <div class="cpl-wei-links">
                    <a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="help" data-topic="wei">What do these numbers mean?</a>
                    <a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="details">View and print details</a>
                </div>
                <p class="cpl-vtext cpl-vgap">${wei && wei.assessedAt ? `Last update: ${esc(new Date(wei.assessedAt).toLocaleString('en-US'))}` : 'Your scores have not been determined yet.'}</p>
                <div class="cpl-vbuttons is-left"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="rerun"><img src="${SHIELD}" alt=""> Update my score</button></div>
            </div>`;
        }
    };
    handlers.performance = {
        async rerun() {
            const ex = root.meletonExperienceIndex;
            if (!ex || !ex.assess) return;
            try { wei = await ex.assess({ fresh: true }); } catch (_) { /* keep the old one */ }
            rerender();
        },
        details() {
            const d = wei && wei.details ? wei.details : {};
            msg(Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') || 'No details yet.', 'Melaton Experience Index');
        },
        cleanup() { callGlobal('openDataManagementDsap'); },
        advanced() { CP().doAction('page:administrative-tools'); }
    };

    // ---- Problem Reports and Solutions ---------------------------------------------------------

    let faults = null;
    async function loadFaults() {
        try {
            const r = await fetch('/api/fault-reports?limit=100', { credentials: 'same-origin', cache: 'no-store' });
            const j = await r.json();
            faults = (j && j.reports) || [];
        } catch (_) {
            faults = [];
        }
        if (CP() && /^problem-reports/.test(CP().currentPage() || '')) rerender();
    }

    pages['problem-reports'] = {
        title: () => 'Problem Reports and Solutions',
        tasks: () => tasks([[
            { t: 'Check for new solutions', a: 'js:check', icon: '/static_images/vista-cpl/wercon-check.png' },
            { t: 'See problems to check', a: 'page:problem-reports-history' },
            { t: 'View problem history', a: 'page:problem-reports-history' },
            { t: 'Change settings', a: 'page:problem-reports-settings' },
            { t: 'Clear solution and problem history', a: 'js:clear' }
        ]], [{ t: 'Read our privacy statement online', a: 'js:privacy' }, { t: 'Customer Experience Improvement Settings', a: 'page:problem-reports-settings' }], 'Tasks'),
        body: () => {
            const arg = CP() && CP().pageArg('problem-reports');
            if (arg === 'history') setTimeout(() => nav('problem-reports-history'), 0);
            else if (arg === 'settings') setTimeout(() => nav('problem-reports-settings'), 0);
            if (faults === null) void loadFaults();
            const open = (faults || []).filter((f) => f.status !== 'closed');
            return `<div class="cpl-vpage">${help('problem-reports')}
                <h1 class="cpl-vtitle">Solutions to install</h1>
                <p class="cpl-vtext">${faults === null ? 'Checking for solutions...' : open.length ? `Melaton found ${open.length} problem${open.length === 1 ? '' : 's'} reported to the server. A solution will appear here when one is found.` : 'There are no solutions to install.'}</p>
                <h1 class="cpl-vtitle cpl-vgap">Information about other problems</h1>
                ${faults && faults.length ? `<div class="cpl-pr-list">${faults.slice(0, 12).map((f) => `
                    <div class="cpl-pr-row"><img src="/static_images/vista-icons/problem-reports-16.png" alt="" onerror="this.remove()"><div><b>${esc(f.program || 'Melaton Desktop')}</b><br>${esc(f.message || 'Stopped working')}</div><span>${esc(f.lastSeen ? new Date(f.lastSeen).toLocaleDateString('en-US') : '')}</span></div>`).join('')}</div>` : '<p class="cpl-vtext">There is no information about other problems.</p>'}
            </div>`;
        }
    };
    handlers['problem-reports'] = {
        check() { faults = null; rerender(); },
        clear() {
            msg('Problem reports are kept on the Dreamscape server. Ask an administrator to clear them in Periscope.', 'Problem Reports and Solutions');
        },
        privacy() { callGlobal('openHelpAndSupport', 'privacy'); }
    };

    pages['problem-reports-history'] = {
        parent: 'problem-reports',
        title: () => 'Problem History',
        tasks: () => '',
        body: () => {
            if (faults === null) void loadFaults();
            const rows = (faults || []).map((f) => `<tr><td>${esc(f.program || 'Melaton Desktop')}</td><td>${esc(f.message || 'Stopped working')}</td><td>${esc(f.lastSeen ? new Date(f.lastSeen).toLocaleString('en-US') : '')}</td><td>${esc(f.status === 'closed' ? 'Report sent' : 'Solution not found')}</td></tr>`).join('');
            return `<div class="cpl-vpage cpl-vwide">${help('problem-reports')}
                <h1 class="cpl-vtitle">Review your computer's problem history</h1>
                <p class="cpl-vtext">The problems below were reported to the Dreamscape server.</p>
                <table class="cpl-vtable"><tr class="is-head"><td>Product</td><td>Problem</td><td>Date</td><td>Status</td></tr>${rows || '<tr><td colspan="4">No problems found.</td></tr>'}</table>
                <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-action="nav" data-cpl-arg="problem-reports">OK</button></div>
            </div>`;
        }
    };

    const WER = 'HKCU\\Software\\Xyridian\\Melaton\\Windows Error Reporting';
    pages['problem-reports-settings'] = {
        parent: 'problem-reports',
        title: () => 'Problem Reporting Settings',
        tasks: () => '',
        body: () => {
            const v = reg(WER, 'Consent', 'auto');
            const opt = (id, text) => `<div class="cpl-vradio"><input type="radio" name="cpl-wer" id="cpl-wer-${id}" value="${id}"${v === id ? ' checked' : ''}><label for="cpl-wer-${id}">${esc(text)}</label></div>`;
            return `<div class="cpl-vpage">${help('problem-reports')}
                <h1 class="cpl-vtitle">Choose how to check for solutions to computer problems</h1>
                <p class="cpl-vtext">When a problem occurs, Melaton can check for solutions automatically or ask you each time.</p>
                ${opt('auto', 'Check for solutions automatically (recommended)')}
                ${opt('ask', 'Ask me to check if a problem occurs')}
                <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="ok">OK</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-action="nav" data-cpl-arg="problem-reports">Cancel</button></div>
            </div>`;
        }
    };
    handlers['problem-reports-settings'] = {
        async ok() {
            const v = main().querySelector('input[name="cpl-wer"]:checked');
            if (v && R()) await R().set(WER, { Consent: v.value });
            nav('problem-reports');
        }
    };

    // ---- Programs and Features -----------------------------------------------------------------

    const UNINSTALL = 'HKLM\\Software\\Xyridian\\Melaton\\CurrentVersion\\Uninstall';

    function programs() {
        const list = typeof root.collectStartMenuLaunchableDescriptors === 'function' ? root.collectStartMenuLaunchableDescriptors() : [];
        const hidden = reg(UNINSTALL, 'Hidden', []);
        return list.filter((p) => p.text && !hidden.includes(p.launchId)).map((p) => ({
            id: p.launchId,
            name: p.text,
            icon: p.imageIcon && typeof root.resolveAppIconPath === 'function' ? root.resolveAppIconPath(p.imageIcon, 16) : `${ITEMS}/programs-and-features-16.png`,
            publisher: /^(Studio|Gallery|Dovecote|Notion|Grimoire|Lumen|Glancewell|Ledge|Agora|Atelier|Spellcaster|Phasewalker|Director|Chat|Periscope|Runes|Cartograph|eMotion)/i.test(p.text) ? 'Dreamscape' : 'Xyridian Corporation'
        })).sort((a, b) => a.name.localeCompare(b.name));
    }

    pages.programs = {
        title: () => 'Programs and Features',
        tasks: () => tasks([[
            { t: 'View installed updates', a: 'page:programs-updates' },
            { t: 'Get new programs online at Melaton Marketplace', a: 'item:get-programs' },
            { t: 'View purchased software (digital locker)', a: 'item:get-programs' },
            { t: 'Turn Melaton features on or off', a: 'js:features', s: true }
        ]], [], 'Tasks'),
        body: () => {
            const arg = CP() && CP().pageArg('programs');
            if (arg === 'updates') setTimeout(() => nav('programs-updates'), 0);
            else if (arg === 'features') setTimeout(() => handlers.programs.features(), 0);
            // Organize > Sort By and the headers (cplPages3.js cplSort)
            const S = root.cplSort;
            const PCOLS = ['Name', 'Publisher', 'Installed On', 'Size'];
            if (S) S.columns('programs', PCOLS);
            const installed = new Date().toLocaleDateString('en-US');
            const list = S ? S.sortRows('programs', programs(), (p, i) => [p.name, p.publisher, installed, ''][i]) : programs();
            const sel = handlers.programs.sel;
            // the VM's: the title and text, a light command bar across the pane (Organize, Views, Help
            // at its right end), then the list view to the pane's edges with its column lines
            const W = [320, 192, 80, 80];
            // unsorted, the list is by Name: its header shows that (the VM)
            const sortCol = (() => { const m = S ? PCOLS.findIndex((t, i) => S.headMark('programs', i)) : -1; return m < 0 ? 0 : m; })();
            const mark = (i) => (S && S.headMark('programs', i)) || (i === sortCol && !(S && PCOLS.some((t, k) => S.headMark('programs', k))) ? ' is-sorted is-asc' : '');
            let x = 0;
            const stops = W.map((w, i) => { const from = x; x += w; return `${i === sortCol ? '#fff' : '#fcfcfc'} ${from}px ${x - 1}px, #ededed ${x - 1}px ${x}px`; });
            const lines = `linear-gradient(to right, ${stops.join(', ')}, #fcfcfc ${x}px)`;
            const drop = '<img class="cpl-pf-drop" src="/static_images/vista-cpl/pf-drop.png" alt="">';
            return `<div class="cpl-vpage cpl-pf">
                <div class="cpl-pf-head">
                    <h1 class="cpl-vtitle">Uninstall or change a program</h1>
                    <p class="cpl-vtext">To uninstall a program, select it from the list and then click "Uninstall", "Change", or "Repair".</p>
                </div>
                <div class="cpl-pf-bar" role="toolbar">
                    <button type="button" class="cpl-pf-cmd" data-cpl-vpage="organize"><img src="/static_images/vista-explorer/organize.png" alt="">Organize${drop}</button>
                    <button type="button" class="cpl-pf-cmd" data-cpl-vpage="views"><img src="/static_images/vista-explorer/views-details.png" alt="">Views${drop}</button>
                    ${sel ? '<button type="button" class="cpl-pf-cmd" data-cpl-vpage="uninstall">Uninstall</button>' : ''}
                    <button type="button" class="cpl-pf-cmd cpl-pf-help" data-cpl-vpage="help" data-topic="programs" title="Get help"><img src="/static_images/vista-cpl/pf-help.png" alt=""></button>
                </div>
                <div class="cpl-pf-list cpl-flist" style="background:${lines}">
                    <div class="cpl-flist-head">${PCOLS.map((t, i) => `<span class="cpl-flist-col${mark(i)}" data-cpl-vpage="sortcol" data-col="${i}" style="width:${W[i]}px">${t}</span>`).join('')}<span class="cpl-flist-rest"></span></div>
                    <div class="cpl-flist-rows">${list.map((p) => `<div class="cpl-frow${p.id === sel ? ' is-selected' : ''}" data-cpl-vpage="pick" data-prog="${esc(p.id)}" tabindex="0"><span style="width:${W[0]}px"><img src="${esc(p.icon)}" alt="" onerror="this.style.visibility='hidden'">${esc(p.name)}</span><span style="width:${W[1]}px">${esc(p.publisher)}</span><span style="width:${W[2]}px">${esc(installed)}</span><span class="is-num" style="width:${W[3]}px"></span></div>`).join('')}</div>
                </div>
            </div>`;
        }
    };
    handlers.programs = {
        sel: null,
        pick(t) { handlers.programs.sel = t.dataset.prog; rerender(); },
        async uninstall() {
            const id = handlers.programs.sel;
            const p = programs().find((x) => x.id === id);
            if (!p) return;
            const ok = await callGlobal('showConfirmationDialog', `<p>Are you sure you want to uninstall ${esc(p.name)}?</p><p>Melaton removes it from the Start menu. You can bring it back from Turn Melaton features on or off.</p>`, [
                { text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }
            ], null, { title: 'Programs and Features', width: 380 });
            if (!ok || !R()) return;
            await R().set(UNINSTALL, { Hidden: reg(UNINSTALL, 'Hidden', []).concat([id]) });
            handlers.programs.sel = null;
            rerender();
        },
        organize() {},
        views() {},
        features() { openFeatures(); }
    };

    /** Turn Melaton features on or off: the programs Programs and Features hid come back here. */
    function openFeatures() {
        const hidden = reg(UNINSTALL, 'Hidden', []);
        const all = typeof root.collectStartMenuLaunchableDescriptors === 'function' ? root.collectStartMenuLaunchableDescriptors() : [];
        const ids = new Set(all.map((p) => p.launchId));
        const extra = hidden.filter((h) => !ids.has(h));
        const rows = all.map((p) => `<label class="cpl-feat-row"><input type="checkbox" value="${esc(p.launchId)}"${hidden.includes(p.launchId) ? '' : ' checked'}> ${esc(p.text)}</label>`).concat(extra.map((h) => `<label class="cpl-feat-row"><input type="checkbox" value="${esc(h)}"> ${esc(h)}</label>`));
        callGlobal('showConfirmationDialog', `<p>To turn a feature on, select its check box. To turn a feature off, clear its check box.</p><div class="cpl-feat-list">${rows.join('')}</div>`, [
            { text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
        ], null, {
            title: 'Melaton Features', width: 420,
            resolveValue: (v, dialog) => (v ? Array.from(dialog.querySelectorAll('.cpl-feat-row input')).filter((i) => !i.checked).map((i) => i.value) : null)
        }).then(async (off) => {
            if (!off || !R()) return;
            await R().set(UNINSTALL, { Hidden: off });
            rerender();
        });
    }

    pages['programs-updates'] = {
        parent: 'programs',
        title: () => 'Installed Updates',
        tasks: () => tasks([[{ t: 'Uninstall a program', a: 'item:programs' }, { t: 'Turn Melaton features on or off', a: 'js:features', s: true }]], [], 'Tasks'),
        body: () => `<div class="cpl-vpage cpl-vwide">${help('programs')}
            <h1 class="cpl-vtitle">Uninstall an update</h1>
            <p class="cpl-vtext">Melaton's updates come from the Dreamscape server. <a href="#" class="cpl-vlink is-underlined" data-cpl-action="do" data-cpl-arg="page:update">See them in Melaton Update.</a></p>
        </div>`
    };
    handlers['programs-updates'] = { features() { openFeatures(); } };

    // ---- Ease of Access Center -----------------------------------------------------------------

    const ACCESS = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Accessibility';
    const ACCESS_PAGES = {
        vision: { title: 'Make the computer easier to see', opts: [
            ['HighContrast', 'Turn on High Contrast (left Alt + left Shift + Print Screen)'],
            ['Narrator', 'Turn on Narrator'],
            ['AudioDescription', 'Turn on Audio Description'],
            ['Magnifier', 'Turn on Magnifier'],
            ['ThickFocus', 'Make the focus rectangle thicker'],
            ['NoAnimations', 'Turn off all unnecessary animations (when possible)'],
            ['NoBackground', 'Remove background images (where available)']] },
        reader: { title: 'Use the computer without a display', opts: [
            ['Narrator', 'Turn on Narrator'], ['AudioDescription', 'Turn on Audio Description']] },
        mouse: { title: 'Make the mouse easier to use', opts: [
            ['MouseKeys', 'Turn on Mouse Keys'], ['HoverActivate', 'Activate a window by hovering over it with the mouse'],
            ['NoSnap', 'Prevent windows from being automatically arranged when moved to the edge of the screen']] },
        keyboard: { title: 'Make the keyboard easier to use', opts: [
            ['MouseKeys', 'Turn on Mouse Keys'], ['StickyKeys', 'Turn on Sticky Keys'], ['ToggleKeys', 'Turn on Toggle Keys'],
            ['FilterKeys', 'Turn on Filter Keys'], ['UnderlineAccess', 'Underline keyboard shortcuts and access keys']] },
        sounds: { title: 'Use text or visual alternatives for sounds', opts: [
            ['SoundSentry', 'Turn on visual notifications for sounds (Sound Sentry)'], ['ShowSounds', 'Turn on text captions for spoken dialog (when available)']] },
        focus: { title: 'Make it easier to focus on tasks', opts: [
            ['Narrator', 'Turn on Narrator'], ['NoAnimations', 'Turn off all unnecessary animations (when possible)'],
            ['NoBackground', 'Remove background images (where available)']] }
    };

    const QUICK = [
        ['magnifier', 'Start Magnifier'], ['osk', 'Start On-Screen Keyboard'],
        ['narrator', 'Start Narrator'], ['contrast', 'Set up High Contrast']
    ];

    pages['ease-of-access'] = {
        title: () => 'Ease of Access Center',
        tasks: () => tasks([[
            { t: 'Change administrative settings', a: 'js:admin', s: true }
        ]], [{ t: 'Learn about additional assistive technologies online', a: 'js:online' }], 'Tasks'),
        body: () => {
            const arg = CP() && CP().pageArg('ease-of-access');
            if (arg && ACCESS_PAGES[arg]) setTimeout(() => { handlers['ease-of-access-page'].which = arg; nav('ease-of-access-page'); }, 0);
            const explore = [
                ['vision', 'Use the computer without a display', 'Optimize for blindness'],
                ['vision', 'Make the computer easier to see', 'Optimize visual display'],
                ['keyboard', 'Use the computer without a mouse or keyboard', 'Set up alternative input devices'],
                ['mouse', 'Make the mouse easier to use', 'Adjust settings for the mouse or other pointing devices'],
                ['keyboard', 'Make the keyboard easier to use', 'Adjust settings for the keyboard'],
                ['sounds', 'Use text or visual alternatives for sounds', 'Set up alternatives for sounds'],
                ['focus', 'Make it easier to focus on tasks', 'Adjust settings for reading and typing']
            ];
            return `<div class="cpl-vpage cpl-vwide">${help('ease-of-access')}
                <h1 class="cpl-vtitle">Make your computer easier to use</h1>
                <div class="cpl-ea-quick">
                    <p class="cpl-vtext"><b>Quick access to common tools</b></p>
                    <p class="cpl-vtext">You can use the tools in this section to help you get started.</p>
                    <div class="cpl-ea-tools">${QUICK.map(([id, t]) => `<button type="button" class="cpl-ea-tool" data-cpl-vpage="quick" data-tool="${id}"><span class="cpl-ea-tool-icon is-${id}"></span><span class="cpl-vlink">${esc(t)}</span></button>`).join('')}</div>
                </div>
                <div class="cpl-ea-row"><button type="button" class="cpl-vlink" data-cpl-vpage="questionnaire">Not sure where to start? Get recommendations to make your computer easier to use</button></div>
                <div class="cpl-vsection"><span>Explore all settings</span></div>
                <p class="cpl-vtext">When you select these settings, they will automatically start each time you log on.</p>
                ${explore.map(([id, t, d]) => `<div class="cpl-ea-row"><button type="button" class="cpl-vlink" data-cpl-vpage="explore" data-which="${id}">${esc(t)}</button><p class="cpl-vtext">${esc(d)}</p></div>`).join('')}
            </div>`;
        }
    };

    /** The desktop-wide settings take effect at once (melatonAccessibility.js). */
    function applyAccess() {
        if (root.melatonAccessibility) root.melatonAccessibility.apply();
    }

    handlers['ease-of-access'] = {
        quick(t) {
            switch (t.dataset.tool) {
                case 'osk': callGlobal('setVirtualKeyboardEnabled', true); callGlobal('showVirtualKeyboard'); break;
                case 'narrator':
                    if (R()) void R().set(ACCESS, { Narrator: !reg(ACCESS, 'Narrator', false) });
                    break;
                case 'magnifier':
                    if (R()) void R().set(ACCESS, { Magnifier: !reg(ACCESS, 'Magnifier', false) });
                    if (typeof root.openMagnifier === 'function') root.openMagnifier();
                    break;
                case 'contrast':
                    handlers['ease-of-access-page'].which = 'vision';
                    nav('ease-of-access-page');
                    break;
                default: break;
            }
        },
        explore(t) { handlers['ease-of-access-page'].which = t.dataset.which; nav('ease-of-access-page'); },
        questionnaire() { handlers['ease-of-access-page'].which = 'vision'; nav('ease-of-access-page'); },
        admin() { msg('Ease of Access settings apply to your account on every computer you log on to.', 'Ease of Access Center'); },
        online() { callGlobal('openHelpAndSupport', 'ease-of-access'); }
    };

    pages['ease-of-access-page'] = {
        parent: 'ease-of-access',
        title: () => (ACCESS_PAGES[handlers['ease-of-access-page'].which] || ACCESS_PAGES.vision).title,
        tasks: () => '',
        body: () => {
            const p = ACCESS_PAGES[handlers['ease-of-access-page'].which] || ACCESS_PAGES.vision;
            return `<div class="cpl-vpage">${help('ease-of-access')}
                <h1 class="cpl-vtitle">${esc(p.title)}</h1>
                <p class="cpl-vtext">When you select these settings, they will automatically start each time you log on.</p>
                ${p.opts.map(([n, t]) => `<div class="cpl-vcheck"><input type="checkbox" id="cpl-ea-${n}" data-access="${n}"${reg(ACCESS, n, false) ? ' checked' : ''}><label for="cpl-ea-${n}">${esc(t)}</label></div>`).join('')}
                ${handlers['ease-of-access-page'].which === 'keyboard' ? `<p class="cpl-vtext cpl-vgap"><a href="#" class="cpl-vlink is-underlined" data-cpl-action="nav" data-cpl-arg="keyboard">Set up the On-Screen Keyboard</a></p>` : ''}
                <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="save">OK</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-action="nav" data-cpl-arg="ease-of-access">Cancel</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="apply">Apply</button></div>
            </div>`;
        }
    };
    handlers['ease-of-access-page'] = {
        which: 'vision',
        async apply() {
            const values = {};
            main().querySelectorAll('[data-access]').forEach((i) => { values[i.dataset.access] = i.checked; });
            if (R()) await R().set(ACCESS, values);
            applyAccess();
        },
        async save() {
            await handlers['ease-of-access-page'].apply();
            nav('ease-of-access');
        }
    };

    // ---- AutoPlay ------------------------------------------------------------------------------

    const AUTOPLAY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Explorer\\AutoplayHandlers\\UserChosenExecuteHandlers';
    const MEDIA = [
        ['AudioCD', 'Audio CD', ['Play audio CD using Melaton Media Player', 'Open folder to view files using Cartograph', 'Take no action', 'Ask me every time']],
        ['EnhancedAudioCD', 'Enhanced audio CD', ['Play audio CD using Melaton Media Player', 'Take no action', 'Ask me every time']],
        ['DVDMovie', 'DVD movie', ['Play DVD movie using Melaton Media Player', 'Take no action', 'Ask me every time']],
        ['Software', 'Software and games', ['Install or run program', 'Take no action', 'Ask me every time']],
        ['Pictures', 'Pictures', ['Import pictures to the Gallery', 'View pictures using Lumen', 'Open folder to view files using Cartograph', 'Take no action', 'Ask me every time']],
        ['Video', 'Video files', ['Play video using Melaton Media Player', 'Open folder to view files using Cartograph', 'Take no action', 'Ask me every time']],
        ['Audio', 'Audio files', ['Play audio files using Melaton Media Player', 'Open folder to view files using Cartograph', 'Take no action', 'Ask me every time']],
        ['MixedContent', 'Mixed content', ['Open folder to view files using Cartograph', 'Take no action', 'Ask me every time']]
    ];

    pages.autoplay = {
        title: () => 'AutoPlay',
        tasks: () => '',
        body: () => `<div class="cpl-vpage cpl-vwide">${help('autoplay')}
            <h1 class="cpl-vtitle">Choose what happens when you insert each type of media or device</h1>
            <div class="cpl-vcheck"><input type="checkbox" id="cpl-ap-all"${reg(AUTOPLAY, 'Enabled', true) ? ' checked' : ''}><label for="cpl-ap-all">Use AutoPlay for all media and devices</label></div>
            <div class="cpl-vsection"><span>Media</span></div>
            <table class="cpl-ap">${MEDIA.map(([id, name, opts]) => `<tr><td><img src="/static_images/vista-cpl/items/autoplay-16.png" alt=""> ${esc(name)}</td><td><select class="cpl-vselect" data-ap="${id}">${opts.map((o) => `<option${reg(AUTOPLAY, id, 'Ask me every time') === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></td></tr>`).join('')}</table>
            <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="save">Save</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-action="nav" data-cpl-arg="home">Cancel</button></div>
        </div>`
    };
    handlers.autoplay = {
        async save() {
            const values = { Enabled: main().querySelector('#cpl-ap-all').checked };
            main().querySelectorAll('[data-ap]').forEach((s) => { values[s.dataset.ap] = s.value; });
            if (R()) await R().set(AUTOPLAY, values);
            nav('home');
        }
    };

    // ---- Melaton Firewall ----------------------------------------------------------------------

    const FW = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\StandardProfile';

    pages.firewall = {
        title: () => 'Melaton Firewall',
        tasks: () => tasks([[
            // no shields on this page's tasks (the VM; the category pages draw them)
            { t: 'Turn Melaton Firewall on or off', a: 'js:settings' },
            { t: 'Allow a program through Melaton Firewall', a: 'js:exceptions' }
        ]], [{ t: 'Security Center', a: 'item:security-center' }, { t: 'Network Center', a: 'item:network' }]),
        body: () => {
            const on = reg(FW, 'EnableFirewall', true);
            return `<div class="cpl-vpage">${help('firewall')}
                <h1 class="cpl-vtitle">Melaton Firewall</h1>
                <p class="cpl-vtext">Melaton Firewall can help prevent hackers or malicious software from gaining access to your computer through the Internet or network.</p>
                <p class="cpl-vtext"><a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="help" data-topic="firewall">How does a firewall help protect my computer?</a></p>
                <div class="cpl-fw-box">
                    <div class="cpl-fw-status ${on ? 'is-on' : 'is-off'}">${on ? 'Melaton Firewall is helping to protect your computer' : 'Your computer is not protected: turn on Melaton Firewall'}</div>
                    <div class="cpl-fw-grid">
                        <span>Melaton Firewall is ${on ? 'on' : 'off'}.</span><a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="settings">Change settings</a>
                        <span>Inbound connections that do not have an exception are ${reg(FW, 'DoNotAllowExceptions', false) ? 'blocked' : 'blocked'}.</span><span></span>
                        <span>Display a notification when a program is blocked:</span><span>${reg(FW, 'DisableNotifications', false) ? 'No' : 'Yes'}</span>
                        <span>Network location:</span><span>Domain network</span>
                    </div>
                </div>
            </div>`;
        }
    };
    handlers.firewall = {
        settings() { openFirewallSettings('general'); },
        exceptions() { openFirewallSettings('exceptions'); }
    };

    /** Melaton Firewall Settings: General (on / off / block all), Exceptions (the server's ports), Advanced. */
    function openFirewallSettings(tab) {
        const on = reg(FW, 'EnableFirewall', true);
        const block = reg(FW, 'DoNotAllowExceptions', false);
        const exceptions = reg(FW, 'Exceptions', ['Core Networking', 'Dreamscape Session Service', 'Remote Desktop', 'File and Printer Sharing']);
        const all = ['BITS Peercaching', 'Connect to a Network Projector', 'Core Networking', 'Distributed Transaction Coordinator', 'Dreamscape Session Service', 'File and Printer Sharing', 'iSCSI Service', 'Media Center Extenders', 'Network Discovery', 'Remote Administration', 'Remote Assistance', 'Remote Desktop', 'Remote Event Log Management', 'Remote Scheduled Tasks Management', 'Remote Service Management', 'Remote Volume Management', 'Routing and Remote Access', 'SNMP Trap', 'Melaton Collaboration Computer Name Registration Service', 'Melaton Firewall Remote Management', 'Melaton Management Instrumentation (WMI)', 'Melaton Meeting Space', 'Melaton Peer to Peer Collaboration Foundation', 'Wireless Portable Devices'];
        const html = `<div class="cpl-fw-settings">
            <div class="cpl-fw-tabs"><button type="button" data-fwtab="general"${tab !== 'exceptions' ? ' class="is-selected"' : ''}>General</button><button type="button" data-fwtab="exceptions"${tab === 'exceptions' ? ' class="is-selected"' : ''}>Exceptions</button></div>
            <div data-fwpage="general"${tab === 'exceptions' ? ' hidden' : ''}>
                <label class="cpl-fw-opt"><input type="radio" name="fw" value="on"${on ? ' checked' : ''}> <b>On (recommended)</b><br><span>This setting blocks all outside sources from connecting to this computer, except for those unblocked on the Exceptions tab.</span></label>
                <label class="cpl-fw-opt cpl-fw-sub"><input type="checkbox" name="fwblock"${block ? ' checked' : ''}> Block all incoming connections</label>
                <label class="cpl-fw-opt"><input type="radio" name="fw" value="off"${on ? '' : ' checked'}> <b>Off (not recommended)</b><br><span>Avoid using this setting. Turning off Melaton Firewall will make this computer more vulnerable to hackers or malicious software.</span></label>
            </div>
            <div data-fwpage="exceptions"${tab === 'exceptions' ? '' : ' hidden'}>
                <p>Exceptions control how programs communicate through Melaton Firewall. Add a program or port exception to allow communications through the firewall.</p>
                <div class="cpl-feat-list">${all.map((n) => `<label class="cpl-feat-row"><input type="checkbox" value="${esc(n)}"${exceptions.includes(n) ? ' checked' : ''}> ${esc(n)}</label>`).join('')}</div>
            </div></div>`;
        callGlobal('showConfirmationDialog', html, [
            { text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
        ], null, {
            title: 'Melaton Firewall Settings', width: 420,
            resolveValue: (v, dialog) => (v ? {
                EnableFirewall: (dialog.querySelector('input[name="fw"]:checked') || {}).value !== 'off',
                DoNotAllowExceptions: dialog.querySelector('input[name="fwblock"]').checked,
                Exceptions: Array.from(dialog.querySelectorAll('.cpl-feat-row input:checked')).map((i) => i.value)
            } : null)
        }).then(async (values) => {
            if (!values || !R()) return;
            await R().set(FW, values);
            rerender();
        });
    }

    // ---- BitLocker, Parental Controls, Sync Center, SideShow, CardSpace ------------------------

    const FVE = 'HKLM\\Software\\Policies\\Xyridian\\FVE';
    pages.bitlocker = {
        title: () => 'BitLocker Drive Encryption',
        // no TPM here, so no TPM Administration (the VM lists Disk Management alone)
        tasks: () => tasks([], [{ t: 'Disk Management', a: 'page:administrative-tools' }]),
        body: () => {
            const on = reg(FVE, 'DriveCEncrypted', false);
            return `<div class="cpl-vpage">${help('bitlocker')}
                <h1 class="cpl-vtitle">BitLocker Drive Encryption encrypts and protects your data.</h1>
                <p class="cpl-vtext">BitLocker Drive Encryption helps prevent unauthorized access to any files stored on the volume shown below. You are able to use the computer normally, but unauthorized users cannot read or use your files.</p>
                <p class="cpl-vtext cpl-vgap"><a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="help" data-topic="bitlocker">What should I know about BitLocker Drive Encryption before I turn it on?</a></p>
                <div class="cpl-vsection"><span>Volumes</span></div>
                <div class="cpl-bl-vol"><img src="/static_images/vista-icons/explorer/drive-48.png" alt="" onerror="this.src='/static_images/vista-cpl/items/bitlocker-drive-encryption-32.png'"><div><b>Server (C:)</b><br>${on ? 'On' : 'Off'}</div><button type="button" class="cpl-vlink" data-cpl-vpage="toggle"><img src="${SHIELD}" alt=""> ${on ? 'Turn Off BitLocker' : 'Turn On BitLocker'}</button></div>
            </div>`;
        }
    };
    handlers.bitlocker = {
        async toggle() {
            if (R()) await R().set(FVE, { DriveCEncrypted: !reg(FVE, 'DriveCEncrypted', false) });
            rerender();
        },
        tpm() { msg('This computer has no Trusted Platform Module the browser can reach. BitLocker keeps its startup key with the Dreamscape server.', 'TPM Administration'); }
    };

    const WPC = 'HKLM\\Software\\Xyridian\\Melaton\\CurrentVersion\\Parental Controls\\Users';
    pages['parental-controls'] = {
        title: () => 'Parental Controls',
        tasks: () => tasks([[{ t: 'Game Ratings Systems', a: 'js:ratings' }, { t: 'Family Safety Options', a: 'js:options' }]], [{ t: 'User Accounts', a: 'item:user-accounts' }]),
        body: () => {
            const acc = root.meletonAccounts;
            // Melaton's two accounts (meletonAccounts.js): the administrator and the guest
            const users = acc ? ['administrator', 'guest'].map((k) => ({ id: k, name: acc.name ? acc.name(k) : k, picture: acc.pictureUrl ? acc.pictureUrl(k) : '' })) : [{ id: 'guest', name: 'Guest', picture: '' }];
            return `<div class="cpl-vpage cpl-vwide">${help('parental-controls')}
                <h1 class="cpl-vtitle">Choose a user and set up Parental Controls</h1>
                <p class="cpl-vtext">What can I do with Parental Controls?</p>
                <div class="cpl-vsection"><span>Users</span></div>
                <div class="cpl-pc-users">${users.map((u) => `<button type="button" class="cpl-pc-user" data-cpl-vpage="user" data-user="${esc(u.id)}"><img src="${esc(u.picture)}" alt="" onerror="this.style.visibility='hidden'"><span><b>${esc(u.name)}</b><br>${u.id === 'administrator' ? 'Computer administrator' : 'Guest account'}<br>${reg(`${WPC}\\${u.id}`, 'Enabled', false) ? 'Parental Controls: On' : 'Parental Controls: Off'}</span></button>`).join('')}</div>
            </div>`;
        }
    };
    handlers['parental-controls'] = {
        user(t) {
            const id = t.dataset.user;
            if (id === 'administrator') {
                msg('You cannot apply Parental Controls to an administrator account.', 'Parental Controls');
                return;
            }
            const key = `${WPC}\\${id}`;
            callGlobal('showConfirmationDialog', `<p><b>Parental Controls:</b></p>
                <label><input type="radio" name="wpc" value="1"${reg(key, 'Enabled', false) ? ' checked' : ''}> On, enforce current settings</label><br>
                <label><input type="radio" name="wpc" value="0"${reg(key, 'Enabled', false) ? '' : ' checked'}> Off</label>
                <p><b>Activity Reporting:</b></p>
                <label><input type="checkbox" name="wpcr"${reg(key, 'Reporting', false) ? ' checked' : ''}> On, collect information about computer usage</label>`, [
                { text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
            ], null, { title: 'User Controls', width: 380, resolveValue: (v, d) => (v ? { Enabled: (d.querySelector('input[name="wpc"]:checked') || {}).value === '1', Reporting: d.querySelector('input[name="wpcr"]').checked } : null) })
                .then(async (values) => { if (values && R()) { await R().set(key, values); rerender(); } });
        },
        ratings() { msg('Melaton uses the ESRB game ratings.', 'Game Ratings Systems'); },
        options() { msg('Family Safety options are kept with each user\'s Parental Controls.', 'Family Safety Options'); }
    };

    pages['sync-center'] = {
        title: () => 'Sync Center',
        tasks: () => tasks([[
            { t: 'View sync partnerships', a: 'js:partnerships' }, { t: 'View sync conflicts', a: 'js:conflicts' },
            { t: 'View sync results', a: 'js:results' }, { t: 'Set up new sync partnerships', a: 'js:setup' }
        ]], [{ t: 'Offline files', a: 'item:offline-files' }]),
        body: () => `<div class="cpl-vpage cpl-vwide">${help('sync-center')}
            <h1 class="cpl-vtitle">Keep your information in sync</h1>
            <p class="cpl-vtext">View recent sync activity, sync now, or change your sync settings.</p>
            <div class="cpl-pf-bar"><button type="button" class="cpl-pf-cmd" data-cpl-vpage="syncall">Sync All</button><button type="button" class="cpl-pf-cmd" data-cpl-vpage="schedule">Schedule</button></div>
            <table class="cpl-vtable"><tr class="is-head"><td>Name</td><td>Status</td><td>Category</td><td>Progress</td></tr>
            <tr data-cpl-vpage="syncall"><td><img src="/static_images/vista-cpl/items/sync-center-16.png" alt=""> Offline Files</td><td>${esc(reg('HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\SyncMgr', 'LastSync', '') ? `Sync completed ${reg('HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\SyncMgr', 'LastSync', '')}` : 'Not synced')}</td><td>Folders</td><td></td></tr></table>
        </div>`
    };
    handlers['sync-center'] = {
        async syncall() {
            // the replicas are the server's sync partnership (Data Management > Replication)
            if (R()) await R().set('HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\SyncMgr', { LastSync: new Date().toLocaleString('en-US') });
            rerender();
        },
        schedule() { callGlobal('openDataManagementDsap', 'replication'); },
        partnerships() { rerender(); },
        conflicts() { msg('There are no sync conflicts.', 'Sync Center'); },
        results() { msg('No sync results to show.', 'Sync Center'); },
        setup() { callGlobal('openDataManagementDsap', 'replication'); }
    };
    // the catalog links 'page:sync-center:results' / 'conflicts'
    const syncBody = pages['sync-center'].body;
    pages['sync-center'].body = () => {
        const arg = CP() && CP().pageArg('sync-center');
        if (arg === 'results') setTimeout(() => handlers['sync-center'].results(), 0);
        else if (arg === 'conflicts') setTimeout(() => handlers['sync-center'].conflicts(), 0);
        return syncBody();
    };

    // Melaton SideShow (Yozora #654): Dreamscape Frame tablets and the Device Simulator are its
    // devices (modules/slideshowDevices.js), Dreamscape Slideshow its one gadget. The pages follow
    // the VM's AuxiliaryDisplayCpl.dll (UIFILE 101 home, 102 device settings; its string table):
    // the gadget-by-device grid, a device's settings page, and the gadget's own settings page.
    const SS = '/static_images/vista-sideshow';
    const SS_GADGET = 'Dreamscape Slideshow';
    const SS_VIEWS = [['images', 'All pictures'], ['pinned', 'Pinned pictures'], ['upscaled', 'Upscaled pictures']];
    const SS_OVERLAYS = [['off', 'Off'], ['minimal', 'Minimal'], ['full', 'Full']];
    const SS_KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\SideShow';
    const ss = { devices: null, error: '', loading: false, wired: false, deviceId: null, busy: '', loadedAt: 0 };

    function ssClient() {
        return root.wsClient && typeof root.wsClient.listDevices === 'function' ? root.wsClient : null;
    }

    function ssDevice(id) {
        return (ss.devices || []).find((d) => d.deviceId === id) || null;
    }

    function ssPreview(filename) {
        const base = String(filename || '').replace(/\.(png|jpg|jpeg|webp)$/i, '').replace(/_upscaled$/i, '');
        return base ? `/previews/${encodeURIComponent(`${base}.webp`)}` : '';
    }

    function ssStateText(d) {
        if (!d.online) return 'Disconnected';
        return {
            showing: 'Connected', paused: 'Connected, paused', offline_cache: 'Connected, showing saved pictures',
            signin_needed: 'Connected, sign-in needed'
        }[d.state] || 'Connected';
    }

    function ssOnPage() {
        const page = CP() && CP().currentPage();
        return page === 'sideshow' || page === 'sideshow-device' || page === 'sideshow-gadget';
    }

    /** Pages with fields keep their edits: only the live parts are redrawn in place. */
    function ssRefreshView() {
        const page = CP() && CP().currentPage();
        if (page === 'sideshow') { rerender(); return; }
        const m = main();
        if (!m || !ssOnPage()) return;
        const d = ssDevice(ss.deviceId);
        m.querySelectorAll('[data-ss-live="status"]').forEach((el) => { el.textContent = d ? ssStateText(d) : 'Disconnected'; });
        m.querySelectorAll('[data-ss-live="showing"]').forEach((el) => { el.innerHTML = d ? ssShowingHtml(d) : ''; });
        m.querySelectorAll('[data-ss-live="offline"]').forEach((el) => { el.hidden = !!(d && d.online); });
        const pause = m.querySelector('[data-cpl-vpage="cmd"][data-cmd="pause"], [data-cpl-vpage="cmd"][data-cmd="resume"]');
        if (pause && d) { pause.dataset.cmd = d.state === 'paused' ? 'resume' : 'pause'; pause.textContent = d.state === 'paused' ? 'Resume' : 'Pause'; }
        m.querySelectorAll('[data-cpl-vpage="cmd"]').forEach((b) => { b.disabled = !d || !d.online || !!ss.busy; });
    }

    function ssWire() {
        if (ss.wired || !root.wsClient || typeof root.wsClient.on !== 'function') return;
        ss.wired = true;
        root.wsClient.on('devices_updated', (msg) => {
            const list = msg && msg.data && msg.data.devices;
            if (!Array.isArray(list)) return;
            ss.devices = list;
            if (ssOnPage()) ssRefreshView();
        });
    }

    /** A fresh list each time the home page opens; devices_updated keeps it current after that. */
    function ssLoad() {
        const c = ssClient();
        ssWire();
        if (!c || ss.loading || Date.now() - ss.loadedAt < 2000) return;
        ss.loading = true;
        c.listDevices().then((res) => {
            ss.devices = (res && res.devices) || [];
            // read-only logons cannot manage devices (the CPL's own string 906)
            ss.error = res && res.code === 'INSUFFICIENT_PERMISSIONS' ? 'You do not have the correct permissions to change this setting. For more information, contact your system administrator.' : '';
        }).catch(() => {
            ss.devices = [];
            ss.error = '';
        }).finally(() => {
            ss.loading = false;
            ss.loadedAt = Date.now();
            if (CP() && CP().currentPage() === 'sideshow') rerender();
        });
    }

    function ssShowingHtml(d) {
        const files = d.showing || [];
        if (!d.online || !files.length) return '<span class="cpl-ss-dim">Nothing is on the screen.</span>';
        return files.map((f) => `<figure class="cpl-ss-thumb"><img src="${esc(ssPreview(f))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><figcaption title="${esc(f)}">${esc(f)}</figcaption></figure>`).join('');
    }

    /** The pane: Tasks (the two gadget sorts), then Devices with each device's name (string 1161). */
    function ssTasks() {
        const byDate = reg(SS_KEY, 'SortByDate', false);
        const li = (on, inner) => `<li class="cpl-vtask${on ? ' cpl-ss-current' : ''}">${inner}</li>`;
        const list = ss.devices || [];
        return `<div class="cpl-task-group cpl-vtasks">
                <h3 class="cpl-task-heading">Tasks</h3>
                <ul class="cpl-task-list">
                    ${li(!byDate, '<button type="button" class="cpl-link" data-cpl-vpage="sort" data-sort="name">View gadgets by name</button>')}
                    ${li(byDate, '<button type="button" class="cpl-link" data-cpl-vpage="sort" data-sort="date">View gadgets by date installed</button>')}
                </ul>
            </div>${list.length ? `
            <div class="cpl-task-group cpl-vtasks cpl-ss-devices">
                <h3 class="cpl-task-heading">Devices</h3>
                <ul class="cpl-task-list">${list.map((d) => `<li class="cpl-vtask has-icon"><img src="${SS}/sideshow-16.png" alt="" draggable="false"><button type="button" class="cpl-link" data-cpl-vpage="open" data-device="${esc(d.deviceId)}" title="Click to change settings for ${esc(d.name)}">${esc(d.name)}</button></li>`).join('')}</ul>
            </div>` : ''}`;
    }

    pages.sideshow = {
        title: () => 'Melaton SideShow',
        tasks: () => ssTasks(),
        body: () => {
            ssLoad();
            const list = ss.devices || [];
            const has = list.length > 0;
            const notify = reg(SS_KEY, 'NotifyNewGadgets', true);
            return `<div class="cpl-vpage cpl-ss-page">${help('sideshow')}
            <h1 class="cpl-vtitle">${has ? 'Select which gadgets appear on your Melaton SideShow-compatible devices' : 'Learn about using Melaton SideShow'}</h1>
            <p class="cpl-vtext">${has ? 'You can change settings for some gadgets by clicking the gadget name in the list. To change device settings, click the device name in the left pane.' : 'A Melaton SideShow-compatible device is a secondary display that accesses information from your computer. You can use it to do things like check your calendar, read e-mail messages, or scan top news stories even when your computer is off.'}</p>
            ${ss.error ? `<p class="cpl-vtext cpl-vgap">${esc(ss.error)}</p>` : ''}
            <table class="cpl-ss-grid">
                <tr class="is-head"><td>Gadgets</td>${has ? list.map((d) => `<td class="cpl-ss-col"><button type="button" class="cpl-ss-devhead" data-cpl-vpage="open" data-device="${esc(d.deviceId)}" title="Click to change settings for ${esc(d.name)}"><img src="${SS}/sideshow-32.png" alt=""><span>${esc(d.name)}</span></button></td>`).join('') : '<td class="cpl-ss-none">Devices (none)</td>'}</tr>
                <tr class="cpl-ss-row"><td class="cpl-ss-gadget"><img src="${SS}/slideshow-gadget-32.png" alt=""><button type="button" class="cpl-ss-gadget-link" data-cpl-vpage="gadget">${esc(SS_GADGET)}</button></td>${has ? list.map((d) => `<td class="cpl-ss-col"><span class="cpl-vcheck cpl-ss-cell"><input type="checkbox" id="cpl-ss-on-${esc(d.deviceId)}" checked disabled><label for="cpl-ss-on-${esc(d.deviceId)}" title="${esc(ssStateText(d))}"></label></span></td>`).join('') : '<td></td>'}</tr>
            </table>
            <div class="cpl-vcheck cpl-ss-check"><input type="checkbox" id="cpl-ss-notify" data-ss-pref="NotifyNewGadgets"${notify ? ' checked' : ''}><label for="cpl-ss-notify">Notify me when new gadgets are installed</label></div>
            <p class="cpl-ss-link"><img src="${SS}/globe-16.png" alt=""><button type="button" class="cpl-vlink" data-cpl-vpage="more">Get more gadgets online</button></p>
            <p class="cpl-ss-info"><img src="${SS}/info-16.png" alt=""><button type="button" class="cpl-vlink" data-cpl-vpage="help" data-topic="sideshow">How do I use my mobile phone or another device with Melaton SideShow?</button></p>
        </div>`;
        }
    };
    handlers.sideshow = {
        open(t) {
            ss.deviceId = t.dataset.device;
            nav('sideshow-device');
        },
        gadget() {
            const list = ss.devices || [];
            if (!list.some((d) => d.deviceId === ss.deviceId)) ss.deviceId = list.length ? list[0].deviceId : null;
            nav('sideshow-gadget');
        },
        async sort(t) {
            if (R()) await R().set(SS_KEY, { SortByDate: t.dataset.sort === 'date' });
            rerender();
        },
        more() { msg('No more gadgets are available for Melaton SideShow.', 'Melaton SideShow'); },
        change(ev) {
            const k = ev.target.dataset && ev.target.dataset.ssPref;
            if (k && R()) void R().set(SS_KEY, { [k]: !!ev.target.checked });
        }
    };

    function ssOptions(list, value) {
        return list.map(([v, t]) => `<option value="${v}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('');
    }

    function ssBackPane() {
        return ssTasks();
    }

    // Change Device Settings (UIFILE 101's pageDevice): the device's logo and name, then Gadgets
    // and More options; this device has no screen settings of its own (wss_enhanced_device stays hidden)
    pages['sideshow-device'] = {
        parent: 'sideshow',
        title: () => 'Change Device Settings',
        tasks: () => ssBackPane(),
        body: () => {
            const d = ssDevice(ss.deviceId);
            if (!d) return `<div class="cpl-vpage cpl-ss-page">${help('sideshow')}<p class="cpl-vtext">This device is no longer installed.</p></div>`;
            return `<div class="cpl-vpage cpl-ss-page">${help('sideshow')}
                <div class="cpl-ss-logo"><img src="${SS}/sideshow-48.png" alt=""><div><b>${esc(d.name)}</b><br><span data-ss-live="status">${esc(ssStateText(d))}</span>${d.model ? `<br><span class="cpl-ss-dim">${esc([d.model, d.os].filter(Boolean).join(', '))}</span>` : ''}</div></div>
                <p class="cpl-vtext cpl-ss-para" data-ss-live="offline"${d.online ? ' hidden' : ''}>To change settings, first connect the device.</p>
                <div class="cpl-vsection"><span>Gadgets</span></div>
                <p class="cpl-ss-link"><img src="${SS}/gadgets-16.png" alt=""><button type="button" class="cpl-vlink" data-cpl-vpage="hub">Turn gadgets on or off</button></p>
                <p class="cpl-ss-link"><img src="${SS}/slideshow-gadget-16.png" alt=""><button type="button" class="cpl-vlink" data-cpl-vpage="gadget">${esc(SS_GADGET)} settings</button></p>
                <div class="cpl-vsection"><span>More options</span></div>
                <p class="cpl-ss-link"><img src="${SS}/sideshow-16.png" alt=""><button type="button" class="cpl-vlink" data-cpl-vpage="rename">Additional settings</button></p>
                <p class="cpl-ss-link"><img src="${SS}/troubleshoot-16.png" alt=""><button type="button" class="cpl-vlink" data-cpl-vpage="help" data-topic="sideshow">Troubleshoot connection problems for this device</button></p>
                <p class="cpl-ss-link"><img src="${SHIELD}" alt=""><button type="button" class="cpl-vlink" data-cpl-vpage="forget">Uninstall this device</button></p>
            </div>`;
        }
    };

    async function ssSend(command, extra) {
        const c = ssClient();
        if (!c || !ss.deviceId) return null;
        try {
            const res = await c.deviceSendCommand(ss.deviceId, command, extra || {});
            if (res && res.success === false) {
                // the CPL's own 907 when the device does not take it
                msg(res.code === 'BAD_SETTINGS' || res.code === 'BAD_NAME' ? esc(res.error || 'That setting is not valid.') : 'Melaton was unable to save the changes to the device. Make sure the device is connected to the computer, and then try again.', 'Melaton SideShow');
            }
            return res;
        } catch (err) {
            msg(esc((err && err.message) || 'Melaton was unable to save the changes to the device.'), 'Melaton SideShow');
            return null;
        }
    }

    handlers['sideshow-device'] = {
        hub() { nav('sideshow'); },
        gadget() { nav('sideshow-gadget'); },
        open(t) { ss.deviceId = t.dataset.device; rerender(); },
        sort() { nav('sideshow'); },
        rename() {
            const d = ssDevice(ss.deviceId);
            if (!d) return;
            callGlobal('showConfirmationDialog', `<p><label for="cpl-ss-rename">Device name:</label></p><p><input type="text" class="cpl-vedit" id="cpl-ss-rename" maxlength="64" value="${esc(d.name)}" style="width:100%"></p>`, [
                { text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
            ], null, { title: `${d.name} settings`, width: 340, resolveValue: (v, dlg) => (v ? String((dlg.querySelector('#cpl-ss-rename') || {}).value || '').trim().slice(0, 64) : null) })
                .then(async (name) => {
                    if (!name || name === d.name) return;
                    await ssSend('rename', { name });
                    d.name = name;
                    rerender();
                });
        },
        forget() {
            const d = ssDevice(ss.deviceId);
            if (!d) return;
            callGlobal('showConfirmationDialog', '<p>Are you sure you want to uninstall this device?</p>', [
                { text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
            ], null, { title: 'Confirm Device Uninstallation', width: 360 }).then(async (yes) => {
                if (!yes || !ssClient()) return;
                try {
                    await ssClient().deviceForget(d.deviceId);
                    ss.devices = (ss.devices || []).filter((x) => x.deviceId !== d.deviceId);
                } catch (err) {
                    msg(esc((err && err.message) || 'The device could not be uninstalled.'), 'Melaton SideShow');
                }
                nav('sideshow');
            });
        }
    };

    // the gadget's own settings page ("%s settings", string 801): which device, what it shows, the remote, the slide show
    pages['sideshow-gadget'] = {
        parent: 'sideshow',
        title: () => `${SS_GADGET} settings`,
        tasks: () => ssBackPane(),
        body: () => {
            const list = ss.devices || [];
            const d = ssDevice(ss.deviceId);
            if (!d) return `<div class="cpl-vpage cpl-ss-page">${help('sideshow')}<h1 class="cpl-vtitle">${esc(SS_GADGET)} settings</h1><p class="cpl-vtext">No Melaton SideShow-compatible devices are installed on your computer.</p></div>`;
            const st = d.settings || {};
            const off = !d.online ? ' disabled' : '';
            const queued = d.pendingSettings || d.pendingName ? '<p class="cpl-vtext cpl-ss-dim cpl-ss-para">Some changes will be sent to the device the next time it connects.</p>' : '';
            return `<div class="cpl-vpage cpl-ss-page">${help('sideshow')}
                <h1 class="cpl-vtitle">${esc(SS_GADGET)} settings</h1>
                ${list.length > 1 ? `<p class="cpl-vtext">For which device do you want to change settings?</p><p class="cpl-ss-field"><select class="cpl-vselect" data-ss-device>${list.map((x) => `<option value="${esc(x.deviceId)}"${x.deviceId === d.deviceId ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></p>` : ''}
                <div class="cpl-vsection"><span>Now showing on ${esc(d.name)}</span></div>
                <p class="cpl-vtext" data-ss-live="status">${esc(ssStateText(d))}</p>
                <div class="cpl-ss-showing" data-ss-live="showing">${ssShowingHtml(d)}</div>
                <div class="cpl-ss-remote">
                    <button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="cmd" data-cmd="previous"${off}>Previous</button>
                    <button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="cmd" data-cmd="${d.state === 'paused' ? 'resume' : 'pause'}"${off}>${d.state === 'paused' ? 'Resume' : 'Pause'}</button>
                    <button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="cmd" data-cmd="next"${off}>Next</button>
                    <button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="cmd" data-cmd="refresh"${off}>Refresh</button>
                </div>
                <div class="cpl-vsection"><span>Slide show</span></div>
                <table class="cpl-power-grid cpl-ss-settings">
                    <tr><td><label for="cpl-ss-view">Show pictures from:</label></td><td><select class="cpl-vselect" id="cpl-ss-view">${ssOptions(SS_VIEWS, st.viewType || 'images')}</select></td></tr>
                    <tr><td><label for="cpl-ss-interval">Show each picture for:</label></td><td><input type="number" class="cpl-vedit cpl-ss-num" id="cpl-ss-interval" min="5" max="3600" value="${esc(st.intervalSec != null ? st.intervalSec : 45)}"> seconds</td></tr>
                    <tr><td><label for="cpl-ss-pool">Pictures in rotation:</label></td><td><input type="number" class="cpl-vedit cpl-ss-num" id="cpl-ss-pool" min="1" max="1000" value="${esc(st.poolSize != null ? st.poolSize : 60)}"></td></tr>
                    <tr><td><label for="cpl-ss-overlay">Picture information:</label></td><td><select class="cpl-vselect" id="cpl-ss-overlay">${ssOptions(SS_OVERLAYS, st.infoOverlay || 'minimal')}</select></td></tr>
                </table>
                <div class="cpl-vcheck cpl-ss-check"><input type="checkbox" id="cpl-ss-shuffle"${st.shuffle !== false ? ' checked' : ''}><label for="cpl-ss-shuffle">Shuffle pictures</label></div>
                <div class="cpl-vcheck cpl-ss-check"><input type="checkbox" id="cpl-ss-pair"${st.pairPortraits !== false ? ' checked' : ''}><label for="cpl-ss-pair">Show tall pictures side by side</label></div>
                ${queued}
                <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="save">OK</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="cancel">Cancel</button></div>
            </div>`;
        }
    };

    handlers['sideshow-gadget'] = {
        open(t) { ss.deviceId = t.dataset.device; nav('sideshow-device'); },
        sort() { nav('sideshow'); },
        change(ev) {
            if (ev.target.matches && ev.target.matches('[data-ss-device]')) {
                ss.deviceId = ev.target.value;
                rerender();
            }
        },
        async cmd(t) {
            if (ss.busy) return;
            ss.busy = t.dataset.cmd;
            ssRefreshView();
            await ssSend(t.dataset.cmd);
            ss.busy = '';
            ssRefreshView();
        },
        async save() {
            const d = ssDevice(ss.deviceId);
            const m = main();
            if (!d || !m) return;
            const val = (id) => (m.querySelector(`#${id}`) || {}).value;
            const num = (id, lo, hi, fallback) => {
                const n = Math.round(Number(val(id)));
                return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
            };
            const st = d.settings || {};
            const next = {
                viewType: val('cpl-ss-view'),
                intervalSec: num('cpl-ss-interval', 5, 3600, st.intervalSec || 45),
                poolSize: num('cpl-ss-pool', 1, 1000, st.poolSize || 60),
                infoOverlay: val('cpl-ss-overlay'),
                shuffle: !!(m.querySelector('#cpl-ss-shuffle') || {}).checked,
                pairPortraits: !!(m.querySelector('#cpl-ss-pair') || {}).checked
            };
            const changed = {};
            Object.keys(next).forEach((k) => { if (next[k] !== st[k]) changed[k] = next[k]; });
            if (Object.keys(changed).length) await ssSend('set_settings', { settings: changed });
            nav('sideshow');
        },
        cancel() { nav('sideshow'); }
    };

    function register() {
        const cp = CP();
        if (!cp) return false;
        Object.entries(pages).forEach(([id, page]) => cp.registerPage(id, page));
        return true;
    }

    // the Firewall Settings tabs (inside a confirmation dialog)
    if (doc) {
        doc.addEventListener('click', (ev) => {
            const b = ev.target.closest && ev.target.closest('.cpl-fw-settings [data-fwtab]');
            if (!b) return;
            const box = b.closest('.cpl-fw-settings');
            box.querySelectorAll('[data-fwtab]').forEach((x) => x.classList.toggle('is-selected', x === b));
            box.querySelectorAll('[data-fwpage]').forEach((p) => { p.hidden = p.dataset.fwpage !== b.dataset.fwtab; });
        });
    }

    root.cplPages2 = { register, applyAccess, pages };
    register();
})(typeof window !== 'undefined' ? window : globalThis);
