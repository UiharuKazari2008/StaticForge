/**
 * Workspace dialogs on the desktop (Yozora #828): a workspace is a partition of the one disk Data
 * Management's Workspace Management draws, so its dialogs are Disk Management's. workspaceUtils.js
 * sends its desktop callers here (editWorkspaceSettings, showAddWorkspaceModal, showRenameWorkspaceModal,
 * showDumpWorkspaceModal, confirmDeleteWorkspace); phones keep the old panels.
 *
 *   workspaceDialogs.properties(id, { owner, sys, start })   <name> Properties: a property sheet
 *       General       the label (name), type, status, the workspace's share of the disk with the
 *                     shell's pie (shell32 dialog 1080, a drive's General page, measured on the VM)
 *                     and its generation / reference / note counts
 *       Customize     color, background color (the Color dialog), primary and text area fonts
 *       Nicknames     the other names Director and search know it by
 *   workspaceDialogs.create({ owner })              New Workspace
 *   workspaceDialogs.rename(id, { owner })          Rename Workspace
 *   workspaceDialogs.dump(id, { owner })            Dump Workspace (move every item to another one)
 *   workspaceDialogs.remove(id, { owner })          the Delete Workspace message box
 *   workspaceDialogs.reorder({ owner })             Reorder Partitions (Move Up / Move Down)
 *
 * Writes go through the server calls workspaceUtils.js uses (wsClient.updateWorkspaceSettings,
 * createWorkspace, renameWorkspace, dumpWorkspace, deleteWorkspace, reorderWorkspaces). Look:
 * public/css/workspace-dialogs.css.
 */
(function (root) {
    'use strict';

    const EXP = '/static_images/vista-explorer';
    const ICON16 = `${EXP}/drive-fixed-16.png`;
    const ICON32 = `${EXP}/drive-fixed-32.png`;
    const SYS16 = `${EXP}/drive-system-16.png`;
    const SYS32 = `${EXP}/tree-drive-system-32.png`;
    const F = ['MS Shell Dlg', 8];

    // Win32 styles
    const SS = 0x50020000;
    const SS_CENTER = 0x50020001;
    const SS_RIGHT = 0x50020002;
    const ETCHED = 0x50000010;
    const ICON = 0x50000003;
    const EDIT = 0x50010080;
    const PUSH = 0x50010000;
    const DEFPUSH = 0x50010001;
    const GROUP = 0x50000007;
    const DROPLIST = 0x50210003;
    const LISTBOX = 0x50a10101;
    const EDGE = 0x200;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const fn = (name) => (typeof root[name] === 'function' ? root[name] : null);
    const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

    /* global workspaces, activeWorkspace, AVAILABLE_PRIMARY_FONTS, AVAILABLE_TEXTAREA_FONTS */
    function wsMap() {
        try { if (typeof workspaces !== 'undefined' && workspaces) return workspaces; } catch (_) { /* not loaded */ }
        return root.workspaces || {};
    }
    function activeId() {
        try { if (typeof activeWorkspace !== 'undefined') return activeWorkspace; } catch (_) { /* not loaded */ }
        return root.activeWorkspace || null;
    }
    function fonts(kind) {
        try {
            if (kind === 'primary' && typeof AVAILABLE_PRIMARY_FONTS !== 'undefined') return AVAILABLE_PRIMARY_FONTS;
            if (kind === 'textarea' && typeof AVAILABLE_TEXTAREA_FONTS !== 'undefined') return AVAILABLE_TEXTAREA_FONTS;
        } catch (_) { /* not loaded */ }
        return [{ value: '', label: 'Default' }];
    }
    const ordered = () => Object.values(wsMap()).filter((w) => w && w.id).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const isDefault = (w) => !!(w && (w.isDefault || w.id === 'default'));
    const nameOf = (id) => { const w = wsMap()[id]; return (w && w.name) || id || 'workspace'; };

    /** Explorer's sizes: 28.4 GB. */
    function shortSize(b) {
        const n = Number(b) || 0;
        if (n < 1024) return `${n} bytes`;
        const u = ['KB', 'MB', 'GB', 'TB'];
        let v = n / 1024;
        let i = 0;
        while (v >= 1000 && i < u.length - 1) { v /= 1024; i += 1; }
        return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`;
    }
    const bytes = (n) => `${num(n)} bytes`;

    function parseSize(s) {
        const m = /([\d.,]+)\s*(TB|GB|MB|KB|B)/i.exec(String(s || ''));
        if (!m) return 0;
        const v = parseFloat(m[1].replace(/,/g, ''));
        const mul = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[m[2].toUpperCase()] || 1;
        return Number.isFinite(v) ? v * mul : 0;
    }

    function api() {
        const a = root.vistaDialogTemplate;
        if (!a || typeof a.openSheet !== 'function') throw new Error('The dialog could not be shown.');
        return a;
    }

    const connected = () => !!(root.wsClient && (typeof root.wsClient.isConnected !== 'function' || root.wsClient.isConnected()));

    function messageBox(html, buttons, opts) {
        const show = fn('showConfirmationDialog');
        if (!show) return Promise.resolve(false);
        const icons = { info: 'fas fa-circle-info', warning: 'fas fa-triangle-exclamation', error: 'fas fa-circle-xmark', question: 'fas fa-question-circle' };
        const o = Object.assign({ title: 'Data Management', width: 400 }, opts || {});
        o.icon = icons[o.icon || 'info'] || o.icon;
        return show(html, buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, o);
    }
    const errorBox = (text, title) => messageBox(`<p>${esc(text)}</p>`, null, { icon: 'error', title: title || 'Data Management' });

    /** The data views and the desktop that show workspaces, after a change. */
    async function afterChange(reload) {
        if (reload && fn('loadWorkspaces')) { try { await root.loadWorkspaces(); } catch (_) { /* the update push follows */ } }
        if (fn('refreshWorkspaceManagementListsIfPresent')) root.refreshWorkspaceManagementListsIfPresent();
        if (fn('refreshExplorerWorkspacesListIfOpen')) root.refreshExplorerWorkspacesListIfOpen();
        if (root.mmcDataManagement && typeof root.mmcDataManagement.refresh === 'function') root.mmcDataManagement.refresh('workspaces');
    }

    function dlgError(ctx, id, text) {
        ctx.html(id, text ? `<span class="wsd-error"><img src="/static_images/vista-icons/error-16.png" alt="">${esc(text)}</span>` : '');
    }

    const swatch = (color) => `<span class="wsd-swatch" style="background:${esc(color)}"></span>`;

    /** A color row: the swatch and Change... (Vista's Color dialog); keeps the value in ctx.store. */
    function colorRow(ctx, key, swatchId, buttonId, title, page) {
        const paint = () => ctx.html(swatchId, swatch(ctx.store[key]), page);
        paint();
        ctx.on(buttonId, 'click', async () => {
            const a = api();
            const picked = await a.chooseColor({ id: `wsdColor_${key}`, owner: ctx.modal, color: ctx.store[key], title, custom: ctx.store.custom, onCustom: (list) => { ctx.store.custom = list; } });
            if (!picked || picked.toLowerCase() === String(ctx.store[key]).toLowerCase()) return;
            ctx.store[key] = picked;
            paint();
            ctx.dirty();
        }, page);
    }

    // ---- the shell's pie (the drive's General page) ---------------------------------------------

    /** 123x63 px: a 3-D ellipse, blue for the workspace from 9 o'clock clockwise, magenta for the rest. */
    function pie(frac) {
        const W = 123;
        const cx = 61.5;
        const cy = 22.5;
        const rx = 60;
        const ry = 21.5;
        const depth = 16;
        const f = Math.max(0, Math.min(1, Number(frac) || 0));
        const P = (t, dy = 0) => `${(cx + rx * Math.cos(t)).toFixed(2)},${(cy + ry * Math.sin(t) + dy).toFixed(2)}`;
        const arc = (a0, a1, dy = 0) => {
            const pts = [];
            const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 90)));
            for (let i = 0; i <= steps; i += 1) pts.push(P(a0 + ((a1 - a0) * i) / steps, dy));
            return pts;
        };
        const start = Math.PI;
        const slices = [
            { a0: start, a1: start + f * 2 * Math.PI, top: '#0000ff', side: '#00009c' },
            { a0: start + f * 2 * Math.PI, a1: start + 2 * Math.PI, top: '#ff00ff', side: '#9c009c' }
        ].filter((s) => s.a1 - s.a0 > 1e-6);
        let sides = '';
        let tops = '';
        slices.forEach((s) => {
            // the front wall: the part of the slice in the lower half (0..pi, y down), in each turn
            [[0, Math.PI], [2 * Math.PI, 3 * Math.PI]].forEach(([lo, hi]) => {
                const a = Math.max(s.a0, lo);
                const b = Math.min(s.a1, hi);
                if (b - a <= 1e-6) return;
                sides += `<polygon points="${arc(a, b).concat(arc(b, a, depth)).join(' ')}" fill="${s.side}"/>`;
            });
            const full = s.a1 - s.a0 >= 2 * Math.PI - 1e-6;
            tops += full
                ? `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${s.top}"/>`
                : `<polygon points="${cx},${cy} ${arc(s.a0, s.a1).join(' ')}" fill="${s.top}"/>`;
        });
        const outline = `<path d="M${P(0)} L${P(0, depth)} M${P(Math.PI)} L${P(Math.PI, depth)}" stroke="#000" stroke-width="1" fill="none"/>
            <path d="M${arc(0, Math.PI, depth).join(' L')}" stroke="#000" stroke-width="1" fill="none"/>
            <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="#000" stroke-width="1" fill="none"/>`;
        return `<svg class="wsd-pie" width="${W}" height="63" viewBox="0 0 ${W} 63" aria-hidden="true">${sides}${tops}${outline}</svg>`;
    }

    // ---- templates (dialog units, MS Shell Dlg 8) -------------------------------------------------

    const TPL = {
        // shell32 1080 (a drive's General page), the counts in place of its two check boxes
        general: { t: 'General', w: 227, h: 218, f: F, s: 0, c: [
            [10, 'S', 7, 7, 21, 20, ICON, '', 0],
            [11, 'E', 56, 11, 164, 14, EDIT, '', EDGE],
            [12, 'S', 7, 32, 213, 1, ETCHED, '', 0],
            [13, 'S', 7, 38, 42, 9, SS, 'Type:', 0], [14, 'S', 56, 38, 164, 9, SS, '', 0],
            [15, 'S', 7, 51, 42, 9, SS, 'Status:', 0], [16, 'S', 56, 51, 164, 9, SS, '', 0],
            [17, 'S', 7, 64, 213, 1, ETCHED, '', 0],
            [18, 'S', 7, 69, 10, 9, SS, '', 0],
            [19, 'S', 21, 69, 64, 9, SS, 'This workspace:', 0],
            [20, 'S', 86, 69, 80, 9, SS_RIGHT, 'working...', 0], [21, 'S', 170, 69, 43, 9, SS_RIGHT, '', 0],
            [22, 'S', 7, 82, 10, 9, SS, '', 0],
            [23, 'S', 21, 82, 64, 9, SS, 'Other workspaces:', 0],
            [24, 'S', 86, 82, 80, 9, SS_RIGHT, 'working...', 0], [25, 'S', 170, 82, 43, 9, SS_RIGHT, '', 0],
            [26, 'S', 7, 97, 213, 1, ETCHED, '', 0],
            [27, 'S', 21, 103, 64, 10, SS, 'Capacity:', 0],
            [28, 'S', 86, 103, 80, 9, SS_RIGHT, 'working...', 0], [29, 'S', 170, 103, 43, 9, SS_RIGHT, '', 0],
            [30, 'S', 68, 116, 82, 39, SS, '', 0],
            [31, 'S', 38, 160, 150, 10, SS_CENTER, '', 0],
            [32, 'S', 7, 171, 213, 1, ETCHED, '', 0],
            [33, 'S', 7, 179, 60, 9, SS, 'Generations:', 0], [34, 'S', 70, 179, 150, 9, SS, '', 0],
            [35, 'S', 7, 192, 60, 9, SS, 'References:', 0], [36, 'S', 70, 192, 150, 9, SS, '', 0],
            [37, 'S', 7, 205, 60, 9, SS, 'Notes:', 0], [38, 'S', 70, 205, 150, 9, SS, '', 0]
        ] },
        customize: { t: 'Customize', w: 227, h: 218, f: F, s: 0, c: [
            [40, 'B', 7, 7, 213, 62, GROUP, 'Colors', 0],
            [41, 'S', 16, 23, 72, 8, SS, 'Workspace &color:', 0],
            [42, 'S', 92, 21, 30, 12, SS, '', 0],
            [43, 'B', 128, 20, 50, 14, PUSH, 'C&hange...', 0],
            [44, 'S', 16, 45, 72, 8, SS, '&Background color:', 0],
            [45, 'S', 92, 43, 30, 12, SS, '', 0],
            [46, 'B', 128, 42, 50, 14, PUSH, 'Cha&nge...', 0],
            [50, 'B', 7, 76, 213, 58, GROUP, 'Fonts', 0],
            [51, 'S', 16, 93, 72, 8, SS, '&Primary font:', 0],
            [52, 'C', 92, 91, 120, 160, DROPLIST, '', 0],
            [53, 'S', 16, 113, 72, 8, SS, '&Text area font:', 0],
            [54, 'C', 92, 111, 120, 160, DROPLIST, '', 0]
        ] },
        nicknames: { t: 'Nicknames', w: 227, h: 218, f: F, s: 0, c: [
            [60, 'S', 7, 7, 150, 8, SS, '&Nicknames:', 0],
            [61, 'L', 7, 18, 155, 130, LISTBOX, '', EDGE],
            [62, 'B', 166, 18, 54, 14, PUSH, '&Remove', 0],
            [63, 'S', 7, 156, 150, 8, SS, 'N&ew nickname:', 0],
            [64, 'E', 7, 167, 155, 14, EDIT, '', EDGE],
            [65, 'B', 166, 167, 54, 14, PUSH, '&Add', 0]
        ] },
        create: { t: 'New Workspace', w: 222, h: 112, f: F, s: 0, c: [
            [101, 'S', 7, 9, 64, 8, SS, '&Name:', 0], [102, 'E', 74, 7, 141, 14, EDIT, '', EDGE],
            [103, 'S', 7, 29, 64, 8, SS, '&Color:', 0], [104, 'S', 74, 27, 30, 12, SS, '', 0], [105, 'B', 110, 26, 50, 14, PUSH, 'C&hange...', 0],
            [106, 'S', 7, 49, 64, 8, SS, '&Background color:', 0], [107, 'S', 74, 47, 30, 12, SS, '', 0], [108, 'B', 110, 46, 50, 14, PUSH, 'Cha&nge...', 0],
            [109, 'S', 7, 69, 64, 8, SS, 'Nic&knames:', 0], [110, 'E', 74, 67, 141, 14, EDIT, '', EDGE],
            [111, 'S', 7, 89, 100, 18, SS, '', 0],
            [1, 'B', 111, 91, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 165, 91, 50, 14, PUSH, 'Cancel', 0]
        ] },
        rename: { t: 'Rename Workspace', w: 202, h: 62, f: F, s: 0, c: [
            [101, 'S', 7, 9, 40, 8, SS, '&Name:', 0], [102, 'E', 50, 7, 145, 14, EDIT, '', EDGE],
            [103, 'S', 7, 30, 82, 24, SS, '', 0],
            [1, 'B', 91, 41, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 145, 41, 50, 14, PUSH, 'Cancel', 0]
        ] },
        dump: { t: 'Dump Workspace', w: 222, h: 80, f: F, s: 0, c: [
            [101, 'S', 7, 7, 208, 18, SS, '', 0],
            [102, 'C', 7, 28, 208, 140, DROPLIST, '', 0],
            [1, 'B', 111, 59, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 165, 59, 50, 14, PUSH, 'Cancel', 0]
        ] },
        reorder: { t: 'Reorder Partitions', w: 222, h: 170, f: F, s: 0, c: [
            [101, 'S', 7, 7, 150, 8, SS, '&Partitions:', 0],
            [102, 'L', 7, 18, 151, 124, LISTBOX, '', EDGE],
            [103, 'B', 165, 18, 50, 14, PUSH, 'Move &Up', 0],
            [104, 'B', 165, 36, 50, 14, PUSH, 'Move &Down', 0],
            [1, 'B', 111, 149, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 165, 149, 50, 14, PUSH, 'Cancel', 0]
        ] }
    };

    // ---- Properties ------------------------------------------------------------------------------

    const sheets = new Map(); // workspace id -> the open sheet's ctx

    async function readSys() {
        if (!connected()) return null;
        try {
            const res = await root.wsClient.sendMessage('get_system_info', {});
            return (res && res.data) || res || null;
        } catch (_) { return null; }
    }

    function usageOf(sys, id) {
        const list = (sys && Array.isArray(sys.workspaces)) ? sys.workspaces : [];
        const size = (w) => Number(w.diskUsageBytes) || parseSize(w.diskUsage);
        const mine = list.find((w) => w.workspaceId === id) || null;
        const total = list.reduce((s, w) => s + size(w), 0);
        return {
            known: list.length > 0,
            mine: mine ? size(mine) : 0,
            total,
            images: mine ? Number(mine.images) || 0 : null,
            references: mine ? Number(mine.references) || 0 : null,
            notes: mine && mine.notes != null ? Number(mine.notes) || 0 : null
        };
    }

    function paintUsage(ctx, w, sys) {
        const P = 'wsd:general';
        const u = usageOf(sys, w.id);
        if (!u.known) {
            ['20', '24', '28'].forEach((id) => ctx.text(Number(id), sys === undefined ? 'working...' : 'Unknown', P));
            [21, 25, 29].forEach((id) => ctx.text(id, '', P));
        } else {
            const others = Math.max(0, u.total - u.mine);
            ctx.text(20, bytes(u.mine), P); ctx.text(21, shortSize(u.mine), P);
            ctx.text(24, bytes(others), P); ctx.text(25, shortSize(others), P);
            ctx.text(28, bytes(u.total), P); ctx.text(29, shortSize(u.total), P);
            ctx.html(30, pie(u.total ? u.mine / u.total : 0), P);
        }
        const gen = u.images != null ? u.images : Number(w.fileCount) || 0;
        const refs = u.references != null ? u.references : Number(w.cacheFileCount) || 0;
        ctx.text(34, num(gen), P);
        ctx.text(36, num(refs), P);
        ctx.text(38, u.notes != null ? num(u.notes) : (u.known ? '0' : ''), P);
    }

    function properties(id, opts = {}) {
        const w0 = wsMap()[id];
        if (!w0) { void errorBox('The workspace could not be found. It may have been deleted.'); return null; }
        const have = sheets.get(id);
        if (have && have.modal && have.modal.isConnected) {
            if (fn('bringModalToFront')) root.bringModalToFront(have.modal);
            if (opts.start) have.selectPage(`wsd:${opts.start}`);
            return have;
        }
        const a = api();
        const active = id === activeId();
        const P = 'wsd:general';
        const C = 'wsd:customize';
        const N = 'wsd:nicknames';
        const ctx = a.openSheet({
            id: `workspaceProperties_${String(id).replace(/[^a-z0-9_-]/gi, '_')}`,
            title: `${w0.name || id} Properties`,
            icon: active ? SYS16 : ICON16,
            owner: opts.owner,
            start: opts.start ? `wsd:${opts.start}` : undefined,
            pages: [
                { key: P, tpl: TPL.general, overrides: { 10: { image: active ? SYS32 : ICON32 } } },
                { key: C, tpl: TPL.customize },
                { key: N, tpl: TPL.nicknames }
            ],
            init: (c) => {
                const w = wsMap()[id] || w0;
                c.store.color = w.color || '#102040';
                c.store.backgroundColor = w.backgroundColor || '#0a1a2a';
                c.store.nicknames = Array.isArray(w.nicknames) ? w.nicknames.filter(Boolean).slice() : [];
                // General
                c.set(11, w.name || '', P);
                const parts = [];
                if (active) parts.push('Active');
                if (isDefault(w)) parts.push('Default');
                c.text(14, isDefault(w) ? 'Default workspace' : 'Workspace', P);
                c.text(16, `Healthy${parts.length ? ` (${parts.join(', ')})` : ''}`, P);
                c.html(18, '<span class="wsd-key is-used"></span>', P);
                c.html(22, '<span class="wsd-key is-free"></span>', P);
                c.text(31, `Disk 0, partition ${ordered().findIndex((x) => x.id === id) + 1}`, P);
                paintUsage(c, w, opts.sys === undefined ? undefined : opts.sys);
                if (opts.sys === undefined) void readSys().then((sys) => { if (c.modal && c.modal.isConnected) paintUsage(c, wsMap()[id] || w, sys); });
                // Customize
                colorRow(c, 'color', 42, 43, 'Workspace Color', C);
                colorRow(c, 'backgroundColor', 45, 46, 'Background Color', C);
                c.options(52, fonts('primary').map((o) => ({ value: o.value || '', text: o.label || o.value || 'Default' })), w.primaryFont || '', C);
                c.options(54, fonts('textarea').map((o) => ({ value: o.value || '', text: o.label || o.value || 'Default' })), w.textareaFont || '', C);
                // Nicknames
                const list = c.el(61, N);
                const paintNicks = (pick) => {
                    c.options(61, c.store.nicknames.map((n, i) => ({ value: String(i), text: n })), pick != null && pick >= 0 && pick < c.store.nicknames.length ? String(pick) : undefined, N);
                    c.enable(62, list.querySelector('.is-selected') !== null, N);
                };
                const add = () => {
                    const nick = String(c.get(64, N) || '').trim().replace(/\s+/g, ' ');
                    if (!nick) return;
                    if (!c.store.nicknames.some((n) => n.toLowerCase() === nick.toLowerCase())) c.store.nicknames.push(nick);
                    c.set(64, '', N);
                    paintNicks(c.store.nicknames.length - 1);
                    c.dirty();
                };
                paintNicks();
                list.addEventListener('change', (ev) => { ev.stopPropagation(); paintNicks(Number(c.get(61, N))); });
                c.on(62, 'click', () => {
                    const i = Number(c.get(61, N));
                    if (!Number.isInteger(i) || i < 0 || !list.querySelector('.is-selected')) return;
                    c.store.nicknames.splice(i, 1);
                    paintNicks(Math.min(i, c.store.nicknames.length - 1));
                    c.dirty();
                }, N);
                c.on(65, 'click', add, N);
                c.el(64, N).addEventListener('keydown', (ev) => {
                    if (ev.key !== 'Enter') return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    add();
                });
                c.el(64, N).addEventListener('input', (ev) => ev.stopPropagation());
            },
            apply: async (c) => {
                const w = wsMap()[id];
                if (!w) throw new Error('The workspace no longer exists.');
                const name = String(c.get(11, P) || '').trim() || w.name || id;
                const pending = String(c.get(64, N) || '').trim().replace(/\s+/g, ' ');
                if (pending && !c.store.nicknames.some((n) => n.toLowerCase() === pending.toLowerCase())) c.store.nicknames.push(pending);
                const settings = {
                    name,
                    color: c.store.color,
                    backgroundColor: c.store.backgroundColor || null,
                    primaryFont: c.get(52, C) || null,
                    textareaFont: c.get(54, C) || null,
                    wallpaper: w.wallpaper || null,
                    wallpaperPosition: w.wallpaperPosition || null,
                    nicknames: c.store.nicknames.slice()
                };
                if (!connected() || typeof root.wsClient.updateWorkspaceSettings !== 'function') {
                    await errorBox('Melaton is not connected to the server. The changes were not saved.');
                    return;
                }
                try {
                    await root.wsClient.updateWorkspaceSettings(id, settings);
                } catch (err) {
                    await errorBox(`The changes could not be saved. ${(err && err.message) || ''}`.trim());
                    return;
                }
                Object.assign(w, settings);
                await afterChange(true);
                if (id === activeId() && fn('switchWorkspaceTheme')) root.switchWorkspaceTheme(id);
                const t = c.modal && c.modal.querySelector('.modal-window-title-main span');
                if (t) t.textContent = `${name} Properties`;
                if (c.modal) c.modal.setAttribute('aria-label', `${name} Properties`);
            },
            close: () => { sheets.delete(id); }
        });
        if (ctx) sheets.set(id, ctx);
        return ctx;
    }

    // ---- New / Rename / Dump / Delete / Reorder ---------------------------------------------------

    function create(opts = {}) {
        const a = api();
        return a.openDialog({
            id: 'workspaceNewDialog',
            tpl: TPL.create,
            owner: opts.owner,
            focusFirst: true,
            init: (c) => {
                c.store.color = '#102040';
                c.store.backgroundColor = '#0a1a2a';
                colorRow(c, 'color', 104, 105, 'Workspace Color');
                colorRow(c, 'backgroundColor', 107, 108, 'Background Color');
            },
            ok: async (c) => {
                const name = String(c.get(102) || '').trim();
                if (!name) { dlgError(c, 111, 'Type a name.'); return false; }
                if (!connected()) { dlgError(c, 111, 'Melaton is not connected to the server.'); return false; }
                const nicknames = String(c.get(110) || '').split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
                const act = wsMap()[activeId()] || {};
                let res;
                try {
                    res = fn('createWorkspace') ? await root.createWorkspace(name) : await root.wsClient.createWorkspace(name);
                } catch (_) {
                    return true; // createWorkspace reported it
                }
                const newId = res && (res.id || (res.workspace && res.workspace.id));
                if (newId && typeof root.wsClient.updateWorkspaceSettings === 'function') {
                    try {
                        await root.wsClient.updateWorkspaceSettings(newId, {
                            name,
                            color: c.store.color,
                            backgroundColor: c.store.backgroundColor || null,
                            primaryFont: act.primaryFont || null,
                            textareaFont: act.textareaFont || null,
                            wallpaper: null,
                            wallpaperPosition: null,
                            nicknames
                        });
                    } catch (err) {
                        void errorBox(`The workspace was created, but its settings could not be saved. ${(err && err.message) || ''}`.trim());
                    }
                }
                await afterChange(true);
                return true;
            }
        });
    }

    function rename(id, opts = {}) {
        const w = wsMap()[id];
        if (!w) return null;
        const a = api();
        return a.openDialog({
            id: 'workspaceRenameDialog',
            tpl: TPL.rename,
            owner: opts.owner,
            focusFirst: true,
            init: (c) => { c.set(102, w.name || ''); },
            ok: async (c) => {
                const name = String(c.get(102) || '').trim();
                if (!name) { dlgError(c, 103, 'Type a name.'); return false; }
                if (name === w.name) return true;
                if (!connected()) { dlgError(c, 103, 'Melaton is not connected.'); return false; }
                try {
                    // the default workspace keeps its id; its name is a setting like the others'
                    if (isDefault(w) || !fn('renameWorkspace')) await root.wsClient.updateWorkspaceSettings(id, Object.assign({}, settingsOf(w), { name }));
                    else await root.renameWorkspace(id, name);
                } catch (err) {
                    void errorBox(`The workspace could not be renamed. ${(err && err.message) || ''}`.trim());
                    return true;
                }
                w.name = name;
                await afterChange(true);
                return true;
            }
        });
    }

    const settingsOf = (w) => ({
        name: w.name, color: w.color || '#102040', backgroundColor: w.backgroundColor || null, primaryFont: w.primaryFont || null,
        textareaFont: w.textareaFont || null, wallpaper: w.wallpaper || null, wallpaperPosition: w.wallpaperPosition || null,
        nicknames: Array.isArray(w.nicknames) ? w.nicknames.slice() : []
    });

    function dump(id, opts = {}) {
        const w = wsMap()[id];
        if (!w) return null;
        const targets = ordered().filter((x) => x.id !== id);
        if (!targets.length) { void errorBox('There is no other workspace to move the items to.', 'Dump Workspace'); return null; }
        const a = api();
        return a.openDialog({
            id: 'workspaceDumpDialog',
            tpl: TPL.dump,
            owner: opts.owner,
            init: (c) => {
                c.text(101, `Move every item in ${w.name || id} to:`);
                c.options(102, targets.map((x) => ({ value: x.id, text: x.name || x.id })), (targets.find(isDefault) || targets[0]).id);
            },
            ok: async (c) => {
                const target = c.get(102);
                if (!target) return false;
                if (!connected()) { void errorBox('Melaton is not connected to the server.', 'Dump Workspace'); return true; }
                if (fn('dumpWorkspace')) await root.dumpWorkspace(id, target);
                else await root.wsClient.dumpWorkspace(id, target);
                await afterChange(false);
                return true;
            }
        });
    }

    async function remove(id, opts = {}) {
        const w = wsMap()[id];
        if (!w || isDefault(w)) return false;
        const yes = await messageBox(
            `<p>All items in ${esc(w.name || id)} will be moved to the Default workspace, and the workspace will be deleted.</p><p>Do you want to continue?</p>`,
            [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }],
            { icon: 'warning', title: 'Delete Workspace' }
        );
        if (yes !== true) return false;
        if (!connected()) { await errorBox('Melaton is not connected to the server.', 'Delete Workspace'); return false; }
        if (fn('deleteWorkspace')) await root.deleteWorkspace(id);
        else await root.wsClient.deleteWorkspace(id);
        const s = sheets.get(id);
        if (s) s.close();
        await afterChange(false);
        return true;
    }

    function reorder(opts = {}) {
        const a = api();
        return a.openDialog({
            id: 'workspaceReorderDialog',
            tpl: TPL.reorder,
            owner: opts.owner,
            init: (c) => {
                c.store.order = ordered().map((w) => w.id);
                const box = c.el(102);
                const paint = (pick) => {
                    c.options(102, c.store.order.map((wid, i) => ({ value: wid, text: `${i + 1}  ${nameOf(wid)}` })), pick || undefined);
                    const i = pick ? c.store.order.indexOf(pick) : -1;
                    c.enable(103, i > 0);
                    c.enable(104, i >= 0 && i < c.store.order.length - 1);
                    const row = box.querySelector('.is-selected');
                    if (row) row.scrollIntoView({ block: 'nearest' });
                };
                const move = (by) => {
                    const wid = c.get(102);
                    const i = c.store.order.indexOf(wid);
                    const j = i + by;
                    if (i < 0 || j < 0 || j >= c.store.order.length) return;
                    [c.store.order[i], c.store.order[j]] = [c.store.order[j], c.store.order[i]];
                    paint(wid);
                };
                paint(opts.select || null);
                box.addEventListener('change', () => paint(c.get(102)));
                box.addEventListener('keydown', (ev) => {
                    if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
                    ev.preventDefault();
                    move(ev.key === 'ArrowUp' ? -1 : 1);
                });
                c.on(103, 'click', () => move(-1));
                c.on(104, 'click', () => move(1));
            },
            ok: async (c) => {
                const order = c.store.order;
                const before = ordered().map((w) => w.id);
                if (order.join('\n') === before.join('\n')) return true;
                if (!connected()) { void errorBox('Melaton is not connected to the server.', 'Reorder Partitions'); return true; }
                // the new order shows at once; the server's workspace update confirms it
                const map = wsMap();
                order.forEach((wid, k) => { if (map[wid]) map[wid].sort = k; });
                if (fn('reorderWorkspaces')) await root.reorderWorkspaces(order);
                else await root.wsClient.reorderWorkspaces(order);
                await afterChange(false);
                return true;
            }
        });
    }

    root.workspaceDialogs = { properties, create, rename, dump, remove, reorder, pie, _tpl: TPL };
})(typeof window !== 'undefined' ? window : globalThis);
