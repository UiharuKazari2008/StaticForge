/**
 * Data Management (Yozora #828): the MMC snap-in that replaced the Data Management DSAP on the Vista
 * desktop (dsap://data.dreamscape.jp/ opens it there; phones and Windows Classic keep the DSAP page,
 * public/scripts/comp/dataManagementDsapApplet.js). Laid out like Computer Management:
 *
 *   Data Management (Local)   the console root: its items, as Computer Management lists its own
 *     Account                 NovelAI account standing, Anlas, subscription, Opus usage, ban notice
 *     Storage                 Generations by Workspace and the server's Storage Breakdown
 *       Workspaces            Disk Management: the volume list (a workspace is a volume), a splitter,
 *                             the graphical view (one disk per workspace, its volume bar coloured by
 *                             kind, hatched when selected) and the legend
 *     Remote Workers          the remote services' health (remote_workers_status), Refresh per row / all
 *     Favorites               favorite tags and text expanders, Remove
 *     Spellbook / Expanders   open the Spellbook and Expanders managers
 *     Replication             the replication pages (status, configuration, upsert, sync, separation
 *       ...                   setup, progress) hosted in the result pane; their driver is the DSAP's
 *
 * Workspace commands are workspaceUtils.js's (showAddWorkspaceModal, editWorkspaceSettings,
 * showRenameWorkspaceModal, showDumpWorkspaceModal, confirmDeleteWorkspace, reorderWorkspaces,
 * setActiveWorkspace); disk usage is get_system_info's workspace list. The refresh hooks
 * workspaceUtils / textReplacementManager / accountDataBootstrap call (dataMgmtDsapRefresh*IfPresent
 * in dataManagementDsapApplet.js) call mmcDataManagement.refresh(kind) too.
 *
 *   window.openDataManagementConsole(node?)   node: a node id below, or an old DSAP tab id
 */
(function (root) {
    'use strict';

    const ID = 'dataManagement';
    const TITLE = 'Data Management';
    const EXP = '/static_images/vista-explorer';
    const CPL = '/static_images/vista-cpl';
    const ITEMS = `${CPL}/items`;
    const VI = '/static_images/vista-icons';
    const APPS = '/static_images/app_icons';
    const DEV = '/static_images/vista-devmgr';
    const ICON16 = `${EXP}/drive-system-16.png`;
    const ICON32 = `${EXP}/tree-drive-system-32.png`;
    const DISK16 = `${DEV}/disk-drives-16.png`;
    const ISPY_URL = 'dsap://ispy.dreamscape.jp/';

    const REPL_SUBS = [
        ['configuration', 'Configuration', `${ITEMS}/administrative-tools-16.png`],
        ['upsert', 'Upsert Cargo', `${ITEMS}/backup-and-restore-center-16.png`],
        ['sync', 'Sync from Master', `${ITEMS}/sync-center-16.png`],
        ['setup', 'Separation Setup', `${ITEMS}/programs-and-features-16.png`],
        ['progress', 'Operation Progress', `${ITEMS}/performance-information-and-tools-16.png`]
    ];

    const WORKER_ORDER = ['ruiko', 'grimoire-browser', 'replication-master', 'novelai', 'claude-xi'];
    const WORKER_STATUS = {
        healthy: ['Healthy', `${VI}/check-16.png`],
        degraded: ['Degraded', `${VI}/warning-16.png`],
        offline: ['Offline', `${VI}/error-16.png`],
        unconfigured: ['Not configured', `${VI}/info-16.png`]
    };

    // the graphical view's kinds, Disk Management's legend colours
    const KINDS = {
        empty: ['Empty workspace', '#000000'],
        active: ['Active workspace', '#000080'],
        ws: ['Workspace', '#0000ff']
    };

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const has = (name) => typeof root[name] === 'function';
    const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

    const state = {
        sys: null,          // get_system_info's data
        sysError: '',
        sysLoading: false,
        sysTimer: null,
        workers: [],
        workersBusy: new Set(),
        workersError: '',
        workersLoaded: false,
        favLoaded: false,
        replLoading: false,
        replError: '',
        replHtml: null      // { sub, html }: the hosted replication page, built once per visit
    };

    let current = null; // the open console

    async function send(type, data) {
        const client = root.wsClient;
        if (!client || typeof client.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        return client.sendMessage(type, data || {}, false);
    }

    /** Disk Management's sizes: 64.00 GB, 200 MB. */
    function dmSize(b) {
        const n = Number(b) || 0;
        if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
        if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
        if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
        if (n >= 1024) return `${Math.round(n / 1024)} KB`;
        return `${n} bytes`;
    }

    /** "12.34 GB" (the server's strings) to bytes. */
    function parseSize(s) {
        const m = /([\d.,]+)\s*(TB|GB|MB|KB|B)/i.exec(String(s || ''));
        if (!m) return 0;
        const v = parseFloat(m[1].replace(/,/g, ''));
        const mul = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[m[2].toUpperCase()] || 1;
        return Number.isFinite(v) ? v * mul : 0;
    }

    const isDesktop = () => {
        const b = root.document && root.document.body;
        return !!b && b.classList.contains('desktop-mode') && !b.classList.contains('windows-classic-theme');
    };

    // ---- data ---------------------------------------------------------------------------------

    function wsMap() {
        try { if (typeof workspaces !== 'undefined' && workspaces) return workspaces; } catch (_) { /* not loaded */ }
        return root.workspaces || {};
    }

    function activeId() {
        try { if (typeof activeWorkspace !== 'undefined') return activeWorkspace; } catch (_) { /* not loaded */ }
        return root.activeWorkspace || null;
    }

    /** The workspaces in their order, with get_system_info's counts and disk usage when read. */
    function wsRows() {
        const sysById = new Map(((state.sys && state.sys.workspaces) || []).map((w) => [w.workspaceId, w]));
        const act = activeId();
        return Object.values(wsMap()).filter((w) => w && w.id)
            .sort((a, b) => (a.sort || 0) - (b.sort || 0))
            .map((w, index) => {
                const s = sysById.get(w.id);
                const isDefault = !!w.isDefault || w.id === 'default';
                const generations = s ? Number(s.images) || 0 : Number(w.fileCount) || 0;
                const bytes = s ? (Number(s.diskUsageBytes) || parseSize(s.diskUsage)) : null;
                const active = w.id === act;
                const kind = active ? 'active' : generations ? 'ws' : 'empty';
                const parts = [];
                if (active) parts.push('Active');
                if (isDefault) parts.push('Default');
                if (!generations) parts.push('Empty');
                return {
                    id: w.id,
                    name: w.name || w.id,
                    color: w.color || '#102040',
                    nicknames: Array.isArray(w.nicknames) ? w.nicknames.filter(Boolean) : [],
                    index,
                    isDefault,
                    active,
                    kind,
                    generations,
                    references: s ? Number(s.references) || 0 : Number(w.cacheFileCount) || 0,
                    notes: s ? Number(s.notes) || 0 : null,
                    bytes,
                    status: `Healthy${parts.length ? ` (${parts.join(', ')})` : ''}`
                };
            });
    }

    function sysTotalBytes(rows) {
        return rows.reduce((sum, r) => sum + (Number(r.bytes) || 0), 0);
    }

    async function loadSys(c) {
        if (state.sysLoading) return;
        state.sysLoading = true;
        try {
            if (!root.wsClient || (typeof root.wsClient.isConnected === 'function' && !root.wsClient.isConnected())) throw new Error('Melaton is not connected to the server.');
            const res = await root.wsClient.sendMessage('get_system_info', {});
            state.sys = (res && res.data) || res || null;
            state.sysError = '';
        } catch (err) {
            state.sysError = (err && err.message) || 'The server did not answer.';
        } finally {
            state.sysLoading = false;
        }
        if (c) c.refresh();
    }

    function loadSysSoon() {
        clearTimeout(state.sysTimer);
        state.sysTimer = setTimeout(() => { if (current) void loadSys(current); }, 1500);
    }

    function mergeWorkers(incoming) {
        const byId = new Map(state.workers.map((w) => [w.id, w]));
        (incoming || []).forEach((w) => { if (w && w.id) byId.set(w.id, w); });
        const known = WORKER_ORDER.filter((id) => byId.has(id)).map((id) => byId.get(id));
        const extra = [...byId.values()].filter((w) => !WORKER_ORDER.includes(w.id));
        state.workers = known.concat(extra);
    }

    async function loadWorkers(c, workerId) {
        const key = workerId || '*';
        if (state.workersBusy.has(key)) return;
        state.workersBusy.add(key);
        if (c) c.refresh();
        try {
            const res = await send('remote_workers_status', workerId ? { workerId } : {});
            const data = res && Array.isArray(res.workers) ? res : ((res && res.data) || {});
            mergeWorkers(data.workers || []);
            state.workersError = state.workers.length ? '' : (data.error || '');
        } catch (err) {
            if (!state.workers.length) state.workersError = (err && err.message) || 'The remote workers could not be checked.';
        } finally {
            state.workersBusy.delete(key);
            state.workersLoaded = true;
        }
        if (c) {
            c.refresh();
            if (workerId) c.note(`${(state.workers.find((w) => w.id === workerId) || {}).name || workerId} was checked.`);
        }
    }

    async function loadFavorites(c) {
        if (has('loadFavorites')) {
            try { await root.loadFavorites(); } catch (_) { /* the list shows what is there */ }
        }
        state.favLoaded = true;
        if (c) c.refresh();
    }

    function favRows() {
        let fav = { tags: [], textReplacements: [] };
        try { if (typeof favoritesData !== 'undefined' && favoritesData) fav = favoritesData; } catch (_) { /* not loaded */ }
        const out = [];
        (fav.tags || []).forEach((t, i) => out.push({
            key: `tags:${i}`, type: 'tags', index: i, kind: 'Tag', name: t.name || '',
            detail: t.name !== t.description ? (t.description || '') : ''
        }));
        (fav.textReplacements || []).forEach((t, i) => out.push({
            key: `textReplacements:${i}`, type: 'textReplacements', index: i, kind: 'Text expander',
            name: `!${t.placeholder || ''}`, detail: t.replacementValue || ''
        }));
        return out;
    }

    const drv = () => (typeof dataMgmtDsapDriver !== 'undefined' ? dataMgmtDsapDriver : null);
    const replStatus = () => (drv() && drv()._replicationStatus) || null;
    const replReady = () => has('dataMgmtDsapReplicationBuildPageHtml') && has('dataMgmtDsapReplicationWirePage');

    async function loadRepl(c) {
        if (state.replLoading || !has('dataMgmtDsapReplicationFetchStatus')) return;
        state.replLoading = true;
        try {
            const s = await root.dataMgmtDsapReplicationFetchStatus();
            if (drv()) drv()._replicationStatus = s;
            state.replError = '';
        } catch (err) {
            state.replError = (err && err.message) || 'Replication status unavailable.';
        } finally {
            state.replLoading = false;
        }
        if (c) c.refresh();
    }

    // ---- the console tree ---------------------------------------------------------------------

    function nodes() {
        return [{
            id: 'root',
            name: `${TITLE} (Local)`,
            icon: ICON16,
            children: [
                { id: 'account', name: 'Account', icon: `${ITEMS}/user-accounts-16.png`, desc: 'NovelAI account standing, Anlas and subscription' },
                {
                    id: 'storage', name: 'Storage', icon: `${DEV}/storage-controllers-16.png`, desc: 'Generations by workspace and the server\'s storage',
                    children: [{ id: 'workspaces', name: 'Workspaces', icon: DISK16, desc: 'Create, change, order and remove workspaces' }]
                },
                { id: 'workers', name: 'Remote Workers', icon: `${CPL}/network-16.png`, desc: 'The remote services Dreamscape uses' },
                { id: 'favorites', name: 'Favorites', icon: `${APPS}/vista-favorites.png`, desc: 'Favorite tags and text expanders' },
                { id: 'spellbook', name: 'Spellbook', icon: `${APPS}/presetbook.png`, desc: 'Presets and spells' },
                { id: 'expanders', name: 'Expanders', icon: `${APPS}/expanders.png`, desc: 'Global text expanders' },
                {
                    id: 'replication', name: 'Replication', icon: `${ITEMS}/sync-center-16.png`, desc: 'Replication status, cargo, sync and separation',
                    children: REPL_SUBS.map(([id, name, icon]) => ({ id: `repl-${id}`, name, icon }))
                }
            ]
        }];
    }

    // ---- pages ----------------------------------------------------------------------------------

    function rootPage(c) {
        const kids = nodes()[0].children;
        const cols = [
            { t: 'Name', w: 180, key: 'name', text: (d) => d.name },
            { t: 'Description', w: 300, key: 'desc', text: (d) => d.desc || '' }
        ];
        return { html: c.listView(cols, kids.map((n) => ({ data: n, icon: n.icon, open: n.id }))), list: true };
    }

    function accountPage(c) {
        const od = root.optionsData || {};
        const user = od.user || null;
        const balance = od.balance || null;
        const usable = !od.accountDataDeferred && od.userDataValid !== false;
        const userOk = usable && has('dataMgmtDsapIsUserDataValid') && root.dataMgmtDsapIsUserDataValid(user);
        const balOk = usable && has('dataMgmtDsapIsBalanceDataValid') && root.dataMgmtDsapIsBalanceDataValid(balance, user);
        const standing = has('dataMgmtDsapResolveAccountStanding') ? root.dataMgmtDsapResolveAccountStanding(user, balance, od) : { label: 'Unknown', tone: 'warn' };
        standing.label = String(standing.label || '');
        standing.label = standing.label.charAt(0).toUpperCase() + standing.label.slice(1);
        const cell = (field) => (has('dataMgmtDsapFormatBalanceCell') ? root.dataMgmtDsapFormatBalanceCell(balance, field, balOk) : '-');
        const tier = userOk && user && user.subscription && user.subscription.tier !== undefined && has('dataMgmtDsapFormatTierLabel')
            ? root.dataMgmtDsapFormatTierLabel(user.subscription.tier) : 'Not available';
        const identity = has('dataMgmtDsapResolveAccountIdentity') ? root.dataMgmtDsapResolveAccountIdentity(user) : '';
        let renews = 'Not available';
        if (userOk && user.subscription && user.subscription.expiresAt && has('getSubscriptionRenewalDisplayData')) {
            const r = root.getSubscriptionRenewalDisplayData(user.subscription.expiresAt);
            renews = `${esc(r.renewalDateTimeStr)}${r.timeRemaining ? ` <span class="mmc-hint">(${esc(r.timeRemaining)})</span>` : ''}`;
        }
        const ban = has('dataMgmtDsapResolveBanMessage') ? root.dataMgmtDsapResolveBanMessage(user, od) : '';
        let usage = null;
        try { usage = root.usageToolManager && typeof root.usageToolManager.getSnapshot === 'function' ? root.usageToolManager.getSnapshot() : null; } catch (_) { usage = null; }
        if (!usage) { try { usage = typeof usageToolManager !== 'undefined' ? usageToolManager.getSnapshot() : null; } catch (_) { usage = null; } }
        const sections = [
            { id: 'dm-acct-status', title: 'Account Status', body: c.props([
                ['Standing', c.state(standing.tone === 'ok', standing.label, standing.tone !== 'error') + (standing.detail ? ` <span class="mmc-hint">${esc(standing.detail)}</span>` : '')],
                ['Account', esc(identity && identity !== '\u2014' ? identity : 'Not available')],
                ['Subscription', esc(tier === '\u2014' ? 'Not available' : tier)],
                ['Renews', renews]
            ]) },
            { id: 'dm-acct-anlas', title: 'Anlas', body: c.props([
                ['Fixed Anlas', esc(cell('fixedTrainingStepsLeft'))],
                ['Paid Anlas', esc(cell('purchasedTrainingSteps'))],
                ['Total Anlas', `<b>${esc(cell('totalCredits'))}</b>`]
            ]) }
        ];
        if (usage && usage.isOpus) {
            const left = usage.remaining != null ? ` (${usage.remaining === 'Free' ? 'Free' : `~${usage.remaining}`} left)` : '';
            const text = usage.extended ? `Extended free +${usage.extraPercent}%${left}` : `${usage.compactLabel || ''}${left}`;
            const pct = usage.showBar ? Math.max(0, Math.min(100, Number(usage.barPercent) || 0)) : 0;
            sections.push({ id: 'dm-acct-opus', title: 'Opus Usage', body: `${c.props([['Usage', esc(text)]])}
                <div class="mmc-progress dm-usage${usage.high ? ' is-high' : ''}"><div role="progressbar" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div><span>${pct}%</span></div>` });
        }
        if (ban) {
            sections.push({ id: 'dm-acct-ban', title: 'Ban Notice', body: `<p>${c.state(false, 'This account has a ban notice.')}</p><div class="dm-ban">${esc(ban)}</div>` });
        }
        return c.page('Account', standing.label, sections);
    }

    function storagePage(c) {
        const rows = wsRows();
        const sys = state.sys;
        const reading = !sys && !state.sysError;
        const total = rows.reduce((s, r) => s + r.generations, 0);
        const genCols = [
            { t: 'Workspace', w: 170, key: 'name', text: (d) => d.name, html: (d) => `<span class="dm-swatch" style="background:${esc(d.color)}"></span><i>${esc(d.name)}</i>` },
            { t: 'Generations', w: 90, num: true, key: 'gen', value: (d) => d.generations, text: (d) => num(d.generations) },
            { t: 'Share', w: 150, key: 'share', value: (d) => d.generations, text: (d) => '', html: (d) => {
                const p = total ? (d.generations / total) * 100 : 0;
                return `<span class="dm-share"><span style="width:${p.toFixed(1)}%;background:${esc(d.color)}"></span></span><i>${p.toFixed(1)}%</i>`;
            } }
        ];
        const genList = c.listView(genCols, rows.filter((r) => r.generations > 0).map((r) => ({ key: r.id, data: r })), { sortId: 'dm-gen', sort: { key: 'gen', dir: -1 }, empty: 'No workspace generations yet.' });
        const usage = sys && sys.usage;
        const breakdown = usage ? [
            ['Workspaces', usage.workspaceImages],
            ['Previews', usage.previewImages],
            ['References', usage.referenceItems],
            ['Databases', usage.databases],
            ['Wiki Files', usage.wikiFiles]
        ].filter(([, v]) => v).map(([label, v]) => ({ label, bytes: parseSize(v) })) : [];
        const usedBytes = breakdown.reduce((s, r) => s + r.bytes, 0);
        const bCols = [
            { t: 'Category', w: 170, key: 'label', text: (d) => d.label },
            { t: 'Size', w: 90, num: true, key: 'size', value: (d) => d.bytes, text: (d) => dmSize(d.bytes) },
            { t: '% of Total', w: 80, num: true, key: 'pct', value: (d) => d.bytes, text: (d) => (usedBytes ? `${Math.round((d.bytes / usedBytes) * 100)} %` : '') }
        ];
        const bList = c.listView(bCols, breakdown.map((r) => ({ data: r })), { empty: usage ? 'No storage data available.' : 'The storage breakdown is not available.' });
        const wait = '<p>Reading data, please wait...</p>';
        const err = state.sysError ? `<p>${c.state(false, `System information could not be read. ${state.sysError}`)}</p>` : '';
        return c.page('Storage', reading ? 'Reading data, please wait...' : (usedBytes ? `${dmSize(usedBytes)} used` : ''), [
            { id: 'dm-st-summary', title: 'Summary', body: err || (reading ? wait : c.props([
                ['Workspaces', `${num(rows.length)} <span class="mmc-link" data-act="nav:workspaces">Manage workspaces</span>`],
                ['Generations', num(total)],
                ['Workspace images', dmSize(sysTotalBytes(rows))],
                ['Total on the server', dmSize(usedBytes)]
            ])) },
            { id: 'dm-st-gen', title: 'Generations by Workspace', body: reading ? wait : genList },
            { id: 'dm-st-break', title: 'Storage Breakdown', body: reading ? wait : bList }
        ]);
    }

    /** Disk Management: the volume list, the splitter, the graphical view and its legend. */
    function workspacesPage(c) {
        const rows = wsRows();
        const total = sysTotalBytes(rows);
        const sizeText = (r) => (r.bytes == null ? (state.sysError ? 'Unknown' : 'Reading...') : dmSize(r.bytes));
        const cols = [
            { t: 'Volume', w: 150, key: 'name', text: (d) => d.name, html: (d) => `<span class="dm-swatch" style="background:${esc(d.color)}"></span><i>${esc(d.name)}</i>` },
            { t: 'Layout', w: 64, key: 'layout', text: (d) => (d.isDefault ? 'Default' : 'Simple') },
            { t: 'Generations', w: 78, num: true, key: 'gen', value: (d) => d.generations, text: (d) => num(d.generations) },
            { t: 'References', w: 74, num: true, key: 'ref', value: (d) => d.references, text: (d) => num(d.references) },
            { t: 'Notes', w: 50, num: true, key: 'notes', value: (d) => d.notes || 0, text: (d) => (d.notes == null ? '' : num(d.notes)) },
            { t: 'Status', w: 170, key: 'status', text: (d) => d.status },
            { t: 'Disk Usage', w: 76, num: true, key: 'size', value: (d) => d.bytes || 0, text: sizeText },
            { t: '% of Total', w: 68, num: true, key: 'pct', value: (d) => d.bytes || 0, text: (d) => (d.bytes != null && total ? `${Math.round((d.bytes / total) * 100)} %` : '') },
            { t: 'Order', w: 46, num: true, key: 'order', value: (d) => d.index, text: (d) => String(d.index + 1) }
        ];
        const list = c.listView(cols, rows.map((r) => ({ key: r.id, data: r })), { sortId: 'dm-vol', sort: { key: 'order', dir: 1 }, empty: 'No workspaces configured.' });
        const disks = rows.map((r) => {
            const sel = String(c.sel) === String(r.id);
            const line2 = [r.bytes == null ? sizeText(r) : dmSize(r.bytes), `${num(r.generations)} generation${r.generations === 1 ? '' : 's'}`].join(' ');
            const tip = `${r.name}\n${line2}\n${r.status}${r.nicknames.length ? `\nAlso called: ${r.nicknames.join(', ')}` : ''}`;
            return `<div class="dm-disk" data-ws="${esc(r.id)}">
                <div class="dm-disk-label"><b><img src="${DISK16}" alt="">Disk ${r.index}</b><span>${r.isDefault ? 'Default' : 'Basic'}</span><span>${esc(sizeText(r))}</span><span>Online</span></div>
                <div class="dm-disk-area"><div class="dm-part is-${r.kind}${sel ? ' is-selected' : ''}" data-ws="${esc(r.id)}" title="${esc(tip)}">
                    <div class="dm-part-strip"></div>
                    <div class="dm-part-body"><b><span class="dm-swatch" style="background:${esc(r.color)}"></span>${esc(r.name)}</b><span>${esc(line2)}</span><span>${esc(r.status)}</span></div>
                </div></div>
            </div>`;
        }).join('');
        const legend = Object.values(KINDS).map(([label, color]) => `<span><span class="dm-key" style="background:${color}"></span>${esc(label)}</span>`).join('');
        const html = `<div class="dm-vol">${list}</div><div class="dm-hsplit" title=""></div>
            <div class="dm-graph"><div class="dm-map" data-mmc-scroll>${disks || '<div class="mmc-empty">No workspaces configured.</div>'}</div><div class="dm-legend">${legend}</div></div>`;
        return {
            html,
            list: true,
            split: true,
            mount: (pane) => {
                const vol = pane.querySelector('.dm-vol');
                const h = Number(c.reg('VolumeListHeight', 0)) || 0;
                if (vol && h) vol.style.height = `${h}px`;
                wireHSplit(pane, c);
            }
        };
    }

    /** The splitter between the volume list and the graphical view (Disk Management's). */
    function wireHSplit(pane, c) {
        const split = pane.querySelector('.dm-hsplit');
        const vol = pane.querySelector('.dm-vol');
        if (!split || !vol) return;
        split.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            split.setPointerCapture(ev.pointerId);
            const y0 = ev.clientY;
            const h0 = vol.getBoundingClientRect().height;
            const max = Math.max(80, pane.getBoundingClientRect().height - 110);
            const move = (e) => { vol.style.height = `${Math.max(60, Math.min(max, Math.round(h0 + e.clientY - y0)))}px`; };
            const up = () => {
                split.removeEventListener('pointermove', move);
                split.removeEventListener('pointerup', up);
                c.setReg({ VolumeListHeight: Math.round(vol.getBoundingClientRect().height) });
            };
            split.addEventListener('pointermove', move);
            split.addEventListener('pointerup', up);
        });
    }

    function markPartitions(c) {
        const pane = c.el('.mmc-result');
        if (!pane) return;
        let hit = null;
        pane.querySelectorAll('.dm-part').forEach((p) => {
            const on = String(p.dataset.ws) === String(c.sel);
            p.classList.toggle('is-selected', on);
            if (on) hit = p;
        });
        if (hit) hit.closest('.dm-disk').scrollIntoView({ block: 'nearest' });
    }

    function workersPage(c) {
        const busyAll = state.workersBusy.has('*');
        const cols = [
            { t: 'Service', w: 160, key: 'name', text: (d) => d.name || d.id },
            { t: 'Status', w: 110, key: 'status', text: (d) => ((busyAll || state.workersBusy.has(d.id)) ? 'Checking...' : (WORKER_STATUS[d.status] || WORKER_STATUS.offline)[0]) },
            { t: 'Host', w: 190, key: 'host', text: (d) => d.host || '' },
            { t: 'Last Check', w: 140, key: 'checked', value: (d) => (d.checkedAt ? new Date(d.checkedAt).getTime() || 0 : 0), text: (d) => root.mmcConsole.when(d.checkedAt) },
            { t: 'Latency', w: 70, num: true, key: 'latency', value: (d) => Number(d.latencyMs) || 0, text: (d) => (d.latencyMs == null || !Number.isFinite(Number(d.latencyMs)) ? '' : `${Math.round(Number(d.latencyMs))} ms`) },
            { t: 'Details', w: 220, key: 'detail', text: (d) => d.detail || '' }
        ];
        let empty = 'There are no remote workers.';
        if (!state.workersLoaded) empty = 'Checking remote workers, please wait...';
        else if (state.workersError) empty = state.workersError;
        const rows = state.workers.map((w) => ({ key: w.id, data: w, icon: (WORKER_STATUS[w.status] || WORKER_STATUS.offline)[1] }));
        return { html: c.listView(cols, rows, { sortId: 'dm-workers', empty }), list: true };
    }

    function favoritesPage(c) {
        const cols = [
            { t: 'Name', w: 180, key: 'name', text: (d) => d.name },
            { t: 'Type', w: 100, key: 'kind', text: (d) => d.kind },
            { t: 'Details', w: 320, key: 'detail', text: (d) => d.detail }
        ];
        const rows = favRows().map((f) => ({ key: f.key, data: f, icon: f.type === 'tags' ? `${EXP}/fav-searches.png` : `${VI}/explorer/text-16.png` }));
        const empty = state.favLoaded ? 'No favorites yet. Add tags and text expanders from elsewhere in Melaton.' : 'Reading data, please wait...';
        return { html: c.listView(cols, rows, { sortId: 'dm-fav', empty }), list: true };
    }

    function launcherPage(c, node) {
        const isSpell = node.id === 'spellbook';
        return c.page(node.name, '', [{
            id: `dm-${node.id}`, title: node.name, body: `${c.overview(isSpell ? `${APPS}/presetbook.png` : `${APPS}/expanders.png`, isSpell
                ? ['Spellbook keeps your presets: saved prompts, settings and their spells. Open it to add, change, sort and remove presets.']
                : ['Expanders are the global text expanders: a short !placeholder in a prompt is replaced with its text when you generate. Open Expanders to add, change and remove them.'])}
                <div class="mmc-buttons"><button type="button" class="btn-standard" data-act="${isSpell ? 'open-spellbook' : 'open-expanders'}">${isSpell ? 'Open Spellbook' : 'Open Expanders'}</button></div>`
        }]);
    }

    function replSub(nodeId) {
        return nodeId === 'replication' ? 'home' : nodeId.replace(/^repl-/, '');
    }

    function replPage(c, node) {
        const sub = replSub(node.id);
        const label = sub === 'home' ? 'Replication' : (REPL_SUBS.find((s) => s[0] === sub) || [0, node.name])[1];
        if (!replReady()) {
            return c.page(label, '', [{ id: 'dm-repl-na', title: label, body: `<p>${c.state(false, 'Replication could not be loaded.')}</p>` }]);
        }
        const status = replStatus();
        if (!status) {
            if (!state.replLoading && !state.replError) void loadRepl(c);
            const body = state.replError ? `<p>${c.state(false, `Replication status could not be read. ${state.replError}`)}</p>` : '<p>Reading data, please wait...</p>';
            return c.page(label, state.replError ? '' : 'Reading data, please wait...', [{ id: 'dm-repl-load', title: label, body }]);
        }
        if (!state.replHtml || state.replHtml.sub !== sub) {
            const side = `${status.role || 'standalone'}${status.maintenance && status.maintenance.active ? ' - maintenance' : ''}`;
            state.replHtml = {
                sub,
                html: `<div class="mmc-page-title"><b>${esc(label)}</b><span>Role: ${esc(side)}</span></div>
                    <div class="mmc-page-body dm-repl" data-mmc-scroll data-repl-sub="${esc(sub)}">${root.dataMgmtDsapReplicationBuildPageHtml(sub, status)}</div>`
            };
        }
        return { html: state.replHtml.html, mount: (pane) => mountRepl(pane, c, sub), unmount: () => unmountRepl() };
    }

    // ---- the hosted replication pages -------------------------------------------------------------

    let repl = null; // { host, body, listeners, observer }

    /** The DSAP host the replication driver expects, for a page in this console. */
    function replHost(c, sub, body, listeners) {
        return {
            url: `dsap://data.dreamscape.jp/replication${sub === 'home' ? '' : `/${sub}`}`,
            getRoot: () => body,
            getPathSegments: () => (sub === 'home' ? ['replication'] : ['replication', sub]),
            getQueryParam: () => null,
            getWsClient: () => root.wsClient || null,
            navigate: (url) => { navigateUrl(c, url); return true; },
            refresh: () => c.refresh(),
            showToast: (kind, title, message) => toast(c, kind, message || title),
            on: (name, fn) => {
                const ws = root.wsClient;
                if (!ws || typeof ws.on !== 'function') return;
                ws.on(name, fn);
                listeners.push(() => { if (typeof ws.off === 'function') ws.off(name, fn); });
            },
            registerContextMenuItems: () => () => {},
            registerContextMenuAction: () => () => {},
            clearContextMenuItems: () => {}
        };
    }

    /** The replication pages' controls in Vista's look: push buttons, no Font Awesome glyphs. */
    function vistaize(el) {
        if (!el || el.nodeType !== 1) return;
        const list = el.matches && el.matches('.dsap-smf-btn') ? [el] : [];
        el.querySelectorAll('.dsap-smf-btn').forEach((b) => list.push(b));
        list.forEach((b) => {
            b.classList.add('btn-standard');
            if (b.querySelector('.fa-caret-down') && !b.querySelector('.dm-caret')) b.insertAdjacentHTML('beforeend', '<span class="dm-caret"></span>');
        });
        el.querySelectorAll('i[class*="fa-"], i.fas, i.far, i.fal, i.mdi').forEach((i) => i.remove());
        // embedded DSAP panels (the separation bootstrap) bring the SMF skin's root class: not here
        const roots = el.matches && el.matches('.dsap-smf') ? [el] : [];
        el.querySelectorAll('.dsap-smf').forEach((r) => roots.push(r));
        roots.forEach((r) => r.classList.remove('dsap-smf', 'dsap-root'));
    }

    function mountRepl(pane, c, sub) {
        unmountRepl();
        const body = pane.querySelector('.dm-repl');
        if (!body) return;
        const listeners = [];
        const host = replHost(c, sub, body, listeners);
        const observer = new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => vistaize(n))));
        observer.observe(body, { childList: true, subtree: true });
        vistaize(body);
        repl = { host, body, listeners, observer };
        const d = drv();
        if (d) { d._host = host; d._replWired = false; }
        try { root.dataMgmtDsapReplicationWirePage(body, host, sub); } catch (err) { console.error(`${TITLE}: replication page`, err); }
    }

    function unmountRepl() {
        const r = repl;
        repl = null;
        if (!r) return;
        try {
            call('dataMgmtDsapReplicationUnwireNav', r.body);
            call('dataMgmtDsapReplicationDetachMenus', r.body);
            call('dataMgmtDsapReplicationTeardownPanels', r.body);
        } catch (err) { console.error(`${TITLE}: replication teardown`, err); }
        r.listeners.forEach((off) => { try { off(); } catch (_) { /* gone */ } });
        r.observer.disconnect();
        const d = drv();
        if (d) {
            if (d._host === r.host) d._host = null;
            d._replWired = false;
        }
    }

    /** host.showToast in the console: good news in the status bar, problems in a message box. */
    function toast(c, kind, text) {
        if (!text) return;
        if (kind === 'error' || kind === 'warning') void c.box(`<p>${esc(text)}</p>`, null, { icon: kind === 'error' ? 'error' : 'warning' });
        else c.note(String(text));
    }

    /** An old dsap://data.dreamscape.jp/... address (or a tab id) to a node of this console. */
    function nodeFor(target) {
        let t = String(target || '').trim();
        if (!t) return 'root';
        if (nodeIds().has(t)) return t;
        t = t.replace(/^dsap:\/\//i, '').replace(/^data\.dreamscape\.jp\/?/i, '').split('?')[0];
        const parts = t.split('/').filter(Boolean);
        const first = parts[0] || 'status';
        if (first === 'replication') {
            const sub = parts[1] === 'bundle' ? 'setup' : parts[1];
            return sub && REPL_SUBS.some((s) => s[0] === sub) ? `repl-${sub}` : 'replication';
        }
        const map = { status: 'root', workspaces: 'workspaces', favorites: 'favorites', spellbook: 'spellbook', expanders: 'expanders', account: 'account', storage: 'storage', workers: 'workers' };
        return map[first] || 'root';
    }

    function nodeIds() {
        const out = new Set();
        const walk = (list) => list.forEach((n) => { out.add(n.id); if (n.children) walk(n.children); });
        walk(nodes());
        return out;
    }

    function navigateUrl(c, url) {
        const u = String(url || '');
        if (/ispy\.dreamscape\.jp/i.test(u)) { openSearch(); return; }
        if (/^dsap:\/\//i.test(u) && !/data\.dreamscape\.jp/i.test(u)) { call('openDsapInGrimoire', u); return; }
        c.select(nodeFor(u), true);
    }

    function openSearch() {
        if (has('openImageSearch')) { root.openImageSearch(); return; }
        call('openDsapInGrimoire', ISPY_URL);
    }

    // ---- commands -------------------------------------------------------------------------------

    function replCommands() {
        const s = replStatus() || {};
        const role = s.role || 'standalone';
        const childish = role === 'child' || role === 'ephemeral';
        const blocked = has('dataMgmtDsapReplicationBulkTransferBlocked') ? root.dataMgmtDsapReplicationBulkTransferBlocked(s) : false;
        return [
            { text: 'Configuration', action: 'nav:repl-configuration' },
            { text: 'Upsert Cargo...', action: 'nav:repl-upsert', disabled: role === 'master' || (childish && blocked) },
            { text: 'Sync from Master...', action: 'nav:repl-sync', disabled: role !== 'child' || blocked },
            { text: 'Separation Setup...', action: 'nav:repl-setup' },
            { text: 'Operation Progress', action: 'nav:repl-progress' }
        ];
    }

    function commands(node) {
        switch (node.id) {
            case 'root':
            case 'storage':
                return [
                    { text: 'New Workspace...', action: 'ws-new' },
                    { text: 'Search Images...', action: 'search' }
                ];
            case 'workspaces':
                return [
                    { text: 'New Workspace...', action: 'ws-new' },
                    { text: 'Search Images...', action: 'search' }
                ];
            case 'workers':
                return []; // the shell's Refresh checks every worker
            case 'favorites':
                return [{ text: 'Open Expanders...', action: 'open-expanders' }];
            case 'spellbook':
                return [{ text: 'Open Spellbook...', action: 'open-spellbook' }];
            case 'expanders':
                return [{ text: 'Open Expanders...', action: 'open-expanders' }];
            case 'replication':
                return replCommands();
            default:
                return node.id.startsWith('repl-') ? [{ text: 'Replication Home', action: 'nav:replication' }] : [];
        }
    }

    function selCommands(node, key) {
        if (node.id === 'workspaces' || node.id === 'storage') {
            const rows = wsRows();
            const r = rows.find((x) => String(x.id) === String(key));
            if (!r) return null;
            return {
                title: r.name,
                items: [
                    { text: 'Set as Active', action: 'ws-activate', disabled: r.active },
                    { text: 'Properties...', action: 'ws-props', icon: 8 },
                    { text: 'Rename...', action: 'ws-rename' },
                    { text: 'Dump Workspace...', action: 'ws-dump', disabled: r.isDefault },
                    { text: 'Delete Workspace...', action: 'ws-delete', icon: 11, disabled: r.isDefault },
                    { separator: true },
                    { text: 'Move Up', action: 'ws-up', disabled: r.index === 0 },
                    { text: 'Move Down', action: 'ws-down', disabled: r.index === rows.length - 1 },
                    { separator: true },
                    { text: 'Copy Workspace ID', action: 'ws-copy', icon: 6 }
                ]
            };
        }
        if (node.id === 'workers') {
            const w = state.workers.find((x) => x.id === key);
            if (!w) return null;
            return { title: w.name || w.id, items: [{ text: 'Refresh', action: 'worker-refresh', icon: 3, disabled: state.workersBusy.has('*') || state.workersBusy.has(w.id) }] };
        }
        if (node.id === 'favorites') {
            const f = favRows().find((x) => x.key === key);
            if (!f) return null;
            return { title: f.name, items: [
                { text: 'Remove from Favorites', action: 'fav-remove', icon: 11 },
                { text: 'Copy Name', action: 'fav-copy', icon: 6 }
            ] };
        }
        return null;
    }

    function toolbar(node, c) {
        if (node.id === 'root') return [];
        if (node.id === 'workspaces') {
            const r = c.sel ? wsRows().find((x) => String(x.id) === String(c.sel)) : null;
            return [
                { id: 'refresh', i: 3, title: 'Refresh' },
                { id: 'ws-props', i: 8, title: 'Properties', disabled: !r },
                { id: 'ws-delete', i: 11, title: 'Delete', disabled: !r || r.isDefault }
            ];
        }
        if (node.id === 'favorites') return [{ id: 'refresh', i: 3, title: 'Refresh' }, { id: 'fav-remove', i: 11, title: 'Remove from Favorites', disabled: !c.sel }];
        return [{ id: 'refresh', i: 3, title: 'Refresh' }];
    }

    async function copyText(c, text, what) {
        if (!text) return;
        try {
            if (has('copyTextToClipboard')) await root.copyTextToClipboard(text);
            else await navigator.clipboard.writeText(text);
            c.note(`${what} was copied to the Clipboard.`);
        } catch (_) {
            await c.box(`<p>${esc(what)} could not be copied to the Clipboard.</p>`, null, { icon: 'error' });
        }
    }

    async function moveWorkspace(c, id, by) {
        const rows = wsRows();
        const i = rows.findIndex((r) => r.id === id);
        const j = i + by;
        if (i < 0 || j < 0 || j >= rows.length) return;
        const order = rows.map((r) => r.id);
        [order[i], order[j]] = [order[j], order[i]];
        // the new order shows at once; the server's workspace update confirms it
        const map = wsMap();
        order.forEach((wid, k) => { if (map[wid]) map[wid].sort = k; });
        c.refresh();
        if (!has('reorderWorkspaces')) throw new Error('Workspaces cannot be reordered right now.');
        await root.reorderWorkspaces(order);
    }

    async function action(a, c) {
        const sel = c.sel;
        const ws = sel ? wsRows().find((r) => String(r.id) === String(sel)) : null;
        switch (a) {
            case 'refresh': {
                if (c.node === 'workers') { void loadWorkers(c); return true; }
                if (c.node === 'favorites') { void loadFavorites(c); return true; }
                if (c.node === 'replication' || c.node.startsWith('repl-')) {
                    if (repl && drv()) { await drv()._refreshReplication(repl.body, repl.host); c.refresh(); } else void loadRepl(c);
                    return true;
                }
                c.refresh();
                if (c.node !== 'account') void loadSys(c);
                return true;
            }
            case 'search': openSearch(); return true;
            case 'ws-new': call('showAddWorkspaceModal'); return true;
            case 'ws-props': if (ws) call('editWorkspaceSettings', ws.id); return true;
            case 'ws-rename': if (ws) { if (has('showRenameWorkspaceModal')) root.showRenameWorkspaceModal(ws.id); else call('editWorkspaceSettings', ws.id); } return true;
            case 'ws-dump': if (ws && !ws.isDefault) call('showDumpWorkspaceModal', ws.id, ws.name); return true;
            case 'ws-delete': if (ws && !ws.isDefault) call('confirmDeleteWorkspace', ws.id, ws.name); return true;
            case 'ws-activate':
                if (ws && !ws.active) {
                    c.note(`Switching to ${ws.name}...`);
                    await call('setActiveWorkspace', ws.id);
                    c.note('');
                    c.refresh();
                }
                return true;
            case 'ws-up': if (ws) await moveWorkspace(c, ws.id, -1); return true;
            case 'ws-down': if (ws) await moveWorkspace(c, ws.id, 1); return true;
            case 'ws-copy': if (ws) await copyText(c, ws.id, 'The workspace ID'); return true;
            case 'delete':
                if (c.node === 'workspaces' && ws && !ws.isDefault) call('confirmDeleteWorkspace', ws.id, ws.name);
                else if (c.node === 'favorites' && sel) await action('fav-remove', c);
                return true;
            case 'workers-all': void loadWorkers(c); return true;
            case 'worker-refresh': if (sel) void loadWorkers(c, sel); return true;
            case 'fav-remove': {
                const f = favRows().find((x) => x.key === sel);
                if (f && has('removeFavorite')) {
                    await root.removeFavorite(f.type, f.index);
                    c.sel = null;
                    c.refresh();
                }
                return true;
            }
            case 'fav-copy': {
                const f = favRows().find((x) => x.key === sel);
                if (f) await copyText(c, f.name, 'The name');
                return true;
            }
            case 'open-spellbook': call('showPresetManager'); return true;
            case 'open-expanders': call('showTextReplacementManager'); return true;
            case 'help': call('openHelpAndSupport', 'data-management'); return true;
            default: return false;
        }
    }

    function status(node) {
        switch (node.id) {
            case 'workspaces': {
                const rows = wsRows();
                if (state.sysLoading && !state.sys) return 'Reading data, please wait...';
                return `${rows.length} workspace${rows.length === 1 ? '' : 's'}${state.sys ? `, ${dmSize(sysTotalBytes(rows))}` : ''}`;
            }
            case 'storage': return state.sysError ? 'System information could not be read.' : (state.sys ? '' : 'Reading data, please wait...');
            case 'workers': {
                if (!state.workersLoaded || state.workersBusy.size) return 'Checking remote workers...';
                const ok = state.workers.filter((w) => w.status === 'healthy').length;
                return `${ok} of ${state.workers.length} healthy`;
            }
            case 'favorites': { const n = favRows().length; return `${n} favorite${n === 1 ? '' : 's'}`; }
            default: return '';
        }
    }

    // ---- the console ------------------------------------------------------------------------------

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: ICON16,
            icon32: ICON32,
            taskbarIcon: ICON32,
            treeWidth: 180,
            expanded: ['root', 'storage'],
            nodes,
            page: (node, c) => {
                switch (node.id) {
                    case 'account': return accountPage(c);
                    case 'storage': return storagePage(c);
                    case 'workspaces': return workspacesPage(c);
                    case 'workers': return workersPage(c);
                    case 'favorites': return favoritesPage(c);
                    case 'spellbook':
                    case 'expanders': return launcherPage(c, node);
                    case 'root': return rootPage(c);
                    default: return replPage(c, node);
                }
            },
            commands,
            selCommands,
            toolbar,
            action,
            rowOpen: (key, node, c) => {
                if (node.id === 'workspaces') void action('ws-props', c);
                else if (node.id === 'workers') void action('worker-refresh', c);
            },
            onSelectRow: (key, node, c) => { if (node.id === 'workspaces') { markPartitions(c); c.renderToolbar(); } else if (node.id === 'favorites') c.renderToolbar(); },
            status,
            about: { version: '1.0.0', lines: ['Data Management keeps Dreamscape\'s workspaces, account, storage, favorites and replication.'] },
            onOpen: (c) => {
                current = c;
                const pane = c.el('.mmc-result');
                // a partition in the graphical view picks its volume like a row of the list
                const pick = (ev) => {
                    const p = ev.target.closest('.dm-part[data-ws]');
                    if (!p) return false;
                    c.selectRow(p.dataset.ws);
                    return true;
                };
                pane.addEventListener('click', pick);
                pane.addEventListener('mousedown', (ev) => { if (ev.button === 2) pick(ev); });
                pane.addEventListener('dblclick', (ev) => { if (pick(ev)) void action('ws-props', c); });
                // the selection follows the node: Workspaces and Storage share it
                const select = c.select.bind(c);
                c.select = (id, record) => {
                    if (id !== c.node) {
                        state.replHtml = null;
                        if (id === 'workers' && !state.workersLoaded) void loadWorkers(c);
                        if (id === 'favorites' && !state.favLoaded) void loadFavorites(c);
                    }
                    select(id, record);
                };
                void loadSys(c);
                if (c.node === 'workers') void loadWorkers(c);
                if (c.node === 'favorites') void loadFavorites(c);
            },
            onClose: () => {
                unmountRepl();
                state.replHtml = null;
                current = null;
                clearTimeout(state.sysTimer);
            }
        };
    }

    /** The DSAP's own scripts: the replication pages and the account helpers live there. */
    async function ensureAssets() {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!replReady() && has('resolveDsap') && has('ensureDsapEntryReady')) {
            const m = root.resolveDsap('dsap://data.dreamscape.jp/');
            if (m && m.entry) {
                try { await root.ensureDsapEntryReady(m.entry); } catch (err) { console.error(`${TITLE}: DSAP scripts`, err); }
            }
        }
    }

    async function openDataManagementConsole(node) {
        await ensureAssets();
        if (!root.mmcConsole) return null;
        const target = node ? nodeFor(node) : null;
        return root.mmcConsole.open(def(), target ? { node: target } : {});
    }

    /** The refresh hooks: kind 'workspaces' | 'status' | 'favorites' | 'account' | 'usage' | 'replication'. */
    function refresh(kind) {
        const c = current;
        if (!c || !c.modal || !c.modal.isConnected) return;
        if (kind === 'status') { loadSysSoon(); return; }
        if ((kind === 'account' || kind === 'usage') && c.node !== 'account') return;
        if (kind === 'favorites') state.favLoaded = true;
        if (kind === 'workspaces' && c.sel && c.node === 'workspaces' && !wsRows().some((r) => String(r.id) === String(c.sel))) c.sel = null;
        c.refresh();
    }

    root.openDataManagementConsole = openDataManagementConsole;
    root.mmcDataManagement = { open: openDataManagementConsole, refresh, nodeFor, isDesktop, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
