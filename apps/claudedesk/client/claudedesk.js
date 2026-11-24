/**
 * Claude Accounts (desktop): an MMC 3.0 console (mmcConsole.js, the shell Server Manager and the other
 * snap-ins share) over the host's Claude accounts, its Remote Control, every Claude session on the host and
 * the agents' coordination. The phone has the same accounts and host in Melaton Mobile's Claude Accounts
 * (wmClaudeAccounts.js); both use one backend.
 *
 *   Claude Accounts (Local)     summary: the engine's account, Remote Control, sessions running, agents
 *     Accounts                  CardSpace's Claude accounts: Switch To (the engine's account + Remote
 *                               Control's login), Link Host Login, Unlink, New Session on This Account,
 *                               Add Account... (sign in: a link to copy / open in Alchemy, the code back)
 *     Remote Control            every account's own Remote Control (#1154: each account in its own config
 *                               folder, its own claude-remote@<id>.service): state, sessions, Move to Own
 *                               Folder / Start / Stop / Reconnect / Leave Own Folder
 *       Host Login              the legacy claude-remote.service (the host's ~/.claude login) for the
 *                               account not moved yet: state, sessions / capacity, login, Reconnect / Start / Stop
 *     Sessions                  every session on the host (~/.claude/projects), newest first, with the
 *                               account it runs on: Open (the chat), Resume in Remote Control (no fork),
 *                               Send Message..., Stop Current Turn, Open in claude.ai, End
 *       Running                 the ones running now
 *       <session>               an open session's chat: earlier messages on demand, new ones as they are
 *                               written; a box to send it a message (steering while it works)
 *     Coordination              the agent-coord MCP server's store
 *       Agents / Claims / Messages   who works on what, the files they claimed, notes and steering
 *       Build Gates / Busy Locks      builds waiting on every agent's ready, the repo's .agent-* locks
 *       Inspect: <agent>        what one agent is doing: files it edited, commands, last words, claims
 *
 * Server: 313-claudeAccountsHandler (accounts, host, sign-in) and 314-claudeDeskHandler (sessions,
 * transcripts, steering, coordination; the claude_desk / claude_desk_flux status feeds, subscribed while
 * the window is open). Admin only. Nothing here ever holds a token: the server sends none.
 *
 *   melatonApps.define('claudedesk', start)
 */
(function (root) {
    'use strict';

    const ID = 'claudedesk';
    const TITLE = 'Claude Accounts';
    const VERSION = '1.0.0';
    const MODES = [['bypassPermissions', 'Bypass permissions'], ['acceptEdits', 'Accept edits'], ['default', 'Ask before acting'], ['plan', 'Plan only']];
    const RC_TEXT = { connected: 'Connected', reconnecting: 'Reconnecting', starting: 'Starting', error: 'Error', stopped: 'Stopped', unknown: 'Unknown', 'not-moved': 'Not in its own folder' };
    const MODELS = [['', 'Account default'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['fable', 'Fable']];
    const EFFORTS = [['', 'Default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];
    const GATE_TEXT = { open: 'Waiting', running: 'Building', done: 'Ended', cancelled: 'Cancelled', expired: 'Lapsed' };
    const VOTE_TEXT = { ready: 'Ready', 'not-ready': 'Not ready', auto: 'Ready (idle)', pending: 'Not answered' };
    const VI = '/static_images/vista-icons';
    const ITEMS = '/static_images/vista-cpl/items';
    const FOLDER16 = `${VI}/explorer/folder-16.png`;
    const PAGE = 50;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const errText = (e) => (e && (e.message || e.error || e.details)) || String(e || 'The server did not answer.');
    const shortId = (id) => String(id || '').slice(0, 8);
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

    /** Vista's short date and time. */
    function when(t) {
        if (!t) return '';
        const d = new Date(typeof t === 'string' && /^\d+$/.test(t) ? Number(t) : t);
        if (Number.isNaN(d.getTime())) return '';
        const h = d.getHours();
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${(h % 12) || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    }
    const timeOnly = (t) => { const s = when(t); return s.split(' ').slice(1).join(' '); };
    const dateKey = (t) => { const d = new Date(t); return Number.isNaN(d.getTime()) ? '' : d.toDateString(); };

    function ws() { return root.wsClient || null; }
    async function send(type, payload) {
        const c = ws();
        if (!c || typeof c.sendMessage !== 'function') throw new Error('Not connected to Dreamscape');
        const r = await c.sendMessage(type, payload || {}, false);
        const d = r && r.data && typeof r.data === 'object' && !Array.isArray(r.data) && ('success' in r.data || 'accounts' in r.data || 'items' in r.data) ? r.data : r;
        if (d && d.success === false) throw new Error(d.error || d.message || 'The server refused');
        return d || {};
    }

    // ---- state ------------------------------------------------------------------------------------------

    function blank() {
        return {
            app: null,
            c: null,
            host: null,
            accounts: [],
            live: [],
            coord: { agents: [], claims: [], builds: [], lastMessageId: 0 },
            fleet: null,
            fleetError: '',
            locks: null,
            inspect: null, // { id, data, loading, error }
            rc: { state: 'unknown' },
            login: { state: 'idle' },
            sessions: [],
            sessionsTotal: 0,
            sessionsLoaded: false,
            sessionsError: '',
            open: [], // session ids open as nodes, in order
            chats: new Map(), // id -> { messages, start, end, more, loading, error, row, screen }
            watching: null,
            messages: [],
            messagesFor: 0,
            subscribed: false,
            fluxOn: false,
            liveKey: ''
        };
    }
    let S = blank();

    const liveOf = (id) => S.live.find((s) => s.id === id) || null;
    const rowOf = (id) => S.sessions.find((s) => s.id === id) || (S.chats.get(id) && S.chats.get(id).row) || null;
    const accountName = (idx) => { const a = S.accounts.find((x) => x.index === idx); return a ? a.name : ''; };
    const activeAccount = () => S.accounts.find((a) => a.active) || null;
    const fleetRows = () => (S.fleet && Array.isArray(S.fleet.accounts) ? S.fleet.accounts : []);
    const fleetOf = (idx) => fleetRows().find((f) => f.index === idx) || null;
    const agentOf = (id) => S.coord.agents.find((x) => x.id === id) || null;
    function inspectName() {
        if (!S.inspect) return '';
        const a = agentOf(S.inspect.id) || (S.inspect.data && S.inspect.data.agent) || null;
        return (a && (a.name || a.id)) || S.inspect.id;
    }

    function stateText(row) {
        const l = liveOf(row.id);
        if (!l) return 'Ended';
        if (l.status === 'busy') return 'Working';
        if (l.status === 'idle' || l.status === 'waiting') return 'Idle';
        return l.status ? l.status.replace(/^./, (ch) => ch.toUpperCase()) : 'Running';
    }
    function titleOf(row) { return (row && (row.title || row.firstPrompt)) || shortId(row && row.id) || 'Session'; }

    // ---- status feeds (server push; subscribed while the window is open) ---------------------------------

    function applyDesk(changed) {
        if (!changed) return;
        let liveChanged = false;
        if ('host' in changed) S.host = changed.host;
        if ('accounts' in changed) S.accounts = changed.accounts || [];
        if ('live' in changed) {
            S.live = changed.live || [];
            const key = S.live.map((s) => s.id).join(',');
            liveChanged = key !== S.liveKey;
            S.liveKey = key;
        }
        if ('coord' in changed) {
            const before = S.coord.lastMessageId;
            S.coord = changed.coord || S.coord;
            if (S.coord.lastMessageId !== before && /^co-messages|^co-root/.test(S.c ? S.c.node : '')) void loadMessages();
        }
        if (S.host && S.host.remoteControl && S.host.remoteControl.status && S.rc.state === 'unknown') S.rc = S.host.remoteControl.status;
        // a session started or ended: the list (its order and states) is read again once
        if (liveChanged && S.sessionsLoaded) { clearTimeout(S.relist); S.relist = setTimeout(() => void loadSessions(false), 800); }
    }

    function repaint() { if (S.c && S.c.modal && S.c.modal.isConnected) S.c.refresh(); }

    async function subscribe(on) {
        const c = ws();
        if (!c || on === S.subscribed) return;
        S.subscribed = on;
        if (!on) {
            try { await c.sendMessage('status_unsubscribe', { feed: 'claude_desk' }, false); } catch (_) { /* gone */ }
            await flux(false);
            return;
        }
        try {
            const r = await send('status_subscribe', { feed: 'claude_desk' });
            applyDesk(r.items || {});
            S.error = '';
        } catch (e) {
            S.subscribed = false;
            S.error = errText(e);
        }
        await flux(true);
        repaint();
    }

    /** Remote Control's reconnect and the sign-in move fast: their own feed (memory only on the server). */
    async function flux(on) {
        const c = ws();
        if (!c || on === S.fluxOn) return;
        S.fluxOn = on;
        if (!on) { try { await c.sendMessage('status_unsubscribe', { feed: 'claude_desk_flux' }, false); } catch (_) { /* gone */ } return; }
        try {
            const r = await send('status_subscribe', { feed: 'claude_desk_flux' });
            const it = r.items || {};
            if (it.rc) S.rc = it.rc;
            if (it.login) S.login = it.login;
        } catch (_) { S.fluxOn = false; }
    }

    function wire(app) {
        const c = ws();
        if (!c || typeof c.on !== 'function') return;
        const opts = { signal: app.signal };
        c.on('claude_desk_status', (msg) => {
            const d = msg && msg.changed ? msg : (msg && msg.data) || {};
            applyDesk(d.changed);
            repaint();
        }, opts);
        c.on('claude_desk_flux', (msg) => {
            const d = msg && msg.changed ? msg : (msg && msg.data) || {};
            const ch = d.changed || {};
            if (ch.rc) S.rc = ch.rc;
            if (ch.login) S.login = ch.login;
            if (ch.rc && (ch.rc.state === 'connected' || ch.rc.state === 'error')) void refreshAccounts();
            repaint();
            if (S.loginBox) S.loginBox();
        }, opts);
        // #1154: an account's own Remote Control changed (an action moved it on): the whole fleet, pushed
        c.on('claude_remote_fleet_status', (msg) => {
            const d = msg && Array.isArray(msg.accounts) ? msg : (msg && msg.data) || null;
            if (d && Array.isArray(d.accounts)) { S.fleet = d; repaint(); }
        }, opts);
        c.on('claude_desk_transcript_append', (msg) => {
            const d = (msg && msg.data) || msg || {};
            const chat = S.chats.get(d.id);
            if (!chat || !Array.isArray(d.messages)) return;
            const seen = new Set(chat.messages.map((m) => `${m.at}:${m.kind}:${m.toolUseId || ''}`));
            d.messages.forEach((m) => { if (!seen.has(`${m.at}:${m.kind}:${m.toolUseId || ''}`)) chat.messages.push(m); });
            chat.end = d.end;
            if (S.c && S.c.node === `t:${d.id}`) appendChat(d.id);
        }, opts);
        // the server forgets a dropped socket's subscriptions and watches
        c.on('connected', () => {
            if (!S.c) return;
            S.subscribed = false;
            S.fluxOn = false;
            void subscribe(true);
            const w = S.watching;
            S.watching = null;
            if (w) void watch(w);
        }, opts);
    }

    // ---- loading ------------------------------------------------------------------------------------------

    async function refreshAccounts() {
        try {
            const r = await send('get_claude_accounts');
            if (Array.isArray(r.accounts)) S.accounts = r.accounts;
            if (r.host) { S.host = r.host; if (r.host.remoteControl && r.host.remoteControl.status) S.rc = r.host.remoteControl.status; }
            if (r.fleet) S.fleet = r.fleet;
        } catch (e) { S.error = errText(e); }
        repaint();
    }

    /** Every account's Remote Control, read once; then pushes (claude_remote_fleet_status) and action replies. */
    async function loadFleet() {
        try {
            const r = await send('claude_remote_fleet', { action: 'status' });
            if (r.fleet) S.fleet = r.fleet;
            S.fleetError = '';
        } catch (e) { S.fleetError = errText(e); }
        repaint();
    }

    async function loadLocks() {
        try {
            const r = await send('claude_desk_coord', { action: 'locks' });
            S.locks = { root: r.root || '', list: r.locks || [], error: '' };
        } catch (e) { S.locks = { root: '', list: [], error: errText(e) }; }
        repaint();
    }

    async function loadInspect(id) {
        S.inspect = { id, data: S.inspect && S.inspect.id === id ? S.inspect.data : null, loading: true, error: '' };
        repaint();
        try {
            const r = await send('claude_desk_coord', { action: 'inspect', agentId: id });
            if (S.inspect && S.inspect.id === id) S.inspect = { id, data: r.inspect || null, loading: false, error: '' };
        } catch (e) {
            if (S.inspect && S.inspect.id === id) S.inspect = { id, data: S.inspect.data, loading: false, error: errText(e) };
        }
        repaint();
    }

    async function loadSessions(more) {
        if (S.sessionsLoading) return;
        S.sessionsLoading = true;
        try {
            const offset = more ? S.sessions.length : 0;
            const limit = more ? PAGE : Math.max(PAGE, S.sessions.length);
            const r = await send('claude_desk_sessions', { offset, limit: Math.min(100, limit) });
            const rows = r.sessions || [];
            S.sessions = more ? S.sessions.concat(rows.filter((x) => !S.sessions.some((y) => y.id === x.id))) : rows;
            S.sessionsTotal = r.total || S.sessions.length;
            S.sessionsLoaded = true;
            S.sessionsError = '';
            S.sessions.forEach((row) => { const ch = S.chats.get(row.id); if (ch) ch.row = row; });
        } catch (e) {
            S.sessionsError = errText(e);
        }
        S.sessionsLoading = false;
        repaint();
    }

    async function loadMessages() {
        try {
            const r = await send('claude_desk_coord', { action: 'list', limit: 150 });
            S.messages = r.messages || [];
            if (r.agents) S.coord = { agents: r.agents, claims: r.claims || [], builds: r.builds || S.coord.builds || [], lastMessageId: r.lastMessageId || 0 };
        } catch (e) { S.coordError = errText(e); }
        repaint();
    }

    async function loadChat(id, earlier) {
        let chat = S.chats.get(id);
        if (!chat) { chat = { messages: [], start: 0, end: 0, more: false, loading: false, error: '', row: rowOf(id) }; S.chats.set(id, chat); }
        if (chat.loading) return;
        chat.loading = true;
        try {
            const r = await send('claude_desk_transcript', earlier ? { id, before: chat.start, limit: 80 } : { id, limit: 80 });
            if (earlier) {
                chat.messages = (r.messages || []).concat(chat.messages);
                chat.start = r.start;
                chat.more = r.more;
            } else {
                chat.messages = r.messages || [];
                chat.start = r.start;
                chat.end = r.end;
                chat.more = r.more;
            }
            chat.error = '';
        } catch (e) { chat.error = errText(e); }
        chat.loading = false;
        if (!earlier) await watch(id);
        if (S.c && S.c.node === `t:${id}`) {
            const pane = S.c.modal.querySelector('.cd-chat-log');
            const keep = earlier && pane ? pane.scrollHeight - pane.scrollTop : null;
            S.c.render();
            const log = S.c.modal.querySelector('.cd-chat-log');
            if (log) log.scrollTop = keep != null ? log.scrollHeight - keep : log.scrollHeight;
        }
    }

    /** New messages of the open session are pushed to this window (one session at a time). */
    async function watch(id) {
        if (S.watching === id) return;
        const chat = S.chats.get(id);
        try {
            await send('claude_desk_watch', { id, from: chat ? chat.end : undefined });
            S.watching = id;
        } catch (_) { S.watching = null; }
    }
    async function unwatch() {
        if (!S.watching) return;
        S.watching = null;
        try { await send('claude_desk_unwatch', {}); } catch (_) { /* gone */ }
    }

    // ---- the tree -----------------------------------------------------------------------------------------

    function nodes() {
        const A = S.app ? S.app.url('assets').replace(/\/$/, '') : '/melaton-apps/claudedesk/assets';
        const running = S.live.length;
        const open = S.open.map((id) => {
            const row = rowOf(id);
            return { id: `t:${id}`, name: titleOf(row || { id }), icon: `${A}/session-16.png`, desc: 'The session\'s conversation' };
        });
        return [{
            id: 'root',
            name: `${TITLE} (Local)`,
            icon: `${A}/claudedesk-16.png`,
            children: [
                { id: 'accounts', name: 'Accounts', icon: `${A}/account-16.png`, desc: 'The Claude accounts of this host' },
                {
                    id: 'rc',
                    name: 'Remote Control',
                    icon: `${ITEMS}/network-and-sharing-center-16.png`,
                    desc: 'Every Claude account\'s own Remote Control',
                    children: [{ id: 'rc-host', name: 'Host Login', icon: `${ITEMS}/network-and-sharing-center-16.png`, desc: 'claude-remote.service: the host\'s own claude.ai login' }]
                },
                {
                    id: 'sessions',
                    name: 'Sessions',
                    icon: `${A}/session-16.png`,
                    desc: 'Every Claude session on the host',
                    children: [{ id: 'running', name: `Running (${running})`, icon: `${A}/session-16.png`, desc: 'The sessions running now' }].concat(open)
                },
                {
                    id: 'co-root',
                    name: 'Coordination',
                    icon: `${ITEMS}/sync-center-16.png`,
                    desc: 'The agents working now, their claims and messages',
                    children: [
                        { id: 'co-agents', name: 'Agents', icon: `${ITEMS}/user-accounts-16.png` },
                        { id: 'co-claims', name: 'Claims', icon: FOLDER16 },
                        { id: 'co-messages', name: 'Messages', icon: '/static_images/vista-cmdbar/mail.png' },
                        { id: 'co-builds', name: 'Build Gates', icon: `${ITEMS}/administrative-tools-16.png`, desc: 'Builds waiting until every agent is ready' },
                        { id: 'co-locks', name: 'Busy Locks', icon: `${ITEMS}/bitlocker-drive-encryption-16.png`, desc: 'The .agent-* busy locks in the repo' }
                    ].concat(S.inspect ? [{ id: `i:${S.inspect.id}`, name: `Inspect: ${inspectName()}`, icon: `${S.app ? S.app.url('assets').replace(/\/$/, '') : '/melaton-apps/claudedesk/assets'}/session-16.png`, desc: 'What this agent is doing' }] : [])
                }
            ]
        }];
    }

    // ---- pages --------------------------------------------------------------------------------------------

    function rcLine(c) {
        const st = S.rc && S.rc.state ? S.rc : ((S.host && S.host.remoteControl && S.host.remoteControl.status) || { state: 'unknown' });
        const text = RC_TEXT[st.state] || 'Unknown';
        const ok = st.state === 'connected';
        return `${c.state(ok, text, st.state === 'reconnecting')}${st.message && !ok ? ` <span class="mmc-hint">${esc(st.message)}</span>` : ''}`;
    }

    function rootPage(c) {
        const A = S.app.url('assets').replace(/\/$/, '');
        const act = activeAccount();
        const rc = S.host && S.host.remoteControl;
        const busy = S.live.filter((s) => s.status === 'busy').length;
        const agents = S.coord.agents.filter((a) => a.kind !== 'person');
        const overview = c.overview(`${A}/claudedesk-32.png`, [
            'Claude Accounts manages the Claude accounts of this host, its Remote Control, and the Claude sessions running on it.',
            'Sessions started here run in Remote Control, outlive a Dreamscape restart, and can run on either account at the same time.'
        ]);
        const sections = [
            { id: 'cd-sum-engine', title: 'Accounts', body: c.props([
                ['Engine account', act ? esc(act.name) : 'None selected'],
                ['Accounts', String(S.accounts.length)],
                ['Signed in on the host', S.host && S.host.login ? esc(S.host.login.email || S.host.login.displayName || '') : 'Nobody'],
                ['Claude Code', S.host && S.host.cliVersion ? esc(S.host.cliVersion) : '']
            ]) + `<p><span class="mmc-link" data-act="nav:accounts">Manage accounts</span></p>` },
            { id: 'cd-sum-rc', title: 'Remote Control', body: c.props([
                ['Accounts', fleetRows().length ? `${fleetRows().filter((f) => f.state === 'connected').length} of ${fleetRows().length} connected (${fleetRows().filter((f) => f.moved).length} in their own folder)` : ''],
                ['Host login', rcLine(c)],
                ['Sessions', rc && rc.pane && rc.pane.capacity ? `${rc.pane.sessions} of ${rc.pane.capacity}` : ''],
                ['Host', S.host ? esc(S.host.hostname) : '']
            ]) + `<p><span class="mmc-link" data-act="nav:rc">Remote Control</span></p>` },
            { id: 'cd-sum-sessions', title: 'Sessions', body: c.props([
                ['Running', `${S.live.length}${busy ? ` (${busy} working)` : ''}`],
                ['On the host', S.sessionsLoaded ? String(S.sessionsTotal) : '']
            ]) + `<p><span class="mmc-link" data-act="nav:running">Running sessions</span> &nbsp; <span class="mmc-link" data-act="new-session">New session...</span></p>` },
            { id: 'cd-sum-coord', title: 'Coordination', body: c.props([
                ['Agents working', String(agents.length)],
                ['Files claimed', String(S.coord.claims.length)],
                ['Build gates open', String((S.coord.builds || []).filter((b) => b.state === 'open' || b.state === 'running').length)]
            ]) + `<p><span class="mmc-link" data-act="nav:co-agents">Agents</span> &nbsp; <span class="mmc-link" data-act="nav:co-builds">Build gates</span></p>` }
        ];
        return c.page(`${TITLE} (Local)`, S.error ? `Error: ${S.error}` : '', [{ id: 'cd-sum-overview', title: 'Overview', body: overview }].concat(sections));
    }

    const ACCOUNT_COLS = [
        { t: 'Name', w: 170, key: 'name', text: (d) => d.name },
        { t: 'Status', w: 120, key: 'status', text: (d) => d.status },
        { t: 'Remote Control Login', w: 200, key: 'login', text: (d) => d.login },
        { t: 'Plan', w: 70, key: 'plan', text: (d) => d.plan },
        { t: 'Running', w: 60, key: 'running', num: true, text: (d) => String(d.running), value: (d) => d.running }
    ];

    function accountsPage(c) {
        const A = S.app.url('assets').replace(/\/$/, '');
        const rows = S.accounts.map((a) => {
            const status = [a.active ? 'Engine' : '', a.onHost ? 'On host' : ''].filter(Boolean).join(', ') || (a.remoteLogin ? 'Ready' : 'No login linked');
            const running = S.sessions.filter((s) => s.account && s.account.index === a.index && liveOf(s.id)).length;
            return {
                key: `a:${a.index}`,
                icon: `${A}/account-16.png`,
                data: { name: a.name, status, login: a.remoteLogin ? (a.remoteLogin.email || a.remoteLogin.displayName) : 'None', plan: a.remoteLogin ? (a.remoteLogin.plan || '') : '', running }
            };
        });
        const list = c.listView(ACCOUNT_COLS, rows, { sortId: 'cd-accounts', empty: 'There are no Claude accounts. Use Add Account... to sign one in.', fit: true });
        return { html: list, list: true };
    }

    /** A fleet state with the console's status icon: plain when connected, warning while it moves, error. */
    function fleetState(c, f) {
        const text = RC_TEXT[f.state] || f.state || 'Unknown';
        if (f.state === 'not-moved') return esc(f.onHost && f.unit ? `Host login (${RC_TEXT[(S.rc && S.rc.state) || 'unknown'] || 'Unknown'})` : text);
        return c.state(f.state === 'connected', text, f.state !== 'error');
    }

    const FLEET_COLS = [
        { t: 'Account', w: 130, min: 90, key: 'name', text: (d) => d.name },
        { t: 'Remote Control', w: 120, min: 100, key: 'state', text: (d) => d.stateText, html: (d) => d.stateHtml },
        { t: 'Folder', w: 84, min: 76, key: 'folder', text: (d) => d.folder },
        { t: 'Sessions', w: 58, min: 58, key: 'sessions', num: true, text: (d) => String(d.sessions), value: (d) => d.sessions },
        { t: 'Status', w: 220, key: 'status', text: (d) => d.status }
    ];

    function rcPage(c) {
        if (!S.fleet && !S.fleetError) void loadFleet();
        const A = S.app.url('assets').replace(/\/$/, '');
        const rows = fleetRows().map((f) => ({
            key: `r:${f.index}`,
            icon: `${A}/account-16.png`,
            cls: f.state === 'connected' ? '' : (f.state === 'error' ? 'cd-rc-error' : ''),
            data: {
                name: f.name,
                stateText: RC_TEXT[f.state] || f.state,
                stateHtml: fleetState(c, f),
                folder: f.moved ? 'Own folder' : (f.onHost ? 'Host login' : 'None'),
                sessions: (f.sessions || []).length,
                status: f.statusLine || f.message || ''
            }
        }));
        const empty = S.fleetError ? `Remote Control could not be read. ${S.fleetError}` : (S.fleet ? 'There are no Claude accounts.' : 'Reading every account\'s Remote Control...');
        return { html: c.listView(FLEET_COLS, rows, { sortId: 'cd-fleet', empty, fit: true }), list: true };
    }

    function hostRcPage(c) {
        const h = S.host;
        if (!h) return c.page('Host Login', '', [{ id: 'cd-rc-wait', title: 'Status', body: `<p>${esc(S.error || 'Reading the host...')}</p>` }]);
        const u = h.remoteControl || {};
        const p = u.pane || {};
        const lg = h.login;
        const hostAcc = fleetRows().find((f) => f.onHost && !f.moved);
        const migrated = S.fleet && S.fleet.hostMigrated;
        return c.page('Host Login', h.hostname, [
            migrated ? { id: 'cd-rc-moved', title: 'Moved', body: '<p>The host\'s account runs in its own folder now: its Remote Control is on the Remote Control list. This service is stopped and disabled.</p>' } : null,
            hostAcc ? { id: 'cd-rc-who', title: 'Account', body: `<p><b>${esc(hostAcc.name)}</b> still runs Remote Control on the host's own login. Move it to its own folder last: that stops this service and ends every session it runs.</p>` } : null,
            { id: 'cd-rc-status', title: 'Status', body: c.props([
                ['Remote Control', rcLine(c)],
                ['Service', `${esc(u.unit || '')} (${esc(u.active || '')}${u.sub ? `, ${esc(u.sub)}` : ''})`],
                ['Running since', esc(u.since || '')],
                ['Restarts', u.restarts == null ? '' : String(u.restarts)],
                ['Session name', esc(u.sessionName || '')],
                ['Sessions', p.capacity ? `${p.sessions} of ${p.capacity}` : ''],
                ['It says', esc(p.statusLine || p.errorLine || '')]
            ]) },
            { id: 'cd-rc-login', title: 'Signed In', body: lg ? c.props([
                ['Account', esc(lg.email || lg.displayName || '')],
                ['Organization', esc(lg.organization || '')],
                ['Plan', esc(lg.plan || '')],
                ['Remote Control', lg.remoteControlCapable === false ? c.state(false, 'This login cannot run Remote Control', true) : 'Allowed']
            ]) : '<p>Nobody is signed in to claude.ai on the host.</p>' },
            { id: 'cd-rc-engine', title: 'Engine', body: c.props([
                ['Engine account', h.engine && h.engine.account ? esc(h.engine.account.name) : 'None'],
                ['Token file', h.engine && h.engine.tokenFile ? 'Written' : c.state(false, 'Missing', true)],
                ['Claude Code', esc(h.cliVersion || '')]
            ]) }
        ]);
    }

    const SESSION_COLS = [
        { t: 'Title', w: 240, key: 'title', text: (d) => d.title },
        { t: 'State', w: 70, key: 'state', text: (d) => d.state },
        { t: 'Account', w: 110, key: 'account', text: (d) => d.account },
        { t: 'Folder', w: 100, key: 'folder', text: (d) => d.folder },
        { t: 'Remote Control', w: 96, key: 'rc', text: (d) => d.rc },
        { t: 'Last Activity', w: 130, key: 'last', text: (d) => when(d.last), value: (d) => Date.parse(d.last) || 0 },
        { t: 'Messages', w: 66, key: 'messages', num: true, text: (d) => String(d.messages), value: (d) => d.messages }
    ];

    function sessionRows(list) {
        const A = S.app.url('assets').replace(/\/$/, '');
        return list.map((r) => {
            const l = liveOf(r.id);
            return {
                key: `s:${r.id}`,
                icon: `${A}/session-16.png`,
                cls: l ? (l.status === 'busy' ? 'cd-busy' : 'cd-live') : '',
                data: {
                    title: titleOf(r), state: stateText(r), account: r.account ? r.account.name : (l ? '' : ''),
                    folder: r.folder || '', rc: l ? (l.remoteControl ? 'On' : 'Off') : '', last: r.lastActivity, messages: r.messages || 0
                }
            };
        });
    }

    function sessionsPage(c, onlyLive) {
        if (!S.sessionsLoaded && !S.sessionsLoading) void loadSessions(false);
        let list = S.sessions;
        if (onlyLive) {
            // running sessions the loaded pages do not reach yet (an old transcript resumed) come from the live list
            const have = new Set(list.map((r) => r.id));
            list = list.filter((r) => liveOf(r.id)).concat(S.live.filter((l) => !have.has(l.id)).map((l) => ({ id: l.id, title: l.name, folder: l.cwd ? l.cwd.split('/').pop() : '', lastActivity: l.startedAt ? new Date(l.startedAt).toISOString() : '', messages: 0 })));
        }
        const empty = S.sessionsError ? `The sessions could not be read. ${S.sessionsError}` : (S.sessionsLoaded ? (onlyLive ? 'No Claude session is running.' : 'There are no Claude sessions on this host.') : 'Reading the sessions...');
        const lv = c.listView(SESSION_COLS, sessionRows(list), { sortId: onlyLive ? 'cd-running' : 'cd-sessions', sort: { key: 'last', dir: -1 }, empty });
        const more = !onlyLive && S.sessionsLoaded && S.sessions.length < S.sessionsTotal
            ? `<div class="cd-more"><span>${S.sessions.length} of ${S.sessionsTotal} sessions</span><button type="button" class="btn-standard" data-act="more-sessions"${S.sessionsLoading ? ' disabled' : ''}>Show More</button></div>` : '';
        return { html: more ? `<div class="cd-list-wrap">${lv}${more}</div>` : lv, list: true, split: !!more };
    }

    function agentsPage(c) {
        const rows = S.coord.agents.map((a) => ({
            key: `g:${a.id}`,
            icon: a.kind === 'person' ? `${ITEMS}/user-accounts-16.png` : `${S.app.url('assets').replace(/\/$/, '')}/session-16.png`,
            data: {
                name: a.name || a.id, kind: a.kind, account: a.account || '', task: a.task || '', branch: [a.repo, a.branch].filter(Boolean).join(' : '),
                status: a.status === 'gone' ? 'Gone' : (a.live === 'busy' ? 'Working' : (a.live ? 'Idle' : a.status)),
                model: [a.model, a.effort].filter(Boolean).join(' / '), by: a.dispatchedBy || '', claims: a.claims || 0, id: a.id
            }
        }));
        return {
            html: c.listView([
                { t: 'Agent', w: 150, key: 'name', text: (d) => d.name },
                { t: 'Live', w: 60, key: 'status', text: (d) => d.status },
                { t: 'Account', w: 90, key: 'account', text: (d) => d.account },
                { t: 'Model / Effort', w: 100, key: 'model', text: (d) => d.model },
                { t: 'Task', w: 220, key: 'task', text: (d) => d.task },
                { t: 'Dispatched By', w: 80, key: 'by', text: (d) => d.by },
                { t: 'Repo : Branch', w: 130, key: 'branch', text: (d) => d.branch },
                { t: 'Claims', w: 46, key: 'claims', num: true, text: (d) => String(d.claims), value: (d) => d.claims }
            ], rows, { sortId: 'cd-agents', empty: 'No agent has joined the coordination yet. Sessions started here join it on their own; others join through the agent-coord MCP server.', fit: true }),
            list: true
        };
    }

    function claimsPage(c) {
        const name = (id) => { const a = S.coord.agents.find((x) => x.id === id); return a ? (a.name || a.id) : id; };
        const rows = S.coord.claims.map((cl) => ({
            key: `c:${cl.id}`,
            icon: FOLDER16,
            data: { path: cl.path, repo: cl.repo, holder: name(cl.agentId), mode: cl.mode === 'shared' ? 'Shared' : 'Exclusive', note: cl.note || '', expires: cl.expiresAt }
        }));
        return {
            html: c.listView([
                { t: 'Path', w: 260, key: 'path', text: (d) => d.path },
                { t: 'Repo', w: 90, key: 'repo', text: (d) => d.repo },
                { t: 'Held By', w: 150, key: 'holder', text: (d) => d.holder },
                { t: 'Mode', w: 70, key: 'mode', text: (d) => d.mode },
                { t: 'Lease Ends', w: 130, key: 'expires', text: (d) => when(d.expires), value: (d) => d.expires },
                { t: 'Note', w: 200, key: 'note', text: (d) => d.note }
            ], rows, { sortId: 'cd-claims', empty: 'No file is claimed.', fit: true }),
            list: true
        };
    }

    function messagesPage(c) {
        if (!S.messagesLoadedOnce) { S.messagesLoadedOnce = true; void loadMessages(); }
        const name = (id) => { if (!id || id === 'all') return 'Everyone'; const a = S.coord.agents.find((x) => x.id === id); return a ? (a.name || a.id) : id; };
        const KIND = { note: 'Note', steer: 'Steering', question: 'Question', reply: 'Reply', done: 'Done' };
        const rows = S.messages.slice().reverse().map((m) => ({
            key: `m:${m.id}`,
            icon: '/static_images/vista-cmdbar/mail.png',
            data: { from: name(m.from), to: name(m.to), kind: KIND[m.kind] || m.kind, body: m.body.replace(/\s+/g, ' '), at: m.createdAt, delivered: m.delivered === 'tmux' ? 'Typed in' : '' }
        }));
        return {
            html: c.listView([
                { t: 'From', w: 140, key: 'from', text: (d) => d.from },
                { t: 'To', w: 120, key: 'to', text: (d) => d.to },
                { t: 'Kind', w: 70, key: 'kind', text: (d) => d.kind },
                { t: 'Message', w: 320, key: 'body', text: (d) => d.body },
                { t: 'Sent', w: 130, key: 'at', text: (d) => when(d.at), value: (d) => d.at },
                { t: 'Delivered', w: 70, key: 'delivered', text: (d) => d.delivered }
            ], rows, { sortId: 'cd-messages', sort: { key: 'at', dir: -1 }, empty: 'No messages yet.', fit: true }),
            list: true
        };
    }

    function buildsPage(c) {
        const name = (id) => { const a = agentOf(id); return a ? (a.name || a.id) : id; };
        const rows = (S.coord.builds || []).map((b) => ({
            key: `b:${b.id}`,
            icon: `${ITEMS}/administrative-tools-16.png`,
            cls: b.state === 'open' || b.state === 'running' ? 'cd-live' : '',
            data: {
                id: b.id, target: b.target, repo: b.repo, by: name(b.requestedBy),
                state: `${GATE_TEXT[b.state] || b.state}${b.forced ? ' (forced)' : ''}`,
                waiting: b.state === 'open' ? (b.waitingOn.length ? b.waitingOn.join(', ') : 'Nobody: it can begin') : '',
                at: b.startedAt || b.createdAt, result: b.result || b.note || ''
            }
        }));
        return {
            html: c.listView([
                { t: 'Gate', w: 46, key: 'id', num: true, text: (d) => String(d.id), value: (d) => d.id },
                { t: 'Target', w: 120, key: 'target', text: (d) => d.target },
                { t: 'Repo', w: 90, key: 'repo', text: (d) => d.repo },
                { t: 'Requested By', w: 130, key: 'by', text: (d) => d.by },
                { t: 'State', w: 90, key: 'state', text: (d) => d.state },
                { t: 'Waiting On', w: 180, key: 'waiting', text: (d) => d.waiting },
                { t: 'Since', w: 130, key: 'at', text: (d) => when(d.at), value: (d) => d.at || 0 },
                { t: 'Result / Note', w: 200, key: 'result', text: (d) => d.result }
            ], rows, { sortId: 'cd-builds', sort: { key: 'id', dir: -1 }, empty: 'No build is waiting or running. Agents open a gate with coord_build_request before they build.', fit: true }),
            list: true
        };
    }

    function locksPage(c) {
        if (!S.locks) void loadLocks();
        const rows = ((S.locks && S.locks.list) || []).map((l) => ({
            key: `l:${l.file}`,
            icon: `${ITEMS}/bitlocker-drive-encryption-16.png`,
            cls: l.stale ? 'cd-stale' : '',
            data: {
                file: l.file, agent: (agentOf(l.agentId) || {}).name || l.agentId, by: l.viaCoord ? 'agent-coord' : 'By hand',
                state: l.stale ? 'Stale (over 3 hours)' : (l.viaCoord ? (l.status || 'active') : 'In use'),
                age: l.ageMinutes, intent: l.intent || ''
            }
        }));
        const empty = S.locks ? (S.locks.error ? `The locks could not be read. ${S.locks.error}` : 'No agent holds a busy lock in the repo.') : 'Reading the locks...';
        return {
            html: c.listView([
                { t: 'Lock', w: 170, key: 'file', text: (d) => d.file },
                { t: 'Agent', w: 140, key: 'agent', text: (d) => d.agent },
                { t: 'Made By', w: 80, key: 'by', text: (d) => d.by },
                { t: 'State', w: 120, key: 'state', text: (d) => d.state },
                { t: 'Age', w: 70, key: 'age', num: true, text: (d) => (d.age == null ? '' : ageText(d.age)), value: (d) => d.age || 0 },
                { t: 'Intent', w: 260, key: 'intent', text: (d) => d.intent }
            ], rows, { sortId: 'cd-locks', empty, fit: true }),
            list: true
        };
    }

    function ageText(min) {
        if (min < 60) return `${min} min`;
        if (min < 48 * 60) return `${Math.round(min / 60)} h`;
        return `${Math.round(min / 1440)} d`;
    }

    function inspectPage(c, id) {
        const ins = S.inspect && S.inspect.id === id ? S.inspect : null;
        if (!ins) { void loadInspect(id); return c.page(`Inspect: ${id}`, '', [{ id: 'cd-in-wait', title: 'Agent', body: '<p class="mmc-hint">Reading what it is doing...</p>' }]); }
        const d = ins.data;
        if (!d) return c.page(`Inspect: ${inspectName()}`, '', [{ id: 'cd-in-wait', title: 'Agent', body: `<p${ins.error ? ' class="cd-err"' : ' class="mmc-hint"'}>${esc(ins.error || 'Reading what it is doing...')}</p>` }]);
        const a = d.agent || {};
        const live = a.live;
        const files = (d.edited && d.edited.files) || [];
        // head: [title, width?] (no width: the column takes the rest)
        const table = (head, rows) => (rows.length ? `<table class="cd-table"><colgroup>${head.map(([, w]) => `<col${w ? ` style="width:${w}px"` : ''}>`).join('')}</colgroup><thead><tr>${head.map(([h]) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="mmc-hint">None.</p>');
        const unc = d.uncommitted;
        return c.page(`Inspect: ${a.name || a.id}`, ins.loading ? 'Reading...' : (ins.error ? `Error: ${ins.error}` : ''), [
            { id: 'cd-in-agent', title: 'Agent', body: c.props([
                ['Status', live ? (live.status === 'busy' ? 'Working' : 'Idle') : esc(a.status || '')],
                ['Task', esc(a.task || '')],
                ['Account', esc(a.account || '')],
                ['Model', esc([a.model, a.effort].filter(Boolean).join(' / ') || 'Default')],
                ['Dispatched by', esc(a.dispatchedBy || '')],
                ['Folder', esc([a.cwd, a.branch].filter(Boolean).join(' : '))],
                ['Tool calls', String(d.toolCalls || 0)]
            ]) + `<p>${a.sessionId ? '<span class="mmc-link" data-act="inspect-session">Open session</span> &nbsp; ' : ''}${live && live.link ? `<span class="mmc-link" data-act="open-link" data-arg="${esc(live.link)}">Open in claude.ai</span> &nbsp; ` : ''}<span class="mmc-link" data-act="inspect-refresh">Read again</span></p>` },
            { id: 'cd-in-claims', title: `Claims (${(d.claims || []).length})`, body: table([['Path'], ['Repo', 90], ['Mode', 76], ['Lease Ends', 130]], (d.claims || []).map((cl) => `<tr><td>${esc(cl.path)}</td><td>${esc(cl.repo)}</td><td>${cl.mode === 'shared' ? 'Shared' : 'Exclusive'}</td><td>${esc(when(cl.expiresAt))}</td></tr>`)) },
            { id: 'cd-in-files', title: `Files Edited (${d.edited ? d.edited.total : 0})`, body: table([['File'], ['Via', 76], ['Edits', 46], ['Last', 130], ['Uncommitted', 84]], files.map((f) => `<tr><td>${esc(f.path)}</td><td>${f.via === 'shell' ? 'Shell' : esc(f.tool)}</td><td class="is-num">${f.edits}</td><td>${esc(when(f.lastAt))}</td><td>${f.uncommitted == null ? '' : (f.uncommitted ? 'Yes' : 'No')}</td></tr>`)) },
            { id: 'cd-in-cmds', title: 'Recent Commands', body: table([['When', 76], ['Command']], (d.commands || []).slice().reverse().map((x) => `<tr><td>${esc(timeOnly(x.at))}</td><td><code>${esc(x.command)}</code>${x.description ? `<br><span class="mmc-hint">${esc(x.description)}</span>` : ''}</td></tr>`)) },
            { id: 'cd-in-last', title: 'Last Message', body: d.lastMessage && d.lastMessage.text ? `<p class="cd-read">${esc(d.lastMessage.text)}</p><p class="mmc-hint">${esc(when(d.lastMessage.at))}</p>` : '<p class="mmc-hint">None.</p>' },
            { id: 'cd-in-tree', title: `Uncommitted in Its Folder (${unc ? unc.count : 0})`, body: unc ? `<p class="mmc-hint">Every uncommitted file in the tree, other agents' work included.</p>` + table([['State', 50], ['File']], unc.files.map((f) => `<tr><td>${esc(f.status)}</td><td>${esc(f.path)}</td></tr>`)) + (unc.count > unc.files.length ? `<p class="mmc-hint">${unc.count - unc.files.length} more not shown.</p>` : '') : '<p class="mmc-hint">Not a git folder.</p>' }
        ]);
    }

    // ---- the chat ------------------------------------------------------------------------------------------

    const WHO = { user: 'You', assistant: 'Claude', tool: 'Result', system: 'Notice' };

    function messageHtml(m) {
        if (m.kind === 'tool_use') {
            return `<div class="cd-msg cd-tool" data-at="${m.at}"><div class="cd-tool-head"><b>${esc(m.tool)}</b></div><pre class="cd-pre">${esc(m.text)}</pre></div>`;
        }
        if (m.kind === 'tool_result') {
            const lines = String(m.text || '').split('\n');
            const long = lines.length > 6 || m.text.length > 500;
            return `<div class="cd-msg cd-result${m.error ? ' is-error' : ''}${long ? ' is-folded' : ''}" data-at="${m.at}"><pre class="cd-pre">${esc(m.text || '(no output)')}</pre>${long ? '<button type="button" class="cd-unfold" data-cd-unfold>Show all</button>' : ''}</div>`;
        }
        if (m.kind === 'command') return `<div class="cd-msg cd-note" data-at="${m.at}">${esc(m.text)}</div>`;
        if (m.role === 'system') return `<div class="cd-msg cd-note" data-at="${m.at}">${esc(m.text)}</div>`;
        const who = m.role === 'user' ? (m.origin && m.origin !== 'human' ? 'Steering' : WHO.user) : WHO[m.role] || m.role;
        return `<div class="cd-msg cd-${m.role === 'user' ? 'user' : 'claude'}${m.sidechain ? ' is-side' : ''}" data-at="${m.at}"><div class="cd-msg-head"><b>${esc(who)}</b><span>${esc(timeOnly(m.time))}</span></div><div class="cd-msg-text">${esc(m.text)}</div></div>`;
    }

    function logHtml(chat) {
        let out = '';
        let day = '';
        chat.messages.forEach((m) => {
            const k = m.time ? dateKey(m.time) : '';
            if (k && k !== day) { day = k; out += `<div class="cd-day">${esc(new Date(m.time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</div>`; }
            out += messageHtml(m);
        });
        return out;
    }

    function chatPage(c, id) {
        let chat = S.chats.get(id);
        if (!chat) { void loadChat(id, false); chat = { messages: [], loading: true, row: rowOf(id) }; }
        const row = chat.row || rowOf(id) || { id };
        const l = liveOf(id);
        const acct = row.account ? row.account.name : '';
        const side = [stateText(row), acct, row.folder].filter(Boolean).join(' - ');
        const linkBits = l && l.link ? `<span class="mmc-link" data-act="open-link" data-arg="${esc(l.link)}">Open in claude.ai</span> <span class="mmc-link" data-act="copy-link" data-arg="${esc(l.link)}">Copy link</span>` : '';
        const top = chat.more ? `<div class="cd-earlier"><button type="button" class="btn-standard" data-act="earlier" data-arg="${esc(id)}"${chat.loading ? ' disabled' : ''}>Show Earlier Messages</button></div>` : '';
        const body = chat.error ? `<p class="cd-err">${esc(chat.error)}</p>` : (chat.messages.length ? logHtml(chat) : `<p class="mmc-hint">${chat.loading ? 'Reading the conversation...' : 'No messages yet.'}</p>`);
        let composer;
        if (l) {
            composer = `<div class="cd-compose">
                <textarea class="cd-input" data-field="cd-input-${esc(id)}" rows="3" placeholder="${l.status === 'busy' ? 'Steer it: your message reaches it while it works' : 'Message this session'}" spellcheck="true"></textarea>
                <div class="cd-compose-btns">
                    <button type="button" class="btn-standard primary" data-act="send" data-arg="${esc(id)}">Send</button>
                    <button type="button" class="btn-standard" data-act="interrupt" data-arg="${esc(id)}"${l.status === 'busy' ? '' : ' disabled'}>Stop</button>
                </div>
            </div>`;
        } else {
            composer = `<div class="cd-compose cd-ended"><span>This session is not running.</span><button type="button" class="btn-standard primary" data-act="resume" data-arg="${esc(id)}">Resume in Remote Control...</button></div>`;
        }
        return {
            html: `<div class="cd-chat">
                <div class="mmc-page-title"><b>${esc(titleOf(row))}</b><span>${esc(side)}</span></div>
                ${linkBits ? `<div class="cd-chat-links">${linkBits}</div>` : ''}
                <div class="cd-chat-log" data-mmc-scroll>${top}${body}</div>
                ${composer}
            </div>`,
            split: true,
            mount: (pane) => {
                const log = pane.querySelector('.cd-chat-log');
                if (log && !S.chatScrolled) { log.scrollTop = log.scrollHeight; }
                log.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-cd-unfold]');
                    if (b) { b.parentElement.classList.remove('is-folded'); b.remove(); }
                });
                const input = pane.querySelector('.cd-input');
                if (input) {
                    if (S.drafts && S.drafts[id]) input.value = S.drafts[id];
                    input.addEventListener('input', () => { S.drafts = S.drafts || {}; S.drafts[id] = input.value; });
                    input.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); void action('send', S.c, id); }
                    });
                }
            }
        };
    }

    /** New messages go at the end of the open chat without drawing the page again (scroll kept at the end). */
    function appendChat(id) {
        const pane = S.c && S.c.modal.querySelector('.cd-chat-log');
        const chat = S.chats.get(id);
        if (!pane || !chat) return;
        const atEnd = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
        const have = new Set(Array.from(pane.querySelectorAll('.cd-msg[data-at]')).map((n) => n.dataset.at));
        const fresh = chat.messages.filter((m) => !have.has(String(m.at)));
        if (!fresh.length) return;
        const hint = pane.querySelector(':scope > .mmc-hint');
        if (hint) hint.remove();
        pane.insertAdjacentHTML('beforeend', fresh.map(messageHtml).join(''));
        delete S.c.modal.querySelector('.mmc-result').dataset.html;
        if (atEnd) pane.scrollTop = pane.scrollHeight;
    }

    // ---- commands -----------------------------------------------------------------------------------------

    function page(n, c) {
        switch (n.id) {
            case 'root': return rootPage(c);
            case 'accounts': return accountsPage(c);
            case 'rc': return rcPage(c);
            case 'rc-host': return hostRcPage(c);
            case 'co-builds': return buildsPage(c);
            case 'co-locks': return locksPage(c);
            case 'sessions': return sessionsPage(c, false);
            case 'running': return sessionsPage(c, true);
            case 'co-root': return rootPage(c);
            case 'co-agents': return agentsPage(c);
            case 'co-claims': return claimsPage(c);
            case 'co-messages': return messagesPage(c);
            default:
                if (n.id.startsWith('t:')) return chatPage(c, n.id.slice(2));
                if (n.id.startsWith('i:')) return inspectPage(c, n.id.slice(2));
                return '';
        }
    }

    function commands(n) {
        switch (n.id) {
            case 'root': return [{ text: 'Add Account...', action: 'add-account' }, { text: 'New Session...', action: 'new-session' }];
            case 'accounts': return [{ text: 'Add Account...', action: 'add-account' }];
            case 'rc': return [{ text: 'Refresh Status', action: 'fleet-refresh' }];
            case 'co-builds': return [{ text: 'Post Message...', action: 'post' }];
            case 'co-locks': return [{ text: 'Read Again', action: 'locks-refresh' }];
            case 'rc-host': return [
                { text: 'Reconnect', action: 'rc-reconnect' },
                { text: 'Start', action: 'rc-start', disabled: !!(S.host && S.host.remoteControl && S.host.remoteControl.active === 'active') },
                { text: 'Stop', action: 'rc-stop', disabled: !(S.host && S.host.remoteControl && S.host.remoteControl.active === 'active') }
            ];
            case 'sessions':
            case 'running': return [{ text: 'New Session...', action: 'new-session' }];
            case 'co-root':
            case 'co-agents':
            case 'co-messages': return [{ text: 'Post Message...', action: 'post' }];
            default:
                if (n.id.startsWith('t:')) {
                    const id = n.id.slice(2);
                    return sessionItems(id).concat([{ separator: true }, { text: 'Close', action: 'close-chat', icon: 0 }]);
                }
                if (n.id.startsWith('i:')) return [{ text: 'Read Again', action: 'inspect-refresh' }, { text: 'Open Session', action: 'inspect-session' }, { separator: true }, { text: 'Close', action: 'close-inspect', icon: 0 }];
                return [];
        }
    }

    function sessionItems(id) {
        const l = liveOf(id);
        return [
            { text: 'Open', action: 'open-session' },
            { text: 'Send Message...', action: 'message', disabled: !l },
            { text: 'Stop Current Turn', action: 'interrupt', disabled: !(l && l.status === 'busy') },
            { separator: true },
            { text: 'Resume in Remote Control...', action: 'resume', disabled: !!l },
            { text: 'Open in claude.ai', action: 'open-link', disabled: !(l && l.link) },
            { text: 'Copy Link', action: 'copy-link', disabled: !(l && l.link) },
            { separator: true },
            { text: 'End Session', action: 'end', disabled: !(l && l.origin === 'rc') }
        ];
    }

    function selCommands(n, key) {
        if (!key) return null;
        if (key.startsWith('s:')) { const row = rowOf(key.slice(2)); return { title: titleOf(row || { id: key.slice(2) }), items: sessionItems(key.slice(2)) }; }
        if (key.startsWith('a:')) {
            const a = S.accounts.find((x) => x.index === Number(key.slice(2)));
            if (!a) return null;
            return {
                title: a.name,
                items: [
                    { text: a.active ? 'Reconnect Remote Control' : 'Switch To', action: 'switch' },
                    { text: 'New Session on This Account...', action: 'new-session-on' },
                    { separator: true },
                    { text: 'Link Host Login', action: 'link' },
                    { text: 'Unlink Login', action: 'unlink', disabled: !a.remoteLogin },
                    { separator: true },
                    { text: 'Properties', action: 'account-props' }
                ]
            };
        }
        if (key.startsWith('g:')) {
            const a = S.coord.agents.find((x) => x.id === key.slice(2));
            if (!a) return null;
            return {
                title: a.name || a.id,
                items: [
                    { text: 'Inspect', action: 'inspect', disabled: a.kind === 'person' },
                    { text: 'Post Message...', action: 'post-to' },
                    { text: 'Steer...', action: 'steer-agent', disabled: a.kind !== 'claude' },
                    { text: 'Open Session', action: 'agent-session', disabled: !a.sessionId }
                ]
            };
        }
        if (key.startsWith('r:')) {
            const f = fleetOf(Number(key.slice(2)));
            if (!f) return null;
            const busy = f.state === 'reconnecting' || f.state === 'starting';
            const running = !!(f.unit && f.unit.active === 'active');
            return {
                title: f.name,
                items: [
                    { text: 'Move to Own Folder...', action: 'fleet-move', disabled: !f.canMove || busy },
                    { separator: true },
                    { text: 'Start', action: 'fleet-start', disabled: !f.moved || running || busy },
                    { text: 'Stop', action: 'fleet-stop', disabled: !f.moved || !running || busy },
                    { text: 'Reconnect', action: 'fleet-reconnect', disabled: !f.moved || busy },
                    { separator: true },
                    { text: 'Leave Own Folder...', action: 'fleet-leave', disabled: !f.moved || busy || !!(S.fleet && S.fleet.hostMigrated && f.onHost) },
                    { text: 'Properties', action: 'fleet-props' }
                ]
            };
        }
        if (key.startsWith('b:')) {
            const b = (S.coord.builds || []).find((x) => x.id === Number(key.slice(2)));
            if (!b) return null;
            const live = b.state === 'open' || b.state === 'running';
            return { title: `Build Gate ${b.id}`, items: [{ text: b.state === 'running' ? 'End Build...' : 'Cancel Gate...', action: 'build-end', disabled: !live }, { text: 'Properties', action: 'build-props' }] };
        }
        if (key.startsWith('l:')) {
            const l = ((S.locks && S.locks.list) || []).find((x) => x.file === key.slice(2));
            return { title: key.slice(2), items: [{ text: 'Inspect Agent', action: 'lock-inspect', disabled: !(l && l.viaCoord && agentOf(l.agentId)) }] };
        }
        if (key.startsWith('c:')) return { title: 'Claim', items: [{ text: 'Release', action: 'release-claim' }] };
        if (key.startsWith('m:')) return { title: 'Message', items: [{ text: 'Read', action: 'read-message' }, { text: 'Reply...', action: 'reply' }] };
        return null;
    }

    function selId(c, prefix) {
        const k = c.sel || '';
        return k.startsWith(prefix) ? k.slice(prefix.length) : '';
    }

    function openChat(c, id) {
        if (!id) return;
        if (!S.open.includes(id)) S.open.push(id);
        if (S.open.length > 8) S.open.shift();
        c.open.add('sessions');
        c.select(`t:${id}`, true);
    }

    async function failBox(c, e) { await c.box(`<p>${esc(errText(e))}</p>`, null, { icon: 'error' }); }

    async function action(a, c, arg) {
        const sid = arg && /^[0-9a-f-]{36}$/.test(arg) ? arg : (selId(c, 's:') || (c.node && c.node.startsWith('t:') ? c.node.slice(2) : ''));
        switch (a) {
            case 'refresh':
                S.sessionsLoaded = false;
                S.chats.forEach((ch, id) => { if (c.node === `t:${id}`) void loadChat(id, false); });
                if (S.locks) S.locks = null;
                if (S.inspect && c.node === `i:${S.inspect.id}`) void loadInspect(S.inspect.id);
                await Promise.all([refreshAccounts(), loadSessions(false), loadMessages()]);
                return true;
            case 'fleet-refresh': await loadFleet(); return true;
            case 'fleet-move': await moveBox(c, Number(selId(c, 'r:'))); return true;
            case 'fleet-start':
            case 'fleet-stop':
            case 'fleet-reconnect':
            case 'fleet-leave': {
                const idx = Number(selId(c, 'r:'));
                const f = fleetOf(idx);
                if (!f) return true;
                const verb = a.slice(6);
                const n = (f.sessions || []).length;
                if (verb === 'leave') {
                    const ok = await c.box(`<p>Take <b>${esc(f.name)}</b> out of its own folder? Its Remote Control stops and does not start with the host again${n ? `, and the ${plural(n, 'session')} running in it end` : ''}. Its folder and conversations are kept; Move to Own Folder brings it back.</p>`,
                        [{ text: 'Leave Own Folder', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning' });
                    if (ok !== true) return true;
                } else if (verb !== 'start' && n) {
                    const ok = await c.box(`<p>${verb === 'stop' ? 'Stopping' : 'Reconnecting'} the Remote Control of <b>${esc(f.name)}</b> ends the ${plural(n, 'session')} running in it. Other accounts are not touched.</p>`,
                        [{ text: verb === 'stop' ? 'Stop' : 'Reconnect', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning' });
                    if (ok !== true) return true;
                }
                try {
                    const r = await send('claude_remote_fleet', { action: verb, index: idx });
                    if (r.fleet) S.fleet = r.fleet;
                    c.note(verb === 'stop' ? `${f.name}: Remote Control stopped.` : verb === 'leave' ? `${f.name} left its own folder.` : `${f.name}: ${verb === 'start' ? 'starting' : 'reconnecting'} Remote Control...`);
                    c.refresh();
                } catch (e) { await failBox(c, e); }
                return true;
            }
            case 'fleet-props': {
                const f = fleetOf(Number(selId(c, 'r:')));
                if (!f) return true;
                const u = f.unit || {};
                const rows = [['Account', f.name], ['Signed in as', f.email], ['Plan', f.plan], ['Folder', f.moved ? 'Its own' : (f.onHost ? 'The host\'s login' : 'None')],
                    ['Moved', f.movedAt ? when(f.movedAt) : ''], ['Shown in claude.ai as', f.moved ? f.remoteName : ''], ['Service', u.unit ? `${u.unit} (${u.active || ''}${u.sub ? `, ${u.sub}` : ''})` : ''],
                    ['Starts with the host', f.moved ? (u.enabled ? 'Yes' : 'No') : ''], ['Running since', u.since || ''], ['Sessions', `${(f.sessions || []).length}${f.capacity ? ` of ${f.capacity}` : ''}`],
                    ['It says', f.statusLine || f.message || '']];
                const sess = (f.sessions || []).map((x) => `<tr><td>${esc(x.title)}</td><td>${esc(x.folder)}</td><td>${esc(x.status)}</td></tr>`).join('');
                await c.box(`<table class="cd-props">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td>${esc(k)}:</td><td>${esc(v)}</td></tr>`).join('')}</table>${sess ? `<p><b>Running sessions</b></p><table class="cd-table"><thead><tr><th>Session</th><th>Folder</th><th>State</th></tr></thead><tbody>${sess}</tbody></table>` : ''}`, null, { icon: 'info', title: `${f.name} Remote Control`, width: 480 });
                return true;
            }
            case 'inspect': {
                const id = selId(c, 'g:');
                if (!id) return true;
                void loadInspect(id);
                c.open.add('co-root');
                c.select(`i:${id}`, true);
                return true;
            }
            case 'lock-inspect': {
                const l = ((S.locks && S.locks.list) || []).find((x) => x.file === selId(c, 'l:'));
                if (!l) return true;
                void loadInspect(l.agentId);
                c.select(`i:${l.agentId}`, true);
                return true;
            }
            case 'inspect-refresh': if (S.inspect) await loadInspect(S.inspect.id); return true;
            case 'inspect-session': {
                const d = S.inspect && S.inspect.data;
                const sidIn = d && d.agent && d.agent.sessionId;
                if (sidIn) openChat(c, sidIn);
                return true;
            }
            case 'close-inspect': S.inspect = null; c.select('co-agents', true); return true;
            case 'locks-refresh': await loadLocks(); return true;
            case 'build-props': {
                const b = (S.coord.builds || []).find((x) => x.id === Number(selId(c, 'b:')));
                if (!b) return true;
                const name = (id) => { const g = agentOf(id); return g ? (g.name || g.id) : id; };
                const rows = [['Target', b.target], ['Repo', b.repo], ['Requested by', name(b.requestedBy)], ['State', GATE_TEXT[b.state] || b.state], ['Note', b.note],
                    ['Opened', when(b.createdAt)], ['Started', when(b.startedAt)], ['Ended', when(b.endedAt)], ['Result', b.result], ['Forced', b.forced]];
                const parts = (b.participants || []).map((p) => `<tr><td>${esc(p.name || p.agentId)}</td><td>${esc(VOTE_TEXT[p.state] || p.state)}${p.busy ? ' (working)' : ''}</td><td>${esc(p.note || '')}</td></tr>`).join('');
                await c.box(`<table class="cd-props">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td>${esc(k)}:</td><td>${esc(v)}</td></tr>`).join('')}</table><p><b>Agents</b></p>${parts ? `<table class="cd-table"><thead><tr><th>Agent</th><th>Answer</th><th>Note</th></tr></thead><tbody>${parts}</tbody></table>` : '<p class="mmc-hint">No other agent works in this repo.</p>'}`,
                    null, { icon: 'info', title: `Build Gate ${b.id}`, width: 500 });
                return true;
            }
            case 'build-end': {
                const b = (S.coord.builds || []).find((x) => x.id === Number(selId(c, 'b:')));
                if (!b) return true;
                const running = b.state === 'running';
                const { value, fields } = await form(c, `
                    <p>${running ? 'End' : 'Cancel'} build gate ${b.id} (<b>${esc(b.target)}</b> in ${esc(b.repo)})? Every agent is told who ${running ? 'ended' : 'cancelled'} it and why.${running ? ' The build itself is not stopped: only the gate.' : ''}</p>
                    <label><span>Reason:</span><input type="text" data-cd="reason" data-cd-focus spellcheck="true" autocomplete="off" placeholder="For example left open by an agent that ended"></label>`,
                [{ text: running ? 'End Build' : 'Cancel Gate', value: true, className: 'btn-standard primary' }, { text: 'Close', value: false, className: 'btn-standard' }], { title: `Build Gate ${b.id}`, icon: 'fas fa-triangle-exclamation' });
                if (value !== true) return true;
                try {
                    const r = await send('claude_desk_coord', { action: 'build_end', buildId: b.id, reason: String(fields.reason || '').trim() || undefined });
                    if (r.agents) S.coord = { agents: r.agents, claims: r.claims || [], builds: r.builds || [], lastMessageId: r.lastMessageId || S.coord.lastMessageId };
                    c.refresh();
                } catch (e) { await failBox(c, e); }
                return true;
            }
            case 'more-sessions': await loadSessions(true); return true;
            case 'earlier': await loadChat(arg, true); return true;
            case 'open-session': openChat(c, sid); return true;
            case 'close-chat': {
                S.open = S.open.filter((x) => x !== sid);
                S.chats.delete(sid);
                if (S.watching === sid) await unwatch();
                c.select('sessions', true);
                return true;
            }
            case 'send': {
                const input = c.modal.querySelector('.cd-input');
                const text = input ? input.value.trim() : '';
                if (!text) return true;
                const btn = c.modal.querySelector('[data-act="send"]');
                if (btn) btn.disabled = true;
                try {
                    await send('claude_desk_session', { action: 'steer', id: sid, text });
                    if (input) input.value = '';
                    if (S.drafts) delete S.drafts[sid];
                    c.note('Sent.');
                } catch (e) { await failBox(c, e); }
                if (btn) btn.disabled = false;
                return true;
            }
            case 'message': await messageBox(c, sid); return true;
            case 'interrupt':
                try { await send('claude_desk_session', { action: 'interrupt', id: sid }); c.note('Stopped its current turn.'); } catch (e) { await failBox(c, e); }
                return true;
            case 'resume': await resumeBox(c, sid); return true;
            case 'open-link': {
                const l = liveOf(sid);
                const url = arg && arg.startsWith('https://') ? arg : (l && l.link);
                if (url) await call('openGrimoireUrl', url);
                return true;
            }
            case 'copy-link': {
                const l = liveOf(sid);
                const url = arg && arg.startsWith('https://') ? arg : (l && l.link);
                if (url) { await copy(url); c.note('The link was copied to the Clipboard.'); }
                return true;
            }
            case 'end': {
                const row = rowOf(sid);
                const ok = await c.box(`<p>End <b>${esc(titleOf(row || { id: sid }))}</b>? It stops at once; its conversation is kept and can be resumed.</p>`,
                    [{ text: 'End Session', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning' });
                if (ok !== true) return true;
                try { await send('claude_desk_session', { action: 'disconnect', id: sid }); c.note('The session was ended.'); } catch (e) { await failBox(c, e); }
                return true;
            }
            case 'new-session': await newSessionBox(c, null); return true;
            case 'new-session-on': await newSessionBox(c, Number(selId(c, 'a:'))); return true;
            case 'add-account': await addAccountBox(c); return true;
            case 'switch': await switchAccount(c, Number(selId(c, 'a:'))); return true;
            case 'link': {
                const idx = Number(selId(c, 'a:'));
                const lg = S.host && S.host.login;
                const ok = await c.box(`<p>Link the claude.ai login signed in on the host${lg ? ` (<b>${esc(lg.email || lg.displayName)}</b>)` : ''} to <b>${esc(accountName(idx))}</b>? Remote Control and this account's sessions sign in with it.</p>`,
                    [{ text: 'Link', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'question' });
                if (ok !== true) return true;
                try { const r = await send('link_claude_account_login', { index: idx }); if (r.accounts) S.accounts = r.accounts; c.refresh(); } catch (e) { await failBox(c, e); }
                return true;
            }
            case 'unlink': {
                const idx = Number(selId(c, 'a:'));
                const ok = await c.box(`<p>Unlink the Remote Control login of <b>${esc(accountName(idx))}</b>? A switch to it keeps the host's login as it is, and it can no longer run sessions of its own.</p>`,
                    [{ text: 'Unlink', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning' });
                if (ok !== true) return true;
                try { const r = await send('unlink_claude_account_login', { index: idx }); if (r.accounts) S.accounts = r.accounts; c.refresh(); } catch (e) { await failBox(c, e); }
                return true;
            }
            case 'account-props': {
                const a = S.accounts.find((x) => x.index === Number(selId(c, 'a:')));
                if (!a) return true;
                const l = a.remoteLogin;
                const rows = [['Name', a.name], ['Engine token', a.fingerprint], ['Engine account', a.active ? 'Yes' : 'No'], ['On the host', a.onHost ? 'Yes' : 'No'],
                    ['Remote Control login', l ? (l.email || l.displayName) : 'None'], ['Organization', l ? l.organization : ''], ['Plan', l ? l.plan : ''], ['Linked', l ? when(l.linkedAt) : '']];
                await c.box(`<table class="cd-props">${rows.map(([k, v]) => `<tr><td>${esc(k)}:</td><td>${esc(v || '')}</td></tr>`).join('')}</table>`, null, { icon: 'info', title: `${a.name} Properties`, width: 420 });
                return true;
            }
            case 'rc-reconnect':
            case 'rc-start':
            case 'rc-stop': {
                const verb = a.slice(3);
                if (verb !== 'start') {
                    const n = S.host && S.host.remoteControl && S.host.remoteControl.pane && S.host.remoteControl.pane.sessions;
                    if (n) {
                        const ok = await c.box(`<p>${verb === 'stop' ? 'Stopping' : 'Reconnecting'} Remote Control ends the ${plural(n, 'session')} running inside it. Sessions started from Claude Accounts keep running.</p>`,
                            [{ text: verb === 'stop' ? 'Stop' : 'Reconnect', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning' });
                        if (ok !== true) return true;
                    }
                }
                try {
                    const r = await send('claude_remote_control', { action: verb });
                    if (r.host) S.host = r.host;
                    if (r.host && r.host.remoteControl && r.host.remoteControl.status) S.rc = r.host.remoteControl.status;
                    c.refresh();
                } catch (e) { await failBox(c, e); }
                return true;
            }
            case 'post': await postBox(c, 'all', 'note'); return true;
            case 'post-to': await postBox(c, selId(c, 'g:'), 'note'); return true;
            case 'steer-agent': await postBox(c, selId(c, 'g:'), 'steer'); return true;
            case 'agent-session': {
                const ag = S.coord.agents.find((x) => x.id === selId(c, 'g:'));
                if (ag && ag.sessionId) openChat(c, ag.sessionId);
                return true;
            }
            case 'release-claim': {
                const id = Number(selId(c, 'c:'));
                const cl = S.coord.claims.find((x) => x.id === id);
                if (!cl) return true;
                const ok = await c.box(`<p>Release the claim on <b>${esc(cl.path)}</b>? Its agent may still be editing it.</p>`,
                    [{ text: 'Release', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning' });
                if (ok !== true) return true;
                try { const r = await send('claude_desk_coord', { action: 'release', claimId: id }); if (r.claims) S.coord.claims = r.claims; c.refresh(); } catch (e) { await failBox(c, e); }
                return true;
            }
            case 'read-message':
            case 'reply': {
                const m = S.messages.find((x) => x.id === Number(selId(c, 'm:')));
                if (!m) return true;
                if (a === 'reply') { await postBox(c, m.from, 'reply'); return true; }
                await c.box(`<p class="cd-read">${esc(m.body)}</p>`, null, { icon: 'info', title: 'Message', width: 480 });
                return true;
            }
            default: return false;
        }
    }

    async function copy(text) {
        if (typeof root.copyTextToClipboard === 'function') { await root.copyTextToClipboard(text); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
    }

    function rowOpen(key, n, c) {
        if (key.startsWith('s:')) openChat(c, key.slice(2));
        else if (key.startsWith('a:')) void action('account-props', c);
        else if (key.startsWith('g:')) void action('agent-session', c);
        else if (key.startsWith('m:')) void action('read-message', c);
        else if (key.startsWith('r:')) void action('fleet-props', c);
        else if (key.startsWith('b:')) void action('build-props', c);
        else if (key.startsWith('l:')) void action('lock-inspect', c);
    }

    // ---- dialogs ------------------------------------------------------------------------------------------

    /** A message box with fields: answers { value, fields } (fields read before the box closes). */
    async function form(c, html, buttons, opts) {
        let fields = {};
        let read = null;
        const value = await call('showConfirmationDialog', `<div class="cd-form">${html}</div>`, buttons, null, Object.assign({ title: TITLE, width: 460, icon: 'fas fa-circle-info' }, opts || {}, {
            // the confirmation box is shared and kept: its listeners end with this showing (signal)
            onDialogReady: (signal) => {
                const box = document.getElementById('confirmationDialog');
                if (!box) return;
                read = () => {
                    fields = {};
                    box.querySelectorAll('[data-cd]').forEach((el) => { fields[el.dataset.cd] = el.type === 'checkbox' ? el.checked : el.value; });
                };
                box.addEventListener('input', read, { signal });
                box.addEventListener('change', read, { signal });
                read();
                const first = box.querySelector('[data-cd-focus]');
                if (first) setTimeout(() => first.focus(), 30);
                if (opts && typeof opts.ready === 'function') opts.ready(box, signal);
            }
        }));
        return { value, fields };
    }

    const accountOptions = (selected) => S.accounts.map((a) => {
        const ok = a.onHost || a.remoteLogin;
        const label = `${a.name}${a.onHost ? ' (the host login)' : a.remoteLogin ? ` (${a.remoteLogin.email || 'own login'})` : ' (no login linked)'}`;
        return `<option value="${a.index}"${a.index === selected ? ' selected' : ''}${ok ? '' : ' disabled'}>${esc(label)}</option>`;
    }).join('');
    const modeOptions = () => MODES.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
    const defaultAccount = () => { const h = S.accounts.find((a) => a.onHost) || activeAccount(); return h ? h.index : null; };

    async function newSessionBox(c, accountIndex) {
        const folder = (S.sessions.find((r) => r.cwd) || {}).cwd || '/home/kanmi/staticforge';
        const acct = Number.isInteger(accountIndex) ? accountIndex : defaultAccount();
        const { value, fields } = await form(c, `
            <p>Start a Claude session on the host. It runs in Remote Control and keeps running when Dreamscape restarts.</p>
            <label><span>Folder:</span><input type="text" data-cd="cwd" value="${esc(folder)}" spellcheck="false" autocomplete="off"></label>
            <label><span>Account:</span><select class="vdt-select" data-cd="account">${accountOptions(acct)}</select></label>
            <label><span>Permissions:</span><select class="vdt-select" data-cd="mode">${modeOptions()}</select></label>
            <label><span>Model:</span><select class="vdt-select" data-cd="model">${MODELS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></label>
            <label><span>Or model ID:</span><input type="text" data-cd="modelId" spellcheck="false" autocomplete="off" placeholder="A full model ID (optional)"></label>
            <label><span>Effort:</span><select class="vdt-select" data-cd="effort">${EFFORTS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></label>
            <label class="cd-top"><span>First message:</span><textarea data-cd="prompt" data-cd-focus rows="5" spellcheck="true" placeholder="What should it do? (optional)"></textarea></label>
            <label><span>Title:</span><input type="text" data-cd="title" spellcheck="false" autocomplete="off" placeholder="Shown in Remote Control (optional)"></label>`,
        [{ text: 'Start', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'New Session', width: 520 });
        if (value !== true) return;
        c.note('Starting the session...');
        try {
            const model = String(fields.modelId || '').trim() || fields.model || undefined;
            const r = await send('claude_desk_session', { action: 'start', cwd: fields.cwd, account: fields.account === '' ? undefined : Number(fields.account), mode: fields.mode, prompt: fields.prompt, title: fields.title, model, effort: fields.effort || undefined });
            await afterLaunch(c, r.result);
        } catch (e) { c.note(''); await failBox(c, e); }
    }

    /**
     * Move to Own Folder: the account gets its own config folder and its own Remote Control. For the host's
     * account it stops claude-remote.service first, which ends every session in it: the ones ticked here
     * start again on the account's own folder.
     */
    async function moveBox(c, index) {
        const f = fleetOf(index);
        if (!f || !f.canMove) return;
        let payload = { action: 'move', index };
        if (f.moveRestartsHost) {
            const others = fleetRows().filter((x) => x.index !== index && x.hasLogin && !x.moved);
            const list = (S.host && S.host.sessions) || [];
            const boxes = list.length
                ? `<div class="cd-carry">${list.map((x) => `<label class="cd-check"><input type="checkbox" data-cd="carry:${esc(x.id)}"><span>${esc(x.title || shortId(x.id))}${x.folder ? ` <i>(${esc(x.folder)})</i>` : ''}</span></label>`).join('')}</div>`
                : '<p class="mmc-hint">No session runs in the host\'s Remote Control now.</p>';
            const { value, fields } = await form(c, `
                <p><b>${esc(f.name)}</b> is the host's account. Moving it stops the host's Remote Control (claude-remote.service) and <b>ends every session it runs</b>, including a Claude Code session that may be doing work right now.</p>
                ${others.length ? `<p class="cd-err">Move the other accounts first: ${esc(others.map((x) => x.name).join(', '))} ${others.length === 1 ? 'is' : 'are'} not in ${others.length === 1 ? 'its' : 'their'} own folder yet.</p>` : ''}
                <p>Bring these sessions over onto ${esc(f.name)}'s own folder once it is connected:</p>
                ${boxes}`,
            [{ text: 'Move and Restart', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Move to Own Folder', width: 520, icon: 'fas fa-triangle-exclamation' });
            if (value !== true) return;
            const carry = Object.keys(fields).filter((k) => k.startsWith('carry:') && fields[k] === true).map((k) => k.slice(6));
            payload = Object.assign(payload, { confirmHost: true, carry });
        } else {
            const ok = await c.box(`<p>Move <b>${esc(f.name)}</b> to its own folder? It gets its own Claude configuration and its own Remote Control (shown in claude.ai as <b>${esc(f.remoteName)}</b>), which runs next to the other accounts' and starts with the host. Transcripts, settings and permissions stay shared.</p>`,
                [{ text: 'Move', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'question', width: 440 });
            if (ok !== true) return;
        }
        try {
            const r = await send('claude_remote_fleet', payload);
            if (r.fleet) S.fleet = r.fleet;
            c.note(`Moving ${f.name} to its own folder...`);
            c.refresh();
        } catch (e) { await failBox(c, e); }
    }

    async function resumeBox(c, id) {
        const row = rowOf(id) || { id };
        const acct = row.account && Number.isInteger(row.account.index) ? row.account.index : defaultAccount();
        const { value, fields } = await form(c, `
            <p>Resume <b>${esc(titleOf(row))}</b> in Remote Control. The same session continues (no copy is made).</p>
            <label><span>Account:</span><select class="vdt-select" data-cd="account">${accountOptions(acct)}</select></label>
            <label><span>Permissions:</span><select class="vdt-select" data-cd="mode">${modeOptions()}</select></label>`,
        [{ text: 'Resume', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Resume Session' });
        if (value !== true) return;
        c.note('Resuming the session...');
        try {
            const r = await send('claude_desk_session', { action: 'resume', id, account: fields.account === '' ? undefined : Number(fields.account), mode: fields.mode, title: titleOf(row) });
            await afterLaunch(c, r.result);
        } catch (e) { c.note(''); await failBox(c, e); }
    }

    async function afterLaunch(c, res) {
        if (!res) return;
        if (res.state === 'failed') { c.note(''); await c.box(`<p>The session did not start. ${esc(res.message || '')}</p>`, null, { icon: 'error' }); return; }
        c.note(res.state === 'connected' || res.state === 'live' ? 'The session is in Remote Control.' : (res.message || 'The session is starting.'));
        await loadSessions(false);
        openChat(c, res.id);
        if (res.link) {
            const go = await c.box(`<p>The session is running in Remote Control${res.account ? ` on <b>${esc(res.account.name)}</b>` : ''}.</p><p class="cd-link-line">${esc(res.link)}</p>`,
                [{ text: 'Open in claude.ai', value: 'open', className: 'btn-standard primary' }, { text: 'Copy Link', value: 'copy', className: 'btn-standard' }, { text: 'Close', value: false, className: 'btn-standard' }], { icon: 'info', title: 'Session Started' });
            if (go === 'open') await call('openGrimoireUrl', res.link);
            else if (go === 'copy') await copy(res.link);
        }
    }

    async function messageBox(c, id) {
        const row = rowOf(id) || { id };
        const l = liveOf(id);
        const { value, fields } = await form(c, `
            <p>Send a message to <b>${esc(titleOf(row))}</b>.${l && l.status === 'busy' ? ' It is working: the message reaches it as steering for its current turn.' : ''}</p>
            <textarea data-cd="text" data-cd-focus rows="6" spellcheck="true"></textarea>`,
        [{ text: 'Send', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Send Message' });
        if (value !== true || !String(fields.text || '').trim()) return;
        try { await send('claude_desk_session', { action: 'steer', id, text: fields.text }); c.note('Sent.'); } catch (e) { await failBox(c, e); }
    }

    async function postBox(c, to, kind) {
        const agents = S.coord.agents.filter((a) => a.kind !== 'person');
        const opts = [`<option value="all"${to === 'all' ? ' selected' : ''}>Everyone</option>`].concat(agents.map((a) => `<option value="${esc(a.id)}"${a.id === to ? ' selected' : ''}>${esc(a.name || a.id)}${a.task ? ` - ${esc(a.task.slice(0, 50))}` : ''}</option>`)).join('');
        const kinds = [['note', 'Note'], ['steer', 'Steering (typed into its terminal too)'], ['question', 'Question'], ['reply', 'Reply']]
            .map(([v, t]) => `<option value="${v}"${v === kind ? ' selected' : ''}>${esc(t)}</option>`).join('');
        const { value, fields } = await form(c, `
            <label><span>To:</span><select class="vdt-select" data-cd="to">${opts}</select></label>
            <label><span>Kind:</span><select class="vdt-select" data-cd="kind">${kinds}</select></label>
            <textarea data-cd="body" data-cd-focus rows="5" spellcheck="true"></textarea>`,
        [{ text: 'Post', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Post Message' });
        if (value !== true || !String(fields.body || '').trim()) return;
        try {
            const r = await send('claude_desk_coord', { action: 'post', to: fields.to, kind: fields.kind, body: fields.body });
            c.note(r.sent && r.sent.delivered === 'tmux' ? 'Posted and typed into its terminal.' : 'Posted.');
            await loadMessages();
        } catch (e) { await failBox(c, e); }
    }

    async function switchAccount(c, index) {
        const a = S.accounts.find((x) => x.index === index);
        if (!a) return;
        const n = S.host && S.host.remoteControl && S.host.remoteControl.pane && S.host.remoteControl.pane.sessions;
        const parallel = S.sessions.filter((s) => s.account && s.account.index === index && liveOf(s.id)).length;
        const lines = [`<p>${a.active ? `Reconnect Remote Control as <b>${esc(a.name)}</b>?` : `Make <b>${esc(a.name)}</b> the account the Claude engine and Remote Control use?`}</p>`];
        if (n) lines.push(`<p>The ${plural(n, 'session')} running inside Remote Control end. Sessions started from Claude Accounts keep running.</p>`);
        if (parallel && !a.onHost) lines.push(`<p>${plural(parallel, 'session')} of this account run on its own login now. Its login will then be on the host too; end those sessions first if they will run for long.</p>`);
        const ok = await c.box(lines.join(''), [{ text: a.active ? 'Reconnect' : 'Switch', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'question' });
        if (ok !== true) return;
        try {
            const r = await send('switch_claude_account', { index });
            if (r.accounts) S.accounts = r.accounts;
            if (r.host) S.host = r.host;
            c.refresh();
        } catch (e) { await failBox(c, e); }
    }

    // ---- Add Account (sign in on the host) -----------------------------------------------------------------

    const LG_ACTIVE = new Set(['starting', 'waiting_code', 'verifying']);

    async function addAccountBox(c) {
        try { const r = await send('claude_account_login', { action: 'status' }); if (r.login) S.login = r.login; } catch (_) { /* below */ }
        if (!LG_ACTIVE.has(S.login.state)) {
            const { value, fields } = await form(c, `
                <p>Sign a Claude account in on the host. You sign in twice in Alchemy: once for Remote Control and the account's sessions, once for the engine's long-lived token. The account is added when both are done.</p>
                <label><span>Name:</span><input type="text" data-cd="name" data-cd-focus spellcheck="false" autocomplete="off" placeholder="For example Claude Work"></label>`,
            [{ text: 'Next', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Add Account' });
            if (value !== true) return;
            try { const r = await send('claude_account_login', { action: 'start', name: fields.name }); if (r.login) S.login = r.login; } catch (e) { await failBox(c, e); return; }
        }
        // the sign-in steps: the box redraws itself from the flux feed's pushes
        for (;;) {
            const st = S.login;
            if (st.state === 'done') {
                await c.box(`<p>${esc(st.message || 'The account was added.')}</p>`, null, { icon: 'info', title: 'Add Account' });
                await refreshAccounts();
                return;
            }
            if (!LG_ACTIVE.has(st.state)) {
                if (st.state !== 'idle') await c.box(`<p>${esc(st.message || 'The sign-in did not finish.')}</p>`, null, { icon: 'error', title: 'Add Account' });
                return;
            }
            const res = await form(c, loginHtml(st), [
                { text: 'Submit Code', value: 'code', className: 'btn-standard primary' },
                { text: 'Cancel Sign-in', value: 'cancel', className: 'btn-standard' },
                { text: 'Close', value: false, className: 'btn-standard' }
            ], {
                title: `Add Account - Step ${st.stepNumber || 1} of ${st.steps || 2}`,
                width: 520,
                ready: (box, signal) => {
                    // the link, the step and what happened follow the sign-in as the server moves it on
                    let step = st.stepNumber;
                    S.loginBox = () => {
                        const lg = S.login;
                        const holder = box.querySelector('.cd-login-state');
                        if (holder) holder.innerHTML = LG_ACTIVE.has(lg.state) ? loginStateHtml(lg) : `<p>${esc(lg.state === 'done' ? (lg.message || 'The account was added. Close this box.') : (lg.message || 'The sign-in ended.'))}</p>`;
                        const head = box.querySelector('.cd-login-step');
                        if (head) head.textContent = lg.stepTitle || '';
                        const title = document.getElementById('confirmationDialogTitle');
                        if (title && lg.stepNumber) title.textContent = `Add Account - Step ${lg.stepNumber} of ${lg.steps || 2}`;
                        if (lg.stepNumber !== step) {
                            step = lg.stepNumber;
                            const input = box.querySelector('[data-cd="code"]');
                            if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
                        }
                    };
                    box.addEventListener('click', (ev) => {
                        const b = ev.target.closest('[data-cd-login]');
                        if (!b || !S.login.url) return;
                        if (b.dataset.cdLogin === 'copy') void copy(S.login.url).then(() => { b.textContent = 'Copied'; });
                        else void call('openGrimoireUrl', S.login.url);
                    }, { signal });
                }
            });
            S.loginBox = null;
            if (res.value === 'cancel') {
                try { const r = await send('claude_account_login', { action: 'cancel' }); if (r.login) S.login = r.login; } catch (e) { await failBox(c, e); }
                return;
            }
            if (res.value === 'code') {
                const code = String(res.fields.code || '').trim();
                if (!code) continue;
                try { const r = await send('claude_account_login', { action: 'code', code }); if (r.login) S.login = r.login; } catch (e) { await failBox(c, e); }
                continue;
            }
            // Close: the sign-in keeps going on the host; Add Account... comes back to it
            if (LG_ACTIVE.has(S.login.state)) { c.note('The sign-in is still open: Add Account... continues it.'); return; }
        }
    }

    function loginStateHtml(st) {
        if (st.state === 'starting') return '<p class="mmc-hint">Getting the sign-in link from the host...</p>';
        if (st.state === 'verifying') return '<p class="mmc-hint">Checking the code...</p>';
        return `<p>1. Open this link and sign in with the account you are adding:</p>
            <p class="cd-link-line">${esc(st.url || '')}</p>
            <p><button type="button" class="btn-standard" data-cd-login="open">Open in Alchemy</button> <button type="button" class="btn-standard" data-cd-login="copy">Copy Link</button></p>
            ${st.message ? `<p class="cd-err">${esc(st.message)}</p>` : ''}`;
    }

    function loginHtml(st) {
        return `<p><b class="cd-login-step">${esc(st.stepTitle || 'Sign in')}</b>${st.name ? ` - ${esc(st.name)}` : ''}</p>
            <div class="cd-login-state">${loginStateHtml(st)}</div>
            <label><span>2. Paste the code claude.ai shows:</span><input type="text" data-cd="code" data-cd-focus spellcheck="false" autocomplete="off"></label>`;
    }

    // ---- the console ----------------------------------------------------------------------------------------

    function def(app) {
        const A = app.url('assets').replace(/\/$/, '');
        const w = Math.min(980, Math.max(600, (root.innerWidth || 1024) - 40));
        const h = Math.min(640, Math.max(420, (root.innerHeight || 768) - 80));
        return {
            id: ID,
            title: TITLE,
            icon16: `${A}/claudedesk-16.png`,
            icon32: `${A}/claudedesk-32.png`,
            taskbarIcon: `${A}/claudedesk-24.png`,
            width: w,
            height: h,
            expanded: ['root', 'sessions', 'co-root'],
            about: { version: VERSION, lines: ['Claude accounts, Remote Control and the Claude sessions of this host.'] },
            nodes,
            page,
            commands,
            selCommands,
            action,
            rowOpen,
            status: (n) => {
                if (n.id === 'sessions') return S.sessionsLoaded ? `${S.sessions.length} of ${S.sessionsTotal} sessions` : '';
                if (n.id === 'running') return plural(S.live.length, 'session');
                if (n.id === 'accounts') return plural(S.accounts.length, 'account');
                if (n.id === 'rc') { const r = fleetRows(); return r.length ? `${r.filter((f) => f.state === 'connected').length} of ${plural(r.length, 'account')} connected` : ''; }
                if (n.id === 'co-builds') return plural((S.coord.builds || []).filter((b) => b.state === 'open' || b.state === 'running').length, 'gate') + ' open';
                if (n.id === 'co-locks') return S.locks ? plural(S.locks.list.length, 'lock') : '';
                if (n.id.startsWith('t:')) { const ch = S.chats.get(n.id.slice(2)); return ch ? plural(ch.messages.length, 'message') : ''; }
                return `Remote Control: ${RC_TEXT[(S.rc && S.rc.state) || 'unknown'] || 'Unknown'}`;
            },
            onSelect: undefined,
            onOpen: () => {},
            onClose: () => {
                const app0 = S.app;
                S.c = null;
                void unwatch();
                void subscribe(false);
                if (app0 && !S.exiting) { S.exiting = true; app0.exit(); }
            }
        };
    }

    let running = null;

    async function start(app) {
        if (running && S.c && S.c.modal.isConnected) {
            call('bringModalToFront', S.c.modal);
            app.exit();
            return;
        }
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) throw new Error('The management console could not load.');
        S = blank();
        S.app = app;
        running = app;
        wire(app);
        const c = root.mmcConsole.open(def(app));
        S.c = c;
        // the open chat follows the selection: leaving it stops its pushes
        const select = c.select.bind(c);
        c.select = (id, record) => {
            if (S.watching && id !== `t:${S.watching}`) void unwatch();
            select(id, record);
            if (id && id.startsWith('t:') && S.chats.has(id.slice(2))) void watch(id.slice(2));
        };
        if (programFaults()) programFaults().registerProgram(c.modal.id, { name: TITLE, terminate: () => app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: ID }) });
        app.onExit(() => {
            if (programFaults()) programFaults().unregisterProgram(`mmcConsole_${ID}`);
            clearTimeout(S.relist);
            running = null;
            if (S.c && !S.exiting) { S.exiting = true; S.c.close(); }
        });
        await subscribe(true);
        void loadSessions(false);
        void loadFleet();
    }
    const programFaults = () => (root.programFaults && root.programFaults.registerProgram ? root.programFaults : null);

    root.melatonClaudeDesk = { start, _state: () => S };
    if (typeof melatonApps !== 'undefined') melatonApps.define(ID, start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
