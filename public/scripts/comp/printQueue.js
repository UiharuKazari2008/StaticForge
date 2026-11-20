/**
 * Print queue (Yozora #831 slice 8): generations shown as Vista printing on the desktop.
 *
 * Printers are the generation backends and documents their jobs (modules/printSpooler.js): NovelAI
 * (the generation FIFO: Studio prints, rerolls, presets, MCP generate_image) and each local worker
 * (Ruiko, G10: upscale, animate). The server pushes `print_queue_state` on every change; this file
 * reads it once on connect (`print_queue_get`) and keeps it from the pushes (no polling).
 *
 * The tray icon is Vista's printer icon (#imageGenerationIndicator, shell32 16): it shows while a
 * document is pending (or this tab is printing, or a print queue window is open), with Vista's
 * tooltip "N document(s) pending for <user>". Double-click opens the active printers' queues;
 * right-click: Open All Active Printers, Open The Printers Folder, then each active printer.
 * Balloons (printui.dll strings, tray-balloons rule): "This document was sent to the printer" when
 * a document finishes, "This document failed to print" when one fails (not for this tab's own
 * Studio prints, whose error Studio already says).
 *
 *   window.printQueue.state()            { printers, jobs, recent, self }
 *   window.printQueue.printers()         printers, the default first
 *   window.printQueue.jobsFor(id)        the printer's documents in queue order
 *   window.printQueue.pendingCount()     documents in every queue
 *   window.printQueue.on(fn) / off(fn)   fn(state) after every change
 *   window.printQueue.cancel(jobId)      -> server reply { success, error? }
 *   window.printQueue.history(opts)      -> { total, jobs } (the generation request log)
 *   window.printQueue.open(printerId)    the printer's queue window (printQueueWindow.js, on demand)
 *   window.printQueue.openActive()       Open All Active Printers
 *   window.printQueue.active()           true on the desktop once wired (toastManager drops the
 *                                        generation progress toasts then: the printer shows them)
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-print';
    const ICON_ID = 'imageGenerationIndicator';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    let state = { printers: [], jobs: [], recent: [], self: null, at: 0 };
    let loaded = false;
    let wired = false;
    let menuWired = false;
    let readTried = false;     // one lazy read per connection (iconWanted)
    const listeners = new Set();
    const seenActive = new Map();   // job id -> job, documents seen in a queue (for the balloons)
    const announced = new Set();    // job ids already ballooned

    const client = () => root.wsClient || null;
    const connected = () => { const c = client(); return !!(c && typeof c.isConnected === 'function' && c.isConnected()); };
    const isDesktop = () => !!(root.document && root.document.body && root.document.body.classList.contains('desktop-mode')) && root.uiShell !== 'mobile';

    /** Vista's time sent: 3:16:45 PM  11/14/2026 (the queue's Submitted column, two spaces). */
    function timeSent(t) {
        if (!t) return '';
        const d = new Date(t);
        if (Number.isNaN(d.getTime())) return '';
        const h = d.getHours();
        const p = (n) => String(n).padStart(2, '0');
        return `${(h % 12) || 12}:${p(d.getMinutes())}:${p(d.getSeconds())} ${h < 12 ? 'AM' : 'PM'}  ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    }

    function userName() {
        try { if (typeof root.startMenuUserName === 'function') return root.startMenuUserName(); } catch (_) { /* below */ }
        try { if (typeof root.meletonAccountName === 'function') return root.meletonAccountName(); } catch (_) { /* below */ }
        return 'Administrator';
    }

    function printers() {
        return state.printers.slice().sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
    }
    function printer(id) { return state.printers.find((p) => p.id === id) || null; }
    function jobsFor(id) { return state.jobs.filter((j) => j.printer === id); }
    function pendingCount() { return state.jobs.length; }
    function activePrinters() { return printers().filter((p) => jobsFor(p.id).length); }

    function emit() {
        listeners.forEach((fn) => { try { fn(state); } catch (err) { console.error('printQueue listener', err); } });
    }

    // ---- state ------------------------------------------------------------------------------------

    function apply(next, self) {
        if (!next || typeof next !== 'object') return;
        const prevLoaded = loaded;
        state = {
            printers: Array.isArray(next.printers) ? next.printers : [],
            jobs: Array.isArray(next.jobs) ? next.jobs : [],
            recent: Array.isArray(next.recent) ? next.recent : [],
            self: self !== undefined ? self : state.self,
            at: Number(next.at) || Date.now()
        };
        loaded = true;
        if (prevLoaded) balloonFinished();
        state.jobs.forEach((j) => seenActive.set(j.id, j));
        // forget documents that left the server's recent list too
        const known = new Set(state.jobs.map((j) => j.id).concat(state.recent.map((j) => j.id)));
        Array.from(seenActive.keys()).forEach((id) => { if (!known.has(id)) seenActive.delete(id); });
        syncIcon();
        emit();
    }

    async function read(refreshPrinters) {
        const c = client();
        if (!c || !connected() || typeof c.sendMessage !== 'function') return null;
        try {
            const r = await c.sendMessage('print_queue_get', refreshPrinters ? { refreshPrinters: true } : {}, false);
            if (r && r.state) apply(r.state, r.self || null);
            return r;
        } catch (_) {
            return null;
        }
    }

    function wire() {
        if (wired) return true;
        const c = client();
        if (!c || typeof c.on !== 'function') return false;
        wired = true;
        c.on('print_queue_state', (msg) => { if (msg && msg.data) apply(msg.data); });
        // the phone shows no printer: it reads nothing (pushes still keep the state)
        c.on('connected', () => { readTried = false; if (isDesktop()) void read(false); });
        if (connected() && isDesktop()) void read(false);
        return true;
    }

    // ---- balloons ---------------------------------------------------------------------------------

    function balloon(job, failed) {
        const icon = root.document.getElementById(ICON_ID);
        const pm = root.PopoverManager;
        if (!icon || !pm || typeof pm.showPopover !== 'function') return;
        const p = printer(job.printer);
        const lines = [
            `Document name: '${esc(job.name)}'`,
            `Printer name: '${esc(p ? p.name : job.printer)}'`,
            `Time sent: ${esc(timeSent(job.submitted))}`
        ];
        if (failed) lines.push('Click here to open the print queue, and then for assistance, click Troubleshooter on the Help menu.');
        else lines.push(`Total pages: ${Number(job.pages) || 1}`);
        // the icon shows for the balloon (it may have hidden as the queue emptied)
        const wasHidden = icon.classList.contains('hidden');
        if (wasHidden && isDesktop()) icon.classList.remove('hidden');
        pm.showPopover(icon, failed ? 'error' : 'info',
            failed ? 'This document failed to print' : 'This document was sent to the printer',
            lines.join('<br>'), false, 8000,
            `<img src="${ART}/${failed ? 'printer-error' : 'printer'}-32.png" alt="" width="32" height="32">`, null, {
                popupId: 'generation-complete',
                position: 'top',
                arrowPosition: 'bottom-right',
                // a click on either balloon opens the printer's queue (Vista's printui balloons)
                onClick: () => open(job.printer),
                onHide: () => syncIcon()
            });
    }

    function balloonFinished() {
        if (!isDesktop()) return;
        state.recent.forEach((job) => {
            if (announced.has(job.id) || !seenActive.has(job.id)) return;
            announced.add(job.id);
            if (job.status === 'cancelled') return;
            const failed = job.status === 'failed';
            // this tab's own Studio print: Studio says its error itself
            if (failed && job.self && state.self && job.self === state.self) return;
            balloon(job, failed);
        });
        if (announced.size > 500) announced.clear();
    }

    // ---- the tray icon ----------------------------------------------------------------------------

    function queueWindowsOpen() {
        return !!(root.document && root.document.querySelector('.print-queue-window:not(.hidden)'));
    }

    /** Called by updateImageGenerationIndicator (trayIndicators.js) and after every change. */
    function iconWanted(localGenerating) {
        // the desktop's tray boot asks first: read the queue once if the connect came before desktop mode
        if (!loaded && !readTried && isDesktop() && connected()) { readTried = true; void read(false); }
        return !!localGenerating || pendingCount() > 0 || queueWindowsOpen();
    }

    function tooltip() {
        const n = pendingCount();
        return n ? `${n} document(s) pending for ${userName()}` : 'Printer';
    }

    function syncIcon() {
        wireIcon();
        if (typeof root.updateImageGenerationIndicator === 'function') root.updateImageGenerationIndicator();
    }

    function openPrintersFolder() {
        // melatonControlPanel.open: public/scripts/comp/melatonControlPanel.js
        if (root.melatonControlPanel && typeof root.melatonControlPanel.open === 'function') root.melatonControlPanel.open('printers');
    }

    function wireIcon() {
        const icon = root.document && root.document.getElementById(ICON_ID);
        if (!icon || icon.dataset.printQueueWired === '1') return;
        icon.dataset.printQueueWired = '1';
        icon.addEventListener('dblclick', (ev) => { ev.preventDefault(); void openActive(); });
        if (root.contextMenu && typeof root.contextMenu.attachToElement === 'function' && !menuWired) {
            menuWired = true;
            root.contextMenu.attachToElement(icon, {
                onAction: (a) => {
                    if (a === 'pq-all') void openActive();
                    else if (a === 'pq-folder') openPrintersFolder();
                    else if (typeof a === 'string' && a.startsWith('pq-open:')) void open(a.slice(8));
                },
                sections: [{
                    type: 'list',
                    initfn: (s) => {
                        const list = activePrinters();
                        s.items = [
                            { text: 'Open All Active Printers', action: 'pq-all' },
                            { text: 'Open The Printers Folder', action: 'pq-folder' }
                        ].concat(list.length ? [{ separator: true }] : [], list.map((p) => ({ text: p.name, action: `pq-open:${p.id}` })));
                    }
                }]
            });
        }
    }

    // ---- windows ----------------------------------------------------------------------------------

    async function loadWindows() {
        if (!root.printQueueWindow && root.featureLoader) await root.featureLoader.loadFeature('print_queue');
        return root.printQueueWindow || null;
    }

    async function open(printerId) {
        const w = await loadWindows();
        if (!w) return null;
        if (!loaded) await read(true);
        const id = printerId || ((printers()[0] || {}).id) || 'novelai';
        const win = w.open(id);
        syncIcon();
        return win;
    }

    /** Open All Active Printers: every printer with documents, or the default printer when none. */
    async function openActive() {
        const list = activePrinters();
        if (!list.length) return open(null);
        for (const p of list) await open(p.id);
        return null;
    }

    async function cancel(jobId) {
        const c = client();
        if (!c || !connected()) return { success: false, error: 'Melaton is not connected to the server.' };
        try {
            return await c.sendMessage('print_queue_cancel', { jobId }, false);
        } catch (err) {
            return { success: false, error: (err && err.message) || 'The server did not answer.' };
        }
    }

    async function history(opts) {
        const c = client();
        if (!c || !connected()) throw new Error('Melaton is not connected to the server.');
        return c.sendMessage('print_queue_history', opts || {}, false);
    }

    function boot() {
        if (!wire()) { setTimeout(boot, 1000); return; }
        wireIcon();
    }

    root.printQueue = {
        state: () => state,
        printers,
        printer,
        jobsFor,
        pendingCount,
        activePrinters,
        iconWanted,
        tooltip,
        timeSent,
        userName,
        refresh: (refreshPrinters) => read(refreshPrinters !== false),
        cancel,
        history,
        open,
        openActive,
        openPrintersFolder,
        syncIcon,
        on: (fn) => { if (typeof fn === 'function') listeners.add(fn); },
        off: (fn) => listeners.delete(fn),
        active: () => wired && isDesktop(),
        loaded: () => loaded
    };

    if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
    else setTimeout(boot, 0);
})(typeof window !== 'undefined' ? window : globalThis);
