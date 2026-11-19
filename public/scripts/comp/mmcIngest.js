/**
 * Ingest Controller (Yukimi, Nov 19 2026): the MMC snap-in for the pipeline between the places mail and texts
 * arrive and Yukimi's inboxes (modules/ingestController.js; docs/client-api/ingest-controller.md). A role in
 * Server Manager (mmcServerManager.js ROLES), hosted like Exchange; administrators only.
 *
 *   Ingest Controller            Overview: pipeline health, accounts per mode, recent activity
 *     Accounts                   every account; E-mail / Exchange / Text Messages below. Mode (bypass / process),
 *       E-mail, Exchange,        dry-run or applying, and each account's pipeline flow (the modules that run,
 *       Text Messages            in order). Properties: General (mode, applying) and Pipeline (order, on / off)
 *     Modules                    the module catalog; one node per module listing every account with it on or
 *       Spam filter ...          off and its settings (Properties: the module's settings for that account)
 *     Routing Rules              every account's routing rules: New, Edit, Move Up / Down, Delete; allowlist groups
 *     Expiry                     mail accounts: expiry rules, counts, the messages due, Sweep Now (dry-run by
 *                                default; moving due mail to Trash asks first)
 *     Mail Rules                 the older IMAP mail rules (modules/mailAccountsRules.js): New, Edit, Delete, Run
 *     Log                        ingest_log, newest first, 50 a page (Newer / Older)
 *
 * Every read and write is the MCP tool of the same name over WebSocket (modules/ws/handlers/
 * 314-ingestControllerHandler.js runs the very same code). A write the server refuses with CONFIRM_REQUIRED is
 * asked here (a Vista message box) and sent again with confirm:true, so the console asks exactly when the
 * server would: process mode, applying, a module that deletes or forwards, any module on an applying account.
 * Sweeping for real, deleting a mail rule and running the mail rules for real ask before they are sent.
 * Going back to bypass, stopping applying (back to dry-run), dry-run sweeps and previews never ask.
 *
 * While a node of the snap-in shows, the ingest_controller feed (statusHub) pushes the accounts, the newest
 * log entries, the mail rules and the expiry counts when they change; nothing is polled.
 *
 *   window.openIngestController(node?)   its own console window
 *   window.mmcIngest.def()               the snap-in for mmcConsole.compose
 */
(function (root) {
    'use strict';

    const ID = 'ingest';
    const TITLE = 'Ingest Controller';
    const EX = '/static_images/vista-exchange';
    const VI = '/static_images/vista-icons';
    const CPL = '/static_images/vista-cpl';
    const ITEMS = `${CPL}/items`;
    const APPS = '/static_images/app_icons';
    const ICON16 = `${EX}/transport-16.png`;
    const ICON32 = `${EX}/transport-32.png`;
    const IC = {
        accounts: `${VI}/account-manager-16.png`,
        accounts32: `${VI}/account-manager-32.png`,
        email: `${EX}/mailbox-16.png`,
        email32: `${EX}/mailbox-32.png`,
        exchange: `${VI}/dovecote-16.png`,
        exchange32: `${VI}/dovecote-32.png`,
        sms: `${APPS}/16/melaton-messenger.png`,
        sms32: `${APPS}/32/melaton-messenger.png`,
        modules: `${ITEMS}/programs-and-features-16.png`,
        spamFilter: `${EX}/spam-16.png`,
        codeExtraction: `${CPL}/key-16.png`,
        routing: `${EX}/forward-16.png`,
        expiry: `${ITEMS}/date-and-time-16.png`,
        expiry32: `${ITEMS}/date-and-time-32.png`,
        mailrules: `${EX}/tracking-16.png`,
        log: `${APPS}/16/vista-event-viewer.png`,
        warning: `${VI}/warning-16.png`,
        error: `${VI}/error-16.png`
    };

    const SOURCES = [
        ['email', 'E-mail', 'acc-email'],
        ['exchange', 'Exchange', 'acc-exchange'],
        ['sms', 'Text Messages', 'acc-sms']
    ];
    const SOURCE_NAME = { email: 'E-mail', exchange: 'Exchange', sms: 'Text Messages' };
    const MODULES = [
        ['spamFilter', 'Spam filter', 'Mail: the SpamAssassin score from spamd (the Exchange relay\'s own score is reused). Texts: known spam numbers and a light check. Over the threshold: Junk or Trash.'],
        ['codeExtraction', 'Code extraction', 'Finds verification codes and sign-in links and shows them on Yukimi\'s devices only. Codes are never logged.'],
        ['routing', 'Routing rules', 'Rules over sender, recipients, subject, headers and body: move, delete, mark read, flag, forward, hand to an agent, notify, silence, expire.'],
        ['expiry', 'Expiry', 'Tags Inbox mail with an expiry; the sweep moves due mail to Trash. Flagged mail never expires. Mail only.']
    ];
    const MOD_NAME = Object.fromEntries(MODULES.map(([id, name]) => [id, name]));
    const MAIL = ['email', 'exchange'];

    // dialog styles (Win32)
    const SS = 0x50020000;
    const ETCHED = 0x50000010;
    const ICON = 0x50000003;
    const EDIT = 0x50010080;
    const MULTI = 0x50211044;
    const PUSH = 0x50010000;
    const DEFPUSH = 0x50010001;
    const CHECK = 0x50010003;
    const RADIO_FIRST = 0x50030009;
    const RADIO = 0x50010009;
    const GROUP = 0x50000007;
    const COMBO = 0x50210042;
    const LV = 0x5001000D;
    const EDGE = 0x200;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const when = (t) => (root.mmcConsole ? root.mmcConsole.when(t) : String(t || ''));
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const keyOf = (source, accountId) => `${source}|${accountId}`;
    const splitKey = (k) => { const s = String(k || ''); const i = s.indexOf('|'); return i < 0 ? { source: '', accountId: s } : { source: s.slice(0, i), accountId: s.slice(i + 1) }; };

    const state = {
        denied: false,
        feedOn: false,
        feedError: '',
        accounts: new Map(),  // key -> ingest_list_accounts row (the feed)
        expiry: new Map(),    // key -> { counts, lastSweep, sweepEveryMinutes } (the feed)
        head: [],             // the newest log entries (the feed)
        rules: null,          // the mail rules (the feed)
        mods: new Map(),      // key -> { pipeline, at: row.updated } (ingest_list_modules, on demand)
        modsLoading: false,
        modsError: '',
        modsTried: new Set(), // keys a page already asked for (a failed read is not asked again on every repaint)
        log: { source: '', before: null, stack: [], entries: null, more: false, loading: false, error: '' },
        spamd: null,          // the last Test Connection answer
        console: null         // the console showing a node of the snap-in
    };

    // ---- the server -------------------------------------------------------------------------------------

    function isAdmin() {
        try { const t = localStorage.getItem('userType'); return t === 'admin' || t === 'dev_admin'; } catch (_) { return false; }
    }

    /** One packet: resolves with the tool's result; a refusal rejects with its code (CONFIRM_REQUIRED ...). */
    async function send(type, data) {
        const ws = root.wsClient;
        if (!ws || typeof ws.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        const r = await ws.sendMessage(type, data || {}, false);
        if (!r || r.success === false) {
            const err = new Error((r && r.error) || 'The server did not answer.');
            err.code = (r && r.code) || 'ERROR';
            throw err;
        }
        return r;
    }

    const ask = (c, html, title) => c.box(html, [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], { icon: 'warning', title: title || TITLE });

    /**
     * A write. When the server answers CONFIRM_REQUIRED, the question is asked and the write sent again with
     * confirm:true (the server decides when a change needs it). null: the administrator said No.
     */
    async function write(c, type, data, question, title) {
        try { return await send(type, data); } catch (err) {
            if (!err || err.code !== 'CONFIRM_REQUIRED') throw err;
        }
        if (await ask(c, question || '<p>This change needs your confirmation. Make it?</p>', title) !== true) return null;
        return send(type, Object.assign({}, data, { confirm: true }));
    }

    async function failBox(c, what, err) {
        await c.box(`<p>${esc(what)}</p>${err ? `<p>${esc((err && err.message) || String(err))}</p>` : ''}`, null, { icon: 'error', title: TITLE });
    }

    // ---- the feed (statusHub ingest_controller): only while a node of the snap-in shows ---------------------

    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
    let wired = false;
    let dropTimer = null;

    function applyItems(items, removed) {
        let headChanged = false;
        let accountsChanged = false;
        for (const [k, v] of Object.entries(items || {})) {
            if (k.startsWith('a:')) {
                const key = k.slice(2);
                const prev = state.accounts.get(key);
                state.accounts.set(key, v);
                // a changed pipeline: its settings are read again when a page needs them
                if (!prev || prev.updated !== (v && v.updated)) { state.mods.delete(key); state.modsTried.delete(key); }
                accountsChanged = true;
            } else if (k.startsWith('x:')) state.expiry.set(k.slice(2), v);
            else if (k === 'log') { state.head = Array.isArray(v) ? v : []; headChanged = true; }
            else if (k === 'rules') state.rules = Array.isArray(v) ? v : [];
        }
        for (const k of removed || []) {
            if (k.startsWith('a:')) { state.accounts.delete(k.slice(2)); state.mods.delete(k.slice(2)); accountsChanged = true; }
            else if (k.startsWith('x:')) state.expiry.delete(k.slice(2));
        }
        return { headChanged, accountsChanged };
    }

    function active(c) {
        return !!c && !!c.modal && c.modal.isConnected && (typeof c.isActive !== 'function' || c.isActive());
    }

    function repaint() {
        const c = state.console;
        if (active(c)) c.refresh();
    }

    async function want(on) {
        const ws = root.wsClient;
        clearTimeout(dropTimer);
        dropTimer = null;
        if (on === state.feedOn || !ws || typeof ws.sendMessage !== 'function') return;
        state.feedOn = on;
        if (!on) { try { await ws.sendMessage('status_unsubscribe', { feed: 'ingest_controller' }, false); } catch (_) { /* gone */ } return; }
        if (!wired && typeof ws.on === 'function') {
            wired = true;
            ws.on('ingest_controller_status', (msg) => {
                if (!state.feedOn || !msg) return;
                const d = msg.changed ? msg : (msg.data || {});
                const r = applyItems(d.changed, d.removed);
                const c = state.console;
                // the Log's first page follows new entries; the pages that show settings read what changed
                if (r.headChanged && active(c) && c.node === 'log' && !state.log.before) void loadLog(c, null);
                if (r.accountsChanged && active(c) && needsMods(c.node)) void loadMods(c);
                repaint();
            }, { signal: appScopeSignal });
            // the server forgets a dropped socket's subscriptions
            ws.on('connected', () => { if (state.feedOn) { state.feedOn = false; void want(true); } }, { signal: appScopeSignal });
        }
        try {
            const r = await ws.sendMessage('status_subscribe', { feed: 'ingest_controller' }, false);
            state.accounts.clear();
            state.expiry.clear();
            applyItems(r && (r.items || (r.data && r.data.items)));
            state.feedError = '';
        } catch (err) {
            state.feedOn = false;
            state.feedError = (err && err.message) || 'The server did not answer.';
        }
        repaint();
    }

    /** A page of the snap-in went away: the feed stops unless another one of its pages shows at once. */
    function letGo() {
        clearTimeout(dropTimer);
        dropTimer = setTimeout(() => {
            dropTimer = null;
            if (!active(state.console)) void want(false);
        }, 1000);
    }

    // ---- data on demand: each account's module settings -----------------------------------------------------

    const needsMods = (node) => node === 'routing' || node === 'expiry' || String(node || '').startsWith('mod-');

    async function loadMods(c, only) {
        if (state.modsLoading && !only) return;
        const keys = only ? [only] : [...state.accounts.keys()].filter((k) => !state.mods.has(k) && !state.modsTried.has(k));
        if (!keys.length) return;
        keys.forEach((k) => state.modsTried.add(k));
        if (!only) state.modsLoading = true;
        try {
            await Promise.all(keys.map(async (k) => {
                const a = state.accounts.get(k);
                if (!a) return;
                const r = await send('ingest_list_modules', { source: a.source, accountId: a.accountId });
                state.mods.set(k, { pipeline: r.pipeline || [], at: a.updated });
            }));
            state.modsError = '';
        } catch (err) {
            state.modsError = (err && err.message) || 'The server did not answer.';
        }
        if (!only) state.modsLoading = false;
        if (c && active(c)) c.refresh();
    }

    async function modsOf(key) {
        if (!state.mods.has(key)) { state.modsTried.delete(key); await loadMods(null, key); }
        return state.mods.get(key) || null;
    }

    function entryOf(key, moduleId) {
        const m = state.mods.get(key);
        return m ? (m.pipeline || []).find((p) => p.id === moduleId) || null : null;
    }

    async function loadLog(c, before) {
        const L = state.log;
        L.loading = true;
        try {
            const r = await send('ingest_log', { source: L.source || undefined, limit: 50, before: before || undefined });
            L.entries = r.entries || [];
            L.more = !!r.more;
            L.before = before || null;
            L.error = '';
        } catch (err) {
            L.error = (err && err.message) || 'The server did not answer.';
        }
        L.loading = false;
        if (c && active(c)) c.refresh();
    }

    // ---- words -------------------------------------------------------------------------------------------

    const accounts = (source) => [...state.accounts.values()].filter((a) => !source || a.source === source)
        .sort((a, b) => String(a.label || a.accountId).localeCompare(String(b.label || b.accountId)));
    const accountName = (a) => (a ? String(a.label || a.accountId) : '');
    const modeText = (a) => (!a || a.mode !== 'process' ? 'Bypass' : 'Process');
    const stateText = (a) => (!a || a.mode !== 'process' ? 'Off' : (a.applying ? 'Applying' : 'Dry run'));
    const flowText = (a) => {
        const on = ((a && a.pipeline) || []).filter((p) => p.enabled).map((p) => MOD_NAME[p.id] || p.id);
        return on.length ? on.join(' > ') : 'No modules';
    };

    function duration(ms) {
        const n = Number(ms) || 0;
        if (!n) return '';
        const D = 86400000;
        if (n % D === 0) return `${n / D}d`;
        if (n % 3600000 === 0) return `${n / 3600000}h`;
        return `${Math.round(n / 60000)}m`;
    }

    const FIELD_NAMES = { from: 'From', to: 'To', subject: 'Subject', body: 'Body', header: 'Header', any: 'Any field' };
    const OP_NAMES = { contains: 'contains', equals: 'equals', startsWith: 'starts with', endsWith: 'ends with', regex: 'matches', in: 'is in group', exists: 'exists' };
    const FIELD_KEYS = Object.keys(FIELD_NAMES);
    const OP_KEYS = Object.keys(OP_NAMES);

    const NOT_OP_NAMES = { contains: 'does not contain', equals: 'does not equal', startsWith: 'does not start with', endsWith: 'does not end with', regex: 'does not match', in: 'is not in group', exists: 'does not exist' };

    function condText(x) {
        const f = x.field === 'header' ? `Header ${x.header || ''}` : (FIELD_NAMES[x.field] || x.field);
        const v = x.op === 'in' ? (x.group || '') : x.op === 'exists' ? '' : (Array.isArray(x.value) ? x.value : [x.value]).filter(Boolean).join(' or ');
        return `${f} ${(x.not ? NOT_OP_NAMES : OP_NAMES)[x.op] || x.op}${v ? ` ${v}` : ''}`;
    }

    function matchText(m) {
        if (!m) return '';
        const parts = [];
        if (m.all && m.all.length) parts.push(m.all.map(condText).join(' and '));
        if (m.any && m.any.length) parts.push(`(${m.any.map(condText).join(' or ')})`);
        if (m.none && m.none.length) parts.push(`none of (${m.none.map(condText).join(', ')})`);
        return parts.join(' and ');
    }

    function actionsText(a) {
        if (!a) return '';
        const out = [];
        if (a.moveTo) out.push(`Move to ${a.moveTo}`);
        if (a.delete) out.push('Delete');
        if (a.markRead) out.push('Mark as read');
        if (a.flag) out.push('Flag');
        if (a.forwardTo) out.push(`Forward to ${a.forwardTo}`);
        if (a.handTo) out.push(`Hand to ${a.handTo}`);
        if (a.notify) out.push('Notify');
        if (a.silence) out.push('Silence');
        if (a.expire) {
            const e = [];
            if (a.expire.afterMs || a.expire.after) e.push(`${a.expire.after || duration(a.expire.afterMs)} after arrival`);
            if (a.expire.afterReadMs || a.expire.afterRead) e.push(`${a.expire.afterRead || duration(a.expire.afterReadMs)} after read`);
            out.push(`Expire ${e.join(', ')}`);
        }
        return out.join(', ');
    }

    /** One decided action as the log shows it. */
    function logAction(x) {
        if (!x || typeof x !== 'object') return '';
        if (Array.isArray(x.applied)) return `applied ${x.applied.join(' ')}`;
        const t = x.type || '';
        if (t === 'move') return `move to ${x.to || ''}`;
        if (t === 'forward') return `forward to ${x.to || ''}`;
        if (t === 'handToAgent') return `hand to ${x.mailbox || ''}`;
        if (t === 'expire') return x.to === 'trash' ? 'expire to Trash' : 'expire';
        if (t === 'notify') return x.kind === 'code' ? 'notify (code)' : 'notify';
        return { markRead: 'mark read', delete: 'delete (to Trash)' }[t] || t;
    }

    const SETTINGS_TEXT = {
        spamFilter: (s, source) => (source === 'sms'
            ? `Score ${s.textThreshold || 3}, then ${s.textAction === 'delete' ? 'delete' : 'silence'}`
            : `spamd ${s.host || ''}:${s.port || ''}, score ${s.threshold || 8}, then ${s.action === 'trash' ? 'Trash' : 'Junk'}`),
        codeExtraction: (s) => [s.links !== false ? 'Codes and links' : 'Codes only', s.markRead ? 'mark read' : ''].filter(Boolean).join(', '),
        routing: (s) => `${plural((s.rules || []).length, 'rule', 'rules')}, ${plural(Object.keys(s.groups || {}).length, 'group', 'groups')}${s.includeLegacyRules !== false ? ', mail rules first' : ''}`,
        expiry: (s) => `${plural((s.rules || []).length, 'rule', 'rules')}, at most ${s.maxPerSweep || 200} a sweep`
    };

    // ---- the tree ----------------------------------------------------------------------------------------

    function nodes() {
        return [{
            id: 'root', name: TITLE, icon: ICON16,
            children: [
                { id: 'accounts', name: 'Accounts', icon: IC.accounts, children: SOURCES.map(([s, name, id]) => ({ id, name, icon: IC[s] })) },
                { id: 'modules', name: 'Modules', icon: IC.modules, children: MODULES.map(([id, name]) => ({ id: `mod-${id}`, name, icon: IC[id] })) },
                { id: 'routing', name: 'Routing Rules', icon: IC.routing },
                { id: 'expiry', name: 'Expiry', icon: IC.expiry },
                { id: 'mailrules', name: 'Mail Rules', icon: IC.mailrules },
                { id: 'log', name: 'Log', icon: IC.log }
            ]
        }];
    }

    // ---- pages -------------------------------------------------------------------------------------------

    const listPage = (title, side, list) => ({ html: `<div class="mmc-page-title"><b>${esc(title)}</b><span>${esc(side || '')}</span></div>${list}`, list: true });

    function deniedPage(c) {
        return c.page(TITLE, '', [{ id: 'ing-denied', title: 'Access is denied', body: `<p>${c.state(false, 'The Ingest Controller needs an administrator. Sign in as the Administrator to use it.')}</p>` }]);
    }

    function waitingText() {
        if (state.feedError) return `The Ingest Controller could not be read. ${state.feedError}`;
        return 'Reading data, please wait...';
    }

    function rootPage(c) {
        const all = accounts();
        if (!state.feedOn && !all.length) {
            return c.page(TITLE, '', [{ id: 'ing-wait', title: TITLE, body: `<p>${state.feedError ? c.state(false, waitingText()) : esc(waitingText())}</p>` }]);
        }
        const proc = all.filter((a) => a.mode === 'process');
        const applying = proc.filter((a) => a.applying);
        let due = 0;
        let errors = 0;
        let lastSweep = null;
        for (const x of state.expiry.values()) {
            due += (x.counts && x.counts.due) || 0;
            errors += (x.counts && x.counts.error) || 0;
            const t = x.lastSweep && (x.lastSweep.at || x.lastSweep.finishedAt || x.lastSweep.ts);
            if (t && (!lastSweep || Date.parse(t) > Date.parse(lastSweep))) lastSweep = t;
        }
        const sp = state.spamd;
        const spamText = !sp ? '<span class="mmc-hint">Not tested</span>'
            : sp.ok ? esc(`Reachable at ${sp.host}:${sp.port}${sp.ms != null ? ` (${sp.ms} ms)` : ''}`)
                : c.state(false, `Not reachable at ${sp.host || ''}:${sp.port || ''}${sp.error ? ` (${sp.error})` : ''}`, true);
        const health = c.props([
            ['Accounts covered', esc(String(all.length))],
            ['Processing', proc.length ? esc(`${proc.length} (${applying.length} applying, ${proc.length - applying.length} dry run)`) : 'None: every account is in bypass'],
            ['Spam filter (spamd)', `${spamText}<br><span class="mmc-link" data-act="probe">Test Connection</span>`],
            ['Expiry', state.expiry.size ? (errors ? c.state(false, `${due} due, ${errors} could not be moved`, true) : esc(`${plural(state.expiry.size, 'account', 'accounts')}, ${due} due`)) : 'Off on every mail account'],
            ['Last expiry sweep', lastSweep ? esc(when(lastSweep)) : '<span class="mmc-hint">None yet</span>']
        ]);
        const modeCols = [
            { t: 'Source', w: 130, min: 110, key: 'name', text: (d) => d.name },
            { t: 'Total', w: 50, min: 44, num: true, key: 'n', value: (d) => d.n, text: (d) => String(d.n) },
            { t: 'Bypass', w: 56, min: 52, num: true, key: 'b', value: (d) => d.b, text: (d) => String(d.b) },
            { t: 'Dry Run', w: 60, min: 56, num: true, key: 'd', value: (d) => d.d, text: (d) => String(d.d) },
            { t: 'Applying', w: 66, min: 62, num: true, key: 'p', value: (d) => d.p, text: (d) => String(d.p) }
        ];
        const modeRows = SOURCES.map(([s, name, id]) => {
            const list = accounts(s);
            return { key: s, icon: IC[s], open: id, data: { name, n: list.length, b: list.filter((a) => a.mode !== 'process').length, d: list.filter((a) => a.mode === 'process' && !a.applying).length, p: list.filter((a) => a.mode === 'process' && a.applying).length } };
        });
        // the overview's activity: when, which account, what was decided (the Log has every column)
        const actCols = logCols().filter((col) => col.key === 'ts' || col.key === 'acct' || col.key === 'actions');
        const actRows = state.head.map((e) => ({ key: `log:${e.id}`, icon: IC[e.source], data: e }));
        const sections = [
            { id: 'ing-health', title: 'Pipeline Health', body: health },
            { id: 'ing-modes', title: 'Accounts by Mode', body: c.listView(modeCols, modeRows, { fit: true }) },
            { id: 'ing-activity', title: 'Recent Activity', body: `${c.listView(actCols, actRows, { fit: true, empty: 'The pipeline has not decided anything yet.' })}<div class="mmc-buttons"><button type="button" class="btn-standard" data-act="nav:log">View Log</button></div>` }
        ];
        return c.page(TITLE, '', sections);
    }

    function accountCols() {
        return [
            { t: 'Account', w: 170, min: 120, key: 'name', text: (a) => accountName(a) },
            { t: 'Source', w: 80, min: 64, key: 'source', text: (a) => SOURCE_NAME[a.source] || a.source },
            { t: 'Mode', w: 60, key: 'mode', text: (a) => modeText(a) },
            { t: 'Actions', w: 66, min: 60, key: 'state', html: (a) => (a.mode === 'process' && !a.applying ? `<i>${esc('Dry run')}</i>` : `<i>${esc(stateText(a))}</i>`) },
            { t: 'Pipeline', w: 260, min: 120, key: 'flow', text: (a) => flowText(a) }
        ];
    }

    function accountsPage(c, source) {
        const list = accounts(source);
        const rows = list.map((a) => ({ key: keyOf(a.source, a.accountId), icon: IC[a.source], data: a }));
        const title = source ? SOURCE_NAME[source] : 'Accounts';
        const empty = !state.feedOn ? waitingText() : (source ? `There are no ${SOURCE_NAME[source]} accounts.` : 'There are no accounts.');
        return listPage(title, plural(list.length, 'account', 'accounts'), c.listView(accountCols(), rows, { sortId: `ing-acc-${source || 'all'}`, sort: { key: 'name', dir: 1 }, empty, fit: true }));
    }

    function modulesPage(c) {
        const all = accounts();
        const cols = [
            { t: 'Module', w: 120, min: 100, key: 'name', text: (d) => d.name },
            { t: 'On', w: 60, min: 52, key: 'on', text: (d) => d.on },
            { t: 'Description', w: 360, key: 'desc', text: (d) => d.desc }
        ];
        const rows = MODULES.map(([id, name, desc]) => {
            const cover = all.filter((a) => id !== 'expiry' || MAIL.includes(a.source));
            const on = cover.filter((a) => (a.pipeline || []).some((p) => p.id === id && p.enabled)).length;
            return { key: id, icon: IC[id], open: `mod-${id}`, data: { name, desc, on: `${on} of ${cover.length}` } };
        });
        return listPage('Modules', plural(MODULES.length, 'module', 'modules'), c.listView(cols, rows, { fit: true }));
    }

    function loadingEmpty(what) {
        if (state.modsError) return `The settings could not be read. ${state.modsError}`;
        return state.modsLoading || !state.feedOn ? 'Reading data, please wait...' : what;
    }

    function modulePage(c, moduleId) {
        if (state.feedOn) void loadMods(c);
        const list = accounts().filter((a) => moduleId !== 'expiry' || MAIL.includes(a.source));
        const cols = [
            { t: 'Account', w: 170, min: 120, key: 'name', text: (d) => accountName(d.a) },
            { t: 'Source', w: 80, key: 'source', text: (d) => SOURCE_NAME[d.a.source] },
            { t: 'Status', w: 64, min: 60, key: 'on', text: (d) => (d.on ? 'Enabled' : 'Disabled') },
            { t: 'Order', w: 44, num: true, key: 'pos', value: (d) => d.pos, text: (d) => (d.pos ? String(d.pos) : '') },
            { t: 'Settings', w: 260, key: 'set', text: (d) => d.set }
        ];
        const rows = list.map((a) => {
            const k = keyOf(a.source, a.accountId);
            const pi = (a.pipeline || []).findIndex((p) => p.id === moduleId);
            const e = entryOf(k, moduleId);
            return { key: k, icon: IC[a.source], data: { a, on: pi >= 0 && a.pipeline[pi].enabled, pos: pi + 1, set: e ? SETTINGS_TEXT[moduleId](e.settings || {}, a.source) : '' } };
        });
        return listPage(MOD_NAME[moduleId], plural(rows.length, 'account', 'accounts'), c.listView(cols, rows, { sortId: `ing-mod-${moduleId}`, sort: { key: 'name', dir: 1 }, empty: loadingEmpty('There are no accounts.'), fit: true }));
    }

    function routingRows() {
        const out = [];
        for (const a of accounts()) {
            const k = keyOf(a.source, a.accountId);
            const e = entryOf(k, 'routing');
            if (!e) continue;
            (e.settings.rules || []).forEach((r, i) => out.push({ key: `${k}#${i}`, icon: IC[a.source], cls: r.enabled === false ? 'is-disabled' : '', data: { a, r, i, n: (e.settings.rules || []).length, on: !!e.enabled } }));
        }
        return out;
    }

    function routingPage(c) {
        if (state.feedOn) void loadMods(c);
        const cols = [
            { t: 'Account', w: 140, min: 100, key: 'acct', text: (d) => accountName(d.a) },
            { t: 'Order', w: 48, min: 48, num: true, key: 'i', value: (d) => d.i, text: (d) => String(d.i + 1) },
            { t: 'Rule', w: 140, min: 100, key: 'name', text: (d) => d.r.name || '(No name)' },
            { t: 'Conditions', w: 200, key: 'match', text: (d) => matchText(d.r.match) },
            { t: 'Actions', w: 150, key: 'actions', text: (d) => actionsText(d.r.actions) },
            { t: 'Status', w: 64, key: 'on', text: (d) => (d.r.enabled === false ? 'Disabled' : (d.on ? 'Enabled' : 'Module off')) }
        ];
        const rows = routingRows();
        return listPage('Routing Rules', plural(rows.length, 'rule', 'rules'), c.listView(cols, rows, { sortId: 'ing-routing', empty: loadingEmpty('There are no routing rules. Click New Rule... to add one.'), fit: true }));
    }

    function expiryPage(c) {
        if (state.feedOn) void loadMods(c);
        const list = accounts().filter((a) => MAIL.includes(a.source));
        const cnt = (d, k) => (d.x && d.x.counts ? d.x.counts[k] || 0 : null);
        const n = (k) => ({ num: true, key: k, value: (d) => cnt(d, k) || 0, text: (d) => (cnt(d, k) == null ? '' : String(cnt(d, k))) });
        const cols = [
            { t: 'Account', w: 160, min: 120, key: 'name', text: (d) => accountName(d.a) },
            { t: 'Expiry', w: 74, min: 60, key: 'state', text: (d) => d.st },
            Object.assign({ t: 'Tagged', w: 52 }, n('tagged')),
            Object.assign({ t: 'Due', w: 44 }, n('due')),
            Object.assign({ t: 'Flagged', w: 52 }, n('flagged')),
            Object.assign({ t: 'Expired', w: 52 }, n('expired')),
            Object.assign({ t: 'Errors', w: 48 }, n('error')),
            { t: 'Rules', w: 44, num: true, key: 'rules', value: (d) => d.rules, text: (d) => (d.rules == null ? '' : String(d.rules)) },
            { t: 'Last Sweep', w: 120, key: 'last', value: (d) => Date.parse(d.last) || 0, text: (d) => (d.last ? when(d.last) : '') }
        ];
        const rows = list.map((a) => {
            const k = keyOf(a.source, a.accountId);
            const on = (a.pipeline || []).some((p) => p.id === 'expiry' && p.enabled);
            const x = state.expiry.get(k) || null;
            const e = entryOf(k, 'expiry');
            const sweeping = on && a.mode === 'process';
            const st = !on ? 'Off' : !sweeping ? 'On (bypass)' : a.applying ? 'Applying' : 'Dry run';
            const ls = x && x.lastSweep;
            return { key: k, icon: x && x.counts && x.counts.error ? IC.warning : IC[a.source], data: { a, x, st, rules: e ? (e.settings.rules || []).length : null, last: ls && (ls.at || ls.finishedAt || ls.ts) } };
        });
        return listPage('Expiry', plural(rows.length, 'mail account', 'mail accounts'), c.listView(cols, rows, { sortId: 'ing-expiry', sort: { key: 'name', dir: 1 }, empty: loadingEmpty('There are no mail accounts.'), fit: true }));
    }

    function mailRulesPage(c) {
        const rules = state.rules || [];
        const cols = [
            { t: 'Rule', w: 140, min: 90, key: 'name', text: (r) => r.name || '(No name)' },
            { t: 'Account', w: 100, key: 'acct', text: (r) => (r.accountId === '*' ? 'All accounts' : r.accountId) },
            { t: 'Conditions', w: 190, key: 'match', text: (r) => Object.entries(r.match || {}).map(([k, v]) => `${FIELD_NAMES[k] || k} contains ${v}`).join(' and ') },
            { t: 'Actions', w: 140, key: 'actions', text: (r) => actionsText(r.actions) },
            { t: 'Status', w: 60, key: 'on', text: (r) => (r.enabled ? 'Enabled' : 'Disabled') },
            { t: 'Hits', w: 44, num: true, key: 'hits', value: (r) => Number(r.hits) || 0, text: (r) => String(r.hits || 0) },
            { t: 'Last Hit', w: 120, key: 'last', value: (r) => Number(r.lastHit) || 0, text: (r) => (r.lastHit ? when(r.lastHit) : '') }
        ];
        const rows = rules.map((r) => ({ key: r.id, icon: IC.mailrules, cls: r.enabled ? '' : 'is-disabled', data: r }));
        const empty = state.rules == null ? waitingText() : 'There are no mail rules. Click New Mail Rule... to add one.';
        return listPage('Mail Rules', plural(rows.length, 'rule', 'rules'), c.listView(cols, rows, { sortId: 'ing-mailrules', empty, fit: true }));
    }

    function logCols() {
        return [
            { t: 'Date and Time', w: 124, min: 120, key: 'ts', value: (e) => e.ts || 0, text: (e) => when(e.ts) },
            { t: 'Account', w: 120, min: 80, key: 'acct', text: (e) => { const a = state.accounts.get(keyOf(e.source, e.account)); return a ? accountName(a) : e.account; } },
            { t: 'From', w: 130, key: 'from', text: (e) => e.sender || '' },
            { t: 'Subject', w: 160, key: 'subject', text: (e) => e.subject || '' },
            { t: 'Decision', w: 170, min: 120, key: 'actions', text: (e) => `${e.dry ? 'Dry run: ' : ''}${(e.actions || []).map(logAction).filter(Boolean).join(', ') || 'no action'}${e.stoppedBy ? ` (stopped by ${MOD_NAME[e.stoppedBy] || e.stoppedBy})` : ''}` }
        ];
    }

    function logPage(c) {
        const L = state.log;
        if (!L.entries && !L.loading && !L.error) void loadLog(c, null);
        const rows = (L.entries || []).map((e) => ({ key: `log:${e.id}`, icon: IC[e.source], data: e }));
        const page = L.stack.length + 1;
        const side = `${L.source ? `${SOURCE_NAME[L.source]}, ` : ''}page ${page}`;
        const empty = L.error ? `The log could not be read. ${L.error}` : (!L.entries ? 'Reading data, please wait...' : 'There are no entries in the log.');
        return listPage('Log', side, c.listView(logCols(), rows, { empty, fit: true }));
    }

    function page(node, c) {
        state.console = c;
        if (!isAdmin()) { state.denied = true; return deniedPage(c); }
        state.denied = false;
        let out;
        switch (node.id) {
            case 'accounts': out = accountsPage(c, null); break;
            case 'acc-email': out = accountsPage(c, 'email'); break;
            case 'acc-exchange': out = accountsPage(c, 'exchange'); break;
            case 'acc-sms': out = accountsPage(c, 'sms'); break;
            case 'modules': out = modulesPage(c); break;
            case 'routing': out = routingPage(c); break;
            case 'expiry': out = expiryPage(c); break;
            case 'mailrules': out = mailRulesPage(c); break;
            case 'log': out = logPage(c); break;
            default:
                out = String(node.id).startsWith('mod-') ? modulePage(c, node.id.slice(4)) : rootPage(c);
        }
        const spec = typeof out === 'string' ? { html: out } : out;
        // the feed runs while a page of the snap-in shows (mount); a page that goes lets it go unless another one comes
        return Object.assign({}, spec, { mount: () => { void want(true); }, unmount: letGo });
    }

    // ---- commands ------------------------------------------------------------------------------------------

    function commands(node) {
        if (state.denied) return [];
        const id = node.id;
        if (id === 'root') return [{ text: 'Test spamd Connection', action: 'probe', icon: IC.spamFilter }, { text: 'Sweep All (Dry Run)', action: 'sweep-all', icon: IC.expiry }];
        if (id === 'routing') return [{ text: 'New Rule...', action: 'route-new', icon: IC.routing }];
        if (id === 'expiry') return [{ text: 'Sweep All (Dry Run)', action: 'sweep-all', icon: IC.expiry }];
        if (id === 'mailrules') return [{ text: 'New Mail Rule...', action: 'mr-new', icon: IC.mailrules }, { text: 'Run Rules...', action: 'mr-run' }];
        if (id === 'log') {
            const L = state.log;
            return [{ text: 'Newest Entries', action: 'log-first', disabled: !L.before }, { text: 'Newer Entries', action: 'log-newer', disabled: !L.stack.length }, { text: 'Older Entries', action: 'log-older', disabled: !L.more }];
        }
        return [];
    }

    function accountItems(a) {
        const k = keyOf(a.source, a.accountId);
        const proc = a.mode === 'process';
        const out = [
            { text: 'Properties', action: `acct-props:${k}` },
            { separator: true },
            { text: 'Bypass', action: `mode-bypass:${k}`, disabled: !proc },
            { text: 'Process (Dry Run)...', action: `mode-process:${k}`, disabled: proc },
            { text: 'Start Applying...', action: `mode-apply:${k}`, disabled: !proc || a.applying },
            { text: 'Stop Applying', action: `mode-dry:${k}`, disabled: !proc || !a.applying },
            { separator: true },
            { text: 'Dry Run a Message...', action: `dry-run:${k}` }
        ];
        if (MAIL.includes(a.source)) out.push({ text: 'Expiry Status...', action: `expiry-status:${k}` });
        return out;
    }

    function selCommands(node, key) {
        if (state.denied || key == null) return null;
        const id = node.id;
        const k = String(key);
        if (id === 'accounts' || id.startsWith('acc-')) {
            const a = state.accounts.get(k);
            return a ? { title: accountName(a), items: accountItems(a) } : null;
        }
        if (id.startsWith('mod-')) {
            const a = state.accounts.get(k);
            const m = id.slice(4);
            if (!a) return null;
            const on = (a.pipeline || []).some((p) => p.id === m && p.enabled);
            return { title: accountName(a), items: [
                { text: 'Enable', action: `mod-on:${m}:${k}`, disabled: on },
                { text: 'Disable', action: `mod-off:${m}:${k}`, disabled: !on },
                { separator: true },
                { text: 'Properties', action: `mod-props:${m}:${k}` },
                { text: 'Account Properties', action: `acct-props:${k}` }
            ] };
        }
        if (id === 'routing') {
            const row = routingRows().find((r) => r.key === k);
            if (!row) return null;
            const { r, i, n } = row.data;
            return { title: r.name || '(No name)', items: [
                { text: 'Edit...', action: `route-edit:${k}` },
                { text: r.enabled === false ? 'Enable' : 'Disable', action: `route-toggle:${k}` },
                { text: 'Move Up', action: `route-up:${k}`, disabled: i === 0 },
                { text: 'Move Down', action: `route-down:${k}`, disabled: i >= n - 1 },
                { separator: true },
                { text: 'Allowlist Groups...', action: `route-groups:${k}` },
                { text: 'Delete...', action: `route-delete:${k}` }
            ] };
        }
        if (id === 'expiry') {
            const a = state.accounts.get(k);
            if (!a) return null;
            const on = (a.pipeline || []).some((p) => p.id === 'expiry' && p.enabled);
            return { title: accountName(a), items: [
                { text: 'Expiry Rules...', action: `expiry-rules:${k}` },
                { text: 'Messages Due...', action: `expiry-status:${k}` },
                { separator: true },
                { text: on ? 'Turn Off Expiry' : 'Turn On Expiry...', action: `${on ? 'mod-off' : 'mod-on'}:expiry:${k}` },
                { text: 'Sweep Now (Dry Run)', action: `sweep-dry:${k}`, disabled: !on || a.mode !== 'process' },
                { text: 'Sweep and Move Due Mail...', action: `sweep-apply:${k}`, disabled: !on || a.mode !== 'process' || !a.applying }
            ] };
        }
        if (id === 'mailrules') {
            const r = (state.rules || []).find((x) => x.id === k);
            if (!r) return null;
            return { title: r.name || '(No name)', items: [
                { text: 'Edit...', action: `mr-edit:${k}` },
                { text: r.enabled ? 'Disable' : 'Enable', action: `mr-toggle:${k}` },
                { text: 'Run This Rule...', action: `mr-run:${k}` },
                { separator: true },
                { text: 'Delete...', action: `mr-delete:${k}` }
            ] };
        }
        return null;
    }

    function viewMenu(node) {
        if (node.id !== 'log') return [];
        const cur = state.log.source;
        const item = (s, t) => ({ text: `${cur === s ? '• ' : ''}${t}`, action: `log-source:${s}` });
        return [item('', 'All Sources'), item('email', 'E-mail'), item('exchange', 'Exchange'), item('sms', 'Text Messages')];
    }

    function rowOpen(key, node, c) {
        const id = node.id;
        if (id === 'accounts' || id.startsWith('acc-')) void action(`acct-props:${key}`, c);
        else if (id.startsWith('mod-')) void action(`mod-props:${id.slice(4)}:${key}`, c);
        else if (id === 'routing') void action(`route-edit:${key}`, c);
        else if (id === 'expiry') void action(`expiry-rules:${key}`, c);
        else if (id === 'mailrules') void action(`mr-edit:${key}`, c);
    }

    // ---- actions -------------------------------------------------------------------------------------------

    const label = (a) => `<b>${esc(accountName(a))}</b>`;

    async function setMode(c, a, mode) {
        const data = { source: a.source, accountId: a.accountId, mode };
        if (mode === 'apply') {
            Object.assign(data, { mode: 'process', applying: true });
            return write(c, 'ingest_set_mode', data, `<p>Start applying the pipeline's actions on ${label(a)}?</p><p>New messages will really be moved, deleted, forwarded or handed to an agent as its modules decide. What the modules decide is no longer only written to the log.</p>`, 'Start Applying');
        }
        if (mode === 'dry') {
            // stopping the actions (back to dry-run) is not asked: the server wants confirm:true for any
            // process-mode write, and this one only takes power away
            return send('ingest_set_mode', Object.assign(data, { mode: 'process', applying: false, confirm: true }));
        }
        if (mode === 'process') {
            return write(c, 'ingest_set_mode', data, `<p>Switch ${label(a)} to process mode?</p><p>Its pipeline runs on every new message, starting in a dry run: what it would do is only written to the log until you start applying.</p>`, 'Process Mode');
        }
        return send('ingest_set_mode', data);
    }

    /** One module of one account: enabled / settings / position. */
    function configure(c, a, moduleId, patch, question) {
        const data = Object.assign({ source: a.source, accountId: a.accountId, module: moduleId }, patch);
        const q = question || `<p>Change ${esc(MOD_NAME[moduleId])} on ${label(a)}?</p><p>${a.applying ? 'This account is applying its actions: the change takes effect on the next message.' : 'This module deletes, forwards or moves messages to Trash when its rules match.'}</p>`;
        return write(c, 'ingest_configure_module', data, q, MOD_NAME[moduleId]);
    }

    async function probe(c) {
        const a = accounts().find((x) => x.source !== 'sms') || accounts()[0];
        if (!a) { await c.box('<p>There is no account to read the spam filter settings from.</p>', null, { icon: 'info' }); return; }
        c.note('Testing the connection to spamd...');
        try {
            const r = await send('ingest_list_modules', { source: a.source, accountId: a.accountId, probe: true });
            state.spamd = r.spamd || { ok: false, error: 'No answer' };
            c.note('');
        } catch (err) {
            c.note('');
            await failBox(c, 'The spam filter could not be tested.', err);
        }
        c.refresh();
    }

    async function sweepAll(c) {
        const out = [];
        c.note('Sweeping...');
        for (const source of MAIL) {
            try { const r = await send('ingest_expiry_sweep', { source, accountId: '*', dryRun: true }); out.push(...(r.accounts || [])); } catch (err) { out.push({ source, accountId: '*', error: err.message }); }
        }
        c.note('');
        sweepResult(c, 'Expiry Sweep (Dry Run)', out, true);
    }

    function sweepResult(c, title, list, dry) {
        const rows = [];
        const msgs = [];
        for (const r of list) {
            const a = state.accounts.get(keyOf(r.source, r.accountId));
            const name = a ? accountName(a) : r.accountId;
            if (r.error) { rows.push({ cells: [name, 'Error', r.error] }); continue; }
            rows.push({ cells: [name, dry ? `${(r.wouldExpire || []).length} would expire` : `${r.expired || 0} moved to Trash`, `${r.tracked || 0} tracked, ${r.due || 0} due, ${r.flagged || 0} flagged${r.failed ? `, ${r.failed} failed` : ''}`] });
            for (const m of (r.wouldExpire || []).slice(0, 50)) msgs.push({ cells: [name, m.subject || '', m.from || '', m.reason || ''] });
        }
        const note = list.length ? (dry ? 'Nothing was moved: this is what the sweep would do now.' : 'Due mail was moved to Trash. Flagged mail is never moved.') : 'No mail account has expiry turned on in process mode.';
        listDialog(c, title, note, [{ t: 'Account', w: 140 }, { t: 'Result', w: 120 }, { t: 'Details', w: 220 }], rows, 'There is nothing to show.', msgs.length ? { cols: [{ t: 'Account', w: 110 }, { t: 'Subject', w: 170 }, { t: 'From', w: 110 }, { t: 'Reason', w: 90 }], rows: msgs } : null);
    }

    async function expiryStatus(c, a) {
        try {
            const r = await send('ingest_expiry_status', { source: a.source, accountId: a.accountId, limit: 100 });
            const rows = (r.upcoming || []).concat(r.failed || []).map((m) => ({ cells: [m.subject || '', m.from || '', m.waitingForRead ? 'After it is read' : (m.expiresAt ? when(m.expiresAt) : ''), m.error || m.reason || ''] }));
            const cn = r.counts || {};
            const note = `${r.enabled ? (r.sweeping ? (r.dryRun ? 'Expiry is on (dry run).' : 'Expiry is on and moves due mail to Trash.') : 'Expiry is on, but the account is in bypass: nothing is swept.') : 'Expiry is off.'} ${cn.tagged || 0} tagged, ${cn.due || 0} due, ${cn.flagged || 0} flagged, ${cn.expired || 0} expired.`;
            listDialog(c, `Messages Due - ${accountName(a)}`, note, [{ t: 'Subject', w: 180 }, { t: 'From', w: 120 }, { t: 'Expires', w: 110 }, { t: 'Reason', w: 90 }], rows, 'No message is due to expire.');
        } catch (err) { await failBox(c, `The expiry status of ${accountName(a)} could not be read.`, err); }
    }

    async function moveRoute(c, k, delta, remove, toggle) {
        const i = k.lastIndexOf('#');
        const key = k.slice(0, i);
        const idx = Number(k.slice(i + 1));
        const a = state.accounts.get(key);
        const e = entryOf(key, 'routing');
        if (!a || !e) return;
        const rules = (e.settings.rules || []).map(ruleOut);
        if (remove) {
            if (await ask(c, `<p>Delete the routing rule <b>${esc(rules[idx].name || '(No name)')}</b> of ${label(a)}?</p>`, 'Delete Rule') !== true) return;
            rules.splice(idx, 1);
        } else if (toggle) rules[idx].enabled = rules[idx].enabled === false;
        else {
            const j = idx + delta;
            if (j < 0 || j >= rules.length) return;
            [rules[idx], rules[j]] = [rules[j], rules[idx]];
        }
        try {
            const r = await configure(c, a, 'routing', { settings: { rules } });
            if (r) { state.mods.delete(key); await loadMods(c, key); c.note('The routing rules were saved.'); }
        } catch (err) { await failBox(c, 'The routing rules were not saved.', err); }
        if (!remove && !toggle) c.selectRow(`${key}#${idx + delta}`);
        c.refresh();
    }

    /** A stored routing rule as configureModule takes it back (expire as durations). */
    function ruleOut(r) {
        const o = JSON.parse(JSON.stringify(r));
        if (o.actions && o.actions.expire) {
            const x = o.actions.expire;
            o.actions.expire = {};
            if (x.afterMs) o.actions.expire.after = duration(x.afterMs);
            if (x.afterReadMs) o.actions.expire.afterRead = duration(x.afterReadMs);
        }
        return o;
    }

    async function action(a, c) {
        state.console = c;
        if (a === 'refresh') {
            state.mods.clear();
            state.modsTried.clear();
            if (c.node === 'log') await loadLog(c, state.log.before);
            else if (state.feedOn) { state.feedOn = false; await want(true); }
            if (needsMods(c.node)) await loadMods(c);
            c.refresh();
            return true;
        }
        if (a === 'probe') { await probe(c); return true; }
        if (a === 'sweep-all') { await sweepAll(c); return true; }
        if (a === 'route-new') { await routeDialog(c, null, -1); return true; }
        if (a === 'mr-new') { mailRuleDialog(c, null); return true; }
        if (a === 'log-first') { state.log.stack = []; await loadLog(c, null); c.refresh(); return true; }
        if (a === 'log-older') {
            const L = state.log;
            const last = L.entries && L.entries[L.entries.length - 1];
            if (!last || !L.more) return true;
            L.stack.push(L.before);
            await loadLog(c, last.id);
            c.refresh();
            return true;
        }
        if (a === 'log-newer') { const L = state.log; const b = L.stack.length ? L.stack.pop() : null; await loadLog(c, b); c.refresh(); return true; }
        if (a.startsWith('log-source:')) { state.log.source = a.slice(11); state.log.stack = []; await loadLog(c, null); c.refresh(); return true; }
        if (a === 'mr-run' || a.startsWith('mr-run:')) { runRulesDialog(c, a.startsWith('mr-run:') ? a.slice(7) : null); return true; }

        const m = /^([a-z-]+):(.*)$/.exec(a);
        if (!m) return false;
        const [, verb, rest] = m;
        if (verb.startsWith('mode-') || verb === 'acct-props' || verb === 'dry-run' || verb === 'expiry-status' || verb === 'expiry-rules' || verb === 'sweep-dry' || verb === 'sweep-apply') {
            const acct = state.accounts.get(rest);
            if (!acct) return true;
            try {
                if (verb === 'acct-props') { await accountSheet(c, acct); return true; }
                if (verb === 'dry-run') { dryRunDialog(c, acct); return true; }
                if (verb === 'expiry-status') { await expiryStatus(c, acct); return true; }
                if (verb === 'expiry-rules') { await expiryRulesDialog(c, acct); return true; }
                if (verb === 'sweep-dry' || verb === 'sweep-apply') {
                    const apply = verb === 'sweep-apply';
                    if (apply && await ask(c, `<p>Move the due mail of ${label(acct)} to Trash now?</p><p>Flagged mail is never moved. Mail in Trash can still be restored from there.</p>`, 'Expiry Sweep') !== true) return true;
                    c.note('Sweeping...');
                    const r = await send('ingest_expiry_sweep', Object.assign({ source: acct.source, accountId: acct.accountId, dryRun: !apply }, apply ? { confirm: true } : {}));
                    c.note('');
                    sweepResult(c, apply ? 'Expiry Sweep' : 'Expiry Sweep (Dry Run)', [r], !apply);
                    return true;
                }
                const r = await setMode(c, acct, verb.slice(5));
                if (r) c.note(`${accountName(acct)}: ${verb === 'mode-bypass' ? 'bypass' : verb === 'mode-apply' ? 'applying' : 'dry run'}.`);
            } catch (err) {
                c.note('');
                await failBox(c, `${accountName(acct)} was not changed.`, err);
            }
            return true;
        }
        if (verb === 'mod-on' || verb === 'mod-off' || verb === 'mod-props') {
            const i = rest.indexOf(':');
            const mod = rest.slice(0, i);
            const acct = state.accounts.get(rest.slice(i + 1));
            if (!acct) return true;
            if (verb === 'mod-props') { await moduleDialog(c, acct, mod); return true; }
            const on = verb === 'mod-on';
            const q = mod === 'expiry'
                ? `<p>Turn on Expiry for ${label(acct)}?</p><p>Its sweep moves due mail to Trash (in a dry run it only lists it). Flagged mail never expires.</p>`
                : null;
            try {
                const r = await configure(c, acct, mod, { enabled: on }, q);
                if (r) c.note(`${MOD_NAME[mod]} ${on ? 'turned on' : 'turned off'} for ${accountName(acct)}.`);
            } catch (err) { await failBox(c, `${MOD_NAME[mod]} was not changed.`, err); }
            return true;
        }
        if (verb === 'route-edit') {
            const i = rest.lastIndexOf('#');
            await routeDialog(c, state.accounts.get(rest.slice(0, i)), Number(rest.slice(i + 1)));
            return true;
        }
        if (verb === 'route-up') { await moveRoute(c, rest, -1); return true; }
        if (verb === 'route-down') { await moveRoute(c, rest, 1); return true; }
        if (verb === 'route-delete') { await moveRoute(c, rest, 0, true); return true; }
        if (verb === 'route-toggle') { await moveRoute(c, rest, 0, false, true); return true; }
        if (verb === 'route-groups') { await groupsDialog(c, state.accounts.get(rest.slice(0, rest.lastIndexOf('#')))); return true; }
        if (verb === 'mr-edit') { mailRuleDialog(c, (state.rules || []).find((r) => r.id === rest) || null); return true; }
        if (verb === 'mr-toggle') {
            const r = (state.rules || []).find((x) => x.id === rest);
            if (!r) return true;
            try { await send('bridge_mail_save_rule', { id: r.id, enabled: !r.enabled }); c.note(`The rule ${r.name || ''} was ${r.enabled ? 'disabled' : 'enabled'}.`); } catch (err) { await failBox(c, 'The rule was not changed.', err); }
            return true;
        }
        if (verb === 'mr-delete') {
            const r = (state.rules || []).find((x) => x.id === rest);
            if (!r) return true;
            if (await ask(c, `<p>Delete the mail rule <b>${esc(r.name || '(No name)')}</b>?</p><p>Mail it already moved stays where it is.</p>`, 'Delete Mail Rule') !== true) return true;
            try { await send('bridge_mail_delete_rule', { id: r.id, confirm: true }); c.sel = null; c.note('The rule was deleted.'); } catch (err) { await failBox(c, 'The rule was not deleted.', err); }
            return true;
        }
        return false;
    }

    // ---- dialogs (vistaDialogTemplate: Vista's controls) ------------------------------------------------------

    function templates() {
        const page = (t, c) => ({ t, w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c });
        const row = (id, y, text) => [[id, 'S', 7, y, 72, 8, SS, text, 0], [id + 1, 'S', 82, y, 163, 8, SS, '', 0]];
        const T = {
            'ing:acct-general': page('General', [
                [10, 'S', 7, 7, 21, 20, ICON, '', 0],
                [11, 'S', 44, 14, 201, 8, SS, '', 0],
                [12, 'S', 7, 34, 238, 1, ETCHED, '', 0],
                ...row(13, 44, 'Source:'),
                ...row(15, 58, 'Account:'),
                ...row(17, 72, 'Last changed:'),
                [20, 'B', 7, 90, 238, 92, GROUP, 'Mode', 0],
                [21, 'B', 14, 104, 224, 10, RADIO_FIRST, '&Bypass: messages arrive as they always have', 0],
                [22, 'B', 14, 120, 224, 10, RADIO, '&Process: run the pipeline on new messages', 0],
                [23, 'B', 26, 136, 212, 10, CHECK, '&Apply the actions the modules decide', 0],
                [24, 'S', 26, 150, 212, 26, SS, '', 0],
                [30, 'S', 7, 188, 238, 24, SS, '', 0]
            ]),
            'ing:acct-pipe': page('Pipeline', [
                [40, 'S', 7, 7, 238, 16, SS, 'The modules run in this order on each new message. A move or a delete stops the modules after it.', 0],
                [41, 'SysListView32', 7, 26, 238, 128, LV, '', EDGE],
                [42, 'B', 7, 160, 56, 14, PUSH, 'Move &Up', 0],
                [43, 'B', 67, 160, 56, 14, PUSH, 'Move &Down', 0],
                [44, 'B', 127, 160, 56, 14, PUSH, '&Enable', 0],
                [45, 'B', 187, 160, 56, 14, PUSH, 'D&isable', 0],
                [46, 'S', 7, 182, 238, 30, SS, '', 0]
            ]),
            'ing:spam': { t: '', w: 300, h: 250, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'B', 7, 7, 286, 10, CHECK, '&Turn on the spam filter for this account', 0],
                [101, 'B', 7, 22, 286, 104, GROUP, 'Mail (SpamAssassin)', 0],
                [102, 'S', 14, 38, 60, 8, SS, 'spamd &host:', 0], [103, 'E', 78, 36, 110, 13, EDIT, '', EDGE],
                [104, 'S', 194, 38, 22, 8, SS, 'P&ort:', 0], [105, 'E', 218, 36, 36, 13, EDIT, '', EDGE],
                [106, 'S', 14, 56, 60, 8, SS, 'T&hreshold:', 0], [107, 'E', 78, 54, 36, 13, EDIT, '', EDGE],
                [108, 'S', 120, 56, 50, 8, SS, 'Ti&meout (ms):', 0], [109, 'E', 174, 54, 40, 13, EDIT, '', EDGE],
                [110, 'S', 14, 74, 60, 8, SS, 'S&pam goes to:', 0], [111, 'C', 78, 72, 100, 60, COMBO, '', 0],
                [112, 'B', 14, 92, 270, 10, CHECK, '&Reuse the Exchange relay\'s own score', 0],
                [113, 'S', 14, 108, 60, 8, SS, 'A&llow from:', 0], [114, 'E', 78, 106, 206, 13, EDIT, '', EDGE],
                [115, 'B', 7, 132, 286, 66, GROUP, 'Texts', 0],
                [116, 'S', 14, 148, 60, 8, SS, 'Spam &numbers:', 0], [117, 'E', 78, 146, 206, 13, EDIT, '', EDGE],
                [118, 'S', 14, 166, 60, 8, SS, 'Thre&shold:', 0], [119, 'E', 78, 164, 36, 13, EDIT, '', EDGE],
                [120, 'S', 120, 166, 40, 8, SS, 'Th&en:', 0], [121, 'C', 160, 164, 90, 60, COMBO, '', 0],
                [122, 'S', 14, 182, 270, 12, SS, 'Separate addresses and numbers with commas. * matches anything.', 0],
                [123, 'B', 7, 206, 80, 14, PUSH, 'Test &Connection', 0],
                [124, 'S', 92, 209, 201, 12, SS, '', 0],
                [125, 'S', 7, 226, 180, 20, SS, '', 0],
                [1, 'B', 189, 229, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 243, 229, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ing:codes': { t: '', w: 260, h: 110, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'B', 7, 7, 246, 10, CHECK, '&Turn on code extraction for this account', 0],
                [101, 'B', 14, 24, 239, 10, CHECK, 'Also show &sign-in and verification links', 0],
                [102, 'B', 14, 40, 239, 10, CHECK, '&Mark the message read once its code was shown', 0],
                [103, 'S', 7, 58, 246, 18, SS, 'Codes go to Yukimi\'s devices only. They are never written to the log.', 0],
                [104, 'S', 7, 78, 140, 24, SS, '', 0],
                [1, 'B', 149, 89, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 203, 89, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ing:routing': { t: '', w: 260, h: 104, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'B', 7, 7, 246, 10, CHECK, '&Turn on the routing rules for this account', 0],
                [101, 'B', 14, 24, 239, 10, CHECK, 'Run the older &mail rules first (e-mail accounts)', 0],
                [102, 'S', 7, 42, 246, 18, SS, 'Add and change the rules themselves under Routing Rules.', 0],
                [103, 'S', 7, 66, 140, 30, SS, '', 0],
                [1, 'B', 149, 83, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 203, 83, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ing:expiry': { t: '', w: 260, h: 104, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'B', 7, 7, 246, 10, CHECK, '&Turn on expiry for this account', 0],
                [101, 'S', 14, 26, 120, 8, SS, 'Move at &most this many a sweep:', 0], [102, 'E', 138, 24, 40, 13, EDIT, '', EDGE],
                [103, 'S', 7, 44, 246, 18, SS, 'Add and change the expiry rules under Expiry. Flagged mail never expires.', 0],
                [104, 'S', 7, 66, 140, 30, SS, '', 0],
                [1, 'B', 149, 83, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 203, 83, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ing:route': { t: '', w: 320, h: 262, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 9, 50, 8, SS, '&Account:', 0], [101, 'C', 60, 7, 160, 80, COMBO, '', 0],
                [102, 'S', 7, 27, 50, 8, SS, '&Name:', 0], [103, 'E', 60, 25, 253, 13, EDIT, '', EDGE],
                [104, 'B', 60, 42, 100, 10, CHECK, '&Enabled', 0],
                [105, 'B', 164, 42, 149, 10, CHECK, '&Stop at this rule when it matches', 0],
                [106, 'B', 7, 56, 306, 86, GROUP, 'Conditions', 0],
                [107, 'S', 14, 70, 50, 8, SS, '&Match:', 0], [108, 'C', 60, 68, 120, 60, COMBO, '', 0],
                [109, 'SysListView32', 14, 86, 230, 50, LV, '', EDGE],
                [110, 'B', 250, 86, 56, 14, PUSH, 'A&dd...', 0],
                [111, 'B', 250, 104, 56, 14, PUSH, 'Ed&it...', 0],
                [112, 'B', 250, 122, 56, 14, PUSH, '&Remove', 0],
                [113, 'B', 7, 146, 306, 88, GROUP, 'Actions', 0],
                [114, 'S', 14, 162, 50, 8, SS, 'Mo&ve to:', 0], [115, 'E', 66, 160, 90, 13, EDIT, '', EDGE],
                [116, 'B', 164, 162, 70, 10, CHECK, '&Delete', 0],
                [117, 'B', 236, 162, 70, 10, CHECK, 'Mar&k read', 0],
                [118, 'S', 14, 180, 50, 8, SS, '&Forward to:', 0], [119, 'E', 66, 178, 90, 13, EDIT, '', EDGE],
                [120, 'B', 164, 180, 70, 10, CHECK, 'F&lag', 0],
                [121, 'B', 236, 180, 70, 10, CHECK, 'N&otify', 0],
                [122, 'S', 14, 198, 50, 8, SS, '&Hand to:', 0], [123, 'E', 66, 196, 90, 13, EDIT, '', EDGE],
                [124, 'B', 164, 198, 70, 10, CHECK, 'Silen&ce', 0],
                [125, 'S', 14, 216, 50, 8, SS, 'E&xpire after:', 0], [126, 'E', 66, 214, 40, 13, EDIT, '', EDGE],
                [127, 'S', 112, 216, 70, 8, SS, 'After &read:', 0], [128, 'E', 164, 214, 40, 13, EDIT, '', EDGE],
                [129, 'S', 210, 216, 96, 8, SS, 'Like 40d, 12h or 2w', 0],
                [130, 'S', 7, 240, 196, 20, SS, '', 0],
                [1, 'B', 209, 243, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 263, 243, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ing:cond': { t: '', w: 240, h: 120, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 9, 50, 8, SS, '&Field:', 0], [101, 'C', 60, 7, 90, 80, COMBO, '', 0],
                [102, 'S', 156, 9, 24, 8, SS, 'Na&me:', 0], [103, 'E', 182, 7, 51, 13, EDIT, '', EDGE],
                [104, 'S', 7, 27, 50, 8, SS, '&Test:', 0], [105, 'C', 60, 25, 90, 80, COMBO, '', 0],
                [106, 'S', 7, 45, 50, 8, SS, '&Value:', 0], [107, 'E', 60, 43, 173, 13, EDIT, '', EDGE],
                [108, 'B', 60, 62, 173, 10, CHECK, '&Does not match (not)', 0],
                [109, 'S', 7, 78, 226, 16, SS, 'For "is in group", the value is an allowlist group\'s name.', 0],
                [110, 'S', 7, 96, 120, 20, SS, '', 0],
                [1, 'B', 129, 99, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 183, 99, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ing:groups': { t: '', w: 300, h: 190, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 7, 286, 16, SS, '', 0],
                [101, 'E', 7, 26, 286, 120, MULTI, '', EDGE],
                [102, 'S', 7, 150, 286, 16, SS, 'One group a line: its name, a colon, then addresses, @domains or * patterns separated by commas.', 0],
                [103, 'S', 7, 170, 180, 16, SS, '', 0],
                [1, 'B', 189, 169, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 243, 169, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ing:xrules': { t: '', w: 320, h: 196, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 7, 306, 16, SS, '', 0],
                [101, 'SysListView32', 7, 26, 246, 130, LV, '', EDGE],
                [102, 'B', 257, 26, 56, 14, PUSH, '&Add...', 0],
                [103, 'B', 257, 44, 56, 14, PUSH, '&Edit...', 0],
                [104, 'B', 257, 62, 56, 14, PUSH, '&Remove', 0],
                [105, 'B', 257, 86, 56, 14, PUSH, '&Defaults', 0],
                [106, 'S', 7, 160, 246, 14, SS, 'Flagged mail never expires. The earliest matching rule wins.', 0],
                [107, 'S', 7, 176, 196, 16, SS, '', 0],
                [1, 'B', 209, 177, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 263, 177, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ing:xrule': { t: '', w: 280, h: 150, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 9, 70, 8, SS, '&Name:', 0], [101, 'E', 80, 7, 193, 13, EDIT, '', EDGE],
                [102, 'B', 80, 24, 193, 10, CHECK, '&Enabled', 0],
                [103, 'S', 7, 41, 70, 8, SS, '&Subject matches:', 0], [104, 'E', 80, 39, 193, 13, EDIT, '', EDGE],
                [105, 'S', 7, 59, 70, 8, SS, 'From &contains:', 0], [106, 'E', 80, 57, 193, 13, EDIT, '', EDGE],
                [107, 'S', 7, 77, 70, 8, SS, 'Expire &after:', 0], [108, 'E', 80, 75, 40, 13, EDIT, '', EDGE],
                [109, 'S', 126, 77, 60, 8, SS, 'After &read:', 0], [110, 'E', 188, 75, 40, 13, EDIT, '', EDGE],
                [111, 'S', 7, 94, 266, 16, SS, 'The subject pattern is a regular expression (case does not matter). Durations are like 40d, 12h or 2w.', 0],
                [112, 'S', 7, 112, 160, 34, SS, '', 0],
                [1, 'B', 169, 129, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 223, 129, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ing:mrule': { t: '', w: 280, h: 196, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 9, 60, 8, SS, '&Name:', 0], [101, 'E', 70, 7, 203, 13, EDIT, '', EDGE],
                [102, 'S', 7, 27, 60, 8, SS, '&Account:', 0], [103, 'C', 70, 25, 140, 80, COMBO, '', 0],
                [104, 'B', 70, 42, 120, 10, CHECK, '&Enabled', 0],
                [105, 'B', 7, 56, 266, 62, GROUP, 'When the message (contains)', 0],
                [106, 'S', 14, 70, 50, 8, SS, '&From:', 0], [107, 'E', 66, 68, 200, 13, EDIT, '', EDGE],
                [108, 'S', 14, 86, 50, 8, SS, '&To:', 0], [109, 'E', 66, 84, 200, 13, EDIT, '', EDGE],
                [110, 'S', 14, 102, 50, 8, SS, '&Subject:', 0], [111, 'E', 66, 100, 200, 13, EDIT, '', EDGE],
                [112, 'B', 7, 122, 266, 46, GROUP, 'Do this', 0],
                [113, 'B', 14, 136, 70, 10, CHECK, 'Mar&k read', 0],
                [114, 'B', 90, 136, 50, 10, CHECK, 'F&lag', 0],
                [115, 'B', 146, 136, 70, 10, CHECK, '&Delete', 0],
                [116, 'S', 14, 152, 50, 8, SS, 'Mo&ve to:', 0], [117, 'E', 66, 150, 120, 13, EDIT, '', EDGE],
                [118, 'S', 7, 172, 150, 20, SS, '', 0],
                [1, 'B', 169, 177, 50, 14, DEFPUSH, 'OK', 0],
                [2, 'B', 223, 177, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ing:mrun': { t: '', w: 340, h: 210, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 9, 50, 8, SS, '&Account:', 0], [101, 'C', 60, 7, 130, 80, COMBO, '', 0],
                [102, 'S', 196, 9, 30, 8, SS, '&Folder:', 0], [103, 'E', 228, 7, 105, 13, EDIT, '', EDGE],
                [104, 'S', 7, 26, 326, 18, SS, '', 0],
                [105, 'SysListView32', 7, 46, 326, 132, LV, '', EDGE],
                [106, 'B', 7, 189, 64, 14, PUSH, '&Preview', 0],
                [107, 'B', 75, 189, 80, 14, PUSH, '&Apply Rules...', 0],
                [108, 'S', 160, 192, 120, 14, SS, '', 0],
                [2, 'B', 283, 189, 50, 14, DEFPUSH, 'Close', 0]
            ] },
            'ing:dry': { t: '', w: 340, h: 250, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 7, 326, 16, SS, '', 0],
                [101, 'S', 7, 27, 50, 8, SS, '&From:', 0], [102, 'E', 60, 25, 273, 13, EDIT, '', EDGE],
                [103, 'S', 7, 45, 50, 8, SS, '&Subject:', 0], [104, 'E', 60, 43, 273, 13, EDIT, '', EDGE],
                [105, 'S', 7, 63, 50, 8, SS, '&Text:', 0], [106, 'E', 60, 61, 273, 36, MULTI, '', EDGE],
                [107, 'B', 60, 101, 130, 10, CHECK, 'Run &disabled modules too', 0],
                [108, 'B', 196, 101, 137, 10, CHECK, 'Score with spa&md', 0],
                [109, 'SysListView32', 7, 116, 326, 86, LV, '', EDGE],
                [110, 'S', 7, 206, 326, 20, SS, '', 0],
                [3, 'B', 229, 229, 50, 14, PUSH, '&Run', 0],
                [2, 'B', 283, 229, 50, 14, DEFPUSH, 'Close', 0]
            ] },
            'ing:list': { t: '', w: 340, h: 210, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 7, 7, 326, 16, SS, '', 0],
                [101, 'SysListView32', 7, 26, 326, 76, LV, '', EDGE],
                [102, 'SysListView32', 7, 106, 326, 78, LV, '', EDGE],
                [1, 'B', 283, 190, 50, 14, DEFPUSH, 'Close', 0]
            ] }
        };
        root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, T);
    }

    function api() {
        const a = root.vistaDialogTemplate;
        if (!a || typeof a.openSheet !== 'function') throw new Error('The dialog could not be shown.');
        templates();
        return a;
    }

    /** A list view in a dialog: cols [{ t, w }], rows [{ cells, icon? }] (Exchange's fillList). */
    function fillList(lv, cols, rows, empty) {
        if (!lv) return;
        lv.classList.add('is-report');
        const head = lv.querySelector('.vdt-lv-header');
        const body = lv.querySelector('.vdt-lv-body');
        head.innerHTML = cols.map((col) => `<span class="vdt-lv-col">${esc(col.t)}</span>`).join('');
        body.innerHTML = rows.length
            ? rows.map((r, i) => `<div class="vdt-lv-row" data-row="${i}">${r.cells.map((cell, j) => `<span title="${esc(cell)}">${j === 0 && r.icon ? `<img src="${esc(r.icon)}" alt="">` : ''}${esc(cell)}</span>`).join('')}</div>`).join('')
            : `<div class="vdt-lv-row" data-empty="1"><span>${esc(empty || '')}</span></div>`;
        // the columns' widths (a list view's header items)
        const widths = cols.map((col) => `${col.w}px`);
        head.querySelectorAll('.vdt-lv-col').forEach((el, j) => { el.style.width = widths[j]; });
        body.querySelectorAll('.vdt-lv-row:not([data-empty])').forEach((row) => row.querySelectorAll(':scope > span').forEach((el, j) => { if (widths[j]) el.style.width = widths[j]; }));
    }

    const selectedRow = (lv) => { const r = lv && lv.querySelector('.vdt-lv-row.is-selected:not([data-empty])'); return r ? Number(r.dataset.row) : -1; };
    const pickRow = (lv, i) => { if (!lv) return; lv.querySelectorAll('.vdt-lv-row').forEach((r) => r.classList.toggle('is-selected', Number(r.dataset.row) === i)); };
    const words = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

    function listDialog(c, title, note, cols, rows, empty, second) {
        api().openDialog({
            id: 'ingestListDialog', key: 'ing:list', title, owner: c.modal, icon: ICON16,
            init: (d) => {
                d.text(100, note || '');
                fillList(d.el(101), cols, rows, empty || 'There is nothing to show.');
                if (second) fillList(d.el(102), second.cols, second.rows, '');
                else d.show(102, false);
            }
        });
    }

    async function accountSheet(c, a0) {
        const key = keyOf(a0.source, a0.accountId);
        const mods = await modsOf(key);
        const a = state.accounts.get(key) || a0;
        const start = (mods ? mods.pipeline : (a.pipeline || [])).map((p) => ({ id: p.id, enabled: !!p.enabled }));
        const work = start.map((p) => Object.assign({}, p));
        const supported = (id) => id !== 'expiry' || MAIL.includes(a.source);
        const G = 'ing:acct-general';
        const P = 'ing:acct-pipe';
        api().openSheet({
            id: 'ingestAccountSheet',
            title: `${accountName(a)} Properties`,
            icon: ICON16,
            owner: c.modal,
            pages: [{ key: G, overrides: { 10: { image: IC[`${a.source}32`] } } }, { key: P }],
            init: (ctx) => {
                ctx.text(11, accountName(a), G);
                ctx.text(14, SOURCE_NAME[a.source], G);
                ctx.text(16, a.accountId, G);
                ctx.text(18, a.updated ? when(a.updated) : 'Never (bypass, as it always was)', G);
                ctx.set(21, a.mode !== 'process', G);
                ctx.set(22, a.mode === 'process', G);
                ctx.set(23, !!a.applying, G);
                const sync = () => {
                    const proc = !!ctx.get(22, G);
                    ctx.enable(23, proc, G);
                    ctx.text(24, !proc ? 'Nothing here touches its messages. E-mail accounts still run the mail rules.'
                        : ctx.get(23, G) ? 'New messages are moved, deleted, forwarded or handed on as the modules decide.'
                            : 'Dry run: what the modules decide is only written to the log.', G);
                };
                sync();
                [21, 22, 23].forEach((id) => ctx.on(id, 'change', sync, G));
                const lv = ctx.el(41, P);
                const paint = (sel) => {
                    fillList(lv, [{ t: 'Order', w: 44 }, { t: 'Module', w: 130 }, { t: 'Status', w: 150 }],
                        work.map((p, i) => ({ icon: IC[p.id], cells: [String(i + 1), MOD_NAME[p.id] || p.id, !supported(p.id) ? 'Not for this account' : p.enabled ? 'Enabled' : 'Disabled'] })), '');
                    pickRow(lv, sel);
                    syncPipe();
                };
                const syncPipe = () => {
                    const i = selectedRow(lv);
                    const p = work[i];
                    ctx.enable(42, i > 0, P);
                    ctx.enable(43, i >= 0 && i < work.length - 1, P);
                    ctx.enable(44, !!p && !p.enabled && supported(p.id), P);
                    ctx.enable(45, !!p && p.enabled, P);
                    ctx.text(46, p ? (MODULES.find((m) => m[0] === p.id) || [])[2] || '' : 'Select a module to move it or turn it on or off.', P);
                };
                lv.addEventListener('change', (ev) => { ev.stopPropagation(); syncPipe(); });
                const mv = (d) => { const i = selectedRow(lv); const j = i + d; if (i < 0 || j < 0 || j >= work.length) return; [work[i], work[j]] = [work[j], work[i]]; paint(j); ctx.dirty(); };
                ctx.on(42, 'click', () => mv(-1), P);
                ctx.on(43, 'click', () => mv(1), P);
                ctx.on(44, 'click', () => { const i = selectedRow(lv); if (work[i]) { work[i].enabled = true; paint(i); ctx.dirty(); } }, P);
                ctx.on(45, 'click', () => { const i = selectedRow(lv); if (work[i]) { work[i].enabled = false; paint(i); ctx.dirty(); } }, P);
                paint(-1);
            },
            apply: async (ctx) => {
                const cur = state.accounts.get(key) || a;
                const proc = !!ctx.get(22, G);
                const apply = proc && !!ctx.get(23, G);
                try {
                    // the pipeline first (while dry-run it needs no confirmation), then the mode
                    for (let i = 0; i < work.length; i += 1) {
                        const was = start.findIndex((p) => p.id === work[i].id);
                        const before = start[was];
                        if (was === i && before.enabled === work[i].enabled) continue;
                        const patch = { position: i };
                        if (before.enabled !== work[i].enabled) patch.enabled = work[i].enabled;
                        const r = await configure(c, cur, work[i].id, patch, work[i].id === 'expiry' && work[i].enabled
                            ? `<p>Turn on Expiry for ${label(cur)}?</p><p>Its sweep moves due mail to Trash (in a dry run it only lists it). Flagged mail never expires.</p>` : null);
                        if (!r) return false;
                        start.splice(was, 1);
                        start.splice(i, 0, Object.assign({}, work[i]));
                    }
                    const now = state.accounts.get(key) || cur;
                    const wasProc = now.mode === 'process';
                    // straight from bypass to applying is one change (and one question)
                    if (!proc && wasProc) await setMode(c, now, 'bypass');
                    else if (proc && apply && (!wasProc || !now.applying)) { if (!await setMode(c, now, 'apply')) return false; }
                    else if (proc && !apply && !wasProc) { if (!await setMode(c, now, 'process')) return false; }
                    else if (proc && !apply && now.applying) await setMode(c, now, 'dry');
                    ctx.text(30, '', G);
                    state.mods.delete(key);
                    return true;
                } catch (err) {
                    ctx.text(30, (err && err.message) || 'The changes were not saved.', G);
                    ctx.selectPage(G);
                    return false;
                }
            }
        });
    }

    async function moduleDialog(c, a, moduleId) {
        const key = keyOf(a.source, a.accountId);
        if (moduleId === 'expiry' && !MAIL.includes(a.source)) { await c.box('<p>Expiry is for mail. Texts are not tagged or swept.</p>', null, { icon: 'info' }); return; }
        const mods = await modsOf(key);
        const e = mods && mods.pipeline.find((p) => p.id === moduleId);
        if (!e) { await failBox(c, `The settings of ${accountName(a)} could not be read.`, state.modsError); return; }
        const s = e.settings || {};
        const title = `${MOD_NAME[moduleId]} - ${accountName(a)}`;
        const save = async (d, errId, patch) => {
            try {
                const r = await configure(c, a, moduleId, patch);
                if (!r) return false;
                state.mods.delete(key);
                c.note(`${MOD_NAME[moduleId]} was saved for ${accountName(a)}.`);
                return true;
            } catch (err) { d.text(errId, (err && err.message) || 'The settings were not saved.'); return false; }
        };
        const opts = { owner: c.modal, icon: ICON16, title, focusFirst: true };
        if (moduleId === 'spamFilter') {
            const ACTION = [['junk', 'Junk'], ['trash', 'Trash']];
            const TEXT = [['silence', 'Silence it'], ['delete', 'Delete it']];
            const fromText = (list, v) => (list.find((x) => x[1] === String(v).trim()) || list.find((x) => x[0] === String(v).trim()) || [null])[0];
            api().openDialog(Object.assign({}, opts, {
                id: 'ingestSpamDialog', key: 'ing:spam',
                init: (d) => {
                    d.set(100, !!e.enabled);
                    d.set(103, s.host || ''); d.set(105, String(s.port || '')); d.set(107, String(s.threshold || '')); d.set(109, String(s.timeoutMs || ''));
                    d.options(111, ACTION.map((x) => x[1])); d.set(111, (ACTION.find((x) => x[0] === s.action) || ACTION[0])[1]);
                    d.set(112, s.trustRelayScore !== false);
                    d.set(114, (s.allowFrom || []).join(', '));
                    d.set(117, (s.spamNumbers || []).join(', ')); d.set(119, String(s.textThreshold || ''));
                    d.options(121, TEXT.map((x) => x[1])); d.set(121, (TEXT.find((x) => x[0] === s.textAction) || TEXT[0])[1]);
                    const isSms = a.source === 'sms';
                    [102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 123].forEach((id) => d.enable(id, !isSms));
                    [116, 117, 118, 119, 120, 121].forEach((id) => d.enable(id, isSms));
                    if (a.source !== 'exchange') d.enable(112, false);
                },
                buttons: {
                    123: async (d) => {
                        d.text(124, 'Testing...');
                        try {
                            const r = await send('ingest_list_modules', { source: a.source, accountId: a.accountId, probe: true });
                            const p = r.spamd || {};
                            state.spamd = p;
                            d.text(124, p.ok ? `spamd answered${p.ms != null ? ` in ${p.ms} ms` : ''}.` : `spamd did not answer${p.error ? `: ${p.error}` : '.'}`);
                        } catch (err) { d.text(124, (err && err.message) || 'The test failed.'); }
                    }
                },
                ok: (d) => {
                    const action = fromText(ACTION, d.get(111));
                    const textAction = fromText(TEXT, d.get(121));
                    if (!action || !textAction) { d.text(125, 'Pick an entry from the list.'); return false; }
                    const settings = a.source === 'sms'
                        ? { spamNumbers: words(d.get(117)), textThreshold: Number(d.get(119)), textAction }
                        : { host: String(d.get(103) || '').trim(), port: Number(d.get(105)), threshold: Number(d.get(107)), timeoutMs: Number(d.get(109)), action, trustRelayScore: !!d.get(112), allowFrom: words(d.get(114)) };
                    return save(d, 125, { enabled: !!d.get(100), settings });
                }
            }));
        } else if (moduleId === 'codeExtraction') {
            api().openDialog(Object.assign({}, opts, {
                id: 'ingestCodesDialog', key: 'ing:codes',
                init: (d) => { d.set(100, !!e.enabled); d.set(101, s.links !== false); d.set(102, !!s.markRead); },
                ok: (d) => save(d, 104, { enabled: !!d.get(100), settings: { links: !!d.get(101), markRead: !!d.get(102) } })
            }));
        } else if (moduleId === 'routing') {
            api().openDialog(Object.assign({}, opts, {
                id: 'ingestRoutingDialog', key: 'ing:routing',
                init: (d) => { d.set(100, !!e.enabled); d.set(101, s.includeLegacyRules !== false); d.enable(101, a.source === 'email'); },
                ok: (d) => save(d, 103, { enabled: !!d.get(100), settings: { includeLegacyRules: !!d.get(101) } })
            }));
        } else {
            api().openDialog(Object.assign({}, opts, {
                id: 'ingestExpiryDialog', key: 'ing:expiry',
                init: (d) => { d.set(100, !!e.enabled); d.set(102, String(s.maxPerSweep || 200)); },
                ok: (d) => save(d, 104, { enabled: !!d.get(100), settings: { maxPerSweep: Number(d.get(102)) } })
            }));
        }
    }

    /** One condition: { field, op, value[], group, header, not }. done(cond) on OK. */
    function condDialog(c, cond, done) {
        const x = cond || { field: 'from', op: 'contains', value: [] };
        api().openDialog({
            id: 'ingestCondDialog', key: 'ing:cond', title: cond ? 'Edit Condition' : 'Add Condition', owner: c.modal, icon: ICON16, focusFirst: true,
            init: (d) => {
                d.options(101, FIELD_KEYS.map((k) => FIELD_NAMES[k])); d.set(101, FIELD_NAMES[x.field] || 'From');
                d.options(105, OP_KEYS.map((k) => OP_NAMES[k])); d.set(105, OP_NAMES[x.op] || 'contains');
                d.set(103, x.header || '');
                d.set(107, x.op === 'in' ? (x.group || '') : (Array.isArray(x.value) ? x.value : [x.value]).filter(Boolean).join(', '));
                d.set(108, !!x.not);
                const sync = () => { const f = FIELD_KEYS.find((k) => FIELD_NAMES[k] === d.get(101)); d.enable(103, f === 'header'); d.enable(107, OP_KEYS.find((k) => OP_NAMES[k] === d.get(105)) !== 'exists'); };
                sync();
                d.on(101, 'change', sync); d.on(105, 'change', sync); d.on(101, 'input', sync); d.on(105, 'input', sync);
            },
            ok: (d) => {
                const field = FIELD_KEYS.find((k) => FIELD_NAMES[k] === String(d.get(101)).trim());
                const op = OP_KEYS.find((k) => OP_NAMES[k] === String(d.get(105)).trim());
                if (!field || !op) { d.text(110, 'Pick a field and a test from the lists.'); return false; }
                const out = { field, op };
                if (field === 'header') { out.header = String(d.get(103) || '').trim(); if (!out.header) { d.text(110, 'Type the header\'s name.'); return false; } }
                const v = String(d.get(107) || '').trim();
                if (op === 'in') { if (!v) { d.text(110, 'Type a group\'s name.'); return false; } out.group = v; }
                else if (op !== 'exists') {
                    out.value = op === 'regex' ? [v] : words(v);
                    if (!v) { d.text(110, 'Type a value.'); return false; }
                }
                if (d.get(108)) out.not = true;
                done(out);
                return true;
            }
        });
    }

    /** A routing rule: a (null = choose the account), idx -1 = a new rule. */
    async function routeDialog(c, a0, idx) {
        const list = accounts();
        if (!list.length) { await c.box('<p>There are no accounts yet.</p>', null, { icon: 'info' }); return; }
        const a = a0 || list.find((x) => x.mode === 'process') || list[0];
        const key = keyOf(a.source, a.accountId);
        await modsOf(key);
        const e = entryOf(key, 'routing');
        const r0 = idx >= 0 && e ? ruleOut((e.settings.rules || [])[idx]) : { name: '', enabled: true, stop: true, match: { all: [], any: [], none: [] }, actions: {} };
        const conds = [].concat((r0.match.all || []).map((x) => Object.assign({ set: 'all' }, x)), (r0.match.any || []).map((x) => Object.assign({ set: 'any' }, x)), (r0.match.none || []).map((x) => Object.assign({ set: 'none' }, x, { not: !x.not })));
        const MATCH = ['All of these conditions', 'Any of these conditions'];
        const names = list.map((x) => `${accountName(x)} (${SOURCE_NAME[x.source]})`);
        api().openDialog({
            id: 'ingestRouteDialog', key: 'ing:route', title: idx >= 0 ? 'Edit Rule' : 'New Rule', owner: c.modal, icon: ICON16, focusFirst: true,
            init: (d) => {
                d.options(101, names); d.set(101, names[list.indexOf(a)]);
                if (idx >= 0) d.enable(101, false);
                d.set(103, r0.name || ''); d.set(104, r0.enabled !== false); d.set(105, r0.stop !== false);
                d.options(108, MATCH); d.set(108, (r0.match.any || []).length && !(r0.match.all || []).length ? MATCH[1] : MATCH[0]);
                const ac = r0.actions || {};
                d.set(115, ac.moveTo || ''); d.set(116, !!ac.delete); d.set(117, !!ac.markRead); d.set(119, ac.forwardTo || ''); d.set(120, !!ac.flag);
                d.set(121, !!ac.notify); d.set(123, ac.handTo || ''); d.set(124, !!ac.silence);
                d.set(126, (ac.expire && ac.expire.after) || ''); d.set(128, (ac.expire && ac.expire.afterRead) || '');
                const lv = d.el(109);
                const paint = (sel) => { fillList(lv, [{ t: 'Condition', w: 330 }], conds.map((x) => ({ cells: [condText(x)] })), 'No conditions: add at least one.'); pickRow(lv, sel); sync(); };
                const sync = () => { const i = selectedRow(lv); d.enable(111, i >= 0); d.enable(112, i >= 0); };
                lv.addEventListener('change', (ev) => { ev.stopPropagation(); sync(); });
                d.on(110, 'click', () => condDialog(c, null, (x) => { conds.push(x); paint(conds.length - 1); }));
                d.on(111, 'click', () => { const i = selectedRow(lv); if (i >= 0) condDialog(c, conds[i], (x) => { conds[i] = x; paint(i); }); });
                d.on(112, 'click', () => { const i = selectedRow(lv); if (i >= 0) { conds.splice(i, 1); paint(-1); } });
                lv.addEventListener('dblclick', () => { const i = selectedRow(lv); if (i >= 0) condDialog(c, conds[i], (x) => { conds[i] = x; paint(i); }); });
                paint(-1);
            },
            ok: async (d) => {
                const target = list[names.indexOf(String(d.get(101)))];
                if (!target) { d.text(130, 'Pick an account from the list.'); return false; }
                if (!conds.length) { d.text(130, 'Add at least one condition.'); return false; }
                const any = String(d.get(108)) === MATCH[1];
                const match = any ? { all: [], any: conds.map(({ set, ...x }) => x), none: [] } : { all: conds.map(({ set, ...x }) => x), any: [], none: [] };
                const actions = {};
                const t = (id) => String(d.get(id) || '').trim();
                if (t(115)) actions.moveTo = t(115);
                if (d.get(116)) actions.delete = true;
                if (d.get(117)) actions.markRead = true;
                if (t(119)) actions.forwardTo = t(119);
                if (d.get(120)) actions.flag = true;
                if (d.get(121)) actions.notify = true;
                if (t(123)) actions.handTo = t(123);
                if (d.get(124)) actions.silence = true;
                if (t(126) || t(128)) { actions.expire = {}; if (t(126)) actions.expire.after = t(126); if (t(128)) actions.expire.afterRead = t(128); }
                const rule = Object.assign({}, idx >= 0 ? r0 : {}, { name: t(103), enabled: !!d.get(104), stop: !!d.get(105), match, actions });
                const tk = keyOf(target.source, target.accountId);
                await modsOf(tk);
                const te = entryOf(tk, 'routing');
                const rules = ((te && te.settings.rules) || []).map(ruleOut);
                if (idx >= 0) rules[idx] = rule; else rules.push(rule);
                const risky = actions.delete || actions.forwardTo;
                try {
                    const r = await configure(c, target, 'routing', { settings: { rules } }, risky
                        ? `<p>Save the rule <b>${esc(rule.name || '(No name)')}</b> on ${label(target)}?</p><p>It ${actions.delete ? 'deletes' : 'forwards'} the messages it matches.</p>` : null);
                    if (!r) return false;
                    state.mods.delete(tk);
                    await loadMods(c, tk);
                    c.note('The rule was saved.');
                    c.refresh();
                    return true;
                } catch (err) { d.text(130, (err && err.message) || 'The rule was not saved.'); return false; }
            }
        });
    }

    async function groupsDialog(c, a) {
        if (!a) return;
        const key = keyOf(a.source, a.accountId);
        await modsOf(key);
        const e = entryOf(key, 'routing');
        const groups = (e && e.settings.groups) || {};
        api().openDialog({
            id: 'ingestGroupsDialog', key: 'ing:groups', title: `Allowlist Groups - ${accountName(a)}`, owner: c.modal, icon: ICON16, focusFirst: true,
            init: (d) => {
                d.text(100, 'Conditions with the test "is in group" match the sender or recipients against these groups.');
                d.set(101, Object.entries(groups).map(([n, l]) => `${n}: ${(l || []).join(', ')}`).join('\n'));
            },
            ok: async (d) => {
                const out = {};
                for (const line of String(d.get(101) || '').split('\n')) {
                    const s = line.trim();
                    if (!s) continue;
                    const i = s.indexOf(':');
                    if (i < 1) { d.text(103, `"${s.slice(0, 30)}" needs a name and a colon.`); return false; }
                    out[s.slice(0, i).trim()] = words(s.slice(i + 1));
                }
                const rules = ((e && e.settings.rules) || []).map(ruleOut);
                try {
                    const r = await configure(c, a, 'routing', { settings: { groups: out, rules } });
                    if (!r) return false;
                    state.mods.delete(key);
                    await loadMods(c, key);
                    c.note('The groups were saved.');
                    return true;
                } catch (err) { d.text(103, (err && err.message) || 'The groups were not saved.'); return false; }
            }
        });
    }

    /** An expiry rule as configureModule takes it back. */
    function xruleOut(r) {
        const o = { id: r.id, name: r.name || '', enabled: r.enabled !== false };
        if (r.subjectRegex) o.subjectRegex = r.subjectRegex;
        if (r.match) o.match = r.match;
        if (r.afterMs) o.after = duration(r.afterMs);
        if (r.afterReadMs) o.afterRead = duration(r.afterReadMs);
        if (r.after) o.after = r.after;
        if (r.afterRead) o.afterRead = r.afterRead;
        return o;
    }

    function xruleDialog(c, r, done) {
        const x = r || { name: '', enabled: true };
        const fromCond = x.match && (x.match.all || []).find((k) => k.field === 'from' && k.op === 'contains');
        api().openDialog({
            id: 'ingestExpiryRuleDialog', key: 'ing:xrule', title: r ? 'Edit Expiry Rule' : 'New Expiry Rule', owner: c.modal, icon: ICON16, focusFirst: true,
            init: (d) => {
                d.set(101, x.name || ''); d.set(102, x.enabled !== false); d.set(104, x.subjectRegex || '');
                d.set(106, fromCond ? (fromCond.value || []).join(', ') : '');
                d.set(108, x.after || ''); d.set(110, x.afterRead || '');
                // conditions other than "From contains" stay as they are (MCP can set them)
            },
            ok: (d) => {
                const t = (id) => String(d.get(id) || '').trim();
                if (!t(108) && !t(110)) { d.text(112, 'Type when it expires: after arrival, after it is read, or both.'); return false; }
                const out = Object.assign({}, x, { name: t(101), enabled: !!d.get(102) });
                if (t(104)) out.subjectRegex = t(104); else delete out.subjectRegex;
                const others = x.match ? (x.match.all || []).filter((k) => k !== fromCond) : [];
                const all = others.concat(t(106) ? [{ field: 'from', op: 'contains', value: words(t(106)) }] : []);
                if (all.length || (x.match && ((x.match.any || []).length || (x.match.none || []).length))) out.match = { all, any: (x.match && x.match.any) || [], none: (x.match && x.match.none) || [] };
                else delete out.match;
                if (t(108)) out.after = t(108); else delete out.after;
                if (t(110)) out.afterRead = t(110); else delete out.afterRead;
                delete out.afterMs;
                delete out.afterReadMs;
                done(out);
                return true;
            }
        });
    }

    async function expiryRulesDialog(c, a) {
        const key = keyOf(a.source, a.accountId);
        await modsOf(key);
        const e = entryOf(key, 'expiry');
        if (!e) { await failBox(c, `The expiry rules of ${accountName(a)} could not be read.`, state.modsError); return; }
        let rules = (e.settings.rules || []).map(xruleOut);
        api().openDialog({
            id: 'ingestExpiryRulesDialog', key: 'ing:xrules', title: `Expiry Rules - ${accountName(a)}`, owner: c.modal, icon: ICON16,
            init: (d) => {
                d.text(100, `${e.enabled ? 'Expiry is on.' : 'Expiry is off: these rules apply once it is turned on.'} A message expires when a rule matches it, then the sweep moves it to Trash.`);
                const lv = d.el(101);
                const paint = (sel) => {
                    fillList(lv, [{ t: 'Rule', w: 200 }, { t: 'Expires', w: 120 }, { t: 'Status', w: 60 }],
                        rules.map((r) => ({ cells: [r.name || r.subjectRegex || '(No name)', [r.after ? `${r.after} after arrival` : '', r.afterRead ? `${r.afterRead} after read` : ''].filter(Boolean).join(', '), r.enabled === false ? 'Disabled' : 'Enabled'] })), 'No rules: nothing expires.');
                    pickRow(lv, sel);
                    sync();
                };
                const sync = () => { const i = selectedRow(lv); d.enable(103, i >= 0); d.enable(104, i >= 0); };
                lv.addEventListener('change', (ev) => { ev.stopPropagation(); sync(); });
                const edit = () => { const i = selectedRow(lv); if (i >= 0) xruleDialog(c, rules[i], (r) => { rules[i] = r; paint(i); }); };
                d.on(102, 'click', () => xruleDialog(c, null, (r) => { rules.push(r); paint(rules.length - 1); }));
                d.on(103, 'click', edit);
                lv.addEventListener('dblclick', edit);
                d.on(104, 'click', () => { const i = selectedRow(lv); if (i >= 0) { rules.splice(i, 1); paint(-1); } });
                d.on(105, 'click', () => { rules = null; d.text(100, 'The two default rules will be restored: payment-failure notices 40 days after they arrive, and any mail 7 days after it was first read.'); fillList(lv, [{ t: 'Rule', w: 380 }], [{ cells: ['The default rules'] }], ''); sync(); });
                paint(-1);
            },
            ok: async (d) => {
                try {
                    const patch = rules === null ? { reset: true, settings: { maxPerSweep: (e.settings && e.settings.maxPerSweep) || 200 } } : { settings: { rules } };
                    if (rules === null) patch.enabled = !!e.enabled;
                    const r = await configure(c, a, 'expiry', patch);
                    if (!r) return false;
                    state.mods.delete(key);
                    await loadMods(c, key);
                    c.note('The expiry rules were saved.');
                    return true;
                } catch (err) { d.text(107, (err && err.message) || 'The rules were not saved.'); return false; }
            }
        });
    }

    const emailAccounts = () => accounts('email');

    function mailRuleDialog(c, r) {
        const list = emailAccounts();
        const names = ['All accounts'].concat(list.map((x) => accountName(x)));
        const idOf = (name) => (name === 'All accounts' ? '*' : (list.find((x) => accountName(x) === name) || {}).accountId);
        const x = r || { name: '', accountId: '*', enabled: true, match: {}, actions: {} };
        api().openDialog({
            id: 'ingestMailRuleDialog', key: 'ing:mrule', title: r ? 'Edit Mail Rule' : 'New Mail Rule', owner: c.modal, icon: ICON16, focusFirst: true,
            init: (d) => {
                d.set(101, x.name || '');
                d.options(103, names);
                const cur = x.accountId === '*' ? 'All accounts' : accountName(list.find((y) => y.accountId === x.accountId) || { accountId: x.accountId });
                d.set(103, cur);
                d.set(104, x.enabled !== false);
                d.set(107, x.match.from || ''); d.set(109, x.match.to || ''); d.set(111, x.match.subject || '');
                d.set(113, !!x.actions.markRead); d.set(114, !!x.actions.flag); d.set(115, !!x.actions.delete); d.set(117, x.actions.moveTo || '');
            },
            ok: async (d) => {
                const t = (id) => String(d.get(id) || '').trim();
                const accountId = idOf(t(103)) || (/^[a-z0-9][a-z0-9_-]{0,31}$/.test(t(103)) ? t(103) : null);
                if (!accountId) { d.text(118, 'Pick an account from the list.'); return false; }
                const match = {};
                if (t(107)) match.from = t(107);
                if (t(109)) match.to = t(109);
                if (t(111)) match.subject = t(111);
                const actions = {};
                if (d.get(113)) actions.markRead = true;
                if (d.get(114)) actions.flag = true;
                if (d.get(115)) actions.delete = true;
                if (t(117)) actions.moveTo = t(117);
                try {
                    await send('bridge_mail_save_rule', Object.assign(r ? { id: r.id } : {}, { name: t(101), accountId, enabled: !!d.get(104), match, actions }));
                    c.note('The mail rule was saved.');
                    return true;
                } catch (err) { d.text(118, (err && err.message) || 'The rule was not saved.'); return false; }
            }
        });
    }

    function runRulesDialog(c, ruleId) {
        const list = emailAccounts();
        const rule = ruleId ? (state.rules || []).find((x) => x.id === ruleId) : null;
        const names = list.map((x) => accountName(x));
        api().openDialog({
            id: 'ingestRunRulesDialog', key: 'ing:mrun', title: rule ? `Run Rule - ${rule.name || '(No name)'}` : 'Run Mail Rules', owner: c.modal, icon: ICON16,
            init: (d) => {
                d.options(101, names);
                const first = rule && rule.accountId !== '*' ? list.find((x) => x.accountId === rule.accountId) : list[0];
                d.set(101, first ? accountName(first) : '');
                d.set(103, 'INBOX');
                d.text(104, 'Preview shows what the rules would do to mail already in the folder. Nothing changes until you apply them.');
                fillList(d.el(105), [{ t: 'Rule', w: 150 }, { t: 'Messages', w: 70 }, { t: 'Actions', w: 250 }], [], 'Click Preview.');
                d.enable(107, false);
                const run = async (dry) => {
                    const a = list.find((x) => accountName(x) === String(d.get(101)).trim());
                    if (!a) { d.text(108, 'Pick an account.'); return; }
                    const folder = String(d.get(103) || 'INBOX').trim() || 'INBOX';
                    if (!dry && await ask(c, `<p>Apply ${rule ? 'this rule' : 'the mail rules'} to the mail in ${esc(folder)} of ${label(a)} now?</p><p>Matching messages are marked, flagged, moved or deleted (to Trash) right away.</p>`, 'Run Mail Rules') !== true) return;
                    d.text(108, dry ? 'Previewing...' : 'Applying...');
                    try {
                        const r = await send('bridge_mail_run_rules', Object.assign({ accountId: a.accountId, folder, ruleId: rule ? rule.id : undefined, dryRun: dry }, dry ? {} : { confirm: true }));
                        if (dry) {
                            fillList(d.el(105), [{ t: 'Rule', w: 150 }, { t: 'Messages', w: 70 }, { t: 'Actions', w: 250 }], (r.groups || []).map((g) => ({ cells: [g.name || g.ruleId, String(g.count || 0), actionsText(g.actions)] })), 'No message matches.');
                            d.enable(107, (r.matched || 0) > 0);
                            d.text(108, `${plural(r.matched || 0, 'message matches', 'messages match')}.`);
                        } else {
                            d.text(108, `Applied to ${plural(r.matched || 0, 'message', 'messages')}.`);
                            d.enable(107, false);
                        }
                    } catch (err) { d.text(108, (err && err.message) || 'The rules did not run.'); }
                };
                d.on(106, 'click', () => void run(true));
                d.on(107, 'click', () => void run(false));
            }
        });
    }

    function dryRunDialog(c, a) {
        api().openDialog({
            id: 'ingestDryRunDialog', key: 'ing:dry', title: `Dry Run - ${accountName(a)}`, owner: c.modal, icon: ICON16, focusFirst: true,
            init: (d) => {
                d.text(100, `Type a message to see what the pipeline of ${accountName(a)} would do with it. Nothing is applied. Keep real verification codes out of it.`);
                d.set(108, true);
                d.enable(108, a.source !== 'sms');
                fillList(d.el(109), [{ t: 'Module', w: 120 }, { t: 'Decision', w: 350 }], [], 'Click Run.');
            },
            buttons: {
                3: async (d) => {
                    const t = (id) => String(d.get(id) || '').trim();
                    if (!t(102) && !t(104) && !t(106)) { d.text(110, 'Type a sender, a subject or some text.'); return; }
                    d.text(110, 'Running...');
                    try {
                        const r = await send('ingest_dry_run', { source: a.source, accountId: a.accountId, message: { from: t(102), subject: t(104), text: String(d.get(106) || '') }, allModules: !!d.get(107), scoreSpam: a.source !== 'sms' && !!d.get(108) });
                        const rows = (r.trace || []).map((s) => {
                            let what = !s.ran ? (s.note && s.note.skipped ? `Skipped: ${s.note.skipped}` : 'Off') : s.error ? `Failed open: ${s.error}` : (s.actions || []).map(logAction).join(', ') || 'No action';
                            if (s.ran && s.note && s.note.score != null) what += ` (score ${s.note.score})`;
                            return { icon: IC[s.module], cells: [MOD_NAME[s.module] || s.module, what] };
                        });
                        fillList(d.el(109), [{ t: 'Module', w: 120 }, { t: 'Decision', w: 350 }], rows, 'No module ran.');
                        d.text(110, `${r.note ? `${r.note} ` : ''}Would do: ${(r.actions || []).map(logAction).join(', ') || 'nothing'}.`);
                    } catch (err) { d.text(110, (err && err.message) || 'The dry run failed.'); }
                }
            }
        });
    }

    // ---- status and the console -------------------------------------------------------------------------------

    function status(node) {
        if (state.denied) return '';
        const id = node.id;
        if (!state.feedOn) return state.feedError ? 'The Ingest Controller could not be read.' : 'Reading data, please wait...';
        if (id === 'log') return state.log.loading ? 'Reading the log...' : `${plural((state.log.entries || []).length, 'entry', 'entries')}`;
        if (needsMods(id) && state.modsLoading) return 'Reading the settings...';
        const proc = accounts().filter((a) => a.mode === 'process').length;
        return `${plural(state.accounts.size, 'account', 'accounts')}, ${proc} processing`;
    }

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: ICON16,
            icon32: ICON32,
            taskbarIcon: ICON32,
            treeWidth: 190,
            expanded: ['root', 'accounts'],
            nodes,
            page,
            commands,
            selCommands,
            viewMenu,
            action,
            rowOpen,
            status,
            help: () => { if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('ingest-controller'); },
            about: { version: '1.0.0', lines: ['Runs the pipeline between the places mail and texts arrive and Yukimi\'s inboxes: spam filter, code extraction, routing rules and expiry, per account.'] },
            onClose: () => {
                state.console = null;
                state.mods.clear();
                state.log = { source: '', before: null, stack: [], entries: null, more: false, loading: false, error: '' };
                void want(false);
            }
        };
    }

    async function openIngestController(node) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        return root.mmcConsole.open(def(), node ? { node: String(node) } : {});
    }

    root.openIngestController = openIngestController;
    root.mmcIngest = { open: openIngestController, def, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
