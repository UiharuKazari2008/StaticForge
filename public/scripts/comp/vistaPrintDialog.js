/**
 * Vista's Print dialog (comdlg32 PrintDlgEx), shared (Yukimi, Nov 21 2026: "can we make Print action open a Vista
 * Print dialog with a Print to PDF printer"). Grimoire opens it for every Print; Notepad and Glancewell can later.
 *
 * The General page is comdlg32.dll.mui dialog 100 with its lower part, dialog 1549, set into the 1073 rect at
 * (7, 118) DLU as PrintDlgEx does: Select Printer (a large-icon list: Add Printer and the installed printers, the
 * default one with Vista's check), Status / Location / Comment, Print to file, Preferences, Find Printer...,
 * Page Range (All / Selection / Current Page / Pages and the hint under it), Number of copies with its up-down,
 * Collate and its picture (comdlg32 icons 536 / 537). A program adds its own pages after it (IE7's Options:
 * Print frames, Print all linked documents, Print table of links). Print / Cancel / Apply; Apply keeps the printer
 * choice without printing. The printer last printed to (or applied) is selected next time, else Control Panel's
 * default printer (HKCU ... Windows Device).
 *
 * Printers: Fax, Xyridian Print to PDF, Xyridian XPS Document Writer, Print with this browser (only for a program
 * that allows the browser's own print, opts.browser), and the generation printers (printQueue.js, #831).
 *
 *   vistaPrintDialog.open({ owner, title, selection, selectionDefault, currentPage, ieOptions: { frames } | null,
 *                           browser }) -> Promise<job | null>
 *       job: { printer: { id, name, driver: 'pdf' | 'xps' | 'fax' | 'browser' | 'queue' }, range: 'all' |
 *              'selection' | 'current' | 'pages', pages, copies, collate, printToFile, settings (the printer's
 *              Printing Preferences), frames: 'layout' | 'selected' | 'individually', linked, tableOfLinks }
 *   vistaPrintDialog.preferences(printerId, owner) -> Promise<settings | null>   the printer's Printing Preferences
 *   vistaPrintDialog.pageSetup(owner) -> Promise<pageSetup | null>                IE7's Page Setup
 *   vistaPrintDialog.pageSetupSettings() / printerSettings(id) / printers(opts) / defaultPrinter()
 *   vistaPrintDialog.PAPERS   [{ id, name }] (server.js PRINT_PAPER_INCHES has their sizes)
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-print';
    const KEY_DEVICE = 'HKCU\\Software\\Xyridian\\Melaton NT\\CurrentVersion\\Windows';
    const KEY_DIALOG = 'HKCU\\Software\\Xyridian\\Melaton NT\\CurrentVersion\\Print Dialog';
    const KEY_PRINTER = 'HKCU\\Printers\\Settings\\';
    // IE keeps Page Setup per user: header, footer and the margins in inches
    const KEY_PAGE_SETUP = 'HKCU\\Software\\Xyridian\\Internet Explorer\\PageSetup';

    const PAPERS = [
        { id: 'letter', name: 'Letter' }, { id: 'legal', name: 'Legal' }, { id: 'executive', name: 'Executive' },
        { id: 'tabloid', name: 'Tabloid' }, { id: 'a3', name: 'A3' }, { id: 'a4', name: 'A4' }, { id: 'a5', name: 'A5' },
        { id: 'b5', name: 'B5 (JIS)' }
    ];

    // the printers Melaton installs (Control Panel > Printers lists the same, cplPages3.js PRINTERS)
    const INSTALLED = [
        { id: 'fax', name: 'Fax', driver: 'fax', icon: `${ART}/fax-32.png`, iconDefault: `${ART}/fax-default-32.png`, model: 'Xyridian Shared Fax Driver' },
        { id: 'pdf', name: 'Xyridian Print to PDF', driver: 'pdf', icon: `${ART}/printer-32.png`, iconDefault: `${ART}/printer-default-32.png`, model: 'Xyridian Print To PDF' },
        { id: 'xps', name: 'Xyridian XPS Document Writer', driver: 'xps', icon: `${ART}/printer-32.png`, iconDefault: `${ART}/printer-default-32.png`, model: 'Xyridian XPS Document Writer' },
        { id: 'browser', name: 'Print with this browser', driver: 'browser', icon: `${ART}/printer-32.png`, iconDefault: `${ART}/printer-default-32.png`, model: 'Browser print dialog' }
    ];

    // MS Shell Dlg 8 templates: [id, class, x, y, w, h, style, text, exstyle] (vistaDialogTemplate.js)
    const VIS = 0x50000000;
    const TPL_GENERAL = { t: 'General', w: 292, h: 198, f: ['MS Shell Dlg', 8], s: 0x90c800c4, c: [
        // comdlg32 100 (the list is the ListView comdlg32 puts over the hidden list box 1000)
        [1072, 'B', 7, 7, 278, 104, 0x50000007, 'Select Printer', 0],
        [1000, 'SysListView32', 14, 17, 264, 53, 0x50010000, '', 0x200],
        [1004, 'S', 14, 76, 35, 8, 1342308480, 'Status:', 0],
        [1005, 'E', 50, 76, 114, 8, 1342179456, '', 0],
        [1006, 'S', 14, 87, 35, 8, 1342308480, 'Location:', 0],
        [1007, 'E', 50, 87, 164, 8, 1342179456, '', 0],
        [1008, 'S', 14, 98, 35, 8, 1342308480, 'Comment:', 0],
        [1009, 'E', 50, 98, 164, 8, 1342179456, '', 0],
        [1002, 'B', 177, 77, 47, 8, 1342373891, 'Print to &file', 0],
        [1010, 'B', 228, 74, 50, 14, 1342373888, 'P&references', 0],
        [1003, 'B', 228, 92, 50, 14, 1342373888, 'Fin&d Printer...', 0],
        // comdlg32 1549 at the 1073 rect (7, 118); its group boxes 1072 / 1073 renumbered 2072 / 2073
        [2072, 'B', 7, 118, 149, 73, 1342308359, 'Page Range', 0],
        [1056, 'B', 14, 129, 58, 10, 1342308356, 'A&ll', 0],
        [1057, 'B', 14, 142, 49, 10, 1342177284, 'Selec&tion', 0],
        [1058, 'B', 65, 142, 58, 10, 1342177284, 'C&urrent Page', 0],
        [1059, 'B', 14, 156, 38, 10, 1342177284, 'Pa&ges:', 0],
        [1152, 'E', 65, 155, 86, 12, 1350762624, '', 0],
        [1088, 'S', 13, 170, 139, 18, 0x50020000, 'Enter page numbers and/or page ranges separated by commas.  For example, 1,5-12', 0],
        [2073, 'B', 166, 118, 118, 73, 1342308359, '', 0],
        [1090, 'S', 171, 131, 61, 10, 1342308352, 'Number of &copies:', 0],
        [1153, 'E', 239, 129, 25, 12, 1350770688, '', 0],
        [1040, 'B', 173, 156, 35, 10, 1342373891, 'C&ollate', 0],
        [1084, 'S', 213, 151, 67, 36, 1342308867, '', 0]
    ] };
    // IE7's Options page (mshtml): the frames choices and the two link choices
    const TPL_IE_OPTIONS = { t: 'Options', w: 292, h: 198, f: ['MS Shell Dlg', 8], s: 0x90c800c4, c: [
        [1100, 'B', 7, 7, 278, 60, VIS | 0x7, 'Print frames', 0],
        [1101, 'B', 14, 20, 120, 10, VIS | 0x30009, 'As laid out on &screen', 0],
        [1102, 'B', 14, 34, 120, 10, VIS | 0x9, 'Only the &selected frame', 0],
        [1103, 'B', 14, 48, 120, 10, VIS | 0x9, 'All frames &individually', 0],
        [1105, 'B', 7, 76, 160, 10, VIS | 0x30003, 'Print all &linked documents', 0],
        [1106, 'B', 7, 90, 160, 10, VIS | 0x10003, 'Print table of lin&ks', 0]
    ] };
    // a printer's Printing Preferences (compstui): Layout and Paper/Quality
    const TPL_LAYOUT = { t: 'Layout', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0x50c00048, c: [
        [-1, 'S', 7, 9, 100, 8, VIS | 0x20000, '&Orientation:', 0],
        [1201, 'C', 7, 19, 110, 100, VIS | 0x210003, '', 0],
        [-1, 'S', 7, 41, 100, 8, VIS | 0x20000, 'Page Or&der:', 0],
        [1202, 'C', 7, 51, 110, 100, VIS | 0x210003, '', 0],
        [1203, 'S', 160, 34, 40, 40, VIS | 0x203, '', 0]
    ] };
    const TPL_PAPER = { t: 'Paper/Quality', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0x50c00048, c: [
        [1210, 'B', 7, 7, 238, 56, VIS | 0x7, 'Tray Selection', 0],
        [-1, 'S', 14, 22, 62, 8, VIS | 0x20000, 'Paper &Source:', 0],
        [1211, 'C', 80, 20, 155, 100, VIS | 0x210003, '', 0],
        [-1, 'S', 14, 42, 62, 8, VIS | 0x20000, 'Paper Si&ze:', 0],
        [1212, 'C', 80, 40, 155, 100, VIS | 0x210003, '', 0]
    ] };

    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const R = () => root.melatonRegistry || null;
    const reg = (key, name, fallback) => { const r = R(); return r ? r.get(key, name, fallback) : fallback; };
    const setReg = (key, values) => { const r = R(); return r ? r.set(key, values) : Promise.resolve(); };

    async function ensureKit() {
        if (root.vistaDialogTemplate && root.vistaDialogTemplates) return true;
        try { if (root.featureLoader) await root.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* below */ }
        return !!root.vistaDialogTemplate;
    }

    // the message box's icon (vista-fa-icons.css draws Vista's warning / error / information icons for these)
    const MSG_ICONS = { warning: 'fas fa-triangle-exclamation', error: 'fas fa-circle-xmark', info: 'fas fa-circle-info' };

    function message(text, owner, kind = 'warning', title = 'Print') {
        if (typeof root.showConfirmationDialog !== 'function') return Promise.resolve(null);
        return Promise.resolve(root.showConfirmationDialog(`<p>${esc(text).replace(/\n/g, '<br>')}</p>`,
            [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title, icon: MSG_ICONS[kind] || MSG_ICONS.warning, owner: owner || null, width: 400 })).catch(() => null);
    }

    function defaultPrinter() {
        return String(reg(KEY_DEVICE, 'Device', 'xps'));
    }

    /** Every printer (the generation printers too, as pq:<id>), sorted as the Printers folder sorts them. */
    function printers(opts = {}) {
        const def = defaultPrinter();
        const list = INSTALLED.filter((p) => p.id !== 'browser' || opts.browser).map((p) => ({ ...p, status: 'Ready', location: '', comment: '' }));
        const pq = root.printQueue;
        if (pq && typeof pq.printers === 'function') {
            pq.printers().forEach((p) => list.push({
                id: `pq:${p.id}`, name: p.name, driver: 'queue', queueId: p.id, icon: `${ART}/printer-32.png`, iconDefault: `${ART}/printer-default-32.png`,
                status: p.status || 'Ready', location: '', comment: p.jobs ? `${p.jobs} document(s) waiting` : ''
            }));
        }
        list.forEach((p) => { p.isDefault = p.id === def; });
        return list.sort((a, b) => a.name.localeCompare(b.name));
    }

    /** A printer's Printing Preferences (orientation, page order, paper), kept per user and printer. */
    function printerSettings(id) {
        const key = KEY_PRINTER + String(id || 'xps').replace(/[\\]/g, '_');
        return {
            orientation: reg(key, 'Orientation', 'portrait') === 'landscape' ? 'landscape' : 'portrait',
            pageOrder: reg(key, 'PageOrder', 'front') === 'back' ? 'back' : 'front',
            paper: PAPERS.some((p) => p.id === reg(key, 'PaperSize', 'letter')) ? reg(key, 'PaperSize', 'letter') : 'letter'
        };
    }

    function savePrinterSettings(id, s) {
        return setReg(KEY_PRINTER + String(id || 'xps').replace(/[\\]/g, '_'), { Orientation: s.orientation, PageOrder: s.pageOrder, PaperSize: s.paper });
    }

    /** IE's Page Setup: the header and footer codes and the margins (inches). */
    function pageSetupSettings() {
        const num = (name, d) => { const v = Number(reg(KEY_PAGE_SETUP, name, d)); return Number.isFinite(v) && v >= 0 && v <= 3 ? v : d; };
        return {
            header: String(reg(KEY_PAGE_SETUP, 'header', '&w&bPage &p of &P')),
            footer: String(reg(KEY_PAGE_SETUP, 'footer', '&u&b&d')),
            marginTop: num('margin_top', 0.75), marginBottom: num('margin_bottom', 0.75),
            marginLeft: num('margin_left', 0.75), marginRight: num('margin_right', 0.75)
        };
    }

    // ---- Printing Preferences ----------------------------------------------------------------

    async function preferences(printerId, owner) {
        if (!await ensureKit()) return null;
        const p = printers({ browser: true }).find((x) => x.id === printerId) || printers()[0];
        if (!p) return null;
        const s = printerSettings(p.id);
        return new Promise((resolve) => {
            let saved = null;
            root.vistaDialogTemplate.openSheet({
                id: 'vistaPrintPreferences',
                title: `${p.name} Printing Preferences`,
                owner,
                icon: `${ART}/printer-16.png`,
                bareCaption: true,
                pages: [{ key: 'print:layout', tpl: TPL_LAYOUT }, { key: 'print:paper', tpl: TPL_PAPER }],
                init(ctx) {
                    ctx.options(1201, [{ value: 'portrait', text: 'Portrait' }, { value: 'landscape', text: 'Landscape' }], s.orientation, 'print:layout');
                    ctx.options(1202, [{ value: 'front', text: 'Front to Back' }, { value: 'back', text: 'Back to Front' }], s.pageOrder, 'print:layout');
                    ctx.options(1211, ['Automatically Select'], 'Automatically Select', 'print:paper');
                    ctx.options(1212, PAPERS.map((x) => ({ value: x.id, text: x.name })), s.paper, 'print:paper');
                    // the page picture: comdlg32's portrait / landscape pages (icons 528 / 529)
                    const pic = () => ctx.html(1203, `<img class="vpd-orient" src="${ART}/orient-${ctx.get(1201, 'print:layout') === 'landscape' ? 'landscape' : 'portrait'}.png" alt="" draggable="false">`, 'print:layout');
                    ctx.on(1201, 'change', pic, 'print:layout');
                    pic();
                },
                async apply(ctx) {
                    saved = { orientation: ctx.get(1201, 'print:layout'), pageOrder: ctx.get(1202, 'print:layout'), paper: ctx.get(1212, 'print:paper') };
                    await savePrinterSettings(p.id, saved);
                },
                close() { resolve(saved); }
            });
        });
    }

    // ---- IE7's Page Setup (Notepad's comdlg32 template: paper, orientation, margins, header and footer) ----

    async function pageSetup(owner, printerId) {
        if (!await ensureKit()) return null;
        const id = printerId || String(reg(KEY_DIALOG, 'LastPrinter', '')) || defaultPrinter();
        const ps = pageSetupSettings();
        const s = printerSettings(id);
        return new Promise((resolve) => {
            let result = null;
            root.vistaDialogTemplate.openDialog({
                id: 'vistaPageSetup',
                key: 'notepad:12',
                title: 'Page Setup',
                owner,
                overrides: { 1080: { html: '<div class="vpd-page-preview"><div class="vpd-page-lines"></div></div>' } },
                init(ctx) {
                    ctx.options(1137, PAPERS.map((x) => ({ value: x.id, text: x.name })), s.paper);
                    ctx.options(1138, ['Automatically Select'], 'Automatically Select');
                    ctx.set(s.orientation === 'landscape' ? 1057 : 1056, true);
                    ctx.set(1155, String(ps.marginLeft)); ctx.set(1157, String(ps.marginRight));
                    ctx.set(1156, String(ps.marginTop)); ctx.set(1158, String(ps.marginBottom));
                    ctx.set(30, ps.header); ctx.set(31, ps.footer);
                    const preview = () => ctx.content.querySelector('.vpd-page-preview').classList.toggle('is-landscape', !!ctx.get(1057));
                    ctx.content.addEventListener('change', preview);
                    preview();
                    // Printer...: the printer's own Printing Preferences
                    ctx.on(1026, 'click', () => { void preferences(id, ctx.modal); });
                },
                async ok(ctx) {
                    const m = (cid) => { const v = Number(String(ctx.get(cid) || '').trim()); return Number.isFinite(v) && v >= 0 && v <= 3 ? v : NaN; };
                    const margins = [m(1155), m(1157), m(1156), m(1158)];
                    if (margins.some((v) => Number.isNaN(v))) {
                        await message('The margins must be numbers from 0 to 3 inches.', ctx.modal);
                        return false;
                    }
                    await setReg(KEY_PAGE_SETUP, {
                        header: String(ctx.get(30) || ''), footer: String(ctx.get(31) || ''),
                        margin_left: String(margins[0]), margin_right: String(margins[1]), margin_top: String(margins[2]), margin_bottom: String(margins[3])
                    });
                    await savePrinterSettings(id, { ...s, paper: ctx.get(1137), orientation: ctx.get(1057) ? 'landscape' : 'portrait' });
                    result = pageSetupSettings();
                    return true;
                },
                close() { resolve(result); }
            });
        });
    }

    // ---- the Print dialog ---------------------------------------------------------------------

    /** IE's page ranges: numbers and ranges separated by commas (1,5-12). */
    function rangeOk(text) {
        return /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/.test(text) && !/(^|[^0-9])0+([^0-9]|$)/.test(text);
    }

    async function open(opts = {}) {
        if (!await ensureKit()) return null;
        const list = printers({ browser: !!opts.browser });
        const last = String(reg(KEY_DIALOG, 'LastPrinter', ''));
        const def = defaultPrinter();
        let chosen = list.find((p) => p.id === last) || list.find((p) => p.id === def) || list[0];
        const ie = opts.ieOptions || null;
        const pages = [{ key: 'print:general', tpl: TPL_GENERAL, overrides: { 1153: { spin: [1, 9999] } } }];
        if (ie) pages.push({ key: 'print:options', tpl: TPL_IE_OPTIONS });
        const G = 'print:general';
        const O = 'print:options';
        return new Promise((resolve) => {
            let job = null;
            const remember = () => setReg(KEY_DIALOG, { LastPrinter: chosen.id });
            root.vistaDialogTemplate.openSheet({
                id: 'vistaPrintDialog',
                title: opts.title || 'Print',
                owner: opts.owner,
                icon: `${ART}/printer-16.png`,
                bareCaption: true,
                pages,
                init(ctx) {
                    // the sheet's OK is PrintDlgEx's Print: it checks the page range and copies, then prints
                    const okButton = ctx.content.querySelector('[data-vdt-action="ok"]');
                    if (okButton) okButton.innerHTML = '<u>P</u>rint';
                    ctx.state.ok = async () => {
                        if (ctx.state.done || (okButton && okButton.disabled)) return;
                        if ((await printOk(ctx)) !== false) ctx.close();
                    };
                    const lv = ctx.holder(1000, G);
                    lv.classList.add('is-icons', 'vpd-printers');
                    const body = lv.querySelector('.vdt-lv-body');
                    body.innerHTML = [`<div class="vdt-lv-row" data-printer="" role="option"><img src="${ART}/add-printer-32.png" alt="" draggable="false"><span>Add Printer</span></div>`]
                        .concat(list.map((p) => `<div class="vdt-lv-row${p === chosen ? ' is-selected' : ''}" data-printer="${esc(p.id)}" role="option"><img src="${esc(p.isDefault ? p.iconDefault : p.icon)}" alt="" draggable="false"><span>${esc(p.name)}</span></div>`)).join('');
                    const show = () => {
                        ctx.set(1005, chosen.status, G);
                        ctx.set(1007, chosen.location, G);
                        ctx.set(1009, chosen.comment, G);
                        // a file printer is a file already; Preferences has nothing for a generation printer
                        ctx.enable(1002, chosen.driver !== 'pdf' && chosen.driver !== 'queue', G);
                        ctx.enable(1010, chosen.driver !== 'queue', G);
                        const print = ctx.content.querySelector('[data-vdt-action="ok"]');
                        if (print) print.disabled = false;
                    };
                    lv.addEventListener('change', () => {
                        const row = lv.querySelector('.vdt-lv-row.is-selected');
                        const p = row && list.find((x) => x.id === row.dataset.printer);
                        // the list scrolls a part-hidden item into view (LVM_ENSUREVISIBLE)
                        if (row) {
                            const top = row.offsetTop - body.offsetTop;
                            if (top < body.scrollTop) body.scrollTop = top;
                            else if (top + row.offsetHeight > body.scrollTop + body.clientHeight) body.scrollTop = top + row.offsetHeight - body.clientHeight;
                        }
                        if (p) { chosen = p; show(); return; }
                        // Add Printer selected: nothing to print to
                        const print = ctx.content.querySelector('[data-vdt-action="ok"]');
                        if (print) print.disabled = true;
                    });
                    // a double-click: Add Printer opens the Printers folder; a generation printer its queue
                    lv.addEventListener('dblclick', (ev) => {
                        const row = ev.target.closest('.vdt-lv-row');
                        if (!row) return;
                        if (!row.dataset.printer) {
                            if (root.melatonControlPanel && typeof root.melatonControlPanel.open === 'function') root.melatonControlPanel.open('printers');
                        } else if (row.dataset.printer.startsWith('pq:') && root.printQueue) void root.printQueue.open(row.dataset.printer.slice(3));
                        else void ctx.state.ok();
                    });
                    lv.addEventListener('keydown', (ev) => {
                        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' && ev.key !== 'Home' && ev.key !== 'End') return;
                        const rows = Array.from(lv.querySelectorAll('.vdt-lv-row'));
                        const i = rows.findIndex((r) => r.classList.contains('is-selected'));
                        const n = ev.key === 'Home' ? 0 : ev.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (ev.key === 'ArrowLeft' ? -1 : 1)));
                        ev.preventDefault();
                        rows[n].click();
                        rows[n].scrollIntoView({ block: 'nearest', inline: 'nearest' });
                    });
                    ctx.on(1010, 'click', () => { void preferences(chosen.id, ctx.modal); }, G);
                    // Find Printer... searches Active Directory: a workgroup computer has none (greyed, as on the VM)
                    ctx.enable(1003, false, G);
                    // Page Range
                    ctx.enable(1057, !!opts.selection, G);
                    ctx.enable(1058, !!opts.currentPage, G);
                    ctx.set(opts.selection && opts.selectionDefault ? 1057 : 1056, true, G);
                    // the Pages box is always live: typing in it picks Pages (comdlg32)
                    ctx.on(1152, 'input', () => ctx.set(1059, true, G), G);
                    // copies and Collate's picture
                    ctx.set(1153, '1', G);
                    ctx.set(1040, true, G);
                    const collate = () => ctx.html(1084, `<img class="vpd-collate" src="${ART}/${ctx.get(1040, G) ? 'collate' : 'collate-off'}.png" alt="" draggable="false">`, G);
                    ctx.on(1040, 'change', collate, G);
                    collate();
                    if (ie) {
                        // Print frames: only a page with frames has a choice
                        const frames = Number(ie.frames) > 0;
                        [1100, 1101, 1102, 1103].forEach((id) => ctx.enable(id, frames, O));
                        ctx.set(frames ? 1102 : 1101, true, O);
                        // each linked document would be a print job of its own: not offered yet
                        ctx.enable(1105, false, O);
                    }
                    show();
                    setTimeout(() => {
                        try {
                            lv.focus();
                            const sel = lv.querySelector('.vdt-lv-row.is-selected');
                            if (sel) body.scrollTop = Math.max(0, sel.offsetTop - body.offsetTop - 2);
                        } catch (_) { /* gone */ }
                    }, 0);
                },
                async apply() {
                    await remember();
                },
                close() { resolve(job); }
            });
            async function printOk(ctx) {
                const range = ctx.get(1057, G) ? 'selection' : ctx.get(1058, G) ? 'current' : ctx.get(1059, G) ? 'pages' : 'all';
                const pageText = String(ctx.get(1152, G) || '').trim();
                if (range === 'pages' && !rangeOk(pageText)) {
                    await message('Enter page numbers and/or page ranges separated by commas.  For example, 1,5-12', ctx.modal);
                    return false;
                }
                const copies = Math.round(Number(ctx.get(1153, G)));
                if (!(copies >= 1 && copies <= 9999)) {
                    await message('This value is not in the range 1 to 9999.', ctx.modal);
                    return false;
                }
                await remember();
                job = {
                    printer: { id: chosen.id, name: chosen.name, driver: chosen.driver, queueId: chosen.queueId || '' },
                    range, pages: range === 'pages' ? pageText.replace(/\s+/g, '') : '',
                    copies, collate: !!ctx.get(1040, G), printToFile: !!ctx.get(1002, G),
                    settings: printerSettings(chosen.id),
                    pageSetup: pageSetupSettings(),
                    frames: ie ? (ctx.get(1102, O) ? 'selected' : ctx.get(1103, O) ? 'individually' : 'layout') : 'layout',
                    linked: ie ? !!ctx.get(1105, O) : false,
                    tableOfLinks: ie ? !!ctx.get(1106, O) : false
                };
                return true;
            }
        });
    }

    root.vistaPrintDialog = {
        open,
        preferences,
        pageSetup,
        pageSetupSettings,
        printerSettings,
        printers,
        defaultPrinter,
        message,
        PAPERS
    };
})(typeof window !== 'undefined' ? window : globalThis);
