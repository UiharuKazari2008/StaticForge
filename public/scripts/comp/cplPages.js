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
        const inWindow = (t) => t && t.closest('.cpl-instance');
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
    //
    // Vista's plans with Vista SP2's own defaults (the VM's PowerSettings DefaultPowerSchemeValues). In a browser and
    // in the Android app the plans are Melaton's registry values, as before. On DreamOS the machine keeps and applies
    // them (CaféReady power.rs: display off, sleep, processor states, brightness, power button and lid, separately on
    // battery and plugged in), and these pages show and edit the host's copy through window.DreamOSPowerOptions; a
    // laptop gets Vista's On battery / Plugged in columns and Change advanced power settings opens Vista's Advanced
    // settings sheet (#910).

    const POWER = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes';
    // display / sleep: minutes plugged in (Vista's ac) and on battery (dc); 0 = never
    const PLANS = [
        { id: 'balanced', name: 'Balanced', savings: 3, perf: 3, display: 20, sleep: 60, dcDisplay: 5, dcSleep: 15 },
        { id: 'saver', name: 'Power saver', savings: 6, perf: 2, display: 20, sleep: 60, dcDisplay: 3, dcSleep: 15 },
        { id: 'high', name: 'High performance', savings: 2, perf: 6, display: 20, sleep: 0, dcDisplay: 20, dcSleep: 60 }
    ];
    const MINUTES = [1, 2, 3, 5, 10, 15, 20, 25, 30, 45, 60, 120, 180, 240, 300, 0];
    const ACTION_TEXT = { nothing: 'Do nothing', sleep: 'Sleep', hibernate: 'Hibernate', shutdown: 'Shut down' };

    /** DreamOS' host, when this page runs on it: { get(), select, set, restore, create, remove, system } */
    function powerHost() {
        const h = root.DreamOSPowerOptions;
        return h && typeof h.get === 'function' ? h : null;
    }

    function hostState() {
        const h = powerHost();
        try { const s = h ? h.get() : null; return s && s.plans ? s : null; } catch (_) { return null; }
    }

    function minuteText(m) {
        if (!m) return 'Never';
        if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
        const h = Math.floor(m / 60);
        const r = m % 60;
        return r ? `${h} hour${h === 1 ? '' : 's'} ${r} minute${r === 1 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'}`;
    }

    /** [{ id, name, builtin, savings, perf }] in Vista's order: the built-in plans, then the user's */
    function planList() {
        const st = hostState();
        if (!st) return PLANS.map((p) => ({ ...p, builtin: true }));
        const ids = Object.keys(st.plans);
        const order = (id) => { const i = PLANS.findIndex((p) => p.id === id); return i < 0 ? 100 : i; };
        ids.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
        return ids.map((id) => {
            const base = PLANS.find((p) => p.id === (st.plans[id].base || id)) || PLANS[0];
            return { id, name: st.plans[id].name || base.name, builtin: st.plans[id].builtin !== false, savings: base.savings, perf: base.perf };
        });
    }

    function activePlan() {
        const st = hostState();
        return st ? st.active : reg(POWER, 'ActivePowerScheme', 'balanced');
    }

    /** minutes for display / sleep; `side` 'ac' (plugged in) or 'dc' (on battery) */
    function planValue(plan, name, side = 'ac') {
        const st = hostState();
        if (st) {
            const v = st.plans[plan] && st.plans[plan][side] ? st.plans[plan][side][name] : 0;
            return name === 'display' || name === 'sleep' ? Math.round((Number(v) || 0) / 60) : v;
        }
        const p = PLANS.find((x) => x.id === plan) || PLANS[0];
        if (side === 'dc') return reg(`${POWER}\\${p.id}`, `dc${name[0].toUpperCase()}${name.slice(1)}`, p[`dc${name[0].toUpperCase()}${name.slice(1)}`]);
        return reg(`${POWER}\\${p.id}`, name, p[name]);
    }

    /** a laptop: Vista's On battery / Plugged in columns */
    function onBatteryMachine() {
        const st = hostState();
        return !!(st && st.battery);
    }

    function powerNotice(plan) {
        root.dispatchEvent(new CustomEvent('melaton-power-plan', { detail: { plan } }));
    }

    async function hostCall(fn, ...args) {
        const h = powerHost();
        if (!h || typeof h[fn] !== 'function') return null;
        const r = await h[fn](...args);
        if (r && r.error) {
            msg(`Melaton can't save some of your changes to this plan's power settings. (${r.error})`, 'Power Options');
            return null;
        }
        return r;
    }

    function dots(n, cls) {
        return `<span class="cpl-power-dots ${cls}">${'<i></i>'.repeat(n)}</span>`;
    }

    const POWER_TASKS = () => tasks([[
        { t: 'Require a password on wakeup', a: 'page:power-system' },
        { t: onBatteryMachine() ? 'Choose what the power buttons do' : 'Choose what the power button does', a: 'page:power-system' },
        ...(onBatteryMachine() ? [{ t: 'Choose what closing the lid does', a: 'page:power-system' }] : []),
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
            const list = planList();
            const plan = (p) => `
                    <div class="cpl-power-plan">
                        <div class="cpl-power-name"><input type="radio" name="cpl-power" id="cpl-power-${esc(p.id)}" value="${esc(p.id)}"${p.id === active ? ' checked' : ''}><label for="cpl-power-${esc(p.id)}">${esc(p.name)}</label></div>
                        <button type="button" class="cpl-vlink cpl-power-change" data-cpl-vpage="plan" data-plan="${esc(p.id)}">Change plan settings</button>
                        <div class="cpl-power-meter"><span>${onBatteryMachine() ? 'Battery life:' : 'Energy savings:'}</span>${dots(p.savings, 'is-savings')}<span>Performance:</span>${dots(p.perf, 'is-perf')}</div>
                    </div>`;
            return `<div class="cpl-vpage">${help('power')}
                <h1 class="cpl-vtitle">Select a power plan</h1>
                <p class="cpl-vtext">Power plans can help you maximize your computer's performance or conserve energy. Make a plan active by selecting it, or choose a plan and customize it by changing its power settings. <a href="#" class="cpl-vlink is-underlined" data-cpl-vpage="help" data-topic="power">Tell me more about power plans</a></p>
                <div class="cpl-vsection"><span>${onBatteryMachine() ? 'Plans shown on the battery meter' : 'Preferred plans'}</span></div>
                <div class="cpl-power-plans">${list.map(plan).join('')}</div>
            </div>`;
        }
    };
    handlers['power-options'] = {
        async change(ev) {
            if (ev.target.name !== 'cpl-power') return;
            const plan = ev.target.value;
            if (powerHost()) await hostCall('select', plan);
            else if (R()) void R().set(POWER, { ActivePowerScheme: plan });
            powerNotice(plan);
        },
        plan(t) {
            handlers['power-plan'].plan = t.dataset.plan;
            nav('power-plan');
        }
    };

    function minuteSelect(name, value, side = 'ac') {
        const v = Number(value);
        const list = MINUTES.includes(v) ? MINUTES : [...MINUTES.slice(0, -1).filter((m) => m < v), v, ...MINUTES.filter((m) => m > v || m === 0)];
        return `<select class="cpl-vselect" data-power="${name}" data-side="${side}" aria-label="${side === 'dc' ? 'On battery' : 'Plugged in'}">${list.map((m) => `<option value="${m}"${m === v ? ' selected' : ''}>${minuteText(m)}</option>`).join('')}</select>`;
    }

    function percentSelect(name, value, side) {
        const v = Number(value) || 100;
        const steps = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
        const list = steps.includes(v) ? steps : [...steps, v].sort((a, b) => a - b);
        return `<select class="cpl-vselect" data-power="${name}" data-side="${side}" aria-label="${side === 'dc' ? 'On battery' : 'Plugged in'}">${list.map((p) => `<option value="${p}"${p === v ? ' selected' : ''}>${p}%</option>`).join('')}</select>`;
    }

    pages['power-plan'] = {
        parent: 'power-options',
        title: () => 'Edit Plan Settings',
        tasks: () => '',
        body: () => {
            const plan = handlers['power-plan'].plan || activePlan();
            const p = planList().find((x) => x.id === plan) || planList()[0];
            const st = hostState();
            const two = onBatteryMachine();
            const sleepOk = !st || (st.sleep && st.sleep.supported);
            const bright = !!(st && root.DreamOSHardware && (() => { try { return root.DreamOSHardware.get().backlight; } catch (_) { return null; } })());
            const row = (icon, labelText, cell) => `<tr><td>${icon ? `<img src="${ART}/${icon}" alt=""> ` : ''}${labelText}</td>${two ? `<td>${cell('dc')}</td>` : ''}<td>${cell('ac')}</td></tr>`;
            const head = two ? `<tr class="cpl-power-cols"><td></td><td>On battery</td><td>Plugged in</td></tr>` : '';
            const canDelete = st && !p.builtin && p.id !== activePlan();
            return `<div class="cpl-vpage">${help('power')}
                <h1 class="cpl-vtitle">Change settings for the plan: ${esc(p.name)}</h1>
                <p class="cpl-vtext">Choose the sleep and display settings that you want your computer to use.</p>
                <table class="cpl-power-grid">${head}
                    ${row('power-display.png', 'Turn off the display:', (side) => minuteSelect('display', planValue(p.id, 'display', side), side))}
                    ${sleepOk ? row('power-sleep.png', 'Put the computer to sleep:', (side) => minuteSelect('sleep', planValue(p.id, 'sleep', side), side)) : ''}
                    ${bright ? row('', 'Adjust plan brightness:', (side) => percentSelect('brightness', planValue(p.id, 'brightness', side), side)) : ''}
                </table>
                <p class="cpl-vtext"><button type="button" class="cpl-vlink" data-cpl-vpage="advanced">Change advanced power settings</button></p>
                ${canDelete ? '<p class="cpl-vtext"><button type="button" class="cpl-vlink" data-cpl-vpage="remove">Delete this plan</button></p>' : ''}
                <p class="cpl-vtext"><button type="button" class="cpl-vlink" data-cpl-vpage="restore">Restore default settings for this plan</button></p>
                <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="save">Save changes</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="cancel">Cancel</button></div>
            </div>`;
        }
    };

    async function ask(title, text) {
        const pick = await callGlobal('showConfirmationDialog', `<p><b>${esc(title)}</b></p><p>${esc(text)}</p>`,
            [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], null, { title: 'Power Options', width: 400 });
        return pick === true;
    }

    handlers['power-plan'] = {
        plan: null,
        async save() {
            const plan = handlers['power-plan'].plan || activePlan();
            const main = doc.querySelector('.cpl-instance.cpl-current .cpl-main');
            if (powerHost()) {
                const patch = { ac: {}, dc: {} };
                main.querySelectorAll('[data-power]').forEach((s) => {
                    const v = Number(s.value);
                    patch[s.dataset.side || 'ac'][s.dataset.power] = s.dataset.power === 'brightness' ? v : v * 60;
                });
                if (!await hostCall('set', plan, patch)) return;
            } else {
                const values = {};
                main.querySelectorAll('[data-power]').forEach((s) => { values[s.dataset.power] = Number(s.value); });
                if (R()) await R().set(`${POWER}\\${plan}`, values);
            }
            powerNotice(plan);
            handlers['power-plan'].plan = null;
            nav('power-options');
        },
        cancel() {
            handlers['power-plan'].plan = null;
            nav('power-options');
        },
        async restore() {
            const plan = handlers['power-plan'].plan || activePlan();
            if (!await ask("Are you sure you want to restore this plan's default settings?", "Clicking 'Yes' immediately restores all of the plan's default settings.")) return;
            if (powerHost()) await hostCall('restore', plan);
            else if (R()) await R().set(`${POWER}\\${plan}`, null);
            nav('power-plan');
        },
        async remove() {
            const plan = handlers['power-plan'].plan;
            if (!plan || !await ask('Are you sure you want to delete this plan?', "This plan can't be restored after you delete it.")) return;
            if (!await hostCall('remove', plan)) return;
            handlers['power-plan'].plan = null;
            nav('power-options');
        },
        advanced() {
            if (powerHost() && root.vistaDialogTemplate) { openAdvancedPower(handlers['power-plan'].plan || activePlan()); return; }
            msg('Melaton keeps the advanced power settings of each plan with the plan. Turn off the display and Put the computer to sleep are the settings this computer uses.', 'Power Options');
        }
    };

    // ---- Advanced settings (DreamOS): Vista's Power Options sheet, measured on the VM (Segoe UI 9: the icon, the
    // text, the plan box, the settings tree with "Setting:" or "On battery:" / "Plugged in:" rows, Restore plan
    // defaults). Only the settings this computer really applies are listed, as Vista lists only what the machine has.

    const ADV_TPL = {
        t: 'Advanced settings', w: 221, h: 183, f: ['Segoe UI', 9], s: 0,
        c: [
            [101, 'S', 12, 10, 18, 17, 0x50000003, '', 0],
            [102, 'S', 37, 10, 164, 26, 0x50020000, 'Select the power plan that you want to customize, and then choose settings that reflect how you want your computer to manage power.', 0],
            [103, 'C', 10, 41, 134, 100, 0x50210003, '', 0],
            [104, 'SysTreeView32', 10, 55, 201, 102, 0x50010025, '', 0x200],
            [105, 'B', 113, 163, 98, 12, 0x50010000, '&Restore plan defaults', 0]
        ]
    };

    function advGroups(st) {
        const two = !!st.battery;
        const groups = [
            { t: 'Additional settings', items: [{ key: 'passwordOnWake', t: 'Require a password on wakeup', type: 'yesno', global: true }] }
        ];
        if (st.sleep && st.sleep.supported) groups.push({ t: 'Sleep', items: [{ key: 'sleep', t: 'Sleep after', type: 'minutes' }] });
        const buttons = [{ key: 'power', t: 'Power button action', type: 'action' }, { key: 'sleepButton', t: 'Sleep button action', type: 'action' }];
        if (two) buttons.unshift({ key: 'lid', t: 'Lid close action', type: 'action' });
        groups.push({ t: 'Power buttons and lid', items: buttons });
        if (st.cpu) groups.push({ t: 'Processor power management', items: [{ key: 'cpuMin', t: 'Minimum processor state', type: 'pct' }, { key: 'cpuMax', t: 'Maximum processor state', type: 'pct' }] });
        const display = [{ key: 'display', t: 'Turn off display after', type: 'minutes' }];
        if (two) display.push({ key: 'brightness', t: 'Display brightness', type: 'pct' });
        groups.push({ t: 'Display', items: display });
        return groups;
    }

    function advValueControl(item, side, value, sleepOk) {
        const attrs = `data-adv="${item.key}" data-side="${side}"`;
        if (item.type === 'yesno') return `<select class="tbp-select cpl-pwr-value" ${attrs}><option value="1"${value ? ' selected' : ''}>Yes</option><option value="0"${value ? '' : ' selected'}>No</option></select>`;
        if (item.type === 'action') {
            const acts = ['nothing', ...(sleepOk ? ['sleep'] : []), 'shutdown'];
            if (!acts.includes(value)) acts.splice(1, 0, value);
            return `<select class="tbp-select cpl-pwr-value" ${attrs}>${acts.map((a) => `<option value="${a}"${a === value ? ' selected' : ''}>${esc(ACTION_TEXT[a] || a)}</option>`).join('')}</select>`;
        }
        if (item.type === 'minutes') {
            const m = Math.round((Number(value) || 0) / 60);
            const list = MINUTES.includes(m) ? MINUTES : [...MINUTES.slice(0, -1).filter((x) => x < m), m, ...MINUTES.filter((x) => x > m || x === 0)];
            return `<select class="tbp-select cpl-pwr-value" ${attrs}>${list.map((x) => `<option value="${x * 60}"${x === m ? ' selected' : ''}>${minuteText(x)}</option>`).join('')}</select>`;
        }
        // a percentage: Vista's spin box with "%" after it
        return `<input type="text" class="tbp-edit cpl-pwr-pct" inputmode="numeric" maxlength="3" value="${esc(value)}" ${attrs} autocomplete="off" spellcheck="false"><span class="cpl-pwr-unit">%</span>`;
    }

    function advTreeHtml(st, plan, open) {
        const p = st.plans[plan];
        const sides = st.battery ? [['dc', 'On battery:'], ['ac', 'Plugged in:']] : [['ac', 'Setting:']];
        const sleepOk = !!(st.sleep && st.sleep.supported);
        return advGroups(st).map((g, gi) => {
            const gOpen = open.has(`g${gi}`);
            const items = g.items.map((it, ii) => {
                const id = `g${gi}i${ii}`;
                const iOpen = open.has(id);
                // a setting of the whole computer (password on wakeup) has one value: "Setting:"
                const leaves = (it.global ? [['ac', 'Setting:']] : sides).map(([side, text]) => {
                    const value = it.global ? st[it.key] : p[side][it.key];
                    return `<div class="tbp-tree-row cpl-pwr-leaf"><span>${esc(text)}</span>${advValueControl(it, side, value, sleepOk)}</div>`;
                }).join('');
                return `<div class="cpl-pwr-node" role="treeitem" aria-expanded="${iOpen}" data-node="${id}"${iOpen ? ' data-open=""' : ''}><div class="tbp-tree-row cpl-pwr-item"><span class="cpl-pwr-exp" aria-hidden="true"></span><span>${esc(it.t)}</span></div><div class="cpl-pwr-kids">${leaves}</div></div>`;
            }).join('');
            return `<div class="cpl-pwr-node" role="treeitem" aria-expanded="${gOpen}" data-node="g${gi}"${gOpen ? ' data-open=""' : ''}><div class="tbp-tree-row cpl-pwr-group"><span class="cpl-pwr-exp" aria-hidden="true"></span><span>${esc(g.t)}</span></div><div class="cpl-pwr-kids">${items}</div></div>`;
        }).join('');
    }

    function openAdvancedPower(startPlan) {
        const V = root.vistaDialogTemplate;
        let plan = startPlan;
        const open = new Set(['g0', 'g0i0']); // Vista opens on Additional settings > Require a password on wakeup
        V.openSheet({
            id: 'cplPowerAdvanced',
            title: 'Power Options',
            icon: `${ITEMS}/power-options-16.png`,
            pages: [{ key: 'powercpl:adv', tpl: ADV_TPL, overrides: { 101: { image: `${ITEMS}/power-options-32.png` }, 104: { html: '', cls: 'tbp-tree cpl-pwr-tree' } } }],
            init(ctx) {
                const tree = ctx.holder(104);
                const fill = () => {
                    const st = hostState();
                    if (!st || !st.plans[plan]) return;
                    ctx.options(103, planList().map((x) => ({ value: x.id, text: `${x.name}${x.id === st.active ? ' [Active]' : ''}` })), plan);
                    tree.innerHTML = advTreeHtml(st, plan, open);
                };
                fill();
                tree.addEventListener('click', (ev) => {
                    const b = ev.target.closest('.cpl-pwr-exp, .cpl-pwr-group, .cpl-pwr-item');
                    if (!b) return;
                    const node = b.closest('.cpl-pwr-node');
                    const on = !node.hasAttribute('data-open');
                    node.toggleAttribute('data-open', on);
                    node.setAttribute('aria-expanded', String(on));
                    if (on) open.add(node.dataset.node); else open.delete(node.dataset.node);
                });
                tree.addEventListener('change', () => ctx.dirty());
                tree.addEventListener('input', (ev) => { if (ev.target.classList.contains('cpl-pwr-pct')) ctx.dirty(); });
                ctx.on(103, 'change', async () => {
                    // Vista keeps each plan's edits until OK; here they are applied before another plan is shown
                    if (ctx.store.dirtyPlan) await ctx.store.applyNow();
                    plan = String(ctx.get(103));
                    fill();
                });
                ctx.on(105, 'click', async () => {
                    if (!await ask("Are you sure you want to restore this plan's default settings?", "Clicking 'Yes' immediately restores all of the plan's default settings.")) return;
                    await hostCall('restore', plan);
                    fill();
                });
                ctx.store.applyNow = async () => {
                    const st = hostState();
                    if (!st) return;
                    const patch = { ac: {}, dc: {} };
                    let pw = null;
                    tree.querySelectorAll('[data-adv]').forEach((el) => {
                        const key = el.dataset.adv;
                        const side = el.dataset.side;
                        if (key === 'passwordOnWake') { pw = el.value === '1'; return; }
                        let v = el.value;
                        if (el.classList.contains('cpl-pwr-pct')) v = Math.max(key === 'brightness' ? 1 : 0, Math.min(100, Math.round(Number(v) || 0)));
                        else if (key === 'display' || key === 'sleep') v = Number(v);
                        if (st.plans[plan][side][key] !== v) patch[side][key] = v;
                    });
                    if (Object.keys(patch.ac).length || Object.keys(patch.dc).length) await hostCall('set', plan, patch);
                    if (pw !== null && pw !== !!st.passwordOnWake) await hostCall('system', { passwordOnWake: pw });
                    ctx.store.dirtyPlan = false;
                };
                tree.addEventListener('change', () => { ctx.store.dirtyPlan = true; });
            },
            async apply(ctx) {
                await ctx.store.applyNow();
                if (CP() && CP().currentPage() === 'power-plan') nav('power-plan');
            }
        });
    }

    pages['power-system'] = {
        parent: 'power-options',
        title: () => 'System Settings',
        tasks: () => '',
        body: () => {
            const st = hostState();
            const two = onBatteryMachine();
            const sleepOk = !st || (st.sleep && st.sleep.supported);
            const opt = (v, cur, text) => `<option value="${v}"${v === cur ? ' selected' : ''}>${text}</option>`;
            // DreamOS has no hibernation: Vista leaves Hibernate out where it is off
            const actions = (cur) => [opt('nothing', cur, 'Do nothing'), ...(sleepOk ? [opt('sleep', cur, 'Sleep')] : []), ...(st ? [] : [opt('hibernate', cur, 'Hibernate')]), opt('shutdown', cur, 'Shut down')].join('');
            const sysValue = (key, side, def) => {
                if (st) { const a = st.plans[st.active] || {}; return (a[side] && a[side][key]) || def; }
                return reg(POWER, { power: 'PowerButtonAction', sleepButton: 'SleepButtonAction', lid: 'LidCloseAction' }[key], def);
            };
            const cell = (key, side, def) => `<select class="cpl-vselect" data-power-sys="${key}" data-side="${side}" aria-label="${side === 'dc' ? 'On battery' : 'Plugged in'}">${actions(sysValue(key, side, def))}</select>`;
            const row = (text, key, def) => `<tr><td>${text}</td>${two ? `<td>${cell(key, 'dc', def)}</td>` : ''}<td>${cell(key, 'ac', def)}</td></tr>`;
            const head = two ? `<tr class="cpl-power-cols"><td></td><td>On battery</td><td>Plugged in</td></tr>` : '';
            const pw = st ? st.passwordOnWake !== false : reg(POWER, 'RequirePasswordOnWakeup', true);
            return `<div class="cpl-vpage">${help('power')}
                <h1 class="cpl-vtitle">Define power buttons and turn on password protection</h1>
                <p class="cpl-vtext">Choose the power settings that you want for your computer. The changes you make to the settings on this page apply to all of your power plans.</p>
                <div class="cpl-vsection"><span>${two ? 'Power and sleep buttons and lid settings' : 'Power and sleep button settings'}</span></div>
                <table class="cpl-power-grid">${head}
                    ${row('When I press the power button:', 'power', 'shutdown')}
                    ${row('When I press the sleep button:', 'sleepButton', 'sleep')}
                    ${two ? row('When I close the lid:', 'lid', 'sleep') : ''}
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
            const main = doc.querySelector('.cpl-instance.cpl-current .cpl-main');
            const pw = main.querySelector('input[name="cpl-pw"]:checked');
            const password = !pw || pw.value === '1';
            if (powerHost()) {
                const patch = { passwordOnWake: password, ac: {}, dc: {} };
                main.querySelectorAll('[data-power-sys]').forEach((s) => { patch[s.dataset.side || 'ac'][s.dataset.powerSys] = s.value; });
                if (!await hostCall('system', patch)) return;
            } else {
                const names = { power: 'PowerButtonAction', sleepButton: 'SleepButtonAction', lid: 'LidCloseAction' };
                const values = { RequirePasswordOnWakeup: password };
                main.querySelectorAll('[data-power-sys]').forEach((s) => { values[names[s.dataset.powerSys]] = s.value; });
                if (R()) await R().set(POWER, values);
            }
            nav('power-options');
        },
        cancel() { nav('power-options'); },
        accounts() { if (CP()) CP().doAction('item:user-accounts'); }
    };

    pages['power-create'] = {
        parent: 'power-options',
        title: () => 'Create a Power Plan',
        tasks: () => '',
        body: () => {
            const builtins = planList().filter((p) => p.builtin);
            const n = (planList().filter((p) => !p.builtin).length || 0) + 1;
            return `<div class="cpl-vpage">${help('power')}
            <h1 class="cpl-vtitle">Create a power plan</h1>
            <p class="cpl-vtext">To create your own plan, start by selecting one of the following plans that is closest to what you want.</p>
            ${builtins.map((p, i) => `<div class="cpl-vradio"><input type="radio" name="cpl-newplan" id="cpl-np-${p.id}" value="${p.id}"${i === 0 ? ' checked' : ''}><label for="cpl-np-${p.id}"><b>${esc(p.name)}</b></label></div>`).join('')}
            <p class="cpl-vtext">Plan name:</p>
            <input type="text" class="tbp-edit cpl-vedit" data-newplan-name value="My Custom Plan ${n}" autocomplete="off" spellcheck="false">
            <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="next">Next</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="cancel">Cancel</button></div>
        </div>`;
        }
    };
    handlers['power-create'] = {
        async next() {
            const main = doc.querySelector('.cpl-instance.cpl-current .cpl-main');
            const base = main.querySelector('input[name="cpl-newplan"]:checked').value;
            const name = main.querySelector('[data-newplan-name]').value.trim();
            if (!name) { msg('When you create a power plan, you must name it. Type a name in the box.', 'Power Options'); return; }
            if (planList().some((p) => p.name.toLowerCase() === name.toLowerCase())) {
                msg('The name that you entered is used by another power plan. Choose a different name for this plan.', 'Power Options');
                return;
            }
            if (powerHost()) {
                const r = await hostCall('create', base, name);
                if (!r) return;
                handlers['power-plan'].plan = r.created || base;
                powerNotice(handlers['power-plan'].plan);
            } else {
                if (R()) await R().set(POWER, { CustomPlanName: name, CustomPlanBase: base, ActivePowerScheme: base });
                handlers['power-plan'].plan = base;
            }
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
            const v = doc.querySelector('.cpl-instance.cpl-current input[name="cpl-spad"]:checked');
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
