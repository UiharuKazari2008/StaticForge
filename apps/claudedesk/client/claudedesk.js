/**
 * Fleet (desktop; was Claude Accounts until Nov 24): an MMC 3.0 console (mmcConsole.js, the shell Server Manager and the other
 * snap-ins share) over the host's Claude accounts, its Remote Control, every Claude session on the host and
 * the agents' coordination. The phone has the same accounts and host in Melaton Mobile's Claude Accounts
 * (wmClaudeAccounts.js, also named Fleet); both use one backend.
 *
 *   Fleet (<server name>)       summary: every account's plan usage as progress bars (claude_usage feed,
 *                               subscribed while this page is shown), the engine's account, Remote Control,
 *                               sessions running, agents
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
 *       Build Gates / Device Queue / Busy Locks      builds waiting on every agent's ready, the repo's .agent-* locks
 *       Supervisor              reviews of finished agent turns against what was asked (claude_desk_supervisor):
 *                               settings, the reviews, Send to Session / Re-check / Dismiss
 *       Inspect: <agent>        what one agent is doing: files it edited, commands, last words, claims
 *
 * Nov 24 tree: Active Work (Supervised Work -> work item -> its session -> its background agents; Unsupervised
 * Sessions), Work Queue, Sessions, Activity (every command, edit and tool call), Memory (the shared memory of
 * every agent, claude_fleet_memory), Coordination, Supervisor (pause /
 * resume, restart waits), Accounts, Remote Control, Contractors (other machines that run Fleet work).
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
    const TITLE = 'Fleet';
    const VERSION = '1.0.0';
    const MODES = [['bypassPermissions', 'Bypass permissions'], ['acceptEdits', 'Accept edits'], ['default', 'Ask before acting'], ['plan', 'Plan only']];
    const RC_TEXT = { connected: 'Connected', reconnecting: 'Reconnecting', starting: 'Starting', error: 'Error', stopped: 'Stopped', unknown: 'Unknown', 'not-moved': 'Not in its own folder' };
    const MODELS = [['', 'Account default'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['fable', 'Fable']];
    const EFFORTS = [['', 'Default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];
    const GATE_TEXT = { open: 'Waiting', running: 'Building', done: 'Ended', cancelled: 'Cancelled', expired: 'Lapsed' };
    const VOTE_TEXT = { ready: 'Ready', 'not-ready': 'Not ready', auto: 'Ready (idle)', pending: 'Not answered' };
    const VI = '/static_images/vista-icons';
    // a session is a conversation: the speech bubble (Yukimi, Nov 24 2026: a better icon than the remote window)
    const SESSION16 = '/static_images/vista-cmdbar/discuss.png';
    /** A session's icon says what it does now (Yukimi, Nov 25 2026): working (green dot), idle (the bubble), ended (grey). */
    const sessIcon = (sid) => {
        const A = S.app ? S.app.url('assets').replace(/\/$/, '') : '/melaton-apps/claudedesk/assets';
        const l = liveOf(sid);
        return `${A}/session-${l ? (l.status === 'busy' ? 'working' : 'idle') : 'ended'}-16.png`;
    };
    const ITEMS = '/static_images/vista-cpl/items';
    const QUESTION16 = '/static_images/vista-explorer/help-16.png';
    const SENTBACK16 = '/static_images/vista-cmdbar/undo.png';
    const PAUSE16 = '/static_images/vista-cmdbar/pause.png'; // a paused session: the blue pause sign, not a warning (Yukimi: a pause is not a fault) // Sent Back: the Supervisor's notes went back to it (not the plain session icon) // Input Required: a question, not Pending's info icon
    const FOLDER16 = `${VI}/explorer/folder-16.png`;
    const PAGE = 50;
    const MSG_PAGE = 40; // messages a session view loads at a time
    const MSG_MAX = 300; // message rows kept in the page; the far end is dropped and read again on scroll back
    const SHOW_ITEMS = [['thinking', 'Show Thinking'], ['edits', 'Show File Edits'], ['tools', 'Show Tool Calls'], ['results', 'Show Tool Results']];
    const SHOW_DEFAULT = { thinking: false, edits: false, tools: false, results: false };

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
        // Fleet reports every server error itself (its own message box / line): no desktop "Unhandled exception"
        // window as well (wsClient.handlesErrors)
        const r = await (typeof c.handlesErrors === 'function' ? c.handlesErrors(() => c.sendMessage(type, payload || {}, false)) : c.sendMessage(type, payload || {}, false));
        const d = r && r.data && typeof r.data === 'object' && !Array.isArray(r.data) && ('success' in r.data || 'accounts' in r.data || 'items' in r.data) ? r.data : r;
        if (d && d.success === false) throw new Error(d.error || d.message || 'The server refused');
        return d || {};
    }

    // ---- state ------------------------------------------------------------------------------------------

    function blank() {
        return {
            asks: new Map(),
            app: null,
            c: null,
            host: null,
            accounts: [],
            live: [],
            coord: { agents: [], claims: [], builds: [], devices: { devices: [], waiting: 0, holding: 0 }, lastMessageId: 0 },
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
            usage: new Map(), // claude_usage rows by account id
            usageOn: false,
            usageLoaded: false,
            usageError: '',
            spend: { data: null, loaded: false, loading: false, gone: false, error: '' }, // the Supervisor's cost and balances (Plan Usage)
            hist: { data: null, loaded: false, loading: false, gone: false, error: '', at: 0 }, // the daily cost and usage timeline (Dashboard, Last 30 days)
            sup: { loaded: false, data: null, draft: null, sel: '', busy: '', error: '', unavailable: false, lastReviewId: null },
            liveKey: '',
            show: Object.assign({}, SHOW_DEFAULT), // what the session view shows (saved per user: registry ShowView)
            winSeq: 0,
            wins: new Set(), // the item windows (a folded thinking / edit in full)
            engines: null, // claude_fleet_engines, read when a wizard or the queue needs it
            wsel: new Set(), wscope: '', // the work requests picked in the list (Ctrl / Shift / check boxes)
            act: { rows: [], next: null, total: 0, kind: '', q: '', sessionId: '', loaded: false, loading: false, error: '', gone: false, seq: 0 }, // Activity
            mem: memBlank('active'), // Memory
            memRv: memBlank('review'), // Needs Review
            memStats: null,
            memRepos: new Set(),
            memOn: false,
            memVer: undefined,
            memBusy: false,
            dig: { repo: '', text: '', loaded: false, loading: false, error: '', gone: false }, // Session Digest
            conChats: new Map(), // contractor id | session id -> { messages, loading, error }
            con: { list: [], invites: [], loaded: false, loading: false, error: '', gone: false }, // Contractors
            awAgents: new Map() // session id -> { agents, loading, gone, error }: the background agents shown under an Active Work session
        };
    }
    let S = blank();

    /** The session a tree node shows: its own node under Sessions (t:), in Active Work (aw:s:) or among the unsupervised (us:). */
    const nodeSid = (id) => { const m = /^(?:t:|aw:s:|us:|mg:)(.+)$/.exec(id || ''); return m ? m[1] : ''; };
    /** The Manager Session (Supervisor settings managerSessionId): the standing session that fixes Fleet and the Supervisor. */
    const managerSid = () => String((S.sup.data && S.sup.data.settings && S.sup.data.settings.managerSessionId) || '');
    // a session whose conversation was handed on to another id (a fork, sent to the background) shows that one's live state
    const liveOf = (id) => {
        let l = S.live.find((s) => s.id === id) || null;
        for (let hop = 0; l && l.continuedIn && hop < 5; hop += 1) { const n = S.live.find((s) => s.id === l.continuedIn); if (!n) break; l = n; }
        return l;
    };
    const rowOf = (id) => S.sessions.find((s) => s.id === id) || (S.chats.get(id) && S.chats.get(id).row) || null;
    const accountName = (idx) => { const a = S.accounts.find((x) => x.index === idx); return a ? a.name : ''; };
    const activeAccount = () => S.accounts.find((a) => a.active) || null;
    const fleetRows = () => (S.fleet && Array.isArray(S.fleet.accounts) ? S.fleet.accounts : []);
    const fleetOf = (idx) => fleetRows().find((f) => f.index === idx) || null;
    /** Accounts whose login expired (fleet row availability.state 'login', from the server's snapshot): they need signing in again. */
    const loginRows = () => fleetRows().filter((f) => f.availability && f.availability.state === 'login');
    const needsLogin = (idx) => { const f = fleetOf(idx); return !!(f && f.availability && f.availability.state === 'login'); };
    const loginText = () => { const n = loginRows().length; return n ? `${n} ${n === 1 ? 'account needs' : 'accounts need'} signing in` : ''; };
    const agentOf = (id) => S.coord.agents.find((x) => x.id === id) || null;
    function inspectName() {
        if (!S.inspect) return '';
        const a = agentOf(S.inspect.id) || (S.inspect.data && S.inspect.data.agent) || null;
        return (a && (a.name || a.id)) || S.inspect.id;
    }

    function stateText(row) {
        const h = holdOf(row.id);
        if (h) return holdWord(h);
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
            const key = S.live.map((s) => `${s.id}${s.title ? `=${s.title}` : ''}`).join(',');
            liveChanged = key !== S.liveKey;
            S.liveKey = key;
        }
        if ('coord' in changed) {
            const before = S.coord.lastMessageId;
            S.coord = changed.coord || S.coord;
            if (S.coord.lastMessageId !== before && /^co-messages|^co-root/.test(S.c ? S.c.node : '')) void loadMessages();
        }
        // the supervisor reviewed something: its list is read again once, only when the last review changed
        if (changed.supervisor && typeof changed.supervisor === 'object') {
            const sp = changed.supervisor;
            const ver = sp.version != null ? sp.version : (sp.lastReviewId == null ? null : sp.lastReviewId);
            S.sup.counts = { active: sp.workActive || 0, queued: sp.workQueued || 0 };
            const pushed = !!(sp.spend && typeof sp.spend === 'object');
            if (pushed) { S.spend.data = sp.spend; S.spend.loaded = true; S.spend.gone = false; }
            // version moves on every review, work item and lock change: the status is read again once per change
            if (ver !== S.sup.version) {
                // the tree's counts (Waiting, Active, Reviews...) come from it too: read once per change, whatever page is shown
                if (!S.sup.loading) void loadSupervisor();
                else S.sup.stale = true;
                S.sup.version = ver;
                if (!pushed) { if (S.c && usageWanted(S.c.node)) void loadSpend(); else S.spend.loaded = false; }
            }
            S.sup.lastReviewId = sp.lastReviewId == null ? null : sp.lastReviewId;
        }
        if (S.host && S.host.remoteControl && S.host.remoteControl.status && S.rc.state === 'unknown') S.rc = S.host.remoteControl.status;
        // a session started or ended: the list (its order and states) is read again once
        if (liveChanged && S.sessionsLoaded) { clearTimeout(S.relist); S.relist = setTimeout(() => void loadSessions(false), 800); }
    }

    // Pushes come in bursts (status, agents, usage, transcript): they become one refresh ~60 ms later, and a console
    // that is hidden or minimized is refreshed once when it shows again (the page is patched in place, see mmcConsole patch()).
    const RP = { t: 0, pending: false, io: null, ioFor: null };
    function repaintNow() {
        RP.t = 0;
        const c = S.c;
        if (!c || !c.modal || !c.modal.isConnected) { RP.pending = false; return; }
        if (typeof document !== 'undefined' && (document.hidden || !c.modal.getClientRects().length)) {
            RP.pending = true;
            if (typeof IntersectionObserver === 'function' && RP.ioFor !== c.modal) {
                if (RP.io) RP.io.disconnect();
                RP.ioFor = c.modal;
                RP.io = new IntersectionObserver((es) => { if (RP.pending && es.some((e) => e.isIntersecting)) { RP.pending = false; repaint(); } });
                RP.io.observe(c.modal);
            }
            return;
        }
        RP.pending = false;
        c.refresh();
        wmPlace();
    }
    function repaint() { if (S.c && S.c.modal && S.c.modal.isConnected && !RP.t) RP.t = setTimeout(repaintNow, 60); }

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
            // read fresh whenever the window (re)subscribes: the module outlives a closed window and its copy goes stale
            void loadSupervisor();
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
        document.addEventListener('visibilitychange', () => { wmSync(); if (!document.hidden) wmPoke(); }, opts); // the workflow map's timer rests while hidden
        bgWire(app);
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
        c.on('claude_fleet_memory_status', (msg) => {
            if (!S.memOn) return;
            const d = msg && msg.changed ? msg : (msg && msg.data) || {};
            memTake(d.changed || d);
            if (S.c && MEM_NODES.has(S.c.node)) repaint();
        }, opts);
        c.on('claude_fleet_contractors_status', (msg) => { conTake(msg); if (S.c) repaint(); }, opts);
        c.on('claude_usage_status', (msg) => {
            if (!S.usageOn) return;
            const d = msg && msg.changed ? msg : (msg && msg.data) || {};
            usageApply(d.changed, d.removed, false);
            if (S.c && usageWanted(S.c.node)) repaint();
        }, opts);
        // a session's AskUserQuestion shows as a request form (the Supervisor's ask_user); the row at the end of its chat opens it again
        c.on('request_form', (msg) => {
            const d = (msg && msg.data) || msg || {};
            if (!d.id || !d.claude || !d.claude.sessionId) return;
            S.asks.set(d.id, d);
            askDraw(d.claude.sessionId);
        }, opts);
        c.on('request_form_closed', (msg) => {
            const d = (msg && msg.data) || msg || {};
            const a = S.asks.get(String(d.id));
            if (!a) return;
            S.asks.delete(String(d.id));
            askDraw(a.claude.sessionId);
        }, opts);
        c.on('claude_desk_tasks', (msg) => {
            const d = (msg && msg.data) || msg || {};
            if (d.sessionId) tasksApply(d.sessionId, d, true);
        }, opts);
        c.on('claude_desk_transcript_append', (msg) => {
            const d = (msg && msg.data) || msg || {};
            const chat = S.chats.get(d.id);
            if (!chat || !Array.isArray(d.messages)) return;
            chat.end = d.end;
            if (d.insight) { chat.ins = d.insight; insUpdate(d.id); }
            // the far end is out of the page (the reader scrolled up through 300 rows): the push only moves the end
            if (chat.tailCut) return;
            const seen = new Set(chat.messages.map(msgKey).concat(Array.from(chat.absorbed || [])));
            const added = [];
            shownOnly(d.messages).forEach((m) => { if (!seen.has(msgKey(m))) { chat.messages.push(m); seen.add(msgKey(m)); added.push(m); } });
            pendingReconcile(chat, added);
            // a push can carry rows from before the newest drawn one (a watch that started at an older offset): keep file order
            const unsorted = sortRows(chat);
            const merged = coalesce(chat) || unsorted;
            if (S.c && nodeSid(S.c.node) === d.id) { if (merged) redrawLog(d.id); else appendChat(d.id); }
        }, opts);
        // the server forgets a dropped socket's subscriptions and watches
        c.on('connected', () => {
            if (!S.c) return;
            S.subscribed = false;
            S.fluxOn = false;
            if (S.usageOn) { S.usageOn = false; void usageWatch(true); }
            void subscribe(true);
            if (S.memOn) { S.memOn = false; void memWatch(true); }
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
            if (r.agents) S.coord = { agents: r.agents, claims: r.claims || [], builds: r.builds || S.coord.builds || [], devices: r.devices || S.coord.devices, lastMessageId: r.lastMessageId || 0 };
        } catch (e) { S.coordError = errText(e); }
        repaint();
    }

    // ---- Activity: every shell command, tool call and file edit (claude_fleet_activity) -----------------------

    const ACT_PAGE = 60;
    const ACT_KINDS = [['', 'All'], ['shell', 'Shell commands'], ['edit', 'File edits'], ['tool', 'Tool calls']];
    const KIND_TEXT = { shell: 'Shell', edit: 'Edit', tool: 'Tool' };

    /** The first page (filters changed / read again) or the next one ("More": before = the reply's next). */
    async function loadActivity(more) {
        const A = S.act;
        if (A.loading) return;
        A.loading = true;
        const seq = ++A.seq;
        const f = { kind: A.kind || undefined, sessionId: A.sessionId || undefined, q: A.q || undefined };
        try {
            const r = unwrap(await send('claude_fleet_activity', Object.assign({ action: 'list', limit: ACT_PAGE }, f, more && A.next != null ? { before: A.next } : {})), 'rows');
            if (seq === A.seq) {
                const rows = Array.isArray(r.rows) ? r.rows : [];
                A.rows = more ? A.rows.concat(rows.filter((x) => !A.rows.some((y) => y.id === x.id))) : rows;
                A.next = r.next == null ? null : r.next;
                A.total = r.total == null ? A.rows.length : r.total;
                A.error = '';
                A.gone = false;
            }
        } catch (e) { if (seq === A.seq) { if (isGone(e)) A.gone = true; else A.error = errText(e); } }
        A.loading = false;
        A.loaded = true;
        repaint();
    }

    /** One row's detail (claude_fleet_activity detail): who, why, the parameters and the output, in its own window. */
    async function openActivity(id) {
        if (!S.c || id == null) return;
        const key = `act:${id}`;
        const have = Array.from(S.wins).find((x) => x.key === key);
        if (have) { call('bringModalToFront', have.modal); return; }
        const row = S.act.rows.find((x) => String(x.id) === String(id));
        const w = openViewer({ key, title: row ? `${KIND_TEXT[row.kind] || 'Activity'}: ${String(row.summary || row.tool || '').slice(0, 40)}` : 'Activity', body: '<p class="mmc-hint">Reading...</p>' });
        w.modal.addEventListener('click', (ev) => { const b = ev.target.closest('[data-cd-open-session]'); if (b && S.c) openChat(S.c, b.dataset.cdOpenSession); });
        w.modal.addEventListener('click', (ev) => { const b = ev.target.closest('[data-cd-ask]'); const a = b && S.asks.get(b.dataset.cdAsk); if (a && typeof root.presentRequestForm === 'function') root.presentRequestForm(a); });
        try {
            const r = unwrap(await send('claude_fleet_activity', { action: 'detail', id }), 'row');
            w.set(activityHtml(r));
        } catch (e) { w.set(`<p class="cd-err">${esc(isGone(e) ? NOT_YET : errText(e))}</p>`); }
    }

    function actProps(rows) {
        return `<table class="cd-props">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td>${esc(k)}:</td><td>${v}</td></tr>`).join('')}</table>`;
    }
    /** The call's parameters: a command in full, an edit as old / new, anything else as name and value. */
    function actInputHtml(row, input) {
        if (!input || typeof input !== 'object') return '<p class="mmc-hint">No parameters were recorded.</p>';
        const keys = Object.keys(input);
        if (!keys.length) return '<p class="mmc-hint">It took no parameters.</p>';
        let out = '';
        const rest = keys.filter((k) => !((k === 'command' && typeof input[k] === 'string') || k === 'old_string' || k === 'new_string' || (k === 'content' && row.kind === 'edit')));
        if (typeof input.command === 'string') out += `<pre class="cd-pre cd-act-cmd">${esc(input.command)}</pre>`;
        if (typeof input.new_string === 'string') out += editsHtml([{ old: input.old_string || '', new: input.new_string }]);
        else if (row.kind === 'edit' && typeof input.content === 'string') out += editsHtml([{ old: '', new: input.content }]);
        if (rest.length) {
            out += `<table class="cd-props">${rest.map((k) => {
                const v = input[k];
                const text = typeof v === 'string' ? v : JSON.stringify(v);
                return `<tr><td>${esc(k)}:</td><td>${String(text).length > 160 ? `<pre class="cd-pre">${esc(text)}</pre>` : esc(text)}</td></tr>`;
            }).join('')}</table>`;
        }
        return out;
    }
    function activityHtml(r) {
        const row = r.row || {};
        const ses = r.session || {};
        const why = r.why || {};
        const who = row.agentId ? `Background agent${row.agentDescription ? `: ${esc(row.agentDescription)}` : ''}` : 'The session itself';
        const link = ses.id ? ` <button type="button" class="btn-standard" data-cd-open-session="${esc(ses.id)}">Open Session</button>` : '';
        return `<div class="cd-act">
            <h4>Who</h4>${actProps([['Session', `${esc(ses.title || row.sessionTitle || shortId(row.sessionId))}${link}`], ['Account', esc(ses.account || row.account || '')], ['Acted as', who], ['Folder', esc(ses.cwd || '')], ['When', esc(when(row.ts))], ['Tool', esc(row.tool || '')]])}
            <h4>Why</h4>${why.request ? `<p class="mmc-hint">The request:</p><pre class="cd-pre cd-act-why">${esc(why.request)}</pre>` : ''}${why.assistantText ? `<p class="mmc-hint">What Claude said just before:</p><pre class="cd-pre cd-act-why">${esc(why.assistantText)}</pre>` : ''}${why.request || why.assistantText ? '' : '<p class="mmc-hint">No reason was recorded for this call.</p>'}
            <h4>${row.kind === 'shell' ? 'Command' : (row.kind === 'edit' ? 'Edit' : 'Parameters')}</h4>${row.description ? `<p class="mmc-hint">${esc(row.description)}</p>` : ''}${actInputHtml(row, r.input)}
            <h4>Output${row.error ? ' (it failed)' : ''}</h4>${r.output == null ? '<p class="mmc-hint">No output was recorded.</p>' : `<pre class="cd-pre cd-act-out${row.error ? ' is-error' : ''}">${esc(r.output || '(empty)')}</pre>`}</div>`;
    }

    // ---- Memory: the shared memory every Fleet agent reads and writes (claude_fleet_memory) -----------------

    const MEM_PAGE = 50;
    const MEM_STATUS = [['active', 'Active'], ['proposed', 'Proposed'], ['flagged', 'Flagged'], ['stale', 'Stale'], ['rejected', 'Rejected'], ['superseded', 'Superseded'], ['', 'All']];
    const MEM_STATUS_TEXT = { proposed: 'Proposed', active: 'Active', rejected: 'Rejected', superseded: 'Superseded', expired: 'Expired' };
    const MEM_KINDS = [['fact', 'Fact'], ['decision', 'Decision'], ['gotcha', 'Gotcha'], ['preference', 'Preference'], ['lesson', 'Lesson'], ['who-did-what', 'Who did what']];
    const MEM_NODES = new Set(['memory', 'mem-review', 'mem-digest']);
    function memBlank(status) { return { rows: [], next: null, status, scope: '', q: '', qDraft: '', loaded: false, loading: false, error: '', gone: false, seq: 0 }; }
    const memStatusText = (m) => `${MEM_STATUS_TEXT[m.status] || m.status || ''}${m.flagged ? ' (flagged)' : ''}${m.stale ? ' (stale)' : ''}`;
    const memKindText = (k) => (MEM_KINDS.find((x) => x[0] === k) || [])[1] || k || '';
    const memScopeText = (s) => (s === 'global' ? 'Global' : String(s || '').replace(/^repo:/, '').replace(/^area:/, 'area: '));
    const memIcon = (m) => `${VI}/${m.flagged ? 'warning' : (m.status === 'active' ? 'check' : (m.status === 'rejected' ? 'error' : (m.status === 'proposed' ? 'info' : 'warning')))}-16.png`;
    const memId = (v) => String(v == null ? '' : v);
    const memOf = (id) => S.mem.rows.concat(S.memRv.rows).find((x) => memId(x.id) === memId(id)) || null;
    const memSel = (c, arg) => (arg != null && arg !== '' ? memId(arg) : selId(c, 'me:'));

    function memNote(rows) { (rows || []).forEach((m) => { if (m && /^repo:/.test(m.scope || '')) S.memRepos.add(m.scope); }); }

    /** A page of the list (More: before = the reply's next); Needs Review reads proposed and flagged together. */
    async function loadMem(L, more) {
        if (L.loading) return;
        L.loading = true;
        const seq = ++L.seq;
        try {
            let rows;
            let next = null;
            if (L.status === 'review') {
                const rs = await Promise.all(['proposed', 'flagged'].map((status) => send('claude_fleet_memory', { action: 'list', status, limit: 100 })));
                const seen = new Set();
                rows = [];
                rs.forEach((r) => (unwrap(r, 'rows').rows || []).forEach((m) => { if (!seen.has(memId(m.id))) { seen.add(memId(m.id)); rows.push(m); } }));
            } else {
                const f = { action: 'list', limit: MEM_PAGE };
                if (L.status) f.status = L.status;
                if (L.scope) f.scope = L.scope;
                if (L.q) f.q = L.q;
                if (more && L.next != null) f.before = L.next;
                const r = unwrap(await send('claude_fleet_memory', f), 'rows');
                rows = Array.isArray(r.rows) ? r.rows : [];
                if (L.status === 'flagged') rows = rows.filter((m) => m.flagged);
                else if (L.status === 'stale') rows = rows.filter((m) => m.stale);
                next = r.next == null ? null : r.next;
            }
            if (seq === L.seq) {
                L.rows = more ? L.rows.concat(rows.filter((x) => !L.rows.some((y) => memId(y.id) === memId(x.id)))) : rows;
                L.next = next;
                L.error = '';
                L.gone = false;
                memNote(L.rows);
            }
        } catch (e) { if (seq === L.seq) { if (isGone(e)) L.gone = true; else L.error = errText(e); } }
        L.loading = false;
        L.loaded = true;
        repaint();
    }
    async function loadMemStats() {
        try { const r = unwrap(await send('claude_fleet_memory', { action: 'stats' }), 'stats'); if (r.stats) S.memStats = Object.assign({}, S.memStats, r.stats); } catch (_) { /* the page says so */ }
        repaint();
    }
    /** The push: counts now, and the open list again once when the change marker moved. */
    function memTake(items) {
        const d = items && items.changed && typeof items.changed === 'object' && !('counts' in items) ? items.changed : items || {};
        if (d.counts) S.memStats = Object.assign({}, S.memStats, d.counts);
        if (d.changed != null && d.changed !== S.memVer) {
            const first = S.memVer === undefined;
            S.memVer = d.changed;
            if (!first) memReload();
        }
    }
    function memReload() {
        const node = S.c ? S.c.node : '';
        [[S.mem, 'memory'], [S.memRv, 'mem-review']].forEach(([L, id]) => { if (!L.loaded) return; if (node === id) void loadMem(L, false); else L.loaded = false; });
        if (node === 'mem-digest' && S.dig.loaded) void loadDigest();
        void loadMemStats();
    }
    async function memWatch(on) {
        if (on === S.memOn) return;
        S.memOn = on;
        if (!on) { try { await send('status_unsubscribe', { feed: 'fleet_memory' }); } catch (_) { /* gone */ } return; }
        try { const r = await send('status_subscribe', { feed: 'fleet_memory' }); if (S.memOn) memTake(r.items || r); } catch (_) { /* a server without it: the pages say so */ }
        repaint();
    }
    async function loadDigest() {
        const D = S.dig;
        if (D.loading) return;
        D.loading = true;
        try {
            const r = unwrap(await send('claude_fleet_memory', Object.assign({ action: 'digest' }, D.repo ? { repo: D.repo } : {})), 'digest');
            D.text = typeof r.digest === 'string' ? r.digest : '';
            D.error = '';
            D.gone = false;
        } catch (e) { if (isGone(e)) D.gone = true; else D.error = errText(e); }
        D.loading = false;
        D.loaded = true;
        repaint();
    }

    async function memCall(payload) { return unwrap(await send('claude_fleet_memory', payload), 'memory'); }

    function memProvenance(m) {
        const rows = [['Author', esc(m.author || '')], ['Account', esc(m.account || '')], ['Host', esc(m.host || '')], ['Source', esc(m.source || '')], ['Created', esc(when(m.createdAt))], ['Updated', esc(when(m.updatedAt))], ['Confirmed', esc(when(m.confirmedAt))]];
        return actProps(rows);
    }
    /** One memory in full, in its own window: nothing here is HTML (the body is escaped text). */
    function memoryHtml(m) {
        const tags = Array.isArray(m.tags) && m.tags.length ? m.tags.map((t) => `<span class="cd-mem-tag">${esc(t)}</span>`).join(' ') : '<span class="mmc-hint">none</span>';
        const link = (id, label) => `<span class="mmc-link" data-mem-open="${esc(memId(id))}">${esc(label)}</span>`;
        const flags = [m.pinned ? 'Pinned' : '', m.flagged ? `Flagged: ${m.flagged}` : '', m.stale ? 'Stale: not confirmed for a while' : ''].filter(Boolean);
        const hist = Array.isArray(m.history) && m.history.length ? `<table class="cd-table"><thead><tr><th class="cd-w120">When</th><th class="cd-w80">By</th><th>Change</th></tr></thead><tbody>${m.history.map((h) => `<tr><td>${esc(when(h.at))}</td><td>${esc(h.by || '')}</td><td>${esc(h.change || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="mmc-hint">No history.</p>';
        const btn = (act, text, dis) => `<button type="button" class="btn-standard" data-mem-act="${act}"${dis ? ' disabled' : ''}>${text}</button>`;
        return `<div class="cd-act cd-mem">
            <h4>${esc(m.title || 'Memory')}</h4>
            <p class="cd-mem-actions">${btn('approve', 'Approve', m.status !== 'proposed')}${btn('reject', 'Reject...', m.status !== 'proposed')}${btn('pin', m.pinned ? 'Unpin' : 'Pin')}${btn('unflag', 'Clear Flag', !m.flagged)}${btn('edit', 'Edit...')}${btn('remove', 'Remove...')}</p>
            ${actProps([['Kind', esc(memKindText(m.kind))], ['Scope', esc(memScopeText(m.scope))], ['Tags', tags], ['Status', esc(memStatusText(m))], ['Notes', esc(flags.join('; '))], ['Review note', esc(m.reviewNote || '')], ['Replaced by', m.supersededBy ? link(m.supersededBy, `Memory ${m.supersededBy}`) : ''], ['Replaces', m.supersedes ? link(m.supersedes, `Memory ${m.supersedes}`) : '']])}
            <h4>Body</h4><div class="cd-mem-body">${esc(m.body == null ? (m.snippet || '') : m.body)}</div>
            <h4>Where it came from</h4>${memProvenance(m)}
            <h4>History</h4>${hist}</div>`;
    }

    async function openMemory(id) {
        if (!S.c || id == null || id === '') return;
        const key = `mem:${id}`;
        const have = Array.from(S.wins).find((x) => x.key === key);
        if (have) { call('bringModalToFront', have.modal); return; }
        const row = memOf(id);
        const w = openViewer({ key, title: `Memory: ${String((row && row.title) || id).slice(0, 48)}`, body: '<p class="mmc-hint">Reading...</p>' });
        const st = { m: row };
        const show = async () => {
            try {
                const r = await memCall({ action: 'get', id });
                st.m = r.memory || st.m;
                w.set(st.m ? memoryHtml(st.m) : '<p class="cd-err">This memory is gone.</p>');
            } catch (e) { w.set(`<p class="cd-err">${esc(isGone(e) ? NOT_YET : errText(e))}</p>`); }
        };
        w.modal.addEventListener('click', (ev) => {
            const o = ev.target.closest('[data-mem-open]');
            if (o) { void openMemory(o.dataset.memOpen); return; }
            const b = ev.target.closest('[data-mem-act]');
            if (b && st.m && !b.disabled) void memAct(b.dataset.memAct, st.m, show, w);
        });
        await show();
    }

    /** Approve / Reject / Pin / Clear Flag / Edit / Remove on one memory, then the lists and the window read again. */
    async function memAct(act, m, show, w) {
        const c = S.c;
        if (!c) return;
        try {
            if (act === 'approve') await memCall({ action: 'approve', id: m.id });
            else if (act === 'reject') {
                const { value, fields } = await form(c, `<p>Reject <b>${esc(m.title)}</b>. Agents stop reading it; the note is kept with it.</p><label class="cd-top"><span>Note:</span><textarea data-cd="note" data-cd-focus rows="3" spellcheck="true" placeholder="Why it is rejected (required)"></textarea></label>`,
                    [{ text: 'Reject', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Reject Memory', icon: 'fas fa-circle-info' });
                const note = String(fields.note || '').trim();
                if (value !== true) return;
                if (!note) { await c.box('<p>Say why it is rejected.</p>', null, { icon: 'warning' }); return; }
                await memCall({ action: 'reject', id: m.id, note });
            } else if (act === 'pin') await memCall({ action: 'pin', id: m.id, pinned: !m.pinned });
            else if (act === 'unflag') await memCall({ action: 'unflag', id: m.id });
            else if (act === 'edit') { if (!(await memEditBox(c, m))) return; }
            else if (act === 'remove') {
                const ok = await c.box(`<p>Remove <b>${esc(m.title)}</b>? Its history is removed with it and agents no longer see it.</p>`, [{ text: 'Remove', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning', title: 'Remove Memory' });
                if (ok !== true) return;
                await memCall({ action: 'remove', id: m.id });
                memReload();
                if (w) w.close();
                return;
            }
        } catch (e) { await failBox(c, e); return; }
        memReload();
        if (show) await show();
    }
    /** Title, kind, scope, tags and body in a Vista dialog; saved with update. */
    async function memEditBox(c, m) {
        const kinds = MEM_KINDS.map(([v, t]) => `<option value="${v}"${v === m.kind ? ' selected' : ''}>${esc(t)}</option>`).join('');
        const { value, fields } = await form(c, `
            <label class="cd-top"><span>Title:</span><input type="text" data-cd="title" data-cd-focus value="${esc(m.title)}" spellcheck="true" autocomplete="off"></label>
            <label class="cd-top"><span>Kind:</span><select class="vdt-select" data-cd="kind">${kinds}</select></label>
            <label class="cd-top"><span>Scope:</span><input type="text" data-cd="scope" value="${esc(m.scope)}" spellcheck="false" autocomplete="off" placeholder="global, repo:<name>, area:<tag> or session"></label>
            <label class="cd-top"><span>Tags:</span><input type="text" data-cd="tags" value="${esc((m.tags || []).join(', '))}" spellcheck="false" autocomplete="off" placeholder="Separated by commas"></label>
            <label class="cd-top"><span>Body:</span><textarea data-cd="body" rows="10" spellcheck="true">${esc(m.body || '')}</textarea></label>`,
        [{ text: 'Save', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Edit Memory', width: 560, icon: 'fas fa-circle-info' });
        if (value !== true) return false;
        const title = String(fields.title || '').trim();
        if (!title) { await c.box('<p>A memory needs a title.</p>', null, { icon: 'warning' }); return false; }
        const tags = String(fields.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
        await memCall({ action: 'update', id: m.id, title, kind: fields.kind, scope: String(fields.scope || '').trim() || m.scope, tags, body: String(fields.body || '') });
        return true;
    }

    // ---- Contractors: other machines that run Fleet work on their own projects (claude_fleet_contractors) ------

    /** A list reply (contractors, invites) or a push ({ reason, contractor } merged by id, or { reason: 'invites', invites }). */
    function conTake(r) {
        const d = r && (r.contractors || r.contractor || r.invites || r.reason) ? r : (r && r.data) || {};
        if (Array.isArray(d.contractors)) { S.con.list = d.contractors; S.con.loaded = true; S.con.gone = false; S.con.error = ''; }
        if (Array.isArray(d.invites)) S.con.invites = d.invites;
        const k = d.contractor;
        if (k && k.id) {
            const i = S.con.list.findIndex((x) => x.id === k.id);
            if (d.reason === 'removed') { if (i >= 0) S.con.list.splice(i, 1); } else if (i >= 0) S.con.list[i] = k; else S.con.list.push(k);
        }
    }
    async function loadContractors() {
        if (S.con.loading) return;
        S.con.loading = true;
        try { conTake(await send('claude_fleet_contractors', { action: 'list' })); S.con.loaded = true; } catch (e) { S.con.loaded = true; if (isGone(e)) S.con.gone = true; else S.con.error = errText(e); }
        S.con.loading = false;
        repaint();
    }
    const conOf = (id) => S.con.list.find((x) => String(x.id) === String(id)) || null;
    const conSessions = (k) => (Array.isArray(k && k.sessions) ? k.sessions : []);
    const conHello = (k) => (k && k.hello) || {};
    const conName = (k) => k.name || conHello(k).hostname || String(k.id);
    const conState = (k) => (k.revoked ? 'Revoked' : (k.online ? 'Online' : 'Offline'));
    /** One contractor session's transcript page (the same shape claude_desk_transcript answers). */
    async function loadConChat(cid, sid) {
        const key = `${cid}|${sid}`;
        let e = S.conChats.get(key);
        if (!e) { e = { messages: [], loading: false, error: '' }; S.conChats.set(key, e); }
        if (e.loading) return;
        e.loading = true;
        try {
            const r = await send('claude_fleet_contractors', { action: 'transcript', id: cid, sessionId: sid, limit: MSG_PAGE, show: showNow() });
            e.messages = shownOnly(unwrap(r, 'messages').messages);
            e.error = '';
        } catch (err) { e.error = isGone(err) ? NOT_YET : errText(err); }
        e.loading = false;
        repaint();
    }

    /** The background agents of an Active Work session, read when its node opens. */
    async function loadAwAgents(sid) {
        let e = S.awAgents.get(sid);
        if (e && e.loading) return;
        if (!e) { e = { agents: null, loading: false, gone: false, error: '' }; S.awAgents.set(sid, e); }
        e.loading = true;
        try {
            const r = await send('claude_desk_session', { action: 'detail', id: sid });
            const d = unwrap(r, 'detail').detail || null;
            e.agents = d && Array.isArray(d.agents) ? d.agents : [];
            e.error = '';
        } catch (err) { e.agents = e.agents || []; if (isGone(err)) e.gone = true; else e.error = errText(err); }
        e.loading = false;
        repaint();
    }

    // ---- the insight strip (claudeInsight.js: model, effort, context, turn ...), read with detail and pushed with each append ----

    const fmtN = (n) => { n = Number(n) || 0; return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : (n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n)); };
    const fmtDur = (ms) => { const t = Math.max(0, Math.round((Number(ms) || 0) / 1000)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); return h ? `${h}h ${m}m` : (m ? `${m}m ${t % 60}s` : `${t}s`); };
    /** claude-opus-5-5 -> Opus 5.5 (any other id as it is). */
    const modelName = (id) => { const m = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/i.exec(String(id || '')); return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : String(id || ''); };
    /** The turn's running time counts on while the session works (the server sent the start). */
    const insTurnMs = (ins, busy) => (busy && ins.turnStartedAt ? Date.now() - Date.parse(ins.turnStartedAt) : ins.turnMs);
    /** "Opus 5.5 · effort high · 63% context · turn 12 · 4m 10s · 38 tool calls · 2 agents" */
    function insLine(ins, busy, short) {
        if (!ins) return '';
        const ms = insTurnMs(ins, busy);
        const parts = [ins.model ? modelName(ins.model) : '', ins.effort ? `effort ${ins.effort}` : '', ins.context && ins.context.used ? `${ins.context.percent}% context` : ''];
        if (!short) {
            parts.push(ins.turns ? `turn ${ins.turns}` : '', ms != null && ins.turns ? fmtDur(ms) : '', ins.turnTools ? plural(ins.turnTools, 'tool call') : '', ins.bgAgents ? plural(ins.bgAgents, 'agent') : '');
        }
        return parts.filter(Boolean).join(' \u00b7 ');
    }
    function insHtml(id) {
        const chat = S.chats.get(id);
        const l = liveOf(id);
        const line = chat && chat.ins ? insLine(chat.ins, !!(l && l.status === 'busy')) : '';
        return `${line ? esc(line) : '<span class="mmc-hint">Reading what the session is doing...</span>'} <span class="mmc-link" data-act="detail-toggle">More...</span>`;
    }
    function insUpdate(id) {
        // the line lives in the window's status bar (Yukimi, Nov 24 2026), not in a strip over the chat
        if (S.c && nodeSid(S.c.node) === id) S.c.renderStatus();
        pendingDraw(id);
        insTick(id);
        wmPoke();
    }
    /** While the session works, the strip's turn time moves on every 10 s (one timer, only while the chat is open and busy). */
    function insTick(id) {
        const l = liveOf(id);
        const chat = S.chats.get(id);
        if (S.insTimer || !chat || !chat.ins || !(l && l.status === 'busy') || !S.c || nodeSid(S.c.node) !== id) return;
        S.insTimer = setTimeout(() => { S.insTimer = 0; if (S.c && nodeSid(S.c.node) === id) insUpdate(id); }, 10000);
    }
    async function insLoad(id) {
        const chat = S.chats.get(id);
        if (!chat) return;
        try {
            const r = await send('claude_desk_session', { action: 'detail', id });
            const d = unwrap(r, 'detail').detail || null;
            if (d && d.insight) { chat.ins = d.insight; insUpdate(id); }
        } catch (_) { /* the strip stays on its hint */ }
    }

    // ---- the workflow map (claude_desk_supervisor work_map): Supervisor -> sessions -> background agents -> their tasks ----
    // Drawn at the top of a work item's page and of a supervised session's chat. Nothing polls: the map is asked for again
    // (debounced) when a push the window already gets changes something (the work list, the agents feed, a transcript
    // append). One shared 1 s timer moves the elapsed times, only while a working node is on screen and the window shows.

    const WM = { maps: new Map(), loading: new Set(), again: new Set(), debounce: 0, tick: 0, collapsed: false };
    try { WM.collapsed = localStorage.getItem('cd-wm-collapsed') === '1'; } catch (_) { WM.collapsed = false; }
    const WM_W = 176;
    const WM_H = 58;
    const WM_GAP_X = 34;
    const WM_GAP_Y = 8;
    const WM_STATE = { working: 'Working', idle: 'Idle', done: 'Done', failed: 'Failed' };
    const WM_KIND = { supervisor: 'Supervisor', session: 'Session', item: 'Queued', agent: 'Agent', task: 'Task' };

    /** Left-to-right tree layout: a leaf takes the next row, a parent sits at the middle of its children. */
    function wmLayout(nodes) {
        const kids = new Map();
        nodes.forEach((n) => { const p = n.parent || ''; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n); });
        let row = 0;
        const pos = new Map();
        const walk = (n) => {
            const ks = kids.get(n.key) || [];
            let y;
            if (!ks.length) { y = row; row += 1; } else { const ys = ks.map(walk); y = (ys[0] + ys[ys.length - 1]) / 2; }
            pos.set(n.key, { col: n.col, y });
            return y;
        };
        (kids.get('') || []).forEach(walk);
        const cols = Math.max(0, ...nodes.map((n) => n.col)) + 1;
        const at = (k) => { const p = pos.get(k); return { x: p.col * (WM_W + WM_GAP_X), y: p.y * (WM_H + WM_GAP_Y) }; };
        return { at, pos, cols, rows: Math.max(1, row), width: cols * WM_W + (cols - 1) * WM_GAP_X, height: Math.max(1, row) * WM_H + (Math.max(1, row) - 1) * WM_GAP_Y };
    }

    function wmNodeHtml(n, lay, now) {
        const p = lay.at(n.key);
        const end = n.endedAt || now;
        const live = n.state === 'working' && n.startedAt;
        const ms = n.startedAt ? Math.max(0, end - n.startedAt) : null;
        const model = [n.model ? modelName(n.model) : '', n.effort || ''].filter(Boolean).join(' / ');
        const bits = [ms != null ? `<span class="cd-wm-t"${live ? ` data-since="${n.startedAt}"` : ''}>${esc(fmtDur(ms))}</span>` : '', n.messages ? `<span>${esc(plural(n.messages, 'msg'))}</span>` : '', n.tokens ? `<span>${esc(fmtN(n.tokens))} tok</span>` : ''].filter(Boolean).join('');
        const arg = [n.kind, n.sessionId || '', n.agentId || '', n.workId != null ? n.workId : ''].join('|');
        const clickable = n.kind === 'session' || n.kind === 'agent' || (n.kind === 'item' && n.workId != null);
        const note = n.note ? `<span class="cd-wm-note">${esc(n.note)}</span>` : '';
        return `<${clickable ? 'button type="button"' : 'div'} class="cd-wm-node is-${esc(n.state)} k-${esc(n.kind)}" data-x="${p.x}" data-y="${p.y}" ${clickable ? `data-act="wm-open" data-arg="${esc(arg)}"` : ''} title="${esc(`${WM_KIND[n.kind] || ''}: ${n.label} - ${WM_STATE[n.state] || n.state}${model ? ` - ${model}` : ''}`)}">`
            + `<b>${esc(n.label)}</b><i>${esc([model, n.kind === 'supervisor' ? '' : (n.note ? '' : (WM_STATE[n.state] || ''))].filter(Boolean).join(' - ') || (WM_STATE[n.state] || ''))}${note ? ` ${note}` : ''}</i><em>${bits || '&nbsp;'}</em></${clickable ? 'button' : 'div'}>`;
    }

    function wmBodyHtml(map) {
        if (!map) return '<p class="mmc-hint">Reading the workflow...</p>';
        if (!map.nodes || !map.nodes.length) return '<p class="mmc-hint">Nothing has started yet.</p>';
        const lay = wmLayout(map.nodes);
        const now = Date.now();
        const lines = map.nodes.filter((n) => n.parent && lay.pos.has(n.parent)).map((n) => {
            const a = lay.at(n.parent);
            const b = lay.at(n.key);
            const x1 = a.x + WM_W;
            const y1 = a.y + WM_H / 2;
            const x2 = b.x;
            const y2 = b.y + WM_H / 2;
            const xm = x1 + WM_GAP_X / 2;
            return `<path d="M${x1} ${y1}H${xm}V${y2}H${x2}"/>`;
        }).join('');
        return `<div class="cd-wm-scroll"><div class="cd-wm-canvas" data-w="${lay.width}" data-h="${lay.height}"><svg class="cd-wm-lines" width="${lay.width}" height="${lay.height}" aria-hidden="true">${lines}</svg>${map.nodes.map((n) => wmNodeHtml(n, lay, now)).join('')}</div></div>`;
    }

    /** The panel for a work item (its id): the head (collapse) and the body from the last map; asks for a fresh one when it has none. */
    function wmHtml(workId) {
        const key = String(workId);
        const e = WM.maps.get(key);
        if (!e && !WM.loading.has(key)) void wmLoad(key);
        else if (e && Date.now() - e.at > 30000) void wmLoad(key);
        setTimeout(wmSync, 0);
        const working = e && e.map && e.map.nodes ? e.map.nodes.filter((n) => n.state === 'working' && n.kind !== 'supervisor').length : 0;
        return `<div class="cd-wm${WM.collapsed ? ' is-collapsed' : ''}" data-wm="${esc(key)}"><div class="cd-wm-head"><span class="mmc-link" data-act="wm-toggle">${WM.collapsed ? 'Show workflow' : 'Hide workflow'}</span><span class="mmc-hint cd-wm-sum">${esc(working ? `${working} working` : '')}</span></div><div class="cd-wm-body"${WM.collapsed ? ' hidden' : ''}>${WM.collapsed ? '' : wmBodyHtml(e && e.map)}</div></div>`;
    }

    /** Puts the nodes and the canvas at their computed places (done by property, not by style attributes in the markup). */
    function wmPlace() {
        document.querySelectorAll('.cd-wf-canvas[data-w]').forEach((cv) => {
            cv.style.width = `${cv.dataset.w}px`;
            cv.style.height = `${cv.dataset.h}px`;
            cv.querySelectorAll('[data-x]').forEach((n) => { n.style.left = `${n.dataset.x}px`; n.style.top = `${n.dataset.y}px`; });
        });
        document.querySelectorAll('.cd-wm-canvas[data-w]').forEach((cv) => {
            cv.style.width = `${cv.dataset.w}px`;
            cv.style.height = `${cv.dataset.h}px`;
            // idempotent; the data attributes stay (the in-place update compares markup with them; boxes went off their lines)
            cv.querySelectorAll('.cd-wm-node[data-x]').forEach((n) => { n.style.left = `${n.dataset.x}px`; n.style.top = `${n.dataset.y}px`; });
        });
    }

    async function wmLoad(key) {
        if (WM.loading.has(key)) { WM.again.add(key); return; }
        WM.loading.add(key);
        try {
            const r = await send('claude_desk_supervisor', { action: 'work_map', id: Number(key) });
            WM.maps.set(key, { map: unwrap(r, 'map').map || null, at: Date.now() });
        } catch (_) { if (!WM.maps.has(key)) WM.maps.set(key, { map: { nodes: [] }, at: Date.now() }); }
        WM.loading.delete(key);
        wmPaint(key);
        if (WM.again.delete(key)) wmPoke();
    }

    /** Draws the body of every panel on screen for this map (in place: the page's scroll stays). */
    function wmPaint(key) {
        const e = WM.maps.get(key);
        document.querySelectorAll('.cd-wm').forEach((p) => {
            if (p.dataset.wm !== key) return;
            const body = p.querySelector('.cd-wm-body');
            if (body && !WM.collapsed) { const sc = body.querySelector('.cd-wm-scroll'); const left = sc ? sc.scrollLeft : 0; body.innerHTML = wmBodyHtml(e && e.map); const s2 = body.querySelector('.cd-wm-scroll'); if (s2) s2.scrollLeft = left; }
            const sum = p.querySelector('.cd-wm-sum');
            const working = e && e.map && e.map.nodes ? e.map.nodes.filter((n) => n.state === 'working' && n.kind !== 'supervisor').length : 0;
            if (sum) sum.textContent = working ? `${working} working` : '';
        });
        wmSync();
    }

    /** A push changed something: ask again (debounced) when a panel is on screen and open. */
    function wmPoke() {
        if (!WM.maps.size || WM.debounce) return;
        WM.debounce = setTimeout(() => {
            WM.debounce = 0;
            if (document.hidden) return;
            const keys = new Set(Array.from(document.querySelectorAll('.cd-wm')).filter((p) => !WM.collapsed && p.isConnected).map((p) => p.dataset.wm));
            keys.forEach((k) => void wmLoad(k));
        }, 1000);
    }

    /** The shared 1 s timer: runs only while a working node is on screen and the window shows; stops otherwise. */
    function wmSync() {
        wmPlace();
        const live = !document.hidden && document.querySelector('.cd-wm:not(.is-collapsed) .cd-wm-t[data-since]');
        if (!live) { if (WM.tick) { clearInterval(WM.tick); WM.tick = 0; } return; }
        if (WM.tick) return;
        WM.tick = setInterval(() => {
            const els = document.querySelectorAll('.cd-wm:not(.is-collapsed) .cd-wm-t[data-since]');
            if (!els.length || document.hidden) { clearInterval(WM.tick); WM.tick = 0; return; }
            const now = Date.now();
            els.forEach((el) => { el.textContent = fmtDur(now - Number(el.dataset.since)); });
        }, 1000);
    }

    function wmToggle() {
        WM.collapsed = !WM.collapsed;
        try { localStorage.setItem('cd-wm-collapsed', WM.collapsed ? '1' : '0'); } catch (_) { /* per-viewer only */ }
        document.querySelectorAll('.cd-wm').forEach((p) => {
            const key = p.dataset.wm;
            p.outerHTML = wmHtml(key);
        });
        if (!WM.collapsed) wmPoke();
    }

    // ---- the Workflow page (claude_desk_supervisor work_graph, modules/fleetDeps.js): every open job, what runs in parallel, in series and on what ----
    // Columns are lanes (dependency depth); a job in lane 0 can run now, jobs in one column run side by side, a line
    // runs from a prerequisite to the job that waits on it. Nothing polls: the graph is asked for again (debounced)
    // when the supervisor status the window already gets changes, only while the page is open and the window shows.

    const WF = { graph: null, at: 0, loading: false, again: false, debounce: 0, sel: '', view: 'flow', error: '' };
    const WF_W = 200;
    const WF_H = 76;
    const WF_GAP_X = 44;
    const WF_GAP_Y = 10;
    const WF_HEAD = 30;
    const WF_PRIO = ['Lowest', 'Low', 'Normal', 'High', 'Highest'];
    const WF_KIND = { explicit: 'Set by hand', issue: 'Yozora issue order', files: 'Same files', model: 'Same model slot' };
    const wfPrio = (n) => WF_PRIO[Math.max(0, Math.min(4, (Number(n) || 0) + 2))];

    async function wfLoad() {
        if (WF.loading) { WF.again = true; return; }
        WF.loading = true;
        try { const r = await send('claude_desk_supervisor', { action: 'work_graph' }); WF.graph = unwrap(r, 'graph').graph || { nodes: [], edges: [] }; WF.error = ''; } catch (e) { WF.error = errText(e); if (!WF.graph) WF.graph = { nodes: [], edges: [] }; }
        WF.loading = false;
        WF.at = Date.now();
        repaint();
        if (WF.again) { WF.again = false; wfPoke(); }
    }
    /** The supervisor status changed: ask again (debounced) when the Workflow page is open and the window shows. */
    function wfPoke() {
        if (WF.debounce || !S.c || S.c.node !== 'co-flow') return;
        WF.debounce = setTimeout(() => { WF.debounce = 0; if (!document.hidden && S.c && S.c.node === 'co-flow') void wfLoad(); }, 800);
    }
    async function wfAct(c, payload, busy) {
        c.note(busy);
        try { const r = await send('claude_desk_supervisor', payload); WF.graph = unwrap(r, 'graph').graph || WF.graph; WF.at = Date.now(); WF.error = ''; } catch (e) { await failBox(c, e); }
        c.note('');
        repaint();
    }

    /** The open jobs of the graph (done ones leave it), each with its lane, and the edges between them. */
    function wfModel() {
        const g = WF.graph || { nodes: [], edges: [] };
        const done = new Set((g.done || []).map(String));
        const nodes = (g.nodes || []).filter((n) => !done.has(String(n.id)) && !WORK_DONE.has(n.state));
        const ids = new Set(nodes.map((n) => String(n.id)));
        const edges = (g.edges || []).filter((e) => ids.has(String(e.from)) && ids.has(String(e.to)));
        const running = new Set((g.running || []).map(String));
        const isRun = (n) => running.has(String(n.id)) || WORK_RUN.has(n.state);
        const rank = (n) => (isRun(n) ? 0 : (n.order != null ? 1 : 2));
        const byStart = (a, b) => rank(a) - rank(b) || (a.order == null ? 1e9 : a.order) - (b.order == null ? 1e9 : b.order) || (b.priority || 0) - (a.priority || 0) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
        return { nodes, edges, isRun, byStart, ids };
    }
    const wfWaitsFor = (m, id) => m.edges.filter((e) => String(e.to) === String(id)).map((e) => ({ e, n: m.nodes.find((x) => String(x.id) === String(e.from)) })).filter((x) => x.n);
    const wfAcct = (n) => (n.account && n.account.name ? n.account.name : (n.account == null ? '' : String(n.account)));

    function wfCardHtml(n, m, pos) {
        const p = pos.get(String(n.id));
        const run = m.isRun(n);
        const st = workState(workOf(n.id) || n);
        const waits = wfWaitsFor(m, n.id);
        const q = n.order != null && !run ? `#${n.order} in queue` : '';
        const second = [st, wfAcct(n)].filter(Boolean).join(' - ');
        const third = [`Priority ${wfPrio(n.priority)}`, q, waits.length ? `waits for ${waits.map((x) => `#${x.n.id}`).join(', ')}` : ''].filter(Boolean).join(' - ');
        const tip = `${n.title || n.id} - ${second}${n.model ? ` - ${modelName(n.model)}` : ''} - ${third}`;
        return `<button type="button" class="cd-wf-card is-${esc(run ? 'running' : n.state)}${String(n.id) === WF.sel ? ' is-selected' : ''}" data-x="${p.x}" data-y="${p.y}" data-act="wf-pick" data-arg="${esc(n.id)}" title="${esc(tip)}">`
            + `<b title="${esc(n.title || String(n.id))}">${esc(n.title || String(n.id))}</b>`
            + `<i><img class="mmc-row-icon" src="${esc(workIcon(n.state))}" alt="">${esc(second)}</i>`
            + `<em>${esc(third)}</em>${run ? '<span class="cd-working" aria-hidden="true"></span>' : ''}</button>`;
    }

    function wfFlowHtml(m) {
        const lanes = new Map();
        m.nodes.forEach((n) => { const l = Math.max(0, Number(n.lane) || 0); if (!lanes.has(l)) lanes.set(l, []); lanes.get(l).push(n); });
        const keys = Array.from(lanes.keys()).sort((a, b) => a - b);
        const pos = new Map();
        let rows = 1;
        keys.forEach((l, ci) => {
            const list = lanes.get(l).sort(m.byStart);
            rows = Math.max(rows, list.length);
            list.forEach((n, ri) => pos.set(String(n.id), { x: ci * (WF_W + WF_GAP_X), y: WF_HEAD + ri * (WF_H + WF_GAP_Y) }));
        });
        const width = keys.length * WF_W + (keys.length - 1) * WF_GAP_X;
        const height = WF_HEAD + rows * WF_H + (rows - 1) * WF_GAP_Y;
        const heads = keys.map((l, ci) => {
            const list = lanes.get(l);
            const run = list.filter((n) => m.isRun(n)).length;
            const name = l === 0 ? 'Can run now' : (l === 1 ? 'After those' : `Later (step ${l + 1})`);
            return `<div class="cd-wf-head" data-x="${ci * (WF_W + WF_GAP_X)}" data-y="0" title="${esc(`Lane ${l}: ${name}. ${plural(list.length, 'job')}${run ? `, ${run} running` : ''}`)}"><b>${esc(name)}</b><span>${esc(plural(list.length, 'job'))}${run ? `, ${run} running` : ''}</span></div>`;
        }).join('');
        const sel = WF.sel;
        const lines = m.edges.map((e) => {
            const a = pos.get(String(e.from));
            const b = pos.get(String(e.to));
            if (!a || !b) return '';
            const x1 = a.x + WF_W;
            const y1 = a.y + WF_H / 2;
            const x2 = b.x;
            const y2 = b.y + WF_H / 2;
            const dx = Math.max(WF_GAP_X, Math.abs(x2 - x1)) / 2;
            const on = sel && (String(e.from) === sel || String(e.to) === sel);
            const tip = `#${e.from} before #${e.to}: ${WF_KIND[e.kind] || e.kind || ''}${e.reason ? ` - ${e.reason}` : ''}`;
            return `<g class="k-${esc(e.kind || 'explicit')}${on ? ' is-on' : ''}"><title>${esc(tip)}</title><path class="cd-wf-hit" d="M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}"/><path d="M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}"/><path class="cd-wf-tip" d="M${x2} ${y2}l-7 -4v8z"/></g>`;
        }).join('');
        return `<div class="cd-wf-scroll"><div class="cd-wm-canvas cd-wf-canvas" data-w="${width}" data-h="${height}"><svg class="cd-wf-lines" width="${width}" height="${height}" aria-hidden="true">${lines}</svg>${heads}${m.nodes.map((n) => wfCardHtml(n, m, pos)).join('')}</div></div>`;
    }

    function wfListHtml(m) {
        const list = m.nodes.slice().sort(m.byStart);
        const row = (n) => {
            const waits = wfWaitsFor(m, n.id).map((x) => `#${x.n.id} ${x.n.title || ''}`.trim());
            const st = workState(workOf(n.id) || n);
            const t = n.startedAt ? when(n.startedAt) : '';
            return `<tr class="cd-dash-row${String(n.id) === WF.sel ? ' is-selected' : ''}" data-act="wf-pick" data-arg="${esc(n.id)}"><td class="cd-w80">${m.isRun(n) ? 'running' : (n.order != null ? `#${esc(n.order)}` : '-')}</td><td class="cd-cut" title="${esc(n.title || String(n.id))}"><img class="mmc-row-icon" src="${esc(workIcon(n.state))}" alt="">${esc(n.title || String(n.id))}</td><td class="cd-cut" title="${esc(st)}">${esc(st)}</td><td class="cd-cut">${esc(wfPrio(n.priority))}</td><td class="cd-cut" title="${esc(waits.join(', '))}">${esc(waits.join(', '))}</td><td class="cd-cut" title="${esc(wfAcct(n))}">${esc(wfAcct(n))}</td><td class="cd-cut" title="${esc(t)}">${esc(t)}</td></tr>`;
        };
        return `<table class="cd-table cd-dash"><thead><tr><th class="cd-w80">#</th><th>Request</th><th class="cd-w80">State</th><th class="cd-w80">Priority</th><th>Waits for</th><th class="cd-w80">Account</th><th>Started</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>`;
    }

    /** The picked job: its priority (five buttons), what it waits for (with Remove), and its own actions. */
    function wfDetailHtml(m) {
        const n = m.nodes.find((x) => String(x.id) === WF.sel);
        if (!n) return '<p class="mmc-hint">Pick a job to set its priority or make it wait for another job.</p>';
        const busy = !!S.sup.busy;
        const waits = wfWaitsFor(m, n.id);
        const w = workOf(n.id);
        const prio = [-2, -1, 0, 1, 2].map((p) => `<button type="button" class="btn-standard${(Number(n.priority) || 0) === p ? ' primary' : ''}" data-act="wf-prio" data-arg="${esc(n.id)}|${p}">${esc(wfPrio(p))}</button>`).join(' ');
        const waitRows = waits.length
            ? `<ul class="cd-wf-waits">${waits.map((x) => `<li><span class="mmc-link" data-act="wf-pick" data-arg="${esc(x.n.id)}">${esc(x.n.title || String(x.n.id))}</span> <span class="mmc-hint">${esc(`${WF_KIND[x.e.kind] || x.e.kind || ''}${x.e.reason ? ` - ${x.e.reason}` : ''}`)}</span> <span class="mmc-link" data-act="wf-dep-remove" data-arg="${esc(n.id)}|${esc(x.n.id)}">Remove</span></li>`).join('')}</ul>`
            : '<p class="mmc-hint">It waits for no other job.</p>';
        const links = [`<button type="button" class="btn-standard" data-act="wf-dep-add" data-arg="${esc(n.id)}"${busy ? ' disabled' : ''}>Make it wait for...</button>`,
            w && WORK_STARTABLE.has(w.state) ? `<button type="button" class="btn-standard" data-act="work-start" data-arg="${esc(n.id)}"${busy ? ' disabled' : ''}>Start Now</button>` : '',
            w && w.sessionId ? `<span class="mmc-link" data-act="work-open" data-arg="${esc(n.id)}">Open Session</span>` : '',
            w && w.issue && w.issue.url ? `<span class="mmc-link" data-act="work-issue" data-arg="${esc(n.id)}">Open Issue</span>` : '',
            w ? `<span class="mmc-link" data-act="work-goto" data-arg="${esc(n.id)}">Open Request</span>` : ''].filter(Boolean).join(' &nbsp; ');
        return `<div class="cd-wd"><h3 class="cd-cut" title="${esc(n.title || String(n.id))}">${esc(n.title || String(n.id))}</h3>`
            + `<p class="mmc-hint">${esc([workState(w || n), wfAcct(n), n.order != null ? `#${n.order} in queue` : ''].filter(Boolean).join(' - '))}</p>`
            + `<h4>Priority</h4><p>${prio}</p><h4>Waits for</h4>${waitRows}<p>${links}</p></div>`;
    }

    function workflowPage(c) {
        const T = 'Workflow';
        if (!S.sup.loaded) { void loadSupervisor(); return c.page(T, '', [{ id: 'cd-wf-wait', title: T, body: '<p class="mmc-hint">Reading the work queue...</p>' }]); }
        if (S.sup.unavailable) return c.page(T, '', [{ id: 'cd-wf-gone', title: T, body: `<p>${NOT_YET}</p>` }]);
        if (!WF.graph || (!WF.loading && Date.now() - WF.at > 60000)) void wfLoad();
        setTimeout(wmPlace, 0);
        if (!WF.graph) return c.page(T, '', [{ id: 'cd-wf-wait', title: T, body: '<p class="mmc-hint">Reading the workflow...</p>' }]);
        const m = wfModel();
        const run = m.nodes.filter((n) => m.isRun(n)).length;
        const head = `<p class="cd-wf-bar"><span class="mmc-link" data-act="wf-view" data-arg="flow">${WF.view === 'flow' ? '<b>Flow</b>' : 'Flow'}</span> | <span class="mmc-link" data-act="wf-view" data-arg="list">${WF.view === 'list' ? '<b>List</b>' : 'List'}</span> <span class="mmc-hint">${esc(`${plural(m.nodes.length, 'open job')}, ${run} running. A column runs side by side; a line goes from a job to the one that waits for it.`)}</span>${WF.error ? ` <span class="mmc-hint">${esc(WF.error)}</span>` : ''}</p>`;
        const body = m.nodes.length ? head + (WF.view === 'list' ? wfListHtml(m) : wfFlowHtml(m)) : '<p class="mmc-hint">No open work.</p>';
        return c.page(T, '', [{ id: 'cd-wf', title: `Open Work (${m.nodes.length})`, body }, { id: 'cd-wf-sel', title: 'Selected Job', body: wfDetailHtml(m) }]);
    }

    /** "Make it wait for...": the open jobs it may wait for (not itself, not a job already waiting on it, not one it already waits for). */
    async function wfAddDep(c, id) {
        const m = wfModel();
        const after = new Set([String(id)]);
        for (let grew = true; grew;) { grew = false; m.edges.forEach((e) => { if (after.has(String(e.from)) && !after.has(String(e.to))) { after.add(String(e.to)); grew = true; } }); }
        const have = new Set(wfWaitsFor(m, id).map((x) => String(x.n.id)));
        const cands = m.nodes.filter((n) => !after.has(String(n.id)) && !have.has(String(n.id))).sort(m.byStart);
        if (!cands.length) { c.note('There is no other open job it could wait for.'); return; }
        const me = m.nodes.find((x) => String(x.id) === String(id));
        const { value, fields } = await form(c, `<p>Make <b>${esc((me && me.title) || id)}</b> wait until this job is done:</p><label class="cd-top"><span>Job:</span><select class="vdt-select" data-cd="on" data-cd-focus>${cands.map((n) => `<option value="${esc(n.id)}">${esc(`${n.title || n.id} (${workState(workOf(n.id) || n)})`)}</option>`).join('')}</select></label>`,
            [{ text: 'Make It Wait', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }]);
        if (value !== true || !fields.on) return;
        await wfAct(c, { action: 'work_dep_add', id, on: fields.on }, 'Adding the dependency...');
    }

    // ---- a steering message sent from the composer shows at once as a pending row, replaced by the real one ----

    /**
     * A sent message's "sending" row goes once its real row is in the transcript. The session may wrap it (Claude
     * Code puts pasted text in <pasted_content> tags) or trim it, so the comparison ignores those tags, spacing and
     * case, and a prefix of 160 characters is enough. A row still unmatched after 3 minutes goes as well.
     */
    const pendNorm = (t) => String(t || '').replace(/<\/?pasted_content[^>]*>/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
    function pendingReconcile(chat, msgsIn) {
        if (!chat.pending || !chat.pending.length) return;
        const msgs = (msgsIn && msgsIn.length ? msgsIn : []).concat(chat.messages || []);
        const texts = msgs.filter((m) => m.role === 'user' && m.kind === 'text').map((m) => pendNorm(m.text));
        const seen = (p) => { const n = pendNorm(p.text); const head = n.slice(0, 160); return texts.some((t) => t && (t === n || (head && (t.includes(head) || (t.length >= 40 && n.includes(t.slice(0, 160))))))); };
        chat.pending = chat.pending.filter((p) => !seen(p) && Date.now() - p.at < 180000);
    }
    function pendingHtml(chat) {
        if (chat.pending && chat.pending.length) chat.pending = chat.pending.filter((p) => Date.now() - p.at < 180000);
        return (chat.pending || []).map((p) => `<div class="cd-msg cd-user is-pending" data-pend="${p.at}"><div class="cd-msg-head"><b>${p.steer ? 'You (steering)' : 'You'}</b><span>sending</span></div><div class="cd-msg-text">${esc(p.text)}</div></div>`).join('');
    }
    /** The live activity row at the end of a working session's log: what it does now, the turn's time, its background agents. */
    function askHtml(id) {
        const a = Array.from(S.asks.values()).find((x) => x.claude.sessionId === id);
        return a ? `<div class="cd-activity" role="status"><div><b>Asks: ${esc(a.claude.question)}</b> <button type="button" class="btn-secondary" data-cd-ask="${esc(a.id)}">Answer...</button></div></div>` : '';
    }
    /** The ask row is drawn again when a question opens or closes. */
    function askDraw(id) { if (logOf(id)) pendingDraw(id); }
    function activityHtml(id) {
        const chat = S.chats.get(id);
        const ask = askHtml(id);
        if (ask) return ask + activityHtml1(id);
        return activityHtml1(id);
    }
    function activityHtml1(id) {
        const chat = S.chats.get(id);
        const l = liveOf(id);
        const ins = chat && chat.ins;
        if (!ins || !ins.now || !(l && l.status === 'busy') || chat.tailCut) return '';
        const ms = insTurnMs(ins, true);
        const subs = (ins.agentsNow || []).map((a) => `<div class="cd-act-sub">${esc(a.description)}: ${esc(a.doing)}</div>`).join('');
        return `<div class="cd-activity" role="status"><span class="cd-working" aria-hidden="true"></span><div><b>${esc(ins.now)}</b>${ms != null && ins.turns ? ` <span class="mmc-hint">${esc(fmtDur(ms))}</span>` : ''}${subs}</div></div>`;
    }
    /** The rows after the messages (pending steering, the activity row) drawn again; the list follows only when it was at the end. */
    function pendingDraw(id) {
        const pane = logOf(id);
        const chat = S.chats.get(id);
        if (!pane || !chat) return;
        const atEnd = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
        pane.querySelectorAll('.is-pending, .cd-activity').forEach((n) => n.remove());
        const hint = pane.querySelector(':scope > .mmc-hint');
        if (hint) hint.remove();
        const html = (chat.tailCut ? '' : pendingHtml(chat)) + activityHtml(id);
        if (html) pane.insertAdjacentHTML('beforeend', html);
        if (atEnd) pane.scrollTop = pane.scrollHeight;
    }

    /** What the view shows, as sent with every transcript request and watch. */
    const showNow = () => ({ thinking: !!S.show.thinking, edits: !!S.show.edits, tools: !!S.show.tools, results: !!S.show.results });
    /** A message's identity (a line's byte offset and its part), the same on a page, a push and in the DOM. */
    const msgKey = (m) => `${m.at}:${m.part == null ? '' : m.part}:${m.kind}:${m.toolUseId || ''}`;
    /** A server that does not know `show` yet answers in full: the tool rows the view hides are left out here. */
    const shownOnly = (list) => (list || []).filter((m) => !((m.kind === 'tool_use' && !S.show.tools) || (m.kind === 'tool_result' && !S.show.results)));
    const logOf = (id) => (S.c && nodeSid(S.c.node) === id ? S.c.modal.querySelector('.cd-chat-log:not(.cd-agent-log)') : null);

    /**
     * One summary row per run of hidden items: two summary rows with nothing shown between them (a run that spans two
     * pushes or pages) become one, its label counted again (Yukimi, Nov 24 2026: "a single summary item that's updated
     * instead of constantly adding them"). Returns true when a row changed (the log is drawn again).
     */
    function sumLabel(items, more) {
        const think = items.filter((i) => i.of === 'thinking');
        const edits = items.filter((i) => i.of === 'edit');
        const tools = items.filter((i) => i.of === 'tool');
        const parts = [];
        if (think.length) parts.push(`Thinking (${fmtN(think.reduce((n, i) => n + (Number(i.size) || 0), 0))} chars)`);
        if (edits.length) {
            const files = Array.from(new Set(edits.map((i) => i.file).filter(Boolean)));
            const names = files.slice(0, 2).map(baseName);
            parts.push(`Edited ${plural(files.length || edits.length, 'file')}${names.length ? `: ${names.join(', ')}${files.length > 2 ? `, +${files.length - 2}` : ''}` : ''}`);
        }
        const agents = tools.filter((i) => /^Agent: /.test(i.title || ''));
        const plain = tools.filter((i) => !/^Agent: /.test(i.title || ''));
        const extra = Number(more) || 0;
        if (plain.length) {
            const by = new Map();
            plain.forEach((i) => by.set(i.tool || i.title, (by.get(i.tool || i.title) || 0) + 1));
            const top = Array.from(by.entries()).sort((a, b) => b[1] - a[1]);
            parts.push(`${plural(plain.length + extra, 'tool call')}: ${top.slice(0, 4).map(([n, k]) => (k > 1 ? `${n} \u00d7${k}` : n)).join(', ')}${top.length > 4 ? `, +${top.length - 4}` : ''}`);
        }
        if (agents.length) parts.push(`Background agent${agents.length === 1 ? '' : 's'} started: ${agents.map((i) => i.title.slice(7)).slice(0, 2).join('; ')}${agents.length > 2 ? `, +${agents.length - 2}` : ''}`);
        return parts.join(' \u00b7 ');
    }
    /** Rows in file order (byte offset, then part); true when they were not. */
    function sortRows(chat) {
        const list = chat.messages;
        const ord = (m) => Number(m.at) * 1000 + (Number(m.part) || 0);
        if (list.every((m, i) => !i || ord(m) >= ord(list[i - 1]))) return false;
        list.sort((a, b) => ord(a) - ord(b));
        return true;
    }
    function coalesce(chat) {
        const list = chat.messages;
        let changed = false;
        for (let i = list.length - 1; i > 0; i -= 1) {
            const a = list[i - 1];
            const b = list[i];
            if (a.kind !== 'summary' || b.kind !== 'summary' || !!a.sidechain !== !!b.sidechain) continue;
            const items = (a.items || []).concat(b.items || []);
            list[i - 1] = Object.assign({}, a, { items: items.slice(0, 200), more: (Number(a.more) || 0) + (Number(b.more) || 0) + Math.max(0, items.length - 200), merged: (a.merged || 0) + 1 });
            list[i - 1].label = sumLabel(list[i - 1].items, list[i - 1].more);
            list.splice(i, 1);
            (chat.absorbed || (chat.absorbed = new Set())).add(msgKey(b));
            changed = true;
        }
        return changed;
    }

    /** Drop whole lines from the top / the end until at most MSG_MAX rows are left. */
    function trimRows(chat, fromEnd) {
        const list = chat.messages;
        if (list.length <= MSG_MAX) return;
        if (fromEnd) {
            list.length = MSG_MAX;
            chat.tailCut = true;
            chat.fwd = null;
        } else {
            let drop = list.length - MSG_MAX;
            while (drop < list.length && list[drop - 1].at === list[drop].at) drop += 1;
            list.splice(0, drop);
            if (list.length) { chat.start = list[0].at; chat.more = true; }
        }
    }

    /**
     * The session's newest page (default), the page before the first row (earlier), or the page after the last
     * row once the end was dropped (later). One page is MSG_PAGE rows; the page keeps at most MSG_MAX.
     */
    async function loadChat(id, earlier, later) {
        let chat = S.chats.get(id);
        if (!chat) { chat = { messages: [], start: 0, end: 0, more: false, loading: false, error: '', row: rowOf(id), gen: 0, tailCut: false }; S.chats.set(id, chat); }
        if (chat.loading && (earlier || later)) return;
        const gen = earlier || later ? chat.gen : ++chat.gen; // a newest read supersedes anything in flight
        chat.loading = true;
        const show = showNow();
        try {
            if (earlier) {
                const r = await send('claude_desk_transcript', { id, before: chat.start, limit: MSG_PAGE, show });
                if (gen !== chat.gen) return;
                const seen = new Set(chat.messages.map(msgKey).concat(Array.from(chat.absorbed || [])));
                const fresh = shownOnly(r.messages).filter((m) => !seen.has(msgKey(m)));
                chat.more = !!r.more && r.start < chat.start;
                chat.start = r.start;
                chat.messages = fresh.concat(chat.messages);
                trimRows(chat, true);
            } else if (later) {
                const last = chat.messages[chat.messages.length - 1];
                const r = await send('claude_desk_transcript', { id, since: chat.fwd != null ? chat.fwd : (last ? last.at : chat.end), show });
                if (gen !== chat.gen) return;
                const seen = new Set(chat.messages.map(msgKey).concat(Array.from(chat.absorbed || [])));
                const fresh = shownOnly(r.messages).filter((m) => !seen.has(msgKey(m)));
                chat.messages = chat.messages.concat(fresh.slice(0, MSG_PAGE));
                // read everything the chunk held: the next read starts where it ended (rows hidden by the view cost no loop)
                chat.fwd = fresh.length <= MSG_PAGE ? r.end : null;
                if (fresh.length <= MSG_PAGE && r.end >= chat.end) { chat.tailCut = false; chat.fwd = null; }
                trimRows(chat, false);
            } else {
                const r = await send('claude_desk_transcript', { id, limit: MSG_PAGE, show });
                if (gen !== chat.gen) return;
                chat.messages = shownOnly(r.messages);
                chat.absorbed = new Set();
                chat.start = r.start;
                chat.end = r.end;
                chat.more = r.more;
                chat.tailCut = false;
                chat.stick = true;
                pendingReconcile(chat, chat.messages);
                void insLoad(id);
                void tasksLoad(id);
            }
            sortRows(chat);
            coalesce(chat);
            chat.error = '';
        } catch (e) { if (gen === chat.gen) chat.error = errText(e); } finally { if (gen === chat.gen) chat.loading = false; }
        if (gen !== chat.gen) return;
        if (!earlier && !later) await watch(id, true);
        if (S.c && nodeSid(S.c.node) === id) {
            if (earlier || later) redrawLog(id);
            else S.c.render();
        }
    }

    /**
     * The log drawn again from the page's rows with the reader's place kept: the first row in view keeps its
     * distance from the top (or the end stays in view when the reader was there).
     */
    function redrawLog(id) {
        const pane = logOf(id);
        const chat = S.chats.get(id);
        if (!pane || !chat) return;
        const top = pane.getBoundingClientRect().top;
        let key = '';
        let off = 0;
        if (!chat.stick) {
            const rows = pane.querySelectorAll('[data-k]');
            for (let i = 0; i < rows.length; i += 1) {
                const r = rows[i].getBoundingClientRect();
                if (r.bottom > top + 1) { key = rows[i].dataset.k; off = r.top - top; break; }
            }
        }
        pane.innerHTML = logInner(chat, id);
        const row = key ? Array.from(pane.querySelectorAll('[data-k]')).find((n) => n.dataset.k === key) : null;
        if (row) pane.scrollTop += row.getBoundingClientRect().top - top - off;
        else if (chat.stick) pane.scrollTop = pane.scrollHeight;
        delete S.c.modal.querySelector('.mmc-result').dataset.html;
        void pageMore(id, pane);
    }

    /** More rows are read while the reader is near the end that has more, or the page is too short to scroll. */
    function pageMore(id, pane) {
        const chat = S.chats.get(id);
        if (!chat || chat.loading || chat.error || !pane) return;
        const room = pane.scrollHeight - pane.clientHeight;
        if (chat.more && (pane.scrollTop < 160 || room <= 4)) void loadChat(id, true);
        else if (chat.tailCut && room - pane.scrollTop < 160) void loadChat(id, false, true);
    }

    // ---- a session's details: background agents and tasks (claude_desk_session detail / agent_page / task_output) ----

    /** A reply's payload: the fields sit at the top of the reply, or under result. */
    const unwrap = (r, key) => (r && r[key] !== undefined ? r : (r && r.data && typeof r.data === 'object' && r.data[key] !== undefined ? r.data : (r && r.result && typeof r.result === 'object' ? r.result : r)) || {});
    const chatOf = (id) => S.chats.get(id) || null;
    /** A session Remote Control's own server spawned: Fleet has no terminal of it to type into until it takes it over. */
    const serverOrigin = (id) => {
        const l = liveOf(id);
        if (l && l.origin) return l.origin === 'server';
        const ch = chatOf(id);
        return !!(ch && ch.dt && ch.dt.data && ch.dt.data.origin === 'server');
    };

    async function loadDetail(id) {
        const chat = chatOf(id);
        if (!chat) return;
        const dt = chat.dt = Object.assign(chat.dt || { data: null, agents: new Map(), agentSel: '', taskSel: '', task: null }, { loading: true, error: '', gone: false });
        repaint();
        try {
            const r = await send('claude_desk_session', { action: 'detail', id });
            dt.data = unwrap(r, 'detail').detail || null;
            if (dt.data && dt.data.insight) chat.ins = dt.data.insight;
        } catch (e) { if (isGone(e)) dt.gone = true; else dt.error = errText(e); }
        dt.loading = false;
        if (S.c && nodeSid(S.c.node) === id) S.c.render();
    }

    async function loadAgentPage(id, agentId, earlier) {
        const chat = chatOf(id);
        if (!chat || !chat.dt) return;
        let pg = chat.dt.agents.get(agentId);
        if (!pg) { pg = { messages: [], start: 0, end: 0, more: false, loading: false, error: '' }; chat.dt.agents.set(agentId, pg); }
        if (pg.loading) return;
        pg.loading = true;
        detailBoxes(id);
        try {
            const show = showNow();
            const r = unwrap(await send('claude_desk_session', earlier ? { action: 'agent_page', id, agentId, before: pg.start, limit: MSG_PAGE, show } : { action: 'agent_page', id, agentId, limit: MSG_PAGE, show }), 'messages');
            pg.messages = earlier ? shownOnly(r.messages).concat(pg.messages) : shownOnly(r.messages);
            pg.start = r.start;
            if (!earlier) pg.end = r.end;
            pg.more = !!r.more;
            pg.error = '';
        } catch (e) { pg.error = isGone(e) ? NOT_YET : errText(e); }
        pg.loading = false;
        detailBoxes(id);
    }

    async function loadTaskOutput(id, taskId) {
        const chat = chatOf(id);
        if (!chat || !chat.dt) return;
        const meta = ((chat.dt.data && chat.dt.data.tasks) || []).find((x) => x.taskId === taskId);
        if (meta && meta.kind === 'agent') {
            // a background agent has no output file: its conversation is under Background Agents
            const ag = ((chat.dt.data && chat.dt.data.agents) || []).find((x) => x.agentId === taskId);
            chat.dt.task = { taskId, hint: ag ? `This task is the background agent "${ag.description || taskId}": its conversation is shown under Background Agents.` : 'This task is a background agent: its conversation is under Background Agents.' };
            if (ag) { chat.dt.agentSel = ag.agentId; if (!chat.dt.agents.has(ag.agentId)) void loadAgentPage(id, ag.agentId, false); }
            detailBoxes(id);
            return;
        }
        const t = chat.dt.task = { taskId, loading: true, error: '', text: '' };
        detailBoxes(id);
        try {
            const r = unwrap(await send('claude_desk_session', { action: 'task_output', id, taskId }), 'text');
            if (chat.dt.task === t) Object.assign(t, { text: r.text || '', sizeBytes: r.sizeBytes, modifiedAt: r.modifiedAt, error: '' });
        } catch (e) { t.error = isGone(e) ? NOT_YET : errText(e); }
        t.loading = false;
        if (chat.dt.task === t) detailBoxes(id);
    }

    /** New messages of the open session are pushed to this window (one session at a time). */
    async function watch(id, again) {
        if (S.watching === id && !again) return;
        const chat = S.chats.get(id);
        try {
            // the watch is told what the view shows, so a push carries only that (a new view is a new watch)
            await send('claude_desk_watch', { id, from: chat ? chat.end : undefined, show: showNow() });
            S.watching = id;
            // a chat kept from before (the window reopened, the socket came back): the pushes start at the file's end,
            // so read what was written meanwhile (Nov 24 2026: a reopened chat stopped 40 minutes back)
            if (chat && !chat.loading && !again) void loadChat(id, false);
        } catch (_) { S.watching = null; }
    }
    async function unwatch() {
        if (!S.watching) return;
        S.watching = null;
        try { await send('claude_desk_unwatch', {}); } catch (_) { /* gone */ }
    }

    // ---- plan usage (statusHub feed claude_usage, pushed; subscribed while the summary page is shown) ------

    const USAGE_KINDS = { session: 0, five_hour: 0, weekly_all: 1, seven_day: 1 };
    const usageRank = (l) => (l.kind in USAGE_KINDS ? USAGE_KINDS[l.kind] : 2);

    function usageApply(changed, removed, whole) {
        if (whole) S.usage = new Map();
        Object.entries(changed || {}).forEach(([id, row]) => { if (id !== '_meta' && row && typeof row === 'object') S.usage.set(id, row); });
        (removed || []).forEach((id) => S.usage.delete(id));
        S.usageLoaded = true;
    }

    /**
     * The tray (walletTray.watchClaude) counts who shows the figures and unsubscribes when nobody does, so
     * this joins its count; the first snapshot is asked for here because the tray keeps it to itself.
     */
    async function usageWatch(on) {
        if (on === S.usageOn) return;
        S.usageOn = on;
        const tray = root.walletTray && typeof root.walletTray.watchClaude === 'function' ? root.walletTray : null;
        if (tray) tray.watchClaude('fleet', on);
        if (on) {
            try {
                const r = await send('status_subscribe', { feed: 'claude_usage' });
                if (S.usageOn) { usageApply(r.items || {}, [], true); S.usageError = ''; }
            } catch (e) { S.usageError = errText(e); S.usageLoaded = true; }
            repaint();
        } else if (!tray) {
            try { await send('status_unsubscribe', { feed: 'claude_usage' }); } catch (_) { /* gone */ }
        }
    }

    const NODES_USAGE = new Set(['root', 'co-root']);
    const usageWanted = (id) => NODES_USAGE.has(id);

    function levelOf(l) {
        const sev = String(l.severity || '').toLowerCase();
        if (l.percent >= 90 || /crit|danger|high|error|limit|block/.test(sev)) return 'error';
        if (l.percent >= 75 || /warn|elevat|approach/.test(sev)) return 'paused';
        return '';
    }
    // pace and renewal: a copy of modules/claudePace.js (the browser cannot require it; test-claude-fleet.js checks the copies agree)
    function paceOf(l, now) {
        const HOUR = 3600000;
        const k = String((l && l.kind) || '');
        const win = k === 'session' || k === 'five_hour' ? 5 * HOUR : (k.startsWith('weekly') || k.startsWith('seven_day') ? 168 * HOUR : 0);
        if (!win || !(l.resetsAt > now) || !Number.isFinite(l.percent)) return null;
        const elapsed = Math.max(0, Math.min(1, (now - (l.resetsAt - win)) / win));
        const percent = Math.max(0, l.percent);
        const elapsedPct = elapsed * 100;
        let runOutAt = null;
        let far = false;
        if (percent > 0 && elapsed >= 0.05) {
            const at = now + (100 - percent) * (elapsed * win) / percent;
            if (percent >= 100 || at < l.resetsAt) { far = true; runOutAt = percent >= 100 ? null : Math.round(at); }
        }
        return { elapsedPct, percent, ahead: Math.round(percent - elapsedPct), state: far ? 'far' : (percent > elapsedPct ? 'over' : 'ok'), runOutAt, resetsAt: l.resetsAt, win };
    }
    function renewalAfter(day, now) {
        const d = Math.round(Number(day));
        if (!(d >= 1 && d <= 31)) return null;
        const base = new Date(now);
        for (let m = 0; m < 3; m++) {
            const y = base.getFullYear();
            const mo = base.getMonth() + m;
            const last = new Date(y, mo + 1, 0).getDate();
            const t = new Date(y, mo, Math.min(d, last), 23, 59, 59).getTime();
            if (t > now) return new Date(y, mo, Math.min(d, last)).getTime();
        }
        return null;
    }
    const dayText = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const whenText = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    /** { text, tip } of the account's renewal: the day the user set, else the day its subscription began (an estimate). */
    function renewalOf(a, now) {
        const f = fleetOf(a.index);
        const set = f && f.settings && f.settings.renewalDay;
        const day = set || a.billingDay;
        const at = day ? renewalAfter(day, now) : null;
        if (!at) return null;
        return { text: `Renews ${dayText(at)}`, tip: set ? `Renews on day ${set} of each month (set by you)` : `Estimated from the day this subscription started (day ${day} of the month). Set the real renewal day in the account's Properties.` };
    }
    function paceTip(p) {
        if (!p) return '';
        const n = Math.abs(p.ahead);
        const rel = p.ahead === 0 ? 'on pace' : `you are ${n} point${n === 1 ? '' : 's'} ${p.ahead > 0 ? 'ahead' : 'behind'}`;
        return `Even pace: ${Math.round(p.elapsedPct)}% by now - ${rel}`;
    }
    function resetText(l, now) {
        if (!l.resetsAt) return '';
        if (l.resetsAt <= now) return 'Reset since the last reading';
        const p = paceOf(l, now);
        const reset = `${/^(weekly|seven_day)/.test(String(l.kind || '')) ? 'Weekly resets' : 'Resets'} ${whenText(l.resetsAt)}`;
        return p && p.state === 'far' && p.runOutAt ? `At this rate: out ${whenText(p.runOutAt)}, ${reset.charAt(0).toLowerCase()}${reset.slice(1)}` : reset;
    }
    const isPreferred = (idx) => { const f = fleetOf(idx); return !!(f && f.settings && f.settings.preferred); };
    const PRIORITY = [['high', 'High'], ['normal', 'Normal'], ['low', 'Low']];
    /** 'High' / 'Low' next to the account (normal is not worth a word). */
    const fleetTags = (f) => [f.settings && f.settings.preferred ? 'Preferred' : '', f.settings && f.settings.priority === 'high' ? 'High' : (f.settings && f.settings.priority === 'low' ? 'Low' : '')].filter(Boolean).join(', ');
    const priorityTag = (idx) => { const f = fleetOf(idx); const p = f && f.settings && f.settings.priority; return p === 'high' ? 'High priority' : (p === 'low' ? 'Low priority' : ''); };

    /**
     * Vista's information bar for an account that nears a limit or is no longer free to schedule work
     * (fleet row availability: state near | capped | exhausted | login): the warning icon while it can still take work,
     * the error icon once it cannot.
     */
    function availBar(f, withName) {
        const av = f && f.availability;
        if (!av) return '';
        return limitBar(f, av, withName) + costBar(av, f, withName);
    }
    /** Extra usage is on: work past the plan's limits is billed (availability.costWarning): a red bar, whatever the limits say. */
    function costBar(av, f, withName) {
        const text = av && av.costWarning ? String(av.costWarning) : '';
        return text ? `<div class="cd-infobar is-error is-cost" role="alert"><img src="${VI}/error-16.png" alt=""><span>${withName && f ? `<b>${esc(f.name)}</b>: ` : ''}${esc(text)}</span></div>` : '';
    }
    function limitBar(f, av, withName) {
        const bad = av.state === 'near' || av.state === 'capped' || av.state === 'exhausted' || av.state === 'login' || av.schedulable === false;
        if (!bad) return '';
        // an expired login is a warning (sign in again), not a limit: the account can be fixed any time
        const icon = (av.state === 'near' && av.schedulable !== false) || av.state === 'login' ? 'warning' : 'error';
        const fallback = av.state === 'login' ? 'login expired: sign in again (Fleet > Accounts > the account).' : av.state === 'near' ? 'is close to a usage limit.' : (av.state === 'exhausted' ? 'has used up its plan usage.' : 'has reached a usage limit.');
        const msg = av.message ? String(av.message) : `${f.name} ${fallback}`;
        const at = av.resetsAt ? new Date(av.resetsAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
        // the server's sentence may already end on "until it resets": the time then completes it
        const base = msg.replace(/[\s.]+$/, '');
        const text = !at ? `${base}.` : (/\bresets?$/i.test(base) ? `${base} ${at}.` : `${base}. Resets ${at}.`);
        return `<div class="cd-infobar is-${icon}" role="alert"><img src="${VI}/${icon}-16.png" alt=""><span>${withName && !msg.includes(f.name) ? `<b>${esc(f.name)}</b>: ` : ''}${esc(text)}</span></div>`;
    }

    /** "Today: 9% of 14% share - On pace" from the fleet row's availability.pace; a hint, not an error (over / ahead only say so in words). */
    function paceLine(f) {
        const p = f && f.availability && f.availability.pace;
        if (!p || p.state === 'unknown' || !Number.isFinite(p.usedToday)) return '';
        // an account at or past a limit already says so in its bar above: no pace line under it
        if (f.availability && ['exhausted', 'capped', 'login'].includes(f.availability.state)) return '';
        const word = { ok: 'On pace', ahead: 'Ahead of pace', over: 'Used today\'s share' }[p.state] || '';
        const tip = `Week ${p.weekPct}% of ${p.cap}%, ${p.expectedPct}% expected by now; ${p.dayStartPct}% when today began, ${p.daysLeft} days left`;
        return `<p class="mmc-hint cd-pace is-${esc(p.state)}" title="${esc(tip)}">Today: ${esc(String(p.usedToday))}% of ${esc(String(p.todayShare))}% share - ${esc(word)}</p>`;
    }

    function usageBlock(a, now) {
        const planText = a.plan ? String(a.plan).replace(/^\w/, (ch) => ch.toUpperCase()) : '';
        const who = [a.engine ? 'Director' : '', a.onHost ? 'Remote Control' : ''].filter(Boolean).join(', ');
        const limits = (Array.isArray(a.limits) ? a.limits : []).filter((l) => l && l.percent != null).sort((x, y) => usageRank(x) - usageRank(y));
        let body;
        if (limits.length) {
            body = limits.map((l) => {
                const pace = paceOf(l, now);
                const lv = pace && pace.state === 'far' ? 'error' : (levelOf(l) || (pace && pace.state === 'over' ? 'paused' : ''));
                const pct = Math.max(0, Math.min(100, Math.round(l.percent)));
                const stale = l.resetsAt && l.resetsAt <= now;
                return `<div class="cd-usage-row"><span class="cd-usage-label">${esc(l.label || l.short || l.kind)}</span>`
                    + `<div class="mmc-progress"><div role="progressbar"${lv ? ` class="${lv}"` : ''} aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stale ? 0 : pct}"><div class="cd-fill" data-w="${stale ? 0 : pct}"></div>${pace ? `<i class="cd-pace" data-pace="${pace.elapsedPct.toFixed(2)}" data-reset="${pace.resetsAt}" data-win="${pace.win}" title="${esc(paceTip(pace))}"></i>` : ''}</div><span>${stale ? '' : `${pct}%`}</span></div>`
                    + `<span class="cd-usage-reset mmc-hint"${pace ? ` title="${esc(paceTip(pace))}"` : ''}>${esc(resetText(l, now))}</span></div>`;
            }).join('');
        } else {
            body = `<p class="mmc-hint">${esc(a.needsLogin ? (a.error || 'Link a claude.ai login to see its usage.') : `Usage unavailable${a.error ? `: ${a.error}` : ''}`)}</p>`;
        }
        const x = a.extra;
        const extra = x && x.enabled ? `<p class="mmc-hint">Extra usage is on${x.limitReached ? ' (limit reached)' : ''}.</p>` : '';
        const err = limits.length && a.error ? `<p class="mmc-hint">${esc(a.error)}</p>` : '';
        const ren = renewalOf(a, now);
        return `<div class="cd-usage-acct"><div class="cd-usage-head"><img src="${esc(S.app.url('assets').replace(/\/$/, ''))}/account-16.png" alt=""><b>${esc(a.name)}</b>`
            + `<span class="mmc-hint">${esc([planText, who, isPreferred(a.index) ? 'Preferred' : '', priorityTag(a.index)].filter(Boolean).join(' - '))}</span>${ren ? `<span class="mmc-hint cd-renews" title="${esc(ren.tip)}">${esc(ren.text)}</span>` : ''}</div>${availBar(fleetOf(a.index), false)}${paceLine(fleetOf(a.index))}${body}${extra}${err}</div>`;
    }
    function usageHtml() {
        const rows = [...S.usage.values()].sort((a, b) => (a.index || 0) - (b.index || 0));
        if (!rows.length) return `<p class="${S.usageError ? 'cd-err' : 'mmc-hint'}">${esc(S.usageError || (S.usageLoaded ? 'There are no Claude accounts.' : 'Reading the plan usage of every account...'))}</p>`;
        const now = Date.now();
        return rows.map((a) => usageBlock(a, now)).join('');
    }

    // ---- the supervisor (claude_desk_supervisor) -----------------------------------------------------------

    const POLICY_JOBS = [['sweep', 'Mechanical sweep'], ['part', 'Well-defined part (worker default)'], ['tricky', 'Tricky part (concurrency, migrations, security)'], ['plan', 'Planning a normal request (planner default)'], ['large', 'Planning a large request'], ['huge', 'Very large or hard request'], ['max', 'Max (explicit request only)']];
    const POLICY_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
    const POLICY_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
    const POLICY_FALLBACK = { sweep: { model: 'sonnet', effort: 'low', maxModel: 'sonnet', maxEffort: 'medium' }, part: { model: 'sonnet', effort: 'medium', maxModel: 'sonnet', maxEffort: 'high' }, tricky: { model: 'sonnet', effort: 'high', maxModel: 'opus', maxEffort: 'high' }, plan: { model: 'opus', effort: 'high', maxModel: 'opus', maxEffort: 'xhigh' }, large: { model: 'opus', effort: 'xhigh', maxModel: 'opus', maxEffort: 'xhigh' }, huge: { model: 'fable', effort: 'xhigh', maxModel: 'fable', maxEffort: 'xhigh' }, max: { model: 'fable', effort: 'max', maxModel: 'fable', maxEffort: 'max' } };
    const SUP_DEFAULT = { enabled: false, engine: 'tokenrouter', model: '', delivery: 'inbox', manageLocks: false, trackArtifacts: false, maxConcurrent: 3, autoStart: true, yozoraRepos: ['DreamScape/StaticForge'] };
    const SUP_FALLBACK_ENGINES = [{ id: 'tokenrouter', name: 'TokenRouter', defaultModel: 'deepseek/deepseek-v4.1-flash' }];
    const DELIVERY = [['inbox', 'Inbox only'], ['steer', 'Type into the session'], ['off', 'Off']];
    const VERDICT = { ok: ['Complete', `${VI}/check-16.png`], gaps: ['Gaps found', `${VI}/warning-16.png`], unclear: ['Unclear', `${VI}/info-16.png`], error: ['Review failed', `${VI}/error-16.png`] };
    const TRIGGER = { 'turn-end': 'Turn ended', mcp: 'Asked by the agent', recheck: 'Re-checked' };
    const supEngines = () => (S.sup.data && S.sup.data.engines && S.sup.data.engines.length ? S.sup.data.engines : SUP_FALLBACK_ENGINES);
    const supSettings = () => S.sup.draft || Object.assign({}, SUP_DEFAULT, (S.sup.data && S.sup.data.settings) || {});
    /** The kinds of notice that may reach the phone (settings.notify); a key the server adds that is not listed shows under its own name. */
    const NOTIFY_KINDS = [
        ['workDone', 'A work item I started is done'],
        ['workAttention', 'A work item needs me (a question for me, or it stopped)'],
        ['maintenance', 'Fleet maintenance reports (daily checks and cleanup)'],
        ['usage', 'Usage and cost flags']
    ];
    const notifyRows = (n) => NOTIFY_KINDS.concat(Object.keys(n || {}).filter((k) => !NOTIFY_KINDS.some((x) => x[0] === k)).map((k) => [k, k])).map(([k, t]) => `<label class="cd-opt"><input type="checkbox" data-sup="notify.${esc(k)}"${n && n[k] === true ? ' checked' : ''}><span>${esc(t)}</span></label>`).join('');
    const supReviews = () => (S.sup.data && Array.isArray(S.sup.data.reviews) ? S.sup.data.reviews : []);
    const supReview = (id) => supReviews().find((r) => String(r.id) === String(id)) || null;
    /** The rule violations a review still has open (its rule check at turn end: check scripts + the Supervisor's judgement). */
    const supViolations = (r) => (Array.isArray(r && r.violations) ? r.violations : []).filter((v) => !v.resolved);
    const supEngine = (id) => supEngines().find((e) => e.id === id) || null;
    /** The models an engine offers (its list, else its own default); a stored value outside it stays selectable. */
    const supModelList = (engineId) => { const e = supEngine(engineId); return e ? (Array.isArray(e.models) ? e.models.slice() : []).concat(e.defaultModel && !(e.models || []).includes(e.defaultModel) ? [e.defaultModel] : []) : []; };
    function supModelOptions(engineId, cur) {
        const e = supEngine(engineId);
        const list = supModelList(engineId);
        const opts = [`<option value=""${cur ? '' : ' selected'}>${esc(e && e.defaultModel ? `Engine default (${e.defaultModel})` : 'Engine default')}</option>`];
        list.forEach((m) => opts.push(`<option value="${esc(m)}"${m === cur ? ' selected' : ''}>${esc(m)}</option>`));
        if (cur && !list.includes(cur)) opts.push(`<option value="${esc(cur)}" selected>${esc(cur)}</option>`);
        opts.push('<option value="__other">Other model ID...</option>');
        return opts.join('');
    }
    const SUP_EFFORT_TEXT = { none: 'None (no reasoning)', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
    function supEffortOptions(engineId, cur) {
        const e = supEngine(engineId);
        const list = (e && Array.isArray(e.efforts) && e.efforts.length) ? e.efforts : ['none', 'low', 'medium', 'high'];
        return [`<option value=""${cur ? '' : ' selected'}>Engine default</option>`].concat(list.map((v) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(SUP_EFFORT_TEXT[v] || v)}</option>`)).join('');
    }
    const SUP_GONE = /unknown message type/i;
    const supWork = () => (S.sup.data && Array.isArray(S.sup.data.work) ? S.sup.data.work : []);
    const workOf = (id) => supWork().find((w) => String(w.id) === String(id)) || null;
    const WORK_STATE = { held: 'Waiting', queued: 'Queued', starting: 'Starting', running: 'Running', waiting: 'Sent Back', input: 'Input Required', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
    const WORK_SOURCE = { fleet: 'Fleet', plaud: 'Plaud', director: 'Director', agent: 'Agent', yozora: 'Yozora' };
    const issueShort = (i) => `${String(i.repo || '').split('/').pop()}#${i.number}`;
    /** Every issue a request carries (primary first); a server that sends only `issue` gives one. */
    const issuesOf = (w) => (w && Array.isArray(w.issues) && w.issues.length ? w.issues : (w && w.issue ? [w.issue] : []));
    /** `#1179`, or `#1179 +4` when the request is one run over several issues. */
    const issueText = (w) => { const l = issuesOf(w); return l.length ? `${issueShort(l[0])}${l.length > 1 ? ` +${l.length - 1}` : ''}` : ''; };
    /** The issues field of the wizard: refs (owner/repo#N) or issue URLs, separated by spaces or commas. */
    const ISSUE_REF = /^[\w.-]+\/[\w.-]+#\d+$|^https?:\/\/\S+\/issues\/\d+\/?$/;
    const issueRefs = (text) => String(text || '').split(/[\s,]+/).filter(Boolean);
    /** The issues of a request as links (each opens in a new tab like the Open issue link). */
    const issueLinks = (w) => issuesOf(w).map((i) => (i.url && /^https?:\/\//.test(i.url) ? `<span class="mmc-link" data-act="open-link" data-arg="${esc(i.url)}" title="${esc(i.title || i.url)}">${esc(issueShort(i))}</span>` : esc(issueShort(i)))).join(', ');
    const issueBad = (text) => issueRefs(text).find((x) => !ISSUE_REF.test(x)) || '';
    const WORK_OPEN = new Set(['held', 'queued', 'starting', 'running', 'waiting', 'input']);
    const workIcon = (st) => ({ held: `${ITEMS}/date-and-time-16.png`, queued: `${VI}/info-16.png`, input: QUESTION16, waiting: SENTBACK16, failed: `${VI}/error-16.png`, cancelled: `${VI}/warning-16.png`, done: `${VI}/check-16.png` }[st] || SESSION16);
    const supLocks = () => (S.sup.data && Array.isArray(S.sup.data.locks) ? S.sup.data.locks : []);
    const supArtifacts = () => (S.sup.data && Array.isArray(S.sup.data.artifacts) ? S.sup.data.artifacts : []);
    const LOCK_STATE = { live: 'Live', idle: 'Idle', orphan: 'Orphan' };
    const PLANTED = { agent: 'Agent', supervisor: 'Supervisor', unknown: 'Unknown' };
    const ART_KIND = { dir: 'Folder', file: 'File', worktree: 'Worktree' };
    const ART_STATE = { live: 'In use', orphan: 'Orphan', gone: 'Gone', trashed: 'In trash' };
    const ART_DECISION = { refused: 'Refused', unsafe: 'Judged unsafe', trashed: 'Trashed', removed: 'Removed', restored: 'Restored', purged: 'Deleted' };
    // pauses (claude_desk_supervisor pause / resume) and the restart waits the Supervisor watches
    const supHolds = () => (S.sup.data && Array.isArray(S.sup.data.holds) ? S.sup.data.holds : []);
    const holdOf = (sid) => supHolds().find((h) => h.sessionId === sid) || null;
    const supAsks = () => (S.sup.data && Array.isArray(S.sup.data.gateAsks) ? S.sup.data.gateAsks : []);
    const HOLD_KIND = { manual: 'By hand', collision: 'Two agents on the same files', agent: 'By an agent' };
    const holdWord = (h) => (h && h.mode === 'freeze' ? 'Frozen' : 'Paused');
    const holdLine = (h) => `${holdWord(h)}${h.reason ? `: ${h.reason}` : ''}`;
    // the shape of supervised work (topology) and its stages
    const TOPO = [
        ['direct', 'Supervisor -> Claude agent', 'Single agent'],
        ['surfaces', 'Supervisor -> Claude agents, one per surface', 'One agent per surface'],
        ['planner', 'Supervisor -> Claude planner -> background agents', 'Planner and agents'],
        ['auto', 'Let the Supervisor decide', 'Supervisor decides']
    ];
    // 'groups' is stored by the server for an item planned as several planners; it is never offered in the shape picker (not in TOPO)
    const topoShort = (t) => (t === 'groups' ? 'Planner per group' : ((TOPO.find((x) => x[0] === t) || [])[2] || ''));
    const isGroups = (w) => !!w && w.topology === 'groups';
    /** A planner of a groups item: the child of a parent whose shape is groups. */
    const groupParentOf = (w) => { if (!w || w.parentId == null || w.parentId === '') return null; const p = workOf(w.parentId); return isGroups(p) ? p : null; };
    const plannerLabel = (w, p) => { const sib = supWork().filter((x) => String(x.parentId) === String(p.id)); const i = sib.findIndex((x) => String(x.id) === String(w.id)); return i >= 0 ? `Planner ${i + 1} of ${sib.length}` : 'Planner'; };
    const STAGES = { planner: { label: 'Planner', engine: 'claude', model: 'opus', effort: 'high', uses: ['planner', 'auto'] }, workers: { label: 'Workers', engine: 'claude', model: 'sonnet', effort: 'medium', uses: ['direct', 'surfaces', 'planner', 'auto'] } };
    const workState = (w) => { const h = w.sessionId ? holdOf(w.sessionId) : null; return h ? holdWord(h) : (w.topology === 'auto' && (w.state === 'running' || w.state === 'starting') ? 'Planning' : (WORK_STATE[w.state] || w.state || '')); };
    const shapeText = (w) => {
        if (w.parentId != null && w.parentId !== '') { const p = workOf(w.parentId); return isGroups(p) ? `${plannerLabel(w, p)} of ${p.title || p.id}` : `Part of ${p ? (p.title || p.id) : w.parentId}`; }
        const parts = supWork().filter((x) => String(x.parentId) === String(w.id));
        const t = topoShort(w.topology);
        if (isGroups(w)) return `${t} (${plural(parts.length, 'planner')}, ${parts.filter((x) => x.state === 'done').length} done)`;
        return parts.length ? `${t || 'One agent per surface'} (${plural(parts.length, 'part')}, ${parts.filter((x) => x.state === 'done').length} done)` : t;
    };

    function supTake(r) {
        wmPoke();
        wfPoke();
        if (r && r.settings) { S.sup.data = Object.assign({}, S.sup.data || {}, r); S.sup.draft = null; S.sup.loaded = true; S.sup.unavailable = false; S.sup.error = ''; S.sup.stale = false; }
    }
    function supFail(e) {
        if (SUP_GONE.test(errText(e))) { S.sup.unavailable = true; S.sup.error = ''; } else S.sup.error = errText(e);
    }
    async function loadSupervisor() {
        if (S.sup.loading) { S.sup.stale = true; return; }
        S.sup.loading = true;
        void loadEngines();
        try { supTake(await send('claude_desk_supervisor', { action: 'status' })); S.sup.loaded = true; } catch (e) { S.sup.loaded = true; supFail(e); } finally { S.sup.loading = false; }
        // a change that came in while it was being read: read once more
        if (S.sup.stale) { S.sup.stale = false; void loadSupervisor(); return; }
        openAgents();
        repaint();
    }
    /** One supervisor action; busy = the status line while it runs (a re-check takes up to a minute). */
    async function supAct(c, payload, busy) {
        S.sup.busy = busy || 'Working...';
        c.note(S.sup.busy);
        repaint();
        let errs = [];
        try {
            const r = await send('claude_desk_supervisor', payload);
            if (Array.isArray(r.errors)) errs = r.errors.map(String);
            if (r.settings) supTake(r);
            else if (r.review) {
                const list = supReviews().slice();
                const i = list.findIndex((x) => String(x.id) === String(r.review.id));
                if (i >= 0) list[i] = r.review; else list.unshift(r.review);
                S.sup.data = Object.assign({}, S.sup.data || {}, { reviews: list });
                S.sup.sel = String(r.review.id);
            }
            S.sup.error = '';
        } catch (e) { supFail(e); if (S.sup.error) await failBox(c, e); else await c.box(`<p>${NOT_YET}</p>`, null, { icon: 'info' }); }
        S.sup.busy = '';
        c.note('');
        repaint();
        if (errs.length) await c.box(`<p>${errs.length === 1 ? 'One request' : 'Some requests'} could not be changed:</p><ul>${errs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`, null, { icon: 'warning' });
    }

    /** Session nodes left open in Active Work (the tree remembers them) read their agents once. */
    function openAgents() {
        if (!S.c) return;
        S.c.open.forEach((id) => { const m = /^aw:s:(.+)$/.exec(id); if (m && !S.awAgents.has(m[1]) && liveOf(m[1])) void loadAwAgents(m[1]); });
    }

    function supDetailHtml() {
        const r = supReview(S.sup.sel);
        if (!r) return '<p class="mmc-hint">Select a review to see what was asked, what was missed and the steering.</p>';
        const missed = Array.isArray(r.missed) ? r.missed : [];
        const steering = Array.isArray(r.steering) ? r.steering : [];
        const live = !!liveOf(r.sessionId);
        const busy = !!S.sup.busy;
        const viols = Array.isArray(r.violations) ? r.violations : [];
        const sendable = (r.verdict === 'gaps' && !r.delivered && (missed.length || steering.length)) || (!r.delivered && supViolations(r).length > 0);
        const bits = [
            `<p><b>${esc(r.title || shortId(r.sessionId))}</b> <span class="mmc-hint">${esc([r.account, TRIGGER[r.trigger] || r.trigger, when(r.at)].filter(Boolean).join(' - '))}</span></p>`,
            `<p class="cd-sup-actions"><button type="button" class="btn-standard primary" data-act="sup-send" data-arg="${esc(r.id)}"${sendable && live && !busy ? '' : ' disabled'}>Send to Session</button> `
                + `<button type="button" class="btn-standard" data-act="sup-recheck" data-arg="${esc(r.sessionId)}"${busy ? ' disabled' : ''}>Re-check</button> `
                + `<button type="button" class="btn-standard" data-act="sup-dismiss" data-arg="${esc(r.id)}"${r.dismissed || busy ? ' disabled' : ''}>Dismiss</button></p>`,
            r.summary ? `<p class="cd-read">${esc(r.summary)}</p>` : '',
            r.request ? `<p><b>What was asked</b></p><p class="cd-read">${esc(r.request)}</p>` : '',
            missed.length ? `<p><b>Missed</b></p><table class="cd-table"><thead><tr><th>Item</th><th>Evidence</th></tr></thead><tbody>${missed.map((m) => `<tr><td>${esc(m.item)}</td><td>${esc(m.evidence || '')}</td></tr>`).join('')}</tbody></table>` : '',
            viols.length ? `<p><b>Rule violations</b></p><table class="cd-table"><thead><tr><th class="cd-w130">Rule</th><th>File</th><th>What and how to fix</th></tr></thead><tbody>${viols.map((v) => `<tr><td>${esc(v.rule)}${v.source === 'script' ? ' (check)' : ''}</td><td>${esc(v.file)}${v.line ? `:${esc(v.line)}` : ''}</td><td>${v.resolved ? `<s>${esc(v.why)}</s> ${esc(v.resolved)}` : `${esc(v.why)} - ${esc(v.fix)}`}${v.quote ? `<br><code>${esc(v.quote)}</code>` : ''}</td></tr>`).join('')}</tbody></table>` : '',
            r.ruleCheck && r.ruleCheck.checked ? `<p class="mmc-hint">Rule check: ${esc(String(r.ruleCheck.files.length))} file(s), ${esc((r.ruleCheck.scripts || []).join(', '))}${r.ruleCheck.calls ? `, ${esc(String(r.ruleCheck.calls))} engine call(s) on ${esc(String((r.ruleCheck.rules || []).length))} rule(s)` : ''}${r.ruleCheck.error ? `; ${esc(r.ruleCheck.error)}` : ''}.</p>` : '',
            steering.length ? `<p><b>Steering</b></p><ul class="cd-sup-steer">${steering.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '',
            r.delivered ? `<p class="mmc-hint">${r.delivered === 'steer' ? 'Typed into the session.' : 'Left in the inbox.'}</p>` : '',
            r.dismissed ? '<p class="mmc-hint">Dismissed.</p>' : ''
        ];
        return bits.join('');
    }

    /** The Supervisor's pages: the node itself (restart waits and settings) and one node per feature, each showing just its sections. */
    const SUP_PART = {
        'co-supervisor': ['cd-sup-tiles', 'cd-sup-recent'],
        'sup-settings': ['cd-sup-set'],
        'sup-reviews': ['cd-sup-list', 'cd-sup-detail'],
        'sup-asks': ['cd-sup-asks'],
        'sup-holds': ['cd-sup-holds'],
        'sup-locks': ['cd-sup-locks'],
        'sup-arts': ['cd-sup-arts']
    };
    const SUP_TITLE = { 'co-supervisor': 'Supervisor', 'sup-settings': 'Supervisor Settings', 'sup-reviews': 'Reviews', 'sup-asks': 'Restart Waits', 'sup-holds': 'Paused Sessions', 'sup-locks': 'Managed Locks', 'sup-arts': 'Work Folders and Temp Files' };

    /** The Supervisor node's dashboard: figures that link to their pages (reviews, cost, pauses, waits, locks, folders, maintenance). */
    function supDashTiles(st, reviews, asks, holds, locks, arts, total) {
        const P = S.spend;
        if (!P.loaded && !P.loading) void loadSpend();
        const day0 = new Date(); day0.setHours(0, 0, 0, 0);
        const live = reviews.filter((r) => !r.dismissed);
        const today = live.filter((r) => (Number(r.at) || 0) >= day0.getTime());
        const gaps = live.filter((r) => r.verdict === 'gaps');
        const w = (P.data && P.data.windows) || {};
        const money = (rows) => (P.data ? moneyText(spendFigures(rows).cost) : '...');
        const m = maintData();
        const ml = m && m.running ? 'Running' : (m && m.last ? (MAINT_STATE[m.last.state] || [m.last.state || ''])[0] : 'No run yet');
        const tile = (nav, icon, n, label, warn, title) => `<button type="button" class="cd-tile${warn && n ? ' is-warn' : ''}" data-act="nav:${nav}" title="${esc(title || label)}"><img src="${esc(icon)}" alt=""><b>${esc(String(n))}</b><small>${esc(label)}</small></button>`;
        const eng = supEngine(st.engine);
        return `<div class="cd-tiles">${[
            tile('sup-reviews', '/static_images/vista-cmdbar/paste.png', today.length, 'Reviews today'),
            tile('sup-reviews', `${VI}/warning-16.png`, gaps.length, 'Reviews with gaps', true),
            tile('sup-reviews', `${VI}/warning-16.png`, live.reduce((n, r) => n + supViolations(r).length, 0), 'Rule violations', true, 'Open ones the rule check found at turn end'),
            tile('co-supervisor', '/static_images/vista-cmdbar/gears.png', money(w.today), 'Cost today'),
            tile('co-supervisor', '/static_images/vista-cmdbar/gears.png', money(w.week), 'Cost, 7 days'),
            tile('sup-holds', '/static_images/vista-cmdbar/pause.png', holds.length, 'Paused sessions', true),
            tile('sup-asks', '/static_images/vista-cmdbar/clock.png', asks.length, 'Restart waits', true),
            tile('sup-locks', '/static_images/vista-cmdbar/lock.png', locks.length, 'Managed locks'),
            tile('sup-arts', FOLDER16, arts.length, 'Work folders', false, `${arts.length} folders, ${bytesText(total)}`),
            tile('sup-maint', '/static_images/vista-cmdbar/tools.png', ml, 'Last maintenance run')
        ].join('')}</div><p class="mmc-hint">Runs on ${esc([(eng && eng.name) || st.engine, st.model || 'the engine default'].join(' / '))}${st.enabled ? '' : ' (off)'}. ${arts.length ? `Work folders: ${esc(bytesText(total))}. ` : ''}<span class="mmc-link" data-act="nav:sup-settings">Settings</span> <span class="mmc-link" data-act="nav:sup-maint">Maintenance</span></p>`;
    }
    function supGapTable(reviews) {
        const list = reviews.filter((r) => !r.dismissed && r.verdict === 'gaps').sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0)).slice(0, 6);
        if (!list.length) return '<p class="mmc-hint">No review has gaps.</p>';
        return `<table class="cd-table"><thead><tr><th class="cd-w130">Session</th><th>Summary</th><th class="cd-w100">When</th></tr></thead><tbody>${list.map((r) => `<tr class="cd-dash-row" data-act="nav:sup-reviews"><td>${esc(r.title || shortId(r.sessionId))}</td><td>${esc(r.summary || '')}</td><td>${esc(when(r.at))}</td></tr>`).join('')}</tbody></table><p><span class="mmc-link" data-act="nav:sup-reviews">Open Reviews</span></p>`;
    }

    function supervisorPage(c, part = 'co-supervisor') {
        const sup = S.sup;
        if (!sup.loaded) { void loadSupervisor(); return c.page(SUP_TITLE[part], '', [{ id: 'cd-sup-wait', title: SUP_TITLE[part], body: '<p class="mmc-hint">Reading the supervisor...</p>' }]); }
        if (sup.stale && !sup.loading) { sup.stale = false; void loadSupervisor(); }
        if (sup.unavailable) return c.page(SUP_TITLE[part], '', [{ id: 'cd-sup-gone', title: SUP_TITLE[part], body: '<p>Supervisor is not available on this server yet.</p>' }]);
        const st = supSettings();
        const engines = supEngines();
        const eng = supEngine(st.engine);
        const engineOpts = (eng ? engines : engines.concat([{ id: st.engine, name: st.engine }])).map((e) => `<option value="${esc(e.id)}"${e.id === st.engine ? ' selected' : ''}>${esc(e.name || e.id)}</option>`).join('');
        const stats = (sup.data && sup.data.stats) || {};
        const form = `<div class="cd-sup-form">
            <label class="cd-opt"><input type="checkbox" data-sup="enabled"${st.enabled ? ' checked' : ''}><span>Enabled: review each agent turn against what was asked</span></label>
            <label><span>Engine:</span><select class="vdt-select" data-sup="engine">${engineOpts}</select></label>
            <label><span>Model:</span><select class="vdt-select" data-sup="model">${supModelOptions(st.engine, st.model)}</select></label>
            <label title="The default and the maximum for the Supervisor's judgement calls (reviews, rule checks). Simple jobs use less: titles none, task lists and sizing low."><span>Maximum effort:</span><select class="vdt-select" data-sup="effort">${supEffortOptions(st.engine, st.effort)}</select></label>
            <label data-sup-other hidden><span>Model ID:</span><input type="text" data-sup="modelOther" value="" placeholder="A full model ID" spellcheck="false" autocomplete="off"></label>
            <label><span>Reviews:</span><select class="vdt-select" data-sup="reviewScope">${[['supervised', 'Supervised sessions only'], ['all', 'Every session']].map(([v, t]) => `<option value="${v}"${v === (st.reviewScope || 'supervised') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label><span>Delivery:</span><select class="vdt-select" data-sup="delivery">${DELIVERY.map(([v, t]) => `<option value="${v}"${v === st.delivery ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label><span>Max concurrent sessions:</span><input type="text" data-sup="maxConcurrent" value="${esc(st.maxConcurrent == null ? 3 : st.maxConcurrent)}" inputmode="numeric" autocomplete="off"></label>
            <label class="cd-opt"><input type="checkbox" data-sup="autoStart"${st.autoStart === false ? '' : ' checked'}><span>Start queued work automatically</span></label>
            <label class="cd-opt"><input type="checkbox" data-sup="manageLocks"${st.manageLocks ? ' checked' : ''}><span>Manage busy locks for agents</span></label>
            <label class="cd-opt"><input type="checkbox" data-sup="trackArtifacts"${st.trackArtifacts ? ' checked' : ''}><span>Track work folders and temp files</span></label>
            <label class="cd-opt"><input type="checkbox" data-sup="ruleCheck"${st.ruleCheck === false ? '' : ' checked'}><span>Check each finished turn's changed files against the rules (check scripts and a judgement call)</span></label>
            <label class="cd-opt"><input type="checkbox" data-sup="autoPauseOnCollision"${st.autoPauseOnCollision ? ' checked' : ''}><span>Pause the later agent when two collide on the same files</span></label>
            <label><span>Verify a restart wait after (minutes):</span><input type="text" data-sup="maxAskMinutes" value="${esc(st.maxAskMinutes == null ? '' : st.maxAskMinutes)}" inputmode="numeric" autocomplete="off" placeholder="Ask the Supervisor to verify a restart wait after N minutes"></label>
            <label class="cd-top"><span>Yozora repositories to watch:</span><textarea data-sup="yozoraRepos" rows="3" spellcheck="false" placeholder="owner/repo, one per line">${esc(Array.isArray(st.yozoraRepos) ? st.yozoraRepos.join('\n') : String(st.yozoraRepos || ''))}</textarea></label>
            <p class="mmc-hint">An open issue labelled fleet in these repositories joins the Work Queue by itself.</p>
            <h4 class="cd-sup-sub">Notifications to the phone</h4>
            ${notifyRows(st.notify)}
            <p class="mmc-hint">Off by default for anything new; routine alerts always go to the Supervisor.</p>
            <h4 class="cd-sup-sub">Models and effort</h4>
            <table class="cd-table cd-policy"><thead><tr><th>Job</th><th>Default</th><th>Maximum</th></tr></thead><tbody>${POLICY_JOBS.map(([job, label]) => {
                const r = (st.modelPolicy && st.modelPolicy[job]) || POLICY_FALLBACK[job];
                const sel = (field, list, cur) => `<select class="vdt-select" data-policy="${job}.${field}" aria-label="${esc(label)} ${field}">${list.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
                return `<tr><td>${esc(label)}</td><td>${sel('model', POLICY_MODELS, r.model)} ${sel('effort', POLICY_EFFORTS, r.effort)}</td><td>${sel('maxModel', POLICY_MODELS, r.maxModel)} ${sel('maxEffort', POLICY_EFFORTS, r.maxEffort)}</td></tr>`;
            }).join('')}</tbody></table>
            <p class="mmc-hint">The default is what the Supervisor starts a job with; the maximum is the most it may pick (the max row only on an explicit request). A default above its maximum is cut down on save.</p>
            <p class="cd-sup-actions"><button type="button" class="btn-standard primary" data-act="sup-save"${sup.busy ? ' disabled' : ''}>Save</button>${sup.draft ? ' <span class="mmc-hint">Not saved yet.</span>' : ''}</p>
        </div>`;
        const reviews = supReviews().filter((r) => !r.dismissed);
        const rows = reviews.map((r) => {
            const v = VERDICT[r.verdict] || [r.verdict || '', `${VI}/info-16.png`];
            return { key: `v:${r.id}`, icon: v[1], data: { title: r.title || shortId(r.sessionId), account: r.account || '', verdict: v[0], summary: `${r.summary || ''}${supViolations(r).length ? ` [${supViolations(r).length} rule violation${supViolations(r).length === 1 ? '' : 's'}]` : ''}`, at: r.at || 0 } };
        });
        const list = c.listView([
            { t: 'Session', w: 140, key: 'title', text: (d) => d.title },
            { t: 'Account', w: 70, key: 'account', text: (d) => d.account },
            { t: 'Verdict', w: 80, key: 'verdict', text: (d) => d.verdict },
            { t: 'Summary', w: 250, key: 'summary', text: (d) => d.summary },
            { t: 'When', w: 128, key: 'at', text: (d) => when(d.at), value: (d) => d.at }
        ], rows, { wrap: true, sortId: 'cd-sup', sort: { key: 'at', dir: -1 }, empty: sup.data && sup.data.settings && sup.data.settings.enabled ? 'No review yet. Each agent turn that ends is reviewed.' : 'The supervisor is off. Turn it on in Supervisor Settings to review finished agent turns.' });
        if (part === 'sup-reviews') {
            // Outlook's reading pane: the list on top, the selected review and its actions below, a divider between
            return {
                html: `<div class="cd-rv"><div class="cd-rv-top">${list}</div><div class="cd-rv-split" role="separator" aria-orientation="horizontal" title="Drag to resize"></div><div class="cd-rv-bot cd-sup-detail">${supDetailHtml()}</div></div>`,
                list: true,
                split: true,
                mount: (pane) => {
                    const box = pane.querySelector('.cd-rv');
                    const top = pane.querySelector('.cd-rv-top');
                    const bar = pane.querySelector('.cd-rv-split');
                    if (!box || !top || !bar) return;
                    if (S.rvH) top.style.flexBasis = `${S.rvH}px`;
                    bar.addEventListener('pointerdown', (ev) => {
                        ev.preventDefault();
                        bar.setPointerCapture(ev.pointerId);
                        const y0 = ev.clientY;
                        const h0 = top.getBoundingClientRect().height;
                        const room = box.getBoundingClientRect().height;
                        const move = (e) => { S.rvH = Math.round(Math.max(60, Math.min(room - 90, h0 + e.clientY - y0))); top.style.flexBasis = `${S.rvH}px`; };
                        const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); };
                        bar.addEventListener('pointermove', move);
                        bar.addEventListener('pointerup', up);
                        bar.addEventListener('pointercancel', up);
                    });
                }
            };
        }
        const locks = supLocks();
        const arts = supArtifacts();
        const lockRows = locks.map((l) => ({ key: `lk:${l.root || ''}|${l.file}`, icon: `${ITEMS}/bitlocker-drive-encryption-16.png`, cls: l.state === 'orphan' ? 'cd-stale' : '', data: { file: l.file, agent: l.agentName || l.agentId || '', state: LOCK_STATE[l.state] || l.state || '', by: PLANTED[l.plantedBy] || '', age: l.ageMinutes } }));
        const lockList = c.listView([
            { t: 'Lock', w: 170, key: 'file', text: (d) => d.file },
            { t: 'Agent', w: 130, key: 'agent', text: (d) => d.agent },
            { t: 'State', w: 70, key: 'state', text: (d) => d.state },
            { t: 'Planted By', w: 80, key: 'by', text: (d) => d.by },
            { t: 'Age', w: 70, key: 'age', num: true, text: (d) => (d.age == null ? '' : ageText(d.age)), value: (d) => d.age || 0 }
        ], lockRows, { sortId: 'cd-sup-locks', sort: { key: 'age', dir: -1 }, empty: 'No agent holds a busy lock.' });
        const artRows = arts.map((a) => ({ key: `ar:${a.id}`, icon: a.kind === 'file' ? `${VI}/explorer/file-16.png` : FOLDER16, cls: a.state === 'orphan' ? 'cd-stale' : '', data: { path: a.path, kind: ART_KIND[a.kind] || a.kind || '', who: a.agentName || shortId(a.sessionId), size: a.sizeBytes, age: a.ageHours, state: ART_STATE[a.state] || a.state || '', decision: a.decision ? `${ART_DECISION[a.decision] || a.decision}${a.decisionReason ? `: ${a.decisionReason}` : ''}` : '' } }));
        const artList = c.listView([
            { t: 'Path', w: 230, key: 'path', text: (d) => d.path },
            { t: 'Kind', w: 70, key: 'kind', text: (d) => d.kind },
            { t: 'Session', w: 110, key: 'who', text: (d) => d.who },
            { t: 'Size', w: 64, key: 'size', num: true, text: (d) => bytesText(d.size), value: (d) => d.size || 0 },
            { t: 'Age', w: 60, key: 'age', num: true, text: (d) => (d.age == null ? '' : ageText(Math.round(d.age * 60))), value: (d) => d.age || 0 },
            { t: 'State', w: 64, key: 'state', text: (d) => d.state },
            { t: 'Decision', w: 300, key: 'decision', text: (d) => d.decision }
        ], artRows, { sortId: 'cd-sup-arts', sort: { key: 'age', dir: -1 }, empty: st.trackArtifacts ? 'No work folder or temp file is tracked.' : 'Tracking is off. Tick "Track work folders and temp files" above.' });
        const total = stats.artifactBytes != null ? stats.artifactBytes : arts.reduce((n, a) => n + (a.sizeBytes || 0), 0);
        const side = sup.busy || sup.error || `${stats.reviewed || 0} reviewed, ${stats.gaps || 0} with gaps${stats.lastAt ? `, last ${when(stats.lastAt)}` : ''}`;
        const holds = supHolds();
        const holdRows = holds.map((h) => ({ key: `hd:${h.id}`, icon: '/static_images/vista-cmdbar/pause.png', data: { title: titleOf(rowOf(h.sessionId) || { id: h.sessionId }), mode: holdWord(h), reason: h.reason || '', kind: HOLD_KIND[h.kind] || h.kind || '', by: h.by || '', at: h.at || 0, paths: Array.isArray(h.paths) ? h.paths.join(', ') : '' } }));
        const holdList = c.listView([
            { t: 'Session', w: 170, key: 'title', text: (d) => d.title },
            { t: 'Mode', w: 60, key: 'mode', text: (d) => d.mode },
            { t: 'Reason', w: 220, key: 'reason', text: (d) => d.reason },
            { t: 'Why', w: 130, key: 'kind', text: (d) => d.kind },
            { t: 'By', w: 90, key: 'by', text: (d) => d.by },
            { t: 'Since', w: 128, key: 'at', text: (d) => when(d.at), value: (d) => Number(d.at) || Date.parse(d.at) || 0 },
            { t: 'Files', w: 200, key: 'paths', text: (d) => d.paths }
        ], holdRows, { sortId: 'cd-sup-holds', sort: { key: 'at', dir: -1 }, empty: 'No session is paused.' });
        const asks = supAsks();
        const askBody = asks.length ? asks.map((g) => `<div class="cd-infobar is-warning" role="alert"><img src="${VI}/warning-16.png" alt=""><span>${esc(askText(g))}</span></div>`).join('') : '';
        const html = c.page(SUP_TITLE[part], side, [
            asks.length || part === 'sup-asks' ? { id: 'cd-sup-asks', title: `Restart waits (${asks.length})`, body: `${askBody || '<p>No agent is waiting to restart Dreamscape.</p>'}<p class="mmc-hint">An agent asked to restart Dreamscape and waits for the others to be idle. The Supervisor checks the wait after the time set below.</p>` } : null,
            { id: 'cd-sup-tiles', title: 'Dashboard', body: supDashTiles(st, reviews, asks, holds, locks, arts, total) },
            { id: 'cd-sup-recent', title: 'Latest reviews with gaps', body: supGapTable(reviews) },
            { id: 'cd-sup-set', title: 'Settings', body: form },
            { id: 'cd-sup-holds', title: `Paused sessions (${holds.length})`, body: `<div class="cd-sup-list">${holdList}</div><p class="cd-sup-actions"><button type="button" class="btn-standard" data-act="sup-resume"${sup.busy ? ' disabled' : ''}>Resume</button> <span class="mmc-hint">Resumes the selected session.</span></p>` },
            { id: 'cd-sup-list', title: `Reviews (${reviews.length})`, body: `<div class="cd-sup-list">${list}</div>` },
            { id: 'cd-sup-detail', title: 'Selected Review', body: `<div class="cd-sup-detail">${supDetailHtml()}</div>` },
            { id: 'cd-sup-locks', title: `Locks (${locks.length})`, body: `<div class="cd-sup-list">${lockList}</div><p class="cd-sup-actions"><button type="button" class="btn-standard" data-act="sup-lock-remove"${sup.busy ? ' disabled' : ''}>Remove</button> <span class="mmc-hint">Removes the selected lock when its agent is gone (an orphan).</span></p>` },
            { id: 'cd-sup-arts', title: `Work folders and temp files (${arts.length})`, body: `<div class="cd-sup-list">${artList}</div><p class="mmc-hint">${arts.length ? `${esc(bytesText(total))} in all.` : ''}</p><p class="cd-sup-actions"><button type="button" class="btn-standard" data-act="sup-art-clean"${sup.busy ? ' disabled' : ''}>Clean</button> <button type="button" class="btn-standard" data-act="sup-art-forget"${sup.busy ? ' disabled' : ''}>Forget</button> <span class="mmc-hint">Clean deletes it from disk; Forget only stops tracking it.</span></p>` }
        ].filter((x) => x && SUP_PART[part].includes(x.id)));
        return {
            html,
            mount: (pane) => {
                const read = (ev) => {
                    const pol = ev.target.closest('[data-policy]');
                    if (pol) {
                        const dp = S.sup.draft || Object.assign({}, SUP_DEFAULT, (S.sup.data && S.sup.data.settings) || {});
                        const [job, field] = pol.dataset.policy.split('.');
                        const cur = JSON.parse(JSON.stringify(dp.modelPolicy || (S.sup.data && S.sup.data.settings && S.sup.data.settings.modelPolicy) || POLICY_FALLBACK));
                        cur[job] = Object.assign({}, POLICY_FALLBACK[job], cur[job], { [field]: pol.value });
                        dp.modelPolicy = cur;
                        S.sup.draft = dp;
                        const hint = pane.querySelector('.cd-sup-form .cd-sup-actions');
                        if (hint && !hint.querySelector('.mmc-hint')) hint.insertAdjacentHTML('beforeend', ' <span class="mmc-hint">Not saved yet.</span>');
                        return;
                    }
                    const el = ev.target.closest('[data-sup]');
                    if (!el) return;
                    const d = S.sup.draft || Object.assign({}, SUP_DEFAULT, (S.sup.data && S.sup.data.settings) || {});
                    const key = el.dataset.sup;
                    if (key === 'model' && el.value === '__other') {
                        const row = pane.querySelector('[data-sup-other]');
                        if (row) { row.hidden = false; const t = row.querySelector('input'); if (t) t.focus(); }
                        return;
                    }
                    if (key.startsWith('notify.')) d.notify = Object.assign({}, d.notify, { [key.slice(7)]: el.checked });
                    else d[key === 'modelOther' ? 'model' : key] = el.type === 'checkbox' ? el.checked : el.value;
                    S.sup.draft = d;
                    if (key === 'engine') {
                        // the model list follows the engine
                        d.model = '';
                        const m = pane.querySelector('select[data-sup="model"]');
                        if (m) m.innerHTML = supModelOptions(el.value, '');
                        d.effort = '';
                        const ef = pane.querySelector('select[data-sup="effort"]');
                        if (ef) ef.innerHTML = supEffortOptions(el.value, '');
                        const row = pane.querySelector('[data-sup-other]');
                        if (row) row.hidden = true;
                    }
                    const note = pane.querySelector('.cd-sup-form .cd-sup-actions');
                    if (note && !note.querySelector('.mmc-hint')) note.insertAdjacentHTML('beforeend', ' <span class="mmc-hint">Not saved yet.</span>');
                };
                pane.addEventListener('input', read);
                pane.addEventListener('change', read);
            }
        };
    }
    // ---- Maintenance (Fleet > Supervisor > Maintenance; claude_desk_supervisor maintenance_*) -------------------
    // The daily run's checks, what each did and found, the past runs and the settings. Run Now answers at once; the
    // result and the progress arrive through the supervisor status push (no polling).
    const maintData = () => (S.sup.data && S.sup.data.maintenance) || null;
    const maintUi = () => (S.maint || (S.maint = { sel: '', viewId: null, view: null, draft: null, busy: false }));
    const MAINT_STATE = { ok: ['OK', `${VI}/check-16.png`], warn: ['Needs a look', `${VI}/warning-16.png`], fail: ['Failed', `${VI}/error-16.png`], skipped: ['Skipped', `${VI}/info-16.png`] };
    const MAINT_TRIGGER = { daily: 'Daily', manual: 'By hand', 'catch-up': 'Catch-up' };
    function maintReport() {
        const u = maintUi();
        const d = maintData();
        return u.viewId && u.view && String(u.view.id) === String(u.viewId) ? u.view : ((d && d.last) || null);
    }
    function maintTake(r) {
        if (r && r.maintenance) S.sup.data = Object.assign({}, S.sup.data || {}, { maintenance: r.maintenance });
        if (r && r.report) { const u = maintUi(); u.view = r.report; u.viewId = r.report.id; }
    }
    function maintDetailHtml(c) {
        const r = maintReport();
        const ck = r && (r.checks || []).find((x) => x.id === maintUi().sel);
        if (!ck) return '<p class="mmc-hint">Select a check above to see what it did and what it found.</p>';
        const rows = []
            .concat((ck.actions || []).map((t, i) => ({ key: `ma:${i}`, icon: `${VI}/check-16.png`, data: { kind: 'Did', text: t } })))
            .concat((ck.findings || []).map((f, i) => ({ key: `mf:${i}`, icon: f.level === 'warn' ? `${VI}/warning-16.png` : `${VI}/info-16.png`, data: { kind: f.level === 'warn' ? 'Needs a look' : 'Found', text: f.text } })));
        const lv = (c || S.c).listView([
            { t: 'What', w: 90, key: 'kind', text: (d) => d.kind },
            { t: 'Detail', w: 640, key: 'text', text: (d) => d.text }
        ], rows, { wrap: true, sortId: 'cd-maint-items', empty: 'This check did nothing and found nothing to report.', fit: true });
        return `<p><b>${esc(ck.title)}</b>: ${esc(ck.summary || '')}</p>${lv}`;
    }
    function maintSelect(key) {
        const u = maintUi();
        if (key.startsWith('mc:')) {
            u.sel = key.slice(3);
            const box = S.c && S.c.modal.querySelector('.cd-maint-detail');
            if (box) box.innerHTML = maintDetailHtml(S.c);
        } else if (key.startsWith('mh:')) {
            const id = key.slice(3);
            if (String(u.viewId) === id) return;
            u.viewId = id;
            void send('claude_desk_supervisor', { action: 'maintenance_status', runId: Number(id) }).then((r) => { maintTake(unwrap(r, 'maintenance')); repaint(); }).catch(() => {});
        }
    }
    function maintenancePage(c) {
        const sup = S.sup;
        const T = 'Maintenance';
        if (!sup.loaded) { void loadSupervisor(); return c.page(T, '', [{ id: 'cd-mt-wait', title: T, body: '<p class="mmc-hint">Reading the maintenance report...</p>' }]); }
        if (sup.stale && !sup.loading) { sup.stale = false; void loadSupervisor(); }
        const d = maintData();
        if (sup.unavailable || !d) return c.page(T, '', [{ id: 'cd-mt-gone', title: T, body: `<p>${NOT_YET}</p>` }]);
        const u = maintUi();
        const st = u.draft || Object.assign({}, d.settings, { checks: Object.assign({}, d.settings.checks) });
        const run = d.running;
        const r = maintReport();
        const prog = run ? `${esc(run.current ? ((d.checks.find((x) => x.id === run.current) || {}).title || run.current) : 'Starting')} (${run.done.length} of ${run.total} done)${run.dryRun ? ', dry run' : ''}` : '';
        const status = run ? `Running: ${prog}` : (d.settings.enabled ? `Next run ${esc(when(d.nextAt))}` : 'The daily run is off');
        const bar = `<div class="cd-actbar" role="toolbar" aria-label="Maintenance"><span>${status}</span><button type="button" class="btn-standard primary" data-act="maint-run"${run || u.busy ? ' disabled' : ''}>Run Now</button><button type="button" class="btn-standard" data-act="maint-dry"${run || u.busy ? ' disabled' : ''}>Dry Run</button></div>`;
        const rows = ((r && r.checks) || []).map((x) => { const s = MAINT_STATE[x.state] || MAINT_STATE.ok; return { key: `mc:${x.id}`, icon: s[1], cls: x.state === 'fail' ? 'cd-stale' : '', data: { title: x.title, state: s[0], summary: x.summary || '' } }; });
        const list = c.listView([
            { t: 'Check', w: 190, key: 'title', text: (x) => x.title },
            { t: 'State', w: 90, key: 'state', text: (x) => x.state },
            { t: 'Summary', w: 460, key: 'summary', text: (x) => x.summary }
        ], rows, { wrap: true, sortId: 'cd-maint', empty: 'No run yet. Use Run Now, or wait for the daily run.', fit: true });
        const head = r ? `<p class="mmc-hint">${esc(when(r.startedAt))}, ${esc(MAINT_TRIGGER[r.trigger] || r.trigger || '')}${r.dryRun ? ', dry run (nothing was changed)' : ''}: ${esc(r.summary || '')}</p>` : '';
        const hrows = (d.history || []).map((h) => ({ key: `mh:${h.id}`, icon: (MAINT_STATE[h.state] || MAINT_STATE.ok)[1], data: { at: h.startedAt, state: (MAINT_STATE[h.state] || MAINT_STATE.ok)[0], how: `${MAINT_TRIGGER[h.trigger] || h.trigger || ''}${h.dryRun ? ' (dry)' : ''}`, summary: h.summary || '' } }));
        const hist = c.listView([
            { t: 'Started', w: 128, key: 'at', text: (x) => when(x.at), value: (x) => x.at },
            { t: 'State', w: 90, key: 'state', text: (x) => x.state },
            { t: 'How', w: 90, key: 'how', text: (x) => x.how },
            { t: 'Summary', w: 380, key: 'summary', text: (x) => x.summary }
        ], hrows, { wrap: true, sortId: 'cd-maint-hist', sort: { key: 'at', dir: -1 }, empty: 'No run is stored yet (30 days are kept).' });
        const form = `<div class="cd-sup-form">
            <label class="cd-opt"><input type="checkbox" data-maint="enabled"${st.enabled ? ' checked' : ''}><span>Run every day</span></label>
            <label><span>Time (server clock, HH:MM):</span><input type="text" data-maint="time" value="${esc(st.time)}" autocomplete="off" spellcheck="false"></label>
            <label class="cd-opt"><input type="checkbox" data-maint="dryRun"${st.dryRun ? ' checked' : ''}><span>Dry run: report what would be done, change nothing</span></label>
            <label class="cd-opt"><input type="checkbox" data-maint="deleteRemoteBranches"${st.deleteRemoteBranches ? ' checked' : ''}><span>Delete merged remote branches older than ${esc(st.remoteBranchDays == null ? 14 : st.remoteBranchDays)} days on Yozora (otherwise only listed)</span></label>
            ${(d.checks || []).map((x) => `<label class="cd-opt"><input type="checkbox" data-maint="check:${esc(x.id)}"${st.checks[x.id] === false ? '' : ' checked'}><span>${esc(x.title)}</span></label>`).join('')}
            <p class="cd-sup-actions"><button type="button" class="btn-standard primary" data-act="maint-save"${u.busy ? ' disabled' : ''}>Save</button>${u.draft ? ' <span class="mmc-hint">Not saved yet.</span>' : ''}</p>
        </div>`;
        const html = c.page(T, run ? prog : (r ? `Last run ${when(r.startedAt)}` : ''), [
            { id: 'cd-mt-bar', title: 'Run', body: `${bar}${head}` },
            { id: 'cd-mt-list', title: 'Report', body: `<div class="cd-sup-list">${list}</div>` },
            { id: 'cd-mt-detail', title: 'Selected Check', body: `<div class="cd-maint-detail">${maintDetailHtml(c)}</div>` },
            { id: 'cd-mt-hist', title: `Past runs (${hrows.length})`, body: `<div class="cd-sup-list">${hist}</div><p class="mmc-hint">Select a past run to read its report above.</p>` },
            { id: 'cd-mt-set', title: 'Settings', body: form }
        ]);
        return {
            html,
            mount: (pane) => {
                const read = (ev) => {
                    const el = ev.target.closest('[data-maint]');
                    if (!el) return;
                    const dr = maintUi().draft || Object.assign({}, d.settings, { checks: Object.assign({}, d.settings.checks) });
                    const key = el.dataset.maint;
                    const val = el.type === 'checkbox' ? el.checked : el.value;
                    if (key.startsWith('check:')) dr.checks[key.slice(6)] = !!val; else dr[key] = val;
                    maintUi().draft = dr;
                    const note = pane.querySelector('.cd-sup-form .cd-sup-actions');
                    if (note && !note.querySelector('.mmc-hint')) note.insertAdjacentHTML('beforeend', ' <span class="mmc-hint">Not saved yet.</span>');
                };
                pane.addEventListener('input', read);
                pane.addEventListener('change', read);
            }
        };
    }
    async function maintAct(c, payload, busy) {
        const u = maintUi();
        u.busy = true;
        c.note(busy);
        repaint();
        try { maintTake(unwrap(await send('claude_desk_supervisor', payload), 'maintenance')); if (payload.action === 'maintenance_save') u.draft = null; } catch (e) { await failBox(c, e); }
        u.busy = false;
        c.note('');
        repaint();
    }
    const WORK_STARTABLE = new Set(['held', 'queued', 'failed', 'cancelled']);
    const WORK_HOLDABLE = new Set(['queued', 'failed', 'cancelled']);
    /** The requests picked in the list that are still in the queue (ids as strings). */
    const wsel = () => Array.from(S.wsel).filter((id) => workOf(id)).map(String);
    function workMultiItems() {
        const ws = wsel().map(workOf);
        const busy = !!S.sup.busy;
        const start = !ws.some((w) => WORK_STARTABLE.has(w.state)) || busy;
        return [
            { separator: true },
            { text: 'Start Selected', action: 'work-start-sel', disabled: start },
            { text: 'Queue Selected', action: 'work-queue-sel', disabled: start },
            { text: 'Move to Waiting', action: 'work-hold-sel', disabled: !ws.some((w) => WORK_HOLDABLE.has(w.state)) || busy },
            { text: 'Queue as One Run...', action: 'work-merge', disabled: ws.length < 2 || !ws.every((w) => WORK_STARTABLE.has(w.state)) || busy },
            { text: 'Cancel Selected...', action: 'work-cancel-sel', disabled: !ws.length || busy }
        ];
    }
    const workPicked = (c) => { const ids = wsel(); if (ids.length) return ids; const one = workSel(c); return one ? [one] : []; };

    /** The reading pane's divider (Reviews, the Work Queue): drag to give the list or the detail more room; the height is kept. */
    function splitDrag(pane) {
        const box = pane.querySelector('.cd-rv');
        const top = pane.querySelector('.cd-rv-top');
        const bar = pane.querySelector('.cd-rv-split');
        if (!box || !top || !bar) return;
        if (S.rvH) top.style.flexBasis = `${S.rvH}px`;
        bar.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            bar.setPointerCapture(ev.pointerId);
            const y0 = ev.clientY;
            const h0 = top.getBoundingClientRect().height;
            const room = box.getBoundingClientRect().height;
            const move = (e) => { S.rvH = Math.round(Math.max(60, Math.min(room - 90, h0 + e.clientY - y0))); top.style.flexBasis = `${S.rvH}px`; };
            const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); };
            bar.addEventListener('pointermove', move);
            bar.addEventListener('pointerup', up);
            bar.addEventListener('pointercancel', up);
        });
    }

    /** The plan of a request that runs: the newest long answer of its session (a planner writes its plan there), read once per session turn. */
    const plans = new Map();
    async function loadPlan(sid) {
        const have = plans.get(sid);
        if (have && (have.loading || Date.now() - have.at < 60000)) return;
        plans.set(sid, Object.assign({}, have || {}, { loading: true }));
        try {
            const r = await send('claude_desk_transcript', { id: sid, limit: 40 });
            const said = (Array.isArray(r.messages) ? r.messages : []).filter((m) => m.role === 'assistant' && !m.sidechain && String(m.text || '').length > 0);
            const long = said.filter((m) => String(m.text).length >= 400);
            const pick = (long.length ? long : said).slice(-1)[0];
            plans.set(sid, { at: Date.now(), text: pick ? String(pick.text) : '', time: pick ? pick.time : null });
        } catch (e) { plans.set(sid, { at: Date.now(), text: '', error: errText(e) }); }
        workDetailPaint(S.c);
    }

    /** The picked request in the Work Queue's reading pane: what was asked (the brief), how it runs, its parts and its plan. */
    const CHECK_TEXT = { valid: 'Valid', done: 'Done already', outdated: 'Outdated', duplicate: 'Duplicate', unclear: 'Unclear' };
    /** The Supervisor's maintenance check of a Waiting item: verdict, evidence and, for an outdated one, the suggested brief. */
    function workCheckHtml(w) {
        const k = w.check;
        if (!k || !k.verdict) return '';
        return `<h4>Supervisor's check</h4><p><b>${esc(CHECK_TEXT[k.verdict] || k.verdict)}</b>${k.duplicateOf ? ` of ${esc(k.duplicateOf)}` : ''}${k.at ? ` <span class="mmc-hint">(${esc(when(k.at))})</span>` : ''}</p>${k.evidence ? `<div class="cd-read">${esc(k.evidence)}</div>` : ''}${k.suggestedBrief ? `<p class="mmc-hint">Suggested brief:</p><div class="cd-read">${esc(k.suggestedBrief)}</div><p><button type="button" class="btn-standard" data-act="work-use-brief" data-arg="${esc(w.id)}">Use Suggested Brief</button></p>` : ''}`;
    }
    function workDetailHtml(c, idIn) {
        const ids = wsel();
        const id = idIn || (ids.length === 1 ? ids[0] : (c && c.sel && c.sel.startsWith('w:') ? c.sel.slice(2) : ''));
        if (ids.length > 1 && !idIn) return `<p class="mmc-hint">${ids.length} requests picked. Pick one to read its brief and plan.</p>`;
        const w = id ? workOf(id) : null;
        if (!w) return '<p class="mmc-hint">Select a request to read its brief, how it will run and its plan.</p>';
        const st = w.stages || {};
        const stageText = (x) => (x ? [x.engine && x.engine !== 'claude' ? engineName(x.engine) : '', x.model, x.effort].filter(Boolean).join(' / ') : '');
        const parts = supWork().filter((x) => String(x.parentId) === String(w.id));
        const links = [`<button type="button" class="btn-standard" data-act="work-ask" data-arg="${esc(w.id)}">Ask Yozora...</button>`, w.sessionId ? `<span class="mmc-link" data-act="work-open" data-arg="${esc(w.id)}">Open session</span>` : '', w.issue && w.issue.url ? '<span class="mmc-link" data-act="work-issue">Open issue</span>' : ''].filter(Boolean).join(' &nbsp; ');
        let plan;
        if (!w.sessionId) plan = `<p class="mmc-hint">${w.topology === 'planner' || !w.topology ? 'The planner writes its plan when the request starts; until then the brief above is the plan.' : 'It has not started yet: the brief above is what the session will get.'}</p>`;
        else {
            const p = plans.get(w.sessionId);
            if (!p || (!p.at && p.loading)) { void loadPlan(w.sessionId); plan = '<p class="mmc-hint">Reading the session...</p>'; }
            else {
                if (Date.now() - p.at > 60000) void loadPlan(w.sessionId);
                plan = p.error ? `<p class="mmc-hint">${esc(p.error)}</p>` : (p.text ? `<p class="mmc-hint">The session's latest answer${p.time ? ` (${esc(timeOnly(p.time))})` : ''}:</p><div class="cd-read">${esc(p.text)}</div>` : '<p class="mmc-hint">The session has not answered yet.</p>');
            }
        }
        return `<div class="cd-wd"><h3>${esc(w.title || String(w.id))}</h3>${(c || S.c).props([
            ['State', esc(workState(w))],
            ['Shape', esc(isGroups(w) ? 'Supervisor -> a Claude planner per group of related issues' : ((TOPO.find((x) => x[0] === w.topology) || [])[1] || ''))],
            ['Planner stage', esc(stageText(st.planner))],
            ['Workers stage', esc(stageText(st.workers) || [w.model, w.effort].filter(Boolean).join(' / '))],
            ['Account', esc(w.account && w.account.name ? w.account.name : (w.account == null ? '' : String(w.account)))],
            ['Folder', esc(w.cwd || '')],
            [issuesOf(w).length > 1 ? 'Issues' : 'Issue', issueLinks(w)],
            ['Remote Control', w.remoteControl ? 'On' : 'Off'],
            w.joinedInto ? ['Joined into', `<span class="mmc-link" data-act="work-goto" data-arg="${esc(w.joinedInto)}">Item ${esc(w.joinedInto)}</span> (one run)`] : null,
            ['Queued', esc(when(w.createdAt))],
            ['Note', esc([w.message, w.issueNote].filter(Boolean).join(' - '))]
        ].filter(Boolean))}${links ? `<p>${links}</p>` : ''}
            ${workCheckHtml(w)}<h4>Brief</h4><div class="cd-read">${esc(w.prompt || '')}</div>
            ${parts.length ? `<h4>${isGroups(w) ? 'Planners' : 'Parts'} (${parts.length})</h4><table class="cd-table"><thead><tr><th>${isGroups(w) ? 'Planner' : 'Part'}</th><th class="cd-w80">State</th></tr></thead><tbody>${parts.map((x) => `<tr><td>${esc(x.title || x.id)}</td><td>${esc(workState(x))}</td></tr>`).join('')}</tbody></table>` : ''}
            <h4>Plan</h4>${plan}</div>`;
    }
    function workDetailPaint(c, id) {
        const box = c && c.modal && c.modal.querySelector('.cd-work-detail');
        if (box) { const top = box.scrollTop; box.innerHTML = workDetailHtml(c, id); box.scrollTop = id ? 0 : top; }
    }

    /** No Manager Session yet: pick a running session for it, or start one. */
    function managerPage(c) {
        const live = S.live.map((l) => ({ id: l.id, title: titleOf(rowOf(l.id) || { id: l.id, title: l.name }) }));
        const opts = live.map((x) => `<option value="${esc(x.id)}">${esc(x.title)} (${esc(shortId(x.id))})</option>`).join('');
        return c.page('Manager Session', '', [{ id: 'cd-mg', title: 'Manager Session', body: `<p>The Manager Session is the session you keep for fixing Fleet and the Supervisor themselves: bugs you find in Fleet, Supervisor reviews that went wrong, maintenance findings. It stays pinned here under Supervisor.</p>
            <p><label>Use a running session: <select class="vdt-select" data-cd-mg>${opts || '<option value="">No session is running</option>'}</select></label> <button type="button" class="btn-standard" data-act="mg-use"${opts ? '' : ' disabled'}>Use This Session</button></p>
            <p><button type="button" class="btn-standard primary" data-act="mg-start">Start a New Manager Session...</button> <span class="mmc-hint">Opus, high effort, in the Dreamscape folder, with a brief for this job.</span></p>` }]);
    }
    const MANAGER_BRIEF = 'You are the Manager Session for Fleet (apps/claudedesk, the Supervisor in modules/agentSupervisor.js, agent-coord, the maintenance in modules/fleetMaintenance.js) in /home/kanmi/staticforge. Yukimi uses you to fix issues and bugs in the Fleet / Supervisor system itself as she finds them. Read CLAUDE.md first. Delegate defined parts to Sonnet background agents, check every change on screen or with tests, commit and push each turn, restart only through scripts/restart-dreamscape.sh. Wait for her first request.';

    /** Input Required: work that stopped on a question; each question with the Supervisor's proposed answer (if any) and a field for Yukimi's. */
    function inputPage(c) {
        const T = 'Input Required';
        if (!S.sup.loaded) { void loadSupervisor(); return c.page(T, '', [{ id: 'cd-in-wait', title: T, body: '<p class="mmc-hint">Reading the work queue...</p>' }]); }
        if (S.sup.stale) { S.sup.stale = false; void loadSupervisor(); }
        if (S.sup.unavailable) return c.page(T, '', [{ id: 'cd-in-gone', title: T, body: `<p>${NOT_YET}</p>` }]);
        const drafts = S.inDraft || (S.inDraft = {});
        const items = inputItems();
        const block = (w) => {
            const qs = Array.isArray(w.questions) ? w.questions : [];
            const asked = qs.some((q) => q.ask);
            const rows = qs.map((q, i) => {
                const d = drafts[w.id] && drafts[w.id][i] != null ? drafts[w.id][i] : '';
                return `<div class="cd-in-q"><p class="cd-cut" title="${esc(q.question)}"><img class="mmc-row-icon" src="${esc(QUESTION16)}" alt=""><b>${esc(q.question)}</b></p>
                    ${q.answer ? `<p class="mmc-hint cd-cut" title="${esc(q.answer)}">The Supervisor's proposed answer: ${esc(q.answer)}${q.why ? ` (${esc(q.why)})` : ''}</p>` : (q.ask ? `<p class="mmc-hint">${esc(q.why || 'Open as a request form: answer it there')}</p>` : `<p class="mmc-hint">Only you can decide this.${q.why ? ` ${esc(q.why)}` : ''}</p>`)}
                    ${q.ask ? '' : `<textarea class="cd-answer" data-in-a="${esc(w.id)}:${i}" rows="2" spellcheck="true" placeholder="${q.answer ? 'Leave empty to send the Supervisor\'s answer' : 'Your answer'}" aria-label="Your answer to question ${i + 1}">${esc(d)}</textarea>`}</div>`;
            }).join('');
            return `<div class="cd-in-item"><h4 class="cd-cut" title="${esc(w.title || String(w.id))}">${esc(w.title || String(w.id))}</h4>
                <p class="mmc-hint">${issuesOf(w).length ? `Issue ${issueLinks(w)} - ` : ''}${w.sessionId ? `<span class="mmc-link" data-act="work-open" data-arg="${esc(w.id)}">Open Session</span>` : ''}</p>
                ${rows || `<p class="mmc-hint">${esc(w.message || '')}</p>`}
                <p class="cd-sup-actions"><button type="button" class="btn-standard primary" data-act="work-answer" data-arg="${esc(w.id)}"${asked || !qs.length || S.sup.busy ? ' disabled' : ''}>Send Answers</button></p></div>`;
        };
        const html = c.page(T, '', [{ id: 'cd-in', title: `${T} (${items.length})`, body: items.length ? items.map(block).join('') : '<p class="mmc-hint">Nothing needs your input. Work that stops on a question only you can answer waits here.</p>' }]);
        return {
            html,
            mount: (pane) => {
                pane.addEventListener('input', (ev) => {
                    const t = ev.target.closest('[data-in-a]');
                    if (!t) return;
                    const [id, i] = t.dataset.inA.split(':');
                    (drafts[id] || (drafts[id] = []))[Number(i)] = t.value;
                });
            }
        };
    }

    function workPage(c, scope = 'all') {
        const T = { all: 'Work Queue', held: 'Waiting', active: 'Active', pending: 'Pending', done: 'Completed' }[scope];
        if (S.wscope !== scope) { S.wscope = scope; S.wsel = new Set(); }
        if (!S.sup.loaded) { void loadSupervisor(); return c.page(T, '', [{ id: 'cd-wq-wait', title: T, body: '<p class="mmc-hint">Reading the work queue...</p>' }]); }
        if (S.sup.stale) { S.sup.stale = false; void loadSupervisor(); }
        if (S.sup.unavailable) return c.page(T, '', [{ id: 'cd-wq-gone', title: T, body: `<p>${NOT_YET}</p>` }]);
        const rows = WORK_SCOPE[scope]().map((w) => ({
            key: `w:${w.id}`,
            icon: w.sessionId && holdOf(w.sessionId) ? PAUSE16 : workIcon(w.state),
            cls: w.state === 'running' || w.state === 'starting' ? 'cd-live' : (w.state === 'failed' ? 'cd-stale' : ''),
            data: { id: w.id, title: w.title || String(w.id), state: workState(w), shape: shapeText(w), source: WORK_SOURCE[w.source] || w.source || '', account: w.account && w.account.name ? w.account.name : (w.account == null ? '' : String(w.account)), model: [w.engine && w.engine !== 'claude' ? engineName(w.engine) : '', w.model, w.effort].filter(Boolean).join(' / '), session: w.sessionId ? shortId(w.sessionId) : '', issue: issueText(w), check: w.check && w.check.verdict ? CHECK_TEXT[w.check.verdict] || w.check.verdict : '', at: w.createdAt || 0, message: [w.message, w.issueNote].filter(Boolean).join(' - ') }
        }));
        const lv = c.listView([
            { t: 'Request', w: 260, key: 'title', text: (d) => d.title, html: (d) => `<input type="checkbox" class="cd-wck" tabindex="-1" aria-label="Pick this request"${S.wsel.has(String(d.id)) ? ' checked' : ''}><i>${esc(d.title)}</i>` },
            { t: 'State', w: 76, key: 'state', text: (d) => d.state },
            { t: 'Shape / Parts', w: 170, key: 'shape', text: (d) => d.shape },
            { t: 'From', w: 66, key: 'source', text: (d) => d.source },
            { t: 'Account', w: 90, key: 'account', text: (d) => d.account },
            { t: 'Engine / Model / Effort', w: 150, key: 'model', text: (d) => d.model },
            { t: 'Session', w: 70, key: 'session', text: (d) => d.session },
            { t: 'Issue', w: 110, key: 'issue', text: (d) => d.issue },
            { t: 'Check', w: 80, key: 'check', text: (d) => d.check },
            { t: 'Queued', w: 128, key: 'at', text: (d) => when(d.at), value: (d) => Number(d.at) || Date.parse(d.at) || 0 },
            { t: 'Note', w: 220, key: 'message', text: (d) => d.message }
        ], rows, { wrap: true, sortId: `cd-work-${scope}`, sort: { key: 'at', dir: -1 }, empty: scope === 'held' ? 'Nothing is waiting for you. A new or imported request waits here until you start it.' : scope === 'active' ? 'No work item is running.' : scope === 'pending' ? 'No work item is waiting.' : 'The queue is empty. A request from New Session..., Plaud or an agent waits here until an account has room.', fit: true });
        let off = null;
        return {
            // Outlook's reading pane, as Reviews: the list on top, the picked request's brief and plan below
            html: `<div class="cd-rv"><div class="cd-rv-top">${lv}</div><div class="cd-rv-split" role="separator" aria-orientation="horizontal" title="Drag to resize"></div><div class="cd-rv-bot cd-work-detail">${workDetailHtml(c)}</div></div>`,
            list: true,
            split: true,
            mount: (pane) => {
                splitDrag(pane);
                let anchor = '';
                const rows = () => Array.from(pane.querySelectorAll('.mmc-row[data-key^="w:"]'));
                const paint = () => rows().forEach((r) => {
                    const on = S.wsel.has(r.dataset.key.slice(2));
                    r.classList.toggle('is-selected', S.wsel.size ? on : c.sel === r.dataset.key);
                    const ck = r.querySelector('.cd-wck');
                    if (ck) ck.checked = on;
                });
                const refresh = () => { paint(); c.renderActions(); c.renderStatus(); workDetailPaint(c); };
                const onClick = (ev) => {
                    const row = ev.target.closest('.mmc-row[data-key^="w:"]');
                    if (!row) return;
                    const key = row.dataset.key;
                    const id = key.slice(2);
                    if (ev.shiftKey && anchor) {
                        const all = rows().map((r) => r.dataset.key.slice(2));
                        const a = all.indexOf(anchor);
                        const b = all.indexOf(id);
                        const span = all.slice(Math.min(a, b), Math.max(a, b) + 1);
                        S.wsel = new Set(ev.ctrlKey || ev.metaKey ? Array.from(S.wsel).concat(span) : span);
                    } else if (ev.ctrlKey || ev.metaKey || ev.target.closest('.cd-wck')) {
                        const next = new Set(S.wsel);
                        if (!next.size && c.sel && c.sel.startsWith('w:') && c.sel !== key) next.add(c.sel.slice(2));
                        if (next.has(id)) next.delete(id); else next.add(id);
                        S.wsel = next;
                        anchor = id;
                    } else {
                        S.wsel = new Set([id]);
                        anchor = id;
                        setTimeout(() => { paint(); workDetailPaint(c, id); }, 0);
                        return;
                    }
                    ev.stopPropagation();
                    ev.preventDefault();
                    c.selectRow(key);
                    refresh();
                };
                const onKey = (ev) => {
                    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'a' || ev.key === 'A') && ev.target.classList && ev.target.classList.contains('mmc-list')) {
                        ev.preventDefault();
                        S.wsel = new Set(rows().map((r) => r.dataset.key.slice(2)));
                        refresh();
                    }
                };
                pane.addEventListener('click', onClick, true);
                pane.addEventListener('keydown', onKey);
                off = () => { pane.removeEventListener('click', onClick, true); pane.removeEventListener('keydown', onKey); };
                paint();
            },
            unmount: () => { if (off) off(); off = null; }
        };
    }

    const askText = (g) => { const a = agentOf(g.agentId); return `Restart waiting on ${a ? (a.name || a.id) : (g.agentId || 'an agent')}${g.text ? `: ${String(g.text).replace(/\s+/g, ' ').slice(0, 160)}` : ''}${g.firstAt ? ` (since ${timeOnly(g.firstAt)})` : ''}${g.stale ? ' - it looks stuck' : ''}`; };

    /** The running sessions no work item owns, as the Sessions list shows them. */
    function unsupervisedPage(c, quiet) {
        if (!S.sessionsLoaded && !S.sessionsLoading) void loadSessions(false);
        const list = (quiet ? unsupervisedQuiet() : unsupervisedActive()).map((l) => rowOf(l.id) || { id: l.id, title: l.name, folder: l.cwd ? l.cwd.split('/').pop() : '', lastActivity: l.startedAt ? new Date(l.startedAt).toISOString() : '', messages: 0 });
        return { html: c.listView(SESSION_COLS, sessionRows(list), { sortId: 'cd-unsup', sort: { key: 'last', dir: -1 }, empty: 'Every running session belongs to a work item, or none is running.' }), list: true };
    }

    /** One work item: what was asked, how it is arranged, its parts, where it runs. */
    function workItemPage(c, id) {
        const w = workOf(id);
        if (!w) return c.page('Work Item', '', [{ id: 'cd-wi-gone', title: 'Work Item', body: '<p class="mmc-hint">This item is no longer in the queue.</p>' }]);
        const parts = supWork().filter((x) => String(x.parentId) === String(w.id));
        const h = w.sessionId ? holdOf(w.sessionId) : null;
        const st = w.stages || {};
        const stageText = (x) => (x ? [x.engine && x.engine !== 'claude' ? engineName(x.engine) : '', x.model, x.effort].filter(Boolean).join(' / ') : '');
        const links = [w.sessionId ? `<span class="mmc-link" data-act="work-open" data-arg="${esc(w.id)}">Open session</span>` : '', w.issue && w.issue.url ? '<span class="mmc-link" data-act="work-issue">Open issue</span>' : ''].filter(Boolean).join(' &nbsp; ');
        return c.page(w.title || String(w.id), workState(w), [
            { id: 'cd-wi-map', title: 'Workflow', body: wmHtml(w.id) },
            h ? { id: 'cd-wi-hold', title: holdWord(h), body: `<p>${esc(holdLine(h))}</p><p class="mmc-hint">${esc([HOLD_KIND[h.kind] || h.kind, h.by ? `by ${h.by}` : '', when(h.at)].filter(Boolean).join(' - '))}</p><p><span class="mmc-link" data-act="resume-hold" data-arg="${esc(w.sessionId)}">Resume</span></p>` } : null,
            { id: 'cd-wi-info', title: 'Request', body: c.props([
                ['State', esc(workState(w))],
                ['Shape', esc(isGroups(w) ? 'Supervisor -> a Claude planner per group of related issues' : ((TOPO.find((x) => x[0] === w.topology) || [])[1] || ''))],
                ['Planner stage', esc(stageText(st.planner))],
                ['Workers stage', esc(stageText(st.workers) || [w.model, w.effort].filter(Boolean).join(' / '))],
                ['Account', esc(w.account && w.account.name ? w.account.name : (w.account == null ? '' : String(w.account)))],
                ['Folder', esc(w.cwd || '')],
                [issuesOf(w).length > 1 ? 'Issues' : 'Issue', issueLinks(w)],
                ['Remote Control', w.remoteControl ? 'On' : 'Off'],
                w.joinedInto ? ['Joined into', `<span class="mmc-link" data-act="work-goto" data-arg="${esc(w.joinedInto)}">Item ${esc(w.joinedInto)}</span> (one run)`] : null,
                ['Queued', esc(when(w.createdAt))],
                ['Note', esc([w.message, w.issueNote].filter(Boolean).join(' - '))]
            ].filter(Boolean)) + (links ? `<p>${links}</p>` : '') + (w.prompt ? `<p class="cd-read">${esc(w.prompt)}</p>` : '') },
            parts.length ? { id: 'cd-wi-parts', title: `${isGroups(w) ? 'Planners' : 'Parts'} (${parts.length})`, body: `<table class="cd-table"><thead><tr><th>${isGroups(w) ? 'Planner' : 'Part'}</th><th class="cd-w80">State</th><th class="cd-w80">Session</th></tr></thead><tbody>${parts.map((x) => `<tr><td>${esc(x.title || x.id)}</td><td>${esc(workState(x))}</td><td>${esc(x.sessionId ? shortId(x.sessionId) : '')}</td></tr>`).join('')}</tbody></table>` } : null
        ].filter(Boolean));
    }

    /** A background agent in the Active Work tree. */
    function awAgentPage(c, sid, agentId) {
        const e = S.awAgents.get(sid);
        const x = e && e.agents ? e.agents.find((a) => a.agentId === agentId) : null;
        if (!x) return c.page('Background Agent', '', [{ id: 'cd-aa-wait', title: 'Background Agent', body: `<p class="mmc-hint">${e && e.loading ? 'Reading the agent...' : 'This agent is no longer listed.'}</p>` }]);
        return c.page(x.description || agentId, x.finished ? 'Finished' : 'Running', [{ id: 'cd-aa-info', title: 'Background Agent', body: c.props([
            ['Session', esc(titleOf(rowOf(sid) || { id: sid }))],
            ['Type', esc(x.type || '')],
            ['Model', esc(x.model || '')],
            ['State', x.finished ? 'Finished' : 'Running'],
            ['Last activity', esc(when(x.lastActivity))],
            ['Messages', String(x.messages || 0)]
        ]) + `<p><span class="mmc-link" data-act="agent-open" data-arg="${esc(`${sid}|${agentId}`)}">Read its conversation</span> &nbsp; <span class="mmc-link" data-act="aw-agents-refresh" data-arg="${esc(sid)}">Read again</span></p>` }]);
    }

    // ---- Background Agents (under Activity): every running session's Agent-tool subagents, live -----------
    // Feed claude_desk_agents (statusHub, pushed; subscribed while the window is open) lists them. Opening one
    // reads its conversation read-only (claude_desk_session agent_page, earlier messages on scroll) and a watch
    // (claude_desk_agent_watch) pushes its new messages (claude_desk_agent_append) while its page is open.

    const BG_TREE_MS = 10 * 60 * 1000; // a finished agent stays in the tree this long after it was seen finished
    let BG = bgBlank();
    function bgBlank() { return { on: false, items: new Map(), loaded: false, error: '', pages: new Map(), watching: '', doneAt: new Map(), dropTimer: null, pin: '' }; }
    const bgNodeId = (r) => `bga:${r.sessionId}:${r.agentId}`;
    const bgKeyOf = (sid, aid) => `${sid}|${aid}`;
    const bgRows = () => Array.from(BG.items.values());
    const bgRunning = () => bgRows().filter((r) => r.state === 'running');
    const bgRow = (sid, aid) => BG.items.get(`a:${sid}:${aid}`) || null;
    const BG_STATE = { running: 'Running', idle: 'Idle', finished: 'Finished' };
    const bgIcon = (r) => (r && r.state === 'running' ? `${VI}/application-16.png` : `${VI}/check-16.png`);

    /** The children of the Activity node: the list and one node per running agent (finished ones for a while). */
    function bgNodes() {
        const now = Date.now();
        const here = S.c ? S.c.node : '';
        const kids = bgRows().filter((r) => r.state === 'running' || bgNodeId(r) === here || bgNodeId(r) === BG.pin || now - (BG.doneAt.get(r.key) || 0) < BG_TREE_MS)
            .map((r) => ({ id: bgNodeId(r), name: r.description || r.agentId, icon: bgIcon(r), desc: `${r.sessionTitle || shortId(r.sessionId)} - ${BG_STATE[r.state] || ''}` }));
        return [{ id: 'bg-agents', name: `Background Agents (${bgRunning().length} running)`, icon: `${ITEMS}/programs-and-features-16.png`, desc: 'The agents the running sessions started in the background, live', children: kids }];
    }

    function bgTake(changed, removed, whole) {
        if (whole) { BG.items = new Map(); }
        Object.entries(changed || {}).forEach(([k, r]) => {
            if (!r || typeof r !== 'object') return;
            BG.items.set(k, r);
            if (r.state === 'running') BG.doneAt.delete(k);
            else if (!BG.doneAt.has(k)) BG.doneAt.set(k, whole ? (r.lastActivity || Date.now()) : Date.now());
        });
        (removed || []).forEach((k) => { BG.items.delete(k); BG.doneAt.delete(k); });
        BG.loaded = true;
        // one timer for the oldest finished node still in the tree (not a poll)
        clearTimeout(BG.dropTimer);
        const now = Date.now();
        const next = Array.from(BG.doneAt.values()).map((t) => t + BG_TREE_MS - now).filter((ms) => ms > 0).sort((a, b) => a - b)[0];
        if (next != null) BG.dropTimer = setTimeout(() => bgRepaint(), Math.min(next + 500, 2147000000));
    }

    function bgRepaint() {
        const c = S.c;
        if (!c || !c.modal || !c.modal.isConnected) return;
        c.renderTree();
        if (c.node === 'bg-agents' || (c.node || '').startsWith('bga:')) c.render();
        c.renderStatus();
    }

    async function bgFeed(on) {
        if (on === BG.on) return;
        BG.on = on;
        if (!on) { try { await ws().sendMessage('status_unsubscribe', { feed: 'claude_desk_agents' }, false); } catch (_) { /* gone */ } return; }
        try {
            const r = await send('status_subscribe', { feed: 'claude_desk_agents' });
            bgTake(r.items || {}, [], true);
            BG.error = '';
        } catch (e) { BG.on = false; BG.loaded = true; BG.error = isGone(e) ? NOT_YET : errText(e); }
        bgRepaint();
    }

    function bgWire(app) {
        BG = bgBlank();
        const c = ws();
        if (!c || typeof c.on !== 'function') return;
        const opts = { signal: app.signal };
        Object.assign(ACT_ICON, { 'bg-open': ACT_ICON['agent-open'], 'bg-session': ACT_ICON['open-session'], 'bg-refresh': ACT_ICON['act-refresh'], 'bg-earlier': ACT_ICON['act-refresh'] });
        c.on('claude_desk_agents_status', (msg) => {
            const d = msg && msg.changed ? msg : (msg && msg.data) || {};
            bgTake(d.changed, d.removed, false);
            bgRepaint();
            wmPoke();
        }, opts);
        c.on('claude_desk_agent_append', (msg) => {
            const d = (msg && msg.data) || msg || {};
            const pg = BG.pages.get(bgKeyOf(d.id, d.agentId));
            if (!pg || !Array.isArray(d.messages)) return;
            pg.end = d.end;
            const seen = new Set(pg.messages.map(msgKey));
            const fresh = shownOnly(d.messages).filter((m) => !seen.has(msgKey(m)));
            if (!fresh.length) return;
            fresh.forEach((m) => pg.messages.push(m));
            if (S.c && S.c.node === `bga:${d.id}:${d.agentId}`) bgAppend(bgKeyOf(d.id, d.agentId));
        }, opts);
        // the server forgot this socket's subscription and watch
        c.on('connected', () => {
            if (!S.c) return;
            BG.on = false;
            void bgFeed(true);
            const w = BG.watching;
            BG.watching = '';
            if (w) void bgWatch(w);
        }, opts);
    }

    async function bgWatch(key) {
        if (BG.watching === key) return;
        const [sid, aid] = key.split('|');
        const pg = BG.pages.get(key);
        try {
            await send('claude_desk_agent_watch', { id: sid, agentId: aid, from: pg ? pg.end : undefined, show: showNow() });
            BG.watching = key;
        } catch (_) { BG.watching = ''; }
    }
    async function bgUnwatch() {
        if (!BG.watching) return;
        BG.watching = '';
        try { await send('claude_desk_agent_unwatch', {}); } catch (_) { /* gone */ }
    }
    function bgStop() { clearTimeout(BG.dropTimer); void bgUnwatch(); void bgFeed(false); }

    /** The selection moved: leaving an agent's page stops its pushes; arriving reads it afresh and watches it. */
    function bgSelected(id) {
        const m = /^bga:([^:]+):(.+)$/.exec(id || '');
        const key = m ? bgKeyOf(m[1], m[2]) : '';
        if (BG.pin && id !== BG.pin) BG.pin = '';
        if (BG.watching && BG.watching !== key) void bgUnwatch();
        if (key) {
            const pg = BG.pages.get(key);
            if (!pg) void bgOpen(m[1], m[2]);
            else if (pg.loaded) { BG.pages.delete(key); void bgOpen(m[1], m[2]); } // a visit before: read afresh (it may have grown while away)
        }
    }

    async function bgOpen(sid, aid) {
        const key = bgKeyOf(sid, aid);
        await loadBgPage(sid, aid, false);
        if (S.c && S.c.node === `bga:${sid}:${aid}`) await bgWatch(key);
    }

    async function loadBgPage(sid, aid, earlier) {
        const key = bgKeyOf(sid, aid);
        let pg = BG.pages.get(key);
        if (!pg) { pg = { messages: [], start: 0, end: 0, more: false, loading: false, error: '', stick: true, fromBottom: null, loaded: false }; BG.pages.set(key, pg); }
        if (pg.loading) return;
        pg.loading = true;
        try {
            const show = showNow();
            const r = unwrap(await send('claude_desk_session', earlier ? { action: 'agent_page', id: sid, agentId: aid, before: pg.start, limit: MSG_PAGE, show } : { action: 'agent_page', id: sid, agentId: aid, limit: MSG_PAGE, show }), 'messages');
            pg.messages = earlier ? shownOnly(r.messages).concat(pg.messages) : shownOnly(r.messages);
            pg.start = r.start;
            if (!earlier) pg.end = r.end;
            pg.more = !!r.more;
            pg.error = '';
        } catch (e) { pg.error = isGone(e) ? NOT_YET : errText(e); }
        pg.loading = false;
        pg.loaded = true;
        bgRedraw(key, earlier);
    }

    const bgLog = (key) => (S.c && S.c.node === `bga:${key.replace('|', ':')}` ? S.c.modal.querySelector('.cd-bg-log') : null);

    function bgLogInner(pg, key) {
        const top = pg.more ? `<div class="cd-earlier"><button type="button" class="btn-standard" data-act="bg-earlier" data-arg="${esc(key)}"${pg.loading ? ' disabled' : ''}>Show Earlier Messages</button></div>` : '';
        const body = pg.error ? `<p class="cd-err">${esc(pg.error)}</p>` : (pg.messages.length ? logHtml(pg) : `<p class="mmc-hint">${pg.loading || !pg.loaded ? 'Reading the agent\'s conversation...' : 'This agent has no messages yet.'}</p>`);
        return top + body;
    }

    /** The log drawn again from the page's rows: earlier rows added above keep the reader's place; at the end it stays at the end. */
    function bgRedraw(key, prepended) {
        const pane = bgLog(key);
        const pg = BG.pages.get(key);
        if (!pane || !pg) return;
        const h0 = pane.scrollHeight;
        const t0 = pane.scrollTop;
        pane.innerHTML = bgLogInner(pg, key);
        if (prepended) pane.scrollTop = t0 + (pane.scrollHeight - h0);
        else if (pg.stick !== false) pane.scrollTop = pane.scrollHeight;
        else pane.scrollTop = pane.scrollHeight - (pg.fromBottom || 0);
        const res = S.c.modal.querySelector('.mmc-result');
        if (res) delete res.dataset.html;
        bgMore(key, pane);
    }

    /** New rows go to the end of the log; the view follows only when the reader is at the bottom. */
    function bgAppend(key) {
        const pane = bgLog(key);
        const pg = BG.pages.get(key);
        if (!pane || !pg) return;
        const atEnd = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
        const have = new Set(Array.from(pane.querySelectorAll('[data-k]')).map((n) => n.dataset.k));
        const fresh = pg.messages.filter((m) => !have.has(msgKey(m)));
        if (!fresh.length) return;
        const hint = pane.querySelector(':scope > .mmc-hint');
        if (hint) hint.remove();
        if (atEnd && pg.messages.length > MSG_MAX + MSG_PAGE) {
            let drop = pg.messages.length - MSG_MAX;
            while (drop < pg.messages.length && pg.messages[drop - 1].at === pg.messages[drop].at) drop += 1;
            pg.messages.splice(0, drop);
            if (pg.messages.length) { pg.start = pg.messages[0].at; pg.more = true; }
            pg.stick = true;
            bgRedraw(key, false);
            return;
        }
        pane.insertAdjacentHTML('beforeend', fresh.map(messageHtml).join(''));
        const res = S.c.modal.querySelector('.mmc-result');
        if (res) delete res.dataset.html;
        if (atEnd) pane.scrollTop = pane.scrollHeight;
        pg.fromBottom = pane.scrollHeight - pane.scrollTop;
    }

    function bgMore(key, pane) {
        const pg = BG.pages.get(key);
        if (!pg || pg.loading || pg.error || !pane || !pg.more) return;
        if (pane.scrollTop < 160 || pane.scrollHeight - pane.clientHeight <= 4) { const [sid, aid] = key.split('|'); void loadBgPage(sid, aid, true); }
    }

    /** Opens an agent in the tree (its node is added if the list was the way in) and reads it. */
    function bgOpenNode(c, sid, aid) {
        const id = `bga:${sid}:${aid}`;
        BG.pin = id;
        c.open.add('activity');
        c.open.add('bg-agents');
        c.select(id, true);
    }

    /** The Background Agents list: running first. */
    function bgListPage(c) {
        const rows = bgRows().map((r) => ({
            key: `bg:${r.sessionId}:${r.agentId}`,
            icon: bgIcon(r),
            cls: r.state === 'running' ? 'cd-live' : 'cd-stale',
            data: { agent: r.description || r.agentId, session: r.sessionTitle || shortId(r.sessionId), state: r.state, messages: r.messages || 0, last: r.lastActivity || 0, type: r.type || '' }
        }));
        const rank = { running: 0, idle: 1, finished: 2 };
        const empty = BG.error ? `The background agents could not be read. ${BG.error}` : (BG.loaded ? 'No running session has started a background agent yet.' : 'Reading the background agents...');
        return { html: c.listView([
            { t: 'Agent', w: 260, key: 'agent', text: (d) => d.agent },
            { t: 'Session', w: 200, key: 'session', text: (d) => d.session },
            { t: 'State', w: 70, key: 'state', text: (d) => BG_STATE[d.state] || d.state, value: (d) => rank[d.state] },
            { t: 'Messages', w: 62, key: 'messages', num: true, text: (d) => String(d.messages), value: (d) => d.messages },
            { t: 'Last Activity', w: 128, key: 'last', text: (d) => when(d.last), value: (d) => d.last }
        ], rows, { sortId: 'cd-bg-agents', sort: { key: 'state', dir: 1 }, empty, fit: true }), list: true };
    }

    /** One agent's conversation, read-only. */
    function bgAgentPage(c, sid, aid) {
        const key = bgKeyOf(sid, aid);
        const r = bgRow(sid, aid);
        let pg = BG.pages.get(key);
        if (!pg) { pg = { messages: [], start: 0, end: 0, more: false, loading: false, error: '', stick: true, fromBottom: null, loaded: false }; BG.pages.set(key, pg); void bgOpen(sid, aid); }
        const title = r ? (r.description || aid) : aid;
        const side = r ? [BG_STATE[r.state] || '', r.model, r.type, plural(r.messages || 0, 'message')].filter(Boolean).join(' - ') : 'No longer listed';
        const sess = rowOf(sid);
        const links = `<span class="mmc-link" data-act="bg-session" data-arg="${esc(sid)}">Open session: ${esc(r && r.sessionTitle ? r.sessionTitle : (sess ? titleOf(sess) : shortId(sid)))}</span> <span class="mmc-link" data-act="bg-refresh" data-arg="${esc(key)}">Read again</span>`;
        return {
            html: `<div class="cd-chat">
                <div class="mmc-page-title"><b>${esc(title)}</b><span>${esc(side)}</span></div>
                <div class="cd-chat-links">${links}</div>
                ${showBar()}
                <div class="cd-chat-log cd-bg-log" data-mmc-scroll>${bgLogInner(pg, key)}</div>
            </div>`,
            split: true,
            mount: (pane) => {
                const log = pane.querySelector('.cd-bg-log');
                const mine = BG.pages.get(key) || pg;
                if (log) log.scrollTop = mine.stick === false && mine.fromBottom != null ? log.scrollHeight - mine.fromBottom : log.scrollHeight;
                let raf = 0;
                log.addEventListener('scroll', () => {
                    if (raf) return;
                    raf = requestAnimationFrame(() => {
                        raf = 0;
                        mine.fromBottom = log.scrollHeight - log.scrollTop;
                        mine.stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
                        bgMore(key, log);
                    });
                }, { passive: true });
                log.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-cd-unfold]');
                    if (b) { b.parentElement.classList.remove('is-folded'); b.remove(); return; }
                    if (chatClick(ev)) return;
                    const t = ev.target.closest('[data-cd-toggle]');
                    if (t) { t.parentElement.classList.toggle('is-open'); return; }
                    const f = ev.target.closest('.cd-fold');
                    if (f) void openFold(sid, aid, f);
                });
                log.addEventListener('keydown', (ev) => {
                    if (ev.key !== 'Enter' && ev.key !== ' ') return;
                    const f = ev.target.closest && ev.target.closest('.cd-fold');
                    if (f) { ev.preventDefault(); void openFold(sid, aid, f); }
                });
                // the view options reload this agent (its rows and its watch carry them)
                pane.querySelectorAll('[data-cd-show]').forEach((cb) => cb.addEventListener('change', async () => {
                    await setShow(cb.dataset.cdShow, cb.checked);
                    await bgUnwatch();
                    BG.pages.delete(key);
                    void bgOpen(sid, aid);
                    if (S.c) S.c.render();
                }));
                requestAnimationFrame(() => bgMore(key, log));
            }
        };
    }

    function bgCommands(n) {
        if (n.id === 'bg-agents') return [{ text: 'Open Conversation', action: 'bg-open' }, { text: 'Read Again', action: 'bg-refresh' }];
        return [{ text: 'Open Session', action: 'bg-session' }, { text: 'Read Again', action: 'bg-refresh' }];
    }
    const bgSelCommands = () => ({ title: 'Background Agent', items: [{ text: 'Open Conversation', action: 'bg-open' }, { text: 'Open Session', action: 'bg-session' }] });

    /** Command and Action pane handlers: bg-open / bg-session (the selected row or the open agent), bg-refresh, bg-earlier. */
    async function bgAction(a, c, arg) {
        const sel = /^bg:([^:]+):(.+)$/.exec(c.sel || '') || /^bga:([^:]+):(.+)$/.exec(c.node || '');
        const pair = /^([0-9a-f-]{36})\|(.+)$/.exec(String(arg || ''));
        const sid = pair ? pair[1] : (/^[0-9a-f-]{36}$/.test(String(arg || '')) ? arg : (sel ? sel[1] : ''));
        const aid = pair ? pair[2] : (sel ? sel[2] : '');
        if (a === 'bg-open') { if (sid && aid) bgOpenNode(c, sid, aid); else c.note('Select a background agent first.'); return true; }
        if (a === 'bg-session') { if (sid) { await loadSessions(false); openChat(c, sid); } else c.note('Select a background agent first.'); return true; }
        if (a === 'bg-earlier') { if (sid && aid) await loadBgPage(sid, aid, true); return true; }
        if (a === 'bg-refresh') {
            if (c.node === 'bg-agents') { BG.on = false; await bgFeed(true); } else if (sid && aid) { await bgUnwatch(); BG.pages.delete(bgKeyOf(sid, aid)); void bgOpen(sid, aid); bgRepaint(); }
            return true;
        }
        return false;
    }

    // ---- Activity page ------------------------------------------------------------------------------------

    function activityPage(c) {
        const A = S.act;
        if (!A.loaded && !A.loading) void loadActivity(false);
        if (A.gone) return c.page('Activity', '', [{ id: 'cd-act-gone', title: 'Activity', body: `<p>${NOT_YET}</p>` }]);
        const seen = new Set();
        const sess = [];
        S.live.forEach((l) => { if (!seen.has(l.id)) { seen.add(l.id); sess.push([l.id, titleOf(rowOf(l.id) || { id: l.id, title: l.name })]); } });
        S.sessions.slice(0, 100).forEach((r) => { if (!seen.has(r.id)) { seen.add(r.id); sess.push([r.id, titleOf(r)]); } });
        if (A.sessionId && !seen.has(A.sessionId)) sess.unshift([A.sessionId, titleOf(rowOf(A.sessionId) || { id: A.sessionId })]);
        const bar = `<div class="cd-actbar" role="toolbar" aria-label="Filter the activity">
            <label><span>Show:</span><select class="vdt-select" data-act-f="kind">${ACT_KINDS.map(([v, t]) => `<option value="${v}"${v === A.kind ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label><span>Session:</span><select class="vdt-select" data-act-f="session"><option value="">All sessions</option>${sess.map(([id, t]) => `<option value="${esc(id)}"${id === A.sessionId ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label class="cd-actq"><span>Search:</span><input type="text" data-act-f="q" value="${esc(A.qDraft != null ? A.qDraft : A.q)}" spellcheck="false" autocomplete="off" placeholder="A command, a file, a word"></label>
            <button type="button" class="btn-standard" data-act="act-search"${A.loading ? ' disabled' : ''}>Search</button></div>`;
        const rows = A.rows.map((r) => ({
            key: `x:${r.id}`,
            icon: r.kind === 'edit' ? `${VI}/explorer/file-16.png` : (r.kind === 'shell' ? `${ITEMS}/administrative-tools-16.png` : `${VI}/info-16.png`),
            cls: r.error ? 'cd-stale' : '',
            data: { ts: r.ts, kind: KIND_TEXT[r.kind] || r.kind || '', tool: r.tool || '', summary: String(r.summary || r.target || '').replace(/\s+/g, ' '), session: r.sessionTitle || shortId(r.sessionId), who: r.agentId ? (r.agentDescription || 'Background agent') : '', result: r.error ? 'Failed' : '' }
        }));
        const empty = A.error ? `The activity could not be read. ${A.error}` : (A.loading || !A.loaded ? 'Reading the activity...' : (A.kind || A.q || A.sessionId ? 'Nothing matches.' : 'No activity yet.'));
        const lv = c.listView([
            { t: 'When', w: 140, key: 'ts', text: (d) => when(d.ts), value: (d) => Date.parse(d.ts) || 0 },
            { t: 'Kind', w: 52, key: 'kind', text: (d) => d.kind },
            { t: 'Tool', w: 74, key: 'tool', text: (d) => d.tool },
            { t: 'What', w: 300, key: 'summary', text: (d) => d.summary },
            { t: 'Session', w: 160, key: 'session', text: (d) => d.session },
            { t: 'Background Agent', w: 130, key: 'who', text: (d) => d.who },
            { t: 'Result', w: 54, key: 'result', text: (d) => d.result }
        ], rows, { wrap: true, sortId: 'cd-activity', sort: { key: 'ts', dir: -1 }, empty, fit: true });
        const more = A.loaded ? `<div class="cd-more"><span>${A.rows.length} of ${A.total}</span><button type="button" class="btn-standard" data-act="act-more"${A.next == null || A.loading ? ' disabled' : ''}>More</button></div>` : '';
        return {
            html: `<div class="cd-list-wrap">${bar}${lv}${more}</div>`,
            list: true,
            split: true,
            mount: (pane) => {
                const onKind = pane.querySelector('[data-act-f="kind"]');
                const onSes = pane.querySelector('[data-act-f="session"]');
                const q = pane.querySelector('[data-act-f="q"]');
                const apply = () => { A.kind = onKind.value; A.sessionId = onSes.value; A.q = q.value.trim(); A.qDraft = q.value; A.rows = []; A.next = null; A.total = 0; A.loaded = false; void loadActivity(false); c.refresh(); };
                if (onKind) onKind.addEventListener('change', apply);
                if (onSes) onSes.addEventListener('change', apply);
                if (q) {
                    q.addEventListener('input', () => { A.qDraft = q.value; });
                    q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); apply(); } });
                }
            }
        };
    }

    // ---- Memory pages ---------------------------------------------------------------------------------------

    function memCounts() {
        const s = S.memStats || {};
        const n = (k) => (s[k] == null ? '-' : s[k]);
        return `<div class="cd-membar-counts" role="status"><span><b>${n('active')}</b> active</span><span><b>${n('proposed')}</b> proposed</span><span><b>${n('flagged')}</b> flagged</span><span><b>${n('stale')}</b> stale</span></div>`;
    }
    function memList(c, L, sortId, empty) {
        const rows = L.rows.map((m) => ({
            key: `me:${m.id}`,
            icon: memIcon(m),
            cls: m.status === 'rejected' || m.status === 'superseded' || m.status === 'expired' ? 'cd-stale' : '',
            data: { title: m.title || '', kind: memKindText(m.kind), scope: memScopeText(m.scope), status: memStatusText(m), pinned: m.pinned ? 'Pinned' : '', author: m.author || '', updated: m.updatedAt || 0 }
        }));
        return c.listView([
            { t: 'Title', w: 280, key: 'title', text: (d) => d.title },
            { t: 'Kind', w: 80, key: 'kind', text: (d) => d.kind },
            { t: 'Scope', w: 110, key: 'scope', text: (d) => d.scope },
            { t: 'Status', w: 120, key: 'status', text: (d) => d.status },
            { t: 'Pinned', w: 54, key: 'pinned', text: (d) => d.pinned },
            { t: 'Author', w: 110, key: 'author', text: (d) => d.author },
            { t: 'Updated', w: 128, key: 'updated', text: (d) => when(d.updated), value: (d) => Number(d.updated) || Date.parse(d.updated) || 0 }
        ], rows, { sortId, sort: { key: 'updated', dir: -1 }, empty, fit: true });
    }
    function memGone(c, title) { return c.page(title, '', [{ id: 'cd-mem-gone', title, body: `<p>${NOT_YET}</p>` }]); }

    function memoryPage(c) {
        const L = S.mem;
        if (!L.loaded && !L.loading) { void loadMem(L, false); void loadMemStats(); }
        if (L.gone) return memGone(c, 'Memory');
        const scopes = ['global'].concat(Array.from(S.memRepos).sort());
        if (L.scope && !scopes.includes(L.scope)) scopes.push(L.scope);
        const bar = `${memCounts()}<div class="cd-actbar" role="toolbar" aria-label="Filter the memory">
            <label><span>Status:</span><select class="vdt-select" data-mem-f="status">${MEM_STATUS.map(([v, t]) => `<option value="${v}"${v === L.status ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label><span>Scope:</span><select class="vdt-select" data-mem-f="scope"><option value="">All</option>${scopes.map((s) => `<option value="${esc(s)}"${s === L.scope ? ' selected' : ''}>${esc(memScopeText(s))}</option>`).join('')}</select></label>
            <label class="cd-actq"><span>Search:</span><input type="text" data-mem-f="q" value="${esc(L.qDraft != null ? L.qDraft : L.q)}" spellcheck="false" autocomplete="off" placeholder="A word in a title or body"></label>
            <button type="button" class="btn-standard" data-act="mem-search"${L.loading ? ' disabled' : ''}>Search</button></div>`;
        const empty = L.error ? `The memory could not be read. ${L.error}` : (L.loading || !L.loaded ? 'Reading the memory...' : (L.q || L.scope || L.status !== 'active' ? 'Nothing matches.' : 'No memory is active yet.'));
        const more = L.loaded ? `<div class="cd-more"><span>${L.rows.length} shown</span><button type="button" class="btn-standard" data-act="mem-more"${L.next == null || L.loading ? ' disabled' : ''}>More</button></div>` : '';
        return {
            html: `<div class="cd-list-wrap">${bar}${memList(c, L, 'cd-memory', empty)}${more}</div>`,
            list: true,
            split: true,
            mount: (pane) => {
                const st = pane.querySelector('[data-mem-f="status"]');
                const sc = pane.querySelector('[data-mem-f="scope"]');
                const q = pane.querySelector('[data-mem-f="q"]');
                const apply = () => { L.status = st.value; L.scope = sc.value; L.q = q.value.trim(); L.qDraft = q.value; L.rows = []; L.next = null; L.loaded = false; void loadMem(L, false); c.refresh(); };
                if (st) st.addEventListener('change', apply);
                if (sc) sc.addEventListener('change', apply);
                if (q) {
                    q.addEventListener('input', () => { L.qDraft = q.value; });
                    q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); apply(); } });
                }
            }
        };
    }
    function memReviewPage(c) {
        const L = S.memRv;
        if (!L.loaded && !L.loading) { void loadMem(L, false); void loadMemStats(); }
        if (L.gone) return memGone(c, 'Needs Review');
        const empty = L.error ? `The memory could not be read. ${L.error}` : (L.loading || !L.loaded ? 'Reading the memory...' : 'Nothing is waiting for review.');
        const bar = `${memCounts()}<div class="cd-actbar"><span>Proposed and flagged memories wait here. The Supervisor's model approves or rejects them on its own.</span><button type="button" class="btn-standard" data-act="mem-review-now"${S.memBusy ? ' disabled' : ''}>Ask the Supervisor to review now</button></div>`;
        return { html: `<div class="cd-list-wrap">${bar}${memList(c, L, 'cd-memory-review', empty)}</div>`, list: true, split: true };
    }
    function memDigestPage(c) {
        const D = S.dig;
        if (!D.loaded && !D.loading) void loadDigest();
        if (D.gone) return memGone(c, 'Session Digest');
        const repos = Array.from(S.memRepos).sort().map((s) => s.replace(/^repo:/, ''));
        if (D.repo && !repos.includes(D.repo)) repos.push(D.repo);
        const bar = `<div class="cd-actbar"><label><span>Repository:</span><select class="vdt-select" data-mem-f="repo"><option value="">Any</option>${repos.map((r) => `<option value="${esc(r)}"${r === D.repo ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label><span class="mmc-hint">What every session starts with.</span></div>`;
        const body = D.error ? `<p class="cd-err">${esc(D.error)}</p>` : (D.loaded ? `<pre class="cd-pre cd-mem-digest">${esc(D.text || '(empty)')}</pre>` : '<p class="mmc-hint">Reading the digest...</p>');
        return {
            html: `<div class="cd-list-wrap">${bar}<div class="cd-mem-digest-wrap">${body}</div></div>`,
            mount: (pane) => {
                const r = pane.querySelector('[data-mem-f="repo"]');
                if (r) r.addEventListener('change', () => { D.repo = r.value; D.loaded = false; void loadDigest(); c.refresh(); });
            }
        };
    }

    // ---- Rules: the agent rules and the Supervisor's review of them (claude_desk_supervisor rules_*) ---------

    const rulesData = () => (S.sup.data && S.sup.data.rules) || { rules: [], last: null, running: null };
    const rulesOpenFindings = () => ((rulesData().last && rulesData().last.findings) || []).filter((f) => !f.dismissed);
    const RULE_SEV = { high: ['Serious', `${VI}/error-16.png`], medium: ['Should fix', `${VI}/warning-16.png`], low: ['Minor', `${VI}/info-16.png`] };
    const RULE_KIND = { contradiction: 'Contradiction', duplicate: 'Duplicate', unclear: 'Unclear', unenforceable: 'Cannot be checked', outdated: 'Outdated', 'not-english': 'Not English', 'missing-import': 'Not in CLAUDE.md', 'missing-file': 'Missing file', 'outdated-reference': 'Outdated reference' };
    const rulesIcon = `${ITEMS}/default-programs-16.png`;

    function rulesPage(c) {
        const d = rulesData();
        const rows = d.rules.map((r) => ({ key: `ru:${r.name}`, icon: rulesIcon, data: { name: r.name, desc: r.description, size: r.size, mtime: r.mtime } }));
        const empty = S.sup.unavailable ? NOT_YET : (S.sup.loaded ? 'No rules were found.' : 'Reading the rules...');
        return c.listView([
            { t: 'Name', w: 190, key: 'name', text: (x) => x.name },
            { t: 'Description', w: 420, key: 'desc', text: (x) => x.desc },
            { t: 'Size', w: 70, key: 'size', num: true, text: (x) => bytesText(x.size), value: (x) => x.size },
            { t: 'Modified', w: 128, key: 'mtime', text: (x) => when(x.mtime), value: (x) => x.mtime }
        ], rows, { wrap: true, sortId: 'cd-rules', empty, fit: true });
    }
    const RULE_KIND2 = { 'memory-to-rule': 'Memory to rule', 'memory-duplicate': 'Memory repeats a rule', 'memory-outdated': 'Memory outdated' };
    const PROP_STATUS = { draft: 'Draft', accepted: 'Accepted', rejected: 'Rejected' };
    const PROP_KIND = { 'new-rule': 'New rule', 'change-rule': 'Change a rule', covered: 'Already covered' };
    const rulesProposals = () => rulesData().proposals || [];
    const findingOf = (id) => rulesOpenFindings().find((f) => String(f.id) === String(id));
    const proposalOf = (id) => rulesProposals().find((p) => String(p.id) === String(id));
    const draftTarget = (d) => (d && d.file) || '';
    /** What a selected finding or proposal says in full, with its draft. */
    function rulesDetailHtml(c) {
        const k = c.sel || '';
        const pre = (t) => `<pre class="cd-pre cd-rule-text">${esc(t)}</pre>`;
        if (k.startsWith('rf:')) {
            const f = findingOf(k.slice(3));
            if (!f) return '<p class="mmc-hint">Select a finding to read it in full.</p>';
            const d = f.draft;
            return `<p><b>${esc(RULE_KIND[f.kind] || RULE_KIND2[f.kind] || f.kind)}</b>${f.memoryId ? ` (memory #${esc(f.memoryId)}: ${esc(f.memoryTitle || '')})` : ''}${(f.rules || []).length ? `, rule ${esc(f.rules.join(', '))}` : ''}</p><p>${esc(f.text)}</p>${d ? `<p>${esc(PROP_KIND[d.kind] || '')}${draftTarget(d) ? ` <b>${esc(draftTarget(d))}</b>` : ''}${d.kind === 'new-rule' ? (d.alwaysApply ? ', always applied' : `, on demand${d.trigger ? `: ${esc(d.trigger)}` : ''}`) : ''}</p>${pre(d.text)}` : `<p>${esc(f.suggestion || '')}</p>`}`;
        }
        if (k.startsWith('rp:')) {
            const p = proposalOf(k.slice(3));
            if (!p) return '<p class="mmc-hint">Select a proposal to read it in full.</p>';
            const d = p.draft || {};
            return `<p><b>${esc(p.title)}</b> (${esc(PROP_STATUS[p.status] || p.status)}, ${esc(PROP_KIND[d.kind] || '')}${draftTarget(d) ? ` ${esc(draftTarget(d))}` : ''})</p>${p.input ? `<p>Your words: ${esc(p.input)}</p>` : ''}<p>${esc(p.reasoning)}</p>${d.text ? pre(d.text) : ''}${p.reason ? `<p>Rejected: ${esc(p.reason)}</p>` : ''}${p.status === 'accepted' ? `<p class="mmc-hint">${p.how === 'manager' ? 'Sent to the Manager Session.' : `Queued as request #${esc(p.workId)}: start it from Requests.`}</p>` : ''}`;
        }
        return '<p class="mmc-hint">Select a finding or a proposal to read it in full.</p>';
    }
    function rulesReviewPage(c) {
        const d = rulesData();
        const run = d.running;
        const busy = !!run || !!S.rulesBusy;
        const last = d.last;
        const status = run ? `${esc(run.step || 'Reviewing')} (${run.done} of ${run.total} done)`
            : (S.rulesBusy ? 'Starting the review...' : (last ? `Reviewed ${esc(when(last.at))} by ${esc(last.model || last.engine || 'the Supervisor')}: ${plural(rulesOpenFindings().length, 'finding')} open in ${plural(last.ruleCount, 'rule')} and the memories.${last.error ? ` <span class="cd-err">${esc(last.error)}</span>` : ''}` : 'The rules and memories have not been reviewed yet.'));
        const bar = `<div class="cd-actbar"><span>${status}</span><button type="button" class="btn-standard primary" data-act="rules-review"${busy ? ' disabled' : ''}>Review Now</button></div>`;
        const kindIcon = (f) => (f.kind || '').startsWith('memory-') ? `${ITEMS}/personalization-16.png` : (RULE_SEV[f.severity] || RULE_SEV.medium)[1];
        const rows = rulesOpenFindings().map((f) => ({ key: `rf:${f.id}`, icon: kindIcon(f), data: { rule: (f.kind || '').startsWith('memory-') ? `Memory #${f.memoryId}${(f.rules || []).length ? ` > ${f.rules.join(', ')}` : ''}` : (f.rules || []).join(', '), kind: RULE_KIND[f.kind] || RULE_KIND2[f.kind] || f.kind, text: f.text, fix: f.suggestion } }));
        const lv = c.listView([
            { t: 'Rule / Memory', w: 150, key: 'rule', text: (x) => x.rule },
            { t: 'Kind', w: 120, key: 'kind', text: (x) => x.kind },
            { t: 'Issue', w: 300, key: 'text', text: (x) => x.text },
            { t: 'Suggestion / Draft', w: 300, key: 'fix', text: (x) => x.fix }
        ], rows, { wrap: true, sortId: 'cd-rules-review', empty: last ? 'No open findings.' : 'Nothing to show until a review has run.', fit: true });
        const prow = rulesProposals().map((p) => ({ key: `rp:${p.id}`, icon: p.status === 'accepted' ? `${VI}/info-16.png` : (p.status === 'rejected' ? `${VI}/error-16.png` : `${VI}/warning-16.png`), data: { n: p.id, status: PROP_STATUS[p.status] || p.status, title: p.title, kind: PROP_KIND[(p.draft || {}).kind] || '', draft: String((p.draft || {}).text || '').replace(/\s+/g, ' ').slice(0, 220) } }));
        const pv = c.listView([
            { t: '#', w: 40, key: 'n', num: true, text: (x) => String(x.n), value: (x) => x.n },
            { t: 'Status', w: 80, key: 'status', text: (x) => x.status },
            { t: 'Proposal', w: 230, key: 'title', text: (x) => x.title },
            { t: 'Kind', w: 110, key: 'kind', text: (x) => x.kind },
            { t: 'Draft', w: 300, key: 'draft', text: (x) => x.draft }
        ], prow, { wrap: true, sortId: 'cd-rules-props', empty: 'No proposals yet. Explain an issue below, or accept a memory finding.', fit: true });
        const ex = S.rulesExplain || '';
        const explain = `<p class="mmc-hint">Describe a problem in your own words. The Supervisor checks it against the rules and memories, says whether a rule already covers it, and drafts a change or a new rule as a proposal.</p>
            <label class="cd-top"><span>The problem:</span><textarea data-rules-explain rows="4" spellcheck="true" placeholder="For example: agents keep restarting the server while I test"${S.rulesExplainBusy ? ' disabled' : ''}>${esc(ex)}</textarea></label>
            <p class="cd-sup-actions"><button type="button" class="btn-standard primary" data-act="rules-explain"${S.rulesExplainBusy ? ' disabled' : ''}>Review as a Rule</button>${S.rulesExplainBusy ? ' <span class="mmc-hint">The Supervisor is reasoning about it...</span>' : ''}</p>`;
        const html = c.page('Rules Review', '', [
            { id: 'cd-rr-bar', title: 'Review', body: bar },
            { id: 'cd-rr-find', title: `Findings (${rows.length})`, body: `<div class="cd-sup-list">${lv}</div>` },
            { id: 'cd-rr-prop', title: `Proposals (${prow.length})`, body: `<div class="cd-sup-list">${pv}</div>` },
            { id: 'cd-rr-detail', title: 'Selected', body: `<div class="cd-maint-detail">${rulesDetailHtml(c)}</div>` },
            { id: 'cd-rr-explain', title: 'Explain an Issue', body: explain }
        ]);
        return {
            html,
            mount: (pane) => { pane.addEventListener('input', (ev) => { const t = ev.target.closest('[data-rules-explain]'); if (t) S.rulesExplain = t.value; }); }
        };
    }
    function rulesTake(r) { S.sup.data = Object.assign({}, S.sup.data || {}, { rules: r.rules }); }
    /** Accept...: the draft in an editable box first; OK sends it to a session (held request, or the Manager Session). */
    async function ruleAcceptBox(c, title, text, info) {
        const { value, fields } = await form(c, `<p>${esc(info)}</p><label class="cd-top"><span>Draft:</span><textarea data-cd="text" data-cd-focus rows="14" spellcheck="true">${esc(text)}</textarea></label><p class="mmc-hint">OK does not change the rules itself: a session applies, commits and pushes it. Without a Manager Session it waits as a held request.</p>`,
            [{ text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title, width: 640 });
        return value === true ? String(fields.text || '').trim() : null;
    }
    async function ruleAcceptSelected(c) {
        const k = c.sel || '';
        try {
            if (k.startsWith('rf:')) {
                const f = findingOf(k.slice(3));
                if (!f || f.kind !== 'memory-to-rule' || !f.draft) { await c.box('<p>Select a memory finding that should become a rule.</p>', null, { icon: 'info' }); return; }
                const text = await ruleAcceptBox(c, 'Accept as a Rule', f.draft.text, `${f.draft.kind === 'new-rule' ? `New rule ${f.draft.file || ''}` : `Add to ${f.draft.file || 'a rule'}`}, from memory #${f.memoryId}.`);
                if (text === null) return;
                rulesTake(unwrap(await send('claude_desk_supervisor', { action: 'rules_finding_accept', findingId: f.id, text }), 'rules'));
            } else if (k.startsWith('rp:')) {
                const p = proposalOf(k.slice(3));
                if (!p || p.status !== 'draft') { await c.box('<p>Select a draft proposal.</p>', null, { icon: 'info' }); return; }
                if ((p.draft || {}).kind === 'covered') { await c.box('<p>The rules already cover this, so there is nothing to apply. Read the reasoning, and reject it if it is right.</p>', null, { icon: 'info' }); return; }
                const text = await ruleAcceptBox(c, 'Accept Proposal', (p.draft || {}).text || '', `${PROP_KIND[(p.draft || {}).kind] || 'Rule'} ${draftTarget(p.draft)}: ${p.title}`);
                if (text === null) return;
                rulesTake(unwrap(await send('claude_desk_supervisor', { action: 'rules_proposal_accept', id: p.id, text }), 'rules'));
            } else { await c.box('<p>Select a finding or a proposal first.</p>', null, { icon: 'info' }); return; }
        } catch (e) { await failBox(c, e); }
        repaint();
    }
    async function ruleRejectSelected(c) {
        const p = (c.sel || '').startsWith('rp:') ? proposalOf(c.sel.slice(3)) : null;
        if (!p || p.status !== 'draft') { await c.box('<p>Select a draft proposal to reject.</p>', null, { icon: 'info' }); return; }
        const { value, fields } = await form(c, `<p>Reject <b>${esc(p.title)}</b>. The reason is optional and is kept with it.</p><label class="cd-top"><span>Reason:</span><textarea data-cd="reason" data-cd-focus rows="3" spellcheck="true" placeholder="Why it is rejected (optional)"></textarea></label>`,
            [{ text: 'Reject', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Reject Proposal' });
        if (value !== true) return;
        try { rulesTake(unwrap(await send('claude_desk_supervisor', { action: 'rules_proposal_reject', id: p.id, reason: String(fields.reason || '').trim() }), 'rules')); } catch (e) { await failBox(c, e); }
        repaint();
    }
    async function rulesExplainSend(c) {
        const text = String(S.rulesExplain || '').trim();
        if (!text) { await c.box('<p>Describe the problem first.</p>', null, { icon: 'info' }); return; }
        if (S.rulesExplainBusy) return;
        S.rulesExplainBusy = true;
        repaint();
        try {
            const r = unwrap(await send('claude_desk_supervisor', { action: 'rules_explain', text }), 'rules');
            rulesTake(r);
            S.rulesExplain = '';
            if (r.proposal) c.sel = `rp:${r.proposal.id}`;
        } catch (e) { await failBox(c, e); }
        S.rulesExplainBusy = false;
        repaint();
    }
    async function ruleRead(c, name) {
        if (!name) return;
        try {
            const r = unwrap(await send('claude_desk_supervisor', { action: 'rules_text', name }), 'rule');
            await c.box(`<pre class="cd-pre cd-rule-text">${esc(r.text || '(empty)')}</pre>`, null, { icon: 'info', title: `${r.file || name}`, width: 640 });
        } catch (e) { await failBox(c, e); }
    }
    async function rulesReviewStart(c) {
        if (S.rulesBusy || rulesData().running) return;
        S.rulesBusy = true;
        repaint();
        try {
            const r = unwrap(await send('claude_desk_supervisor', { action: 'rules_review' }), 'rules');
            S.sup.data = Object.assign({}, S.sup.data || {}, { rules: r.rules });
        } catch (e) { await failBox(c, e); }
        S.rulesBusy = false;
        repaint();
    }
    async function ruleFindingDismiss(c, id) {
        if (!id) return;
        try {
            const r = unwrap(await send('claude_desk_supervisor', { action: 'rules_dismiss', findingId: id }), 'rules');
            S.sup.data = Object.assign({}, S.sup.data || {}, { rules: r.rules });
        } catch (e) { await failBox(c, e); }
        repaint();
    }

    // ---- Contractors pages ---------------------------------------------------------------------------------

    function contractorsPage(c) {
        if (!S.con.loaded && !S.con.loading) void loadContractors();
        if (S.con.gone) return c.page('Contractors', '', [{ id: 'cd-con-gone', title: 'Contractors', body: `<p>${NOT_YET}</p><p class="mmc-hint">Contractors are other machines that run Fleet work on their own projects.</p>` }]);
        const rows = S.con.list.map((k) => ({
            key: `k:${k.id}`,
            icon: k.revoked ? `${VI}/error-16.png` : `${ITEMS}/network-and-sharing-center-16.png`,
            cls: k.online ? 'cd-live' : (k.revoked ? 'cd-stale' : ''),
            data: { name: conName(k), host: [conHello(k).hostname, conHello(k).os].filter(Boolean).join(' / '), claude: conHello(k).claudeVersion || '', state: conState(k), seen: k.lastSeenAt || 0, sessions: conSessions(k).filter((x) => x && x.live !== false).length }
        }));
        const inv = (S.con.invites || []).map((i) => ({ key: `iv:${i.id}`, icon: `${VI}/info-16.png`, data: { name: i.name, expires: i.expiresAt || 0 } }));
        const empty = S.con.error ? `Contractors could not be read. ${S.con.error}` : (S.con.loaded ? 'No other machine is added. Use Add Contractor... to connect one.' : 'Reading the contractors...');
        const lv = c.listView([
            { t: 'Name', w: 150, key: 'name', text: (d) => d.name },
            { t: 'Host / System', w: 190, key: 'host', text: (d) => d.host },
            { t: 'Claude', w: 70, key: 'claude', text: (d) => d.claude },
            { t: 'State', w: 70, key: 'state', text: (d) => d.state },
            { t: 'Last Seen', w: 128, key: 'seen', text: (d) => when(d.seen), value: (d) => Number(d.seen) || Date.parse(d.seen) || 0 },
            { t: 'Sessions', w: 62, key: 'sessions', num: true, text: (d) => String(d.sessions), value: (d) => d.sessions }
        ], rows, { sortId: 'cd-contractors', empty, fit: true });
        const invList = inv.length ? c.listView([{ t: 'Open invitation', w: 200, key: 'name', text: (d) => d.name }, { t: 'Expires', w: 128, key: 'expires', text: (d) => when(d.expires), value: (d) => Number(d.expires) || Date.parse(d.expires) || 0 }], inv, { sortId: 'cd-invites' }) : '';
        return { html: invList ? `<div class="cd-list-wrap">${lv}${invList}</div>` : lv, list: true, split: !!invList };
    }
    function contractorPage(c, id) {
        const k = conOf(id);
        if (!k) return c.page('Contractor', '', [{ id: 'cd-ct-gone', title: 'Contractor', body: '<p class="mmc-hint">This contractor is no longer listed.</p>' }]);
        const h = conHello(k);
        const live = conSessions(k).filter((x) => x && x.live !== false);
        const recent = S.conRecent && S.conRecent.get(k.id);
        const tbl = (list) => (list.length ? `<table class="cd-table"><thead><tr><th>Session</th><th>Folder</th><th class="cd-w80">State</th></tr></thead><tbody>${list.map((x) => `<tr><td>${esc(x.title || shortId(x.id))}</td><td>${esc(baseName(x.cwd))}</td><td>${esc(x.status || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="mmc-hint">None.</p>');
        return c.page(conName(k), conState(k), [
            { id: 'cd-ct-info', title: 'Machine', body: c.props([['Host', esc(h.hostname || '')], ['System', esc([h.os, h.osRelease, h.arch].filter(Boolean).join(' '))], ['State', c.state(!!k.online, conState(k), true)], ['Address', esc(k.address || '')], ['Last seen', esc(when(k.lastSeenAt))], ['Claude Code', esc(h.claudeVersion || '')], ['Agent', esc([h.agentVersion, h.runner].filter(Boolean).join(' / '))], ['Added', esc(when(k.createdAt))]]) },
            { id: 'cd-ct-acc', title: `Accounts (${(h.accounts || []).length})`, body: (h.accounts || []).length ? `<table class="cd-table"><thead><tr><th>Account</th><th>Organization</th><th class="cd-w80">Plan</th></tr></thead><tbody>${h.accounts.map((a) => `<tr><td>${esc(a.displayName || a.email || '')}</td><td>${esc(a.organization || '')}</td><td>${esc(a.plan || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="mmc-hint">None signed in.</p>' },
            { id: 'cd-ct-proj', title: `Projects (${(h.projects || []).length})`, body: (h.projects || []).length ? `<table class="cd-table"><thead><tr><th>Project</th><th>Folder</th></tr></thead><tbody>${h.projects.map((x) => `<tr><td>${esc(x.name || '')}</td><td>${esc(x.path || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="mmc-hint">None.</p>' },
            { id: 'cd-ct-sess', title: `Live Sessions (${live.length})`, body: tbl(live) },
            { id: 'cd-ct-recent', title: 'Recent Sessions', body: recent ? tbl(recent) : `<p><span class="mmc-link" data-act="con-recent" data-arg="${esc(k.id)}">Show recent sessions</span></p>` }
        ]);
    }
    /** A contractor's session: what it is and its conversation (read through the contractor's relay). */
    function contractorSessionPage(c, cid, sid) {
        const k = conOf(cid);
        const x = k ? (conSessions(k).find((y) => y.id === sid) || ((S.conRecent && S.conRecent.get(cid)) || []).find((y) => y.id === sid)) : null;
        if (!x) return c.page('Session', '', [{ id: 'cd-cs-gone', title: 'Session', body: '<p class="mmc-hint">This session is no longer listed.</p>' }]);
        const key = `${cid}|${sid}`;
        const e = S.conChats.get(key);
        if (!e) void loadConChat(cid, sid);
        const log = e && e.messages.length ? `<div class="cd-chat-log cd-agent-log">${logHtml(e)}</div>` : `<p class="${e && e.error ? 'cd-err' : 'mmc-hint'}">${esc(e ? (e.error || (e.loading ? 'Reading the conversation...' : 'No messages yet.')) : 'Reading the conversation...')}</p>`;
        return c.page(x.title || shortId(sid), `${conName(k)} - ${x.status || ''}`, [
            { id: 'cd-cs-info', title: 'Session', body: c.props([['Folder', esc(x.cwd || '')], ['Model', esc(x.model || '')], ['Permissions', esc(x.mode || '')], ['Started', esc(when(x.startedAt))], ['Updated', esc(when(x.updatedAt))], ['Remote Control', x.link ? `<span class="mmc-link" data-act="open-link" data-arg="${esc(x.link)}">Open in claude.ai</span>` : 'Not connected']]) + `<p><span class="mmc-link" data-act="con-steer" data-arg="${esc(key)}">Steer...</span> &nbsp; <span class="mmc-link" data-act="con-interrupt" data-arg="${esc(key)}">Stop turn</span> &nbsp; <span class="mmc-link" data-act="con-stop" data-arg="${esc(key)}">Stop session</span> &nbsp; <span class="mmc-link" data-act="con-reread" data-arg="${esc(key)}">Read again</span></p>` },
            { id: 'cd-cs-log', title: 'Conversation', body: log }
        ]);
    }

    /** The selected review's detail again, without drawing the page (the settings keep what is typed). */
    function supSelect(key) {
        if (!key || !key.startsWith('v:')) return;
        S.sup.sel = key.slice(2);
        const box = S.c && S.c.modal.querySelector('.cd-sup-detail');
        if (box) box.innerHTML = supDetailHtml();
    }

    // ---- the tree -----------------------------------------------------------------------------------------

    /** The sessions no work item owns: running ones the Supervisor does not supervise. */
    const unsupervised = () => { const owned = new Set(supWork().filter((w) => WORK_OPEN.has(w.state) && w.sessionId).map((w) => w.sessionId)); return S.live.filter((l) => !owned.has(l.id)); };
    const activeItems = () => supWork().filter((w) => WORK_OPEN.has(w.state));
    /** Work Queue groups: Active is what runs (starting, running); Pending is what waits (queued, waiting). Each item is in one. */
    // Sent Back (waiting) is active work: its session is working through the Supervisor's notes, not queued for a slot
    const WORK_RUN = new Set(['starting', 'running', 'waiting']);
    const runItems = () => supWork().filter((w) => WORK_RUN.has(w.state));
    const heldItems = () => supWork().filter((w) => w.state === 'held');
    const pendItems = () => supWork().filter((w) => WORK_OPEN.has(w.state) && !WORK_RUN.has(w.state) && w.state !== 'held' && w.state !== 'input');
    const inputItems = () => supWork().filter((w) => w.state === 'input');
    // finished work leaves Active / Pending: done, failed and cancelled items of the last 7 days (Yukimi, Nov 25 2026)
    const WORK_DONE = new Set(['done', 'failed', 'cancelled']);
    const doneItems = () => supWork().filter((w) => WORK_DONE.has(w.state) && (Number(w.endedAt) || Date.parse(w.endedAt) || 0) > Date.now() - 7 * 86400000);
    const WORK_SCOPE = { all: () => supWork(), held: heldItems, active: runItems, pending: pendItems, done: doneItems };
    /** A running session counts as finished when it is idle and quiet for an hour (the Manager Session never is). */
    const QUIET_MS = 60 * 60 * 1000;
    const quietSession = (l) => {
        if (!l || l.status === 'busy' || l.id === managerSid()) return false;
        const row = rowOf(l.id);
        const last = Date.parse((row && row.lastActivity) || '') || Number(l.startedAt) || 0;
        return Date.now() - last > QUIET_MS;
    };
    const unsupervisedActive = () => unsupervised().filter((l) => !quietSession(l));
    const unsupervisedQuiet = () => unsupervised().filter(quietSession);

    /** A session in the tree: paused ones carry the warning icon and the word. */
    function sessionNode(idPrefix, sid, A) {
        const row = rowOf(sid) || { id: sid, title: (liveOf(sid) || {}).name };
        const h = holdOf(sid);
        const node = { id: `${idPrefix}${sid}`, name: `${titleOf(row)}${h ? ` (${holdWord(h).toLowerCase()})` : ''}`, icon: h ? PAUSE16 : sessIcon(sid), desc: h ? holdLine(h) : (usgFlagged(sid) ? 'Heavy usage: see Usage > Flags' : 'The session\'s conversation') };
        if (idPrefix === 'aw:s:') {
            const e = S.awAgents.get(sid);
            if (e && e.agents) node.children = e.agents.map((x) => ({ id: `aw:a:${sid}:${x.agentId}`, name: x.description || x.agentId, icon: x.finished ? `${VI}/check-16.png` : SESSION16, desc: 'A background agent of this session' }));
            else if (liveOf(sid)) node.children = [{ id: `aw:l:${sid}`, name: 'Reading the agents...', icon: `${VI}/info-16.png` }];
        }
        return node;
    }
    /** The Yozora issues a planner carries, as leaves: shown when it carries 2+ or is a planner of a groups item (the groups parent itself lists none). */
    function issueNodes(w) {
        const l = issuesOf(w);
        if (isGroups(w) || !(l.length > 1 || (l.length && groupParentOf(w)))) return [];
        const main = l.find((i) => i.primary) || l[0];
        return l.map((i) => ({ id: `aw:i:${w.id}:${i.repo}#${i.number}`, name: `${i.repo && main && i.repo !== main.repo ? `${i.repo}` : ''}#${i.number}${i.title ? ` - ${i.title}` : ''}`, icon: `${VI}/info-16.png`, desc: 'A Yozora issue this planner carries' }));
    }
    /** A work item: its parts (a surfaces item's child items, each with its session) and its own session. */
    function workNode(w, A, seen, group) {
        seen.add(String(w.id));
        const kids = group().filter((x) => String(x.parentId) === String(w.id) && !seen.has(String(x.id))).map((x) => workNode(x, A, seen, group));
        kids.unshift(...issueNodes(w));
        if (w.sessionId) kids.push(sessionNode('aw:s:', w.sessionId, A));
        const h = w.sessionId ? holdOf(w.sessionId) : null;
        const topo = topoShort(w.topology);
        return { id: `aw:w:${w.id}`, name: `${w.title || w.id}${topo && w.parentId == null ? ` - ${topo}` : ''}${h ? ` (${holdWord(h).toLowerCase()})` : ''}`, icon: h ? PAUSE16 : workIcon(w.state), desc: `${WORK_STATE[w.state] || w.state || ''}${WORK_RUN.has(w.state) && w.message ? ` - ${w.message}` : ''}`, children: kids }; // the in-flight reason (background agents, a review) shows in the row note
    }

    /** The page of an issue leaf: what the issue is and a link that opens it (like the issue links of the request page). */
    function awIssuePage(c, id) {
        const m = /^aw:i:([^:]+):(.+)#(\d+)$/.exec(id);
        const w = m ? workOf(m[1]) : null;
        const i = w ? issuesOf(w).find((x) => x.repo === m[2] && String(x.number) === m[3]) : null;
        if (!i) return c.page('Issue', '', [{ id: 'cd-ai', title: 'Issue', body: '<p class="mmc-hint">This issue is no longer listed.</p>' }]);
        const link = i.url && /^https?:\/\//.test(i.url) ? `<p><span class="mmc-link" data-act="open-link" data-arg="${esc(i.url)}">Open issue</span></p>` : '';
        return c.page(`${i.repo}#${i.number}`, '', [{ id: 'cd-ai', title: 'Issue', body: c.props([['Issue', esc(`${i.repo}#${i.number}`)], i.title ? ['Title', esc(i.title)] : null, ['Carried by', `<span class="mmc-link" data-act="work-goto" data-arg="${esc(w.id)}">${esc(w.title || String(w.id))}</span>`]].filter(Boolean)) + link }]);
    }

    function nodes() {
        const A = S.app ? S.app.url('assets').replace(/\/$/, '') : '/melaton-apps/claudedesk/assets';
        const open = S.open.map((id) => {
            const row = rowOf(id);
            return { id: `t:${id}`, name: titleOf(row || { id }), icon: sessIcon(id), desc: 'The session\'s conversation' };
        });
        const seen = new Set();
        const tops = (group) => { const items = group(); return items.filter((w) => w.parentId == null || w.parentId === '' || !items.some((x) => String(x.id) === String(w.parentId))).map((w) => workNode(w, A, seen, group)); };
        const runNodes = tops(runItems);
        const pendNodes = tops(pendItems);
        const reviewN = supReviews().filter((r) => !r.dismissed).length;
        const uns = unsupervisedActive().map((l) => sessionNode('us:', l.id, A));
        const cons = S.con.list.map((k) => ({
            id: `ct:${k.id}`,
            name: `${conName(k)}${k.revoked ? ' (revoked)' : (k.online ? '' : ' (offline)')}`,
            icon: k.revoked ? `${VI}/error-16.png` : (k.online ? `${ITEMS}/network-and-sharing-center-16.png` : `${VI}/warning-16.png`),
            desc: conState(k),
            children: conSessions(k).filter((x) => x && x.live !== false).map((x) => ({ id: `ctS:${k.id}:${x.id}`, name: x.title || shortId(x.id), icon: SESSION16, desc: 'A session on this contractor' }))
        }));
        const host = S.host && S.host.hostname ? S.host.hostname : '';
        return [{
            id: 'root',
            name: host ? `${TITLE} (${host})` : TITLE,
            icon: `${A}/claudedesk-16.png`,
            children: [
                { id: 'co-work', name: 'Work Queue', icon: '/static_images/vista-cmdbar/checklist.png', desc: 'Requests waiting for, starting on and running on an account',
                    children: [
                        { id: 'co-flow', name: 'Workflow', icon: '/static_images/vista-cmdbar/checklist.png', desc: 'Every open job: what runs in parallel, what runs in series and what waits on what' },
                        { id: 'co-held', name: `Waiting (${heldItems().length})`, icon: `${ITEMS}/date-and-time-16.png`, desc: 'New and imported requests that wait for you to start them' },
                        { id: 'co-input', name: `Input Required (${inputItems().length})`, icon: QUESTION16, desc: 'Work that stopped on a question only you can answer' },
                        { id: 'aw-sup', name: `Active (${runItems().length})`, icon: `${ITEMS}/parental-controls-16.png`, desc: 'Work items running now, their sessions and background agents', children: runNodes },
                        { id: 'co-pending', name: `Pending (${pendItems().length})`, icon: `${VI}/info-16.png`, desc: 'Work items waiting for an account to have room', children: pendNodes },
                        { id: 'aw-uns', name: `Unsupervised (${uns.length})`, icon: `${VI}/run-16.png`, desc: 'Sessions no work item owns that are working or were active in the last hour', children: uns },
                        { id: 'co-done', name: `Completed (${doneItems().length})`, icon: `${VI}/check-16.png`, desc: 'Work items done, failed or cancelled in the last 7 days' },
                        { id: 'aw-quiet', name: `Finished Sessions (${unsupervisedQuiet().length})`, icon: `${A}/session-ended-16.png`, desc: 'Sessions still open but idle for over an hour, with no work item' },
                        { id: 'sessions', name: 'All Sessions', icon: SESSION16, desc: 'Every Claude session on the host, running or ended', children: open }
                    ] },
                { id: 'activity', name: 'Activity', icon: `${ITEMS}/administrative-tools-16.png`, desc: 'Every shell command, tool call and file edit, the background agents, what it all cost, and who is coordinating',
                    children: bgNodes().concat([
                        { id: 'usage', name: 'Usage', icon: '/static_images/vista-cmdbar/pie-chart.png', desc: 'What each work item, session, turn and agent spent, and the heavy ones flagged', children: [{ id: 'usage-flags', name: `Flags (${usgOpenFlags()})`, icon: `${VI}/warning-16.png`, desc: 'Sessions, turns and agents that burned a lot of usage' }] },
                        {
                        id: 'co-root',
                        name: 'Coordination',
                        icon: `${ITEMS}/people-near-me-16.png`,
                        desc: 'The agents working now, their claims and messages',
                        children: [
                            { id: 'co-agents', name: 'Agents', icon: `${ITEMS}/user-accounts-16.png` },
                            { id: 'co-claims', name: 'Claims', icon: FOLDER16 },
                            { id: 'co-messages', name: 'Messages', icon: '/static_images/vista-cmdbar/mail.png' },
                            { id: 'co-builds', name: 'Build Gates', icon: `${ITEMS}/administrative-tools-16.png`, desc: 'Builds waiting until every agent is ready' },
                            { id: 'co-devices', name: `Device Queue (${devWaiting()})`, icon: '/static_images/vista-cmdbar/clock.png', desc: 'Who holds each shared test device (A53, Fold, test browsers) and who waits' },
                            { id: 'co-locks', name: 'Busy Locks', icon: `${ITEMS}/bitlocker-drive-encryption-16.png`, desc: 'The .agent-* busy locks in the repo' }
                        ].concat(S.inspect ? [{ id: `i:${S.inspect.id}`, name: `Inspect: ${inspectName()}`, icon: SESSION16, desc: 'What this agent is doing' }] : [])
                    }
                    ]) },
                { id: 'memory', name: 'Memory', icon: `${ITEMS}/personalization-16.png`, desc: 'The shared memory every Fleet agent reads and writes',
                    children: [
                        { id: 'mem-review', name: 'Needs Review', icon: `${VI}/warning-16.png`, desc: 'Proposed and flagged memories' },
                        { id: 'mem-digest', name: 'Session Digest', icon: `${VI}/info-16.png`, desc: 'The text every session starts with' },
                        { id: 'rules', name: 'Rules', icon: rulesIcon, desc: 'The rules the agents follow', children: [{ id: 'rules-review', name: `Rules Review (${plural(rulesOpenFindings().length, 'finding')})`, icon: `${ITEMS}/security-center-16.png`, desc: 'The Supervisor reads the rules and the memories for problems' }] }
                    ] },
                { id: 'co-supervisor', name: 'Supervisor', icon: `${ITEMS}/parental-controls-16.png`, desc: 'Settings, reviews, restart waits, pauses, locks and temp files',
                    children: [
                        managerSid()
                            ? { id: `mg:${managerSid()}`, name: 'Manager Session', icon: '/static_images/vista-cmdbar/tools.png', desc: 'The standing session that fixes Fleet and the Supervisor' }
                            : { id: 'sup-manager', name: 'Manager Session', icon: '/static_images/vista-cmdbar/tools.png', desc: 'Pick or start the session that fixes Fleet and the Supervisor' },
                        { id: 'sup-settings', name: 'Settings', icon: '/static_images/vista-cmdbar/properties.png', desc: 'Engine, model, delivery, limits and the models and effort per job' },
                        { id: 'sup-reviews', name: `Reviews (${reviewN})`, icon: '/static_images/vista-cmdbar/paste.png', desc: 'What the Supervisor made of each finished agent turn' },
                        { id: 'sup-asks', name: `Restart Waits (${supAsks().length})`, icon: '/static_images/vista-cmdbar/clock.png', desc: 'Agents waiting to restart Dreamscape' },
                        { id: 'sup-holds', name: `Paused Sessions (${supHolds().length})`, icon: '/static_images/vista-cmdbar/pause.png', desc: 'Sessions the Supervisor or you paused' },
                        { id: 'sup-locks', name: `Managed Locks (${supLocks().length})`, icon: '/static_images/vista-cmdbar/lock.png', desc: 'Busy locks the Supervisor keeps for agents' },
                        { id: 'sup-arts', name: `Work Folders (${supArtifacts().length})`, icon: FOLDER16, desc: 'Work folders and temp files the agents left' },
                        { id: 'sup-maint', name: 'Maintenance', icon: '/static_images/vista-cmdbar/tools.png', desc: 'The daily clean-up and health run: worktrees, branches, PRs, errors, disk, thermals' }
                    ] },
                { id: 'accounts', name: loginRows().length ? `Accounts (${loginRows().length} needs sign-in)` : 'Accounts', icon: loginRows().length ? `${VI}/warning-16.png` : `${A}/account-16.png`, desc: 'The Claude accounts of this host' },
                {
                    id: 'rc',
                    name: 'Remote Control',
                    icon: `${VI}/remote-access-16.png`,
                    desc: 'Every Claude account\'s own Remote Control',
                    children: [{ id: 'rc-host', name: 'Host Login', icon: `${ITEMS}/network-and-sharing-center-16.png`, desc: 'claude-remote.service: the host\'s own claude.ai login' }]
                },
                { id: 'contractors', name: 'Contractors', icon: `${ITEMS}/system-16.png`, desc: 'Other machines that run Fleet work on their own projects', children: cons }
            ]
        }];
    }

    // ---- pages --------------------------------------------------------------------------------------------

    function rcLine(c) {
        const st = S.rc && S.rc.state ? S.rc : ((S.host && S.host.remoteControl && S.host.remoteControl.status) || { state: 'unknown' });
        const text = RC_TEXT[st.state] || 'Unknown';
        const ok = st.state === 'connected';
        const lt = loginText();
        return `${c.state(ok, text, st.state === 'reconnecting')}${st.message && !ok ? ` <span class="mmc-hint">${esc(st.message)}</span>` : ''}${lt ? ` <span class="mmc-link" data-act="nav:accounts">${esc(lt)}</span>` : ''}`;
    }

    // ---- the Supervisor's cost and balances (Plan Usage; claude_desk_supervisor spend) ----------------------

    async function loadSpend() {
        const P = S.spend;
        if (P.loading) return;
        P.loading = true;
        try {
            const r = unwrap(await send('claude_desk_supervisor', { action: 'spend' }), 'spend');
            P.data = r.spend || null;
            P.error = '';
            P.gone = false;
        } catch (e) { if (isGone(e)) P.gone = true; else P.error = errText(e); }
        P.loading = false;
        P.loaded = true;
        repaint();
    }
    /** Dollars readable at any size: $12.34, $0.056, $0.0042, $0.00042 (never "$0.00" for a real cost), $0.00 for none. */
    function moneyText(n) {
        const v = Number(n) || 0;
        if (v <= 0) return '$0.00';
        if (v >= 1) return `$${v.toFixed(2)}`;
        if (v >= 0.1) return `$${v.toFixed(3)}`;
        if (v >= 0.01) return `$${v.toFixed(3)}`;
        if (v >= 0.001) return `$${v.toFixed(4)}`;
        return `$${v.toFixed(5)}`;
    }
    const countText = (n) => (Number(n) || 0).toLocaleString('en-US');
    /** One window's rows (per engine) as { cost, calls, tokens, prompt, completion, unpriced }. */
    function spendFigures(rows) {
        const list = Array.isArray(rows) ? rows : [];
        const sum = (k) => list.reduce((n, r) => n + (Number(r[k]) || 0), 0);
        return { cost: sum('cost'), calls: sum('calls'), prompt: sum('prompt'), completion: sum('completion'), tokens: sum('prompt') + sum('completion'), unpriced: sum('unpriced') };
    }
    function spendCell(label, f, why) {
        const un = f.unpriced ? `<span class="cd-spend-warn" title="${esc(why || '')}">${esc(plural(f.unpriced, 'call'))} without a price</span>` : '';
        return `<div class="cd-spend-cell"><span class="cd-spend-label">${esc(label)}</span><b class="cd-spend-cost">${esc(moneyText(f.cost))}</b><span class="cd-spend-sub">${esc(plural(f.calls, 'call'))}</span><span class="cd-spend-sub" title="${esc(`${countText(f.prompt)} in, ${countText(f.completion)} out`)}">${esc(countText(f.tokens))} tokens</span>${un}</div>`;
    }
    function supervisorSpendHtml(c) {
        const P = S.spend;
        if (!P.loaded && !P.loading) void loadSpend();
        if (P.gone) return '';
        const d = P.data;
        if (!d) return `<h4 class="cd-sp-h">Supervisor</h4><p class="${P.error ? 'cd-err' : 'mmc-hint'}">${esc(P.error || 'Reading the Supervisor\'s cost...')}</p>`;
        const run = d.active || d.configured || {};
        const fo = (d.failovers || [])[0] || null;
        const ref = d.lastRefusal || null;
        const money = !!(ref && /fund|balance|credit|billing|payment|quota|insufficient|402/i.test(ref.error || ''));
        let bar = '';
        if (d.failedOver || money) {
            const text = fo ? `The Supervisor ran out of funds on ${fo.fromEngine} and moved to ${fo.toEngine} (${when(fo.at)}).` : `The Supervisor ran out of funds${ref && ref.engine ? ` on ${ref.engine}` : ''} (${when(ref && ref.at)}).`;
            bar = `<div class="cd-infobar is-cost" role="alert"><img src="${VI}/error-16.png" alt=""><span>${esc(text)}${ref && ref.error ? ` ${esc(ref.error)}` : ''}</span></div>`;
        }
        const w = d.windows || {};
        const bal = (d.balances || []).map((b) => `${esc(b.name || b.title || b.engine)}: ${esc(b.balanceText || (b.balance != null ? `${b.balance}${b.currency ? ` ${b.currency}` : ''}` : (b.error || 'unknown')))}`);
        const why = (d.unpricedWhy || []).map((u) => `${u.engine}/${u.model || '?'}: ${plural(u.calls, 'call')} (the provider sent no cost and the catalog has no price for the model)`).join('; ');
        return `<h4 class="cd-sp-h">Supervisor</h4>${bar}<div class="cd-spend">${spendCell('Today', spendFigures(w.today), why)}${spendCell('7 days', spendFigures(w.week), why)}${spendCell('30 days', spendFigures(w.month), why)}</div>${c.props([
            ['Runs on', esc([run.engine, run.model].filter(Boolean).join(' / ') || 'Not set')],
            ['Balances', bal.length ? bal.join('<br>') : 'None reported']
        ])}`;
    }

    // ---- Last 30 days: the Supervisor's cost and each account's usage per day (claude_desk_supervisor usage_history) ----

    async function loadHistory() {
        const P = S.hist;
        if (P.loading) return;
        P.loading = true;
        try {
            P.data = unwrap(await send('claude_desk_supervisor', { action: 'usage_history', days: 30 }), 'usage_history').history || null;
            P.error = '';
            P.gone = false;
        } catch (e) { if (isGone(e)) P.gone = true; else P.error = errText(e); }
        P.loading = false;
        P.loaded = true;
        P.at = Date.now();
        repaint();
    }
    const dayLabel = (day, full) => {
        const [y, m, d] = String(day).split('-').map(Number);
        return full ? new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }) : String(d);
    };
    /** Day columns, newest at the right: cost bars on top, then one lane per account (bar = session peak %, line = weekly %). */
    function historyHtml() {
        const P = S.hist;
        if (!P.loaded && !P.loading) void loadHistory();
        else if (P.loaded && !P.loading && Date.now() - P.at > 300000) void loadHistory();
        if (P.gone) return '';
        const h = P.data;
        if (!h) return `<p class="${P.error ? 'cd-err' : 'mmc-hint'}">${esc(P.error || 'Reading the daily history...')}</p>`;
        const days = h.days || [];
        const n = days.length;
        if (!n) return '<p class="mmc-hint">No history yet.</p>';
        const colW = 18; const gutter = 100; const right = 8;
        const W = gutter + n * colW + right;
        const costH = 64; const laneH = 40; const gap = 14; const axisH = 22;
        const accs = h.accounts || [];
        const H = 14 + costH + gap + accs.length * (laneH + gap) + axisH;
        const x = (i) => gutter + i * colW;
        const parts = [];
        const maxCost = Math.max(0, ...days.map((d) => (h.supervisor[d] ? h.supervisor[d].cost : 0)));
        parts.push(`<text class="cd-ch-lane" x="4" y="26">Supervisor cost</text><text class="cd-ch-tick" x="4" y="40">${esc(maxCost > 0 ? `top ${moneyText(maxCost)}` : 'no cost yet')}</text>`);
        parts.push(`<line class="cd-ch-grid" x1="${gutter}" y1="${14 + costH}" x2="${W - right}" y2="${14 + costH}"/>`);
        days.forEach((d, i) => {
            const r = h.supervisor[d];
            const bh = r && r.cost > 0 && maxCost > 0 ? Math.max(2, Math.round((r.cost / maxCost) * (costH - 4))) : 0;
            const tip = r ? `${dayLabel(d, true)}: ${moneyText(r.cost)}, ${plural(r.calls, 'call')}, ${countText(r.tokens)} tokens${r.unpriced ? `, ${r.unpriced} unpriced` : ''}` : `${dayLabel(d, true)}: no Supervisor calls`;
            parts.push(`<g><title>${esc(tip)}</title><rect class="cd-ch-hit" x="${x(i)}" y="14" width="${colW}" height="${costH}"/>${bh ? `<rect class="cd-ch-cost" x="${x(i) + 3}" y="${14 + costH - bh}" width="${colW - 6}" height="${bh}"/>` : ''}</g>`);
        });
        accs.forEach((a, k) => {
            const top = 14 + costH + gap + k * (laneH + gap);
            const nm = String(a.name || a.id);
            parts.push(`<text class="cd-ch-lane" x="4" y="${top + 14}">${esc(nm.length > 14 ? `${nm.slice(0, 13)}...` : nm)}<title>${esc(nm)}</title></text><text class="cd-ch-tick" x="4" y="${top + 28}">session / week %</text>`);
            parts.push(`<line class="cd-ch-grid" x1="${gutter}" y1="${top + laneH}" x2="${W - right}" y2="${top + laneH}"/><line class="cd-ch-grid is-dash" x1="${gutter}" y1="${top}" x2="${W - right}" y2="${top}"/>`);
            const pts = [];
            days.forEach((d, i) => {
                const r = a.days[d];
                const s1 = r && r.session != null ? r.session : null;
                const w1 = r && r.week != null ? r.week : null;
                const tip = r ? `${a.name || a.id}, ${dayLabel(d, true)}: session peak ${s1 != null ? `${Math.round(s1)}%` : 'unknown'}, weekly ${w1 != null ? `${Math.round(w1)}%` : 'unknown'}` : `${a.name || a.id}, ${dayLabel(d, true)}: not read`;
                const bh = s1 != null && s1 > 0 ? Math.max(2, Math.round(Math.min(100, s1) / 100 * (laneH - 2))) : 0;
                parts.push(`<g><title>${esc(tip)}</title><rect class="cd-ch-hit" x="${x(i)}" y="${top}" width="${colW}" height="${laneH}"/>${bh ? `<rect class="cd-ch-sess" x="${x(i) + 3}" y="${top + laneH - bh}" width="${colW - 6}" height="${bh}"/>` : ''}</g>`);
                if (w1 != null) pts.push(`${x(i) + colW / 2},${top + laneH - Math.round(Math.min(100, w1) / 100 * (laneH - 2))}`);
            });
            if (pts.length > 1) parts.push(`<polyline class="cd-ch-week" points="${pts.join(' ')}"/>`);
            pts.forEach((pt) => { const [px, py] = pt.split(','); parts.push(`<circle class="cd-ch-dot" cx="${px}" cy="${py}" r="2.5"/>`); });
        });
        const axisY = H - 8;
        days.forEach((d, i) => {
            if ((n - 1 - i) % 3 !== 0) return;
            const first = i === n - 1 || d.endsWith('-01');
            parts.push(`<text class="cd-ch-tick is-day" x="${x(i) + colW / 2}" y="${axisY}" text-anchor="middle">${esc(first ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : dayLabel(d))}</text>`);
        });
        const have = days.filter((d) => h.supervisor[d] || accs.some((a) => a.days[d])).length;
        const note = have < 2 ? '<p class="mmc-hint">History starts today; each day fills in as the usage is read.</p>' : '';
        const legend = '<div class="cd-ch-legend"><span><i class="cd-ch-sw is-cost"></i>Supervisor cost per day</span><span><i class="cd-ch-sw is-sess"></i>Highest session use of the day</span><span><i class="cd-ch-sw is-week"></i>Weekly use</span></div>';
        return `${legend}<div class="cd-ch-scroll"><svg class="cd-ch" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Last 30 days: the Supervisor's cost and each account's usage per day">${parts.join('')}</svg></div>${note}`;
    }

    /**
     * The dashboard on Fleet's main page (Yukimi, Nov 24 2026: "a dashboard so I can see the work queue that's active"):
     * count tiles that open their list, the work running now, and what waits for her to pick it.
     */
    function dashboardSections(c) {
        if (!S.sup.loaded && !S.sup.loading) void loadSupervisor();
        const run = runItems();
        const sentBack = supWork().filter((w) => w.state === 'waiting');
        const held = heldItems();
        const busy = S.live.filter((s) => s.status === 'busy').length;
        const gaps = supReviews().filter((r) => r.verdict === 'gaps' && !r.dismissed && !r.delivered).length;
        const tile = (nav, icon, n, label, warn, extra) => `<button type="button" class="cd-tile${warn && n ? ' is-warn' : ''}" data-act="nav:${nav}" title="${esc(extra ? `${label}: ${extra}` : label)}"><img src="${esc(icon)}" alt=""><b>${n}</b><span>${esc(label)}</span>${extra ? `<small>${esc(extra)}</small>` : ''}</button>`;
        const tiles = `<div class="cd-tiles">${[
            tile('aw-sup', '/static_images/vista-cmdbar/play.png', run.length, 'Running work'),
            tile('co-input', QUESTION16, inputItems().length, 'Input required', true),
            tile('co-held', `${ITEMS}/date-and-time-16.png`, held.length, 'Waiting for you'),
            tile('co-pending', `${VI}/info-16.png`, pendItems().length, 'Queued'),
            tile('aw-sup', SENTBACK16, sentBack.length, 'Sent back', true),
            // one number per tile: running sessions and the ones working now are two tiles (Yukimi, Nov 24 2026)
            tile('sessions', SESSION16, S.live.length, 'Sessions running'),
            tile('sessions', '/static_images/vista-cmdbar/gears.png', busy, 'Sessions working'),
            tile('bg-agents', `${ITEMS}/programs-and-features-16.png`, bgRunning().length, 'Background agents'),
            tile('sup-reviews', '/static_images/vista-cmdbar/paste.png', gaps, 'Reviews with gaps', true),
            tile('sup-asks', '/static_images/vista-cmdbar/clock.png', supAsks().length, 'Restart waits', true),
            tile('co-devices', '/static_images/vista-cmdbar/clock.png', devWaiting(), 'Device waits', true),
            tile('sup-holds', '/static_images/vista-cmdbar/pause.png', supHolds().length, 'Paused', true),
            tile('usage-flags', `${VI}/warning-16.png`, usgOpenFlags(), 'Heavy usage', true),
            tile('accounts', `${VI}/warning-16.png`, loginRows().length, 'Need sign-in', true, loginRows().length ? loginRows().map((f) => f.name).join(', ') : '')
        ].join('')}</div>`;
        const live = run; // Sent Back items are in it (WORK_RUN)
        const row = (w) => `<tr class="cd-dash-row" data-act="${w.state === 'held' ? 'nav:co-held' : (w.state === 'input' ? 'nav:co-input' : `nav:aw:w:${esc(w.id)}`)}"><td class="cd-cut" title="${esc(w.title || String(w.id))}"><img class="mmc-row-icon" src="${esc(workIcon(w.state))}" alt="">${esc(w.title || String(w.id))}</td><td class="cd-cut" title="${esc(workState(w))}">${esc(workState(w))}</td><td class="cd-cut" title="${esc(w.account && w.account.name ? w.account.name : (w.account || ''))}">${esc(w.account && w.account.name ? w.account.name : (w.account || ''))}</td><td class="cd-cut" title="${esc([w.model, w.effort].filter(Boolean).join(' / '))}">${esc([w.model, w.effort].filter(Boolean).join(' / '))}</td><td class="cd-cut" title="${esc(w.startedAt ? when(w.startedAt) : '')}">${esc(w.startedAt ? when(w.startedAt) : '')}</td><td class="cd-cut" title="${esc(w.message || '')}">${esc(w.message || '')}</td></tr>`;
        const table = (list, empty) => (list.length
            ? `<table class="cd-table cd-dash"><thead><tr><th>Request</th><th class="cd-w80">State</th><th class="cd-w80">Account</th><th>Model</th><th>Started</th><th>Note</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>`
            : `<p class="mmc-hint">${esc(empty)}</p>`);
        const heldTop = held.slice(0, 8);
        const inp = inputItems();
        return [
            { id: 'cd-dash-tiles', title: 'Dashboard', body: tiles },
            { id: 'cd-dash-days', title: 'Last 30 days', body: historyHtml() }
        ].concat(inp.length ? [{ id: 'cd-dash-input', title: `Input Required (${inp.length})`, body: table(inp.slice(0, 8), 'Nothing needs your input.') + '<p><span class="mmc-link" data-act="nav:co-input">Answer them</span></p>' }] : []).concat([
            { id: 'cd-dash-active', title: `Active Work (${live.length})`, body: table(live, 'No work is running. Pick requests in Waiting and start them.') + (live.length ? '<p><span class="mmc-link" data-act="nav:aw-sup">Open Active</span> &nbsp; <span class="mmc-link" data-act="nav:co-flow">Open Workflow</span></p>' : '<p><span class="mmc-link" data-act="nav:co-flow">Open Workflow</span></p>') },
            { id: 'cd-dash-held', title: `Waiting for You (${held.length})`, body: table(heldTop, 'Nothing is waiting for you.') + (held.length ? `<p><span class="mmc-link" data-act="nav:co-held">${held.length > heldTop.length ? `See all ${held.length}` : 'Open Waiting'}</span></p>` : '') }
        ]);
    }

    function rootPage(c) {
        const A = S.app.url('assets').replace(/\/$/, '');
        const act = activeAccount();
        const rc = S.host && S.host.remoteControl;
        const busy = S.live.filter((s) => s.status === 'busy').length;
        const agents = S.coord.agents.filter((a) => a.kind !== 'person');
        const overview = c.overview(`${A}/claudedesk-32.png`, [
            'Fleet manages the Claude accounts of this server, its Remote Control, the Claude sessions running on it and the agents coordinating on it.',
            'Sessions started here (in Remote Control when you tick it) outlive a Dreamscape restart, and can run on either account at the same time.'
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
            ]) + `<p><span class="mmc-link" data-act="nav:sessions">All sessions</span> &nbsp; <span class="mmc-link" data-act="new-session">New session...</span></p>` },
            { id: 'cd-sum-coord', title: 'Coordination', body: c.props([
                ['Agents working', String(agents.length)],
                ['Files claimed', String(S.coord.claims.length)],
                ['Build gates open', String((S.coord.builds || []).filter((b) => b.state === 'open' || b.state === 'running').length)]
            ]) + `<p><span class="mmc-link" data-act="nav:co-agents">Agents</span> &nbsp; <span class="mmc-link" data-act="nav:co-builds">Build gates</span></p>` }
        ];
        return c.page(S.host && S.host.hostname ? `${TITLE} (${S.host.hostname})` : TITLE, S.error ? `Error: ${S.error}` : '', dashboardSections(c).concat([{ id: 'cd-sum-usage', title: 'Plan Usage', body: `<div class="cd-usage">${usageHtml()}</div>${supervisorSpendHtml(c)}` }]).concat(sections, [{ id: 'cd-sum-overview', title: 'About Fleet', body: overview }]));
    }

    const ACCOUNT_COLS = [
        { t: 'Name', w: 170, key: 'name', text: (d) => d.name },
        { t: 'Status', w: 150, key: 'status', text: (d) => d.status },
        { t: 'Remote Control Login', w: 200, key: 'login', text: (d) => d.login },
        { t: 'Plan', w: 70, key: 'plan', text: (d) => d.plan },
        { t: 'Running', w: 60, key: 'running', num: true, text: (d) => String(d.running), value: (d) => d.running }
    ];

    function accountsPage(c) {
        const A = S.app.url('assets').replace(/\/$/, '');
        const rows = S.accounts.map((a) => {
            const loginState = (fleetOf(a.index) || {}).availability;
            const status = [loginState && loginState.state === 'login' ? 'Sign in again' : '', a.active ? 'Engine' : '', a.onHost ? 'On host' : '', isPreferred(a.index) ? 'Preferred' : '', priorityTag(a.index)].filter(Boolean).join(', ') || (a.remoteLogin ? 'Ready' : 'No login linked');
            const running = S.sessions.filter((s) => s.account && s.account.index === a.index && liveOf(s.id)).length;
            return {
                key: `a:${a.index}`,
                icon: loginState && loginState.state === 'login' ? `${VI}/warning-16.png` : `${A}/account-16.png`,
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
        { t: 'Account', w: 170, min: 90, key: 'name', text: (d) => d.name },
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
                name: fleetTags(f) ? `${f.name} (${fleetTags(f)})` : f.name,
                stateText: RC_TEXT[f.state] || f.state,
                stateHtml: fleetState(c, f),
                folder: f.moved ? 'Own folder' : (f.onHost ? 'Host login' : 'None'),
                sessions: (f.sessions || []).length,
                status: f.statusLine || f.message || ''
            }
        }));
        const empty = S.fleetError ? `Remote Control could not be read. ${S.fleetError}` : (S.fleet ? 'There are no Claude accounts.' : 'Reading every account\'s Remote Control...');
        const lv = c.listView(FLEET_COLS, rows, { sortId: 'cd-fleet', empty, fit: true });
        const bars = fleetRows().map((f) => availBar(f, true)).join('');
        return bars ? { html: `<div class="cd-list-wrap">${bars}${lv}</div>`, list: true, split: true } : { html: lv, list: true };
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
                icon: sessIcon(r.id),
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
            icon: a.kind === 'person' ? `${ITEMS}/user-accounts-16.png` : SESSION16,
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

    // ---- Device Queue: the shared test devices, their holder and the agents waiting in order ----------------

    const devData = () => (S.coord.devices && Array.isArray(S.coord.devices.devices) ? S.coord.devices.devices : []);
    const devWaiting = () => (S.coord.devices && S.coord.devices.waiting) || 0;
    const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

    function devicesPage(c) {
        const rows = devData().map((d) => ({
            key: `d:${d.device}`,
            icon: '/static_images/vista-cmdbar/clock.png',
            cls: d.holder ? 'cd-live' : '',
            data: {
                device: d.label === d.device ? d.device : `${d.label} (${d.device})`,
                holder: d.holder ? d.holder.name : 'Free',
                why: d.holder ? d.holder.why : '',
                left: d.holder ? d.holder.minutesLeft : 0,
                until: d.holder ? clock(d.holder.endsAt) : '',
                waiting: d.queue.map((q, i) => `${i + 1}. ${q.name}`).join(', ')
            }
        }));
        return {
            html: c.listView([
                { t: 'Device', w: 200, key: 'device', text: (d) => d.device },
                { t: 'Held By', w: 150, key: 'holder', text: (d) => d.holder },
                { t: 'Testing', w: 220, key: 'why', text: (d) => d.why },
                { t: 'Time Left', w: 80, key: 'left', num: true, text: (d) => (d.until ? `${d.left} min` : ''), value: (d) => d.left },
                { t: 'Until', w: 60, key: 'until', text: (d) => d.until },
                { t: 'Waiting (In Order)', w: 260, key: 'waiting', text: (d) => d.waiting }
            ], rows, { sortId: 'cd-devices', sort: { key: 'device', dir: 1 }, empty: 'No device is known yet. Agents take one with coord_device_request before they test on it.', fit: true }),
            list: true
        };
    }

    async function devRelease(c) {
        const key = selId(c, 'd:');
        const d = devData().find((x) => x.device === key);
        if (!d || !d.holder) {
            await c.box(`<p>${d ? `${esc(d.label)} is free.` : 'Select a device that is in use first.'}</p>`, null, { icon: 'info', title: 'Release Device', width: 360 });
            return;
        }
        const ok = await c.box(`<p>Take <b>${esc(d.label)}</b> away from ${esc(d.holder.name)}${d.holder.why ? ` (${esc(d.holder.why)})` : ''}? ${d.queue.length ? `${esc(d.queue[0].name)} is next in line and is told.` : 'Nobody is waiting.'} The holder is told too.</p>`,
            [{ text: 'Release', value: true, className: 'btn-standard primary' }, { text: 'Close', value: false, className: 'btn-standard' }], { icon: 'warning', title: 'Release Device', width: 420 });
        if (ok !== true) return;
        try {
            const r = await send('claude_desk_coord', { action: 'device_release', device: d.device });
            if (r.agents) S.coord = { agents: r.agents, claims: r.claims || [], builds: r.builds || [], devices: r.devices || S.coord.devices, lastMessageId: r.lastMessageId || S.coord.lastMessageId };
            c.refresh();
        } catch (e) { await failBox(c, e); }
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
        const table = (head, rows) => (rows.length ? `<table class="cd-table"><colgroup>${head.map(([, w]) => `<col${w ? ` class="cd-w${w}"` : ''}>`).join('')}</colgroup><thead><tr>${head.map(([h]) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="mmc-hint">None.</p>');
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

    // -- markdown begin
    // Markdown to HTML for the chat: the text is escaped first, then marked up; no raw HTML passes through, a link
    // keeps only an http(s) / mailto address, and a click on it opens Alchemy (Melaton's browser), see chatClick.
    const MD_SAFE_URL = /^(https?:\/\/|mailto:)/i;
    const MD_MARK = /[]/g;
    function mdInline(raw) {
        const stash = [];
        const hold = (html) => { stash.push(html); return `${stash.length - 1}`; };
        let t = String(raw == null ? '' : raw).replace(MD_MARK, '');
        t = t.replace(/(`+)([^`\n]|[^`\n][^\n]*?[^`\n])\1(?!`)/g, (m, f, code) => hold(`<code>${esc(code.trim())}</code>`));
        t = esc(t);
        const emph = (x) => x
            .replace(/\*\*(?!\s)([^\n]+?)(?<!\s)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^\w])__(?!\s)([^\n]+?)(?<!\s)__(?!\w)/g, '$1<strong>$2</strong>')
            .replace(/(^|[^\w*])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![\w*])/g, '$1<em>$2</em>')
            .replace(/(^|[^\w])_(?![\s_])([^_\n]+?)(?<![\s_])_(?!\w)/g, '$1<em>$2</em>')
            .replace(/~~(?!\s)([^\n]+?)(?<!\s)~~/g, '<del>$1</del>');
        const link = (label, url) => {
            const plain = url.replace(/&amp;/g, '&');
            return MD_SAFE_URL.test(plain) ? hold(`<a class="cd-md-a" href="${url}" rel="noopener noreferrer">${emph(label)}</a>`) : emph(label);
        };
        t = t.replace(/!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+&quot;[^\n]*?&quot;)?\)/g, (m, alt, url) => link(alt || 'image', url));
        t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+&quot;[^\n]*?&quot;)?\)/g, (m, label, url) => link(label, url));
        t = t.replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'])/g, (m, pre, url) => pre + hold(`<a class="cd-md-a" href="${url}" rel="noopener noreferrer">${url}</a>`));
        t = emph(t);
        for (let i = 0; i < 4 && /\d+/.test(t); i += 1) t = t.replace(/(\d+)/g, (m, n) => stash[Number(n)] || '');
        return t;
    }
    const MD_FENCE = /^\s{0,3}(```+|~~~+)\s*([\w+#.-]*)[^\n]*$/;
    const MD_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
    const MD_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
    const MD_TABLE_RULE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
    const mdCells = (line) => { const s = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, ''); return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim()); };
    function mdBlocks(lines, tight, depth) {
        if (depth > 6) return `<p>${esc(lines.join('\n'))}</p>`;
        let out = '';
        let i = 0;
        const startsBlock = (l, next) => MD_FENCE.test(l) || /^\s{0,3}#{1,6}\s/.test(l) || MD_HR.test(l) || /^\s{0,3}>/.test(l) || MD_ITEM.test(l) || (l.includes('|') && next !== undefined && MD_TABLE_RULE.test(next));
        while (i < lines.length) {
            const line = lines[i];
            if (!line.trim()) { i += 1; continue; }
            const fence = MD_FENCE.exec(line);
            if (fence) {
                const body = [];
                i += 1;
                while (i < lines.length && !(lines[i].trim().startsWith(fence[1]) && /^\s*[`~]+\s*$/.test(lines[i]))) { body.push(lines[i]); i += 1; }
                i += 1;
                out += `<pre class="cd-md-code"${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`;
                continue;
            }
            const head = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
            if (head) { out += `<h${head[1].length} class="cd-md-h">${mdInline(head[2])}</h${head[1].length}>`; i += 1; continue; }
            if (MD_HR.test(line)) { out += '<hr class="cd-md-hr">'; i += 1; continue; }
            if (/^\s{0,3}>/.test(line)) {
                const q = [];
                while (i < lines.length && /^\s{0,3}>/.test(lines[i])) { q.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i += 1; }
                out += `<blockquote class="cd-md-q">${mdBlocks(q, false, depth + 1)}</blockquote>`;
                continue;
            }
            if (line.includes('|') && i + 1 < lines.length && MD_TABLE_RULE.test(lines[i + 1])) {
                const heads = mdCells(line);
                const aligns = mdCells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? ' class="cd-md-c"' : (/-:$/.test(c) ? ' class="cd-md-r"' : '')));
                const rows = [];
                i += 2;
                while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(mdCells(lines[i])); i += 1; }
                out += `<div class="cd-md-scroll"><table class="cd-md-table"><thead><tr>${heads.map((c, n) => `<th${aligns[n] || ''}>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${heads.map((c, n) => `<td${aligns[n] || ''}>${mdInline(r[n] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
                continue;
            }
            const item = MD_ITEM.exec(line);
            if (item) {
                const base = item[1].length;
                const ordered = /\d/.test(item[2]);
                const start = ordered ? parseInt(item[2], 10) : 0;
                const items = [];
                while (i < lines.length) {
                    const m = MD_ITEM.exec(lines[i]);
                    if (m && m[1].length < base + 2 && /\d/.test(m[2]) === ordered && !MD_HR.test(lines[i])) {
                        items.push([m[3]]);
                        i += 1;
                    } else if (m && m[1].length < base + 2 && !MD_HR.test(lines[i])) {
                        break; // the other kind of list at this level
                    } else if (items.length && lines[i].trim() && (/^\s/.test(lines[i]) || !startsBlock(lines[i], lines[i + 1]))) {
                        items[items.length - 1].push(lines[i]); // nested content, or a wrapped line
                        i += 1;
                    } else if (items.length && !lines[i].trim() && i + 1 < lines.length && (/^\s{2,}\S/.test(lines[i + 1]) || (MD_ITEM.exec(lines[i + 1]) && MD_ITEM.exec(lines[i + 1])[1].length < base + 2 && /\d/.test(MD_ITEM.exec(lines[i + 1])[2]) === ordered))) {
                        items[items.length - 1].push(''); // a blank line inside the list
                        i += 1;
                    } else break;
                }
                const lis = items.map((it) => {
                    const first = it[0];
                    const rest = it.slice(1);
                    const pad = rest.filter((l) => l.trim()).reduce((n, l) => Math.min(n, /^\s*/.exec(l)[0].length), 99);
                    const body = rest.map((l) => l.slice(Math.min(pad === 99 ? 0 : pad, /^\s*/.exec(l)[0].length)));
                    const task = /^\[([ xX])\]\s+/.exec(first);
                    const lead = task ? `${task[1] === ' ' ? '☐' : '☑'} ` : '';
                    const text = task ? first.slice(task[0].length) : first;
                    const tail = body.length ? mdBlocks(body, true, depth + 1) : '';
                    return `<li>${lead}${mdInline(text)}${tail}</li>`;
                }).join('');
                out += ordered ? `<ol class="cd-md-l"${start > 1 ? ` start="${start}"` : ''}>${lis}</ol>` : `<ul class="cd-md-l">${lis}</ul>`;
                continue;
            }
            const para = [];
            while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines[i], lines[i + 1]))) { para.push(lines[i]); i += 1; }
            const html = para.map((l) => mdInline(l)).join('<br>');
            out += tight ? `<div class="cd-md-t">${html}</div>` : `<p class="cd-md-p">${html}</p>`;
        }
        return out;
    }
    function mdHtml(text) {
        return mdBlocks(String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n'), false, 0);
    }
    // -- markdown end

    // -- sendfile begin
    // Claude's SendUserFile calls are user-facing: one inline card per file, shown even while tool calls are hidden.
    // The bytes come by URL from the server (modules/claudeDeskFiles.js), which serves only what that session sent.
    const FILE_ICON = `${VI}/explorer/file-16.png`;
    const fileUrl = (sid, p, dl) => `/claude-desk/file/${encodeURIComponent(sid)}?path=${encodeURIComponent(p)}${dl ? '&dl=1' : ''}`;
    function sizeText(n) {
        const v = Number(n) || 0;
        if (v < 1024) return `${v} B`;
        if (v < 1048576) return `${(v / 1024).toFixed(v < 10240 ? 1 : 0)} KB`;
        return `${(v / 1048576).toFixed(v < 10485760 ? 1 : 0)} MB`;
    }
    function fileCardHtml(m, k) {
        const files = Array.isArray(m.files) ? m.files : [];
        const cards = files.map((f, n) => {
            const ok = !!m.sid && !f.missing;
            const url = ok ? fileUrl(m.sid, f.path, false) : '';
            const data = `data-cd-sid="${esc(m.sid || '')}" data-cd-file="${esc(f.path)}" data-cd-kind="${esc(f.type || 'other')}" data-cd-name="${esc(f.name || '')}" data-cd-size="${Number(f.size) || 0}"`;
            if (f.type === 'image' && ok) {
                return `<div class="cd-file is-image" ${data}><button type="button" class="cd-file-thumb" data-cd-fopen title="${esc(f.path)}"><img src="${esc(url)}" alt="${esc(f.name)}" loading="lazy"></button><div class="cd-file-row"><span class="cd-file-name">${esc(f.name)}</span><span class="cd-file-size">${esc(sizeText(f.size))}</span><button type="button" class="btn-standard" data-cd-fsave>Save</button></div></div>`;
            }
            const open = ok && f.type !== 'other';
            return `<div class="cd-file" ${data}><img class="cd-file-ico" src="${FILE_ICON}" alt=""><div class="cd-file-info"><span class="cd-file-name" title="${esc(f.path)}">${esc(f.name)}</span><span class="cd-file-size">${esc(f.missing ? 'No longer on this host' : (ok ? sizeText(f.size) : 'Not available here'))}</span></div>${open ? '<button type="button" class="btn-standard" data-cd-fopen>Open</button>' : ''}${ok ? '<button type="button" class="btn-standard" data-cd-fsave>Save</button>' : ''}</div>`;
        }).join('');
        const cap = m.caption ? `<div class="cd-file-cap cd-md">${mdHtml(m.caption)}</div>` : '';
        return `<div class="cd-msg cd-files"${k}><div class="cd-msg-head"><b>${esc(WHO.assistant)}</b><span>${esc(timeOnly(m.time))}</span></div>${cards}${cap}</div>`;
    }
    /** Open a file card: images and text in a Fleet window, a PDF in Adobe Reader. */
    async function openFile(el) {
        const sid = el.dataset.cdSid;
        const p = el.dataset.cdFile;
        const kind = el.dataset.cdKind;
        const name = el.dataset.cdName || baseName(p);
        const url = fileUrl(sid, p, false);
        if (kind === 'pdf') {
            if (root.melatonApps && typeof root.melatonApps.launch === 'function') { void root.melatonApps.launch({ packageId: 'reader', args: { url, name, size: Number(el.dataset.cdSize) || 0, location: 'Fleet' } }); return; }
        }
        if (!S.c) return;
        const key = `file|${sid}|${p}`;
        const have = Array.from(S.wins).find((x) => x.key === key);
        if (have) { call('bringModalToFront', have.modal); return; }
        if (kind === 'image') { openViewer({ key, title: name, body: `<img class="cd-viewer-img" src="${esc(url)}" alt="${esc(name)}">` }); return; }
        const w = openViewer({ key, title: name, body: '<p class="mmc-hint">Reading...</p>' });
        try {
            const r = await fetch(url, { credentials: 'same-origin' });
            if (!r.ok) throw new Error(r.status === 403 ? 'This session did not send that file.' : `The server answered ${r.status}.`);
            const text = (await r.text()).slice(0, 2000000);
            w.set(/\.(md|markdown)$/i.test(name) ? `<div class="cd-md cd-viewer-md">${mdHtml(text)}</div>` : `<pre class="cd-pre cd-viewer-text">${esc(text)}</pre>`);
        } catch (e) { w.set(`<p class="cd-err">${esc(errText(e))}</p>`); }
    }
    function saveFile(el) {
        const a = document.createElement('a');
        a.href = fileUrl(el.dataset.cdSid, el.dataset.cdFile, true);
        a.download = el.dataset.cdName || '';
        a.hidden = true;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
    /** Clicks inside a chat log that are not folds: Markdown links (Alchemy) and file cards. True when handled. */
    function chatClick(ev) {
        const a = ev.target.closest && ev.target.closest('a.cd-md-a');
        if (a) {
            ev.preventDefault();
            const href = a.getAttribute('href') || '';
            if (!MD_SAFE_URL.test(href)) return true;
            if (typeof root.openGrimoireUrl === 'function') Promise.resolve().then(() => root.openGrimoireUrl(href)).catch(() => root.open(href, '_blank', 'noopener'));
            else root.open(href, '_blank', 'noopener');
            return true;
        }
        const card = ev.target.closest && ev.target.closest('.cd-file');
        if (!card) return false;
        if (ev.target.closest('[data-cd-fsave]')) { saveFile(card); return true; }
        if (ev.target.closest('[data-cd-fopen]')) { void openFile(card); return true; }
        return false;
    }
    // -- sendfile end

    const WHO = { user: 'You', assistant: 'Claude', tool: 'Result', system: 'Notice' };

    const baseName = (f) => String(f || '').split(/[\\/]/).filter(Boolean).pop() || String(f || '');
    const diffLines = (text, cls) => String(text || '').split('\n').map((l) => `<div class="cd-dl${cls ? ` ${cls}` : ''}">${esc(l) || '&nbsp;'}</div>`).join('');
    /** An edit's old and new text: removed lines red-tinted, added lines green-tinted; a write (no old text) shows the new text. */
    function editsHtml(edits) {
        const list = Array.isArray(edits) ? edits : [];
        return list.map((e, i) => {
            const hasOld = String(e.old || '') !== '';
            return `${list.length > 1 ? `<div class="cd-diff-n">Edit ${i + 1} of ${list.length}</div>` : ''}<div class="cd-diff${hasOld ? '' : ' is-one'}">`
                + `${hasOld ? `<div class="cd-diff-col"><div class="cd-diff-head">Removed</div><div class="cd-diff-body">${diffLines(e.old, 'is-del')}</div></div>` : ''}`
                + `<div class="cd-diff-col"><div class="cd-diff-head">${hasOld ? 'Added' : 'Written'}</div><div class="cd-diff-body">${diffLines(e.new, 'is-add')}</div></div></div>`;
        }).join('');
    }

    function messageHtml(m, showModel) {
        const k = ` data-at="${m.at}" data-k="${esc(msgKey(m))}"`;
        if (m.kind === 'summary') {
            // a run of hidden thinking / edits / tool calls: one row (counts and names only); it opens the items
            const rows = (m.items || []).map((it) => {
                const edit = it.of === 'edit';
                const label = edit ? `${it.tool === 'Write' ? 'Wrote' : 'Edited'} ${baseName(it.file) || 'a file'}` : (it.of === 'thinking' ? `Thinking (${plural(Number(it.size) || 0, 'character')})` : it.title);
                return `<div class="cd-fold is-${edit ? 'edit' : (it.of === 'thinking' ? 'thinking' : 'tool')}" data-at="${it.at}" data-part="${it.part == null ? 0 : it.part}" role="link" tabindex="0" title="${esc(edit && it.file ? it.file : 'Open in a window')}"><img src="${edit ? `${VI}/explorer/file-16.png` : `${VI}/info-16.png`}" alt=""><span>${esc(label)}</span></div>`;
            }).join('');
            return `<div class="cd-msg cd-sum"${k}><div class="cd-sum-head" role="button" tabindex="0" aria-expanded="false"><img src="${VI}/info-16.png" alt=""><span>${esc(m.label)}</span></div><div class="cd-sum-items" hidden>${rows}${m.more ? `<div class="mmc-hint">${m.more} more not listed.</div>` : ''}</div></div>`;
        }
        if (m.kind === 'fold') {
            // a thinking block or file edit the view keeps closed: one row that opens it in its own window
            const edit = m.of === 'edit';
            const label = edit ? `${m.tool === 'Write' ? 'Wrote' : 'Edited'} ${m.file ? baseName(m.file) : 'a file'} (${plural(Number(m.size) || 0, 'line')})` : `Thinking (${plural(Number(m.size) || 0, 'character')})`;
            return `<div class="cd-msg cd-fold is-${edit ? 'edit' : 'thinking'}"${k} data-part="${m.part == null ? 0 : m.part}" role="link" tabindex="0" title="${esc(edit && m.file ? m.file : 'Open in a window')}"><img src="${edit ? `${VI}/explorer/file-16.png` : `${VI}/info-16.png`}" alt=""><span>${esc(label)}</span></div>`;
        }
        if (m.kind === 'thinking') {
            return `<div class="cd-msg cd-block cd-think is-open"${k}><button type="button" class="cd-fold-head" data-cd-toggle><img src="${VI}/info-16.png" alt=""><span>Thinking (${plural(String(m.text || '').length, 'character')})</span></button><div class="cd-fold-body cd-msg-text">${esc(m.text)}</div></div>`;
        }
        if (m.kind === 'edit') {
            return `<div class="cd-msg cd-block cd-edit is-open"${k}><button type="button" class="cd-fold-head" data-cd-toggle title="${esc(m.file || '')}"><img src="${VI}/explorer/file-16.png" alt=""><span>${esc(`${m.tool === 'Write' ? 'Wrote' : 'Edited'} ${baseName(m.file) || 'a file'}`)}</span></button><div class="cd-fold-body">${editsHtml(m.edits)}</div></div>`;
        }
        if (m.kind === 'tool_use') {
            return `<div class="cd-msg cd-tool"${k}><div class="cd-tool-head"><b>${esc(m.tool)}</b></div><pre class="cd-pre">${esc(m.text)}</pre></div>`;
        }
        if (m.kind === 'tool_result') {
            const lines = String(m.text || '').split('\n');
            const long = lines.length > 6 || m.text.length > 500;
            return `<div class="cd-msg cd-result${m.error ? ' is-error' : ''}${long ? ' is-folded' : ''}"${k}><pre class="cd-pre">${esc(m.text || '(no output)')}</pre>${long ? '<button type="button" class="cd-unfold" data-cd-unfold>Show all</button>' : ''}</div>`;
        }
        if (m.kind === 'sendfile') return fileCardHtml(m, k);
        if (m.kind === 'command') return `<div class="cd-msg cd-note"${k}>${esc(m.text)}</div>`;
        if (m.role === 'system') return `<div class="cd-msg cd-note"${k}>${esc(m.text)}</div>`;
        const who = m.role === 'user' ? (m.origin && m.origin !== 'human' ? 'Steering' : WHO.user) : WHO[m.role] || m.role;
        return `<div class="cd-msg cd-${m.role === 'user' ? 'user' : 'claude'}${m.sidechain ? ' is-side' : ''}"${k}><div class="cd-msg-head"><b>${esc(who)}</b>${showModel && m.model ? `<i class="cd-model" title="${esc(m.model)}">${esc(modelName(m.model))}</i>` : ''}<span>${esc(timeOnly(m.time))}</span></div><div class="cd-msg-text cd-md">${mdHtml(m.text)}</div></div>`;
    }

    function logHtml(chat) {
        let out = '';
        let day = '';
        let prevModel = '';
        chat.messages.forEach((m) => {
            const k = m.time ? dateKey(m.time) : '';
            if (k && k !== day) { day = k; out += `<div class="cd-day">${esc(new Date(m.time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</div>`; }
            const sm = m.role === 'assistant' && m.kind === 'text' && !m.sidechain && m.model;
            out += messageHtml(m, !!(sm && prevModel && m.model !== prevModel));
            if (sm) prevModel = m.model;
        });
        return out;
    }

    /** The log's content: the earlier-messages row, the rows, and a line while the end is out of the page. */
    function logInner(chat, id) {
        const top = chat.more ? `<div class="cd-earlier"><button type="button" class="btn-standard" data-act="earlier" data-arg="${esc(id)}"${chat.loading ? ' disabled' : ''}>Show Earlier Messages</button></div>` : '';
        const body = chat.error ? `<p class="cd-err">${esc(chat.error)}</p>` : (chat.messages.length ? logHtml(chat) : `<p class="mmc-hint">${chat.loading ? 'Reading the conversation...' : 'No messages yet.'}</p>`);
        const bottom = chat.tailCut ? '<div class="cd-earlier"><span class="mmc-hint">Scroll down for later messages...</span></div>' : '';
        return top + body + bottom + (chat.tailCut ? '' : pendingHtml(chat)) + activityHtml(id);
    }

    /** The view options as links' check boxes under the title: what the log shows. */
    function showBar() {
        return `<div class="cd-showbar" role="group" aria-label="Show">${SHOW_ITEMS.map(([k, t]) => `<label class="cd-showopt"><input type="checkbox" data-cd-show="${k}"${S.show[k] ? ' checked' : ''}><span>${esc(t.replace(/^Show /, ''))}</span></label>`).join('')}</div>`;
    }

    // ---- the view options and the item windows (a folded thinking / file edit opened in full) ---------------

    const showMenuItems = () => SHOW_ITEMS.map(([k, t]) => ({ text: t, action: `show:${k}`, showIndicator: true, indicatorMark: 'check', checked: !!S.show[k] }));

    /** One view option changed: the open session reads its newest page again; the others read when opened. */
    async function setShow(key, on) {
        if (!(key in SHOW_DEFAULT)) return;
        S.show[key] = !!on;
        if (S.c) S.c.setReg({ ShowView: showNow() });
        const cur = S.c ? nodeSid(S.c.node) : '';
        Array.from(S.chats.keys()).forEach((id) => { if (id !== cur) S.chats.delete(id); });
        const chat = S.chats.get(cur);
        if (!chat) return;
        if (chat.dt) {
            chat.dt.agents = new Map();
            if (chat.dt.agentSel) void loadAgentPage(cur, chat.dt.agentSel, false);
        }
        await loadChat(cur, false);
    }

    /** A Vista window of its own (resizable, its own scroll bar, the app's icon) belonging to the console. */
    function openViewer(o) {
        const A = S.app.url('assets').replace(/\/$/, '');
        const parent = S.c.modal;
        const id = `claudeDeskView-${++S.winSeq}`;
        const made = call('desktopAppCreateWindow', { id, identifier: 'melatonClaudeDesk-view', title: o.title, icon16: `${A}/claudedesk-16.png`, taskbarIcon: `${A}/claudedesk-32.png`, className: 'resizeable-window owned-window cd-win' });
        if (!made) throw new Error('The window could not open.');
        const m = made.modal;
        m.dataset.windowRestorePosition = 'true';
        m.dataset.windowRestoreSize = 'true';
        m.dataset.windowDefaultWidth = '640';
        m.dataset.windowDefaultHeight = '420';
        m.dataset.windowMinWidth = '320';
        m.dataset.windowMinHeight = '200';
        m.style.width = '640px';
        m.style.height = '420px';
        m.dataset.iconOwnerId = parent.id;
        m.dataset.parentModalId = parent.id;
        made.content.classList.add('cd-win-content');
        made.content.innerHTML = `<div class="cd-viewer" tabindex="0">${o.body || ''}</div>`;
        made.close.classList.add('cd-win-x');
        const ctl = new AbortController();
        let closed = false;
        const w = {
            key: o.key,
            modal: m,
            set: (html) => { const b = m.querySelector('.cd-viewer'); if (b && !closed) b.innerHTML = html; },
            close: () => {
                if (closed) return;
                closed = true;
                ctl.abort();
                S.wins.delete(w);
                try { call('closeModal', m); } catch (_) { /* gone */ }
                setTimeout(() => m.remove(), 400);
            }
        };
        S.wins.add(w);
        m.addEventListener('click', (ev) => { if (ev.target.closest('.cd-win-x')) w.close(); }, { signal: ctl.signal });
        m.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); w.close(); } }, { signal: ctl.signal });
        document.addEventListener('staticforge:modal-lifecycle', (e) => { if (e && e.detail && e.detail.id === id && e.detail.type === 'closed') w.close(); }, { signal: ctl.signal });
        call('openModal', m);
        m.classList.remove('hidden');
        requestAnimationFrame(() => {
            const r = m.getBoundingClientRect();
            const p = parent.getBoundingClientRect();
            call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round(p.left + 40 + (S.wins.size % 5) * 24)), Math.max(0, Math.round(p.top + 40 + (S.wins.size % 5) * 24)));
            const b = m.querySelector('.cd-viewer');
            if (b && r) b.focus({ preventScroll: true });
        });
        return w;
    }

    /** The full content of a fold row (thinking text / a file's edits) in a window of its own. */
    async function openFold(id, agentId, el) {
        if (!el || !S.c) return;
        const at = Number(el.dataset.at);
        const part = Number(el.dataset.part) || 0;
        const key = `${id}|${agentId}|${at}|${part}`;
        const have = Array.from(S.wins).find((x) => x.key === key);
        if (have) { call('bringModalToFront', have.modal); return; }
        const edit = el.classList.contains('is-edit');
        const tool = el.classList.contains('is-tool');
        const label = (el.querySelector('span') || {}).textContent || '';
        const w = openViewer({ key, title: edit ? label.replace(/ \(\d+ lines?\)$/, '') : (tool ? label : 'Thinking'), body: '<p class="mmc-hint">Reading...</p>' });
        try {
            const r = agentId ? await send('claude_desk_session', { action: 'agent_page', id, agentId, item: { at, part } }) : await send('claude_desk_transcript', { id, item: { at, part } });
            const item = unwrap(r, 'item').item;
            if (!item) throw new Error('The server did not send it. Restart Dreamscape to load the newer session reader.');
            if (item.kind === 'edit') w.set(`<div class="cd-viewer-path">${esc(item.file || '')}</div>${editsHtml(item.edits)}`);
            else w.set(`<pre class="cd-pre cd-viewer-text">${esc(item.text || '')}</pre>`);
        } catch (e) { w.set(`<p class="cd-err">${esc(isGone(e) ? 'The server does not have this yet. Restart Dreamscape to load the newer session reader.' : errText(e))}</p>`); }
    }

    /** Fold rows of a log open on click / Enter / Space and from the right-click menu. kind '' = the session, 'agent' = the selected agent. */
    function wireFolds(box, id, kind) {
        if (!box || box.dataset.cdFolds) return;
        box.dataset.cdFolds = '1';
        const agentOf2 = () => { if (kind !== 'agent') return ''; const ch = chatOf(id); return (ch && ch.dt && ch.dt.agentSel) || ''; };
        box.addEventListener('click', (ev) => {
            if (chatClick(ev)) return;
            const t = ev.target.closest('[data-cd-toggle]');
            if (t) { t.parentElement.classList.toggle('is-open'); return; }
            const sm = ev.target.closest('.cd-sum-head');
            if (sm) { const open = sm.getAttribute('aria-expanded') !== 'true'; sm.setAttribute('aria-expanded', String(open)); sm.nextElementSibling.hidden = !open; return; }
            const r = ev.target.closest('.cd-fold');
            if (r) void openFold(id, agentOf2(), r);
        });
        box.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            const sm = ev.target.closest && ev.target.closest('.cd-sum-head');
            if (sm) { ev.preventDefault(); sm.click(); return; }
            const r = ev.target.closest && ev.target.closest('.cd-fold');
            if (r) { ev.preventDefault(); void openFold(id, agentOf2(), r); }
        });
        box.addEventListener('mousedown', (ev) => { if (ev.button === 2) { const r = ev.target.closest('.cd-fold'); S.foldCtx = r ? { id, agent: agentOf2(), el: r } : null; } });
        if (root.contextMenu) {
            root.contextMenu.attachToElement(box, {
                onAction: (a) => { if (S.c) void action(a, S.c); },
                sections: [{ type: 'list', initfn: (sec) => { sec.items = [{ text: 'Open in New Window', action: 'fold-open', disabled: !S.foldCtx }, { separator: true }].concat(showMenuItems()); } }]
            });
        }
    }

    // ---- attachments on a message (Attach..., paste, drop, Screenshot) -------------------------------------
    // Held as Blobs (thumbnails are object URLs, never data: strings); Send saves each on the server under the
    // session's folder and puts the absolute paths in the steer text. A phone screenshot is saved at once (path set).
    const ATT_MAX = 20 * 1048576;
    const ATT_ACCEPT = 'image/*,.png,.jpg,.jpeg,.gif,.webp,.bmp,.txt,.log,.md,.json,.csv,.xml';
    const attOf = (id) => { S.att = S.att || {}; return (S.att[id] = S.att[id] || []); };

    function attChipsHtml(id) {
        return attOf(id).map((a) => `<span class="cd-att${a.state === 'error' ? ' is-error' : ''}" title="${esc(a.state === 'error' ? `${a.name}: ${a.err || 'could not be read'}` : `${a.name} (${bytesText(a.size)})`)}">${a.state === 'error' ? `<img src="${VI}/warning-16.png" alt="" class="cd-att-bad">` : a.url ? `<img src="${esc(a.url)}" alt="" data-cd-att-img="${esc(a.key)}">` : ''}<span class="cd-att-name">${esc(a.name)}</span><button type="button" class="cd-att-x" data-cd-att-x="${esc(a.key)}" aria-label="Remove ${esc(a.name)}">&times;</button></span>`).join('');
    }

    function attRefresh(id) {
        const host = S.c && S.c.modal && S.c.modal.querySelector('.cd-atts');
        if (!host || host.dataset.sid !== id) return;
        host.innerHTML = attChipsHtml(id);
        host.hidden = !attOf(id).length;
    }

    function attDrop(id, key) {
        const list = attOf(id);
        const i = list.findIndex((a) => a.key === key);
        if (i < 0) return;
        if (list[i].url) URL.revokeObjectURL(list[i].url);
        list.splice(i, 1);
        attRefresh(id);
    }

    /** The real bytes of a Blob/File in memory (a pasted picture from the Android clipboard can be a File that reads 0 bytes
     *  or throws: it is read once here, so the thumbnail, the size and the upload all use the same bytes). */
    async function attBytes(blob) {
        if (!blob || typeof blob.arrayBuffer !== 'function') throw new Error('nothing was attached');
        const buf = await blob.arrayBuffer();
        if (!buf.byteLength) throw new Error('the picture is empty (0 bytes)');
        return buf;
    }

    function attAdd(id, item) {
        const isImg = /^image\//.test(item.type || '');
        const a = { key: `a${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: item.name, type: item.type || '', size: item.size || (item.blob && item.blob.size) || 0, blob: item.blob || null, path: item.path || '', url: '', state: 'ready', err: '' };
        if (!a.path || !a.blob) {
            // not on the server yet: read it into memory first; the chip shows its error if that fails
            a.state = 'loading';
            a.ready = attBytes(a.blob).then((buf) => {
                a.blob = new Blob([buf], { type: a.type || (a.blob && a.blob.type) || 'application/octet-stream' });
                a.size = buf.byteLength;
                if (isImg) a.url = URL.createObjectURL(a.blob);
                a.state = 'ready';
            }).catch((e) => { a.state = 'error'; a.err = (e && e.message) || 'could not be read'; }).then(() => attRefresh(id));
        } else if (isImg) a.url = URL.createObjectURL(a.blob);
        attOf(id).push(a);
        attRefresh(id);
        return a;
    }

    function attFiles(c, id, files) {
        for (const f of files) {
            if (!f) continue;
            const name = f.name || `pasted-${Date.now()}.${(/^image\/(\w+)/.exec(f.type) || [0, 'png'])[1]}`;
            const okType = /^(image|text)\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|txt|log|md|json|csv|xml|ini|ya?ml)$/i.test(name);
            if (!okType) { c.note(`${name}: only images and text files can be attached.`); continue; }
            if (f.size > ATT_MAX) { c.note(`${name} is larger than 20 MB.`); continue; }
            attAdd(id, { name, type: f.type, size: f.size, blob: f });
        }
    }

    /** A pasted picture when the paste event carried none (or an empty one): Melaton's clipboard (the Android app's clipboard
     *  in the app, the browser's in a tab), then the Snipping Tool's own last copy. */
    async function attClipboardImages() {
        const out = [];
        try {
            if (typeof root.readClipboard === 'function' && typeof root.getAllImageFilesFromClipboardResult === 'function') {
                out.push(...root.getAllImageFilesFromClipboardResult(await root.readClipboard()));
            }
        } catch (_) { /* below */ }
        if (!out.length && root.melatonClipboardImage && typeof root.melatonClipboardImage.toBlob === 'function') {
            const blob = await new Promise((r) => root.melatonClipboardImage.toBlob(r, 'image/png'));
            if (blob) out.push(new File([blob], `snip-${Date.now()}.png`, { type: 'image/png' }));
        }
        return out;
    }

    async function attPick(c, id) {
        const p = root.fileOpenPicker;
        if (!p || typeof p.pick !== 'function') { c.note('The Open dialog is not available.'); return; }
        const files = await p.pick({ accept: ATT_ACCEPT, multiple: true, title: 'Attach', owner: c.modal });
        if (files && files.length) attFiles(c, id, files);
    }

    /** A blob as base64 for the socket (Dovecote's pattern); the picture is never shown from it. */
    function blobBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
            r.onerror = () => reject(new Error('Could not read the attachment'));
            // no-base64-images: transport (an attachment for the socket, never shown from it)
            r.readAsDataURL(blob);
        });
    }

    /** Uploads what is not on the server yet; the paths of all of them. */
    async function attUpload(id) {
        const list = attOf(id);
        for (const a of list) if (a.ready) await a.ready;
        const bad = list.filter((a) => !a.path && (a.state === 'error' || !a.blob || !a.blob.size));
        if (bad.length) throw new Error(`Cannot send: ${bad.map((a) => `${a.name} (${a.err || 'it is empty'})`).join(', ')}. Remove ${bad.length === 1 ? 'it' : 'them'} and attach again.`);
        for (const a of list) {
            if (a.path) continue;
            const base64 = await blobBase64(a.blob);
            if (!base64) throw new Error(`Cannot send: ${a.name} read as empty. Remove it and attach again.`);
            const r = await send('claude_desk_session', { action: 'attach', id, name: a.name, mimeType: a.type, base64 });
            a.path = (r.result || r).path;
        }
        return attOf(id).map((a) => a.path);
    }

    function attClear(id) {
        ((S.att && S.att[id]) || []).forEach((a) => { if (a.url) URL.revokeObjectURL(a.url); });
        if (S.att) delete S.att[id];
        attRefresh(id);
    }

    async function phoneShot(c, id, device) {
        try {
            c.note('Capturing the phone screen...');
            const r = (await send('claude_desk_session', { action: 'phone_shot', id, device })).result || {};
            if (r.devices) {
                if (!r.devices.length) { await c.box('<p>No phone is online to capture.</p>', null, { icon: 'warning' }); return; }
                const { value, fields } = await form(c, `<p>Which phone?</p><label><span>Phone:</span><select class="vdt-select" data-cd="device">${r.devices.map((d) => `<option value="${esc(d.deviceId)}">${esc(d.name)}</option>`).join('')}</select></label>`,
                    [{ text: 'Capture', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Phone Screenshot' });
                if (value === true && fields.device) await phoneShot(c, id, fields.device);
                return;
            }
            let blob = null;
            if (r.thumbBase64) { const bin = atob(r.thumbBase64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); blob = new Blob([u], { type: 'image/jpeg' }); }
            attAdd(id, { name: r.name, type: r.mimeType, size: r.size, blob, path: r.path });
        } catch (e) { await failBox(c, e); }
    }

    /** Snip the Desktop: the Snipping Tool opens and the next snip it takes is attached (its 'snipping:snip' event). */
    function snipAttach(c, id) {
        if (!root.melatonApps || typeof root.melatonApps.launch !== 'function') { c.note('The Snipping Tool is not available.'); return; }
        if (S.snipWait) root.removeEventListener('snipping:snip', S.snipWait);
        const on = async (ev) => {
            root.removeEventListener('snipping:snip', on);
            S.snipWait = null;
            try {
                const blob = await ev.detail.toBlob();
                if (blob) { attAdd(id, { name: `snip-${Date.now()}.png`, type: 'image/png', size: blob.size, blob }); c.note('Snip attached.'); }
                else c.note('The snip had no picture.');
            } catch (e) { await failBox(c, e); }
        };
        S.snipWait = on;
        root.addEventListener('snipping:snip', on);
        void root.melatonApps.launch({ packageId: 'snipping' });
        c.note('Take a snip: it is attached to the message.');
    }

    function attWire(c, pane, id) {
        const box = pane.querySelector('.cd-compose');
        const chips = pane.querySelector('.cd-atts');
        if (!box || !chips) return;
        chips.dataset.sid = id;
        chips.innerHTML = attChipsHtml(id);
        chips.hidden = !attOf(id).length;
        chips.addEventListener('error', (ev) => {
            const k = ev.target && ev.target.dataset && ev.target.dataset.cdAttImg;
            const a = k && attOf(id).find((q) => q.key === k);
            if (a) { a.state = 'error'; a.err = 'the picture could not be shown'; if (a.url) { URL.revokeObjectURL(a.url); a.url = ''; } attRefresh(id); }
        }, true);
        chips.addEventListener('click', (ev) => { const x = ev.target.closest('[data-cd-att-x]'); if (x) attDrop(id, x.dataset.cdAttX); });
        const addBtn = pane.querySelector('[data-cd-attach]');
        if (addBtn) addBtn.addEventListener('click', () => void attPick(c, id));
        const shotBtn = pane.querySelector('[data-cd-shot]');
        if (shotBtn && root.contextMenu && typeof root.contextMenu.attachClickMenuToElement === 'function') {
            root.contextMenu.attachClickMenuToElement(shotBtn, {
                onAction: (a) => { if (a === 'snip') snipAttach(c, id); else if (a === 'phone') void phoneShot(c, id); },
                sections: [{ type: 'list', initfn: (sec) => { sec.items = [{ text: 'Snip the Desktop', action: 'snip' }, { text: 'Phone Screenshot', action: 'phone' }]; } }]
            });
        }
        // paste an image (Ctrl+V) and drop files on the composer
        box.addEventListener('paste', (ev) => {
            const cd = ev.clipboardData;
            let files = [...((cd && cd.files) || [])];
            if (!files.length && cd && cd.items) files = [...cd.items].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
            const hasText = !!(cd && cd.types && [...cd.types].includes('text/plain') && cd.getData('text/plain'));
            if (files.length) {
                ev.preventDefault();
                // a File the WebView hands over can read as 0 bytes: those are replaced by Melaton's clipboard picture
                void (async () => {
                    const real = [];
                    for (const f of files) { try { if ((await f.arrayBuffer()).byteLength) real.push(f); } catch (_) { /* dropped */ } }
                    if (real.length) attFiles(c, id, real);
                    else { const alt = await attClipboardImages(); if (alt.length) attFiles(c, id, alt); else attFiles(c, id, files); }
                })();
            } else if (!hasText) {
                // nothing in the event (the Android WebView pastes no picture): ask Melaton's clipboard
                ev.preventDefault();
                void attClipboardImages().then((alt) => { if (alt.length) attFiles(c, id, alt); });
            }
        });
        box.addEventListener('dragover', (ev) => { if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) { ev.preventDefault(); box.classList.add('is-drop'); } });
        box.addEventListener('dragleave', () => box.classList.remove('is-drop'));
        box.addEventListener('drop', (ev) => {
            box.classList.remove('is-drop');
            const files = [...((ev.dataTransfer && ev.dataTransfer.files) || [])];
            if (files.length) { ev.preventDefault(); attFiles(c, id, files); }
        });
    }

    /** The workflow map over a supervised session's chat (a session some work item owns). */
    function wmChatHtml(sid) {
        const w = supWork().find((x) => x.sessionId === sid);
        return w ? wmHtml(w.id) : '';
    }

    function chatPage(c, id) {
        let chat = S.chats.get(id);
        if (!chat) { void loadChat(id, false); chat = { messages: [], loading: true, row: rowOf(id) }; }
        if (chat.view === 'detail') return { html: detailPage(c, id, chat), split: false };
        const row = chat.row || rowOf(id) || { id };
        const l = liveOf(id);
        const acct = row.account ? row.account.name : '';
        const side = [stateText(row), acct, row.folder].filter(Boolean).join(' - ');
        const hold = holdOf(id);
        const holdBar = hold ? `<div class="cd-infobar is-warning" role="status"><img src="${PAUSE16}" alt=""><span><b>${esc(holdWord(hold))}</b>${hold.reason ? `: ${esc(hold.reason)}` : ''}${hold.by ? ` <i>(${esc(HOLD_KIND[hold.kind] || hold.kind || '')} by ${esc(hold.by)})</i>` : ''} <span class="mmc-link" data-act="resume-hold" data-arg="${esc(id)}">Resume</span></span></div>` : '';
        const linkBits = `<span class="mmc-link" data-act="detail-toggle">Details</span> <span class="mmc-link" data-act="tasks-toggle" aria-expanded="${TK.open ? 'true' : 'false'}" data-cd-tasks-link>${esc(tasksLinkText(id))}</span>${l && !hold ? ` <span class="mmc-link" data-act="pause" data-arg="${esc(id)}">Pause...</span>` : ''}${l && serverOrigin(id) ? ' <span class="mmc-link" data-act="takeover">Take Over in Fleet</span>' : ''}${l && l.link ? ` <span class="mmc-link" data-act="open-link" data-arg="${esc(l.link)}">Open in claude.ai</span> <span class="mmc-link" data-act="copy-link" data-arg="${esc(l.link)}">Copy link</span>` : ''}`;
        let composer;
        if (l && serverOrigin(id)) {
            composer = `<div class="cd-compose cd-ended"><span>This session runs inside Remote Control's server, so Fleet has no terminal to type into.</span><button type="button" class="btn-standard primary" data-act="takeover" data-arg="${esc(id)}">Take Over in Fleet...</button></div>`;
        } else if (l) {
            composer = `<div class="cd-compose">
                <div class="cd-compose-main">
                    <div class="cd-atts" hidden></div>
                    <textarea class="cd-input" data-field="cd-input-${esc(id)}" rows="3" placeholder="${l.status === 'busy' ? 'Steer it: your message reaches it while it works' : 'Message this session'}" spellcheck="true"></textarea>
                </div>
                <div class="cd-compose-btns">
                    <button type="button" class="btn-standard primary" data-act="send" data-arg="${esc(id)}">Send</button>
                    <button type="button" class="btn-standard" data-act="interrupt" data-arg="${esc(id)}"${l.status === 'busy' ? '' : ' disabled'}>Stop</button>
                    <button type="button" class="btn-standard" data-cd-attach title="Attach an image or a text file (you can also paste or drop one here)">Attach...</button>
                    <button type="button" class="btn-standard" data-cd-shot aria-haspopup="menu" title="Attach a screenshot">Screenshot &#9662;</button>
                </div>
            </div>`;
        } else {
            composer = `<div class="cd-compose cd-ended"><span>This session is not running.</span><button type="button" class="btn-standard primary" data-act="resume" data-arg="${esc(id)}">Resume in Remote Control...</button></div>`;
        }
        return {
            html: `<div class="cd-chat">
                <div class="mmc-page-title${l && l.status === 'busy' ? ' cd-title-busy' : ''}"><b>${esc(titleOf(row))}</b><span>${esc(side)}</span></div>
                ${linkBits ? `<div class="cd-chat-links">${linkBits}</div>` : ''}
                ${holdBar}
                ${wmChatHtml(id)}
                ${showBar()}
                <div class="cd-chat-body">
                    <div class="cd-chat-log" data-mmc-scroll>${logInner(chat, id)}</div>
                    ${tasksPanelHtml(id)}
                </div>
                ${composer}
            </div>`,
            split: true,
            mount: (pane) => {
                const log = pane.querySelector('.cd-chat-log');
                const mine = S.chats.get(id) || chat;
                // a drawn-again page keeps the reader's place (at the end it stays at the end)
                if (log) log.scrollTop = mine.stick === false && mine.fromBottom != null ? log.scrollHeight - mine.fromBottom : log.scrollHeight;
                let raf = 0;
                log.addEventListener('scroll', () => {
                    if (raf) return;
                    raf = requestAnimationFrame(() => {
                        raf = 0;
                        mine.fromBottom = log.scrollHeight - log.scrollTop;
                        mine.stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
                        pageMore(id, log);
                    });
                }, { passive: true });
                log.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-cd-unfold]');
                    if (b) { b.parentElement.classList.remove('is-folded'); b.remove(); }
                });
                wireFolds(log, id, '');
                tasksWire(pane, id);
                insTick(id);
                pane.querySelectorAll('[data-cd-show]').forEach((cb) => cb.addEventListener('change', () => void setShow(cb.dataset.cdShow, cb.checked)));
                requestAnimationFrame(() => pageMore(id, log));
                attWire(S.c, pane, id);
                const input = pane.querySelector('.cd-input');
                if (input) {
                    const kept = draftGet(id);
                    if (kept) input.value = kept;
                    input.addEventListener('input', () => draftSet(id, input.value));
                    input.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); void action('send', S.c, id); }
                    });
                }
            }
        };
    }

    // ---- the Tasks panel (modules/sessionTasks.js): "Your asks" (the user's list) and "Claude's tasks" ----------------
    // One list per session, read once when the chat opens (claude_desk_tasks list) and pushed to the watching window on every
    // change (a new message's asks, the agent ticking one, an edit): nothing polls. Items that arrived in the last push shine
    // for a few seconds. The text of an ask can be edited and removed here; the agent's tasks are read only.

    const TASKS_KEY = 'claudedesk.tasksOpen';
    const TK = { open: true };
    try { TK.open = localStorage.getItem(TASKS_KEY) !== '0'; } catch (_) { TK.open = true; }
    const TASK_NEW_MS = 4000;
    const taskCounts = (t) => (t && t.counts) || { asksDone: 0, asksTotal: 0, tasksDone: 0, tasksTotal: 0 };
    function tasksLinkText(id) {
        const ch = S.chats.get(id);
        const k = taskCounts(ch && ch.tasks);
        return `Tasks${k.asksTotal || k.tasksTotal ? ` ${k.asksDone}/${k.asksTotal}` : ''}`;
    }
    function tasksStatus(ch) {
        const k = taskCounts(ch && ch.tasks);
        return k.asksTotal || k.tasksTotal ? `asks ${k.asksDone}/${k.asksTotal} · tasks ${k.tasksDone}/${k.tasksTotal}` : '';
    }
    function taskTip(x) {
        const who = { user: 'you', agent: 'Claude', supervisor: 'the Supervisor' }[x.doneBy] || x.doneBy || '';
        return x.done ? `Done${who ? ` (ticked by ${who})` : ''}${x.evidence ? `: ${x.evidence}` : ''}` : (x.owner === 'user' ? 'Not done yet' : '');
    }
    function taskRowHtml(x, id, chat) {
        const fresh = chat.tasksNew && chat.tasksNew.get(x.id) > Date.now();
        const mine = x.owner === 'user';
        if (mine && chat.tasksEdit === x.id) {
            return `<li class="cd-task is-editing" data-task="${x.id}"><input type="text" class="cd-task-edit" data-cd-task-edit="${x.id}" value="${esc(x.text)}" maxlength="300" spellcheck="true" aria-label="Edit this ask"></li>`;
        }
        return `<li class="cd-task${x.done ? ' is-done' : ''}${fresh ? ' is-new' : ''}" data-task="${x.id}" title="${esc(taskTip(x))}">
            <input type="checkbox" data-cd-task-tick="${x.id}"${x.done ? ' checked' : ''}${mine ? '' : ' disabled'} aria-label="${esc(x.text)}">
            <span class="cd-task-text">${esc(x.text)}</span>${x.done && x.evidence ? '<span class="cd-task-ev" aria-hidden="true">✓</span>' : ''}
            ${mine ? `<span class="cd-task-btns"><span class="mmc-link" data-cd-task-do="edit" data-task="${x.id}">Edit</span><span class="mmc-link" data-cd-task-do="del" data-task="${x.id}">Remove</span></span>` : ''}
        </li>`;
    }
    function tasksBodyHtml(id) {
        const chat = S.chats.get(id) || {};
        const t = chat.tasks;
        if (!t) return '<p class="mmc-hint">Reading the lists...</p>';
        const k = taskCounts(t);
        const sect = (title, done, total, items, empty) => `<section class="cd-tasks-sec"><h4>${esc(title)} <span>(${done}/${total})</span></h4>${items.length ? `<ul class="cd-task-list">${items.map((x) => taskRowHtml(x, id, chat)).join('')}</ul>` : `<p class="mmc-hint">${esc(empty)}</p>`}</section>`;
        return `${sect('Your asks', k.asksDone, k.asksTotal, t.asks || [], 'What you ask in this session is listed here as you type it.')}
            <div class="cd-task-add"><input type="text" data-cd-task-new maxlength="300" placeholder="Add an ask..." spellcheck="true" aria-label="Add an ask"><button type="button" class="btn-standard" data-cd-task-do="add">Add</button></div>
            ${sect('Claude\'s tasks', k.tasksDone, k.tasksTotal, t.tasks || [], 'Claude\'s own working list shows here.')}`;
    }
    function tasksPanelHtml(id) {
        return `<aside class="cd-tasks"${TK.open ? '' : ' hidden'} aria-label="Tasks"><div class="cd-tasks-body">${tasksBodyHtml(id)}</div></aside>`;
    }
    function tasksToggle() {
        TK.open = !TK.open;
        try { localStorage.setItem(TASKS_KEY, TK.open ? '1' : '0'); } catch (_) { /* no storage */ }
        const m = S.c && S.c.modal;
        if (!m) return;
        const a = m.querySelector('.cd-tasks');
        if (a) a.hidden = !TK.open;
        const l = m.querySelector('[data-cd-tasks-link]');
        if (l) l.setAttribute('aria-expanded', TK.open ? 'true' : 'false');
        const id = nodeSid(S.c.node);
        if (TK.open && id && !(S.chats.get(id) || {}).tasks) void tasksLoad(id);
    }
    async function tasksLoad(id) {
        try { const r = await send('claude_desk_tasks', { id, action: 'list' }); tasksApply(id, unwrap(r, 'asks'), false); } catch (_) { /* the panel keeps its hint; a push or the next open reads it */ }
    }
    /** A list arrived (read, pushed or the answer of an edit): the panel, the link, the status bar and the title are drawn again. */
    function tasksApply(id, d, pushed) {
        const chat = S.chats.get(id);
        if (!chat || !d || !Array.isArray(d.asks)) return;
        const before = new Set(((chat.tasks && chat.tasks.asks) || []).concat((chat.tasks && chat.tasks.tasks) || []).map((x) => x.id));
        if (chat.tasks && pushed) {
            chat.tasksNew = chat.tasksNew || new Map();
            d.asks.concat(d.tasks || []).forEach((x) => { if (!before.has(x.id)) chat.tasksNew.set(x.id, Date.now() + TASK_NEW_MS); });
        }
        chat.tasks = d;
        tasksDraw(id);
        if (d.title) titleApply(id, d.title);
    }
    function tasksDraw(id) {
        const m = S.c && nodeSid(S.c.node) === id ? S.c.modal : null;
        const chat = S.chats.get(id);
        if (!m || !chat) return;
        const l = m.querySelector('[data-cd-tasks-link]');
        if (l) l.textContent = tasksLinkText(id);
        S.c.renderStatus();
        const box = m.querySelector('.cd-tasks-body');
        if (!box) return;
        // what is being typed in the panel is never drawn over; the draw follows when the box is left
        const f = document.activeElement;
        if (f && box.contains(f) && f.matches('input[type=text]') && f.value !== (f.defaultValue || '')) { chat.tasksLate = true; return; }
        chat.tasksLate = false;
        box.innerHTML = tasksBodyHtml(id);
        const ed = box.querySelector('[data-cd-task-edit]');
        if (ed && !ed.dataset.focused) { ed.dataset.focused = '1'; ed.focus(); ed.select(); }
    }
    /** A new title (the Supervisor's or a Fleet-side name): the open page's title and the session row follow. */
    function titleApply(id, title) {
        const row = rowOf(id);
        if (row && row.title !== title) row.title = title;
        const chat = S.chats.get(id);
        if (chat && chat.row && chat.row.title !== title) chat.row = Object.assign({}, chat.row, { title });
        const b = S.c && nodeSid(S.c.node) === id ? S.c.modal.querySelector('.cd-chat > .mmc-page-title b') : null;
        if (b && b.textContent !== title) b.textContent = title;
    }
    async function tasksSend(id, payload) {
        try {
            const r = await send('claude_desk_tasks', Object.assign({ id }, payload));
            tasksApply(id, unwrap(r, 'asks'), false);
        } catch (e) { if (S.c) S.c.note(e.message || 'The change was refused'); }
    }
    function tasksWire(pane, id) {
        const box = pane.querySelector('.cd-tasks');
        if (!box) return;
        const chat = () => S.chats.get(id);
        const idOf = (n) => Number(n.closest('[data-task]') && n.closest('[data-task]').dataset.task);
        const addNow = () => {
            const inp = box.querySelector('[data-cd-task-new]');
            const text = inp ? inp.value.trim() : '';
            if (!text) return;
            inp.value = '';
            void tasksSend(id, { action: 'add', text });
        };
        box.addEventListener('change', (ev) => {
            const cb = ev.target.closest('[data-cd-task-tick]');
            if (cb) void tasksSend(id, { action: 'update', taskId: Number(cb.dataset.cdTaskTick), done: cb.checked });
        });
        box.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-cd-task-do]');
            if (!b) return;
            const what = b.dataset.cdTaskDo;
            if (what === 'add') addNow();
            else if (what === 'edit' && chat()) { chat().tasksEdit = idOf(b); chat().tasksLate = false; box.querySelector('.cd-tasks-body').innerHTML = tasksBodyHtml(id); const ed = box.querySelector('[data-cd-task-edit]'); if (ed) { ed.dataset.focused = '1'; ed.focus(); ed.select(); } }
            else if (what === 'del') void tasksSend(id, { action: 'remove', taskId: idOf(b) });
        });
        const endEdit = (ed, save) => {
            const c = chat();
            if (!c || c.tasksEdit == null) return;
            const taskId = c.tasksEdit;
            c.tasksEdit = null;
            const text = ed.value.trim();
            if (save && text && text !== ed.defaultValue) void tasksSend(id, { action: 'update', taskId, text });
            else tasksDraw(id);
        };
        box.addEventListener('keydown', (ev) => {
            if (ev.target.matches('[data-cd-task-new]') && ev.key === 'Enter') { ev.preventDefault(); addNow(); }
            else if (ev.target.matches('[data-cd-task-edit]')) {
                if (ev.key === 'Enter') { ev.preventDefault(); endEdit(ev.target, true); }
                else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); endEdit(ev.target, false); }
            }
        });
        box.addEventListener('focusout', (ev) => {
            if (ev.target.matches('[data-cd-task-edit]') && chat() && chat().tasksEdit != null) endEdit(ev.target, true);
            else if (chat() && chat().tasksLate && !box.contains(ev.relatedTarget)) tasksDraw(id);
        });
    }
    async function renameBox(c, id) {
        const row = rowOf(id) || { id };
        const { value, fields } = await form(c, `
            <p>A name for <b>${esc(titleOf(row))}</b> that Fleet keeps. Leave it empty to let the Supervisor title the session from what you ask.</p>
            <label><span>Name:</span><input type="text" data-cd="name" data-cd-focus value="${esc(titleOf(row))}" maxlength="100" spellcheck="true" autocomplete="off"></label>`,
        [{ text: 'Rename', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Rename Session' });
        if (value !== true) return;
        try {
            const r = await send('claude_desk_tasks', { id, action: 'rename', title: String(fields.name || '').trim() });
            const d = unwrap(r, 'asks');
            if (d.title) titleApply(id, d.title); else await loadSessions(false);
            if (S.c) S.c.render();
        } catch (e) { await failBox(c, e); }
    }

    /**
     * What is typed into a session's box outlives a restart, a reload and moving to another page (Yukimi, Nov 24
     * 2026): kept in memory and in localStorage per session (written 400 ms after typing stops), dropped on Send.
     * Old drafts (30 days) are pruned when one is written.
     */
    const DRAFT_KEY = 'claudedesk.drafts';
    function draftsAll() {
        if (S.draftsLoaded) return S.drafts || {};
        S.draftsLoaded = true;
        try { S.drafts = Object.assign(JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {}, S.drafts || {}); } catch (_) { S.drafts = S.drafts || {}; }
        return S.drafts;
    }
    function draftGet(id) { const d = draftsAll()[id]; return d && typeof d === 'object' ? String(d.text || '') : (typeof d === 'string' ? d : ''); }
    function draftSet(id, text, now) {
        const all = draftsAll();
        if (text) all[id] = { text: String(text).slice(0, 100000), at: Date.now() }; else delete all[id];
        clearTimeout(S.draftTimer);
        const write = () => {
            const cut = Date.now() - 30 * 86400000;
            Object.keys(all).forEach((k) => { if (all[k] && typeof all[k] === 'object' && all[k].at < cut) delete all[k]; });
            try { localStorage.setItem(DRAFT_KEY, JSON.stringify(all)); } catch (_) { /* no storage: memory only */ }
        };
        if (now) write(); else S.draftTimer = setTimeout(write, 400);
    }

    const bytesText = (n) => (n == null ? '' : (n < 1024 ? `${n} B` : (n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)));
    const STATUS_TEXT = { busy: 'Working', idle: 'Idle', waiting: 'Idle', running: 'Running', ended: 'Ended' };

    function agentBoxHtml(chat) {
        const dt = chat && chat.dt;
        if (!dt || !dt.agentSel) return '<p class="mmc-hint">Select a background agent to read what it did.</p>';
        const pg = dt.agents.get(dt.agentSel);
        if (!pg || (pg.loading && !pg.messages.length)) return '<p class="mmc-hint">Reading the agent\'s conversation...</p>';
        if (pg.error) return `<p class="cd-err">${esc(pg.error)}</p>`;
        if (!pg.messages.length) return '<p class="mmc-hint">This agent has no messages yet.</p>';
        const top = pg.more ? `<div class="cd-earlier"><button type="button" class="btn-standard" data-act="agent-earlier" data-arg="${esc(dt.agentSel)}"${pg.loading ? ' disabled' : ''}>Show Earlier Messages</button></div>` : '';
        return `<div class="cd-chat-log cd-agent-log">${top}${logHtml(pg)}</div>`;
    }
    function taskBoxHtml(chat) {
        const t = chat && chat.dt && chat.dt.task;
        if (!t) return '<p class="mmc-hint">Select a background task to read the end of its output.</p>';
        if (t.hint) return `<p class="mmc-hint">${esc(t.hint)}</p>`;
        if (t.loading) return '<p class="mmc-hint">Reading the output...</p>';
        if (t.error) return `<p class="cd-err">${esc(t.error)}</p>`;
        return `<p class="mmc-hint">${esc([`The end of the output (${bytesText(t.sizeBytes)} in all)`, t.modifiedAt ? `last written ${when(t.modifiedAt)}` : ''].filter(Boolean).join(', '))}</p><pre class="cd-pre cd-task-out">${esc(t.text || '(no output)')}</pre>`;
    }
    /** The two boxes under the agents and tasks lists, drawn again without drawing the page. */
    function detailBoxes(id) {
        const chat = chatOf(id);
        const m = S.c && nodeSid(S.c.node) === id ? S.c.modal : null;
        if (!m || !chat) return;
        const a = m.querySelector('.cd-agent-box');
        const t = m.querySelector('.cd-task-box');
        if (a) a.innerHTML = agentBoxHtml(chat);
        if (t) t.innerHTML = taskBoxHtml(chat);
        wireFolds(a, id, 'agent');
        const log = a && a.querySelector('.cd-chat-log');
        if (log && !log.dataset.kept) { log.dataset.kept = '1'; log.scrollTop = log.scrollHeight; }
        delete m.querySelector('.mmc-result').dataset.html;
    }
    function detailSelect(key, id) {
        const chat = chatOf(id);
        if (!chat || !chat.dt) return;
        if (key && key.startsWith('ag:')) {
            chat.dt.agentSel = key.slice(3);
            if (!chat.dt.agents.has(chat.dt.agentSel)) void loadAgentPage(id, chat.dt.agentSel, false);
            else detailBoxes(id);
        } else if (key && key.startsWith('tk:')) {
            void loadTaskOutput(id, key.slice(3));
        }
    }

    function detailPage(c, id, chat) {
        if (!chat.dt || (!chat.dt.data && !chat.dt.loading && !chat.dt.error && !chat.dt.gone)) { void loadDetail(id); }
        const dt = chat.dt || { loading: true, agents: new Map() };
        const row = chat.row || rowOf(id) || { id };
        const title = titleOf(row);
        const back = `<span class="mmc-link" data-act="detail-toggle">Back to the conversation</span> &nbsp; <span class="mmc-link" data-act="detail-refresh">Read again</span>${liveOf(id) && serverOrigin(id) ? ` &nbsp; <span class="mmc-link" data-act="takeover" data-arg="${esc(id)}">Take Over in Fleet</span>` : ''}`;
        const d = dt.data;
        if (!d) {
            const msg = dt.gone ? 'Session details are not available on this server yet.' : (dt.error || 'Reading the session...');
            return c.page(title, '', [{ id: 'cd-dt-wait', title: 'Details', body: `<p class="${dt.error ? 'cd-err' : 'mmc-hint'}">${esc(msg)}</p><p>${back}</p>` }]);
        }
        const A = S.app.url('assets').replace(/\/$/, '');
        const link = d.link || '';
        const agents = Array.isArray(d.agents) ? d.agents : [];
        const tasks = Array.isArray(d.tasks) ? d.tasks : [];
        const edited = d.edited && Array.isArray(d.edited.files) ? d.edited.files : [];
        const claims = Array.isArray(d.claims) ? d.claims : [];
        const reviews = Array.isArray(d.reviews) ? d.reviews : supReviews().filter((r) => r.sessionId === id);
        const table = (head, rows, none) => (rows.length ? `<table class="cd-table"><colgroup>${head.map(([, w]) => `<col${w ? ` class="cd-w${w}"` : ''}>`).join('')}</colgroup><thead><tr>${head.map(([h]) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>` : `<p class="mmc-hint">${none}</p>`);
        const agentRows = agents.map((x) => ({ key: `ag:${x.agentId}`, icon: SESSION16, cls: x.finished ? '' : 'cd-live', data: { desc: x.description || x.agentId, type: x.type || '', model: x.model || '', state: x.finished ? 'Finished' : 'Running', last: x.lastActivity || 0, messages: x.messages || 0 } }));
        const taskRows = tasks.map((x) => ({ key: `tk:${x.taskId}`, icon: `${ITEMS}/administrative-tools-16.png`, cls: x.running ? 'cd-live' : '', data: { id: x.taskId, kind: { shell: 'Shell', monitor: 'Monitor', agent: 'Agent' }[x.kind] || x.kind || '', state: x.running ? 'Running' : 'Ended', size: x.sizeBytes || 0, at: x.modifiedAt || 0 } }));
        const agentList = c.listView([
            { t: 'Description', w: 230, key: 'desc', text: (r) => r.desc },
            { t: 'Type', w: 90, key: 'type', text: (r) => r.type },
            { t: 'Model', w: 80, key: 'model', text: (r) => r.model },
            { t: 'State', w: 70, key: 'state', text: (r) => r.state },
            { t: 'Last Activity', w: 128, key: 'last', text: (r) => when(r.last), value: (r) => Number(r.last) || Date.parse(r.last) || 0 },
            { t: 'Messages', w: 62, key: 'messages', num: true, text: (r) => String(r.messages), value: (r) => r.messages }
        ], agentRows, { sortId: 'cd-dt-ag', sort: { key: 'last', dir: -1 }, empty: 'This session has run no background agents.' });
        const taskList = c.listView([
            { t: 'Task', w: 150, key: 'id', text: (r) => r.id },
            { t: 'Kind', w: 80, key: 'kind', text: (r) => r.kind },
            { t: 'State', w: 70, key: 'state', text: (r) => r.state },
            { t: 'Output', w: 80, key: 'size', num: true, text: (r) => bytesText(r.size), value: (r) => r.size },
            { t: 'Last Written', w: 128, key: 'at', text: (r) => when(r.at), value: (r) => Number(r.at) || Date.parse(r.at) || 0 }
        ], taskRows, { sortId: 'cd-dt-tk', sort: { key: 'at', dir: -1 }, empty: 'This session has no background tasks.' });
        const l = liveOf(id);
        const status = d.live === false ? 'Ended' : (STATUS_TEXT[d.status] || (l ? stateText(row) : d.status) || '');
        const ins = d.insight || chat.ins || null;
        const busyNow = !!(l && l.status === 'busy');
        const tk = ins ? ins.tokens : null;
        const insightSec = ins ? [{ id: 'cd-dt-insight', title: 'Insight', body: c.props([
            ['Model', esc(ins.model ? `${modelName(ins.model)} (${ins.model})` : '')],
            ['Model switches', ins.models && ins.models.length > 1 ? esc(ins.models.map((x) => `${modelName(x.model)} ${timeOnly(x.at)}`).join(' > ')) : 'None'],
            ['Effort', esc(ins.effort || 'Default')],
            ['Permission mode', esc(ins.mode || '')],
            ['Context used', ins.context && ins.context.used ? `${esc(fmtN(ins.context.used))} of ${esc(fmtN(ins.context.window))} (${ins.context.percent}%, the window size is estimated)` : ''],
            ['Turns', String(ins.turns || 0)],
            ['This turn', ins.turnStartedAt ? `${esc(fmtDur(insTurnMs(ins, busyNow)))}, started ${esc(when(ins.turnStartedAt))}` : ''],
            ['Tool calls this turn', String(ins.turnTools || 0)],
            ['Last tool', ins.lastTool ? `${esc(ins.lastTool)} (${esc(when(ins.lastToolAt))})` : ''],
            ['Files edited this turn', ins.turnFileCount ? esc(ins.turnFiles.map(baseName).join(', ') + (ins.turnFileCount > ins.turnFiles.length ? `, +${ins.turnFileCount - ins.turnFiles.length}` : '')) : 'None'],
            ['Background agents running', String(ins.bgAgents || 0)],
            ['Tokens, this session', tk ? `${esc(fmtN(tk.input))} in, ${esc(fmtN(tk.output))} out, ${esc(fmtN(tk.cacheRead))} cache read, ${esc(fmtN(tk.cacheWrite))} cache written` : ''],
            ['Tokens, this turn', ins.turnTokens ? `${esc(fmtN(ins.turnTokens.input))} in, ${esc(fmtN(ins.turnTokens.output))} out, ${esc(fmtN(ins.turnTokens.cacheRead))} cache read, ${esc(fmtN(ins.turnTokens.cacheWrite))} cache written` : ''],
            ['Cost (Claude Code\'s own figure)', ins.costUsd == null ? 'Not reported' : `$${ins.costUsd.toFixed(2)}`],
            ['Claude Code', esc(ins.version || '')]
        ]) }] : [];
        return c.page(d.title || title, status, [
            { id: 'cd-dt-info', title: 'Session', body: c.props([
                ['Status', esc(status)],
                ['Account', esc(d.account && d.account.name ? d.account.name : (d.account || ''))],
                ['Model', esc(d.model || '')],
                ['Effort', esc(d.effort || 'Default')],
                ['Branch', esc(d.branch || '')],
                ['Folder', esc(d.cwd || '')],
                ['Remote Control', link ? `<span class="mmc-link" data-act="open-link" data-arg="${esc(link)}">Open in claude.ai</span> &nbsp; <span class="mmc-link" data-act="copy-link" data-arg="${esc(link)}">Copy link</span>` : 'Not connected'],
                ['Started', esc(when(d.startedAt))],
                ['Last activity', esc(when(d.lastActivity))]
            ]) + `<p>${back}</p>` },
            ...insightSec,
            { id: 'cd-dt-agents', title: `Background Agents (${agents.length})`, body: `<div class="cd-dt-list">${agentList}</div><div class="cd-dt-box cd-agent-box">${agentBoxHtml(chat)}</div>` },
            { id: 'cd-dt-tasks', title: `Background Tasks (${tasks.length})`, body: `<div class="cd-dt-list">${taskList}</div><div class="cd-dt-box cd-task-box">${taskBoxHtml(chat)}</div>` },
            { id: 'cd-dt-claims', title: `Claims (${claims.length})`, body: table([['Path']], claims.map((p) => `<tr><td>${esc(p)}</td></tr>`), 'It holds no claim.') },
            { id: 'cd-dt-files', title: `Files Edited (${d.edited ? d.edited.total || edited.length : 0})`, body: table([['File'], ['Via', 76], ['Edits', 46], ['Uncommitted', 84]], edited.map((f) => `<tr><td>${esc(f.path)}</td><td>${f.via === 'shell' ? 'Shell' : esc(f.via || '')}</td><td class="is-num">${f.edits == null ? '' : f.edits}</td><td>${f.uncommitted == null ? '' : (f.uncommitted ? 'Yes' : 'No')}</td></tr>`), 'It has edited no file.') },
            { id: 'cd-dt-reviews', title: `Supervisor Reviews (${reviews.length})`, body: table([['Verdict', 100], ['Summary'], ['When', 130]], reviews.map((r) => `<tr><td>${esc((VERDICT[r.verdict] || [r.verdict || ''])[0])}</td><td>${esc(r.summary || '')}${supViolations(r).length ? ` [${esc(String(supViolations(r).length))} rule violation(s)]` : ''}</td><td>${esc(when(r.at))}</td></tr>`), 'The supervisor has not reviewed this session.') }
        ]);
    }

    /** New messages go at the end of the open chat without drawing the page again (scroll kept at the end). */
    function appendChat(id) {
        const pane = logOf(id);
        const chat = S.chats.get(id);
        if (!pane || !chat) return;
        const atEnd = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
        const have = new Set(Array.from(pane.querySelectorAll('[data-k]')).map((n) => n.dataset.k));
        const fresh = chat.messages.filter((m) => !have.has(msgKey(m)));
        if (!fresh.length) return;
        // rows that belong above the last drawn one (an earlier page read meanwhile) are never appended at the end:
        // the log is drawn again in order (Nov 24 2026: older rows landed under the newest)
        const drawn = Array.from(pane.querySelectorAll('[data-at]')).map((n) => Number(n.dataset.at)).filter(Number.isFinite);
        const lastAt = drawn.length ? Math.max(...drawn) : -1;
        if (fresh.some((m) => Number(m.at) < lastAt)) { redrawLog(id); return; }
        const hint = pane.querySelector(':scope > .mmc-hint');
        if (hint) hint.remove();
        if (chat.messages.length > MSG_MAX + MSG_PAGE) {
            trimRows(chat, false);
            chat.stick = atEnd;
            redrawLog(id);
            return;
        }
        pane.querySelectorAll('.is-pending, .cd-activity').forEach((n) => n.remove());
        let prev = '';
        for (let i = chat.messages.indexOf(fresh[0]) - 1; i >= 0 && !prev; i -= 1) { const q = chat.messages[i]; if (q.role === 'assistant' && q.kind === 'text' && !q.sidechain && q.model) prev = q.model; }
        pane.insertAdjacentHTML('beforeend', fresh.map((m) => { const sm = m.role === 'assistant' && m.kind === 'text' && !m.sidechain && m.model; const h = messageHtml(m, !!(sm && prev && m.model !== prev)); if (sm) prev = m.model; return h; }).join('') + pendingHtml(chat) + activityHtml(id));
        delete S.c.modal.querySelector('.mmc-result').dataset.html;
        if (atEnd) pane.scrollTop = pane.scrollHeight;
    }

    // ---- commands -----------------------------------------------------------------------------------------

    /**
     * The usage bars' widths are set after the page is drawn (a script, not an inline style in the markup).
     * The Vista fill carries 8 px end caps that give it a 16 px minimum, so 0% is hidden and a fill too short
     * for its caps drops them; --cd-w feeds the width (cd-fill in claudedesk.css) that spans the track edge to edge.
     */
    function paintBars(pane) {
        const fills = Array.from(pane.querySelectorAll('[data-w]'));
        const outer = fills.map((el) => (el.parentElement ? el.parentElement.offsetWidth : 0));
        fills.forEach((el, i) => {
            const p = Math.max(0, Math.min(100, Number(el.dataset.w) || 0));
            el.style.setProperty('--cd-w', String(p));
            el.classList.toggle('is-empty', p <= 0);
            el.classList.toggle('is-short', p > 0 && outer[i] * p / 100 < 18);
        });
        placePace(pane);
    }
    // The pace tick moves with the clock, not only when usage is read again (Yukimi, Nov 26 2026: "should be progressing
    // with the time so it's more accurate"): placed from its reset time at every paint, then nudged every 30 s while a
    // bar is on screen and the window shows - one timer for all bars, gone when none is left.
    let paceTimer = 0;
    function placePace(root) {
        const now = Date.now();
        const els = (root || document).querySelectorAll('i.cd-pace[data-reset]');
        els.forEach((el) => {
            const reset = Number(el.dataset.reset); const win = Number(el.dataset.win);
            const pct = reset && win ? ((now - (reset - win)) / win) * 100 : Number(el.dataset.pace) || 0;
            el.style.setProperty('--cd-pace', Math.max(0, Math.min(100, pct)).toFixed(3));
        });
        if (els.length && !paceTimer) {
            paceTimer = setInterval(() => {
                const live = document.querySelectorAll('#mmcConsole_claudedesk i.cd-pace[data-reset]');
                if (!live.length) { clearInterval(paceTimer); paceTimer = 0; return; }
                if (!document.hidden) placePace(document.getElementById('mmcConsole_claudedesk'));
            }, 30000);
        }
    }
    function withBars(html) {
        return { html, mount: (pane) => paintBars(pane) };
    }

    // ---- Usage: work items -> sessions -> turns -> agents, what each spent and the flags (modules/claudeUsageAudit.js) -----

    const usgUi = () => (S.usg || (S.usg = { days: 1, data: null, flags: null, loading: false, error: '', open: new Set(), opened: false, sel: '', det: new Map(), detKey: '', retry: null }));
    const usgTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n || 0)));
    const usgDur = (ms) => { if (ms == null) return ''; const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : (m >= 1 ? `${m} min` : `${Math.max(1, Math.round(ms / 1000))} s`); };
    const usgPct = (v) => (v == null ? '' : `${Math.round(v * 100)}%`);
    const usgModel = (m) => String(m || '').replace(/^claude-/, '').replace(/^[a-z-]+\//i, '');
    const usgOpenFlags = () => { const u = S.sup.data && S.sup.data.usage; return u ? u.open || 0 : (usgUi().flags || []).filter((f) => !f.ackAt).length; };
    const usgFlagged = (sid) => !!(S.sup.data && S.sup.data.usage && S.sup.data.usage.sessions && S.sup.data.usage.sessions[sid]);

    async function usgLoad() {
        const u = usgUi();
        if (u.loading) return;
        u.loading = true;
        u.error = '';
        try {
            const r = unwrap(await send('claude_desk_supervisor', { action: 'usage_tree', days: u.days }), 'usage');
            u.data = r.usage || { rows: [] };
            if (r.flags) u.flags = r.flags;
            if (!u.opened && u.data.rows) {
                u.opened = true;
                const kept = S.c && S.c.reg ? S.c.reg('UsageOpen', null) : null; // the expanded rows are remembered
                if (Array.isArray(kept)) kept.forEach((k) => u.open.add(k)); else u.data.rows.forEach((x) => { if (x.kind === 'work') u.open.add(x.key); });
            }
            // a first read of a big window answers "scanning" and finishes in the background: asked again once
            clearTimeout(u.retry);
            if (u.data.scanning) u.retry = setTimeout(() => { u.loading = false; void usgLoad(); }, 6000);
        } catch (e) { u.error = SUP_GONE.test(errText(e)) ? NOT_YET : errText(e); u.data = u.data || { rows: [] }; }
        u.loading = false;
        repaint();
    }
    async function usgLoadFlags() {
        try { const r = unwrap(await send('claude_desk_supervisor', { action: 'usage_flags', all: false, days: 30 }), 'flags'); usgUi().flags = r.flags || []; } catch (_) { /* later */ }
        repaint();
    }

    /** The tree rows in display order: every level sorted by the chosen column on its own, closed rows hide their children. */
    function usgVisible(c, cols) {
        const u = usgUi();
        const rows = (u.data && u.data.rows) || [];
        const kids = new Map();
        rows.forEach((r) => { const p = r.parent || ''; if (!kids.has(p)) kids.set(p, []); kids.get(p).push({ key: r.key, data: r }); });
        const hasKids = new Set(rows.map((r) => r.parent).filter(Boolean));
        const vis = [];
        const walk = (parent) => {
            const level = kids.get(parent) || [];
            const ordered = c && cols ? c.sorted(level, cols, 'cd-usage', { key: 'fresh', dir: -1 }) : level;
            ordered.forEach((x) => { vis.push(x.data); if (u.open.has(x.key)) walk(x.key); });
        };
        walk('');
        return { vis, hasKids };
    }
    function usgSetOpen(key, on) {
        const u = usgUi();
        if (on) u.open.add(key); else u.open.delete(key);
        if (S.c && S.c.setReg) S.c.setReg({ UsageOpen: [...u.open] });
        repaint();
    }
    /** Left / Right on the usage tree: Right opens, or steps into the first child; Left closes, or steps to the parent. */
    function usgKey(ev) {
        if (!ev.target.classList || !ev.target.classList.contains('mmc-list') || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
        const u = usgUi();
        const { vis, hasKids } = usgVisible(S.c, usgCols(S.c));
        const i = vis.findIndex((r) => `ux:${r.key}` === String(S.c.sel));
        if (i < 0) return;
        const r = vis[i];
        ev.preventDefault();
        const select = (x) => { if (x) { S.c.selectRow(`ux:${x.key}`); } };
        if (ev.key === 'ArrowRight') {
            if (hasKids.has(r.key) && !u.open.has(r.key)) usgSetOpen(r.key, true);
            else if (hasKids.has(r.key)) select(vis[i + 1]);
        } else if (hasKids.has(r.key) && u.open.has(r.key)) usgSetOpen(r.key, false);
        else select(vis.find((x) => x.key === r.parent));
    }

    const usgIcon = (r) => (r.flags.length || r.below ? `${VI}/warning-16.png` : r.kind === 'work' ? `${ITEMS}/administrative-tools-16.png` : r.kind === 'agent' ? `${ITEMS}/programs-and-features-16.png` : r.kind === 'turn' ? `${VI}/info-16.png` : SESSION16);

    function usgCols(c) {
        const u = usgUi();
        const hasKids = new Set(((u.data && u.data.rows) || []).map((r) => r.parent).filter(Boolean));
        return [
            { t: 'Name', w: 300, min: 220, key: 'name', html: (r) => `<i class="cd-ux-n cd-ux-d${Math.min(3, r.depth)}">${hasKids.has(r.key) ? `<span class="mmc-twisty cd-ux-tw ${u.open.has(r.key) ? 'is-open' : 'is-closed'}" data-act="usage-toggle" data-arg="${esc(r.key)}" aria-hidden="true"></span>` : '<span class="cd-ux-tw"></span>'}<img class="mmc-row-icon" src="${esc(usgIcon(r))}" alt="">${esc(r.name)}${r.sub ? ` <small>${esc(r.sub)}</small>` : ''}</i>`, text: (r) => r.name },
            { t: 'Model', w: 120, min: 90, key: 'model', text: (r) => Array.from(new Set(r.fig.models.map((m) => usgModel(m).toLowerCase()))).join(', ') },
            { t: 'Effort', w: 56, min: 64, key: 'effort', text: (r) => r.fig.efforts.join(', ') },
            { t: 'Tokens', w: 70, key: 'fresh', num: true, text: (r) => usgTok(r.fig.tokens.fresh), value: (r) => r.fig.tokens.fresh },
            { t: 'In / Out', w: 90, key: 'io', num: true, text: (r) => `${usgTok(r.fig.tokens.input)} / ${usgTok(r.fig.tokens.output)}` },
            { t: 'Cache W / R', w: 100, key: 'cache', num: true, text: (r) => `${usgTok(r.fig.tokens.cacheWrite)} / ${usgTok(r.fig.tokens.cacheRead)}` },
            { t: 'Time', w: 70, key: 'dur', num: true, text: (r) => usgDur(r.fig.durationMs) },
            { t: 'Calls', w: 50, key: 'tools', num: true, text: (r) => String(r.fig.tools) },
            { t: 'Files', w: 44, key: 'files', num: true, text: (r) => String(r.fig.files) },
            { t: 'Cached', w: 56, key: 'ratio', num: true, text: (r) => usgPct(r.fig.eff.cacheRatio) },
            { t: 'Out / call', w: 66, key: 'opt', num: true, text: (r) => (r.fig.eff.outPerTool == null ? '' : usgTok(r.fig.eff.outPerTool)) },
            { t: 'Tok / file', w: 66, key: 'tpf', num: true, text: (r) => (r.fig.eff.tokPerFile == null ? '' : usgTok(r.fig.eff.tokPerFile)) },
            { t: 'Ctx / call', w: 66, key: 'ctx', num: true, text: (r) => (r.fig.eff.heavyCtx == null ? '' : usgTok(r.fig.eff.heavyCtx)) },
            { t: 'Share', w: 52, key: 'share', num: true, text: (r) => usgPct(r.fig.share) },
            { t: 'Flag', w: 110, key: 'flag', text: (r) => (r.flags.length ? r.flags.map((f) => f.reason).join(', ') : (r.below ? `${r.below} below` : '')) }
        ];
    }

    function usgDetailHtml(c) {
        const u = usgUi();
        const row = ((u.data && u.data.rows) || []).find((r) => r.key === u.sel);
        if (!row) return '<p class="mmc-hint">Select a row to see its breakdown: the models it ran on, what it did, and why it was flagged.</p>';
        const f = row.fig;
        const det = u.det.get(u.sel);
        const flags = row.flags.length ? `<p><b>Flags</b></p><ul>${row.flags.map((x) => `<li>${esc(x.text)} <span class="mmc-link" data-act="usage-ack" data-arg="${esc(x.id)}">Acknowledge</span></li>`).join('')}</ul>` : '';
        const props = c.props([
            ['Tokens', `${usgTok(f.tokens.fresh)} new (in ${usgTok(f.tokens.input)}, out ${usgTok(f.tokens.output)}, cache write ${usgTok(f.tokens.cacheWrite)}), ${usgTok(f.tokens.cacheRead)} re-read from the cache`],
            ['Cost', f.costUsd == null ? 'Not shown: no price is set for these models (agentSupervisor.usageFlags.prices, USD per million tokens)' : `$${f.costUsd.toFixed(2)}`],
            ['Models', esc(f.models.map(usgModel).join(', ') || 'None')],
            ['Effort', esc(f.efforts.join(', ') || 'Unknown')],
            ['Duration', esc(usgDur(f.durationMs) || '')],
            ['Model calls / tool calls / files edited', `${f.calls} / ${f.tools} / ${f.files}`],
            ['Cache reuse', esc(usgPct(f.eff.cacheRatio) || 'n/a')],
            ['Output per tool call', f.eff.outPerTool == null ? 'n/a' : usgTok(f.eff.outPerTool)],
            ['Tokens per file edited', f.eff.tokPerFile == null ? 'n/a' : usgTok(f.eff.tokPerFile)],
            ['Context per call', f.eff.heavyCtx == null ? 'n/a' : usgTok(f.eff.heavyCtx)],
            ['Share of its session', f.share == null ? 'n/a' : usgPct(f.share)]
        ]);
        let more = '';
        if (det && det.fig) {
            const models = det.models.length ? `<p><b>By model</b></p><table class="cd-table"><thead><tr><th>Model</th><th class="cd-w50">Calls</th><th>In</th><th>Out</th><th>Cache write</th><th>Cache read</th></tr></thead><tbody>${det.models.map((m) => `<tr><td>${esc(usgModel(m.model))}</td><td>${m.calls}</td><td>${usgTok(m.input)}</td><td>${usgTok(m.output)}</td><td>${usgTok(m.cacheWrite)}</td><td>${usgTok(m.cacheRead)}</td></tr>`).join('')}</tbody></table>` : '';
            const tools = det.tools.length ? `<p><b>Tools</b></p><p class="cd-read">${esc(det.tools.map((t) => `${t.name} ${t.n}`).join(', '))}</p>` : '';
            const notes = det.notes.length ? `<p><b>Worth a look</b></p><ul>${det.notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
            more = models + tools + notes;
        } else if (row.kind !== 'work') more = `<p class="mmc-hint">${det === false ? 'The breakdown could not be read.' : 'Reading the breakdown...'}</p>`;
        return `<p><b>${esc(row.name)}</b></p>${flags}${props}${more}`;
    }
    function usgSelect(key) {
        const u = usgUi();
        u.sel = key;
        const paint = () => { const box = S.c && S.c.modal.querySelector('.cd-ux-detail'); if (box) box.innerHTML = usgDetailHtml(S.c); };
        paint();
        const row = ((u.data && u.data.rows) || []).find((r) => r.key === key);
        if (!row || row.kind === 'work' || u.det.has(key)) return;
        void send('claude_desk_supervisor', { action: 'usage_detail', kind: row.kind, id: row.id, days: u.days })
            .then((r) => { u.det.set(key, unwrap(r, 'detail').detail || false); }).catch(() => { u.det.set(key, false); }).then(() => { if (u.sel === key) paint(); });
    }

    function usagePage(c) {
        const u = usgUi();
        if (!u.data && !u.loading) void usgLoad();
        if (!S.sup.loaded && !S.sup.loading) void loadSupervisor();
        const cols = usgCols(c);
        const { vis } = usgVisible(c, cols);
        const rows = vis.map((r) => ({ key: `ux:${r.key}`, data: r }));
        const empty = u.error ? `The usage could not be read. ${u.error}` : (u.data && u.data.scanning ? 'Reading the transcripts for the first time (this can take a minute)...' : (u.data ? `No Claude session was active in the last ${u.days === 1 ? '24 hours' : '7 days'}.` : 'Reading the transcripts...'));
        const lv = c.listView(cols, rows, { fit: true, sortId: 'cd-usage', sort: { key: 'fresh', dir: -1 }, presorted: true, empty });
        const note = u.data && u.data.rows && u.data.rows.length ? `<p class="mmc-hint cd-ux-note">${u.days === 1 ? 'Last 24 hours' : 'Last 7 days'}, biggest first. Tokens are new input, output and cache writes; cache reads are shown apart.${u.data.pricesSet ? '' : ' No prices are set, so no cost is shown.'}</p>` : '';
        return {
            html: `<div class="cd-rv"><div class="cd-rv-top">${lv}${note}</div><div class="cd-rv-split" role="separator" aria-orientation="horizontal" title="Drag to resize"></div><div class="cd-rv-bot cd-ux-detail">${usgDetailHtml(c)}</div></div>`,
            list: true,
            split: true,
            mount: (pane) => { splitDrag(pane); if (!pane.dataset.uxKeys) { pane.dataset.uxKeys = '1'; pane.addEventListener('keydown', usgKey); } }
        };
    }

    function usageFlagsPage(c) {
        const u = usgUi();
        if (!u.flags && !u.flagsLoading) { u.flagsLoading = true; void usgLoadFlags().then(() => { u.flagsLoading = false; }); }
        const rows = (u.flags || []).map((f) => ({ key: `ux:f:${f.id}`, icon: f.ackAt ? `${VI}/check-16.png` : `${VI}/warning-16.png`, data: f }));
        const lv = c.listView([
            { t: 'Session', w: 200, key: 'title', text: (f) => f.title },
            { t: 'Why', w: 130, key: 'reason', text: (f) => f.reasonText },
            { t: 'Detail', w: 420, key: 'text', text: (f) => f.text },
            { t: 'First seen', w: 120, key: 'first', text: (f) => when(f.firstSeen), value: (f) => f.firstSeen },
            { t: 'Last seen', w: 120, key: 'last', text: (f) => when(f.lastSeen), value: (f) => f.lastSeen },
            { t: 'State', w: 100, key: 'state', text: (f) => (f.ackAt ? 'Acknowledged' : 'Open') }
        ], rows, { wrap: true, fit: true, sortId: 'cd-usage-flags', sort: { key: 'last', dir: -1 }, empty: u.flags ? 'Nothing was flagged in the last 30 days.' : 'Reading the flags...' });
        return { html: lv, list: true };
    }
    async function usgAck(c, id) {
        const fid = id || selId(c, 'ux:f:');
        if (!fid) { c.note('Select a flag first.'); return; }
        try {
            const r = unwrap(await send('claude_desk_supervisor', { action: 'usage_ack', id: Number(fid) }), 'flags');
            usgUi().flags = r.flags || usgUi().flags;
            if (r.summary && S.sup.data) S.sup.data = Object.assign({}, S.sup.data, { usage: r.summary });
            void usgLoad();
        } catch (e) { await failBox(c, e); }
        repaint();
    }

    function page(n, c) {
        switch (n.id) {
            case 'usage': return usagePage(c);
            case 'usage-flags': return usageFlagsPage(c);
            case 'root': return withBars(rootPage(c));
            case 'co-flow': return workflowPage(c);
            case 'co-held': return workPage(c, 'held');
            case 'co-input': return inputPage(c);
            case 'aw-sup': return workPage(c, 'active');
            case 'co-pending': return workPage(c, 'pending');
            case 'aw-uns': return unsupervisedPage(c);
            case 'aw-quiet': return unsupervisedPage(c, true);
            case 'co-done': return workPage(c, 'done');
            case 'activity': return activityPage(c);
            case 'bg-agents': return bgListPage(c);
            case 'memory': return memoryPage(c);
            case 'mem-review': return memReviewPage(c);
            case 'mem-digest': return memDigestPage(c);
            case 'rules': return rulesPage(c);
            case 'rules-review': return rulesReviewPage(c);
            case 'contractors': return contractorsPage(c);
            case 'accounts': return accountsPage(c);
            case 'rc': return rcPage(c);
            case 'rc-host': return hostRcPage(c);
            case 'co-builds': return buildsPage(c);
            case 'co-devices': return devicesPage(c);
            case 'co-locks': return locksPage(c);
            case 'sup-manager': return managerPage(c);
            case 'co-supervisor': case 'sup-settings': case 'sup-reviews': case 'sup-asks': case 'sup-holds': case 'sup-locks': case 'sup-arts': return supervisorPage(c, n.id);
            case 'sup-maint': return maintenancePage(c);
            case 'co-work': return workPage(c, 'all');
            case 'sessions': return sessionsPage(c, false);
            case 'co-root': return withBars(rootPage(c));
            case 'co-agents': return agentsPage(c);
            case 'co-claims': return claimsPage(c);
            case 'co-messages': return messagesPage(c);
            default:
                if (nodeSid(n.id)) return chatPage(c, nodeSid(n.id));
                if (n.id.startsWith('bga:')) { const m = /^bga:([^:]+):(.+)$/.exec(n.id); return m ? bgAgentPage(c, m[1], m[2]) : ''; }
                if (n.id.startsWith('aw:w:')) return workItemPage(c, n.id.slice(5));
                if (n.id.startsWith('aw:i:')) return awIssuePage(c, n.id);
                if (n.id.startsWith('aw:a:')) { const m = /^aw:a:([^:]+):(.+)$/.exec(n.id); return m ? awAgentPage(c, m[1], m[2]) : ''; }
                if (n.id.startsWith('aw:l:')) { void loadAwAgents(n.id.slice(5)); return c.page('Background Agents', '', [{ id: 'cd-al', title: 'Background Agents', body: '<p class="mmc-hint">Reading the session\'s agents...</p>' }]); }
                if (n.id.startsWith('ct:')) return contractorPage(c, n.id.slice(3));
                if (n.id.startsWith('ctS:')) { const m = /^ctS:([^:]+):(.+)$/.exec(n.id); return m ? contractorSessionPage(c, m[1], m[2]) : ''; }
                if (n.id.startsWith('i:')) return inspectPage(c, n.id.slice(2));
                return '';
        }
    }

    /** The 16 px Vista command-bar picture of each Action pane link (MMC 3.0 shows it left of the text). */
    const ACT_ICON = (() => {
        const m = {};
        const put = (img, names) => names.split(' ').forEach((a) => { m[a] = `/static_images/vista-cmdbar/${img}.png`; });
        put('refresh', 'rules-refresh sup-refresh fleet-refresh locks-refresh act-refresh mem-refresh con-refresh inspect-refresh aw-agents-refresh con-reread sup-recheck');
        put('new', 'new-session new-session-on');
        put('add', 'add-account con-add');
        put('go', 'rules-open rules-goto open-session work-open agent-session sup-hold-open act-session inspect-session mem-open act-open con-open agent-open');
        put('mail', 'post post-to read-message mem-review-now');
        put('reply', 'reply');
        put('undo', 'work-reopen');
        put('send', 'message sup-send');
        put('discuss', 'steer steer-agent con-steer');
        put('stop', 'interrupt con-interrupt con-stop rc-stop fleet-stop');
        put('power', 'end');
        put('play', 'rules-review rc-start fleet-start work-start work-start-sel con-start resume-hold sup-resume');
        put('restart', 'rc-reconnect fleet-reconnect switch resume');
        put('pause', 'pause work-hold-sel');
        put('go', 'work-queue-sel');
        put('zip-folder', 'compact');
        put('gears', 'set-model set-effort');
        put('display', 'screen');
        put('move-to', 'takeover fleet-move');
        put('undo', 'fleet-leave');
        put('properties', 'detail-toggle account-props fleet-props build-props');
        put('internet', 'open-link work-issue');
        put('copy', 'copy-link');
        put('shortcut', 'link');
        put('ban', 'unlink con-revoke mem-reject rules-reject');
        put('save', 'sup-save');
        put('delete', 'sup-lock-remove sup-art-clean work-cancel work-cancel-sel build-end mem-remove con-remove release-claim');
        put('clear', 'rules-dismiss sup-art-forget sup-dismiss mem-unflag usage-ack usage-ack-all');
        put('checklist', 'mem-approve rules-accept work-issues');
        put('attach', 'work-merge');
        put('favorites', 'mem-pin');
        put('rename', 'mem-edit');
        put('find', 'inspect lock-inspect');
        return m;
    })();
    const withIcons = (list) => (Array.isArray(list) ? list.map((it) => (it.separator || it.icon !== undefined || !ACT_ICON[it.action] ? it : Object.assign({}, it, { icon: ACT_ICON[it.action] }))) : list);

    function commands(n) { return withIcons(commandList(n)); }
    function selCommands(n, key) { const r = selCommandList(n, key); return r ? Object.assign({}, r, { items: withIcons(r.items) }) : r; }

    function commandList(n) {
        switch (n.id) {
            case 'root': return [{ text: 'Add Account...', action: 'add-account' }, { text: 'New Session...', action: 'new-session' }];
            case 'accounts': return [{ text: loginRows().length ? 'Sign In Again...' : 'Add Account...', action: 'add-account' }].concat(loginRows().length ? [{ text: 'Add Account...', action: 'add-account' }] : []);
            case 'rc': return [{ text: 'Refresh Status', action: 'fleet-refresh' }];
            case 'co-builds': return [{ text: 'Post Message...', action: 'post' }];
            case 'co-devices': return [{ text: 'Release...', action: 'dev-release' }, { text: 'Read Again', action: 'dev-refresh' }];
            case 'co-locks': return [{ text: 'Read Again', action: 'locks-refresh' }];
            case 'co-work': return [{ text: 'New Request...', action: 'new-session' }, { text: 'Issues...', action: 'work-issues', disabled: !!S.sup.busy }, { text: 'Read Again', action: 'sup-refresh' }].concat(workMultiItems());
            case 'co-flow': return [{ text: WF.view === 'flow' ? 'Show as List' : 'Show as Flow', action: WF.view === 'flow' ? 'wf-view-list' : 'wf-view-flow' }, { text: 'Read Again', action: 'wf-refresh' }];
            case 'co-held':
            case 'co-input':
            case 'aw-sup':
            case 'co-pending':
            case 'aw-quiet': return [{ text: 'Read Again', action: 'sup-refresh' }];
            case 'co-done': return [{ text: 'Send Back to Work...', action: 'work-reopen', disabled: !!S.sup.busy }, { text: 'Read Again', action: 'sup-refresh' }].concat(workMultiItems());
            case 'aw-uns': return [{ text: 'New Session...', action: 'new-session' }, { text: 'Read Again', action: 'sup-refresh' }].concat(workMultiItems());
            case 'activity': return [{ text: 'Read Again', action: 'act-refresh' }];
            case 'bg-agents': return bgCommands(n);
            case 'memory': return [{ text: 'Read Again', action: 'mem-refresh' }];
            case 'mem-review': return [{ text: 'Ask the Supervisor to Review Now', action: 'mem-review-now', disabled: S.memBusy }, { text: 'Read Again', action: 'mem-refresh' }];
            case 'mem-digest': return [{ text: 'Read Again', action: 'mem-refresh' }];
            case 'rules': return [{ text: 'Open Rule', action: 'rules-open' }, { text: 'Rules Review', action: 'rules-goto' }, { text: 'Read Again', action: 'sup-refresh' }];
            case 'rules-review': return [{ text: 'Review Now', action: 'rules-review', disabled: !!(rulesData().running || S.rulesBusy) }, { text: 'Accept...', action: 'rules-accept' }, { text: 'Reject...', action: 'rules-reject' }, { text: 'Dismiss', action: 'rules-dismiss' }, { text: 'Read Again', action: 'sup-refresh' }];
            case 'contractors': return [{ text: 'Add Contractor...', action: 'con-add' }, { text: 'Read Again', action: 'con-refresh' }];
            case 'co-supervisor': return [{ text: 'Read Again', action: 'sup-refresh' }];
            case 'sup-settings': return [{ text: 'Read Again', action: 'sup-refresh' }, { text: 'Save Settings', action: 'sup-save', disabled: !S.sup.draft }];
            case 'sup-reviews': return [{ text: 'Read Again', action: 'sup-refresh' }];
            case 'sup-asks': return [{ text: 'Read Again', action: 'sup-refresh' }];
            case 'sup-holds': return [{ text: 'Resume', action: 'sup-resume' }, { text: 'Read Again', action: 'sup-refresh' }];
            case 'sup-locks': return [{ text: 'Remove Lock...', action: 'sup-lock-remove' }, { text: 'Read Again', action: 'sup-refresh' }];
            case 'sup-maint': return [{ text: 'Run Now', action: 'maint-run', disabled: !!((maintData() || {}).running || maintUi().busy) }, { text: 'Dry Run', action: 'maint-dry', disabled: !!((maintData() || {}).running || maintUi().busy) }, { text: 'Save Settings', action: 'maint-save', disabled: !maintUi().draft }, { text: 'Read Again', action: 'sup-refresh' }];
            case 'usage': return [{ text: 'Last 24 Hours', action: 'usage-d1', disabled: usgUi().days === 1 }, { text: 'Last 7 Days', action: 'usage-d7', disabled: usgUi().days === 7 }, { text: 'Read Again', action: 'usage-refresh' }];
            case 'usage-flags': return [{ text: 'Acknowledge', action: 'usage-ack', disabled: !(S.c && selId(S.c, 'ux:f:')) }, { text: 'Acknowledge All', action: 'usage-ack-all', disabled: !usgOpenFlags() }, { text: 'Read Again', action: 'usage-refresh' }];
            case 'sup-arts': return [{ text: 'Clean...', action: 'sup-art-clean' }, { text: 'Restore', action: 'sup-art-restore' }, { text: 'Forget', action: 'sup-art-forget' }, { text: 'Read Again', action: 'sup-refresh' }];
            case 'rc-host': return [
                { text: 'Reconnect', action: 'rc-reconnect' },
                { text: 'Start', action: 'rc-start', disabled: !!(S.host && S.host.remoteControl && S.host.remoteControl.active === 'active') },
                { text: 'Stop', action: 'rc-stop', disabled: !(S.host && S.host.remoteControl && S.host.remoteControl.active === 'active') }
            ];
            case 'sessions': return [{ text: 'New Session...', action: 'new-session' }];
            case 'co-root':
            case 'co-agents':
            case 'co-messages': return [{ text: 'Post Message...', action: 'post' }];
            default:
                if (nodeSid(n.id)) {
                    const id = nodeSid(n.id);
                    return sessionItems(id).concat(n.id.startsWith('t:') ? [{ separator: true }, { text: 'Close', action: 'close-chat', icon: 0 }] : []);
                }
                if (n.id.startsWith('aw:w:')) { const w = workOf(n.id.slice(5)); return w ? selCommands(n, `w:${w.id}`).items : []; }
                if (n.id.startsWith('bga:')) return bgCommands(n);
                if (n.id.startsWith('aw:a:')) { const m = /^aw:a:([^:]+):(.+)$/.exec(n.id); return m ? [{ text: 'Read Its Conversation', action: 'agent-open' }, { text: 'Read Again', action: 'aw-agents-refresh' }] : []; }
                if (n.id.startsWith('ctS:')) return [{ text: 'Steer...', action: 'con-steer' }, { text: 'Stop Current Turn', action: 'con-interrupt' }, { text: 'Stop Session', action: 'con-stop' }, { text: 'Read Again', action: 'con-reread' }];
                if (n.id.startsWith('ct:')) { const k = conOf(n.id.slice(3)); return [{ text: 'Start Session...', action: 'con-start', disabled: !(k && k.online) }, { separator: true }, { text: 'Revoke...', action: 'con-revoke', disabled: !k || k.revoked }, { text: 'Remove...', action: 'con-remove' }, { separator: true }, { text: 'Add Contractor...', action: 'con-add' }, { text: 'Read Again', action: 'con-refresh' }]; }
                if (n.id.startsWith('i:')) return [{ text: 'Read Again', action: 'inspect-refresh' }, { text: 'Open Session', action: 'inspect-session' }, { separator: true }, { text: 'Close', action: 'close-inspect', icon: 0 }];
                return [];
        }
    }

    function sessionItems(id) {
        const l = liveOf(id);
        const server = !!l && serverOrigin(id);
        const typed = server
            ? [{ text: 'Take Over in Fleet...', action: 'takeover' }, { text: holdOf(id) ? 'Resume' : 'Pause...', action: holdOf(id) ? 'resume-hold' : 'pause', disabled: !l }]
            : [
                { text: 'Send Message...', action: 'message', disabled: !l },
                { text: 'Stop Current Turn', action: 'interrupt', disabled: !(l && l.status === 'busy') },
                { text: holdOf(id) ? 'Resume' : 'Pause...', action: holdOf(id) ? 'resume-hold' : 'pause', disabled: !l },
                { text: 'Compact', action: 'compact', disabled: !l },
                { text: 'Set Model...', action: 'set-model', disabled: !l },
                { text: 'Set Effort...', action: 'set-effort', disabled: !l },
                { text: 'Show Screen', action: 'screen', disabled: !l }
            ];
        return [{ text: 'Open', action: 'open-session' }].concat(typed, [
            { separator: true },
            { text: chatOf(id) && chatOf(id).view === 'detail' ? 'Conversation' : 'Details', action: 'detail-toggle' },
            { text: 'Rename...', action: 'rename-session' },
            { separator: true },
            { text: 'Resume in Remote Control...', action: 'resume', disabled: !!l },
            { text: 'Open in claude.ai', action: 'open-link', disabled: !(l && l.link) },
            { text: 'Copy Link', action: 'copy-link', disabled: !(l && l.link) },
            { separator: true },
            { text: 'End Session', action: 'end', disabled: !(l && l.origin === 'rc') }
        ], id === managerSid() ? [{ separator: true }, { text: 'Change Manager Session...', action: 'mg-clear' }] : []);
    }

    function selCommandList(n, key) {
        if (!key) return null;
        if (key.startsWith('s:')) { const row = rowOf(key.slice(2)); return { title: titleOf(row || { id: key.slice(2) }), items: sessionItems(key.slice(2)) }; }
        if (key.startsWith('a:')) {
            const a = S.accounts.find((x) => x.index === Number(key.slice(2)));
            if (!a) return null;
            return {
                title: a.name,
                items: (needsLogin(a.index) ? [{ text: 'Sign In Again...', action: 'add-account' }, { separator: true }] : []).concat([
                    { text: a.active ? 'Reconnect Remote Control' : 'Switch To', action: 'switch' },
                    { text: 'New Session on This Account...', action: 'new-session-on' },
                    { separator: true },
                    { text: 'Link Host Login', action: 'link' },
                    { text: 'Unlink Login', action: 'unlink', disabled: !a.remoteLogin },
                    { separator: true },
                    { text: 'Properties', action: 'account-props' }
                ])
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
        if (key.startsWith('d:')) {
            const d = devData().find((x) => x.device === key.slice(2));
            if (!d) return null;
            return { title: d.label, items: [{ text: 'Release', action: 'dev-release', disabled: !d.holder }, { text: 'Read Again', action: 'dev-refresh' }] };
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
        if (key.startsWith('v:')) {
            const r = supReview(key.slice(2));
            if (!r) return null;
            const sendable = r.verdict === 'gaps' && !r.delivered && !!liveOf(r.sessionId);
            return { title: r.title || 'Review', items: [{ text: 'Send to Session', action: 'sup-send', disabled: !sendable || !!S.sup.busy }, { text: 'Re-check', action: 'sup-recheck', disabled: !!S.sup.busy }, { text: 'Dismiss', action: 'sup-dismiss', disabled: !!r.dismissed }, { separator: true }, { text: 'Open Session', action: 'open-session' }] };
        }
        if (key.startsWith('w:')) {
            const w = workOf(key.slice(2));
            if (!w) return null;
            if (wsel().length > 1) return null; // the node's own Actions already act on the picked set
            return { title: w.title || 'Request', items: [{ text: 'Start Now', action: 'work-start', disabled: !WORK_STARTABLE.has(w.state) || !!S.sup.busy }, { text: 'Move to Waiting', action: 'work-hold-sel', disabled: !WORK_HOLDABLE.has(w.state) || !!S.sup.busy }, { text: 'Cancel', action: 'work-cancel', disabled: !WORK_OPEN.has(w.state) || !!S.sup.busy }, { text: w.sessionId && holdOf(w.sessionId) ? 'Resume' : 'Pause...', action: w.sessionId && holdOf(w.sessionId) ? 'resume-hold' : 'pause', disabled: !w.sessionId || !liveOf(w.sessionId) }, { separator: true }, { text: 'Open Session', action: 'work-open', disabled: !w.sessionId }, { text: 'Send Back to Work...', action: 'work-reopen', disabled: !(['done', 'failed'].includes(w.state) && w.sessionId) || !!S.sup.busy }, { text: 'Open Issue', action: 'work-issue', disabled: !(w.issue && w.issue.url) }] };
        }
        if (key.startsWith('lk:')) { const l = supLocks().find((x) => `${x.root || ''}|${x.file}` === key.slice(3)); return { title: 'Busy Lock', items: [{ text: 'Remove...', action: 'sup-lock-remove', disabled: !l || l.state !== 'orphan' || !!S.sup.busy }] }; }
        if (key.startsWith('ar:')) { const a = supArtifacts().find((x) => String(x.id) === key.slice(3)); return { title: 'Work Folder', items: [{ text: 'Clean...', action: 'sup-art-clean', disabled: !a || !a.cleanable || !!S.sup.busy }, { text: 'Restore', action: 'sup-art-restore', disabled: !a || !a.canRestore || !!S.sup.busy }, { text: 'Forget', action: 'sup-art-forget', disabled: !a || !!S.sup.busy }] }; }
        if (key.startsWith('me:')) {
            const m = memOf(key.slice(3));
            if (!m) return null;
            return { title: m.title || 'Memory', items: [{ text: 'Open', action: 'mem-open' }, { separator: true }, { text: 'Approve', action: 'mem-approve', disabled: m.status !== 'proposed' }, { text: 'Reject...', action: 'mem-reject', disabled: m.status !== 'proposed' }, { text: m.pinned ? 'Unpin' : 'Pin', action: 'mem-pin' }, { text: 'Clear Flag', action: 'mem-unflag', disabled: !m.flagged }, { separator: true }, { text: 'Edit...', action: 'mem-edit' }, { text: 'Remove...', action: 'mem-remove' }] };
        }
        if (key.startsWith('bg:')) return bgSelCommands();
        if (key.startsWith('x:')) { const r = S.act.rows.find((x) => String(x.id) === key.slice(2)); return { title: 'Activity', items: [{ text: 'Open Details', action: 'act-open' }, { text: 'Open Session', action: 'act-session', disabled: !(r && r.sessionId) }] }; }
        if (key.startsWith('hd:')) { const h = supHolds().find((x) => String(x.id) === key.slice(3)); return { title: 'Paused Session', items: [{ text: 'Resume', action: 'sup-resume', disabled: !h || !!S.sup.busy }, { text: 'Open Session', action: 'sup-hold-open', disabled: !h }] }; }
        if (key.startsWith('k:')) { const k = conOf(key.slice(2)); return { title: 'Contractor', items: [{ text: 'Open', action: 'con-open' }, { text: 'Start Session...', action: 'con-start', disabled: !(k && k.online) }, { text: 'Revoke...', action: 'con-revoke', disabled: !k || k.revoked }, { text: 'Remove...', action: 'con-remove' }, { separator: true }, { text: 'Add Contractor...', action: 'con-add' }] }; }
        if (key.startsWith('c:')) return { title: 'Claim', items: [{ text: 'Release', action: 'release-claim' }] };
        if (key.startsWith('m:')) return { title: 'Message', items: [{ text: 'Read', action: 'read-message' }, { text: 'Reply...', action: 'reply' }] };
        return null;
    }

    /** The selected work item: a list row (w:<id>), its tree node (aw:w:<id>) or a link's argument. */
    function workSel(c, arg) {
        if (arg != null && arg !== '' && workOf(arg)) return String(arg);
        const k = selId(c, 'w:');
        if (k) return k;
        return c.node && c.node.startsWith('aw:w:') ? c.node.slice(5) : '';
    }

    /** The selected contractor: its list row (k:<id>) or its tree node (ct:<id>). */
    const conSel = (c) => selId(c, 'k:') || (c.node && /^ct:/.test(c.node) ? c.node.slice(3) : '');
    const conSessKey = (c) => { const m = /^ctS:([^:]+):(.+)$/.exec(c.node || ''); return m ? `${m[1]}|${m[2]}` : ''; };

    function selId(c, prefix) {
        const k = c.sel || '';
        return k.startsWith(prefix) ? k.slice(prefix.length) : '';
    }

    function openChat(c, id) {
        if (!id) return;
        if (!S.open.includes(id)) S.open.push(id);
        if (S.open.length > 8) S.open.shift();
        c.open.add('co-work');
        c.open.add('sessions');
        c.select(`t:${id}`, true);
    }

    async function failBox(c, e) { await c.box(`<p>${esc(errText(e))}</p>`, null, { icon: 'error' }); }

    async function action(a, c, arg) {
        if (a.startsWith('show:')) { await setShow(a.slice(5), !S.show[a.slice(5)]); return true; }
        if (a.startsWith('bg-')) return bgAction(a, c, arg);
        const sid = arg && /^[0-9a-f-]{36}$/.test(arg) ? arg : (selId(c, 's:') || nodeSid(c.node) || ((supReview(selId(c, 'v:')) || {}).sessionId || '') || ((workOf(workSel(c)) || {}).sessionId || ''));
        switch (a) {
            case 'refresh':
                S.sessionsLoaded = false;
                S.chats.forEach((ch, id) => { if (nodeSid(c.node) === id) void loadChat(id, false); });
                if (S.locks) S.locks = null;
                if (S.inspect && c.node === `i:${S.inspect.id}`) void loadInspect(S.inspect.id);
                await Promise.all([refreshAccounts(), loadSessions(false), loadMessages()]);
                return true;
            case 'fleet-refresh': await loadFleet(); return true;
            case 'fold-open': if (S.foldCtx) await openFold(S.foldCtx.id, S.foldCtx.agent, S.foldCtx.el); return true;
            case 'sup-refresh': await loadSupervisor(); return true;
            case 'usage-toggle': { if (arg) usgSetOpen(arg, !usgUi().open.has(arg)); return true; }
            case 'usage-d1': case 'usage-d7': { const u = usgUi(); u.days = a === 'usage-d7' ? 7 : 1; u.data = null; u.sel = ''; u.det.clear(); void usgLoad(); repaint(); return true; }
            case 'usage-refresh': { const u = usgUi(); u.det.clear(); u.flags = null; void usgLoad(); void loadSupervisor(); repaint(); return true; }
            case 'usage-ack': await usgAck(c, arg); return true;
            case 'usage-ack-all': {
                // seen flags go: the list shows only open ones (a flag not seen again for a day also clears itself)
                try {
                    const r = unwrap(await send('claude_desk_supervisor', { action: 'usage_ack_all' }), 'flags');
                    usgUi().flags = r.flags || [];
                    if (r.summary && S.sup.data) S.sup.data = Object.assign({}, S.sup.data, { usage: r.summary });
                } catch (e) { await failBox(c, e); }
                repaint();
                return true;
            }
            case 'maint-run': await maintAct(c, { action: 'maintenance_run' }, 'Starting the maintenance run...'); return true;
            case 'maint-dry': await maintAct(c, { action: 'maintenance_run', dryRun: true }, 'Starting a dry run...'); return true;
            case 'maint-save': { const dr = maintUi().draft; if (dr) await maintAct(c, { action: 'maintenance_save', settings: { enabled: !!dr.enabled, time: String(dr.time || '').trim(), dryRun: !!dr.dryRun, deleteRemoteBranches: !!dr.deleteRemoteBranches, checks: dr.checks } }, 'Saving...'); return true; }
            case 'pause': if (sid) await pauseBox(c, sid); else c.note('Select a running session first.'); return true;
            case 'resume-hold': if (sid) await resumeHold(c, sid); return true;
            case 'sup-resume': {
                const h = supHolds().find((x) => String(x.id) === selId(c, 'hd:'));
                if (h) await resumeHold(c, h.sessionId); else c.note('Select a paused session first.');
                return true;
            }
            case 'sup-hold-open': {
                const h = supHolds().find((x) => String(x.id) === selId(c, 'hd:'));
                if (h) { await loadSessions(false); openChat(c, h.sessionId); }
                return true;
            }
            case 'act-refresh': Object.assign(S.act, { rows: [], next: null, total: 0, loaded: false }); await loadActivity(false); return true;
            case 'act-search': {
                const q = c.modal.querySelector('[data-act-f="q"]');
                if (q) { S.act.q = q.value.trim(); S.act.qDraft = q.value; }
                Object.assign(S.act, { rows: [], next: null, total: 0, loaded: false });
                await loadActivity(false);
                return true;
            }
            case 'act-more': await loadActivity(true); return true;
            case 'mem-refresh':
                [S.mem, S.memRv].forEach((L) => { L.rows = []; L.next = null; L.loaded = false; });
                S.dig.loaded = false;
                await Promise.all([c.node === 'mem-digest' ? loadDigest() : loadMem(c.node === 'mem-review' ? S.memRv : S.mem, false), loadMemStats()]);
                return true;
            case 'mem-search': {
                const q = c.modal.querySelector('[data-mem-f="q"]');
                if (q) { S.mem.q = q.value.trim(); S.mem.qDraft = q.value; }
                Object.assign(S.mem, { rows: [], next: null, loaded: false });
                await loadMem(S.mem, false);
                return true;
            }
            case 'mem-more': await loadMem(S.mem, true); return true;
            case 'mem-open': await openMemory(memSel(c, arg)); return true;
            case 'mem-approve':
            case 'mem-reject':
            case 'mem-pin':
            case 'mem-unflag':
            case 'mem-edit':
            case 'mem-remove': {
                const id = memSel(c, arg);
                let m = memOf(id);
                if (!m) return true;
                if (a === 'mem-edit') { try { m = (await memCall({ action: 'get', id })).memory || m; } catch (e) { await failBox(c, e); return true; } }
                await memAct(a.slice(4), m, null, null);
                return true;
            }
            case 'mem-review-now': {
                if (S.memBusy) return true;
                S.memBusy = true;
                c.note('Asking the Supervisor to review...');
                try {
                    const r = unwrap(await send('claude_fleet_memory', { action: 'review' }), 'decided');
                    const n = Array.isArray(r.decided) ? r.decided.length : Number(r.decided) || 0;
                    c.note(`The Supervisor decided ${n} ${n === 1 ? 'memory' : 'memories'}.`);
                } catch (e) { c.note(''); await failBox(c, e); }
                S.memBusy = false;
                memReload();
                repaint();
                return true;
            }
            case 'act-open': await openActivity(selId(c, 'x:')); return true;
            case 'act-session': {
                const r = S.act.rows.find((x) => String(x.id) === selId(c, 'x:'));
                if (r && r.sessionId) { await loadSessions(false); openChat(c, r.sessionId); }
                return true;
            }
            case 'rules-open': await ruleRead(c, selId(c, 'ru:')); return true;
            case 'work-ask': {
                // Yozora as the item's assistant: a new chat with her, its box holding what the item is; the person asks
                const w = workOf(arg || workSel(c));
                if (!w) return true;
                const lines = [
                    `About Fleet work item #${w.id}: ${w.title || ''}`,
                    `State: ${workState(w)}${w.account ? ` - account ${w.account && w.account.name ? w.account.name : w.account}` : ''}${w.topology ? ` - ${w.topology}` : ''}`,
                    w.issue && w.issue.url ? `Issue: ${w.issue.url}` : '',
                    w.sessionId ? `Session: ${w.sessionId}${w.link ? ` (${w.link})` : ''}` : '',
                    w.cwd ? `Folder: ${w.cwd}` : '',
                    '',
                    ''
                ].filter((x, i, a) => x !== '' || i >= a.length - 2);
                const d = root.directorInstance;
                let ok = false;
                try { ok = !!(d && typeof d.askXi === 'function' && await d.askXi(lines.join('\n'))); } catch (_) { ok = false; }
                if (!ok) await c.box('<p>Yozora is not available here: the Director is not loaded or Yozora is off in its settings.</p>', null, { icon: 'warning', title: 'Ask Yozora' });
                return true;
            }
            case 'mg-use': {
                const sel = c.modal.querySelector('[data-cd-mg]');
                const sid = sel ? sel.value : '';
                if (!sid) return true;
                await supAct(c, { action: 'manager_set', sessionId: sid }, 'Saving...');
                c.select(`mg:${sid}`, true);
                return true;
            }
            case 'mg-start': {
                c.note('Starting the Manager Session...');
                try {
                    const r = await send('claude_desk_session', { action: 'start', prompt: MANAGER_BRIEF, account: 'auto', model: 'opus', effort: 'high', supervised: false, engine: 'claude', title: 'Manager Session' });
                    const res = r.result || {};
                    if (!res.id) throw new Error(res.message || 'The session did not start');
                    await supAct(c, { action: 'manager_set', sessionId: res.id }, 'Saving...');
                    await loadSessions(false);
                    c.select(`mg:${res.id}`, true);
                } catch (e) { c.note(''); await failBox(c, e); }
                return true;
            }
            case 'mg-clear': {
                await supAct(c, { action: 'manager_set', sessionId: '' }, 'Saving...');
                c.select('sup-manager', true);
                return true;
            }
            case 'rules-goto': c.open.add('memory'); c.open.add('rules'); c.select('rules-review', true); return true;
            case 'rules-review': await rulesReviewStart(c); return true;
            case 'rules-dismiss': await ruleFindingDismiss(c, selId(c, 'rf:')); return true;
            case 'rules-accept': await ruleAcceptSelected(c); return true;
            case 'rules-reject': await ruleRejectSelected(c); return true;
            case 'rules-explain': await rulesExplainSend(c); return true;
            case 'con-refresh': S.con.loaded = false; await loadContractors(); return true;
            case 'con-open': { const k = conOf(selId(c, 'k:')); if (k) { c.open.add('contractors'); c.select(`ct:${k.id}`, true); } return true; }
            case 'con-add': await contractorAddBox(c); return true;
            case 'con-start': { const k = conOf(conSel(c)); if (k) await contractorStartBox(c, k); return true; }
            case 'con-revoke':
            case 'con-remove': {
                const k = conOf(conSel(c));
                if (!k) return true;
                const rev = a === 'con-revoke';
                const ok = await c.box(`<p>${rev ? 'Revoke' : 'Remove'} <b>${esc(conName(k))}</b>? ${rev ? 'It can no longer connect; its sessions end.' : 'It is taken off the list.'}</p>`, [{ text: rev ? 'Revoke' : 'Remove', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning' });
                if (ok !== true) return true;
                try { conTake(await send('claude_fleet_contractors', { action: rev ? 'revoke' : 'remove', id: k.id })); await loadContractors(); if (!rev) c.select('contractors', true); } catch (e) { await failBox(c, e); }
                return true;
            }
            case 'con-recent': {
                S.conRecent = S.conRecent || new Map();
                try { const r = unwrap(await send('claude_fleet_contractors', { action: 'sessions', id: arg }), 'recent'); S.conRecent.set(arg, Array.isArray(r.recent) ? r.recent : []); } catch (e) { await failBox(c, e); }
                c.refresh();
                return true;
            }
            case 'con-reread': { const [cid, sid2] = String(arg || conSessKey(c)).split('|'); S.conChats.delete(`${cid}|${sid2}`); c.render(); return true; }
            case 'con-steer': {
                const [cid, sid2] = String(arg || conSessKey(c)).split('|');
                const { value, fields } = await form(c, '<p>Send a message to the session. It reaches it as steering.</p><textarea data-cd="text" data-cd-focus rows="6" spellcheck="true"></textarea>', [{ text: 'Send', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Send Message' });
                if (value !== true || !String(fields.text || '').trim()) return true;
                try { await send('claude_fleet_contractors', { action: 'steer', id: cid, sessionId: sid2, text: fields.text }); c.note('Sent.'); } catch (e) { await failBox(c, e); }
                return true;
            }
            case 'con-interrupt':
            case 'con-stop': {
                const [cid, sid2] = String(arg || conSessKey(c)).split('|');
                try { await send('claude_fleet_contractors', { action: a === 'con-stop' ? 'stop' : 'interrupt', id: cid, sessionId: sid2 }); c.note(a === 'con-stop' ? 'The session was stopped.' : 'Stopped its current turn.'); } catch (e) { await failBox(c, e); }
                return true;
            }
            case 'aw-agents-refresh': {
                const m = /^aw:a:([^:]+):/.exec(c.node || '');
                const id = (arg && /^[0-9a-f-]{36}$/.test(arg) ? arg : '') || (m ? m[1] : '');
                if (id) await loadAwAgents(id);
                return true;
            }
            case 'agent-open': {
                let [ssid, aid] = String(arg || '').split('|');
                if (!aid) { const m = /^aw:a:([^:]+):(.+)$/.exec(c.node || ''); if (m) { ssid = m[1]; aid = m[2]; } }
                if (!ssid || !aid) return true;
                await loadSessions(false);
                openChat(c, ssid);
                const ch = chatOf(ssid);
                if (ch) { ch.view = 'detail'; await loadDetail(ssid); if (ch.dt) { ch.dt.agentSel = aid; void loadAgentPage(ssid, aid, false); } c.render(); }
                return true;
            }
            case 'work-use-brief': {
                const w = workOf(workSel(c, arg));
                if (w && w.check && w.check.suggestedBrief) await supAct(c, { action: 'work_update', id: w.id, prompt: w.check.suggestedBrief }, 'Updating the brief...');
                return true;
            }
            case 'work-answer': {
                const w = workOf(arg);
                if (!w || w.state !== 'input') { c.note('That item no longer waits for input.'); return true; }
                const d = (S.inDraft || {})[w.id] || [];
                const answers = (w.questions || []).map((q, i) => String(d[i] || '').trim());
                await supAct(c, { action: 'work_answer', id: w.id, answers }, 'Sending answers...');
                if (S.inDraft && !S.sup.error) delete S.inDraft[w.id];
                return true;
            }
            case 'work-reopen': {
                const w = workOf(workSel(c, arg));
                if (!w || !['done', 'failed'].includes(w.state) || !w.sessionId) { c.note('Pick a done or failed request that has a session.'); return true; }
                const { value, fields } = await form(c, `<p>Send <b>${esc(w.title || w.id)}</b> back to work. Its session gets your note and the request runs again.</p><label class="cd-top"><span>Note:</span><textarea data-cd="note" data-cd-focus rows="5" spellcheck="true" placeholder="What should it do next?"></textarea></label>`, [{ text: 'Send Back', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Send Back to Work' });
                if (value !== true || !String(fields.note || '').trim()) return true;
                await supAct(c, { action: 'work_reopen', id: w.id, note: String(fields.note).trim() }, 'Sending it back...');
                return true;
            }
            case 'work-start': {
                const w = workOf(workSel(c, arg));
                if (w) await supAct(c, { action: 'work_start', ids: [w.id] }, 'Starting the request...');
                return true;
            }
            case 'work-start-sel':
            case 'work-queue-sel': {
                const ids = workPicked(c).filter((i) => WORK_STARTABLE.has((workOf(i) || {}).state));
                if (!ids.length) { c.note('Pick a request that is waiting, queued, failed or cancelled first.'); return true; }
                const now = a === 'work-start-sel';
                await supAct(c, { action: 'work_start', ids, now }, now ? 'Starting...' : 'Queueing...');
                return true;
            }
            case 'work-hold-sel': {
                const ids = workPicked(c).filter((i) => WORK_HOLDABLE.has((workOf(i) || {}).state));
                if (!ids.length) { c.note('Pick a queued, failed or cancelled request first.'); return true; }
                await supAct(c, { action: 'work_hold', ids }, 'Moving to Waiting...');
                return true;
            }
            case 'work-merge': {
                const ids = wsel();
                const ws = ids.map(workOf);
                if (ids.length < 2 || !ws.every((w) => WORK_STARTABLE.has(w.state))) { c.note('Pick two or more requests that are waiting, queued, failed or cancelled.'); return true; }
                await mergeBox(c, ws);
                return true;
            }
            case 'work-issues': await issuePicker(c); return true;
            case 'work-goto': if (workOf(arg)) c.select(`aw:w:${arg}`, true); return true;
            case 'work-cancel-sel': {
                const ids = workPicked(c);
                if (!ids.length) { c.note('Pick a request first.'); return true; }
                const ok = await c.box(`<p>Cancel ${ids.length === 1 ? `<b>${esc((workOf(ids[0]) || {}).title || ids[0])}</b>` : `<b>${plural(ids.length, 'request')}</b>`}? A running one has its session stopped; the others are taken off the queue.</p>`,
                    [{ text: 'Cancel Requests', value: true, className: 'btn-standard primary' }, { text: 'Keep', value: false, className: 'btn-standard' }], { icon: 'warning' });
                if (ok !== true) return true;
                const errs = [];
                S.sup.busy = 'Cancelling...';
                c.note(S.sup.busy);
                for (const id of ids) {
                    try { await send('claude_desk_supervisor', { action: 'work_cancel', id }); } catch (e) { errs.push(`${(workOf(id) || {}).title || id}: ${errText(e)}`); }
                }
                S.sup.busy = '';
                c.note('');
                S.wsel = new Set();
                await loadSupervisor();
                if (errs.length) await c.box(`<p>Some requests could not be cancelled:</p><ul>${errs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`, null, { icon: 'warning' });
                return true;
            }
            case 'work-cancel': {
                const w = workOf(workSel(c, arg));
                if (!w) return true;
                const ok = await c.box(`<p>Cancel <b>${esc(w.title || w.id)}</b>?${w.sessionId ? ' Its session is stopped.' : ' It is taken off the queue.'}</p>`,
                    [{ text: 'Cancel Request', value: true, className: 'btn-standard primary' }, { text: 'Keep', value: false, className: 'btn-standard' }], { icon: 'warning' });
                if (ok === true) await supAct(c, { action: 'work_cancel', id: w.id }, 'Cancelling...');
                return true;
            }
            case 'work-issue': {
                const w = workOf(workSel(c, arg));
                if (w && w.issue && /^https?:\/\//.test(w.issue.url || '')) await call('openGrimoireUrl', w.issue.url); else c.note('It has no issue yet.');
                return true;
            }
            case 'wf-view-list': case 'wf-view-flow': arg = a.slice(8); // falls into wf-view
            // eslint-disable-next-line no-fallthrough
            case 'wf-view': WF.view = arg === 'list' ? 'list' : 'flow'; c.refresh(); wmPlace(); return true;
            case 'wf-refresh': await wfLoad(); return true;
            case 'wf-pick': WF.sel = String(arg || ''); if (workOf(WF.sel)) c.selectRow(`w:${WF.sel}`); else c.selectRow(null); c.refresh(); wmPlace(); return true;
            case 'wf-prio': { const [id, p] = String(arg || '').split('|'); await wfAct(c, { action: 'work_priority', id, priority: Number(p) }, 'Setting the priority...'); return true; }
            case 'wf-dep-add': await wfAddDep(c, String(arg || WF.sel)); return true;
            case 'wf-dep-remove': { const [id, on] = String(arg || '').split('|'); await wfAct(c, { action: 'work_dep_remove', id, on }, 'Removing the dependency...'); return true; }
            case 'wm-toggle': wmToggle(); return true;
            case 'wm-open': {
                const [kind, wsid, waid, wid] = String(arg || '').split('|');
                if (kind === 'agent' && wsid && waid) return action('agent-open', c, `${wsid}|${waid}`);
                if (kind === 'session' && wsid) { await loadSessions(false); openChat(c, wsid); } else if (wid) c.select(`aw:w:${wid}`, true);
                return true;
            }
            case 'work-open': {
                const w = workOf(workSel(c, arg));
                if (w && w.sessionId) { await loadSessions(false); openChat(c, w.sessionId); } else c.note('It has no session yet.');
                return true;
            }
            case 'sup-lock-remove': {
                const k = selId(c, 'lk:');
                const l = supLocks().find((x) => `${x.root || ''}|${x.file}` === k);
                if (!l) { c.note('Select a lock first.'); return true; }
                if (l.state !== 'orphan') { await c.box(`<p><b>${esc(l.file)}</b> belongs to an agent that is ${l.state === 'live' ? 'working' : 'still there'}. Only a lock whose agent is gone can be removed.</p>`, null, { icon: 'info', title: 'Remove Lock' }); return true; }
                const ok = await c.box(`<p>Remove the busy lock <b>${esc(l.file)}</b>${l.agentName ? ` of ${esc(l.agentName)}` : ''}? Its agent is gone, so nothing else holds it.</p>`,
                    [{ text: 'Remove', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning' });
                if (ok === true) await supAct(c, { action: 'lock_remove', file: l.file, root: l.root }, 'Removing the lock...');
                return true;
            }
            case 'sup-art-clean':
            case 'sup-art-forget': {
                const art = supArtifacts().find((x) => String(x.id) === selId(c, 'ar:'));
                if (!art) { c.note('Select a work folder or temp file first.'); return true; }
                const clean = a === 'sup-art-clean';
                if (clean && !art.cleanable) { await c.box(`<p><b>${esc(art.path)}</b> cannot be cleaned${art.state === 'live' ? ': its session is still using it' : art.state === 'gone' ? ': it is already gone from the disk' : ''}.</p>`, null, { icon: 'info', title: 'Clean' }); return true; }
                const ok = await c.box(clean ? `<p>Clean <b>${esc(art.path)}</b> (<b>${esc(bytesText(art.sizeBytes) || '0 B')}</b>)?</p><p>The Supervisor checks it first (recent changes, unsaved git work, running programs). If it is safe, it goes to the trash for 7 days and can be restored from here.</p>` : `<p>Forget <b>${esc(art.path)}</b>? It stays on the disk; it is only no longer tracked here.</p>`,
                    [{ text: clean ? 'Clean' : 'Forget', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning' });
                if (ok === true) await supAct(c, { action: clean ? 'artifact_clean' : 'artifact_forget', id: art.id }, clean ? 'The Supervisor is checking it...' : 'Forgetting...');
                return true;
            }
            case 'sup-art-restore': {
                const art = supArtifacts().find((x) => String(x.id) === selId(c, 'ar:'));
                if (!art || !art.canRestore) { c.note('Select a folder that is in the trash first.'); return true; }
                await supAct(c, { action: 'artifact_restore', id: art.id }, 'Restoring...');
                return true;
            }
            case 'sup-save': {
                if (!S.sup.draft) return true;
                const d = S.sup.draft;
                const extra = {};
                if (d.autoPauseOnCollision !== undefined) extra.autoPauseOnCollision = !!d.autoPauseOnCollision;
                if (d.ruleCheck !== undefined) extra.ruleCheck = !!d.ruleCheck;
                if (d.reviewScope) extra.reviewScope = d.reviewScope === 'all' ? 'all' : 'supervised';
                if (String(d.maxAskMinutes == null ? '' : d.maxAskMinutes).trim() !== '') extra.maxAskMinutes = Math.max(1, Math.min(1440, Math.round(Number(d.maxAskMinutes)) || 15));
                await supAct(c, { action: 'save', settings: Object.assign(extra, { enabled: !!d.enabled, engine: d.engine, model: String(d.model || '').trim(), effort: d.effort || '', delivery: d.delivery, manageLocks: !!d.manageLocks, trackArtifacts: !!d.trackArtifacts, maxConcurrent: Math.max(1, Math.min(32, Math.round(Number(d.maxConcurrent)) || 3)), autoStart: d.autoStart !== false, modelPolicy: d.modelPolicy || undefined, notify: d.notify && typeof d.notify === 'object' ? Object.keys(d.notify).reduce((o, k) => { o[k] = d.notify[k] === true; return o; }, {}) : undefined, yozoraRepos: (Array.isArray(d.yozoraRepos) ? d.yozoraRepos : String(d.yozoraRepos || '').split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean) }) }, 'Saving...');
                return true;
            }
            case 'sup-send': {
                const r = supReview(arg || selId(c, 'v:'));
                if (r) await supAct(c, { action: 'send', reviewId: r.id }, 'Typing the missed items into the session...');
                return true;
            }
            case 'sup-recheck': {
                const r = supReview(selId(c, 'v:')) || supReviews().find((x) => x.sessionId === arg);
                const sessionId = (r && r.sessionId) || arg;
                if (sessionId) await supAct(c, { action: 'recheck', sessionId }, 'Reviewing the session (this can take a minute)...');
                return true;
            }
            case 'sup-dismiss': {
                const id = arg || selId(c, 'v:');
                if (id) await supAct(c, { action: 'dismiss', reviewId: id }, 'Dismissing...');
                return true;
            }
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
            case 'dev-refresh': await loadMessages(); return true;
            case 'dev-release': await devRelease(c); return true;
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
                    if (r.agents) S.coord = { agents: r.agents, claims: r.claims || [], builds: r.builds || [], devices: r.devices || S.coord.devices, lastMessageId: r.lastMessageId || S.coord.lastMessageId };
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
                let text = input ? input.value.trim() : '';
                if (!text && !attOf(sid).length) return true;
                const btn = c.modal.querySelector('[data-act="send"]');
                if (btn) btn.disabled = true;
                try {
                    if (attOf(sid).length) {
                        const paths = await attUpload(sid);
                        text = `${text}${text ? '\n\n' : ''}Attached ${paths.length === 1 ? 'file' : 'files'} (read ${paths.length === 1 ? 'it' : 'them'} from disk):\n${paths.join('\n')}`;
                    }
                    await send('claude_desk_session', { action: 'steer', id: sid, text });
                    const ch = chatOf(sid);
                    if (ch) { (ch.pending = ch.pending || []).push({ text, at: Date.now(), steer: !!(liveOf(sid) && liveOf(sid).status === 'busy') }); ch.stick = true; pendingDraw(sid); }
                    // the page may have been drawn again while it was sent: clear the draft first, then the box on screen now
                    draftSet(sid, '', true);
                    attClear(sid);
                    const now = c.modal.querySelector('.cd-chat .cd-input') || input;
                    if (now) { now.value = ''; now.dispatchEvent(new Event('input', { bubbles: true })); }
                    if (input && input !== now) input.value = '';
                    c.note('Sent.');
                } catch (e) { await failBox(c, e); }
                if (btn) btn.disabled = false;
                return true;
            }
            case 'message': await messageBox(c, sid); return true;
            case 'takeover': await takeoverBox(c, nodeSid(c.node) || sid); return true;
            case 'detail-toggle': {
                const chat = chatOf(sid);
                if (!chat) return true;
                chat.view = chat.view === 'detail' ? 'chat' : 'detail';
                if (chat.view === 'chat') S.chatScrolled = false;
                c.render();
                return true;
            }
            case 'tasks-toggle': tasksToggle(); return true;
            case 'rename-session': await renameBox(c, sid); return true;
            case 'detail-refresh': await loadDetail(sid); return true;
            case 'agent-earlier': await loadAgentPage(nodeSid(c.node) || sid, arg, true); return true;
            case 'compact': await sessionCommand(c, sid, 'compact', undefined, 'Compacting the conversation...'); return true;
            case 'set-model':
            case 'set-effort': await setBox(c, sid, a === 'set-model' ? 'model' : 'effort'); return true;
            case 'screen': await screenBox(c, sid); return true;
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
            case 'account-props': await accountPropsBox(c, Number(selId(c, 'a:'))); return true;
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
        else if (key.startsWith('a:')) void action(needsLogin(Number(key.slice(2))) ? 'add-account' : 'account-props', c);
        else if (key.startsWith('g:')) void action('agent-session', c);
        else if (key.startsWith('m:')) void action('read-message', c);
        else if (key.startsWith('r:')) void action('fleet-props', c);
        else if (key.startsWith('b:')) void action('build-props', c);
        else if (key.startsWith('l:')) void action('lock-inspect', c);
        else if (key.startsWith('w:')) void action('work-open', c);
        else if (key.startsWith('x:')) void action('act-open', c);
        else if (key.startsWith('bg:')) void action('bg-open', c);
        else if (key.startsWith('me:')) void action('mem-open', c);
        else if (key.startsWith('hd:')) void action('sup-hold-open', c);
        else if (key.startsWith('k:')) void action('con-open', c);
        else if (key.startsWith('ru:')) void action('rules-open', c);
        else if (key.startsWith('ux:') && !key.startsWith('ux:f:')) { const k = key.slice(3); if (usgVisible(c, usgCols(c)).hasKids.has(k)) usgSetOpen(k, !usgUi().open.has(k)); }
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
                    box.querySelectorAll('[data-cd]').forEach((el) => { fields[el.dataset.cd] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value; });
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

    // ---- the New Session wizard (Vista's Aero Wizard: a heading, the page, Back / Next / Cancel) ----------------

    const DEFAULT_CWD = '/home/kanmi/staticforge';
    const WIZ_PATHS = [
        ['supervised', 'New supervised session', 'A session on the account you choose (or the best one for it) that a separate model checks when each turn ends: was the request and every steering message addressed?'],
        ['direct', 'Direct request on an account', 'A session on the account you name, with the model, effort and permissions you set. Nothing checks it afterwards.'],
        ['plaud', 'Import actionable items from Plaud', 'Reads your Plaud recordings and starts a Yozora chat for the actionable items in each.']
    ];
    const WIZ_TITLES = {
        type: ['What do you want to start?', 'Choose what the new session is for.'],
        supervised: ['New supervised session', 'Say what it should do and where. The account, model and effort start from the account\'s defaults.'],
        direct: ['Direct request on an account', 'Pick the account, say where it works and what to do.'],
        plaud: ['Import from Plaud', 'Choose the recordings whose actionable items should be worked on.'],
        shape: ['How the work is arranged', 'Choose who works on it and which engine, model and effort each stage uses.'],
        summary: ['Ready to start', 'Check what will happen, then click Finish.']
    };
    const pathName = (id) => (WIZ_PATHS.find((p) => p[0] === id) || [])[1] || '';
    const acctLabel = (v) => (v === 'auto' ? 'Auto (the preferred account, else the most headroom)' : (accountName(Number(v)) || ''));

    const CLAUDE_ENGINE = { id: 'claude', name: 'Claude (the account\'s plan)', defaultModel: 'sonnet', models: [], ready: true };
    const enginesNow = () => (S.engines && S.engines.length ? S.engines : [CLAUDE_ENGINE]);
    const engineOf = (id) => enginesNow().find((e) => e.id === (id || 'claude')) || null;
    const engineName = (id) => (engineOf(id) ? engineOf(id).name : (id || 'claude'));
    /** The engines a session or request can run on (claude_fleet_engines); a server without it offers Claude only. */
    async function loadEngines() {
        if (S.engines) return;
        try {
            const r = await send('claude_fleet_engines');
            S.engines = Array.isArray(r.engines) && r.engines.length ? r.engines : [CLAUDE_ENGINE];
        } catch (_) { S.engines = null; }
    }
    const engineOptions = (sel) => enginesNow().map((e) => `<option value="${esc(e.id)}"${e.id === (sel || 'claude') ? ' selected' : ''}>${esc(e.name || e.id)}${e.ready === false ? ' (not set up)' : ''}</option>`).join('');
    /** Another engine: the Claude model list does not apply; the model box shows that engine's own default. */
    function wizEngine(box, val) {
        const other = val && val !== 'claude';
        const e = engineOf(val);
        const sel = box.querySelector('[data-cd="model"]');
        const id = box.querySelector('[data-cd="modelId"]');
        if (sel) sel.disabled = !!other;
        if (id) id.placeholder = other ? ((e && e.defaultModel) || 'The engine\'s own default') : 'A full model ID (optional)';
    }
    /** The model to send: Claude's list or the typed ID; on another engine only the typed ID (blank = the engine's default). */
    const wizModel = (W) => (W.engine && W.engine !== 'claude' ? (String(W.modelId || '').trim() || undefined) : (modelOf(W) || 'sonnet'));

    /** Model, effort and permissions follow the account picked, until the person changes them. */
    function wizPrefill(box, val) {
        const eng = box.querySelector('[data-cd="engine"]');
        if (eng && eng.value !== 'claude') return;
        const f = val === 'auto' || val === '' ? fleetRows().find((x) => x.settings && x.settings.preferred) : fleetOf(Number(val));
        const st = (f && f.settings) || {};
        const model = st.defaultModel || 'sonnet';
        const known = MODEL_IDS.includes(model);
        const set = (key, v) => {
            const el = box.querySelector(`[data-cd="${key}"]`);
            if (el && v != null) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
        };
        set('model', known ? model : 'sonnet');
        set('modelId', known ? '' : model);
        set('effort', st.defaultEffort || '');
        set('mode', st.defaultMode || 'bypassPermissions');
    }

    function wizRecs(W) {
        if (W.recsGone) return `<p class="mmc-hint">${NOT_YET}</p>`;
        if (W.recsErr) return `<p class="cd-err">${esc(W.recsErr)}</p>`;
        const recs = W.recs || [];
        if (!recs.length) return '<p class="mmc-hint">Plaud has no recordings to list.</p>';
        const dur = (ms) => (ms ? `${Math.max(1, Math.round(ms / 60000))} min` : '');
        return `<div class="cd-carry cd-recs">${recs.map((r) => `<label class="cd-opt"><input type="checkbox" data-cd="rec:${esc(r.id)}"${W.picked && W.picked.has(String(r.id)) ? ' checked' : ''}><span>${esc(r.name || r.id)} <i>${esc([when(r.startAt), dur(r.durationMs)].filter(Boolean).join(', '))}</i></span></label>`).join('')}</div>`;
    }

    /** A stage as one line: engine, model, effort. */
    function stageText(st) {
        if (!st) return '';
        const other = st.engine && st.engine !== 'claude';
        const model = st.modelId || (other ? ((engineOf(st.engine) || {}).defaultModel || 'the engine\'s default') : ((MODEL_CHOICES.find((m) => m[0] === st.model) || [])[1] || st.model));
        return [other ? engineName(st.engine) : 'Claude', model, (EFFORTS.find((e) => e[0] === (st.effort || '')) || [])[1] || 'Default effort'].join(' / ');
    }
    /** What a stage sends: the engine, the model (the typed ID wins; another engine without one uses its default) and the effort. */
    function stagePayload(st) {
        const other = st.engine && st.engine !== 'claude';
        return { engine: st.engine || 'claude', model: st.modelId || (other ? undefined : st.model), effort: st.effort || undefined };
    }

    function wizBody(W, page) {
        const err = W.err ? `<p class="cd-err">${esc(W.err)}</p>` : '';
        if (page === 'type') {
            return WIZ_PATHS.map(([id, name, desc]) => `<label class="cd-cmdlink"><input type="radio" name="cd-path" data-cd="path:${id}"${W.path === id ? ' checked' : ''}><span><b>${esc(name)}</b><i>${esc(desc)}</i></span></label>`).join('');
        }
        if (page === 'supervised' || page === 'direct') {
            const direct = page === 'direct';
            const acct = direct ? `<label><span>Account:</span><select class="vdt-select" data-cd="account">${accountOptions(Number(W.account))}</select></label>`
                : `<label><span>Account:</span><select class="vdt-select" data-cd="account"><option value="auto"${W.account === 'auto' ? ' selected' : ''}>Auto (preferred, else most headroom)</option>${accountOptions(Number(W.account))}</select></label>`;
            const modelRows = direct ? `
                <label><span>Engine:</span><select class="vdt-select" data-cd="engine">${engineOptions(W.engine)}</select></label>` : '';
            const modelRows2 = direct ? `
                <label><span>Model:</span><select class="vdt-select" data-cd="model">${modelOptions(W.model || 'sonnet')}</select></label>
                <label><span>Or model ID:</span><input type="text" data-cd="modelId" value="${esc(W.modelId || '')}" spellcheck="false" autocomplete="off" placeholder="A full model ID (optional)"></label>
                <label><span>Effort:</span><select class="vdt-select" data-cd="effort">${effortOptions(W.effort)}</select></label>` : '';
            return `${acct}${modelRows}
                <label><span>Folder:</span><input type="text" data-cd="cwd" value="${esc(W.cwd)}" spellcheck="false" autocomplete="off"></label>
                <label class="cd-top"><span>Request:</span><textarea data-cd="prompt" data-cd-focus rows="5" spellcheck="true" placeholder="What should it do?">${esc(W.prompt)}</textarea></label>${modelRows2}
                ${direct ? `<label><span>Permissions:</span><select class="vdt-select" data-cd="mode">${modeSelect(W.mode || 'bypassPermissions')}</select></label>` : `<label><span>Link to issue:</span><input type="text" data-cd="issue" value="${esc(W.issue || '')}" spellcheck="false" autocomplete="off" placeholder="owner/repo#N, several = one run; blank: new issue" title="owner/repo#N or issue URLs, separated by spaces or commas; several run as one. Blank: a new issue is made."></label>`}
                <label class="cd-opt" title="Open it in claude.ai and take it over from the phone; without it, work it from Fleet only"><input type="checkbox" data-cd="remoteControl"${W.remoteControl ? ' checked' : ''}><span>Remote Control (open it in claude.ai and take it over from the phone; without it, work it from Fleet only)</span></label>${err}`;
        }
        if (page === 'shape') {
            const desc = { direct: 'One agent does the whole request.', surfaces: 'An agent works on each surface; the queue shows the parts.', planner: 'A planner starts background agents for the parts.', auto: 'One planner reviews the request and its issue first, then picks the shape: do it itself, run background agents, or split it into sessions per surface (default).' };
            const stage = (k) => {
                const st = W.stages[k];
                const def = STAGES[k];
                return `<div class="cd-stage" data-stage="${k}" data-uses="${def.uses.join(' ')}"${def.uses.includes(W.topology) ? '' : ' hidden'}><p><b>${esc(def.label)} stage</b> <span class="mmc-hint">${k === 'planner' ? 'reads the request and plans the parts' : 'does the work'}</span></p>
                    <label><span>Engine:</span><select class="vdt-select" data-cd="${k}.engine">${engineOptions(st.engine)}</select></label>
                    <label><span>Model:</span><select class="vdt-select" data-cd="${k}.model">${modelOptions(st.model)}</select></label>
                    <label data-cd-idrow="${k}"${st.engine && st.engine !== 'claude' ? '' : ' hidden'}><span>Model ID:</span><input type="text" data-cd="${k}.modelId" value="${esc(st.modelId || '')}" spellcheck="false" autocomplete="off" placeholder="A full model ID (optional)"></label>
                    <label><span>Effort:</span><select class="vdt-select" data-cd="${k}.effort">${effortOptions(st.effort)}</select></label></div>`;
            };
            return `${TOPO.map(([id, name]) => `<label class="cd-cmdlink"><input type="radio" name="cd-topo" data-cd="topo:${id}"${W.topology === id ? ' checked' : ''}><span><b>${esc(name)}</b><i>${esc(desc[id])}</i></span></label>`).join('')}${stage('planner')}${stage('workers')}${err}`;
        }
        if (page === 'plaud') {
            return `<label class="cd-opt"><input type="checkbox" data-cd="plaudAll"${W.all ? ' checked' : ''}><span>Every recording not worked yet</span></label>
                <p class="mmc-hint">Or tick the recordings (newest first):</p>${wizRecs(W)}${err}`;
        }
        // summary
        const rows = [['What', pathName(W.path)]];
        if (W.path === 'plaud') {
            rows.push(['Recordings', W.all ? 'Every recording not worked yet' : plural((W.picked || new Set()).size, 'recording')]);
        } else {
            const other = W.engine && W.engine !== 'claude';
            if (W.path === 'supervised') {
                rows.push(['Account', acctLabel(W.account)], ['Folder', W.cwd], ['Shape', (TOPO.find((x) => x[0] === W.topology) || [])[1] || '']);
                Object.keys(STAGES).filter((k) => STAGES[k].uses.includes(W.topology)).forEach((k) => rows.push([`${STAGES[k].label} stage`, stageText(W.stages[k])]));
            } else {
                rows.push(['Account', acctLabel(W.account)], ['Engine', engineName(W.engine)], ['Folder', W.cwd], ['Model', other ? (wizModel(W) || (engineOf(W.engine) || {}).defaultModel || 'The engine\'s default') : ((MODEL_CHOICES.find((m) => m[0] === modelOf(W)) || [])[1] || modelOf(W) || 'Sonnet')], ['Effort', (EFFORTS.find((e) => e[0] === (W.effort || '')) || [])[1] || 'Default']);
            }
            if (W.path === 'direct') rows.push(['Permissions', (MODES.find((m) => m[0] === W.mode) || [])[1] || W.mode]);
            rows.push(['Remote Control', W.remoteControl ? 'On' : 'Off']);
            rows.push(['Checked by supervisor', W.path === 'supervised' ? 'Yes (queued on the Supervisor)' : 'No']);
            if (W.path === 'supervised') rows.push([issueRefs(W.issue).length > 1 ? 'Issues' : 'Issue', issueRefs(W.issue).join(', ') || 'A new issue is made']);
        }
        return `<table class="cd-props">${rows.map(([k, v]) => `<tr><td>${esc(k)}:</td><td>${esc(v)}</td></tr>`).join('')}</table>
            ${W.path === 'plaud' ? '' : `<p><b>Request</b></p><p class="cd-read cd-summary-request">${esc(W.prompt)}</p>`}${err}`;
    }

    /** One wizard page: 'next' | 'back' | 'cancel'. What was entered goes back into W. */
    async function wizPage(c, W, page, first) {
        const [head, sub] = WIZ_TITLES[page];
        const last = page === 'summary';
        let boxRef = null;
        const { value, fields } = await form(c, `
            <div class="cd-wiz-head"><h3>${esc(head)}</h3><p>${esc(sub)}</p></div>
            <div class="cd-wiz-body">${wizBody(W, page)}</div>`,
        [first ? null : { text: 'Back', value: 'back', className: 'btn-standard' }, { text: last ? 'Finish' : 'Next', value: 'next', className: 'btn-standard primary' }, { text: 'Cancel', value: 'cancel', className: 'btn-standard' }].filter(Boolean),
        {
            title: 'New Session', width: 560, icon: 'fas fa-circle-info',
            ready: (box, signal) => {
                box.classList.add('cd-wizard');
                boxRef = box;
                const acct = box.querySelector('[data-cd="account"]');
                if (acct) {
                    if (W.model === undefined) wizPrefill(box, acct.value);
                    acct.addEventListener('change', () => wizPrefill(box, acct.value), { signal });
                }
                const eng = box.querySelector('[data-cd="engine"]');
                if (eng) {
                    wizEngine(box, eng.value);
                    eng.addEventListener('change', () => { wizEngine(box, eng.value); if (eng.value === 'claude' && acct) wizPrefill(box, acct.value); }, { signal });
                }
                if (page === 'shape') {
                    const sync = () => {
                        const on = box.querySelector('input[name="cd-topo"]:checked');
                        const topo = on ? on.dataset.cd.slice(5) : W.topology;
                        box.querySelectorAll('.cd-stage').forEach((st) => { st.hidden = !st.dataset.uses.split(' ').includes(topo); });
                    };
                    box.querySelectorAll('input[name="cd-topo"]').forEach((r) => r.addEventListener('change', sync, { signal }));
                    Object.keys(STAGES).forEach((k) => {
                        const eng = box.querySelector(`[data-cd="${k}.engine"]`);
                        const stageEngine = () => {
                            const other = eng.value && eng.value !== 'claude';
                            const e = engineOf(eng.value);
                            const sel = box.querySelector(`[data-cd="${k}.model"]`);
                            const id = box.querySelector(`[data-cd="${k}.modelId"]`);
                            if (sel) sel.disabled = !!other;
                            if (id) id.placeholder = other ? ((e && e.defaultModel) || 'The engine\'s own default') : 'A full model ID (optional)';
                            const row = box.querySelector(`[data-cd-idrow="${k}"]`);
                            if (row) row.hidden = !other;
                        };
                        if (eng) { stageEngine(); eng.addEventListener('change', stageEngine, { signal }); }
                    });
                }
                const all = box.querySelector('[data-cd="plaudAll"]');
                if (all) {
                    const sync = () => box.querySelectorAll('[data-cd^="rec:"]').forEach((el) => { el.disabled = all.checked; });
                    all.addEventListener('change', sync, { signal });
                    sync();
                }
                signal.addEventListener('abort', () => box.classList.remove('cd-wizard'), { once: true });
            }
        });
        if (value !== 'next' && value !== 'back') return 'cancel';
        // keep what was typed even on Back
        if (page === 'type') {
            const on = boxRef && boxRef.querySelector('input[name="cd-path"]:checked');
            const p = WIZ_PATHS.find(([id]) => (on ? on.dataset.cd === `path:${id}` : fields[`path:${id}`] === true));
            if (p) W.path = p[0];
        }
        else if (page === 'shape') {
            const p2 = Object.keys(fields).find((k) => k.startsWith('topo:') && fields[k] === true);
            const on = boxRef && boxRef.querySelector('input[name="cd-topo"]:checked');
            W.topology = on ? on.dataset.cd.slice(5) : (p2 ? p2.slice(5) : W.topology);
            Object.keys(STAGES).forEach((k) => { W.stages[k] = { engine: fields[`${k}.engine`] || 'claude', model: fields[`${k}.model`] || STAGES[k].model, modelId: String(fields[`${k}.modelId`] || '').trim(), effort: fields[`${k}.effort`] || '' }; });
        }
        else if (page === 'plaud') { W.all = !!fields.plaudAll; W.picked = new Set(Object.keys(fields).filter((k) => k.startsWith('rec:') && fields[k] === true).map((k) => k.slice(4))); }
        else if (page === 'supervised' || page === 'direct') {
            W.account = fields.account; W.cwd = String(fields.cwd || '').trim(); W.prompt = String(fields.prompt || '').trim();
            if (page === 'direct') { W.model = fields.model; W.modelId = String(fields.modelId || '').trim(); W.effort = fields.effort || ''; W.engine = fields.engine || 'claude'; }
            W.issue = String(fields.issue || '').trim();
            W.remoteControl = fields.remoteControl === true;
            if (page === 'direct') W.mode = fields.mode;
        }
        return value;
    }

    function wizCheck(W, page) {
        if (page === 'plaud') return W.all || (W.picked && W.picked.size) ? '' : 'Tick at least one recording, or choose every recording not worked yet.';
        if (page === 'supervised' || page === 'direct') {
            if (page === 'direct' && !Number.isInteger(Number(W.account))) return 'Pick the account the request runs on.';
            if (!W.cwd) return 'Say which folder it works in.';
            if (!W.prompt) return 'Say what it should do.';
            const bad = page === 'supervised' ? issueBad(W.issue) : '';
            if (bad) return `"${bad}" is not an issue. Use owner/repo#N or an issue URL, separated by spaces or commas.`;
        }
        return '';
    }

    async function wizLoadRecs(c, W) {
        if (W.recs || W.recsGone) return;
        c.note('Reading the Plaud recordings...');
        try {
            const r = await send('claude_fleet_plaud', { action: 'list' });
            W.recs = Array.isArray(r.recordings) ? r.recordings.slice().sort((x, y) => (y.startAt || 0) - (x.startAt || 0)) : [];
            W.recsErr = '';
        } catch (e) { if (isGone(e)) W.recsGone = true; else W.recsErr = errText(e); }
        c.note('');
    }

    /** Finish: starts it; false when it failed (the wizard stays on the summary with the reason). */
    async function wizFinish(c, W) {
        let body;
        let buttons = [{ text: 'Close', value: false, className: 'btn-standard' }];
        let link = '';
        try {
            if (W.path === 'plaud') {
                c.note('Queuing the requests...');
                const r = await send('claude_fleet_plaud', W.all ? { action: 'start', all: true } : { action: 'start', recordingIds: Array.from(W.picked) });
                const items = Array.isArray(r.work) ? r.work : [];
                const chats = Array.isArray(r.chats) ? r.chats : [];
                void loadSupervisor();
                body = items.length
                    ? `<p>${plural(items.length, 'request')} for the actionable items, on the Supervisor's Work Queue:</p>${workTable(items, (x) => (W.recs || []).map((rc) => (String(rc.id) === String(x.recordingId) ? rc.name : '')).join(''))}`
                    : (chats.length ? `<p>${plural(chats.length, 'chat')} started.</p>` : '<p>No recording had actionable items to start work for.</p>');
            } else {
                c.note('Starting the session...');
                const acct = W.account === 'auto' ? 'auto' : Number(W.account);
                if (W.path === 'supervised') {
                    // supervised requests are Supervisor work items: queued, and started at once when an account has room
                    const before = new Set(supWork().map((w) => String(w.id)));
                    const first = W.prompt.split('\n').find((x) => x.trim()) || W.prompt;
                    const stages = { planner: stagePayload(W.stages.planner), workers: stagePayload(W.stages.workers) };
                    // model / effort / engine at the top stay the Workers stage's, for a server that does not read stages yet
                    const job = { action: 'enqueue', title: first.trim().slice(0, 80), prompt: W.prompt, cwd: W.cwd, topology: W.topology, stages, model: stages.workers.model, effort: stages.workers.effort, startNow: true, engine: stages.workers.engine };
                    const refs = issueRefs(W.issue);
                    if (refs.length > 1) job.issues = refs; else if (refs.length) job.issue = refs[0];
                    job.remoteControl = !!W.remoteControl;
                    if (acct !== 'auto') job.account = acct;
                    const rr = await send('claude_desk_supervisor', job);
                    if (rr.settings) supTake(rr);
                    const list = supWork();
                    const item = rr.work && !Array.isArray(rr.work) ? rr.work : (list.find((w) => !before.has(String(w.id))) || list.slice().sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0))[0]);
                    body = item
                        ? `<p>The request is on the Supervisor's Work Queue.</p>${workTable([item])}${item.message ? `<p class="mmc-hint">${esc(item.message)}</p>` : ''}`
                        : '<p>The request was queued.</p>';
                    if (item && item.sessionId) { await loadSessions(false); openChat(c, item.sessionId); }
                    if (item && item.link) { link = item.link; buttons = [{ text: 'Open in claude.ai', value: 'open', className: 'btn-standard primary' }, { text: 'Copy Link', value: 'copy', className: 'btn-standard' }, { text: 'Close', value: false, className: 'btn-standard' }]; }
                    c.note('');
                    return await wizDone(c, W, body, buttons, link);
                }
                const payload = { action: 'start', cwd: W.cwd, prompt: W.prompt, account: acct, model: wizModel(W), effort: W.effort || undefined, supervised: false, engine: W.engine || 'claude', remoteControl: !!W.remoteControl };
                if (W.path === 'direct') payload.mode = W.mode;
                const r = await send('claude_desk_session', payload);
                const res = r.result || {};
                if (res.state === 'failed') { c.note(''); W.err = `The session did not start. ${res.message || ''}`.trim(); return false; }
                link = res.link || '';
                const rcUp = res.state === 'connected' || res.state === 'live';
                body = `<p>The session is ${rcUp ? 'running in Remote Control' : (res.state === 'running' && !link ? 'running (no Remote Control: work it from Fleet)' : 'starting')}${res.account ? ` on <b>${esc(res.account.name)}</b>` : ''}.</p>
                    <table class="cd-props"><tr><td>Session:</td><td>${esc(res.id || '')}</td></tr></table>${link ? `<p class="cd-link-line">${esc(link)}</p>` : ''}`;
                if (link) buttons = [{ text: 'Open in claude.ai', value: 'open', className: 'btn-standard primary' }, { text: 'Copy Link', value: 'copy', className: 'btn-standard' }, { text: 'Close', value: false, className: 'btn-standard' }];
                if (res.id) { await loadSessions(false); openChat(c, res.id); }
            }
        } catch (e) { c.note(''); W.err = errText(e); if (isGone(e)) W.err = NOT_YET; return false; }
        c.note('');
        return wizDone(c, W, body, buttons, link);
    }

    /** The last page: what was started; Open / Copy when there is a link. Always true (the wizard is done). */
    async function wizDone(c, W, body, buttons, link) {
        const go = await form(c, `<div class="cd-wiz-head"><h3>${W.path === 'direct' ? 'The session started' : 'The request is queued'}</h3><p>You can close this wizard.</p></div><div class="cd-wiz-body">${body}</div>`, buttons, { title: 'New Session', width: 560, icon: 'fas fa-circle-info', ready: (box, signal) => { box.classList.add('cd-wizard'); signal.addEventListener('abort', () => box.classList.remove('cd-wizard'), { once: true }); } });
        if (go.value === 'open' && link) await call('openGrimoireUrl', link);
        else if (go.value === 'copy' && link) { await copy(link); c.note('The link was copied to the Clipboard.'); }
        return true;
    }

    /** Queue as One Run (Work Queue): the picked requests become one request (work_merge); the selection moves to it. */
    async function mergeBox(c, ws) {
        const lines = ws.map((w) => `<li>${esc(w.title || String(w.id))}${issuesOf(w).length ? ` <span class="mmc-hint">(${esc(issuesOf(w).map(issueShort).join(', '))})</span>` : ''}</li>`).join('');
        const { value, fields } = await form(c, `<p>Join these ${ws.length} requests into one run? They share one session and one brief; the originals are marked as joined.</p><ul class="cd-merge-list">${lines}</ul>
            <label><span>Title:</span><input type="text" data-cd="title" data-cd-focus value="${esc(ws[0].title || '')}" spellcheck="false" autocomplete="off"></label>
            <label class="cd-opt"><input type="checkbox" data-cd="remoteControl"><span>Remote Control (open it in claude.ai and take it over from the phone; without it, work it from Fleet only)</span></label>`,
        [{ text: 'Queue as One Run', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Queue as One Run', width: 520 });
        if (value !== true) return;
        const job = { action: 'work_merge', ids: ws.map((w) => w.id), remoteControl: fields.remoteControl === true };
        const title = String(fields.title || '').trim();
        if (title) job.title = title;
        S.sup.busy = 'Joining the requests...';
        c.note(S.sup.busy);
        repaint();
        try {
            const r = await send('claude_desk_supervisor', job);
            S.wsel = new Set(r && r.work ? [String(r.work.id)] : []);
            await loadSupervisor(); // the list redraws in place (its scroll stays)
            if (r && r.work) c.selectRow(`w:${r.work.id}`);
        } catch (e) { supFail(e); await failBox(c, e); }
        S.sup.busy = '';
        c.note('');
        repaint();
    }

    /** Issues... (Work Queue): the open issues of a repository with check boxes; the picked ones are queued as one run (or one request). */
    async function issuePicker(c) {
        const P = { repo: '', repos: [], list: [], picked: new Map(), q: '', title: '', titled: false, rc: false, err: '', loading: true };
        const load = async (box) => {
            P.loading = true; P.err = '';
            paintList(box);
            try {
                const r = await send('claude_desk_supervisor', { action: 'issues_open', repo: P.repo || undefined });
                P.repo = r.repo || P.repo;
                P.repos = Array.isArray(r.repos) ? r.repos : [];
                P.list = Array.isArray(r.issues) ? r.issues : [];
            } catch (e) { P.list = []; P.err = isGone(e) ? NOT_YET : errText(e); }
            P.loading = false;
            const sel = box.querySelector('[data-iss="repo"]');
            if (sel) sel.innerHTML = P.repos.map((x) => `<option value="${esc(x)}"${x === P.repo ? ' selected' : ''}>${esc(x)}</option>`).join('');
            paintList(box);
        };
        const refOf = (i) => `${i.repo || P.repo}#${i.number}`;
        const paintList = (box) => {
            const el = box.querySelector('.cd-iss-list');
            if (!el) return;
            const top = el.scrollTop;
            const q = P.q.trim().toLowerCase();
            const rows = P.list.filter((i) => !q || `#${i.number} ${i.title} ${(i.labels || []).join(' ')}`.toLowerCase().includes(q));
            el.innerHTML = P.loading ? '<p class="mmc-hint">Reading the open issues...</p>' : P.err ? `<p class="cd-err">${esc(P.err)}</p>` : !rows.length ? '<p class="mmc-hint">No open issue matches.</p>'
                : rows.map((i) => `<label class="cd-opt" title="${esc(i.title)}"><input type="checkbox" data-pick="${esc(refOf(i))}"${P.picked.has(refOf(i)) ? ' checked' : ''}><span>#${esc(i.number)} ${esc(i.title)}${(i.labels || []).length ? ` <i class="mmc-hint">${esc(i.labels.map((l) => (l && l.name) || l).join(', '))}</i>` : ''}${i.item ? ` <i class="mmc-hint">in queue: item ${esc(i.item)}</i>` : ''}</span></label>`).join('');
            el.scrollTop = top;
        };
        for (;;) {
            const { value, fields } = await form(c, `<div class="cd-iss">
                <label><span>Repository:</span><select class="vdt-select" data-iss="repo"><option value="">Reading...</option></select></label>
                <label><span>Filter:</span><input type="text" data-iss="q" value="${esc(P.q)}" spellcheck="false" autocomplete="off" placeholder="Words in the title or labels"></label>
                <div class="cd-carry cd-iss-list"></div>
                <label><span>Title:</span><input type="text" data-cd="title" value="${esc(P.title)}" spellcheck="false" autocomplete="off"></label>
                <label class="cd-opt"><input type="checkbox" data-cd="remoteControl"${P.rc ? ' checked' : ''}><span>Remote Control (open it in claude.ai and take it over from the phone; without it, work it from Fleet only)</span></label>
                ${P.err && !P.loading && P.list.length ? `<p class="cd-err">${esc(P.err)}</p>` : ''}</div>`,
            [{ text: 'Queue as One Run', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }],
            {
                title: 'Open Issues', width: 580,
                ready: (box, signal) => {
                    let t = 0;
                    signal.addEventListener('abort', () => clearTimeout(t), { once: true });
                    const ti = box.querySelector('[data-cd="title"]');
                    ti.addEventListener('input', () => { P.titled = true; P.title = ti.value; }, { signal });
                    box.querySelector('[data-iss="q"]').addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(() => { P.q = ev.target.value; paintList(box); }, 150); }, { signal });
                    box.querySelector('[data-iss="repo"]').addEventListener('change', (ev) => { P.repo = ev.target.value; P.picked = new Map(); void load(box); }, { signal });
                    box.addEventListener('change', (ev) => {
                        const ck = ev.target.closest && ev.target.closest('[data-pick]');
                        if (!ck) return;
                        const ref = ck.dataset.pick;
                        if (ck.checked) P.picked.set(ref, (P.list.find((i) => refOf(i) === ref) || {}).title || ''); else P.picked.delete(ref);
                        if (!P.titled) { const first = P.picked.values().next(); ti.value = P.title = first.done ? '' : first.value; }
                    }, { signal });
                    if (P.list.length || P.repos.length) { P.loading = false; const sel = box.querySelector('[data-iss="repo"]'); sel.innerHTML = P.repos.map((x) => `<option value="${esc(x)}"${x === P.repo ? ' selected' : ''}>${esc(x)}</option>`).join(''); paintList(box); } else void load(box);
                }
            });
            if (value !== true) return;
            P.rc = fields.remoteControl === true;
            P.title = String(fields.title || '').trim();
            const refs = Array.from(P.picked.keys());
            if (!refs.length) { P.err = 'Tick at least one issue.'; continue; }
            P.err = '';
            const names = refs.map((r) => `${r.split('/').pop()}`).join(', ');
            const job = { action: 'enqueue', title: (P.title || P.picked.values().next().value || names).slice(0, 80), prompt: refs.length > 1 ? `Work these ${refs.length} related issues as one run: ${refs.join(', ')}.` : `Work issue ${refs[0]}.`, startNow: true, remoteControl: P.rc };
            if (refs.length > 1) job.issues = refs; else job.issue = refs[0];
            await supAct(c, job, 'Queueing the issues...');
            return;
        }
    }

    /** Work items as a small table: request, state, session. */
    function workTable(items, whoOf) {
        return `<table class="cd-table"><thead><tr><th>Request</th>${whoOf ? '<th>Recording</th>' : ''}<th class="cd-w80">State</th><th class="cd-w80">Session</th></tr></thead><tbody>${items.map((x) => `<tr><td>${esc(x.title || x.id)}</td>${whoOf ? `<td>${esc(whoOf(x) || x.recordingId || '')}</td>` : ''}<td>${esc(WORK_STATE[x.state] || x.state || '')}</td><td>${esc(x.sessionId ? shortId(x.sessionId) : '')}</td></tr>`).join('')}</tbody></table>`;
    }

    async function newSessionBox(c, accountIndex) {
        const pinned = Number.isInteger(accountIndex);
        const W = { path: pinned ? 'direct' : 'supervised', account: pinned ? String(accountIndex) : 'auto', cwd: DEFAULT_CWD, prompt: '', mode: 'bypassPermissions', picked: new Set(), err: '' };
        if (!pinned && defaultAccount() == null) W.account = 'auto';
        let page = 'type';
        W.engine = 'claude';
        W.topology = 'auto';
        W.stages = { planner: Object.assign({ modelId: '' }, STAGES.planner), workers: Object.assign({ modelId: '' }, STAGES.workers) };
        await loadEngines();
        for (;;) {
            const orderOf = () => (W.path === 'supervised' ? ['type', 'supervised', 'shape', 'summary'] : ['type', W.path, 'summary']);
            let order = orderOf();
            const r = await wizPage(c, W, page, page === 'type');
            if (r === 'cancel') return;
            order = orderOf(); // the first page may have changed the path
            W.err = '';
            if (r === 'back') { page = order[Math.max(0, order.indexOf(page) - 1)]; continue; }
            const bad = wizCheck(W, page);
            if (bad) { W.err = bad; continue; }
            if (page === 'summary') { if (await wizFinish(c, W)) return; continue; }
            page = order[order.indexOf(page) + 1];
            if (page === 'plaud') await wizLoadRecs(c, W);
        }
    }

    // ---- an account's properties (claude_fleet_account) ----------------------------------------------------

    const MODEL_IDS = MODELS.slice(1).map((m) => m[0]);
    const MODEL_CHOICES = [['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku'], ['fable', 'Fable']];
    const NOT_YET = 'This is not available on this server yet.';
    const isGone = (e) => SUP_GONE.test(errText(e));
    const modelOptions = (sel) => MODEL_CHOICES.map(([v, t]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');
    const effortOptions = (sel) => EFFORTS.map(([v, t]) => `<option value="${v}"${v === (sel || '') ? ' selected' : ''}>${esc(t)}</option>`).join('');
    const modeSelect = (sel) => MODES.map(([v, t]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');
    /** The model chosen: the full id typed wins over the list. */
    const modelOf = (fields) => String(fields.modelId || '').trim() || fields.model || undefined;
    /** A percentage field: blank = none (null); anything else must be 1 to 100. */
    function pctOf(v) {
        const t = String(v == null ? '' : v).trim();
        if (!t) return { value: null };
        const n = Number(t);
        return Number.isFinite(n) && n >= 1 && n <= 100 ? { value: Math.round(n) } : { error: true };
    }

    async function accountPropsBox(c, index) {
        const a = S.accounts.find((x) => x.index === index);
        if (!a) return;
        const f = fleetOf(index);
        const st = (f && f.settings) || {};
        const l = a.remoteLogin;
        const model = st.defaultModel || 'sonnet';
        const known = MODEL_IDS.includes(model);
        const rows = [['Engine account', a.active ? 'Yes' : 'No'], ['On the host', a.onHost ? 'Yes' : 'No'], ['Remote Control login', l ? (l.email || l.displayName) : 'None'],
            ['Plan', l ? l.plan : ''], ['Linked', l ? when(l.linkedAt) : '']].filter(([, v]) => v);
        let err = '';
        // what the boxes show: the saved settings, then what was typed when a retry is needed
        let cur = { name: a.name, preferred: !!st.preferred, priority: st.priority || 'normal', maxWeekly: st.maxWeeklyPct == null ? '' : st.maxWeeklyPct, maxSession: st.maxSessionPct == null ? '' : st.maxSessionPct, renewalDay: st.renewalDay == null ? '' : st.renewalDay,
            model: known ? model : 'sonnet', modelId: known ? '' : model, effort: st.defaultEffort || '', mode: st.defaultMode || 'bypassPermissions' };
        for (;;) {
            const { value, fields } = await form(c, `
                <table class="cd-props">${rows.map(([k, v]) => `<tr><td>${esc(k)}:</td><td>${esc(v)}</td></tr>`).join('')}</table>
                ${f ? '' : `<p class="mmc-hint">The account settings are not available on this server yet.</p>`}
                <label><span>Name:</span><input type="text" data-cd="name" data-cd-focus value="${esc(cur.name)}" spellcheck="false" autocomplete="off"></label>
                <label class="cd-opt"><input type="checkbox" data-cd="preferred"${cur.preferred ? ' checked' : ''}><span>Preferred account: new sessions use it first (only one account is preferred)</span></label>
                <label><span>Priority:</span><select class="vdt-select" data-cd="priority">${PRIORITY.map(([v, t]) => `<option value="${v}"${v === cur.priority ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
                <p class="mmc-hint cd-prio-hint">An account with a lower priority gets work only after the higher ones.</p>
                <label><span>Max weekly usage:</span><input type="text" data-cd="maxWeekly" value="${esc(cur.maxWeekly)}" inputmode="numeric" placeholder="% (blank: no limit)" autocomplete="off"></label>
                <label><span>Max session usage:</span><input type="text" data-cd="maxSession" value="${esc(cur.maxSession)}" inputmode="numeric" placeholder="% (blank: no limit)" autocomplete="off"></label>
                <label><span>Renewal day:</span><input type="text" data-cd="renewalDay" value="${esc(cur.renewalDay)}" inputmode="numeric" placeholder="Day of the month (blank: unknown)" autocomplete="off"></label>
                <label><span>Default model:</span><select class="vdt-select" data-cd="model">${modelOptions(cur.model)}</select></label>
                <label><span>Or model ID:</span><input type="text" data-cd="modelId" value="${esc(cur.modelId)}" spellcheck="false" autocomplete="off" placeholder="A full model ID (optional)"></label>
                <label><span>Default effort:</span><select class="vdt-select" data-cd="effort">${effortOptions(cur.effort)}</select></label>
                <label><span>Permissions:</span><select class="vdt-select" data-cd="mode">${modeSelect(cur.mode)}</select></label>
                ${err ? `<p class="cd-err">${esc(err)}</p>` : ''}`,
            [{ text: 'Save', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: `${a.name} Properties`, width: 480, icon: 'fas fa-circle-info' });
            if (value !== true) return;
            cur = { name: fields.name, preferred: !!fields.preferred, priority: fields.priority || 'normal', maxWeekly: fields.maxWeekly, maxSession: fields.maxSession, renewalDay: fields.renewalDay, model: fields.model, modelId: fields.modelId, effort: fields.effort, mode: fields.mode };
            const weekly = pctOf(fields.maxWeekly);
            const session = pctOf(fields.maxSession);
            const name = String(fields.name || '').trim();
            const rd = String(fields.renewalDay || '').trim();
            if (rd && !(/^\d{1,2}$/.test(rd) && Number(rd) >= 1 && Number(rd) <= 31)) { err = 'The renewal day is a day of the month from 1 to 31, or blank.'; continue; }
            if (weekly.error || session.error) { err = 'A maximum usage is a percentage from 1 to 100, or blank for none.'; continue; }
            if (!name) { err = 'The account needs a name.'; continue; }
            try {
                const r = await send('claude_fleet_account', { action: 'save', index, name, preferred: !!fields.preferred, priority: fields.priority || 'normal', maxWeeklyPct: weekly.value, maxSessionPct: session.value, renewalDay: rd ? Number(rd) : null, defaultModel: modelOf(fields) || 'sonnet', defaultEffort: fields.effort || '', defaultMode: fields.mode });
                if (r.fleet) S.fleet = r.fleet;
                c.note(`${name}: settings saved.`);
                await refreshAccounts();
                return;
            } catch (e) {
                if (isGone(e)) { await c.box(`<p>${NOT_YET}</p>`, null, { icon: 'info', title: `${a.name} Properties` }); return; }
                err = errText(e);
            }
        }
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
                ? `<div class="cd-carry">${list.map((x) => `<label class="cd-opt"><input type="checkbox" data-cd="carry:${esc(x.id)}"><span>${esc(x.title || shortId(x.id))}${x.folder ? ` <i>(${esc(x.folder)})</i>` : ''}</span></label>`).join('')}</div>`
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

    /** Add Contractor...: an invitation with a one-time code (15 minutes) and the install lines; the installer asks for the code. */
    async function contractorAddBox(c) {
        const { value, fields } = await form(c, `
            <p>A contractor is another machine that runs Fleet work on its own projects. Name it, then install the agent there.</p>
            <label><span>Name:</span><input type="text" data-cd="name" data-cd-focus spellcheck="false" autocomplete="off" placeholder="For example Studio PC"></label>`,
        [{ text: 'Next', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Add Contractor' });
        if (value !== true) return;
        const name = String(fields.name || '').trim();
        if (!name) { c.note('A contractor needs a name.'); return; }
        c.note('Making the invitation...');
        let r;
        try { r = await send('claude_fleet_contractors', { action: 'invite', name }); } catch (e) { c.note(''); if (isGone(e)) await c.box(`<p>${NOT_YET}</p>`, null, { icon: 'info', title: 'Add Contractor' }); else await failBox(c, e); return; }
        c.note('');
        const d = unwrap(r, 'invite');
        const inv = d.invite || {};
        const ins = d.install || {};
        if (!inv.code) { await c.box(`<p>${esc(d.message || 'The invitation was made.')}</p>`, null, { icon: 'info', title: 'Add Contractor' }); void loadContractors(); return; }
        const line = (k, t) => (ins[k] ? `<p><b>${esc(t)}:</b></p><pre class="cd-pre cd-invite" data-cd-invite="${k}">${esc(ins[k])}</pre><p><button type="button" class="btn-standard" data-cd-copy="${k}">Copy</button> <button type="button" class="btn-standard" data-cd-installer="${k === 'windows' ? 'windows' : 'linux'}">Save Installer...</button></p>` : '');
        const html = `<p>Invitation for <b>${esc(inv.name || name)}</b>. The code is shown once and expires ${inv.expiresAt ? `at ${esc(timeOnly(inv.expiresAt))}` : 'in 15 minutes'}.</p>
            <p class="cd-code" data-cd-invite="code">${esc(inv.code)}</p><p><button type="button" class="btn-standard" data-cd-copy="code">Copy Code</button></p>
            ${line('linux', 'Linux or macOS')}${line('windows', 'Windows')}${ins.note ? `<p class="mmc-hint">${esc(ins.note)}</p>` : '<p class="mmc-hint">The installer asks for the code.</p>'}`;
        await form(c, html, [{ text: 'Close', value: true, className: 'btn-standard primary' }], {
            title: 'Add Contractor', width: 540,
            ready: (box, signal) => box.addEventListener('click', async (ev) => {
                const b = ev.target.closest('[data-cd-copy]');
                if (b) { const pre = box.querySelector(`[data-cd-invite="${b.dataset.cdCopy}"]`); if (pre) void copy(pre.textContent).then(() => { b.textContent = 'Copied'; }); return; }
                const sv = ev.target.closest('[data-cd-installer]');
                if (!sv) return;
                try {
                    const f = unwrap(await send('claude_fleet_contractors', { action: 'installer', os: sv.dataset.cdInstaller }), 'text');
                    saveText(f.filename || `fleet-contractor-${sv.dataset.cdInstaller}`, f.text || '');
                    sv.textContent = 'Saved';
                } catch (e) { sv.textContent = errText(e).slice(0, 40); }
            }, { signal })
        });
        void loadContractors();
    }
    /** The installer goes to the browser's Downloads (a text blob, revoked after the click). */
    function saveText(name, text) {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    /** Start Session on a contractor: a project folder (from its projects), the request, its model and effort. */
    async function contractorStartBox(c, k) {
        const projects = conHello(k).projects || [];
        const { value, fields } = await form(c, `
            <p>Start a session on <b>${esc(conName(k))}</b>.</p>
            <label><span>Project:</span><select class="vdt-select" data-cd="proj">${projects.map((x) => `<option value="${esc(x.path)}">${esc(x.name || x.path)}</option>`).join('')}<option value="">Another folder...</option></select></label>
            <label><span>Folder:</span><input type="text" data-cd="cwd" value="${esc((projects[0] || {}).path || '')}" spellcheck="false" autocomplete="off"></label>
            <label class="cd-top"><span>Request:</span><textarea data-cd="prompt" data-cd-focus rows="5" spellcheck="true" placeholder="What should it do?"></textarea></label>
            <label><span>Model:</span><select class="vdt-select" data-cd="model">${modelOptions('sonnet')}</select></label>
            <label><span>Effort:</span><select class="vdt-select" data-cd="effort">${effortOptions('')}</select></label>`,
        [{ text: 'Start', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Start Session', width: 500, ready: (box, signal) => {
            const p = box.querySelector('[data-cd="proj"]');
            const f = box.querySelector('[data-cd="cwd"]');
            if (p && f) p.addEventListener('change', () => { if (p.value) { f.value = p.value; f.dispatchEvent(new Event('input', { bubbles: true })); } }, { signal });
        } });
        if (value !== true) return;
        const cwd = String(fields.cwd || '').trim();
        const prompt = String(fields.prompt || '').trim();
        if (!cwd || !prompt) { c.note('A session needs a folder and a request.'); return; }
        c.note('Starting the session...');
        try {
            const r = unwrap(await send('claude_fleet_contractors', { action: 'start', id: k.id, cwd, prompt, title: prompt.split('\n')[0].slice(0, 80), model: fields.model || undefined, effort: fields.effort || undefined }), 'sessionId');
            c.note(r.sessionId ? 'The session started.' : 'Starting...');
            await loadContractors();
            if (r.sessionId) { c.open.add('contractors'); c.open.add(`ct:${k.id}`); c.select(`ctS:${k.id}:${r.sessionId}`, true); }
        } catch (e) { c.note(''); if (isGone(e)) await c.box(`<p>${NOT_YET}</p>`, null, { icon: 'info' }); else await failBox(c, e); }
    }

    /** Pause a session: Hold (its turn stops, it waits for Resume) or Freeze (its processes stop where they are). */
    async function pauseBox(c, id) {
        const row = rowOf(id) || { id };
        const { value, fields } = await form(c, `
            <p>Pause <b>${esc(titleOf(row))}</b>. It does nothing more until it is resumed.</p>
            <label class="cd-opt cd-modeopt"><input type="radio" name="cd-pause" data-cd="hold" checked><span><b>Hold</b> (recommended): its current turn is stopped and it waits for Resume.</span></label>
            <label class="cd-opt cd-modeopt"><input type="radio" name="cd-pause" data-cd="freeze"><span><b>Freeze</b>: its processes are stopped where they are (like Ctrl+Z), so a build or a test run halts in the middle and continues on Resume. Use it when something must not run for a while.</span></label>
            <label class="cd-top"><span>Reason:</span><textarea data-cd="reason" data-cd-focus rows="3" spellcheck="true" placeholder="Why it is paused (shown beside the session)"></textarea></label>`,
        [{ text: 'Pause', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Pause Session', icon: 'fas fa-circle-info' });
        if (value !== true) return;
        const mode = fields.freeze === true ? 'freeze' : 'hold';
        await supAct(c, { action: 'pause', sessionId: id, mode, reason: String(fields.reason || '').trim() }, 'Pausing the session...');
    }
    async function resumeHold(c, id) {
        const row = rowOf(id) || { id };
        const h = holdOf(id);
        const { value, fields } = await form(c, `
            <p>Resume <b>${esc(titleOf(row))}</b>${h ? ` (${esc(holdLine(h))})` : ''}.</p>
            <label class="cd-top"><span>Note:</span><textarea data-cd="note" data-cd-focus rows="3" spellcheck="true" placeholder="Optional: typed to the session as it continues"></textarea></label>`,
        [{ text: 'Resume', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Resume Session', icon: 'fas fa-circle-info' });
        if (value !== true) return;
        const note = String(fields.note || '').trim();
        await supAct(c, Object.assign({ action: 'resume', sessionId: id }, note ? { note } : {}), 'Resuming the session...');
    }

    async function takeoverBox(c, id) {
        const row = rowOf(id) || { id };
        const ok = await c.box(`<p><b>${esc(titleOf(row))}</b> runs inside Remote Control's server.</p><p>Fleet ends this session's Remote Control process and continues the same conversation in a Fleet terminal, with Remote Control still on (its claude.ai link changes). Anything it is doing this second is interrupted.</p>`,
            [{ text: 'Take Over', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning', title: 'Take Over in Fleet' });
        if (ok !== true) return;
        c.note('Taking the session over...');
        try {
            const r = await send('claude_desk_session', { action: 'takeover', id });
            const res = r.result || {};
            c.note(res.message || 'The session now runs in a Fleet terminal.');
            const l = liveOf(id);
            if (l) { l.origin = 'rc'; if (res.link) l.link = res.link; }
            const ch = chatOf(id);
            if (ch && ch.dt && ch.dt.data) ch.dt.data.origin = 'rc';
            await loadSessions(false);
            if (ch && ch.dt) await loadDetail(id);
            if (S.c && nodeSid(S.c.node) === id) S.c.render();
        } catch (e) {
            c.note('');
            if (isGone(e)) await c.box(`<p>${NOT_YET}</p>`, null, { icon: 'info' }); else await failBox(c, e);
        }
    }

    /** One session command (claude_desk_session command): the reply's text goes in the status line. */
    async function sessionCommand(c, id, command, value, busy) {
        c.note(busy || 'Working...');
        try {
            const r = await send('claude_desk_session', { action: 'command', id, command, value });
            const res = r.result;
            const text = res && typeof res === 'object' ? (res.text || res.message || '') : String(res || '');
            c.note(text ? String(text).replace(/\s+/g, ' ').slice(0, 160) : 'Done.');
            return res;
        } catch (e) {
            c.note('');
            if (isGone(e)) await c.box(`<p>${NOT_YET}</p>`, null, { icon: 'info' }); else await failBox(c, e);
            return null;
        }
    }

    async function setBox(c, id, what) {
        const row = rowOf(id) || { id };
        const det = chatOf(id) && chatOf(id).dt && chatOf(id).dt.data;
        const cur = det ? det[what] : '';
        const { value, fields } = await form(c, what === 'model' ? `
            <p>Change the model <b>${esc(titleOf(row))}</b> uses from its next turn on.</p>
            <label><span>Model:</span><select class="vdt-select" data-cd="model">${modelOptions(MODEL_IDS.includes(cur) ? cur : 'sonnet')}</select></label>
            <label><span>Or model ID:</span><input type="text" data-cd="modelId" data-cd-focus value="${MODEL_IDS.includes(cur) ? '' : esc(cur || '')}" spellcheck="false" autocomplete="off" placeholder="A full model ID (optional)"></label>` : `
            <p>Change how hard <b>${esc(titleOf(row))}</b> thinks from its next turn on.</p>
            <label><span>Effort:</span><select class="vdt-select" data-cd="effort">${EFFORTS.filter(([v]) => v).map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`,
        [{ text: 'Set', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: what === 'model' ? 'Set Model' : 'Set Effort' });
        if (value !== true) return;
        const v = what === 'model' ? modelOf(fields) : fields.effort;
        if (!v) return;
        await sessionCommand(c, id, what, v, `Setting the ${what}...`);
    }

    /** The session's real terminal (its tmux pane, live) so menus Claude Code shows can be answered; false when the desktop has none. */
    async function openLiveTerminal(id) {
        try { if (root.featureLoader) await root.featureLoader.loadFeature('admin_terminal'); } catch (_) { /* fallback below */ }
        if (typeof root.openClaudeSessionTerminal !== 'function') return false;
        root.openClaudeSessionTerminal(id, titleOf(rowOf(id) || { id }));
        return true;
    }

    async function screenBox(c, id) {
        if (await openLiveTerminal(id)) return;
        try {
            const r = await send('claude_desk_session', { action: 'screen', id });
            const lines = (r.result && r.result.lines) || [];
            await c.box(`<pre class="cd-pre cd-screen">${esc(lines.join('\n') || '(the screen is empty)')}</pre>`, null, { icon: 'info', title: 'Terminal Screen', width: 600 });
        } catch (e) { await failBox(c, e); }
    }

    async function messageBox(c, id) {
        const row = rowOf(id) || { id };
        const l = liveOf(id);
        const { value, fields } = await form(c, `
            <p>Send a message to <b>${esc(titleOf(row))}</b>.${l && l.status === 'busy' ? ' It is working: the message reaches it as steering for its current turn.' : ''}</p>
            <textarea data-cd="text" data-cd-focus rows="6" spellcheck="true"></textarea>`,
        [{ text: 'Send', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: 'Send Message' });
        if (value !== true || !String(fields.text || '').trim()) return;
        try { await send('claude_desk_session', { action: 'steer', id, text: fields.text }); c.note('Sent.'); } catch (e) {
            // a menu on its screen owns the keys: open its terminal so she can answer it there
            if ((e.code === 'SESSION_DIALOG' || /^Not sent: the session is showing/.test(e.message || '')) && await openLiveTerminal(id)) { c.note('It is showing a question in its terminal: answer it there, then send again.'); return; }
            await failBox(c, e);
        }
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
            expanded: ['root', 'co-work'],
            // the tree was reorganised again (Nov 24 2026): Usage and Coordination moved under Activity, which starts closed
            expandedKey: 'ExpandedV3',
            about: { version: VERSION, lines: ['Claude accounts, Remote Control, sessions and agent coordination.'] },
            nodes,
            page,
            commands,
            selCommands,
            viewMenu: showMenuItems,
            action,
            rowOpen,
            status: (n) => {
                if (n.id === 'sessions') return S.sessionsLoaded ? `${S.sessions.length} of ${S.sessionsTotal} sessions` : '';
                if (n.id === 'accounts') return [plural(S.accounts.length, 'account'), loginText()].filter(Boolean).join(', ');
                if (n.id === 'rc') { const r = fleetRows(); return r.length ? [`${r.filter((f) => f.state === 'connected').length} of ${plural(r.length, 'account')} connected`, loginText()].filter(Boolean).join(', ') : ''; }
                if (n.id === 'memory') return S.mem.gone ? NOT_YET : (S.mem.loaded ? `${S.mem.rows.length} shown` : '');
                if (n.id === 'mem-review') return S.memRv.loaded ? `${S.memRv.rows.length} to review` : '';
                if (n.id === 'bg-agents') return plural(bgRows().length, 'background agent');
                if (n.id.startsWith('bga:')) { const m = /^bga:([^:]+):(.+)$/.exec(n.id); const r = m ? bgRow(m[1], m[2]) : null; return r ? `${BG_STATE[r.state] || ''}, read only` : ''; }
                if (n.id === 'activity') return S.act.loaded ? `${S.act.rows.length} of ${S.act.total} calls` : '';
                if (n.id === 'contractors') return S.con.gone ? NOT_YET : `${plural(S.con.list.length, 'contractor')}, ${S.con.list.filter((k) => k.online).length} online`;
                if (n.id === 'co-flow') return WF.graph ? `${plural(wfModel().nodes.length, 'open job')} in ${plural(new Set(wfModel().nodes.map((x) => x.lane || 0)).size, 'column')}` : '';
                if (n.id === 'co-held') return plural(heldItems().length, 'request') + ' waiting for you to start';
                if (n.id === 'co-input') return plural(inputItems().length, 'work item') + ' stopped on a question only you can answer';
                if (n.id === 'aw-sup') return plural(runItems().length, 'running work item');
                if (n.id === 'co-done') return `${plural(doneItems().length, 'work item')} finished in the last 7 days`;
                if (n.id === 'aw-quiet') return `${plural(unsupervisedQuiet().length, 'session')} idle for over an hour - select one to end it`;
                if (n.id === 'co-pending') return plural(pendItems().length, 'waiting work item');
                if (n.id === 'sup-holds') return plural(supHolds().length, 'paused session');
                if (n.id === 'sup-locks') return plural(supLocks().length, 'lock');
                if (n.id === 'sup-arts') return plural(supArtifacts().length, 'work folder');
                if (n.id === 'sup-maint') { const m = maintData(); return m && m.running ? 'Running' : (m && m.last ? (MAINT_STATE[m.last.state] || [''])[0] : ''); }
                if (n.id === 'aw-uns') return plural(unsupervised().length, 'session');
                if (n.id === 'co-builds') return plural((S.coord.builds || []).filter((b) => b.state === 'open' || b.state === 'running').length, 'gate') + ' open';
                if (n.id === 'co-devices') return `${plural((S.coord.devices && S.coord.devices.holding) || 0, 'device')} in use, ${devWaiting()} waiting`;
                if (n.id === 'co-locks') return S.locks ? plural(S.locks.list.length, 'lock') : '';
                if (n.id === 'co-work') return S.sup.busy || (S.sup.counts ? `${S.sup.counts.active} running, ${S.sup.counts.queued} queued` : plural(supWork().filter((w) => WORK_OPEN.has(w.state)).length, 'open request'));
                if (n.id === 'sup-reviews') return plural(supReviews().filter((r) => !r.dismissed).length, 'review');
                if (n.id === 'usage') { const u = usgUi(); return u.data && u.data.rows ? `${plural(u.data.rows.filter((r) => r.kind === 'session').length, 'session')}, ${u.days === 1 ? 'last 24 h' : 'last 7 days'}` : ''; }
                if (n.id === 'usage-flags') return plural(usgOpenFlags(), 'open flag');
                if (n.id === 'sup-asks') return plural(supAsks().length, 'restart wait');
                if (n.id === 'co-supervisor') return S.sup.busy || (S.sup.data && S.sup.data.stats ? `${plural(S.sup.data.stats.reviewed || 0, 'review')}, ${S.sup.data.stats.gaps || 0} with gaps` : '');
                if (nodeSid(n.id)) { const sid = nodeSid(n.id); const ch = S.chats.get(sid); const l = liveOf(sid); const il = ch && ch.ins ? insLine(ch.ins, !!(l && l.status === 'busy')) : ''; return ch ? [il || plural(ch.messages.length, 'message'), tasksStatus(ch)].filter(Boolean).join(' \u00b7 ') : ''; }
                return [`Remote Control: ${RC_TEXT[(S.rc && S.rc.state) || 'unknown'] || 'Unknown'}`, loginText()].filter(Boolean).join(', ');
            },
            onSelectRow: (key, n) => { if (key && key.startsWith('w:')) workDetailPaint(S.c, key.slice(2)); else if (key && (key.startsWith('mc:') || key.startsWith('mh:'))) maintSelect(key); else if (key && key.startsWith('ux:')) usgSelect(key.slice(3)); else if (n && SUP_PART[n.id]) supSelect(key); else if (n && nodeSid(n.id)) detailSelect(key, nodeSid(n.id)); },
            onSelect: undefined,
            onOpen: () => {},
            onClose: () => {
                const app0 = S.app;
                S.c = null;
                Array.from(S.wins).forEach((w) => w.close());
                void unwatch();
                // chats are read fresh when the window opens again (the module outlives the window)
                S.chats.clear();
                bgStop();
                void usageWatch(false);
                void memWatch(false);
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
        // every row in Fleet is one line (Yukimi, Nov 24 2026): a cell cut short by its ellipsis shows its whole text
        // as a tooltip when hovered (set once, only when it is really cut)
        if (c.modal) c.modal.addEventListener('mouseover', (ev) => {
            const cell = ev.target && ev.target.closest && ev.target.closest('td, .mmc-row > span, .cd-task-text, .cd-tile span, .cd-tile small');
            if (cell && !cell.title && cell.scrollWidth > cell.clientWidth + 1) cell.title = cell.textContent.trim();
        }, { passive: true });
        S.show = Object.assign({}, SHOW_DEFAULT, c.reg('ShowView', {}) || {});
        // the open chat follows the selection: leaving it stops its pushes
        // a session's node opening in Active Work reads its background agents
        const toggle = c.toggle.bind(c);
        c.toggle = (id) => {
            toggle(id);
            const m = /^aw:s:(.+)$/.exec(id || '');
            if (m && c.open.has(id)) void loadAwAgents(m[1]);
        };
        const select = c.select.bind(c);
        c.select = (id, record) => {
            if (S.watching && id !== `t:${S.watching}` && nodeSid(id) !== S.watching) void unwatch();
            select(id, record);
            void usageWatch(usageWanted(id));
            void memWatch(MEM_NODES.has(id));
            if (id && nodeSid(id) && S.chats.has(nodeSid(id))) void watch(nodeSid(id));
            bgSelected(id);
        };
        if (programFaults()) programFaults().registerProgram(c.modal.id, { name: TITLE, terminate: () => app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: ID }) });
        app.onExit(() => {
            if (programFaults()) programFaults().unregisterProgram(`mmcConsole_${ID}`);
            clearTimeout(S.relist);
            running = null;
            if (S.c && !S.exiting) { S.exiting = true; S.c.close(); }
        });
        await subscribe(true);
        void bgFeed(true);
        void usageWatch(usageWanted(c.node));
        void memWatch(MEM_NODES.has(c.node));
        void loadSessions(false);
        void loadFleet();
        void loadContractors();
    }
    const programFaults = () => (root.programFaults && root.programFaults.registerProgram ? root.programFaults : null);

    root.melatonClaudeDesk = { start, _state: () => S };
    if (typeof melatonApps !== 'undefined') melatonApps.define(ID, start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
