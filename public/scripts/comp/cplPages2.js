/**
 * Control Panel's Vista pages, second set (Yozora #632; cplPages.js has the kit): Performance
 * Information and Tools (the Melaton Experience Index, experienceIndex.js), Problem Reports and
 * Solutions (the server's fault reports, GET /api/fault-reports), Programs and Features (the
 * Start menu's programs), Ease of Access Center (the on-screen keyboard, a narrator over the
 * browser's speech, High Contrast), AutoPlay, Melaton Firewall, BitLocker Drive Encryption,
 * Parental Controls, Sync Center, Melaton SideShow and Melaton CardSpace.
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
            { t: 'Check for new solutions', a: 'js:check' },
            { t: 'See problems to check', a: 'page:problem-reports-history' },
            { t: 'View problem history', a: 'page:problem-reports-history' },
            { t: 'Change settings', a: 'page:problem-reports-settings' },
            { t: 'Clear solution and problem history', a: 'js:clear', s: true }
        ]], [{ t: 'Learn about privacy', a: 'js:privacy' }]),
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
            return `<div class="cpl-vpage cpl-vwide cpl-pf">${help('programs')}
                <h1 class="cpl-vtitle">Uninstall or change a program</h1>
                <p class="cpl-vtext">To uninstall a program, select it from the list and then click "Uninstall", "Change", or "Repair".</p>
                <div class="cpl-pf-bar"><button type="button" class="cpl-pf-cmd" data-cpl-vpage="organize">Organize</button><button type="button" class="cpl-pf-cmd" data-cpl-vpage="views">Views</button>${sel ? '<button type="button" class="cpl-pf-cmd" data-cpl-vpage="uninstall">Uninstall</button>' : ''}</div>
                <table class="cpl-vtable cpl-pf-table"><tr class="is-head">${PCOLS.map((t, i) => `<td class="cpl-flist-col${S ? S.headMark('programs', i) : ''}" data-cpl-vpage="sortcol" data-col="${i}">${t}</td>`).join('')}</tr>
                ${list.map((p) => `<tr class="${p.id === sel ? 'is-selected' : ''}" data-cpl-vpage="pick" data-prog="${esc(p.id)}"><td><img src="${esc(p.icon)}" alt="" onerror="this.style.visibility='hidden'">${esc(p.name)}</td><td>${esc(p.publisher)}</td><td>${esc(new Date().toLocaleDateString('en-US'))}</td><td></td></tr>`).join('')}
                </table>
                <p class="cpl-vtext cpl-pf-foot">Currently installed programs &nbsp; ${list.length} programs installed</p>
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
        ]], [{ t: 'Learn about additional assistive technologies online', a: 'js:online' }]),
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
            { t: 'Turn Melaton Firewall on or off', a: 'js:settings', s: true },
            { t: 'Allow a program through Melaton Firewall', a: 'js:exceptions', s: true }
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
        tasks: () => tasks([], [{ t: 'TPM Administration', a: 'js:tpm', s: true }, { t: 'Disk Management', a: 'page:administrative-tools' }]),
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

    pages.sideshow = {
        title: () => 'Melaton SideShow',
        tasks: () => tasks([[{ t: 'Change the order of gadgets', a: 'js:order' }, { t: 'Set default device', a: 'js:device' }]], [{ t: 'Melaton Sidebar', a: 'item:sidebar-properties' }]),
        body: () => `<div class="cpl-vpage">${help('sideshow')}
            <h1 class="cpl-vtitle">Change settings for Melaton SideShow-compatible devices</h1>
            <p class="cpl-vtext">Select which gadgets you want to use on your Melaton SideShow-compatible devices.</p>
            <p class="cpl-vtext cpl-vgap">No Melaton SideShow-compatible devices are installed on your computer. <a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="help" data-topic="sideshow">Learn more about Melaton SideShow.</a></p>
        </div>`
    };
    handlers.sideshow = {
        order() { msg('There are no gadgets to order.', 'Melaton SideShow'); },
        device() { msg('No Melaton SideShow-compatible devices are installed.', 'Melaton SideShow'); }
    };

    pages.cardspace = {
        title: () => 'Melaton CardSpace',
        tasks: () => tasks([[{ t: 'Add a card', a: 'js:add' }, { t: 'Back up cards', a: 'js:backup' }, { t: 'Restore cards', a: 'js:restore' }, { t: 'Delete all cards', a: 'js:delete' }]], [{ t: 'Dreamscape Services', a: 'item:authentication' }]),
        body: () => {
            const cards = reg('HKCU\\Software\\Xyridian\\CardSpace', 'Cards', []);
            return `<div class="cpl-vpage">${help('cardspace')}
                <h1 class="cpl-vtitle">Melaton CardSpace</h1>
                <p class="cpl-vtext">Melaton CardSpace is a new way to send personal information to sites that request it. Your information is held in cards that only you can send.</p>
                <div class="cpl-vsection"><span>Your cards</span></div>
                ${cards.length ? cards.map((c) => `<p class="cpl-vtext"><img src="/static_images/vista-cpl/cardspace-32.png" alt="" style="vertical-align:middle"> ${esc(c)}</p>`).join('') : '<p class="cpl-vtext">You have no cards. Your Dreamscape logons and keys are in Dreamscape Services.</p>'}
            </div>`;
        }
    };
    handlers.cardspace = {
        async add() {
            const name = callGlobal('prompt', 'Card name:', 'Personal Card');
            if (!name || !R()) return;
            await R().set('HKCU\\Software\\Xyridian\\CardSpace', { Cards: reg('HKCU\\Software\\Xyridian\\CardSpace', 'Cards', []).concat([String(name).slice(0, 60)]) });
            rerender();
        },
        backup() { msg('Your cards are kept in Melaton\'s registry on the Dreamscape server, which backs them up.', 'Melaton CardSpace'); },
        restore() { msg('Your cards are kept in Melaton\'s registry on the Dreamscape server, which backs them up.', 'Melaton CardSpace'); },
        async delete() {
            if (R()) await R().set('HKCU\\Software\\Xyridian\\CardSpace', { Cards: null });
            rerender();
        }
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
