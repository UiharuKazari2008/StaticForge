/*
 * Disk Cleanup and this computer's storage (#945): what Melaton keeps on the computer, sorted the way Vista sorts it.
 *
 *   Offline files      what is kept for the user to work without the server: the gallery pictures kept for offline
 *                      viewing (the worker's picture cache, pinned ones included), the desktop's wallpapers, the
 *                      offline databases (IndexedDB) and, on a phone, the Café cache's replies (Melaton Café
 *                      Miniport). Shown by Sync Center's Offline Files and Offline Files' Disk Usage tab.
 *   Temporary files    kept for speed and made again on demand: Temporary Internet Files (the worker's dynamic
 *                      cache), Thumbnails (Explorer's previews) and the pictures cache's unpinned rows.
 *   System files       Melaton itself: the installed files (the static cache), the protected fonts, the compiled
 *                      script cache, the launch shell and the worker's own records. Not offline files and never
 *                      deleted here; Disk Cleanup lists their size, as Vista lists what it cannot remove.
 *
 * Read only while a window that shows them is open (phone-power-client): the worker's STORAGE_REPORT (sw.js) and
 * navigator.storage.estimate(). Deletions go through the worker's CLEAR_CACHE (temporary, thumbnails, pictures).
 *
 * Disk Cleanup is cleanmgr.exe 1:1 from the Vista VM: Disk Cleanup Options (cleanmgr.exe.mui 1150), the calculating
 * box (102), "Disk Cleanup for (C:)" with Disk Cleanup (101) and More Options (110), the confirmation (string 20/21)
 * and the cleaning box (106).
 *
 *   melatonStorage.measure(onStep?) -> Promise<report>    melatonStorage.clear(target) -> Promise<{removed}>
 *   melatonStorage.size(bytes)                            Vista's three-digit sizes (99.7 KB, 107 MB, 1.00 GB)
 *   window.openDiskCleanup(owner?)                        Start > System Tools > Disk Cleanup, Run cleanmgr
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const ART = '/static_images/vista-cleanmgr';
    const ICON16 = `${ART}/cleanmgr-16.png`;

    // cleanmgr.exe.mui's dialogs (DLGTEMPLATEEX from the Vista VM, ~/.cache/vista-vm/tools/dlgjson.py); "Windows"
    // reads Melaton (copyrights-not-1to1)
    // a template's icon resource ("#104": the kit draws /static_images/vista-dlg/cleanmgr-104.png)
    const res = (id) => `#${id}`;
    const TPL = {
        'cleanmgr:101': { t: 'Disk Cleanup', w: 235, h: 223, f: ['MS Shell Dlg', 8], s: 281542720, c: [[1007, 'S', 7, 0, 20, 20, 1342177283, '', 0], [1001, 'S', 35, 7, 193, 21, 1342308352, 'You can use Disk Cleanup to free up to 0.0MB of disk space on drive C.', 0], [1032, 'S', 7, 31, 221, 10, 1342308352, '&Files to delete:', 0], [1000, 'SysListView32', 7, 43, 221, 57, 1350647821, '', 512], [101, 'B', 7, 117, 221, 90, 1342177287, 'Description', 0], [1003, 'S', 13, 129, 207, 60, 1342308352, '', 0], [1002, 'B', 161, 186, 60, 14, 1342242816, '&Details...', 0], [1031, 'S', 7, 105, 148, 10, 1342308352, 'Total amount of disk space you gain:', 0], [1026, 'S', 148, 105, 75, 9, 1342308354, '', 0], [1137, 'SysLink', 7, 210, 150, 10, 1342242816, '<A>How does Disk Cleanup work?</A>', 0]] },
        'cleanmgr:110': { t: 'Disk Cleanup', w: 235, h: 223, f: ['MS Shell Dlg', 8], s: 2160591040, c: [[1022, 'B', 7, 7, 221, 62, 1342177287, 'Programs and Features', 0], [1020, 'S', 13, 22, 20, 20, 1342177283, res(113), 0], [1024, 'S', 44, 22, 179, 25, 1342308352, 'You can free more disk space by removing programs that you do not use.', 0], [1025, 'B', 166, 48, 55, 14, 1342242816, 'Cl&ean up...', 0], [1027, 'B', 7, 76, 221, 107, 1342177287, 'System Restore and Shadow Copies', 0], [1028, 'S', 13, 91, 20, 20, 1342177283, res(113), 0], [1029, 'S', 44, 91, 179, 23, 1342308352, 'You can free more disk space by removing all but the most recent restore point.', 0], [1038, 'S', 44, 119, 179, 33, 1342308352, 'In some editions of Melaton, the disk might include file shadow copies and older Melaton Complete PC Backup images as part of restore points. This information will also be deleted.', 0], [1030, 'B', 166, 162, 55, 14, 1342242816, '&Clean up...', 0]] },
        'cleanmgr:102': { t: 'Disk Cleanup', w: 223, h: 70, f: ['MS Shell Dlg', 8], s: 2160593088, c: [[2, 'B', 166, 43, 50, 14, 1342242816, 'Cancel', 0], [65535, 'S', 7, 7, 20, 20, 1342177283, res(104), 0], [1005, 'S', 33, 7, 183, 24, 1342308352, 'Disk Cleanup is calculating how much space you can free on Drive C. This may take a few minutes to complete.', 0], [1006, 'msctls_progress32', 7, 48, 151, 8, 1342177280, 'Progress1', 0], [65535, 'S', 7, 37, 102, 8, 1342308352, 'Calculating...', 0], [1012, 'S', 44, 59, 172, 8, 1342308352, '', 0], [65535, 'S', 7, 59, 32, 8, 1342308352, 'Scanning:', 0]] },
        'cleanmgr:106': { t: 'Disk Cleanup', w: 223, h: 70, f: ['MS Shell Dlg', 8], s: 2160593088, c: [[2, 'B', 166, 43, 50, 14, 1342242816, 'Cancel', 0], [65535, 'S', 7, 7, 20, 20, 1342177283, res(104), 0], [65535, 'S', 34, 7, 182, 17, 1342308352, 'The Disk Cleanup utility is cleaning up unnecessary files on your machine.', 0], [1009, 'msctls_progress32', 7, 48, 151, 8, 1342177280, 'Progress1', 0], [1008, 'S', 7, 38, 152, 8, 1342308352, 'Cleaning up drive C:', 0], [1011, 'S', 44, 59, 172, 8, 1342308352, '', 0], [65535, 'S', 7, 59, 32, 8, 1342308352, 'Cleaning:', 0]] },
        'cleanmgr:1150': { t: 'Disk Cleanup Options', w: 300, h: 110, f: ['MS Shell Dlg', 8], s: 2160593096, c: [[-1, 'S', 10, 7, 18, 18, 1342177283, res(104), 0], [1151, 'S', 36, 8, 180, 26, 1342308352, 'Choose which files to clean up', 0], [1152, 'B', 13, 34, 275, 26, 1342242830, '&My files only', 0], [1153, 'B', 13, 63, 275, 26, 1342242830, '&Files from all users on this computer', 0], [2, 'B', 240, 92, 50, 14, 1342242817, '&Cancel', 0]] }
    };

    let cssDone = false;
    function kit() {
        const fl = root.featureLoader;
        const ready = fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('vista_dialog_templates') : Promise.resolve();
        return Promise.resolve(ready).then(() => {
            if (!root.vistaDialogTemplate) throw new Error('vistaDialogTemplate is not loaded');
            root.vistaDialogTemplates = root.vistaDialogTemplates || {};
            Object.assign(root.vistaDialogTemplates, TPL);
            if (!cssDone && doc && !doc.querySelector('link[href="/css/disk-cleanup.css"]')) {
                cssDone = true;
                const link = doc.createElement('link');
                link.rel = 'stylesheet';
                link.href = '/css/disk-cleanup.css';
                doc.head.appendChild(link);
            }
            return root.vistaDialogTemplate;
        });
    }

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    /** Vista's sizes: three significant digits ("99.7 KB", "107 MB", "1.00 GB"), bytes below 1 KB. */
    function size(bytes) {
        const b = Math.max(0, Number(bytes) || 0);
        if (b < 1024) return `${Math.round(b)} bytes`;
        const units = ['KB', 'MB', 'GB', 'TB'];
        let v = b / 1024;
        let i = 0;
        while (v >= 1000 && i < units.length - 1) { v /= 1024; i += 1; }
        const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
        return `${v.toFixed(digits)} ${units[i]}`;
    }

    // ---- the worker -----------------------------------------------------------------------------------------------

    let seq = 0;
    /** One request to the service worker and its answer (null without a worker or after ms). */
    function ask(type, payload, replyType, ms) {
        const sw = root.navigator && root.navigator.serviceWorker;
        const worker = sw && sw.controller;
        if (!worker) return Promise.resolve(null);
        const requestId = `dcl-${Date.now().toString(36)}-${++seq}`;
        return new Promise((resolve) => {
            const done = (value) => { clearTimeout(timer); sw.removeEventListener('message', onMsg); resolve(value); };
            const onMsg = (ev) => {
                const d = ev && ev.data;
                if (d && d.type === replyType && d.requestId === requestId) done(d);
            };
            const timer = setTimeout(() => done(null), ms || 60000);
            sw.addEventListener('message', onMsg);
            try { worker.postMessage(Object.assign({ type, requestId }, payload || {})); } catch (_) { done(null); }
        });
    }

    // ---- what is kept --------------------------------------------------------------------------------------------

    /**
     * The storage report: { quota, usage, system: { bytes, files }, offline: { pictures, wallpapers, databases, cafe },
     * temporary: { temporary, thumbnails, pictures (unpinned) } } - bytes null where the browser does not say.
     */
    async function measure(onStep) {
        const step = (t) => { try { if (typeof onStep === 'function') onStep(t); } catch (_) { /* the box went */ } };
        step('Melaton system files');
        let est = null;
        try { est = root.navigator.storage && root.navigator.storage.estimate ? await root.navigator.storage.estimate() : null; } catch (_) { est = null; }
        step('Temporary Internet Files');
        const rep = await ask('STORAGE_REPORT', {}, 'STORAGE_REPORT', 120000);
        const c = (rep && rep.caches) || {};
        const g = (k) => c[k] || { count: 0, bytes: 0 };
        step('Offline databases');
        const details = (est && est.usageDetails) || null;
        let dbNames = [];
        try { dbNames = root.indexedDB && typeof root.indexedDB.databases === 'function' ? (await root.indexedDB.databases()).map((d) => d.name).filter(Boolean) : []; } catch (_) { dbNames = []; }
        // the static cache (thousands of rows) is what the caches use beyond everything measured
        const measured = ['images', 'dynamic', 'internal', 'wallpapers', 'fonts', 'thumbnails', 'scriptCode', 'launchShell'].reduce((n, k) => n + (Number(g(k).bytes) || 0), 0);
        const staticBytes = details && Number.isFinite(details.caches) ? Math.max(0, details.caches - measured) : null;
        step('Café cache');
        let cafe = null;
        try {
            const mc = root.melatonContinuity;
            const cfg = mc && typeof mc.miniportConfig === 'function' ? mc.miniportConfig() : null;
            if (cfg && cfg.stats) cafe = { entries: Number(cfg.stats.entries) || 0, served: Number(cfg.stats.served) || 0 };
            if (mc && typeof mc.requestMiniportConfig === 'function') mc.requestMiniportConfig();
        } catch (_) { cafe = null; }
        const images = g('images');
        const pinnedShare = images.count ? (images.pinned || 0) / images.count : 0;
        const sys = ['fonts', 'scriptCode', 'launchShell', 'internal'];
        return {
            at: Date.now(),
            quota: est ? Number(est.quota) || 0 : null,
            usage: est ? Number(est.usage) || 0 : null,
            system: {
                bytes: (staticBytes || 0) + sys.reduce((n, k) => n + (Number(g(k).bytes) || 0), 0),
                known: staticBytes !== null,
                files: (Number(g('static').count) || 0) + sys.reduce((n, k) => n + (Number(g(k).count) || 0), 0),
                parts: { installed: { files: g('static').count || 0, bytes: staticBytes }, fonts: g('fonts'), scriptCode: g('scriptCode'), launchShell: g('launchShell') }
            },
            offline: {
                pictures: { count: images.count || 0, bytes: images.bytes || 0, pinned: images.pinned || 0 },
                wallpapers: g('wallpapers'),
                databases: { bytes: details && Number.isFinite(details.indexedDB) ? details.indexedDB : null, names: dbNames },
                cafe
            },
            temporary: {
                temporary: g('dynamic'),
                thumbnails: g('thumbnails'),
                pictures: { count: Math.max(0, (images.count || 0) - (images.pinned || 0)), bytes: Math.round((images.bytes || 0) * (1 - pinnedShare)) }
            },
            error: rep ? rep.error || null : 'The service worker did not answer.'
        };
    }

    /** Delete one cleanable group through the worker: 'temporary' | 'thumbnails' | 'pictures'. */
    function clear(target) {
        return ask('CLEAR_CACHE', { target }, 'CLEAR_CACHE_DONE', 120000).then((r) => r || { removed: 0, error: 'The service worker did not answer.' });
    }

    // ---- Disk Cleanup ---------------------------------------------------------------------------------------------

    // the "Files to delete" list (Vista's handlers' names and descriptions, Windows read Melaton)
    const GROUPS = [
        {
            id: 'temporary', name: 'Temporary Internet Files', icon: `${ART}/temp-internet-16.png`, checked: true,
            bytes: (r) => r.temporary.temporary.bytes,
            text: 'The Temporary Internet Files folder contains pages and replies from the Dreamscape server stored on your hard disk for quick viewing. Your personalized settings will be left intact.'
        },
        {
            id: 'thumbnails', name: 'Thumbnails', icon: '/static_images/vista-explorer/fav-pictures.png', checked: true,
            bytes: (r) => r.temporary.thumbnails.bytes,
            text: 'Melaton keeps a copy of all of your picture, video, and document thumbnails so they can be displayed quickly when you open a folder. If you delete these thumbnails, they will be automatically recreated as needed.'
        },
        {
            id: 'pictures', name: 'Temporary Offline Files', icon: '/static_images/vista-cpl/items/offline-files-16.png', checked: false,
            bytes: (r) => r.temporary.pictures.bytes,
            text: 'Temporary offline files are local copies of recently viewed pictures from the server. These files are automatically cached so that you can use them after you disconnect from the network. Pictures you pinned to keep offline are not deleted.'
        },
        {
            id: 'system', name: 'Melaton system files', icon: '/static_images/vista-explorer/drive-fixed-16.png', fixed: true,
            bytes: (r) => r.system.bytes,
            text: 'The files Melaton runs from: its programs and art, the fonts, the compiled script cache and the start-up shell, so Melaton starts without waiting for the server. Melaton Update keeps them current; Disk Cleanup does not remove them.'
        }
    ];

    let running = null;

    /** Start > Accessories > System Tools > Disk Cleanup, Run "cleanmgr", Performance Information and Tools. */
    async function openDiskCleanup(owner) {
        if (running) {
            const m = doc.getElementById(running);
            if (m && typeof root.bringModalToFront === 'function') root.bringModalToFront(m);
            return;
        }
        running = 'diskCleanupOptions';
        try {
            const V = await kit();
            // Disk Cleanup Options: Melaton keeps one user's files per computer, so both choices clean the same
            const go = await new Promise((resolve) => {
                const ctx = V.openDialog({
                    id: 'diskCleanupOptions', key: 'cleanmgr:1150', owner, icon: ICON16, captionIcon: true,
                    buttons: {
                        1152: (c) => { resolve(true); c.close(); },
                        1153: (c) => { resolve(true); c.close(); }
                    },
                    cancel: () => resolve(false)
                });
                if (!ctx) resolve(false);
            });
            if (!go) return;
            // the calculating box (Drive Selection is skipped with one drive, as on Vista)
            running = 'diskCleanupCalc';
            let cancelled = false;
            let calc = null;
            calc = V.openDialog({
                id: 'diskCleanupCalc', key: 'cleanmgr:102', owner, icon: ICON16, captionIcon: true,
                init: (c) => c.text(1005, 'Disk Cleanup is calculating how much space you will be able to free on  (C:). This may take a few minutes to complete.'),
                cancel: () => { cancelled = true; }
            });
            const bar = (pct) => {
                const f = calc && calc.holder(1006);
                const fill = f && f.querySelector('.vdt-progress-fill');
                if (fill) fill.style.setProperty('--vdt-progress', `${pct}%`);
            };
            let n = 0;
            const report = await measure((t) => { n += 1; bar(Math.min(95, n * 24)); if (calc) calc.text(1012, t); });
            bar(100);
            if (calc) calc.close();
            if (cancelled) return;
            running = 'diskCleanupMain';
            await mainSheet(V, owner, report);
        } catch (err) {
            console.error('[diskCleanup]', err);
        } finally {
            if (running !== 'diskCleanupMain') running = null;
        }
    }

    function mainSheet(V, owner, report) {
        return new Promise((resolve) => {
            const checked = new Set(GROUPS.filter((x) => x.checked && !x.fixed).map((x) => x.id));
            const total = () => GROUPS.filter((x) => checked.has(x.id)).reduce((n, x) => n + (Number(x.bytes(report)) || 0), 0);
            const free = GROUPS.filter((x) => !x.fixed).reduce((n, x) => n + (Number(x.bytes(report)) || 0), 0);
            let sel = GROUPS[0].id;
            const ctx = V.openSheet({
                id: 'diskCleanupMain', title: 'Disk Cleanup for  (C:)', owner, icon: ICON16, noApply: true,
                pages: [{ key: 'cleanmgr:101', title: 'Disk Cleanup' }, { key: 'cleanmgr:110', title: 'More Options' }],
                init(c) {
                    const P = 'cleanmgr:101';
                    const img = c.holder(1007, P);
                    // the drive's own picture (the VM draws (C:)'s system drive icon here)
                    if (img) img.innerHTML = '<img src="/static_images/vista-explorer/tree-drive-system-32.png" alt="" width="32" height="32" draggable="false">';
                    c.text(1001, `You can use Disk Cleanup to free up to ${size(free)} of disk space on  (C:).`, P);
                    c.text(1002, 'View Files', P);
                    c.enable(1002, false, P);
                    const lv = c.holder(1000, P);
                    const body = lv && lv.querySelector('.vdt-lv-body');
                    const describe = () => {
                        const g = GROUPS.find((x) => x.id === sel) || GROUPS[0];
                        let text = g.text;
                        if (g.id === 'system' && !report.system.known) text += ' (This browser does not report their size.)';
                        c.text(1003, text, P);
                        c.text(1026, size(total()), P);
                    };
                    if (body) {
                        body.innerHTML = GROUPS.map((g, i) => {
                            const id = `dclCheck${i}`;
                            const b = g.bytes(report);
                            const shown = g.id === 'system' && !report.system.known ? '' : size(b);
                            return `<div class="vdt-lv-row dcl-row${g.id === sel ? ' is-selected' : ''}" data-group="${g.id}" title="${esc(g.name)}"><span class="dcl-name"><span class="tbp-check"><input type="checkbox" id="${id}"${checked.has(g.id) ? ' checked' : ''}${g.fixed ? ' disabled' : ''}><label for="${id}"><span><img src="${g.icon}" alt="" width="16" height="16" draggable="false">${esc(g.name)}</span></label></span></span><span class="dcl-size">${esc(shown)}</span></div>`;
                        }).join('');
                        body.addEventListener('change', (ev) => {
                            const box = ev.target.closest('input[type="checkbox"]');
                            if (!box) return;
                            const row = box.closest('.dcl-row');
                            if (box.checked) checked.add(row.dataset.group); else checked.delete(row.dataset.group);
                            c.dirty();
                            describe();
                        });
                        lv.addEventListener('change', () => {
                            const row = lv.querySelector('.dcl-row.is-selected');
                            if (row) { sel = row.dataset.group; describe(); }
                        });
                    }
                    describe();
                    const help = c.page(P) && c.page(P).querySelector('[data-vdt-id="1137"] a, [data-vdt-id="1137"]');
                    if (help) help.addEventListener('click', (ev) => { ev.preventDefault(); if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('disk-cleanup'); });
                    // More Options: Programs and Features; Melaton keeps no restore points
                    const Q = 'cleanmgr:110';
                    const i1 = c.holder(1020, Q);
                    if (i1) i1.innerHTML = '<img src="/static_images/vista-cpl/items/programs-and-features-32.png" alt="" draggable="false">';
                    const i2 = c.holder(1028, Q);
                    if (i2) i2.innerHTML = '<img src="/static_images/vista-cpl/items/backup-and-restore-center-32.png" alt="" draggable="false">';
                    c.on(1025, 'click', () => { const cp = root.melatonControlPanel; if (cp) cp.doAction('page:programs'); }, Q);
                    c.enable(1030, false, Q);
                },
                async apply() {
                    const list = GROUPS.filter((g) => checked.has(g.id) && !g.fixed);
                    if (!list.length) return true;
                    const sure = typeof root.showConfirmationDialog === 'function'
                        ? await root.showConfirmationDialog('Are you sure you want to permanently delete these files?', [{ text: 'Delete Files', value: true }, { text: 'Cancel', value: false }], null, { title: 'Disk Cleanup', icon: 'fas fa-question-circle' })
                        : true;
                    if (!sure) return false;
                    await cleanUp(V, owner, list);
                    return true;
                },
                close() { running = null; resolve(); }
            });
            if (!ctx) { running = null; resolve(); return; }
            // the boxes ticked by default are deletions to make: OK runs them as Vista's does
            setTimeout(() => { if (checked.size) ctx.dirty(); }, 0);
        });
    }

    async function cleanUp(V, owner, list) {
        let stop = false;
        const box = V.openDialog({
            id: 'diskCleanupRun', key: 'cleanmgr:106', owner, icon: ICON16, captionIcon: true,
            init: (c) => c.text(1008, 'Cleaning up drive  (C:).'),
            cancel: () => { stop = true; }
        });
        for (let i = 0; i < list.length && !stop; i += 1) {
            if (box) {
                box.text(1011, list[i].name);
                const f = box.holder(1009);
                const fill = f && f.querySelector('.vdt-progress-fill');
                if (fill) fill.style.setProperty('--vdt-progress', `${Math.round((i / list.length) * 100)}%`);
            }
            await clear(list[i].id);
        }
        if (box) box.close();
    }

    root.melatonStorage = { measure, clear, size };
    root.openDiskCleanup = openDiskCleanup;
})(typeof window !== 'undefined' ? window : globalThis);
