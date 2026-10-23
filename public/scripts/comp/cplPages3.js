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
            const btn = ev.target.closest && ev.target.closest('#melatonControlPanelModal [data-cpl-vpage="organize"]');
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
            const row = ev.target.closest && ev.target.closest('#melatonControlPanelModal [data-cpl-vpage="pick"]');
            if (!row) return;
            const page = CP() && CP().currentPage();
            const h = handlers[page];
            if (h && typeof h.open === 'function') h.open(row.dataset.id);
        });
    }

    const pages = {};

    // ---- Administrative Tools ----------------------------------------------------------------

    const TOOLS = [
        { id: 'computer-management', name: 'Computer Management', icon: `${ITEMS}/device-manager-16.png`, open: () => callGlobal('openDeviceManager') },
        { id: 'odbc', name: 'Data Sources (ODBC)', icon: `${ITEMS}/administrative-tools-16.png`, open: () => msg('No ODBC data sources are configured. Dreamscape keeps its data in the server\'s own databases.', 'ODBC Data Source Administrator') },
        { id: 'event-viewer', name: 'Event Viewer', icon: '/static_images/app_icons/16/vista-event-viewer.webp', open: () => launch('event-viewer') },
        { id: 'iscsi', name: 'iSCSI Initiator', icon: `${ITEMS}/iscsi-initiator-16.png`, open: () => root.cplDialogs && root.cplDialogs.open('iscsi') },
        { id: 'memory', name: 'Memory Diagnostics Tool', icon: `${ITEMS}/administrative-tools-16.png`, open: () => memoryDiagnostics() },
        { id: 'print-management', name: 'Print Management', icon: `${ITEMS}/printers-16.png`, open: () => CP().doAction('item:printers') },
        { id: 'reliability', name: 'Reliability and Performance Monitor', icon: '/static_images/app_icons/16/vista-performance.webp', open: () => launch('perfmon') || launch('event-viewer') },
        { id: 'security-config', name: 'Security Configuration Management', icon: `${ITEMS}/security-center-16.png`, open: () => CP().doAction('item:security-center') },
        { id: 'services', name: 'Services', icon: `${ITEMS}/administrative-tools-16.png`, open: () => launch('services') || CP().doAction('item:network') },
        { id: 'msconfig', name: 'System Configuration', icon: `${ITEMS}/system-16.png`, open: () => CP().doAction('item:system') },
        { id: 'task-scheduler', name: 'Task Scheduler', icon: `${ITEMS}/administrative-tools-16.png`, open: () => launch('task-scheduler') || msg('Task Scheduler is coming in a later update of Melaton.', 'Task Scheduler') },
        { id: 'firewall-adv', name: 'Melaton Firewall with Advanced Security', icon: `${ITEMS}/firewall-16.png`, open: () => CP().doAction('item:firewall') },
        { id: 'powershell', name: 'Melaton PowerShell Modules', icon: `${ITEMS}/administrative-tools-16.png`, open: () => msg('Melaton PowerShell is not installed.', 'Melaton PowerShell Modules') },
        { id: 'management-tools', name: 'Management Tools', icon: '/static_images/vista-cpl/management-tools-32.png', open: () => callGlobal('openDsapInGrimoire', 'dsap://dreamscape.jp/') }
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
            return folder([{ t: 'Add a printer', v: 'add', icon: '/static_images/vista-cpl/items/printers-16.png' }],
                [{ t: 'Name', w: 200 }, { t: 'Documents', w: 70 }, { t: 'Status', w: 70 }, { t: 'Comments', w: 80 }, { t: 'Location', w: 80 }, { t: 'Model', w: 160 }],
                PRINTERS.map((p) => ({ id: p.id, icon: p.icon, check: p.id === def, cells: [p.name, '0', 'Ready'] })),
                { icons: true, sel: handlers.printers.sel, topic: 'printers' });
        }
    };
    handlers.printers = {
        sel: null,
        pick(t) { handlers.printers.sel = t.dataset.id; markSel(t); },
        open() {
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

    pages['bluetooth-devices'] = {
        kind: 'folder',
        title: () => 'Bluetooth Devices',
        tasks: favorites,
        body: () => {
            const devices = reg(BTH, 'Paired', []);
            return folder([{ t: 'Add Wireless Device', v: 'add', icon: '/static_images/vista-cpl/items/bluetooth-devices-16.png' }, { t: 'Bluetooth Settings', v: 'settings', icon: '/static_images/vista-cpl/items/bluetooth-devices-16.png' }],
                [{ t: 'Name', w: 200 }, { t: 'Device Category', w: 160 }],
                devices.map((d) => ({ id: d, icon: '/static_images/vista-cpl/items/bluetooth-devices-16.png', cells: [d, 'Other'] })),
                { topic: 'bluetooth' });
        }
    };
    handlers['bluetooth-devices'] = {
        async add() {
            const bt = root.navigator && root.navigator.bluetooth;
            if (!bt || !bt.requestDevice) {
                msg('Melaton could not find a Bluetooth radio this browser can use.', 'Add a Bluetooth Device');
                return;
            }
            try {
                const dev = await bt.requestDevice({ acceptAllDevices: true });
                const name = (dev && dev.name) || 'Bluetooth device';
                if (R()) await R().set(BTH, { Paired: Array.from(new Set(reg(BTH, 'Paired', []).concat([name]))) });
                rerender();
            } catch (_) { /* the person cancelled the browser's chooser */ }
        },
        settings() { if (root.cplDialogs) root.cplDialogs.open('bluetooth'); },
        pick(t) { markSel(t); },
        organize() {}, views() {}
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

    function register() {
        const cp = CP();
        if (!cp) return false;
        Object.entries(pages).forEach(([id, page]) => cp.registerPage(id, page));
        return true;
    }

    root.cplPages3 = { register, pages, TOOLS };
    register();
})(typeof window !== 'undefined' ? window : globalThis);
