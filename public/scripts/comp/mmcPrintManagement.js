/**
 * Print Management (Yozora #831 slice 8): Vista's printmanagement.msc as an MMC snap-in, for the
 * generation backends as printers (printQueue.js / modules/printSpooler.js). Laid out as the VM's
 * console:
 *
 *   Print Management
 *     Custom Filters
 *       All Printers (N)       Printer Name, Queue Status, Jobs In Queue, Server Name
 *       All Drivers (N)        Driver Name, Environment, Driver Version, Provider, Server Name
 *       Printers Not Ready     printers whose status is not Ready / Printing
 *       Printers With Jobs     printers with documents in queue
 *     Print Servers
 *       <server> (local)
 *         Drivers, Forms (the NovelAI page sizes), Ports (the backends' hosts), Printers
 *     Deployed Printers
 *
 * A printer row: Open Printer Queue... opens its print queue window (printQueueWindow.js); Action >
 * Show Extended View adds the Jobs pane under the list, with the documents in queue and, for
 * NovelAI, the printed documents kept from the generation request log (Keep printed documents).
 * Pause Printing, Set Printing Defaults, Manage Sharing, Print Test Page, Delete and Rename are
 * greyed: the backends cannot do them.
 *
 *   window.openPrintManagementConsole(printerId?)   opens it (on a printer: its server's Printers)
 *   window.mmcPrintManagement.def()                 the snap-in's def, for a console that hosts it
 */
(function (root) {
    'use strict';

    const ID = 'printManagement';
    const TITLE = 'Print Management';
    const ART = '/static_images/vista-print';
    const ICON16 = `${ART}/print-management-16.png`;
    const ICON32 = `${ART}/print-management-32.png`;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const pq = () => root.printQueue || null;

    // NovelAI's page sizes (Studio's resolution presets) as the server's forms; one unit = one pixel
    const FORMS = [
        ['Small Portrait', 512, 768], ['Small Landscape', 768, 512], ['Small Square', 640, 640],
        ['Normal Portrait', 832, 1216], ['Normal Landscape', 1216, 832], ['Normal Square', 1024, 1024],
        ['Large Portrait', 1024, 1536], ['Large Landscape', 1536, 1024], ['Large Square', 1472, 1472],
        ['Wallpaper Portrait', 1088, 1920], ['Wallpaper Landscape', 1920, 1088]
    ];

    /** This server's name, as Device Manager names the computer. */
    function serverName() {
        const dm = root.melatonDeviceManager;
        if (dm && typeof dm.computerName === 'function') { try { return dm.computerName(); } catch (_) { /* below */ } }
        const host = (root.location && root.location.hostname) || 'melaton';
        return `DREAMSCAPE-${host.split('.')[0].toUpperCase()}`.slice(0, 15);
    }

    function size(b) {
        const w = root.printQueueWindow;
        if (w && typeof w._size === 'function') return w._size(b);
        const n = Number(b) || 0;
        return n ? `${Math.round(n / 1024).toLocaleString('en-US')} KB` : '';
    }

    function printers() { const q = pq(); return q ? q.printers() : []; }
    function jobsFor(id) { const q = pq(); return q ? q.jobsFor(id) : []; }
    function drivers() {
        const seen = new Map();
        printers().forEach((p) => { if (!seen.has(p.driver)) seen.set(p.driver, p); });
        return Array.from(seen.values());
    }
    const notReady = (p) => p.status !== 'Ready' && p.status !== 'Printing';

    async function openQueue(id) {
        const q = pq();
        if (q) await q.open(id);
    }

    // ---- the snap-in --------------------------------------------------------------------------------

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: ICON16,
            icon32: ICON32,
            taskbarIcon: ICON16,
            treeWidth: 190,
            expanded: ['root', 'filters', 'servers', 'server'],
            about: { version: '6.0', lines: ['Manages printers, drivers, forms and ports of the generation backends.'] },
            nodes: () => {
                const all = printers();
                return [{
                    id: 'root', name: TITLE, icon: ICON16,
                    children: [
                        {
                            id: 'filters', name: 'Custom Filters', icon: `${ART}/filter-16.png`,
                            children: [
                                { id: 'f-printers', name: `All Printers (${all.length})`, icon: `${ART}/filter-16.png` },
                                { id: 'f-drivers', name: `All Drivers (${drivers().length})`, icon: `${ART}/filter-16.png` },
                                { id: 'f-notready', name: 'Printers Not Ready', icon: `${ART}/filter-16.png` },
                                { id: 'f-jobs', name: 'Printers With Jobs', icon: `${ART}/filter-16.png` }
                            ]
                        },
                        {
                            id: 'servers', name: 'Print Servers', icon: `${ART}/print-server-16.png`,
                            children: [{
                                id: 'server', name: `${serverName()} (local)`, icon: `${ART}/print-server-16.png`,
                                children: [
                                    { id: 'drivers', name: 'Drivers', icon: `${ART}/drivers-16.png` },
                                    { id: 'forms', name: 'Forms', icon: `${ART}/forms-16.png` },
                                    { id: 'ports', name: 'Ports', icon: `${ART}/ports-16.png` },
                                    { id: 'printers', name: 'Printers', icon: `${ART}/printers-16.png` }
                                ]
                            }]
                        },
                        { id: 'deployed', name: 'Deployed Printers', icon: `${ART}/printers-16.png` }
                    ]
                }];
            },
            page: (n, c) => page(n, c),
            commands: (n, c) => commands(n, c),
            selCommands: (n, key, c) => selCommands(n, key, c),
            action: (a, c) => action(a, c),
            rowOpen: (key, n, c) => {
                if (key && key.startsWith('p:')) void openQueue(key.slice(2));
                else if (key && key.startsWith('j:')) {
                    const p = c.data.extPrinter;
                    if (p) void openQueue(p);
                }
            },
            onSelectRow: (key, n, c) => {
                if (key && key.startsWith('p:') && c.data.extended && isPrinterList(n.id)) {
                    c.data.extPrinter = key.slice(2);
                    if (c.data.extPrinter === 'novelai') void loadHistory(c);
                    c.render();
                }
            },
            status: () => '',
            viewMenu: () => [],
            onOpen: (c) => {
                c.data.extended = !!c.reg('ExtendedView', false);
                c.data.listener = () => { if (!c.isActive || c.isActive()) c.refresh(); };
                const q = pq();
                if (q) { q.on(c.data.listener); void q.refresh(true); }
            },
            onClose: (c) => {
                const q = pq();
                if (q && c.data.listener) q.off(c.data.listener);
            }
        };
    }

    const isPrinterList = (id) => id === 'f-printers' || id === 'f-notready' || id === 'f-jobs' || id === 'printers';

    function printerRows(list) {
        const server = serverName();
        return list.map((p) => ({
            key: `p:${p.id}`,
            icon: `${ART}/printers-16.png`,
            data: { name: p.name, status: p.status, jobs: p.jobs, server }
        }));
    }

    const PRINTER_COLS = [
        { t: 'Printer Name', w: 196, key: 'name', text: (d) => d.name },
        { t: 'Queue Status', w: 98, key: 'status', text: (d) => d.status },
        { t: 'Jobs In Queue', w: 60, key: 'jobs', num: false, text: (d) => String(d.jobs), value: (d) => d.jobs },
        { t: 'Server Name', w: 100, key: 'server', text: (d) => d.server }
    ];

    const JOB_COLS = [
        { t: 'Document Name', w: 200, key: 'name', text: (d) => d.name },
        { t: 'Job Status', w: 80, key: 'status', text: (d) => d.status },
        { t: 'Owner', w: 80, key: 'owner', text: (d) => d.owner },
        { t: 'Pages', w: 60, key: 'pages', text: (d) => String(d.pages || ''), value: (d) => Number(d.pages) || 0 },
        { t: 'Size', w: 100, key: 'size', text: (d) => d.size },
        { t: 'Submitted', w: 140, key: 'submitted', text: (d) => d.when, value: (d) => d.at || 0 }
    ];

    const HISTORY_STATUS = { completed: 'Printed', failed: 'Error', cancelled: 'Deleted' };

    async function loadHistory(c) {
        if (c.data.historyLoading || c.data.history) return;
        const q = pq();
        if (!q) return;
        c.data.historyLoading = true;
        try {
            const r = await q.history({ limit: 100 });
            c.data.history = (r && r.jobs) || [];
        } catch (_) {
            c.data.history = [];
        }
        c.data.historyLoading = false;
        if (!c.isActive || c.isActive()) c.render();
    }

    function jobsPane(c) {
        const id = c.data.extPrinter;
        const q = pq();
        const p = id && q ? q.printer(id) : null;
        const live = id ? jobsFor(id) : [];
        const liveIds = new Set(live.map((j) => j.id));
        const rows = live.map((j) => ({
            key: `j:${j.id}`,
            icon: `${ART}/document-16.png`,
            data: { id: j.id, name: j.name, status: j.statusText || '', owner: j.owner, pages: j.pages, size: size(j.size), when: q ? q.timeSent(j.submitted) : '', at: j.submitted, cancellable: j.cancellable }
        }));
        if (id === 'novelai' && Array.isArray(c.data.history)) {
            c.data.history.filter((h) => !liveIds.has(h.id) && HISTORY_STATUS[h.status]).forEach((h) => rows.push({
                key: `j:${h.id}`,
                icon: `${ART}/document-16.png`,
                data: { id: h.id, name: h.name, status: HISTORY_STATUS[h.status], owner: h.owner, pages: h.pages, size: '', when: q ? q.timeSent(h.submitted) : '', at: h.submitted, cancellable: false }
            }));
        }
        return `<div class="pm-ext-pane">
                <div class="pm-ext-title">${esc(p ? p.name : '')}</div>
                <div class="pm-ext-tabs"><span class="pm-ext-tab is-selected">Jobs</span></div>
                <div class="pm-ext-jobs">${c.listView(JOB_COLS, p ? rows : [], { sortId: 'pm-jobs', sort: { key: 'submitted', dir: -1 }, empty: ' ' })}</div>
            </div>`;
    }

    function printerList(c, list) {
        const top = c.listView(PRINTER_COLS, printerRows(list), { sortId: 'pm-printers', empty: 'There are no items to show in this view.' });
        if (!c.data.extended) return { html: top, list: true };
        if (!c.data.extPrinter || !list.some((p) => p.id === c.data.extPrinter)) {
            c.data.extPrinter = (list[0] || {}).id || null;
            if (c.data.extPrinter === 'novelai') void loadHistory(c);
        }
        return { html: `<div class="pm-ext"><div class="pm-ext-top">${top}</div>${jobsPane(c)}</div>`, list: true, split: true };
    }

    function page(n, c) {
        const all = printers();
        const server = serverName();
        const folder = (rows) => ({
            html: c.listView([{ t: 'Name', w: 200, key: 'name', text: (d) => d.name }],
                rows.map((r) => ({ key: `n:${r.id}`, open: r.id, icon: r.icon, data: { name: r.name } }))),
            list: true
        });
        switch (n.id) {
            case 'root': return folder([
                { id: 'filters', name: 'Custom Filters', icon: `${ART}/filter-16.png` },
                { id: 'servers', name: 'Print Servers', icon: `${ART}/print-server-16.png` },
                { id: 'deployed', name: 'Deployed Printers', icon: `${ART}/printers-16.png` }
            ]);
            case 'filters': return folder([
                { id: 'f-printers', name: `All Printers (${all.length})`, icon: `${ART}/filter-16.png` },
                { id: 'f-drivers', name: `All Drivers (${drivers().length})`, icon: `${ART}/filter-16.png` },
                { id: 'f-notready', name: 'Printers Not Ready', icon: `${ART}/filter-16.png` },
                { id: 'f-jobs', name: 'Printers With Jobs', icon: `${ART}/filter-16.png` }
            ]);
            case 'servers': return folder([{ id: 'server', name: `${server} (local)`, icon: `${ART}/print-server-16.png` }]);
            case 'server': return folder([
                { id: 'drivers', name: 'Drivers', icon: `${ART}/drivers-16.png` },
                { id: 'forms', name: 'Forms', icon: `${ART}/forms-16.png` },
                { id: 'ports', name: 'Ports', icon: `${ART}/ports-16.png` },
                { id: 'printers', name: 'Printers', icon: `${ART}/printers-16.png` }
            ]);
            case 'f-printers':
            case 'printers': return printerList(c, all);
            case 'f-notready': return printerList(c, all.filter(notReady));
            case 'f-jobs': return printerList(c, all.filter((p) => p.jobs > 0));
            case 'f-drivers':
            case 'drivers': return {
                html: c.listView([
                    { t: 'Driver Name', w: 196, key: 'name', text: (d) => d.name },
                    { t: 'Environment', w: 100, key: 'env', text: (d) => d.env },
                    { t: 'Driver Version', w: 120, key: 'ver', text: (d) => d.ver },
                    { t: 'Provider', w: 100, key: 'provider', text: (d) => d.provider },
                    { t: 'Server Name', w: 100, key: 'server', text: (d) => d.server }
                ], drivers().map((p) => ({ key: `d:${p.driver}`, icon: `${ART}/drivers-16.png`, data: { name: p.driver, env: 'Melaton x64', ver: '1.0.0.0', provider: p.provider || '', server } })), { sortId: 'pm-drivers' }),
                list: true
            };
            case 'forms': return {
                html: c.listView([
                    { t: 'Form Name', w: 180, key: 'name', text: (d) => d.name },
                    { t: 'Type', w: 100, key: 'type', text: () => 'Built In' },
                    { t: 'Width (0.1mm units)', w: 110, key: 'w', text: (d) => String(d.w), value: (d) => d.w },
                    { t: 'Height (0.1mm units)', w: 110, key: 'h', text: (d) => String(d.h), value: (d) => d.h },
                    { t: 'Imageable Width (0.1mm units)', w: 150, key: 'iw', text: (d) => String(d.w), value: (d) => d.w },
                    { t: 'Imageable Height (0.1mm units)', w: 150, key: 'ih', text: (d) => String(d.h), value: (d) => d.h }
                ], FORMS.map(([name, w, h]) => ({ key: `fm:${name}`, icon: `${ART}/forms-16.png`, data: { name, w, h } })), { sortId: 'pm-forms' }),
                list: true
            };
            case 'ports': return {
                html: c.listView([
                    { t: 'Port Name', w: 160, key: 'name', text: (d) => d.name },
                    { t: 'Port Monitor', w: 120, key: 'mon', text: () => 'Standard TCP/IP Port' },
                    { t: 'Port Description', w: 120, key: 'desc', text: () => 'Standard TCP/IP Port' },
                    { t: 'Port Type', w: 80, key: 'type', text: () => 'Read/Write' },
                    { t: 'Printer Name', w: 150, key: 'printer', text: (d) => d.printer }
                ], all.map((p) => ({ key: `pt:${p.id}`, icon: `${ART}/ports-16.png`, data: { name: p.port, printer: p.name } })), { sortId: 'pm-ports' }),
                list: true
            };
            case 'deployed': return {
                html: c.listView([
                    { t: 'Printer Name', w: 196, key: 'name', text: (d) => d.name },
                    { t: 'Connection Type', w: 120, key: 'type', text: (d) => d.type },
                    { t: 'GPO', w: 160, key: 'gpo', text: (d) => d.gpo }
                ], []),
                list: true
            };
            default: return '';
        }
    }

    function commands(n, c) {
        if (isPrinterList(n.id)) {
            return [
                { text: 'Add Printer...', action: 'noop', disabled: true },
                { text: c.data.extended ? 'Hide Extended View' : 'Show Extended View', action: 'extended' },
                { separator: true },
                { text: 'Refresh', action: 'refresh', icon: 3 },
                { text: 'Export List...', action: 'noop', disabled: true }
            ];
        }
        if (n.id === 'server') {
            return [
                { text: 'Add Printer...', action: 'noop', disabled: true },
                { text: 'Add Driver...', action: 'noop', disabled: true },
                { text: 'Manage Forms...', action: 'noop', disabled: true },
                { text: 'Manage Ports...', action: 'noop', disabled: true }
            ];
        }
        return [];
    }

    function selCommands(n, key, c) {
        if (!key) return null;
        const q = pq();
        if (key.startsWith('p:')) {
            const p = q && q.printer(key.slice(2));
            if (!p) return null;
            return {
                title: p.name,
                items: [
                    { text: 'Open Printer Queue...', action: 'open-queue' },
                    { separator: true },
                    { text: 'Pause Printing', action: 'noop', disabled: true },
                    { separator: true },
                    { text: 'Set Printing Defaults...', action: 'noop', disabled: true },
                    { text: 'Manage Sharing...', action: 'noop', disabled: true },
                    { text: 'Print Test Page', action: 'noop', disabled: true },
                    { separator: true },
                    { text: 'Delete', action: 'noop', disabled: true },
                    { text: 'Rename', action: 'noop', disabled: true }
                ]
            };
        }
        if (key.startsWith('j:')) {
            const id = key.slice(2);
            const live = c.data.extPrinter ? jobsFor(c.data.extPrinter).find((j) => j.id === id) : null;
            return {
                title: (live && live.name) || 'Document',
                items: [
                    { text: 'Cancel', action: 'job-cancel', disabled: !(live && live.cancellable) },
                    { separator: true },
                    { text: 'Open Printer Queue...', action: 'open-queue' }
                ]
            };
        }
        return null;
    }

    async function action(a, c) {
        switch (a) {
            case 'noop': return true;
            case 'extended':
                c.data.extended = !c.data.extended;
                c.setReg({ ExtendedView: c.data.extended });
                c.refresh();
                return true;
            case 'refresh': {
                c.data.history = null;
                const q = pq();
                if (q) await q.refresh(true);
                if (c.data.extended && c.data.extPrinter === 'novelai') void loadHistory(c);
                c.refresh();
                return true;
            }
            case 'open-queue': {
                const key = c.sel || '';
                const id = key.startsWith('p:') ? key.slice(2) : c.data.extPrinter;
                if (id) await openQueue(id);
                return true;
            }
            case 'job-cancel': {
                const id = (c.sel || '').slice(2);
                const q = pq();
                if (!q || !id) return true;
                const ok = await c.box('<p class="pq-instruction">Are you sure you want to cancel the document?</p>',
                    [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }],
                    { title: 'Printers', icon: 'warning' });
                if (!ok) return true;
                const r = await q.cancel(id);
                if (r && r.success === false && r.code !== 'NOT_FOUND') {
                    await c.box(`<p>${esc(r.error || 'The document could not be cancelled.')}</p>`, null, { title: 'Printers', icon: 'error' });
                }
                return true;
            }
            default: return false;
        }
    }

    async function openPrintManagementConsole(printerId) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (root.featureLoader) await root.featureLoader.loadFeature('print_queue');
        if (!root.mmcConsole) return null;
        const c = root.mmcConsole.open(def(), printerId ? { node: 'printers' } : {});
        if (c && printerId) {
            if (c.node !== 'printers') c.select('printers', true);
            c.selectRow(`p:${printerId}`);
        }
        return c;
    }

    root.openPrintManagementConsole = openPrintManagementConsole;
    root.mmcPrintManagement = { open: openPrintManagementConsole, def };
})(typeof window !== 'undefined' ? window : globalThis);
