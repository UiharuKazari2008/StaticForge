/**
 * Melaton Mobile: Task Manager (WM 6.1 Professional's taskmgr.exe), Yozora #732, parent #709.
 *
 * Measured on the Device Emulator (VGA halved; ~/.cache/wm61/ref-apps/taskmgr*.png, tm-*.png):
 *   header      18 px tint band (Application | Mem | CPU, 2 px black column rules, 1 px rule under)
 *   rows        18 px, bold: the app's 16 px icon at x 2, its name, Mem and CPU right-aligned
 *   soft keys   End Task | Menu (Switch To, End All Tasks, View > Applications / Processes,
 *               Sort By > Memory / CPU / Name, Refresh, Exit); the Processes view has no End Task
 *
 * What runs: every shell app that has been on screen since the page loaded (the shell keeps an app's
 * page until it is ended; Today is the shell itself, never listed), and each desktop program hosted
 * by wmHost.js (window.wmHost.list()). Ending a hosted program closes its windows their own way (the
 * window's close button), as wmHost's Menu > Close does; a shell app leaves the list (the shell has no
 * unload: when window.wmShell.endApp exists it is called and the app really ends).
 * Mem is the size of the app's page (its element count, about 0.25 KB each: what this tab spends on
 * it); CPU is the share of the last refresh interval spent in long tasks while the app was on screen
 * (PerformanceObserver 'longtask'). Programs lists it in place of the desktop's Task Manager
 * (wmPrograms.js MAPPED). Only on phones. Styles: public/css/wm-task-manager.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'taskmgr';
    const REFRESH_MS = 2000;
    const root = document.documentElement;
    let ws = null;
    let page = null;
    let view = 'apps'; // 'apps' | 'procs'
    let sortBy = 'mem'; // 'mem' | 'cpu' | 'name' (the device starts on Memory)
    let sel = null;
    let timer = null;

    // the device's process names for the stock programs; others are <id>.exe
    const EXE = {
        calculator: 'MobileCalculator.exe', calendar: 'poutlook.exe', contacts: 'poutlook.exe', taskmgr: 'taskmgr.exe',
        'windows-media': 'wmplayer.exe', notes: 'notes.exe', fileexplorer: 'fexplore.exe', ie: 'iexplore.exe',
        messaging: 'tmail.exe', settings: 'ctlpnl.exe', programs: 'shell32.exe', help: 'peghelp.exe', tasks: 'poutlook.exe', search: 'shfind.exe'
    };

    // ---------------------------------------------------------------- what runs

    const running = new Map(); // id -> { since }
    const cpuMs = new Map(); // id -> long-task ms in the current interval
    const cpuShown = new Map(); // id -> % at the last refresh
    let lastSample = performance.now();

    // the shell's own screens (Today, Programs, Settings, Help) and its pages over an app are not tasks
    const SHELL_SCREENS = new Set(['today', 'programs', 'settings', 'help', 'pv-goto', 'pv-vindex', 'wm-op', 'wm-file']);

    function noteCurrent() {
        const id = root.dataset.wmApp;
        if (!id || SHELL_SCREENS.has(id)) return;
        if (!running.has(id)) running.set(id, { since: Date.now() });
    }

    try {
        new MutationObserver(noteCurrent).observe(root, { attributes: true, attributeFilter: ['data-wm-app'] });
    } catch (_) { /* no observer: the list holds what was current when it opened */ }

    try {
        const po = new PerformanceObserver((list) => {
            const id = root.dataset.wmApp || 'today';
            let ms = 0;
            for (const e of list.getEntries()) ms += e.duration;
            cpuMs.set(id, (cpuMs.get(id) || 0) + ms);
        });
        po.observe({ type: 'longtask', buffered: false });
    } catch (_) { /* longtask unsupported: CPU reads 0 % */ }

    function sampleCpu() {
        const now = performance.now();
        const span = Math.max(1, now - lastSample);
        lastSample = now;
        cpuShown.clear();
        for (const [id, ms] of cpuMs) cpuShown.set(id, Math.min(100, Math.round((ms / span) * 100)));
        cpuMs.clear();
    }

    function registered() {
        const map = new Map();
        try { ws.listApps().forEach((a) => map.set(a.id, a)); } catch (_) { /* shell not ready */ }
        return map;
    }

    function hosted() {
        try { return (window.wmHost && typeof window.wmHost.list === 'function') ? window.wmHost.list() : []; } catch (_) { return []; }
    }

    function memKb(id) {
        const p = ws.pageOf ? (document.querySelector(`#wmShell .wm-page[data-app="${CSS.escape(id)}"]`)) : null;
        if (!p) return 4;
        return Math.max(4, Math.round(p.getElementsByTagName('*').length * 0.25));
    }

    function memText(kb) {
        if (kb >= 1024) return `${(kb / 1024).toFixed(2)}M`;
        if (kb >= 100) return `${Math.round(kb)}K`;
        return `${kb.toFixed(kb < 10 ? 2 : 1)}K`.replace(/^(\d+\.\d)0K$/, '$1K');
    }

    function tasks() {
        // the observer runs after the shell's show(): the app on screen now counts at once
        noteCurrent();
        if (ws.current && !SHELL_SCREENS.has(ws.current) && !running.has(ws.current)) running.set(ws.current, { since: Date.now() });
        const apps = registered();
        const host = hosted();
        const hostIds = new Set(host.map((h) => h.id));
        // a hosted program whose windows all closed is no longer running
        for (const id of [...running.keys()]) {
            if (id.startsWith('host:') && !hostIds.has(id)) running.delete(id);
            else if (!apps.has(id) && !id.startsWith('host:')) running.delete(id);
        }
        host.forEach((h) => { if (!running.has(h.id)) running.set(h.id, { since: Date.now() }); });
        const out = [];
        for (const id of running.keys()) {
            const a = apps.get(id);
            const h = host.find((x) => x.id === id);
            out.push({
                id,
                title: (h && h.title) || (a && (a.startLabel || a.title)) || id,
                icon: (a && a.icon) || 'app-programs',
                exe: EXE[id] || `${String(id).replace(/^host:/, '').replace(/[^a-z0-9_-]+/gi, '')}.exe`,
                mem: memKb(id),
                cpu: cpuShown.get(id) || 0
            });
        }
        return out;
    }

    function processes(list) {
        // the shell itself (Today, title bar, menus): what the page holds outside the apps' pages
        const all = document.getElementById('wmShell');
        const total = all ? all.getElementsByTagName('*').length : 0;
        const inApps = [...document.querySelectorAll('#wmShell .wm-page')].reduce((n, p) => n + p.getElementsByTagName('*').length, 0);
        const shell = { id: 'today', title: 'shell32.exe', exe: 'shell32.exe', icon: 'app-today', mem: Math.max(4, Math.round((total - inApps) * 0.25)), cpu: cpuShown.get('today') || 0, proc: true };
        let heap = null;
        try { if (performance.memory) heap = performance.memory.usedJSHeapSize / 1024; } catch (_) { /* not Chrome */ }
        const rows = [shell];
        const byExe = new Map();
        for (const t of list) {
            const r = byExe.get(t.exe);
            if (r) { r.mem += t.mem; r.cpu += t.cpu; r.ids.push(t.id); } else byExe.set(t.exe, { ...t, title: t.exe, ids: [t.id], proc: true });
        }
        rows.push(...byExe.values());
        if (heap) rows.push({ id: 'nk', title: 'NK.EXE', exe: 'NK.EXE', icon: 'app-programs', mem: Math.round(heap), cpu: 0, proc: true });
        return rows;
    }

    function sorted(rows) {
        const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
        return rows.sort((a, b) => (sortBy === 'name' ? coll.compare(a.title, b.title)
            : sortBy === 'cpu' ? (b.cpu - a.cpu) || (b.mem - a.mem) : (b.mem - a.mem) || coll.compare(a.title, b.title)));
    }

    // ---------------------------------------------------------------- the page

    function rowsNow() {
        const list = tasks();
        return sorted(view === 'procs' ? processes(list) : list);
    }

    function render() {
        if (!page) return;
        const rows = rowsNow();
        if (!rows.some((r) => r.id === sel)) sel = rows.length ? rows[0].id : null;
        page.querySelector('.wtm-h-name').textContent = view === 'procs' ? 'Process' : 'Application';
        const icon = (r) => (view === 'procs' && !EXE[r.id] && r.id !== 'today' && !String(r.icon).startsWith('/') ? 'app-programs' : r.icon);
        page.querySelector('.wtm-list').innerHTML = rows.map((r) => `<div class="wtm-row${r.id === sel ? ' is-selected' : ''}" role="option" aria-selected="${r.id === sel}" data-id="${ws.escapeHtml(r.id)}">
            <span class="wtm-ico">${ws.art.img(icon(r))}</span><span class="wtm-name">${ws.escapeHtml(r.title)}</span><span class="wtm-mem">${memText(r.mem)}</span><span class="wtm-cpu">${Math.min(100, r.cpu)} %</span></div>`).join('');
        ws.refreshSoftKeys();
    }

    function schedule() {
        clearTimeout(timer);
        if (!page || page.hidden || ws.current !== APP_ID) return;
        timer = setTimeout(() => { sampleCpu(); render(); schedule(); }, REFRESH_MS);
    }

    function selected() {
        return rowsNow().find((r) => r.id === sel) || null;
    }

    // ---------------------------------------------------------------- actions

    function closeHosted(id) {
        const p = document.querySelector(`#wmShell .wm-page[data-app="${CSS.escape(id)}"]`);
        if (!p) return;
        // top window first, each by its own close control (its code saves or discards)
        const wins = [...p.querySelectorAll('.modal')].filter((w) => w.parentElement && !w.parentElement.closest('.modal')).reverse();
        for (const win of wins) {
            const btn = win.querySelector(':scope > .modal-window-controls .close-btn, :scope > .modal-window-controls [id^="close"], :scope > .modal-window-title .close-btn, [data-action="close"]')
                || win.querySelector('[data-dialog-cancel], [data-action="cancel"]')
                || [...win.querySelectorAll('button')].find((b) => /^\s*(cancel|close)\s*$/i.test(b.textContent || ''));
            if (btn) btn.click();
            else if (typeof window.closeModal === 'function') { try { window.closeModal(win); } catch (_) { /* gone */ } }
        }
    }

    function end(id) {
        if (!id || id === 'today' || id === 'nk') return;
        if (typeof ws.endApp === 'function') { try { ws.endApp(id); } catch (_) { /* below */ } }
        if (id.startsWith('host:')) closeHosted(id);
        running.delete(id);
        cpuShown.delete(id);
    }

    async function endSelected() {
        const r = selected();
        if (!r) return;
        const ids = r.ids || [r.id];
        if (ids.includes(APP_ID)) { exit(); return; }
        await ws.busy(() => { ids.forEach(end); }, { paint: true });
        // hosted windows close on their own timers: list again once they had the chance
        render();
        setTimeout(render, 1100);
    }

    async function endAll() {
        await ws.busy(() => { [...running.keys()].filter((id) => id !== APP_ID).forEach(end); }, { paint: true });
        render();
        setTimeout(render, 1100);
    }

    function switchTo() {
        const r = selected();
        if (!r) return;
        const id = (r.ids && r.ids[0]) || r.id;
        if (id === APP_ID) return;
        if (id === 'today' || id === 'nk') { ws.open('today'); return; }
        ws.open(id, { fromStart: true });
    }

    function exit() {
        running.delete(APP_ID);
        if (typeof ws.endApp === 'function') { try { ws.endApp(APP_ID); return; } catch (_) { /* below */ } }
        ws.back();
    }

    function menuItems() {
        const r = selected();
        return [
            { label: 'Switch To', action: switchTo, disabled: !r || view === 'procs' },
            { label: 'End All Tasks', action: endAll, disabled: view === 'procs' },
            '-',
            { label: 'View', submenu: [
                { label: 'Applications', checked: view === 'apps', action: () => { view = 'apps'; sel = null; render(); } },
                { label: 'Processes', checked: view === 'procs', action: () => { view = 'procs'; sel = null; render(); } }
            ] },
            { label: 'Sort By', submenu: [
                { label: 'Memory', checked: sortBy === 'mem', action: () => { sortBy = 'mem'; render(); } },
                { label: 'CPU', checked: sortBy === 'cpu', action: () => { sortBy = 'cpu'; render(); } },
                { label: 'Name', checked: sortBy === 'name', action: () => { sortBy = 'name'; render(); } }
            ] },
            '-',
            { label: 'Refresh', action: () => { sampleCpu(); render(); } },
            { label: 'Exit', action: exit }
        ];
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-task-manager');
        p.innerHTML = `
            <div class="wtm-head" role="row"><span class="wtm-h-name">Application</span><span class="wtm-h-mem">Mem</span><span class="wtm-h-cpu">CPU</span></div>
            <div class="wtm-list wm-pv-scroll" role="listbox" aria-label="Running programs"></div>`;
        const list = p.querySelector('.wtm-list');
        let holdTimer = null;
        let held = false;
        list.addEventListener('pointerdown', (e) => {
            const row = e.target.closest('.wtm-row');
            if (!row) return;
            held = false;
            const { clientX: x, clientY: y } = e;
            clearTimeout(holdTimer);
            holdTimer = setTimeout(() => {
                held = true;
                sel = row.dataset.id;
                render();
                if (view === 'apps') ws.menuAt(x, y, [{ label: 'Switch To', action: switchTo }, { label: 'End Task', action: endSelected }]);
            }, ((window.wmShell && window.wmShell.holdMs) || 600));
        });
        const cancel = () => clearTimeout(holdTimer);
        list.addEventListener('pointerup', cancel);
        list.addEventListener('pointercancel', cancel);
        list.addEventListener('contextmenu', (e) => e.preventDefault());
        list.addEventListener('click', (e) => {
            const row = e.target.closest('.wtm-row');
            if (!row || held) return;
            // a tap on the selected program switches to it (as Switch To)
            if (row.dataset.id === sel && view === 'apps') { switchTo(); return; }
            sel = row.dataset.id;
            list.querySelectorAll('.wtm-row').forEach((r) => {
                const on = r === row;
                r.classList.toggle('is-selected', on);
                r.setAttribute('aria-selected', String(on));
            });
            ws.refreshSoftKeys();
        });
    }

    function register() {
        ws = window.wmShell;
        noteCurrent();
        ws.registerApp({
            id: APP_ID,
            title: 'Task Manager',
            icon: 'app-task-manager',
            inStart: 'programs',
            sip: true,
            mount,
            show() { sampleCpu(); sel = null; render(); schedule(); },
            hide() { clearTimeout(timer); },
            softKeys() {
                return {
                    left: view === 'apps' ? { label: 'End Task', action: endSelected, disabled: !sel } : null,
                    right: { label: 'Menu', menu: menuItems }
                };
            }
        });
    }

    window.wmTaskManager = { running: () => tasks().map((t) => ({ id: t.id, title: t.title })), end };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
