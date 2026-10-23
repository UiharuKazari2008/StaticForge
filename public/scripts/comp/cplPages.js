/**
 * Control Panel's Vista pages (Yozora #632): the items Vista opens as a page in the Control Panel
 * window rather than a dialog, laid out from the Vista VM's captures (2026-10-22), Windows ->
 * Melaton. Settings go to Melaton's registry (melatonRegistry.js) under Vista's key names; a page
 * whose Vista button has nothing to drive here opens Melaton's own equivalent (Backup -> the
 * replication pages, Problem Reports -> program faults, Programs and Features -> the Start menu's
 * programs).
 *
 *   page markup: the task pane is cplPages.tasks([{ links }, ...], seeAlso); the body is a
 *   .cpl-vpage (title, intro, sections) styled in public/css/cpl-pages.css
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-cpl/pages';
    const ITEMS = '/static_images/vista-cpl/items';
    const SHIELD = '/static_images/vista-cpl/shield-uac-16.png';
    const R = () => root.melatonRegistry;
    const CP = () => root.melatonControlPanel;

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function reg(key, name, def) {
        const r = R();
        return r ? r.get(key, name, def) : def;
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    /**
     * The left pane: groups of links ({ t, a: 'page:...' | 'item:...' | 'dialog:...' | 'js:<name>',
     * icon?, s: shield }), then See also.
     */
    function tasks(groups, seeAlso, heading) {
        const link = (l) => {
            const icon = l.s ? SHIELD : l.icon;
            return `<li class="cpl-vtask${icon ? ' has-icon' : ''}">${icon ? `<img src="${esc(icon)}" alt="" draggable="false">` : ''}<button type="button" class="cpl-link" ${l.a.startsWith('js:') ? `data-cpl-vpage="${esc(l.a.slice(3))}"` : `data-cpl-action="do" data-cpl-arg="${esc(l.a)}"`}>${esc(l.t)}</button></li>`;
        };
        const out = groups.map((g, i) => `
            <div class="cpl-task-group cpl-vtasks">
                ${i === 0 && heading ? `<h3 class="cpl-task-heading">${esc(heading)}</h3>` : ''}
                <ul class="cpl-task-list">${g.map(link).join('')}</ul>
            </div>`);
        if (seeAlso && seeAlso.length) {
            out.push(`
            <div class="cpl-task-group cpl-task-group--see-also">
                <h3 class="cpl-task-heading">See also</h3>
                <ul class="cpl-task-list">${seeAlso.map(link).join('')}</ul>
            </div>`);
        }
        return out.join('');
    }

    function help(topic) {
        return `<button type="button" class="cpl-vhelp" data-cpl-vpage="help" data-topic="${esc(topic)}" title="Get help"></button>`;
    }

    /** A page's own clicks ([data-cpl-vpage]) go to its handlers; the rest is Control Panel's. */
    const handlers = {};
    let wired = false;
    function wire() {
        if (wired || !doc) return;
        wired = true;
        const inWindow = (t) => t && t.closest('#melatonControlPanelModal');
        doc.addEventListener('click', (ev) => {
            const t = ev.target.closest && ev.target.closest('[data-cpl-vpage]');
            if (!t || !inWindow(t)) return;
            ev.preventDefault();
            const name = t.dataset.cplVpage;
            if (name === 'help') {
                callGlobal('openHelpAndSupport', t.dataset.topic);
                return;
            }
            const page = CP() && CP().currentPage();
            const fn = (handlers[page] && handlers[page][name]) || handlers['*'][name];
            if (typeof fn === 'function') fn(t, ev);
        });
        doc.addEventListener('change', (ev) => {
            if (!inWindow(ev.target)) return;
            const page = CP() && CP().currentPage();
            const fn = handlers[page] && handlers[page].change;
            if (typeof fn === 'function') fn(ev);
        });
    }

    function msg(text, title = 'Control Panel') {
        return callGlobal('showConfirmationDialog', `<p>${esc(text)}</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title, width: 400 });
    }

    function nav(id) {
        if (CP()) CP().navigate(id);
    }

    handlers['*'] = {};

    // ---- Power Options -----------------------------------------------------------------------

    const POWER = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes';
    const PLANS = [
        { id: 'balanced', name: 'Balanced', savings: 3, perf: 3, display: 20, sleep: 60 },
        { id: 'saver', name: 'Power saver', savings: 6, perf: 2, display: 20, sleep: 60 },
        { id: 'high', name: 'High performance', savings: 2, perf: 6, display: 20, sleep: 0 }
    ];
    const MINUTES = [1, 2, 3, 5, 10, 15, 20, 25, 30, 45, 60, 120, 180, 240, 300, 0];

    function minuteText(m) {
        if (!m) return 'Never';
        if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
        return `${m / 60} hour${m === 60 ? '' : 's'}`;
    }

    function activePlan() {
        return reg(POWER, 'ActivePowerScheme', 'balanced');
    }

    function planValue(plan, name) {
        const p = PLANS.find((x) => x.id === plan) || PLANS[0];
        return reg(`${POWER}\\${p.id}`, name, p[name]);
    }

    function dots(n, cls) {
        return `<span class="cpl-power-dots ${cls}">${'<i></i>'.repeat(n)}</span>`;
    }

    const POWER_TASKS = () => tasks([[
        { t: 'Require a password on wakeup', a: 'page:power-system' },
        { t: 'Choose what the power button does', a: 'page:power-system' },
        { t: 'Create a power plan', a: 'page:power-create' },
        { t: 'Choose when to turn off the display', a: 'page:power-plan', icon: `${ART}/power-display.png` },
        { t: 'Change when the computer sleeps', a: 'page:power-plan', icon: `${ART}/power-sleep.png` }
    ]], [{ t: 'Personalization', a: 'item:personalization' }, { t: 'User Accounts', a: 'item:user-accounts' }]);

    const pages = {};

    pages['power-options'] = {
        title: () => 'Power Options',
        tasks: POWER_TASKS,
        body: () => {
            const arg = CP() && CP().pageArg('power-options');
            if (arg === 'password' || arg === 'buttons') setTimeout(() => nav('power-system'), 0);
            else if (arg === 'plan') setTimeout(() => nav('power-plan'), 0);
            const active = activePlan();
            return `<div class="cpl-vpage">${help('power')}
                <h1 class="cpl-vtitle">Select a power plan</h1>
                <p class="cpl-vtext">Power plans can help you maximize your computer's performance or conserve energy. Make a plan active by selecting it, or choose a plan and customize it by changing its power settings. <a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="help" data-topic="power">Tell me more about power plans</a></p>
                <div class="cpl-vsection"><span>Preferred plans</span></div>
                <div class="cpl-power-plans">${PLANS.map((p) => `
                    <div class="cpl-power-plan">
                        <div class="cpl-power-name"><input type="radio" name="cpl-power" id="cpl-power-${p.id}" value="${p.id}"${p.id === active ? ' checked' : ''}><label for="cpl-power-${p.id}">${esc(p.name)}</label></div>
                        <button type="button" class="cpl-vlink cpl-power-change" data-cpl-vpage="plan" data-plan="${p.id}">Change plan settings</button>
                        <div class="cpl-power-meter"><span>Energy savings:</span>${dots(p.savings, 'is-savings')}<span>Performance:</span>${dots(p.perf, 'is-perf')}</div>
                    </div>`).join('')}</div>
            </div>`;
        }
    };
    handlers['power-options'] = {
        change(ev) {
            if (ev.target.name !== 'cpl-power') return;
            if (R()) void R().set(POWER, { ActivePowerScheme: ev.target.value });
            root.dispatchEvent(new CustomEvent('melaton-power-plan', { detail: { plan: ev.target.value } }));
        },
        plan(t) {
            handlers['power-plan'].plan = t.dataset.plan;
            nav('power-plan');
        }
    };

    function minuteSelect(name, value) {
        return `<select class="cpl-vselect" data-power="${name}">${MINUTES.map((m) => `<option value="${m}"${m === Number(value) ? ' selected' : ''}>${minuteText(m)}</option>`).join('')}</select>`;
    }

    pages['power-plan'] = {
        parent: 'power-options',
        title: () => 'Edit Plan Settings',
        tasks: () => '',
        body: () => {
            const plan = handlers['power-plan'].plan || activePlan();
            const p = PLANS.find((x) => x.id === plan) || PLANS[0];
            return `<div class="cpl-vpage">${help('power')}
                <h1 class="cpl-vtitle">Change settings for the plan: ${esc(p.name)}</h1>
                <p class="cpl-vtext">Choose the sleep and display settings that you want your computer to use.</p>
                <table class="cpl-power-grid">
                    <tr><td><img src="${ART}/power-display.png" alt=""> Turn off the display:</td><td>${minuteSelect('display', planValue(p.id, 'display'))}</td></tr>
                    <tr><td><img src="${ART}/power-sleep.png" alt=""> Put the computer to sleep:</td><td>${minuteSelect('sleep', planValue(p.id, 'sleep'))}</td></tr>
                </table>
                <p class="cpl-vtext"><button type="button" class="cpl-vlink" data-cpl-vpage="advanced">Change advanced power settings</button></p>
                <p class="cpl-vtext"><button type="button" class="cpl-vlink" data-cpl-vpage="restore">Restore default settings for this plan</button></p>
                <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="save">Save changes</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="cancel">Cancel</button></div>
            </div>`;
        }
    };
    handlers['power-plan'] = {
        plan: null,
        async save() {
            const plan = handlers['power-plan'].plan || activePlan();
            const main = doc.querySelector('#melatonControlPanelModal .cpl-main');
            const values = {};
            main.querySelectorAll('[data-power]').forEach((s) => { values[s.dataset.power] = Number(s.value); });
            if (R()) await R().set(`${POWER}\\${plan}`, values);
            root.dispatchEvent(new CustomEvent('melaton-power-plan', { detail: { plan, ...values } }));
            handlers['power-plan'].plan = null;
            nav('power-options');
        },
        cancel() {
            handlers['power-plan'].plan = null;
            nav('power-options');
        },
        async restore() {
            const plan = handlers['power-plan'].plan || activePlan();
            if (R()) await R().set(`${POWER}\\${plan}`, null);
            nav('power-plan');
        },
        advanced() {
            msg('Melaton keeps the advanced power settings of each plan with the plan. Turn off the display and Put the computer to sleep are the settings this computer uses.', 'Power Options');
        }
    };

    pages['power-system'] = {
        parent: 'power-options',
        title: () => 'System Settings',
        tasks: () => '',
        body: () => {
            const opt = (v, cur, label) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
            const actions = (cur) => [opt('nothing', cur, 'Do nothing'), opt('sleep', cur, 'Sleep'), opt('hibernate', cur, 'Hibernate'), opt('shutdown', cur, 'Shut down')].join('');
            const pw = reg(POWER, 'RequirePasswordOnWakeup', true);
            return `<div class="cpl-vpage">${help('power')}
                <h1 class="cpl-vtitle">Define power buttons and turn on password protection</h1>
                <p class="cpl-vtext">Choose the power settings that you want for your computer. The changes you make to the settings on this page apply to all of your power plans.</p>
                <div class="cpl-vsection"><span>Power and sleep buttons</span></div>
                <table class="cpl-power-grid">
                    <tr><td>When I press the power button:</td><td><select class="cpl-vselect" data-power-sys="PowerButtonAction">${actions(reg(POWER, 'PowerButtonAction', 'shutdown'))}</select></td></tr>
                    <tr><td>When I press the sleep button:</td><td><select class="cpl-vselect" data-power-sys="SleepButtonAction">${actions(reg(POWER, 'SleepButtonAction', 'sleep'))}</select></td></tr>
                </table>
                <div class="cpl-vsection"><span>Password protection on wakeup</span></div>
                <div class="cpl-vradio"><input type="radio" name="cpl-pw" id="cpl-pw-on" value="1"${pw ? ' checked' : ''}><label for="cpl-pw-on"><b>Require a password (recommended)</b></label>
                    <p class="cpl-vtext cpl-vindent">When your computer wakes from sleep, no one can access your data without entering the correct password to unlock the computer. <a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="accounts">Create or change your user account password</a></p></div>
                <div class="cpl-vradio"><input type="radio" name="cpl-pw" id="cpl-pw-off" value="0"${pw ? '' : ' checked'}><label for="cpl-pw-off"><b>Don't require a password</b></label>
                    <p class="cpl-vtext cpl-vindent">When your computer wakes from sleep, anyone can access your data because the computer isn't locked.</p></div>
                <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="save">Save changes</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="cancel">Cancel</button></div>
            </div>`;
        }
    };
    handlers['power-system'] = {
        async save() {
            const main = doc.querySelector('#melatonControlPanelModal .cpl-main');
            const values = {};
            main.querySelectorAll('[data-power-sys]').forEach((s) => { values[s.dataset.powerSys] = s.value; });
            const pw = main.querySelector('input[name="cpl-pw"]:checked');
            values.RequirePasswordOnWakeup = !pw || pw.value === '1';
            if (R()) await R().set(POWER, values);
            nav('power-options');
        },
        cancel() { nav('power-options'); },
        accounts() { if (CP()) CP().doAction('item:user-accounts'); }
    };

    pages['power-create'] = {
        parent: 'power-options',
        title: () => 'Create a Power Plan',
        tasks: () => '',
        body: () => `<div class="cpl-vpage">${help('power')}
            <h1 class="cpl-vtitle">Create a power plan</h1>
            <p class="cpl-vtext">To create your own plan, start by selecting one of the following plans that is closest to what you want.</p>
            ${PLANS.map((p, i) => `<div class="cpl-vradio"><input type="radio" name="cpl-newplan" id="cpl-np-${p.id}" value="${p.id}"${i === 0 ? ' checked' : ''}><label for="cpl-np-${p.id}"><b>${esc(p.name)}</b></label></div>`).join('')}
            <p class="cpl-vtext">Plan name:</p>
            <input type="text" class="tbp-edit cpl-vedit" data-newplan-name value="My Custom Plan 1">
            <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="next">Next</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="cancel">Cancel</button></div>
        </div>`
    };
    handlers['power-create'] = {
        async next() {
            const main = doc.querySelector('#melatonControlPanelModal .cpl-main');
            const base = main.querySelector('input[name="cpl-newplan"]:checked').value;
            const name = main.querySelector('[data-newplan-name]').value.trim() || 'My Custom Plan 1';
            if (R()) await R().set(POWER, { CustomPlanName: name, CustomPlanBase: base, ActivePowerScheme: base });
            handlers['power-plan'].plan = base;
            nav('power-plan');
        },
        cancel() { nav('power-options'); }
    };

    // ---- Default Programs --------------------------------------------------------------------

    const ASSOC = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Explorer\\FileExts';
    const PROGRAMS = [
        { id: 'grimoire', name: 'Grimoire', publisher: 'Dreamscape', icon: '/static_images/app_icons/32/vista-iexplore.webp', text: 'Grimoire browses the Dreamscape wiki, its service pages and the web.', types: ['.htm', '.html', '.url', 'http', 'https'] },
        { id: 'dovecote', name: 'Dovecote', publisher: 'Dreamscape', icon: '/static_images/app_icons/32/vista-mail.webp', text: 'Dovecote sends and receives your mail.', types: ['.eml', 'mailto'] },
        { id: 'notepad', name: 'Notepad', publisher: 'Xyridian Corporation', icon: '/static_images/app_icons/32/vista-notepad.webp', text: 'Notepad opens and edits plain text files.', types: ['.txt', '.log', '.ini', '.json', '.md', '.csv'] },
        { id: 'lumen', name: 'Lumen', publisher: 'Dreamscape', icon: '/static_images/app_icons/32/vista-photo-viewer.webp', text: 'Lumen shows pictures one at a time.', types: ['.png', '.jpg', '.jpeg', '.webp', '.gif'] },
        { id: 'paint', name: 'Paint', publisher: 'Xyridian Corporation', icon: '/static_images/app_icons/32/vista-paint.webp', text: 'Paint creates and edits pictures in layers.', types: ['.bmp', '.png'] },
        { id: 'media-player', name: 'Melaton Media Player', publisher: 'Xyridian Corporation', icon: '/static_images/app_icons/32/media_player.webp', text: 'Melaton Media Player plays music and video.', types: ['.mp3', '.wav', '.mp4', '.webm', '.ogg'] },
        { id: 'cartograph', name: 'Cartograph', publisher: 'Xyridian Corporation', icon: '/static_images/app_icons/32/vista-explorer.webp', text: 'Cartograph browses the files and folders on the server.', types: ['folder', '.7z', '.zip'] }
    ];

    pages['default-programs'] = {
        title: () => 'Default Programs',
        tasks: () => tasks([], [{ t: 'Programs and Features', a: 'item:programs' }, { t: 'Parental Controls', a: 'item:parental-controls', s: true }]),
        body: () => {
            const arg = CP() && CP().pageArg('default-programs');
            if (arg === 'defaults') setTimeout(() => nav('default-programs-set'), 0);
            else if (arg === 'associate') setTimeout(() => nav('default-programs-assoc'), 0);
            const row = (icon, title, text, a) => `<div class="cpl-vtask-row"><img src="${ART}/${icon}.png" alt=""><div><button type="button" class="cpl-vlink cpl-vtask-title" ${a}>${esc(title)}</button><p class="cpl-vtext">${esc(text)}</p></div></div>`;
            return `<div class="cpl-vpage">${help('default-programs')}
                <h1 class="cpl-vtitle">Choose the programs that Melaton uses by default</h1>
                ${row('default-programs-set', 'Set your default programs', 'Make a program the default for all file types and protocols it can open.', 'data-cpl-action="nav" data-cpl-arg="default-programs-set"')}
                ${row('default-programs-assoc', 'Associate a file type or protocol with a program', 'Make a file type or protocol (such as .mp3 or http://) always open in a specific program.', 'data-cpl-action="nav" data-cpl-arg="default-programs-assoc"')}
                ${row('default-programs-autoplay', 'Change AutoPlay settings', 'Play CDs or other media automatically', 'data-cpl-action="do" data-cpl-arg="item:autoplay"')}
                ${row('default-programs-access', 'Set program access and computer defaults', 'Control access to certain programs and set defaults for this computer.', 'data-cpl-action="nav" data-cpl-arg="default-programs-access"')}
            </div>`;
        }
    };

    function defaultFor(type) {
        const p = PROGRAMS.find((x) => x.types.includes(type));
        return reg(ASSOC, type, p ? p.id : '');
    }

    pages['default-programs-set'] = {
        parent: 'default-programs',
        title: () => 'Set Default Programs',
        tasks: () => '',
        body: () => {
            const sel = handlers['default-programs-set'].sel || PROGRAMS[0].id;
            const p = PROGRAMS.find((x) => x.id === sel);
            const owned = p.types.filter((t) => defaultFor(t) === p.id).length;
            return `<div class="cpl-vpage">${help('default-programs')}
                <h1 class="cpl-vtitle">Set your default programs</h1>
                <p class="cpl-vtext">To set a program as the default for all file types and protocols it can open, click the program and then click Set as default.</p>
                <div class="cpl-dp-split">
                    <div class="cpl-dp-list vdt-edge" role="listbox">${PROGRAMS.map((x) => `<div class="cpl-dp-row${x.id === sel ? ' is-selected' : ''}" data-cpl-vpage="pick" data-prog="${x.id}"><img src="${esc(x.icon)}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(x.name)}</span></div>`).join('')}</div>
                    <div class="cpl-dp-detail">
                        <div class="cpl-dp-head"><img src="${esc(p.icon)}" alt=""><div><b>${esc(p.name)}</b><br>${esc(p.publisher)}</div></div>
                        <p class="cpl-vtext">${esc(p.text)}</p>
                        <p class="cpl-vtext">${owned === p.types.length ? 'This program has all its defaults' : `This program has ${owned} out of ${p.types.length} defaults`}</p>
                        <div class="cpl-dp-actions">
                            <button type="button" class="cpl-vtask-row cpl-dp-action" data-cpl-vpage="setdefault"><span class="cpl-dp-arrow"></span><span><b>Set this program as default</b><br>Use the selected program to open all file types and protocols it can open by default.</span></button>
                            <button type="button" class="cpl-vtask-row cpl-dp-action" data-cpl-vpage="choose"><span class="cpl-dp-arrow"></span><span><b>Choose defaults for this program</b><br>Choose which file types and protocols the selected program opens by default.</span></button>
                        </div>
                    </div>
                </div>
                <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-action="nav" data-cpl-arg="default-programs">OK</button></div>
            </div>`;
        }
    };
    handlers['default-programs-set'] = {
        sel: null,
        pick(t) { handlers['default-programs-set'].sel = t.dataset.prog; nav('default-programs-set'); },
        async setdefault() {
            const p = PROGRAMS.find((x) => x.id === (handlers['default-programs-set'].sel || PROGRAMS[0].id));
            const values = {};
            p.types.forEach((t) => { values[t] = p.id; });
            if (R()) await R().set(ASSOC, values);
            nav('default-programs-set');
        },
        choose() { nav('default-programs-assoc'); }
    };

    pages['default-programs-assoc'] = {
        parent: 'default-programs',
        title: () => 'Set Associations',
        tasks: () => '',
        body: () => {
            const types = [];
            PROGRAMS.forEach((p) => p.types.forEach((t) => types.push(t)));
            types.sort();
            const sel = handlers['default-programs-assoc'].sel || types[0];
            const name = (id) => (PROGRAMS.find((x) => x.id === id) || { name: 'Unknown application' }).name;
            return `<div class="cpl-vpage">${help('default-programs')}
                <h1 class="cpl-vtitle">Associate a file type or protocol with a specific program</h1>
                <p class="cpl-vtext">Click on an extension to view the program that currently opens it by default. To change the default program, click Change program.</p>
                <div class="cpl-assoc-head"><b>${esc(sel)}</b> &nbsp; ${esc(name(defaultFor(sel)))} <button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="change">Change program...</button></div>
                <div class="cpl-assoc vdt-edge">
                    <div class="cpl-assoc-row is-head"><span>Name</span><span>Description</span><span>Current Default</span></div>
                    ${types.map((t) => `<div class="cpl-assoc-row${t === sel ? ' is-selected' : ''}" data-cpl-vpage="pick" data-type="${esc(t)}"><span>${esc(t)}</span><span>${esc(t.startsWith('.') ? `${t.slice(1).toUpperCase()} File` : t === 'folder' ? 'File Folder' : `URL:${t.toUpperCase()} Protocol`)}</span><span>${esc(name(defaultFor(t)))}</span></div>`).join('')}
                </div>
                <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-action="nav" data-cpl-arg="default-programs">Close</button></div>
            </div>`;
        }
    };
    handlers['default-programs-assoc'] = {
        sel: null,
        pick(t) { handlers['default-programs-assoc'].sel = t.dataset.type; nav('default-programs-assoc'); },
        async change() {
            const type = handlers['default-programs-assoc'].sel || '.bmp';
            const html = `<div class="cpl-openwith">${PROGRAMS.map((p, i) => `<label class="cpl-openwith-row"><input type="radio" name="cpl-ow" value="${p.id}"${i === 0 ? ' checked' : ''}><img src="${esc(p.icon)}" alt=""> ${esc(p.name)}</label>`).join('')}</div>`;
            const pick = await callGlobal('showConfirmationDialog', html, [{ text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, {
                title: 'Open With', width: 380,
                resolveValue: (v, dialog) => (v ? (dialog.querySelector('input[name="cpl-ow"]:checked') || {}).value : null)
            });
            if (pick && R()) await R().set(ASSOC, { [type]: pick });
            nav('default-programs-assoc');
        }
    };

    pages['default-programs-access'] = {
        parent: 'default-programs',
        title: () => 'Set Program Access and Computer Defaults',
        tasks: () => '',
        body: () => {
            const cfg = reg(ASSOC, 'Configuration', 'melaton');
            const opt = (id, title, text) => `<div class="cpl-vradio"><input type="radio" name="cpl-spad" id="cpl-spad-${id}" value="${id}"${cfg === id ? ' checked' : ''}><label for="cpl-spad-${id}"><b>${title}</b></label><p class="cpl-vtext cpl-vindent">${text}</p></div>`;
            return `<div class="cpl-vpage">${help('default-programs')}
                <h1 class="cpl-vtitle">Set Program Access and Computer Defaults</h1>
                <p class="cpl-vtext">A program configuration specifies default programs for certain activities, such as Web browsing or sending e-mail, and which programs are accessible from the Start menu, desktop, and other locations.</p>
                ${opt('melaton', 'Melaton', 'Grimoire, Dovecote, Melaton Media Player and the other programs that came with Melaton are the defaults.')}
                ${opt('nonms', 'Non-Xyridian', 'The programs you installed from other publishers are the defaults where you have them.')}
                ${opt('custom', 'Custom', 'Choose a default program for each activity.')}
                <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="ok">OK</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-action="nav" data-cpl-arg="default-programs">Cancel</button></div>
            </div>`;
        }
    };
    handlers['default-programs-access'] = {
        async ok() {
            const v = doc.querySelector('#melatonControlPanelModal input[name="cpl-spad"]:checked');
            if (v && R()) await R().set(ASSOC, { Configuration: v.value });
            nav('default-programs');
        }
    };

    // ---- Backup and Restore Center -----------------------------------------------------------

    const BACKUP = 'HKLM\\Software\\Xyridian\\Melaton\\CurrentVersion\\WindowsBackup';

    pages.backup = {
        title: () => 'Backup and Restore Center',
        tasks: () => tasks([[
            { t: 'Repair Melaton using System Restore', a: 'js:restore', s: true },
            { t: 'Create a restore point or change settings', a: 'item:system', s: true }
        ]], [{ t: 'Melaton Easy Transfer', a: 'js:transfer', icon: SHIELD }], 'Tasks'),
        body: () => {
            const last = reg(BACKUP, 'LastBackup', '');
            const image = reg(BACKUP, 'LastImage', '');
            const btn = (label, name, shield) => `<button type="button" class="tbp-button cpl-vbutton cpl-backup-btn" data-cpl-vpage="${name}">${shield ? `<img src="${SHIELD}" alt="">` : ''}${esc(label)}</button>`;
            return `<div class="cpl-vpage">${help('backup')}
                <h1 class="cpl-vtitle">Protect your files and computer by backing them up</h1>
                <div class="cpl-backup-box">
                    <div class="cpl-backup-head"><img src="${ART}/backup-backup.png" alt=""><span>Back up files or your entire computer</span></div>
                    <div class="cpl-backup-row"><p>Create backup copies of your files and folders.${last ? `<br><br>The last successful backup was on ${esc(last)}.` : ''}</p>${btn('Back up files', 'backupfiles', true)}</div>
                    <div class="cpl-backup-row"><p>Create a Melaton Complete PC Backup and Restore image of your entire computer, which can be used to recover from a hardware failure.<span class="cpl-backup-note">${image ? `The last Melaton Complete PC Backup and Restore image was created on ${esc(image)}.` : 'A Melaton Complete PC Backup and Restore image has not been created.'}</span></p>${btn('Back up computer', 'backupcomputer', true)}</div>
                    <div class="cpl-backup-foot"><button type="button" class="cpl-vlink" data-cpl-vpage="help" data-topic="backup">Which type of backup should I make?</button></div>
                </div>
                <div class="cpl-backup-box">
                    <div class="cpl-backup-head"><img src="${ART}/backup-restore.png" alt=""><span>Restore files or your entire computer</span></div>
                    <div class="cpl-backup-row"><p>Restore files and folders from a backup.<span class="cpl-backup-tip"><img src="/static_images/vista-cpl/bulb-16.png" alt="">You can use shadow copies to restore previous versions of files that have been accidentally modified or deleted. <a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="help" data-topic="backup">What are shadow copies?</a></span></p><div class="cpl-backup-col">${btn('Restore files', 'restorefiles')}<button type="button" class="cpl-vlink" data-cpl-vpage="restorefiles">Advanced restore</button></div></div>
                    <div class="cpl-backup-row"><p>Restore your entire computer from a Melaton Complete PC Backup and Restore image.</p>${btn('Restore computer', 'restorecomputer')}</div>
                    <div class="cpl-backup-foot"><img src="${SHIELD}" alt=""><button type="button" class="cpl-vlink" data-cpl-vpage="restore">Use System Restore to fix problems and undo changes to Melaton.</button></div>
                </div>
            </div>`;
        }
    };
    handlers.backup = {
        // Melaton's files live on the server: its replication is the backup (dataManagementDsapApplet.js)
        backupfiles() { callGlobal('openDataManagementDsap', 'replication'); },
        backupcomputer() { callGlobal('openDataManagementDsap', 'replication'); },
        restorefiles() { callGlobal('openDataManagementDsap', 'replication'); },
        restorecomputer() { callGlobal('openDataManagementDsap', 'replication'); },
        restore() { msg('System Restore is managed by the Dreamscape server. Your files are restored from the server\'s replicas in Data Management.', 'System Restore'); },
        transfer() { callGlobal('openVistaImportWizard'); }
    };

    // ---- Speech Recognition Options ----------------------------------------------------------

    pages['speech-recognition'] = {
        title: () => 'Speech Recognition Options',
        tasks: () => tasks([[
            { t: 'Advanced speech options', a: 'dialog:text-to-speech:recognition' },
            { t: 'Text to Speech', a: 'dialog:text-to-speech:tts' }
        ]], [{ t: 'Ease of Access', a: 'item:ease-of-access' }, { t: 'Audio Devices', a: 'item:sound' }]),
        body: () => {
            const row = (icon, title, text, name) => `<div class="cpl-vtask-row is-32"><img src="${ART}/${icon}.png" alt=""><div><button type="button" class="cpl-vlink cpl-vtask-title" data-cpl-vpage="${name}">${esc(title)}</button><p class="cpl-vtext">${esc(text)}</p></div></div>`;
            return `<div class="cpl-vpage">${help('speech')}
                <h1 class="cpl-vtitle">Configure your Speech Recognition experience</h1>
                ${row('speech-start', 'Start Speech Recognition', 'Start using your voice to control your computer.', 'start')}
                ${row('speech-mic', 'Set up microphone', 'Set up your computer to work properly with Speech Recognition.', 'mic')}
                ${row('speech-tutorial', 'Take Speech Tutorial', 'Learn to use your computer with speech.  Learn basic commands and dictation.', 'tutorial')}
                ${row('speech-train', 'Train your computer to better understand you', 'Read text to your computer to improve your computer\'s ability to understand your voice.  Doing this isn\'t necessary, but can help improve dictation accuracy.', 'train')}
                ${row('speech-card', 'Open the Speech Reference Card', 'View and print a list of common commands to keep with you so you always know what to say.', 'card')}
                <p class="cpl-vtext cpl-vgap">If you would like to learn more about speech related tools and support from Xyridian, <a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="help" data-topic="speech">please visit the Xyridian Speech Online Community</a>.</p>
            </div>`;
        }
    };
    handlers['speech-recognition'] = {
        // the browser's own speech recognition, where it has one (Chrome: webkitSpeechRecognition)
        start() {
            const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
            if (!SR) {
                msg('Speech Recognition is not available in this browser.', 'Speech Recognition');
                return;
            }
            if (handlers['speech-recognition'].rec) {
                handlers['speech-recognition'].rec.stop();
                handlers['speech-recognition'].rec = null;
                return;
            }
            const rec = new SR();
            rec.continuous = true;
            rec.interimResults = false;
            rec.onresult = (ev) => {
                const text = Array.from(ev.results).slice(ev.resultIndex).map((r) => r[0].transcript).join(' ').trim();
                // a few of Vista's commands; anything else is typed into the focused field
                const cmd = text.toLowerCase();
                if (/^start$|^open start$/.test(cmd)) callGlobal('toggleStartMenu');
                else if (/^stop listening$/.test(cmd)) { rec.stop(); handlers['speech-recognition'].rec = null; }
                else if (doc.activeElement && /^(INPUT|TEXTAREA)$/.test(doc.activeElement.tagName)) {
                    const el = doc.activeElement;
                    el.setRangeText(`${text} `, el.selectionStart, el.selectionEnd, 'end');
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                }
            };
            rec.onend = () => { handlers['speech-recognition'].rec = null; };
            try { rec.start(); handlers['speech-recognition'].rec = rec; } catch (_) { /* already started */ }
        },
        mic() { if (root.cplDialogs) root.cplDialogs.open('text-to-speech', 'recognition'); },
        tutorial() { callGlobal('openHelpAndSupport', 'speech'); },
        train() { if (root.cplDialogs) root.cplDialogs.open('text-to-speech', 'recognition'); },
        card() { callGlobal('openHelpAndSupport', 'speech-commands'); },
        rec: null
    };

    // ---- register ----------------------------------------------------------------------------

    function register() {
        const cp = CP();
        if (!cp) return false;
        Object.entries(pages).forEach(([id, page]) => cp.registerPage(id, page));
        wire();
        return true;
    }

    // Help and Support is the Grimoire (modalUtils.js Start menu places); a topic opens it there
    if (typeof root.openHelpAndSupport !== 'function') {
        root.openHelpAndSupport = (topic) => {
            if (typeof root.openHelpAndSupportCenter === 'function') return root.openHelpAndSupportCenter(topic);
            const places = callGlobal('getStartMenuPlaces') || [];
            const helpPlace = places.find((p) => p && p.id === 'help');
            if (helpPlace && typeof helpPlace.action === 'function') return helpPlace.action();
            return undefined;
        };
    }

    root.cplPages = { register, tasks, help, pages, handlers, msg, esc, reg, wire, ART, ITEMS };
    if (!register() && doc) doc.addEventListener('DOMContentLoaded', register);
})(typeof window !== 'undefined' ? window : globalThis);
