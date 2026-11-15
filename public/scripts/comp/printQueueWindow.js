/**
 * Print queue window (Yozora #831 slice 8): Vista's printui queue window, one per printer, where the
 * printers are the generation backends and the documents their jobs (printQueue.js keeps the state
 * from the server's pushes; modules/printSpooler.js builds it). Measured on the Vista VM's
 * "Microsoft XPS Document Writer" queue (900x300): menu bar 19 px (Printer, Document, View), the
 * list in a 1 px #828790 frame with Vista header items (Document Name 200, Status 80, Owner 80,
 * Pages 60, Size 100, Submitted 140, Port 120), 19 px rows, a 23 px status bar split in half with
 * "N document(s) in queue". Strings are printui.dll's.
 *
 * What works: Document > Cancel (and Delete, and the row menu) cancels a document that waits, and a
 * Studio print that prints (as Studio's own Cancel); Printer > Cancel All Documents cancels every
 * document that can be; Document > Properties is printui's General page (dialog 506). Pause, Resume,
 * Restart, Pause Printing, Sharing, Use Printer Offline, Printing Preferences and Update Driver are
 * greyed: the backends cannot do them. Look: public/css/print-queue.css.
 *
 *   printQueueWindow.open(printerId)   the printer's window (a second open brings it forward)
 *   printQueueWindow.close(printerId)
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-print';
    const doc = typeof document !== 'undefined' ? document : null;
    const windows = new Map(); // printer id -> window state

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const pq = () => root.printQueue || null;
    const REG = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\PrintUI';

    const COLS = [
        { key: 'name', text: 'Document Name', w: 200 },
        { key: 'status', text: 'Status', w: 80 },
        { key: 'owner', text: 'Owner', w: 80 },
        { key: 'pages', text: 'Pages', w: 60 },
        { key: 'size', text: 'Size', w: 100 },
        { key: 'submitted', text: 'Submitted', w: 140 },
        { key: 'port', text: 'Port', w: 120 }
    ];

    /** StrFormatByteSize: bytes, then KB / MB / GB to three significant figures. */
    function size(b) {
        const n = Number(b) || 0;
        if (!n) return '';
        if (n < 1024) return `${n} bytes`;
        const u = ['KB', 'MB', 'GB', 'TB'];
        let v = n / 1024;
        let i = 0;
        while (v >= 1000 && i < u.length - 1) { v /= 1024; i += 1; }
        return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`;
    }

    function reg(name, d) { return root.melatonRegistry ? root.melatonRegistry.get(REG, name, d) : d; }
    function setReg(values) { if (root.melatonRegistry) void root.melatonRegistry.set(REG, values); }

    function printerOf(w) { const q = pq(); return (q && q.printer(w.id)) || { id: w.id, name: w.id, port: '', status: 'Ready' }; }
    function jobsOf(w) { const q = pq(); return q ? q.jobsFor(w.id) : []; }
    function selectedJobs(w) { return jobsOf(w).filter((j) => w.sel.has(j.id)); }

    function title(p) {
        if (p.status === 'Offline') return `${p.name} - Offline`;
        if (p.status === 'Paused') return `${p.name} - Paused`;
        return p.name;
    }

    // ---- the window -------------------------------------------------------------------------------

    function build(id) {
        const q = pq();
        const p = (q && q.printer(id)) || { id, name: id };
        const icon = p.isDefault ? `${ART}/printer-default-16.png` : `${ART}/printer-16.png`;
        const m = doc.createElement('div');
        m.className = 'modal hidden resizeable-window print-queue-window';
        m.id = `printQueue_${String(id).replace(/[^a-z0-9_-]/gi, '_')}`;
        m.dataset.windowIdentifier = `print-queue-${id}`;
        m.dataset.windowClient = 'light';
        m.dataset.taskbarIcon = icon;
        m.dataset.windowDefaultWidth = '562';
        m.dataset.windowDefaultHeight = '200';
        m.dataset.windowMinWidth = '300';
        m.dataset.windowMinHeight = '140';
        m.setAttribute('role', 'dialog');
        m.setAttribute('aria-label', p.name);
        const tpl = COLS.map((c) => `${c.w}px`).join(' ') + ' minmax(0, 1fr)';
        m.innerHTML = `
            <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${esc(icon)}" alt=""><span class="pq-title">${esc(title(p))}</span></div></div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                <button type="button" class="btn-danger close-btn btn-small pq-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content win7 pq-client">
                <div class="naxt-menubar pq-menubar" role="menubar" data-win32-menus>
                    <button type="button" class="naxt-menu-title" data-pq-menu="printer" role="menuitem">Printer</button>
                    <button type="button" class="naxt-menu-title" data-pq-menu="document" role="menuitem">Document</button>
                    <button type="button" class="naxt-menu-title" data-pq-menu="view" role="menuitem">View</button>
                </div>
                <div class="pq-list" tabindex="0" role="grid" style="--cols:${tpl}">
                    <div class="pq-lhead">${COLS.map((c) => `<div class="pq-col">${esc(c.text)}</div>`).join('')}<div class="pq-col pq-col-rest"></div></div>
                    <div class="pq-lbody"></div>
                </div>
                <div class="pq-status"><span></span><span></span></div>
            </div>`;
        doc.body.appendChild(m);
        const w = { id, modal: m, sel: new Set(), anchor: null, el: (s) => m.querySelector(s) };
        if (!reg('StatusBar', true)) m.classList.add('no-status');
        m.querySelector('.pq-close').addEventListener('click', () => close(id));
        m.querySelectorAll('[data-pq-menu]').forEach((t) => {
            if (!root.contextMenu) return;
            root.contextMenu.attachClickMenuToElement(t, {
                onAction: (a) => void action(w, a),
                sections: [{ type: 'list', initfn: (s) => { s.items = menu(w, t.dataset.pqMenu); } }]
            });
        });
        const list = w.el('.pq-list');
        list.addEventListener('mousedown', (ev) => {
            const row = ev.target.closest('.pq-row');
            if (ev.button === 2 && row && w.sel.has(row.dataset.job)) return; // keep a multi-selection for its menu
            pick(w, row ? row.dataset.job : null, ev);
        });
        list.addEventListener('dblclick', (ev) => { const row = ev.target.closest('.pq-row'); if (row) void action(w, 'doc-props'); });
        list.addEventListener('keydown', (ev) => key(w, ev));
        if (root.contextMenu) {
            root.contextMenu.attachToElement(list, {
                onAction: (a) => void action(w, a),
                sections: [{ type: 'list', initfn: (s) => { s.items = w.sel.size ? menu(w, 'row') : []; } }]
            });
        }
        m.addEventListener('keydown', (ev) => { if (ev.key === 'F5') { ev.preventDefault(); void action(w, 'refresh'); } });
        w.listener = () => render(w);
        if (q) q.on(w.listener);
        call('openModal', m);
        m.classList.remove('hidden');
        render(w);
        return w;
    }

    function render(w) {
        const p = printerOf(w);
        const jobs = jobsOf(w);
        // documents that left the queue leave the selection
        const ids = new Set(jobs.map((j) => j.id));
        Array.from(w.sel).forEach((id) => { if (!ids.has(id)) w.sel.delete(id); });
        const q = pq();
        const rows = jobs.map((j) => {
            const cells = [
                `<img src="${ART}/document-16.png" alt=""><i>${esc(j.name)}</i>`,
                j.statusText ? `<i>${esc(j.statusText)}</i>` : '',
                `<i>${esc(j.owner || '')}</i>`,
                `<i>${esc(String(j.pages || ''))}</i>`,
                `<i>${esc(size(j.size))}</i>`,
                `<i>${esc(q ? q.timeSent(j.submitted) : '')}</i>`,
                `<i>${esc(p.port || '')}</i>`
            ];
            return `<div class="pq-row${w.sel.has(j.id) ? ' is-selected' : ''}" data-job="${esc(j.id)}" role="row">${cells.map((c) => `<span>${c}</span>`).join('')}<span></span></div>`;
        }).join('');
        const body = w.el('.pq-lbody');
        if (body.dataset.html !== rows) { body.innerHTML = rows; body.dataset.html = rows; }
        const t = title(p);
        const tEl = w.el('.pq-title');
        if (tEl.textContent !== t) tEl.textContent = t;
        w.modal.setAttribute('aria-label', t);
        w.el('.pq-status > span').textContent = `${jobs.length} document(s) in queue`;
    }

    // ---- selection and keys -------------------------------------------------------------------------

    function pick(w, id, ev) {
        const jobs = jobsOf(w);
        if (!id) { w.sel.clear(); w.anchor = null; render(w); return; }
        if (ev && ev.shiftKey && w.anchor) {
            const a = jobs.findIndex((j) => j.id === w.anchor);
            const b = jobs.findIndex((j) => j.id === id);
            if (a >= 0 && b >= 0) {
                if (!ev.ctrlKey) w.sel.clear();
                jobs.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((j) => w.sel.add(j.id));
                render(w);
                return;
            }
        }
        if (ev && (ev.ctrlKey || ev.metaKey)) {
            if (w.sel.has(id)) w.sel.delete(id); else w.sel.add(id);
        } else {
            w.sel.clear();
            w.sel.add(id);
        }
        w.anchor = id;
        render(w);
    }

    function key(w, ev) {
        const jobs = jobsOf(w);
        if (ev.key === 'Delete') { ev.preventDefault(); void action(w, 'doc-cancel'); return; }
        if (ev.key === 'Enter') { ev.preventDefault(); void action(w, 'doc-props'); return; }
        if (ev.key === 'a' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); jobs.forEach((j) => w.sel.add(j.id)); render(w); return; }
        if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Home' && ev.key !== 'End') return;
        if (!jobs.length) return;
        ev.preventDefault();
        let i = jobs.findIndex((j) => j.id === w.anchor);
        if (ev.key === 'ArrowDown') i = Math.min(jobs.length - 1, i + 1);
        else if (ev.key === 'ArrowUp') i = Math.max(0, i < 0 ? 0 : i - 1);
        else if (ev.key === 'Home') i = 0;
        else i = jobs.length - 1;
        pick(w, jobs[i].id, ev.shiftKey ? { shiftKey: true } : null);
    }

    // ---- menus --------------------------------------------------------------------------------------

    function menu(w, name) {
        const p = printerOf(w);
        const sel = selectedJobs(w);
        const canCancel = sel.length > 0 && sel.every((j) => j.cancellable);
        const anyCancellable = jobsOf(w).some((j) => j.cancellable);
        const check = (on) => (on ? { checked: true, showIndicator: true } : {});
        switch (name) {
            case 'printer': return [
                { text: 'Connect', action: 'noop', disabled: true },
                { separator: true },
                Object.assign({ text: 'Set As Default Printer', action: 'noop', disabled: true }, check(!!p.isDefault)),
                { text: 'Printing Preferences...', action: 'noop', disabled: true },
                { separator: true },
                { text: 'Update Driver', action: 'noop', disabled: true },
                { text: 'Pause Printing', action: 'noop', disabled: true },
                { text: 'Cancel All Documents', action: 'cancel-all', disabled: !anyCancellable },
                { separator: true },
                { text: 'Sharing...', action: 'noop', disabled: true },
                { text: 'Use Printer Offline', action: 'noop', disabled: true },
                { separator: true },
                { text: 'Properties', action: 'printer-props' },
                { separator: true },
                { text: 'Close', action: 'close' }
            ];
            case 'document': return [
                { text: 'Pause', action: 'noop', disabled: true },
                { text: 'Resume', action: 'noop', disabled: true },
                { text: 'Restart', action: 'noop', disabled: true },
                { separator: true },
                { text: 'Cancel', action: 'doc-cancel', disabled: !canCancel },
                { separator: true },
                { text: 'Properties', action: 'doc-props', disabled: sel.length !== 1 }
            ];
            case 'row': return [
                { text: 'Pause', action: 'noop', disabled: true },
                { text: 'Restart', action: 'noop', disabled: true },
                { separator: true },
                { text: 'Cancel', action: 'doc-cancel', disabled: !canCancel },
                { separator: true },
                { text: 'Properties', action: 'doc-props', disabled: sel.length !== 1 }
            ];
            case 'view': return [
                Object.assign({ text: 'Status Bar', action: 'status-bar' }, check(!w.modal.classList.contains('no-status'))),
                { text: 'Refresh', action: 'refresh' }
            ];
            default: return [];
        }
    }

    function box(html, buttons, opts) {
        return call('showConfirmationDialog', html, buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }], null,
            Object.assign({ title: 'Printers', width: 366 }, opts || {}));
    }

    const YES_NO = [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }];

    async function cancelJobs(w, jobs) {
        const q = pq();
        if (!q) return;
        for (const j of jobs) {
            const r = await q.cancel(j.id);
            if (!r || r.success === false) {
                if (r && r.code === 'NOT_FOUND') continue; // it finished meanwhile
                await box(`<p>${esc((r && r.error) || 'The document could not be cancelled.')}</p>`, null, { icon: 'fas fa-circle-xmark' });
                return;
            }
        }
    }

    async function action(w, a) {
        const p = printerOf(w);
        switch (a) {
            case 'close': close(w.id); return;
            case 'refresh': { const q = pq(); if (q) await q.refresh(true); render(w); return; }
            case 'status-bar': {
                w.modal.classList.toggle('no-status');
                setReg({ StatusBar: !w.modal.classList.contains('no-status') });
                return;
            }
            case 'doc-cancel': {
                const sel = selectedJobs(w).filter((j) => j.cancellable);
                if (!sel.length) return;
                const text = sel.length > 1 ? 'Are you sure you want to cancel these documents?' : 'Are you sure you want to cancel the document?';
                if (!(await box(`<p class="pq-instruction">${esc(text)}</p>`, YES_NO, { icon: 'fas fa-triangle-exclamation' }))) return;
                await cancelJobs(w, sel);
                return;
            }
            case 'cancel-all': {
                const all = jobsOf(w).filter((j) => j.cancellable);
                if (!all.length) return;
                if (!(await box(`<p class="pq-instruction">${esc(`Are you sure you want to cancel all documents for '${p.name}'?`)}</p>`, YES_NO, { icon: 'none' }))) return;
                await cancelJobs(w, all);
                return;
            }
            case 'doc-props': {
                const j = selectedJobs(w)[0];
                if (j) documentProperties(w, j);
                return;
            }
            case 'printer-props': {
                // the printer's page in Print Management (its queue, driver, port)
                // openPrintManagementSnapin: public/scripts/comp/dsapManifests.js
                if (typeof root.openPrintManagementSnapin === 'function') void root.openPrintManagementSnapin(w.id);
                return;
            }
            default:
        }
    }

    /** Document > Properties: printui's General page (dialog 506), filled from the document. */
    function documentProperties(w, j) {
        const T = root.vistaDialogTemplate;
        if (!T || typeof T.openSheet !== 'function') return;
        const p = printerOf(w);
        const q = pq();
        const sid = `printDoc_${String(j.id).replace(/[^a-z0-9_]/gi, '_')}`;
        const kind = { generate_image: 'NovelAI image', reroll_image: 'NovelAI reroll', generate_preset: 'NovelAI preset', upscale: 'Upscale', animate: 'Animation' }[j.type] || 'NovelAI image';
        T.openSheet({
            id: sid,
            title: `${j.name} Document Properties`,
            icon: `${ART}/document-16.png`,
            owner: w.modal,
            noApply: false,
            pages: [{
                key: 'printui:506',
                title: 'General',
                overrides: {
                    3013: { image: `${ART}/document-32.png` },
                    4220: { text: j.name },
                    4219: { text: size(j.size) || '0 bytes' },
                    4225: { text: String(j.pages || 1) },
                    4224: { text: kind },
                    4223: { text: p.driver || p.name },
                    4226: { text: j.owner || '' },
                    4222: { text: q ? q.timeSent(j.submitted).replace('  ', ' ') : '' },
                    4230: { disabled: true },
                    4231: { disabled: true },
                    4232: { disabled: true },
                    4201: { disabled: true },
                    4509: { disabled: true },
                    4510: { disabled: true }
                }
            }],
            init: (ctx) => {
                try {
                    ctx.set(4230, j.owner || '');
                    ctx.set(4232, true);
                    ctx.set(4231, 1);
                    ctx.text(4229, '1');
                } catch (_) { /* a control the renderer drew differently */ }
            }
        });
    }

    // ---- open / close -------------------------------------------------------------------------------

    function open(id) {
        if (!doc || !id) return null;
        let w = windows.get(id);
        if (w && w.modal.isConnected) {
            w.modal.classList.remove('hidden');
            call('openModal', w.modal);
            call('bringModalToFront', w.modal);
            render(w);
            return w;
        }
        w = build(id);
        windows.set(id, w);
        return w;
    }

    function close(id) {
        const w = windows.get(id);
        if (!w) return;
        windows.delete(id);
        const q = pq();
        if (q && w.listener) q.off(w.listener);
        try { call('closeModal', w.modal); } catch (_) { /* gone */ }
        const m = w.modal;
        m.classList.add('hidden');
        setTimeout(() => { if (m.isConnected && !windows.has(id)) m.remove(); if (q) q.syncIcon(); }, 300);
        if (q) q.syncIcon();
    }

    root.printQueueWindow = { open, close, _windows: windows, _size: size };
})(typeof window !== 'undefined' ? window : globalThis);
