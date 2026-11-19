/**
 * Control Panel's Vista pages, third set (Yozora #632): the folder items (Administrative Tools,
 * Fonts, Printers, Bluetooth Devices), which Vista shows with Explorer's command bar and Favorite
 * Links pane in the Control Panel window, and the dialog-like items Vista draws itself (Scanners
 * and Cameras, Color Management, the Add Hardware wizard).
 *
 *   Printers           print through the browser's print dialog; the default is a registry value
 *   Bluetooth Devices  Add Wireless Device asks the browser (Web Bluetooth) for a device
 *   Fonts              Melaton's own fonts and the browser's; double-click shows the font
 *   Scanners/Cameras   the browser's cameras (navigator.mediaDevices), after the person allows it
 */
(function (root) {
    'use strict';

    const K = root.cplPages;
    if (!K) return;
    const { handlers, msg, esc, reg } = K;
    const doc = typeof document !== 'undefined' ? document : null;
    const R = () => root.melatonRegistry;
    const CP = () => root.melatonControlPanel;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const ITEMS = '/static_images/vista-cpl/items';
    const FAV = '/static_images/vista-explorer';

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function rerender() {
        const cp = CP();
        if (cp && cp.currentPage()) cp.navigate(cp.currentPage(), { replace: true });
    }

    /** Explorer's Favorite Links pane, as Vista shows it beside a Control Panel folder. */
    function favorites() {
        const fav = [['Documents', 'fav-documents'], ['Pictures', 'fav-pictures'], ['Music', 'fav-music'], ['Recently Changed', 'fav-recent'], ['Searches', 'fav-searches'], ['Public', 'fav-public']];
        return `<div class="cpl-fav">
            <div class="cpl-fav-head">Favorite Links</div>
            ${fav.map(([t, img]) => `<button type="button" class="cpl-fav-link" data-cpl-vpage="fav" data-fav="${esc(t)}"><img src="${FAV}/${img}.png" alt="">${esc(t)}</button>`).join('')}
            <div class="cpl-fav-folders">Folders<img src="${FAV}/folders-up.png" alt=""></div>
        </div>`;
    }
    handlers['*'].fav = () => callGlobal('openExplorerApplet');

    // ---- Sort By: Organize's submenu and the column headers, for every folder page --------------

    const sortState = {};

    /** A cell's sort key: sizes and dates by their amount, other text A to Z. */
    function sortKey(v) {
        const s = String(v == null ? '' : v).trim();
        const size = s.match(/^([\d.,]+)\s*(bytes|KB|MB|GB)$/i);
        if (size) return parseFloat(size[1].replace(/,/g, '')) * { bytes: 1, kb: 1024, mb: 1048576, gb: 1073741824 }[size[2].toLowerCase()];
        if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) { const t = Date.parse(s.replace(/(\d)(AM|PM)/i, '$1 $2')); if (!Number.isNaN(t)) return t; }
        return s.toLowerCase();
    }

    /** The rows in the page's chosen order (by one column, either way). */
    function sortRows(page, rows, cellOf) {
        const st = sortState[page];
        if (!st) return rows;
        const dir = st.direction === 'desc' ? -1 : 1;
        return rows.slice().sort((a, b) => {
            const x = sortKey(cellOf(a, st.col));
            const y = sortKey(cellOf(b, st.col));
            if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
            return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
        });
    }

    /** The headers' sorted mark: Vista's little arrow over the sorted column. */
    function headMark(page, i) {
        const st = sortState[page];
        return st && st.col === i ? ` is-sorted is-${st.direction}` : '';
    }

    const pageColumns = {};

    // the Organize menu: Sort By (contextMenu.js vistaSortByMenu) and the page's own commands
    function organizeMenu(page) {
        const cols = pageColumns[page] || ['Name'];
        const st = sortState[page] || { col: -1, direction: 'asc' };
        const items = [];
        if (root.vistaSortByMenu) items.push(root.vistaSortByMenu(cols.map((t, i) => [String(i), t]), String(st.col), st.direction, 'cpl-sort'));
        const extra = handlers[page] && typeof handlers[page].organizeItems === 'function' ? handlers[page].organizeItems() : [];
        if (extra.length) items.push({ separator: true }, ...extra);
        return items;
    }

    function organizeAction(page, action) {
        const st = sortState[page] || { col: -1, direction: 'asc' };
        const next = root.vistaSortByApply && root.vistaSortByApply(action, 'cpl-sort', { field: String(st.col), direction: st.direction });
        if (next) {
            const cols = pageColumns[page] || [];
            const col = Number(next.field);
            // a new column starts in its own order: dates and sizes newest / largest first
            const fresh = col !== st.col;
            const direction = fresh ? (/date|size|installed/i.test(cols[col] || '') ? 'desc' : 'asc') : next.direction;
            sortState[page] = { col, direction };
            rerender();
            return;
        }
        const h = handlers[page];
        if (action.startsWith('cpl-org:') && h && typeof h[action.slice(8)] === 'function') h[action.slice(8)]();
    }

    if (doc) {
        // the Organize buttons are drawn with the page: their menu is attached as the pointer comes
        doc.addEventListener('pointerdown', (ev) => {
            const btn = ev.target.closest && ev.target.closest('.cpl-instance [data-cpl-vpage="organize"]');
            if (!btn || !root.contextMenu) return;
            const page = CP() && CP().currentPage();
            root.contextMenu.detachClickMenuFromElement(btn);
            root.contextMenu.attachClickMenuToElement(btn, {
                sections: [{ type: 'list', initfn: (section) => { section.items = organizeMenu(page); } }],
                onAction: (action) => organizeAction(page, action)
            });
        }, true);
    }

    // a column header: sort by it; again turns the order round
    handlers['*'].sortcol = (t) => {
        const page = CP() && CP().currentPage();
        const col = Number(t.dataset.col);
        const st = sortState[page];
        const cols = pageColumns[page] || [];
        sortState[page] = st && st.col === col
            ? { col, direction: st.direction === 'asc' ? 'desc' : 'asc' }
            : { col, direction: /date|size|installed/i.test(cols[col] || '') ? 'desc' : 'asc' };
        rerender();
    };

    root.cplSort = { sortRows, headMark, columns: (page, cols) => { pageColumns[page] = cols; } };

    /** The command bar and a details list; rows: { id, icon, cells: [...] }. */
    function folder(commands, cols, rows, opts = {}) {
        const page = CP() && CP().currentPage();
        pageColumns[page] = cols.map((c) => c.t);
        rows = sortRows(page, rows, (r, i) => r.cells[i]);
        const bar = `<div class="cpl-fbar" role="toolbar">
            <button type="button" class="cpl-fbar-btn" data-cpl-vpage="organize"><img src="${FAV}/organize.png" alt="">Organize<span class="cpl-fbar-glyph"></span></button>
            <button type="button" class="cpl-fbar-btn" data-cpl-vpage="views"><img src="${FAV}/views-details.png" alt="">Views<span class="cpl-fbar-glyph"></span></button>
            ${commands.map((c) => `<button type="button" class="cpl-fbar-btn" data-cpl-vpage="${esc(c.v)}">${c.icon ? `<img src="${esc(c.icon)}" alt="">` : ''}${esc(c.t)}</button>`).join('')}
            <button type="button" class="cpl-fbar-help" data-cpl-vpage="help" data-topic="${esc(opts.topic || 'control-panel')}"><img src="${FAV}/help-16.png" alt=""></button>
        </div>`;
        const head = `<div class="cpl-flist-head">${cols.map((c, i) => `<span class="cpl-flist-col${headMark(page, i)}" data-cpl-vpage="sortcol" data-col="${i}" style="width:${c.w}px">${esc(c.t)}</span>`).join('')}<span class="cpl-flist-rest"></span></div>`;
        const body = opts.icons
            ? `<div class="cpl-flist-icons">${rows.map((r) => `<div class="cpl-ficon${r.id === opts.sel ? ' is-selected' : ''}" data-cpl-vpage="pick" data-id="${esc(r.id)}" tabindex="0"><img src="${esc(r.icon)}" alt="" onerror="this.style.visibility='hidden'"><span><b>${esc(r.cells[0])}</b>${r.cells.slice(1).map((c) => `<br>${esc(c)}`).join('')}</span>${r.check ? '<i class="cpl-ficon-check"></i>' : ''}</div>`).join('')}</div>`
            : `<div class="cpl-flist-rows">${rows.map((r) => `<div class="cpl-frow${r.id === opts.sel ? ' is-selected' : ''}" data-cpl-vpage="pick" data-id="${esc(r.id)}" tabindex="0">${r.cells.map((c, i) => `<span style="width:${cols[i] ? cols[i].w : 100}px">${i === 0 ? `<img src="${esc(r.icon)}" alt="" onerror="this.style.visibility='hidden'">` : ''}${esc(c)}</span>`).join('')}</div>`).join('')}</div>`;
        const status = `<div class="cpl-fstatus">${opts.status || `${rows.length} item${rows.length === 1 ? '' : 's'}`}</div>`;
        return `${bar}<div class="cpl-flist">${opts.icons ? '' : head}${body}</div>${status}`;
    }

    // double-click opens, as in Explorer (the folder's own handler 'open')
    if (doc) {
        doc.addEventListener('dblclick', (ev) => {
            const row = ev.target.closest && ev.target.closest('.cpl-instance [data-cpl-vpage="pick"]');
            if (!row) return;
            const page = CP() && CP().currentPage();
            const h = handlers[page];
            if (h && typeof h.open === 'function') h.open(row.dataset.id);
        });
    }

    const pages = {};

    // ---- Administrative Tools ----------------------------------------------------------------

    const TOOLS = [
        { id: 'autofill-ranking', name: 'Autofill Ranking', icon: '/static_images/app_icons/16/vista-autofill-ranking.webp', open: () => callGlobal('openAutofillRankingSnapin') },
        { id: 'character-database', name: 'Character Database', icon: '/static_images/app_icons/16/vista-character-database.webp', open: () => callGlobal('openCharacterDbSnapin') },
        // Data Management stands in for Computer Management (#828); Device Manager has its own shortcut
        { id: 'computer-management', name: 'Computer Management', icon: '/static_images/app_icons/16/vista-computer-management.webp', open: () => callGlobal('openDataManagementSnapin') },
        { id: 'odbc', name: 'Data Sources (ODBC)', icon: `${ITEMS}/administrative-tools-16.png`, open: () => msg('No ODBC data sources are configured. Dreamscape keeps its data in the server\'s own databases.', 'ODBC Data Source Administrator') },
        { id: 'device-manager', name: 'Device Manager', icon: `${ITEMS}/device-manager-16.png`, open: () => callGlobal('openDeviceManager') },
        { id: 'dynamic-quips', name: 'Dynamic Quips', icon: '/static_images/app_icons/16/vista-dynamic-quips.webp', open: () => callGlobal('openDynamicQuipsSnapin') },
        { id: 'enshutsuka', name: 'Enshutsuka', icon: '/static_images/app_icons/16/vista-enshutsuka-2.webp', open: () => callGlobal('openEnshutsukaSnapin') },
        { id: 'event-viewer', name: 'Event Viewer', icon: '/static_images/app_icons/16/vista-event-viewer.webp', open: () => launch('event-viewer') },
        { id: 'exchange', name: 'Exchange Management Console', icon: '/static_images/app_icons/16/vista-exchange-management-console.webp', open: () => callGlobal('openExchangeConsole') },
        { id: 'front-gate', name: 'Front Gate', icon: `${ITEMS}/firewall-16.png`, open: () => callGlobal('openFrontGateConsole') },
        { id: 'iscsi', name: 'iSCSI Initiator', icon: `${ITEMS}/iscsi-initiator-16.png`, open: () => root.cplDialogs && root.cplDialogs.open('iscsi') },
        { id: 'key-manager', name: 'Key Manager', icon: '/static_images/vista-certmgr/keymgr-16.png', open: () => callGlobal('openKeyManagerConsole') },
        { id: 'memory', name: 'Memory Diagnostics Tool', icon: `${ITEMS}/administrative-tools-16.png`, open: () => memoryDiagnostics() },
        { id: 'messaging-bridge', name: 'Messaging Bridge', icon: '/melaton-apps/msgbridge/assets/msgbridge-16.png', open: () => { if (root.melatonApps) root.melatonApps.launch({ packageId: 'msgbridge' }).catch(() => {}); } },
        { id: 'print-management', name: 'Print Management', icon: '/static_images/app_icons/16/vista-print-management.webp', open: () => callGlobal('openPrintManagementSnapin') },
        { id: 'reliability', name: 'Reliability and Performance Monitor', icon: '/static_images/app_icons/16/vista-performance.webp', open: () => launch('perfmon') || launch('event-viewer') },
        { id: 'security-config', name: 'Security Configuration Management', icon: `${ITEMS}/security-center-16.png`, open: () => CP().doAction('item:security-center') },
        // Server Manager (#831 slice 5) replaced the Management Tools shortcut (the old dashboard page)
        { id: 'server-manager', name: 'Server Manager', icon: '/static_images/app_icons/16/vista-server-manager.webp', open: () => callGlobal('openServerManagerConsole') },
        { id: 'services', name: 'Services', icon: `${ITEMS}/administrative-tools-16.png`, open: () => launch('services') || CP().doAction('item:network') },
        { id: 'msconfig', name: 'System Configuration', icon: `${ITEMS}/system-16.png`, open: () => CP().doAction('item:system') },
        { id: 'task-scheduler', name: 'Task Scheduler', icon: `${ITEMS}/administrative-tools-16.png`, open: () => launch('task-scheduler') || msg('Task Scheduler is coming in a later update of Melaton.', 'Task Scheduler') },
        { id: 'wiki-caches', name: 'Wiki Caches', icon: '/static_images/app_icons/16/vista-wiki-caches.webp', open: () => callGlobal('openWikiCachesConsole') },
        { id: 'firewall-adv', name: 'Melaton Firewall with Advanced Security', icon: `${ITEMS}/firewall-16.png`, open: () => CP().doAction('item:firewall') },
        { id: 'powershell', name: 'Melaton PowerShell Modules', icon: `${ITEMS}/administrative-tools-16.png`, open: () => msg('Melaton PowerShell is not installed.', 'Melaton PowerShell Modules') }
    ];

    function launch(id) {
        const item = callGlobal('findStartMenuLaunchableById', id);
        if (!item) return false;
        callGlobal('launchStartMenuItem', item);
        return true;
    }

    /** Memory Diagnostics: the browser's own memory figures (performance.memory, deviceMemory). */
    function memoryDiagnostics() {
        const m = root.performance && root.performance.memory;
        const dev = root.navigator && root.navigator.deviceMemory;
        const mb = (b) => `${Math.round(b / 1048576)} MB`;
        msg(`${dev ? `This computer has about ${dev} GB of memory. ` : ''}${m ? `Melaton is using ${mb(m.usedJSHeapSize)} of ${mb(m.jsHeapSizeLimit)}. ` : ''}No memory problems were detected.`, 'Melaton Memory Diagnostics Tool');
    }

    pages['administrative-tools'] = {
        kind: 'folder',
        title: () => 'Administrative Tools',
        tasks: favorites,
        body: () => folder([], [{ t: 'Name', w: 250 }, { t: 'Date modified', w: 120 }, { t: 'Type', w: 100 }, { t: 'Size', w: 60 }],
            TOOLS.map((t) => ({ id: t.id, icon: t.icon, cells: [t.name, '11/2/2006 8:52 AM', 'Shortcut', '2 KB'] })),
            { sel: handlers['administrative-tools'].sel, topic: 'administrative-tools' })
    };
    handlers['administrative-tools'] = {
        sel: null,
        pick(t) { handlers['administrative-tools'].sel = t.dataset.id; markSel(t); },
        open(id) { const t = TOOLS.find((x) => x.id === id); if (t) t.open(); },
        organize() {}, views() {}
    };

    function markSel(row) {
        row.parentElement.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
        row.classList.add('is-selected');
    }

    // ---- Fonts -------------------------------------------------------------------------------

    const FONTS = [
        ['Segoe UI', 'TrueType'], ['Segoe UI Bold', 'TrueType', 'Segoe UI', 'bold'], ['Segoe UI Italic', 'TrueType', 'Segoe UI', 'normal', 'italic'],
        ['Tahoma', 'TrueType'], ['Tahoma Bold', 'TrueType', 'Tahoma', 'bold'], ['Verdana', 'TrueType'], ['Verdana Bold', 'TrueType', 'Verdana', 'bold'],
        ['Arial', 'OpenType'], ['Courier New', 'OpenType'], ['Georgia', 'TrueType'], ['Times New Roman', 'OpenType'], ['Trebuchet MS', 'TrueType'],
        ['Lucida Console', 'TrueType'], ['Consolas', 'TrueType'], ['Calibri', 'TrueType'], ['Cambria', 'TrueType'], ['Candara', 'TrueType'],
        ['Constantia', 'TrueType'], ['Corbel', 'TrueType'], ['Comic Sans MS', 'TrueType'], ['Impact', 'TrueType'], ['Palatino Linotype', 'OpenType'],
        ['Symbol', 'TrueType'], ['Webdings', 'TrueType'], ['Wingdings', 'TrueType'], ['Meiryo', 'TrueType'], ['MS Gothic', 'TrueType'], ['MS Mincho', 'TrueType']
    ];

    pages.fonts = {
        kind: 'folder',
        title: () => 'Fonts',
        tasks: favorites,
        body: () => folder([{ t: 'Install New Font', v: 'install' }], [{ t: 'Name', w: 230 }, { t: 'Font type', w: 100 }, { t: 'Size', w: 60 }],
            FONTS.map(([n, type]) => ({ id: n, icon: '/static_images/vista-cpl/items/fonts-16.png', cells: [n, type, ''] })),
            { sel: handlers.fonts.sel, topic: 'fonts' })
    };
    handlers.fonts = {
        sel: null,
        pick(t) { handlers.fonts.sel = t.dataset.id; markSel(t); },
        open(id) {
            const f = FONTS.find((x) => x[0] === id);
            if (!f) return;
            const family = f[2] || f[0];
            const style = `font-family:'${family}';font-weight:${f[3] || 'normal'};font-style:${f[4] || 'normal'}`;
            const sizes = [12, 18, 24, 36, 48, 60, 72];
            callGlobal('showConfirmationDialog', `<div class="cpl-font-preview">
                <p style="${style};font-size:24px">${esc(f[0])} (${esc(f[1])})</p>
                <p>Typeface name: ${esc(f[0])}<br>File size: -<br>Version: Version 5.00</p>
                <p style="${style};font-size:14px">abcdefghijklmnopqrstuvwxyz<br>ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>1234567890.:,;'"(!?)+-*/=</p>
                ${sizes.map((s) => `<p style="${style};font-size:${s}px;white-space:nowrap">${s} The quick brown fox jumps over the lazy dog. 1234567890</p>`).join('')}
            </div>`, [{ text: 'Done', value: true, className: 'btn-standard primary' }], null, { title: f[0], width: 620 });
        },
        install() {
            const input = doc.createElement('input');
            input.type = 'file';
            input.accept = '.ttf,.otf,.woff,.woff2';
            input.onchange = async () => {
                const file = input.files && input.files[0];
                if (!file || !root.FontFace) return;
                const name = file.name.replace(/\.[^.]+$/, '');
                try {
                    const face = new root.FontFace(name, await file.arrayBuffer());
                    await face.load();
                    doc.fonts.add(face);
                    FONTS.push([name, 'TrueType']);
                    msg(`${name} is installed for this session.`, 'Fonts');
                    rerender();
                } catch (_) {
                    msg(`The file ${file.name} is not a valid font file.`, 'Install Font');
                }
            };
            input.click();
        },
        organize() {}, views() {}
    };

    // ---- Printers ----------------------------------------------------------------------------

    const PRINT = 'HKCU\\Software\\Xyridian\\Melaton NT\\CurrentVersion\\Windows';
    const PRINTERS = [
        { id: 'fax', name: 'Fax', icon: '/static_images/vista-cpl/items/printers-32.png', model: 'Xyridian Shared Fax Driver' },
        { id: 'xps', name: 'Xyridian XPS Document Writer', icon: '/static_images/vista-cpl/items/printers-32.png', model: 'Xyridian XPS Document Writer' },
        { id: 'browser', name: 'Print with this browser', icon: '/static_images/vista-cpl/items/printers-32.png', model: 'Browser print dialog' }
    ];

    pages.printers = {
        kind: 'folder',
        title: () => 'Printers',
        tasks: favorites,
        body: () => {
            const arg = CP() && CP().pageArg('printers');
            if (arg === 'add') setTimeout(() => handlers.printers.add(), 0);
            const def = reg(PRINT, 'Device', 'xps');
            // the generation backends as printers (#831; printQueue.js): double-click opens the queue
            const pq = root.printQueue;
            const gen = pq ? pq.printers().map((p) => ({ id: `pq:${p.id}`, icon: '/static_images/vista-cpl/items/printers-32.png', cells: [p.name, String(p.jobs || 0), p.status] })) : [];
            return folder([{ t: 'Add a printer', v: 'add', icon: '/static_images/vista-cpl/items/printers-16.png' }],
                [{ t: 'Name', w: 200 }, { t: 'Documents', w: 70 }, { t: 'Status', w: 70 }, { t: 'Comments', w: 80 }, { t: 'Location', w: 80 }, { t: 'Model', w: 160 }],
                PRINTERS.map((p) => ({ id: p.id, icon: p.icon, check: p.id === def, cells: [p.name, '0', 'Ready'] })).concat(gen),
                { icons: true, sel: handlers.printers.sel, topic: 'printers' });
        }
    };
    handlers.printers = {
        sel: null,
        pick(t) { handlers.printers.sel = t.dataset.id; markSel(t); },
        open(id) {
            // a generation backend: its print queue window (printQueue.js, #831)
            if (id && String(id).startsWith('pq:') && root.printQueue) { void root.printQueue.open(String(id).slice(3)); return; }
            // print the active window's page through the browser
            root.print();
        },
        async add() {
            msg('Melaton prints through your browser. Use "Print with this browser" to print, or set it as the default printer.', 'Add Printer');
        },
        organize() {},
        organizeItems() {
            return [{ text: 'Set as Default Printer', action: 'cpl-org:setDefault', disabled: !handlers.printers.sel }];
        },
        async setDefault() {
            const id = handlers.printers.sel;
            if (!id || !R()) return;
            await R().set(PRINT, { Device: id });
            rerender();
        },
        views() {}
    };

    // ---- Bluetooth Devices -------------------------------------------------------------------

    const BTH = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters\\Devices';

    // The phone's Bluetooth (#945): the devices Melaton Mobile's Bluetooth applet lists (DSApp BluetoothControl,
    // window.AndroidBluetooth) show here too - this window's own phone (a DeX window of the Android app), and every
    // phone connected over ActiveSync, asked once when the page opens (activeSync status.bluetooth: no push, no poll).
    const BT_ART = '/static_images/vista-bth';
    const BT_CATEGORY = { audio: 'Audio/Video', phone: 'Phone', computer: 'Computer', peripheral: 'Peripheral', input: 'Peripheral', imaging: 'Imaging', wearable: 'Wearable', health: 'Health', toy: 'Toy' };
    const bt = { phones: new Map(), asking: false, askedAt: 0, sel: null };

    /** bthprops.cpl's picture for a device: headphones, headset, speaker, phone, computer, keyboard, mouse, camera, other. */
    function btIcon(d, size) {
        const svc = Array.isArray(d.services) ? d.services : [];
        const name = String(d.name || '');
        let i = 11;
        if (d.kind === 'audio') i = svc.includes('a2dp') && !svc.includes('headset') ? 19 : svc.includes('headset') ? 18 : 17;
        else if (d.kind === 'phone') i = 7;
        else if (d.kind === 'computer') i = 8;
        else if (d.kind === 'peripheral' || d.kind === 'input') i = /keyboard/i.test(name) ? 15 : /mouse|trackball|trackpad|mx master|pointer/i.test(name) ? 16 : 10;
        else if (d.kind === 'imaging') i = 6;
        return `${BT_ART}/bth-${i}-${size}.png`;
    }

    /** This window's own phone (the app's bridge, else its tray provider): { name, present, on, devices } or null. */
    function btLocal() {
        const b = root.AndroidBluetooth;
        if (b && typeof b.getState === 'function') {
            try {
                const s = JSON.parse(b.getState());
                if (s && typeof s === 'object') return { name: 'This computer', local: true, present: !!s.present, on: !!s.on, devices: Array.isArray(s.devices) ? s.devices : [] };
            } catch (_) { /* below */ }
        }
        const p = root.melatonTray && root.melatonTray.provider('bluetooth');
        let v = null;
        try { v = p && p.kind === 'android' ? p.get() : null; } catch (_) { v = null; }
        if (!v || !v.present) return null;
        return { name: 'This computer', local: true, present: true, on: !!v.on, devices: (v.devices || []).map((d) => ({ address: d.id, name: d.name, kind: d.kind, connected: d.connected, battery: d.battery })) };
    }

    /** The phones connected over ActiveSync (not this window's own Continuity phone): asked when the page opens. */
    function btAskPhones() {
        const as = root.activeSync;
        if (!as || typeof as.state !== 'function' || typeof as.call !== 'function' || bt.asking) return;
        if (Date.now() - bt.askedAt < 20000) return;
        let list = [];
        try { list = (as.state().devices || []).filter((d) => d && d.online && d.session && d.session !== 'pending'); } catch (_) { list = []; }
        if (!list.length) return;
        bt.asking = true;
        bt.askedAt = Date.now();
        Promise.all(list.map((d) => Promise.resolve(as.call(d.deviceId, 'status.bluetooth', {}, { timeoutMs: 8000 }))
            .then((r) => { if (r && typeof r === 'object') bt.phones.set(d.deviceId, { name: d.name || 'Phone', deviceId: d.deviceId, present: !!r.present, on: !!r.on, devices: Array.isArray(r.devices) ? r.devices : [] }); })
            .catch(() => { /* an older phone page: not listed */ })))
            .finally(() => {
                bt.asking = false;
                const cp = CP();
                if (cp && cp.currentPage() === 'bluetooth-devices') rerender();
            });
    }

    /** Every device to list: { id, source, address, name, kind, connected, battery, services, from }. */
    function btRows() {
        const out = [];
        const add = (src, key) => (src.devices || []).forEach((d) => out.push({
            id: `${key}|${d.address || d.name}`, source: key, address: String(d.address || ''), name: String(d.name || d.address || 'Bluetooth device'),
            kind: String(d.kind || 'other'), connected: !!d.connected, battery: d.battery == null ? null : Number(d.battery), services: d.services || [], from: src.name, local: !!src.local
        }));
        const local = btLocal();
        if (local) add(local, 'local');
        // a Continuity window's own phone answers locally; the same phone over ActiveSync is not listed twice
        bt.phones.forEach((src, deviceId) => { if (!local) add(src, `as:${deviceId}`); });
        reg(BTH, 'Paired', []).forEach((name) => out.push({ id: `web|${name}`, source: 'web', address: '', name, kind: 'other', connected: false, battery: null, services: [], from: 'This computer', local: true }));
        return out;
    }

    function btStatus(r) {
        if (!r.connected) return 'Paired';
        return r.battery != null && Number.isFinite(r.battery) ? `Connected (${Math.round(r.battery)}%)` : 'Connected';
    }

    pages['bluetooth-devices'] = {
        kind: 'folder',
        title: () => 'Bluetooth Devices',
        tasks: favorites,
        body: () => {
            btAskPhones();
            const rows = btRows();
            return folder([{ t: 'Add Wireless Device', v: 'add', icon: '/static_images/vista-cpl/items/bluetooth-devices-16.png' }, { t: 'Bluetooth Settings', v: 'settings', icon: '/static_images/vista-cpl/items/bluetooth-devices-16.png' }],
                [{ t: 'Name', w: 220 }, { t: 'Device Category', w: 120 }, { t: 'Status', w: 120 }, { t: 'Paired With', w: 160 }],
                rows.map((r) => ({ id: r.id, icon: btIcon(r, 16), cells: [r.name, BT_CATEGORY[r.kind] || 'Other', btStatus(r), r.from] })),
                { topic: 'bluetooth', sel: bt.sel, status: bt.asking && !rows.length ? 'Searching for devices...' : null });
        }
    };

    /** Connect, Disconnect or Remove a phone's device: this window's own bridge, else the phone over ActiveSync. */
    async function btAct(r, action) {
        let res = null;
        if (r.source === 'local') {
            const fn = { connect: 'connect', disconnect: 'disconnect', remove: 'unpair' }[action];
            const b = root.AndroidBluetooth;
            try { res = b && typeof b[fn] === 'function' ? JSON.parse(b[fn](r.address)) : null; } catch (_) { res = null; }
        } else if (r.source.startsWith('as:') && root.activeSync) {
            try { res = await root.activeSync.call(r.source.slice(3), 'device.bluetooth', { action, address: r.address }, { timeoutMs: 15000 }); } catch (err) { res = { ok: false, error: (err && err.message) || '' }; }
        }
        if (!res || !res.ok) {
            const why = res && res.via === 'settings' ? `Android does not let other programs ${action === 'remove' ? 'remove' : action} this device. Finish in Android's Bluetooth settings on ${r.from === 'This computer' ? 'the phone' : r.from}.`
                : res && res.error ? res.error : `${r.name} could not be ${action === 'remove' ? 'removed' : action === 'connect' ? 'connected' : 'disconnected'}.`;
            msg(why, 'Bluetooth Devices');
        }
        bt.askedAt = 0;
        setTimeout(rerender, 600);
    }

    function btSelected() { return btRows().find((r) => r.id === bt.sel) || null; }

    function btProperties(r) {
        const rows = [['Name', r.name], ['Device category', BT_CATEGORY[r.kind] || 'Other'], ['Status', btStatus(r)], ['Paired with', r.from]];
        if (r.address) rows.push(['Address', r.address]);
        if (r.services && r.services.length) rows.push(['Services', r.services.map((x) => ({ a2dp: 'Wireless Stereo', headset: 'Hands Free', le_audio: 'LE Audio', hid: 'Input Device' }[x] || x)).join(', ')]);
        const html = `<div class="cpl-bt-props"><img src="${esc(btIcon(r, 48))}" alt="" width="48" height="48"><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}:</td><td>${esc(v)}</td></tr>`).join('')}</table></div>`;
        if (typeof root.showConfirmationDialog === 'function') root.showConfirmationDialog(html, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: `${r.name} Properties`, width: 420 });
    }

    // the app's Bluetooth pushes while this page is on screen (no listener does anything elsewhere)
    if (root.addEventListener) {
        root.addEventListener('dreamscape:bluetooth', () => {
            const cp = CP();
            if (cp && cp.currentPage() === 'bluetooth-devices') rerender();
        }, { signal: appScopeSignal });
    }

    handlers['bluetooth-devices'] = {
        async add() {
            // a phone's own devices pair in Android's Bluetooth settings (Melaton Mobile's Add new device does the same)
            const b = root.AndroidBluetooth;
            if (b && typeof b.openSettings === 'function') { try { b.openSettings(null); return; } catch (_) { /* the browser below */ } }
            const web = root.navigator && root.navigator.bluetooth;
            if (!web || !web.requestDevice) {
                msg('Melaton could not find a Bluetooth radio this browser can use. To add a device to your phone, use Bluetooth in Melaton Mobile\'s Settings.', 'Add a Bluetooth Device');
                return;
            }
            try {
                const dev = await web.requestDevice({ acceptAllDevices: true });
                const name = (dev && dev.name) || 'Bluetooth device';
                if (R()) await R().set(BTH, { Paired: Array.from(new Set(reg(BTH, 'Paired', []).concat([name]))) });
                rerender();
            } catch (_) { /* the person cancelled the browser's chooser */ }
        },
        settings() { if (root.cplDialogs) root.cplDialogs.open('bluetooth'); },
        pick(t) { bt.sel = t.dataset.id; markSel(t); },
        open(id) { bt.sel = id; const r = btSelected(); if (r) btProperties(r); },
        organize() {},
        organizeItems() {
            const r = btSelected();
            const phoneDev = !!(r && r.source !== 'web');
            return [
                { text: 'Connect', action: 'cpl-org:btConnect', disabled: !phoneDev || r.connected },
                { text: 'Disconnect', action: 'cpl-org:btDisconnect', disabled: !phoneDev || !r.connected },
                { text: 'Remove Device', action: 'cpl-org:btRemove', disabled: !phoneDev },
                { separator: true },
                { text: 'Properties', action: 'cpl-org:btProps', disabled: !r }
            ];
        },
        btConnect() { const r = btSelected(); if (r) void btAct(r, 'connect'); },
        btDisconnect() { const r = btSelected(); if (r) void btAct(r, 'disconnect'); },
        async btRemove() {
            const r = btSelected();
            if (!r) return;
            const yes = typeof root.showConfirmationDialog === 'function'
                ? await root.showConfirmationDialog(`<p>Are you sure you want to remove ${esc(r.name)}?</p><p>You will need to pair it again to use it.</p>`, [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], null, { title: 'Remove Bluetooth Device', width: 400, icon: 'question' })
                : true;
            if (yes) void btAct(r, 'remove');
        },
        btProps() { const r = btSelected(); if (r) btProperties(r); },
        views() {}
    };

    // ---- Scanners and Cameras ----------------------------------------------------------------

    pages['scanners-and-cameras'] = {
        title: () => 'Scanners and Cameras',
        tasks: () => '',
        body: () => {
            const cams = handlers['scanners-and-cameras'].cams;
            if (!cams) void handlers['scanners-and-cameras'].list();
            return `<div class="cpl-vpage cpl-vwide">${K.help('scanners')}
                <h1 class="cpl-vtitle">Scanners and Cameras</h1>
                <p class="cpl-vtext">Click Refresh to see your connected scanners and cameras. If your scanner or camera does not appear in this list, click Add Device.</p>
                <div class="cpl-sc-list vdt-edge">${(cams || []).map((c, i) => `<div class="cpl-ficon" data-cpl-vpage="pick" data-id="${i}"><img src="/static_images/vista-cpl/items/scanners-and-cameras-32.png" alt=""><span>${esc(c.label || `Camera ${i + 1}`)}</span></div>`).join('') || '<p class="cpl-vtext">No scanners or cameras were found.</p>'}</div>
                <div class="cpl-vbuttons is-left"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="refresh">Refresh</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="addcam">Add Device</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="scan">Scan Profiles...</button></div>
            </div>`;
        }
    };
    handlers['scanners-and-cameras'] = {
        cams: null,
        async list() {
            try {
                const all = await root.navigator.mediaDevices.enumerateDevices();
                handlers['scanners-and-cameras'].cams = all.filter((d) => d.kind === 'videoinput');
            } catch (_) {
                handlers['scanners-and-cameras'].cams = [];
            }
            rerender();
        },
        refresh() { handlers['scanners-and-cameras'].cams = null; rerender(); },
        async addcam() {
            // the browser lists camera names only after the person allows one
            try {
                const s = await root.navigator.mediaDevices.getUserMedia({ video: true });
                s.getTracks().forEach((t) => t.stop());
            } catch (_) { /* refused */ }
            handlers['scanners-and-cameras'].refresh();
        },
        scan() { msg('No scan profiles are set up.', 'Scan Profiles'); },
        pick(t) { markSel(t); }
    };

    // ---- Chat (Yozora #763) --------------------------------------------------------------------
    // Melaton's own item: the chat personas' engine, model and effort (stored on the server, so
    // the phone's Messaging Options show the same: wsClient.getChatEngineSettings /
    // saveChatEngineSettings / getChatEngineModels), My info (wsClient.getPersonaSettings /
    // savePersonaSettings, the row the Memories applet's persona form edits too; saves merge) and
    // the desktop Chat window's own view choices (localStorage, chatSystem.js).

    const CHAT_ICON = '/static_images/app_icons/48/vista-messenger.webp';
    const CHAT_ICON16 = '/static_images/app_icons/16/vista-messenger.webp';
    const CHAT_EFFORT_NAMES = { default: 'Default', none: 'None', low: 'Low', medium: 'Medium', high: 'High' };
    const CHAT_VERBOSITY = [[1, 'Brief'], [2, 'Direct'], [3, 'Expressive'], [4, 'Elaborate'], [5, 'Poetic']];
    const CHAT_VIEW_KEYS = [['chat-show-actions-sfx', 'Show actions and sound effects in conversations'], ['chat-show-metadata', 'Show 4th wall events (emotion, location, plans and memories)']];
    const chatState = { loaded: false, loading: false, error: '', engine: null, models: {}, modelsError: {}, draft: null, status: '' };

    function chatLocal(key) {
        try { return localStorage.getItem(key) === 'true'; } catch (_) { return false; }
    }

    function chatDraftFrom(engine, persona) {
        const v = Number(persona.default_verbosity);
        return {
            provider: (engine && engine.settings && engine.settings.provider) || '',
            model: (engine && engine.settings && engine.settings.model) || '',
            effort: (engine && engine.settings && engine.settings.effort) || 'default',
            userName: persona.user_name || '',
            backstory: persona.backstory || '',
            verbosity: v >= 1 && v <= 5 ? v : 3,
            photo: persona.profile_photo_base64 || '',
            photoChanged: false,
            view: Object.fromEntries(CHAT_VIEW_KEYS.map(([k]) => [k, chatLocal(k)]))
        };
    }

    async function chatLoad() {
        const ws = root.wsClient;
        if (chatState.loading) return;
        chatState.loading = true;
        chatState.error = '';
        try {
            if (!ws || typeof ws.getChatEngineSettings !== 'function') throw new Error('Melaton is not connected to the server.');
            const [engine, persona] = await Promise.all([ws.getChatEngineSettings(), ws.getPersonaSettings()]);
            if (!engine || engine.success === false) throw new Error((engine && engine.error) || 'The chat settings could not be read.');
            chatState.engine = engine;
            chatState.draft = chatDraftFrom(engine, (persona && persona.settings) || {});
            chatState.loaded = true;
        } catch (err) {
            chatState.error = err && err.message ? err.message : String(err);
        }
        chatState.loading = false;
        rerender();
        if (chatState.loaded) void chatLoadModels(chatProviderId());
    }

    /** The engine the draft names ('' is the server's default engine). */
    function chatProviderId() {
        const e = chatState.engine;
        const d = chatState.draft;
        return (d && d.provider) || (e && e.serverDefault && e.serverDefault.provider) || '';
    }

    async function chatLoadModels(id, force) {
        if (!id || (!force && chatState.models[id])) return;
        const ws = root.wsClient;
        try {
            const res = await ws.getChatEngineModels(id, { force: !!force });
            chatState.models[id] = res.models || [];
            chatState.modelsError[id] = res.models && res.models.length ? '' : (res.error || 'No models are listed.');
        } catch (err) {
            chatState.models[id] = [];
            chatState.modelsError[id] = err && err.message ? err.message : 'The model list could not be read.';
        }
        if (CP() && CP().currentPage() === 'chat' && chatProviderId() === id) rerender();
    }

    function chatDefaultModel(id) {
        const e = chatState.engine;
        const p = e && (e.providers || []).find((x) => x.id === id);
        return (p && p.defaultModel) || (e && e.effective && e.effective.provider === id ? e.effective.model : '');
    }

    function chatModelName(id, model) {
        const m = (chatState.models[id] || []).find((x) => x.id === model);
        return m && m.name ? m.name : String(model || '').split('/').pop();
    }

    function chatEngineSection() {
        const e = chatState.engine;
        const d = chatState.draft;
        const id = chatProviderId();
        const keyed = (e.providers || []).filter((p) => p.hasKey);
        const def = e.serverDefault || {};
        const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
        const engines = [opt('', `Default (${def.providerName || def.provider || 'server'})`, d.provider)]
            .concat(keyed.map((p) => opt(p.id, p.name, d.provider)));
        if (d.provider && !keyed.some((p) => p.id === d.provider)) engines.push(opt(d.provider, `${d.provider} (no key)`, d.provider));
        const list = chatState.models[id];
        const defModel = chatDefaultModel(id);
        const models = [opt('', defModel ? `Default (${chatModelName(id, defModel)})` : 'Default', d.model)];
        if (d.model && !(list || []).some((m) => m.id === d.model)) models.push(opt(d.model, d.model, d.model));
        (list || []).forEach((m) => models.push(opt(m.id, m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id, d.model)));
        const modelNote = !list ? 'Loading the list of models...' : (chatState.modelsError[id] || '');
        return `
            <div class="cpl-vsection"><span>Chat engine</span></div>
            <table class="cpl-power-grid cpl-chat-grid">
                <tr><td><label for="cpl-chat-engine">Engine:</label></td><td><select class="cpl-vselect cpl-chat-wide" id="cpl-chat-engine" data-chat="provider">${engines.join('')}</select></td></tr>
                <tr><td><label for="cpl-chat-model">Model:</label></td><td><select class="cpl-vselect cpl-chat-wide" id="cpl-chat-model" data-chat="model">${models.join('')}</select>
                    <button type="button" class="cpl-vlink cpl-chat-refresh" data-cpl-vpage="chatmodels">Refresh</button>
                    ${modelNote ? `<div class="cpl-chat-note">${esc(modelNote)}</div>` : ''}</td></tr>
                <tr><td><label for="cpl-chat-effort">Effort:</label></td><td><select class="cpl-vselect" id="cpl-chat-effort" data-chat="effort">${(e.efforts || Object.keys(CHAT_EFFORT_NAMES)).map((x) => opt(x, CHAT_EFFORT_NAMES[x] || x, d.effort)).join('')}</select></td></tr>
            </table>
            <p class="cpl-vtext cpl-vindent">New conversations use this engine and model. A conversation started on another engine moves to this one with its next message. Effort sets how long the model thinks before it answers; Default leaves it to the model.</p>`;
    }

    function chatInfoSection() {
        const d = chatState.draft;
        const pic = d.photo ? `data:image/jpeg;base64,${d.photo}` : '/static_images/account-pictures/guest.png';
        return `
            <div class="cpl-vsection"><span>My info</span></div>
            <p class="cpl-vtext">Personas see your name, picture and story when you talk to them.</p>
            <div class="cpl-chat-info">
                <div class="cpl-chat-photo">
                    <span class="cpl-ua-picture"><img src="${esc(pic)}" alt=""><img class="cpl-ua-frame" src="/static_images/vista-cpl/usertile-frame-48.png" alt=""></span>
                    <div class="cpl-chat-photo-links">
                        <button type="button" class="cpl-vlink" data-cpl-vpage="chatphoto">Browse for a picture...</button>
                        ${d.photo ? '<button type="button" class="cpl-vlink" data-cpl-vpage="chatnophoto">Remove picture</button>' : ''}
                    </div>
                    <input type="file" accept="image/*" class="cpl-chat-file" hidden>
                </div>
                <table class="cpl-power-grid cpl-chat-grid">
                    <tr><td><label for="cpl-chat-name">Name:</label></td><td><input type="text" class="tbp-edit cpl-vedit" id="cpl-chat-name" data-chat="userName" maxlength="80" spellcheck="false" value="${esc(d.userName)}"></td></tr>
                    <tr><td class="is-top"><label for="cpl-chat-backstory">About me:</label></td><td><textarea class="cpl-chat-backstory" id="cpl-chat-backstory" data-chat="backstory" rows="5" maxlength="4000">${esc(d.backstory)}</textarea></td></tr>
                    <tr><td><label for="cpl-chat-verbosity">Default verbosity:</label></td><td><select class="cpl-vselect" id="cpl-chat-verbosity" data-chat="verbosity">${CHAT_VERBOSITY.map(([n, t]) => `<option value="${n}"${n === d.verbosity ? ' selected' : ''}>${n} ${esc(t)}</option>`).join('')}</select></td></tr>
                </table>
            </div>`;
    }

    function chatViewSection() {
        const d = chatState.draft;
        return `
            <div class="cpl-vsection"><span>Conversation window</span></div>
            ${CHAT_VIEW_KEYS.map(([k, t], i) => `<div class="cpl-vcheck"><input type="checkbox" id="cpl-chat-view-${i}" data-chat-view="${k}"${d.view[k] ? ' checked' : ''}><label for="cpl-chat-view-${i}">${esc(t)}</label></div>`).join('')}`;
    }

    pages.chat = {
        title: () => 'Chat',
        icon16: CHAT_ICON16,
        tasks: () => K.tasks([[
            { t: 'Open Chat', a: 'js:chatopen' },
            { t: 'Refresh the list of models', a: 'js:chatmodels' }
        ]], [{ t: 'Mail', a: 'item:mail' }, { t: 'User Accounts', a: 'item:user-accounts' }]),
        body: () => {
            let inner;
            if (chatState.error) {
                inner = `<p class="cpl-vtext">${esc(chatState.error)}</p>
                    <div class="cpl-vbuttons is-left"><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="chatretry">Try again</button></div>`;
            } else if (!chatState.loaded) {
                inner = '<p class="cpl-vtext">Reading the chat settings...</p>';
            } else {
                inner = `${chatEngineSection()}${chatInfoSection()}${chatViewSection()}
                    <div class="cpl-vbuttons">${chatState.status ? `<span class="cpl-chat-status">${esc(chatState.status)}</span>` : ''}<button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="chatsave">Save changes</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-vpage="chatcancel">Cancel</button></div>`;
            }
            return `<div class="cpl-vpage cpl-chat">
                <h1 class="cpl-vtitle">Change chat settings</h1>
                <p class="cpl-vtext">Choose the engine and model the chat personas use, and tell them about yourself. These settings are shared with Dreamscape Messenger on your phone.</p>
                ${inner}
            </div>`;
        },
        mount(main) {
            if (!chatState.loaded && !chatState.loading && !chatState.error) void chatLoad();
            const sync = (ev) => {
                const t = ev.target;
                const d = chatState.draft;
                if (!d || !t || !t.dataset) return;
                if (t.dataset.chatView) { d.view[t.dataset.chatView] = t.checked; return; }
                const k = t.dataset.chat;
                if (!k) return;
                chatState.status = '';
                if (k === 'verbosity') d.verbosity = Number(t.value) || 3;
                else d[k] = t.value;
                if (k === 'provider' && ev.type === 'change') {
                    d.model = '';
                    rerender();
                    void chatLoadModels(chatProviderId());
                }
            };
            main.addEventListener('input', sync);
            main.addEventListener('change', sync);
            const file = main.querySelector('.cpl-chat-file');
            if (file) file.addEventListener('change', () => void chatPickPhoto(file.files && file.files[0]));
        }
    };

    /** A picked picture, drawn into at most 512 px as a JPEG (the chat sends it to vision models). */
    function chatPickPhoto(f) {
        if (!f || !chatState.draft) return Promise.resolve();
        return new Promise((resolve) => {
            const url = URL.createObjectURL(f);
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
                const c = doc.createElement('canvas');
                c.width = Math.max(1, Math.round(img.naturalWidth * scale));
                c.height = Math.max(1, Math.round(img.naturalHeight * scale));
                const g = c.getContext('2d');
                g.fillStyle = '#fff';
                g.fillRect(0, 0, c.width, c.height);
                g.drawImage(img, 0, 0, c.width, c.height);
                chatState.draft.photo = c.toDataURL('image/jpeg', 0.9).split(',')[1] || '';
                chatState.draft.photoChanged = true;
                chatState.status = '';
                URL.revokeObjectURL(url);
                rerender();
                resolve();
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                msg('Melaton cannot open this picture. Choose a JPEG, PNG, GIF or WebP picture.', 'Chat');
                resolve();
            };
            img.src = url;
        });
    }

    handlers.chat = {
        chatopen() {
            const open = async () => {
                if (root.featureLoader) await root.featureLoader.loadFeature('chat');
                if (root.chatSystem && typeof root.chatSystem.showAllChats === 'function') root.chatSystem.showAllChats();
            };
            void open();
        },
        chatmodels() {
            const id = chatProviderId();
            if (!id) return;
            delete chatState.models[id];
            rerender();
            void chatLoadModels(id, true);
        },
        chatretry() {
            chatState.error = '';
            rerender();
        },
        chatphoto() {
            const f = doc.querySelector('.cpl-instance.cpl-current .cpl-chat-file');
            if (f) { f.value = ''; f.click(); }
        },
        chatnophoto() {
            if (!chatState.draft) return;
            chatState.draft.photo = '';
            chatState.draft.photoChanged = true;
            rerender();
        },
        chatcancel() {
            chatState.loaded = false;
            chatState.draft = null;
            chatState.status = '';
            if (CP()) CP().navigate('home');
        },
        async chatsave(btn) {
            const d = chatState.draft;
            const ws = root.wsClient;
            if (!d || !ws) return;
            if (btn) btn.disabled = true;
            try {
                const engine = await ws.saveChatEngineSettings({ provider: d.provider, model: d.model, effort: d.effort });
                if (!engine || engine.success === false) throw new Error((engine && engine.error) || 'The chat engine could not be saved.');
                const persona = { user_name: d.userName.trim(), backstory: d.backstory, default_verbosity: d.verbosity };
                if (d.photoChanged) persona.profile_photo_base64 = d.photo;
                const res = await ws.savePersonaSettings(persona);
                if (!res || res.success === false) throw new Error((res && res.message) || 'My info could not be saved.');
                d.photoChanged = false;
                chatState.engine = engine;
                CHAT_VIEW_KEYS.forEach(([k]) => { try { localStorage.setItem(k, d.view[k] ? 'true' : 'false'); } catch (_) { /* storage blocked */ } });
                // an open Chat window follows at once
                const list = doc.getElementById('chatMessagesList');
                if (list) {
                    list.classList.toggle('show-actions-sfx', !!d.view['chat-show-actions-sfx']);
                    list.classList.toggle('show-metadata', !!d.view['chat-show-metadata']);
                }
                if (root.chatSystem) {
                    root.chatSystem.personaSettings = Object.assign({}, root.chatSystem.personaSettings || {}, persona, { profile_photo_base64: d.photo });
                    if (root.chatSystem.currentChatId && typeof root.chatSystem.renderChatMessages === 'function') {
                        try { root.chatSystem.renderChatMessages(); } catch (_) { /* window closed */ }
                    }
                }
                root.dispatchEvent(new CustomEvent('melaton-chat-settings', { detail: { engine: engine.settings, effective: engine.effective } }));
                chatState.status = 'Your changes have been saved.';
            } catch (err) {
                msg(err && err.message ? err.message : String(err), 'Chat');
            }
            if (btn) btn.disabled = false;
            rerender();
        }
    };

    function register() {
        const cp = CP();
        if (!cp) return false;
        Object.entries(pages).forEach(([id, page]) => cp.registerPage(id, page));
        // the Chat item reads the server's settings afresh each time it opens
        cp.registerItem({
            id: 'chat',
            name: 'Chat',
            image: CHAT_ICON,
            description: 'Choose the engine, model and effort the chat personas use, and change your name, picture and story.',
            open: () => {
                Object.assign(chatState, { loaded: false, loading: false, error: '', draft: null, status: '' });
                cp.navigate('chat');
            }
        });
        return true;
    }

    root.cplPages3 = { register, pages, TOOLS };
    register();
})(typeof window !== 'undefined' ? window : globalThis);
