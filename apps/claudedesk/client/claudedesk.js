/**
 * Fleet (desktop; was Claude Accounts until Nov 24): an MMC 3.0 console (mmcConsole.js, the shell Server Manager and the other
 * snap-ins share) over the host's Claude accounts, its Remote Control, every Claude session on the host and
 * the agents' coordination. The phone has the same accounts and host in Melaton Mobile's Claude Accounts
 * (wmClaudeAccounts.js, also named Fleet); both use one backend.
 *
 *   Fleet (Local)               summary: every account's plan usage as progress bars (claude_usage feed,
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
 *       Build Gates / Busy Locks      builds waiting on every agent's ready, the repo's .agent-* locks
 *       Supervisor              reviews of finished agent turns against what was asked (claude_desk_supervisor):
 *                               settings, the reviews, Send to Session / Re-check / Dismiss
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
    const TITLE = 'Fleet';
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
            usage: new Map(), // claude_usage rows by account id
            usageOn: false,
            usageLoaded: false,
            usageError: '',
            sup: { loaded: false, data: null, draft: null, sel: '', busy: '', error: '', unavailable: false, lastReviewId: null },
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
        // the supervisor reviewed something: its list is read again once, only when the last review changed
        if (changed.supervisor && typeof changed.supervisor === 'object') {
            const sp = changed.supervisor;
            const ver = sp.version != null ? sp.version : (sp.lastReviewId == null ? null : sp.lastReviewId);
            S.sup.counts = { active: sp.workActive || 0, queued: sp.workQueued || 0 };
            // version moves on every review, work item and lock change: the status is read again once per change
            if (ver !== S.sup.version) {
                const shown = S.c && (S.c.node === 'co-work' || S.c.node === 'co-supervisor');
                if (S.sup.loaded && shown && !S.sup.loading) void loadSupervisor();
                else S.sup.stale = true;
                S.sup.version = ver;
            }
            S.sup.lastReviewId = sp.lastReviewId == null ? null : sp.lastReviewId;
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
        c.on('claude_usage_status', (msg) => {
            if (!S.usageOn) return;
            const d = msg && msg.changed ? msg : (msg && msg.data) || {};
            usageApply(d.changed, d.removed, false);
            if (S.c && usageWanted(S.c.node)) repaint();
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
            if (S.usageOn) { S.usageOn = false; void usageWatch(true); }
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

    // ---- a session's details: background agents and tasks (claude_desk_session detail / agent_page / task_output) ----

    /** A reply's payload: the fields sit at the top of the reply, or under result. */
    const unwrap = (r, key) => (r && r[key] !== undefined ? r : (r && r.result && typeof r.result === 'object' ? r.result : r) || {});
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
        } catch (e) { if (isGone(e)) dt.gone = true; else dt.error = errText(e); }
        dt.loading = false;
        if (S.c && S.c.node === `t:${id}`) S.c.render();
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
            const r = unwrap(await send('claude_desk_session', earlier ? { action: 'agent_page', id, agentId, before: pg.start, limit: 80 } : { action: 'agent_page', id, agentId, limit: 80 }), 'messages');
            pg.messages = earlier ? (r.messages || []).concat(pg.messages) : (r.messages || []);
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
    function resetText(l, now) {
        if (!l.resetsAt) return '';
        if (l.resetsAt <= now) return 'Reset since the last reading';
        return `Resets ${new Date(l.resetsAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
    }
    const isPreferred = (idx) => { const f = fleetOf(idx); return !!(f && f.settings && f.settings.preferred); };

    /**
     * Vista's information bar for an account that nears a limit or is no longer free to schedule work
     * (fleet row availability: state near | capped | exhausted): the warning icon while it can still take work,
     * the error icon once it cannot.
     */
    function availBar(f, withName) {
        const av = f && f.availability;
        if (!av) return '';
        const bad = av.state === 'near' || av.state === 'capped' || av.state === 'exhausted' || av.schedulable === false;
        if (!bad) return '';
        const icon = av.state === 'near' && av.schedulable !== false ? 'warning' : 'error';
        const fallback = av.state === 'near' ? 'is close to a usage limit.' : (av.state === 'exhausted' ? 'has used up its plan usage.' : 'has reached a usage limit.');
        const msg = av.message ? String(av.message) : `${f.name} ${fallback}`;
        const at = av.resetsAt ? new Date(av.resetsAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
        // the server's sentence may already end on "until it resets": the time then completes it
        const base = msg.replace(/[\s.]+$/, '');
        const text = !at ? `${base}.` : (/\bresets?$/i.test(base) ? `${base} ${at}.` : `${base}. Resets ${at}.`);
        return `<div class="cd-infobar is-${icon}" role="alert"><img src="${VI}/${icon}-16.png" alt=""><span>${withName && !msg.includes(f.name) ? `<b>${esc(f.name)}</b>: ` : ''}${esc(text)}</span></div>`;
    }

    function usageBlock(a, now) {
        const planText = a.plan ? String(a.plan).replace(/^\w/, (ch) => ch.toUpperCase()) : '';
        const who = [a.engine ? 'Director' : '', a.onHost ? 'Remote Control' : ''].filter(Boolean).join(', ');
        const limits = (Array.isArray(a.limits) ? a.limits : []).filter((l) => l && l.percent != null).sort((x, y) => usageRank(x) - usageRank(y));
        let body;
        if (limits.length) {
            body = limits.map((l) => {
                const lv = levelOf(l);
                const pct = Math.max(0, Math.min(100, Math.round(l.percent)));
                const stale = l.resetsAt && l.resetsAt <= now;
                return `<div class="cd-usage-row"><span class="cd-usage-label">${esc(l.label || l.short || l.kind)}</span>`
                    + `<div class="mmc-progress"><div role="progressbar"${lv ? ` class="${lv}"` : ''} aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stale ? 0 : pct}"><div class="cd-fill" data-w="${stale ? 0 : pct}"></div></div><span>${stale ? '' : `${pct}%`}</span></div>`
                    + `<span class="cd-usage-reset mmc-hint">${esc(resetText(l, now))}</span></div>`;
            }).join('');
        } else {
            body = `<p class="mmc-hint">${esc(a.needsLogin ? (a.error || 'Link a claude.ai login to see its usage.') : `Usage unavailable${a.error ? `: ${a.error}` : ''}`)}</p>`;
        }
        const x = a.extra;
        const extra = x && x.enabled ? `<p class="mmc-hint">Extra usage is on${x.limitReached ? ' (limit reached)' : ''}.</p>` : '';
        const err = limits.length && a.error ? `<p class="mmc-hint">${esc(a.error)}</p>` : '';
        return `<div class="cd-usage-acct"><div class="cd-usage-head"><img src="${esc(S.app.url('assets').replace(/\/$/, ''))}/account-16.png" alt=""><b>${esc(a.name)}</b>`
            + `<span class="mmc-hint">${esc([planText, who, isPreferred(a.index) ? 'Preferred' : ''].filter(Boolean).join(' - '))}</span></div>${availBar(fleetOf(a.index), false)}${body}${extra}${err}</div>`;
    }
    function usageHtml() {
        const rows = [...S.usage.values()].sort((a, b) => (a.index || 0) - (b.index || 0));
        if (!rows.length) return `<p class="${S.usageError ? 'cd-err' : 'mmc-hint'}">${esc(S.usageError || (S.usageLoaded ? 'There are no Claude accounts.' : 'Reading the plan usage of every account...'))}</p>`;
        const now = Date.now();
        return rows.map((a) => usageBlock(a, now)).join('');
    }

    // ---- the supervisor (claude_desk_supervisor) -----------------------------------------------------------

    const SUP_DEFAULT = { enabled: false, engine: 'tokenrouter', model: '', delivery: 'inbox', manageLocks: false, trackArtifacts: false, maxConcurrent: 3, autoStart: true };
    const SUP_FALLBACK_ENGINES = [{ id: 'tokenrouter', name: 'TokenRouter', defaultModel: 'deepseek/deepseek-v4.1-flash' }];
    const DELIVERY = [['inbox', 'Inbox only'], ['steer', 'Type into the session'], ['off', 'Off']];
    const VERDICT = { ok: ['Complete', `${VI}/check-16.png`], gaps: ['Gaps found', `${VI}/warning-16.png`], unclear: ['Unclear', `${VI}/info-16.png`], error: ['Review failed', `${VI}/error-16.png`] };
    const TRIGGER = { 'turn-end': 'Turn ended', mcp: 'Asked by the agent', recheck: 'Re-checked' };
    const supEngines = () => (S.sup.data && S.sup.data.engines && S.sup.data.engines.length ? S.sup.data.engines : SUP_FALLBACK_ENGINES);
    const supSettings = () => S.sup.draft || Object.assign({}, SUP_DEFAULT, (S.sup.data && S.sup.data.settings) || {});
    const supReviews = () => (S.sup.data && Array.isArray(S.sup.data.reviews) ? S.sup.data.reviews : []);
    const supReview = (id) => supReviews().find((r) => String(r.id) === String(id)) || null;
    const supEngine = (id) => supEngines().find((e) => e.id === id) || null;
    const SUP_GONE = /unknown message type/i;
    const supWork = () => (S.sup.data && Array.isArray(S.sup.data.work) ? S.sup.data.work : []);
    const workOf = (id) => supWork().find((w) => String(w.id) === String(id)) || null;
    const WORK_STATE = { queued: 'Queued', starting: 'Starting', running: 'Running', waiting: 'Waiting', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
    const WORK_SOURCE = { fleet: 'Fleet', plaud: 'Plaud', director: 'Director', agent: 'Agent' };
    const WORK_OPEN = new Set(['queued', 'starting', 'running', 'waiting']);
    const workIcon = (st) => ({ queued: `${VI}/info-16.png`, failed: `${VI}/error-16.png`, cancelled: `${VI}/warning-16.png`, done: `${VI}/check-16.png` }[st] || `${S.app.url('assets').replace(/\/$/, '')}/session-16.png`);
    const supLocks = () => (S.sup.data && Array.isArray(S.sup.data.locks) ? S.sup.data.locks : []);
    const supArtifacts = () => (S.sup.data && Array.isArray(S.sup.data.artifacts) ? S.sup.data.artifacts : []);
    const LOCK_STATE = { live: 'Live', idle: 'Idle', orphan: 'Orphan' };
    const PLANTED = { agent: 'Agent', supervisor: 'Supervisor', unknown: 'Unknown' };
    const ART_KIND = { dir: 'Folder', file: 'File', worktree: 'Worktree' };
    const ART_STATE = { live: 'In use', orphan: 'Orphan', gone: 'Gone' };

    function supTake(r) {
        if (r && r.settings) { S.sup.data = Object.assign({}, S.sup.data || {}, r); S.sup.draft = null; S.sup.loaded = true; S.sup.unavailable = false; S.sup.error = ''; S.sup.stale = false; }
    }
    function supFail(e) {
        if (SUP_GONE.test(errText(e))) { S.sup.unavailable = true; S.sup.error = ''; } else S.sup.error = errText(e);
    }
    async function loadSupervisor() {
        try { supTake(await send('claude_desk_supervisor', { action: 'status' })); S.sup.loaded = true; } catch (e) { S.sup.loaded = true; supFail(e); }
        repaint();
    }
    /** One supervisor action; busy = the status line while it runs (a re-check takes up to a minute). */
    async function supAct(c, payload, busy) {
        S.sup.busy = busy || 'Working...';
        c.note(S.sup.busy);
        repaint();
        try {
            const r = await send('claude_desk_supervisor', payload);
            if (r.settings) supTake(r);
            else if (r.review) {
                const list = supReviews().slice();
                const i = list.findIndex((x) => String(x.id) === String(r.review.id));
                if (i >= 0) list[i] = r.review; else list.unshift(r.review);
                S.sup.data = Object.assign({}, S.sup.data || {}, { reviews: list });
                S.sup.sel = String(r.review.id);
            }
            S.sup.error = '';
        } catch (e) { supFail(e); if (S.sup.error) await failBox(c, e); }
        S.sup.busy = '';
        c.note('');
        repaint();
    }

    function supDetailHtml() {
        const r = supReview(S.sup.sel);
        if (!r) return '<p class="mmc-hint">Select a review to see what was asked, what was missed and the steering.</p>';
        const missed = Array.isArray(r.missed) ? r.missed : [];
        const steering = Array.isArray(r.steering) ? r.steering : [];
        const live = !!liveOf(r.sessionId);
        const busy = !!S.sup.busy;
        const sendable = r.verdict === 'gaps' && !r.delivered && (missed.length || steering.length);
        const bits = [
            `<p><b>${esc(r.title || shortId(r.sessionId))}</b> <span class="mmc-hint">${esc([r.account, TRIGGER[r.trigger] || r.trigger, when(r.at)].filter(Boolean).join(' - '))}</span></p>`,
            r.summary ? `<p class="cd-read">${esc(r.summary)}</p>` : '',
            r.request ? `<p><b>What was asked</b></p><p class="cd-read">${esc(r.request)}</p>` : '',
            missed.length ? `<p><b>Missed</b></p><table class="cd-table"><thead><tr><th>Item</th><th>Evidence</th></tr></thead><tbody>${missed.map((m) => `<tr><td>${esc(m.item)}</td><td>${esc(m.evidence || '')}</td></tr>`).join('')}</tbody></table>` : '',
            steering.length ? `<p><b>Steering</b></p><ul class="cd-sup-steer">${steering.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '',
            r.delivered ? `<p class="mmc-hint">${r.delivered === 'steer' ? 'Typed into the session.' : 'Left in the inbox.'}</p>` : '',
            r.dismissed ? '<p class="mmc-hint">Dismissed.</p>' : '',
            `<p class="cd-sup-actions"><button type="button" class="btn-standard primary" data-act="sup-send" data-arg="${esc(r.id)}"${sendable && live && !busy ? '' : ' disabled'}>Send to Session</button> `
                + `<button type="button" class="btn-standard" data-act="sup-recheck" data-arg="${esc(r.sessionId)}"${busy ? ' disabled' : ''}>Re-check</button> `
                + `<button type="button" class="btn-standard" data-act="sup-dismiss" data-arg="${esc(r.id)}"${r.dismissed || busy ? ' disabled' : ''}>Dismiss</button></p>`
        ];
        return bits.join('');
    }

    function supervisorPage(c) {
        const sup = S.sup;
        if (!sup.loaded) { void loadSupervisor(); return c.page('Supervisor', '', [{ id: 'cd-sup-wait', title: 'Supervisor', body: '<p class="mmc-hint">Reading the supervisor...</p>' }]); }
        if (sup.stale && !sup.loading) { sup.stale = false; void loadSupervisor(); }
        if (sup.unavailable) return c.page('Supervisor', '', [{ id: 'cd-sup-gone', title: 'Supervisor', body: '<p>Supervisor is not available on this server yet.</p>' }]);
        const st = supSettings();
        const engines = supEngines();
        const eng = supEngine(st.engine);
        const engineOpts = (eng ? engines : engines.concat([{ id: st.engine, name: st.engine }])).map((e) => `<option value="${esc(e.id)}"${e.id === st.engine ? ' selected' : ''}>${esc(e.name || e.id)}</option>`).join('');
        const placeholder = (eng && eng.defaultModel) || (st.engine === 'tokenrouter' ? 'deepseek/deepseek-v4.1-flash' : '');
        const stats = (sup.data && sup.data.stats) || {};
        const form = `<div class="cd-sup-form">
            <label class="cd-check"><input type="checkbox" data-sup="enabled"${st.enabled ? ' checked' : ''}><span>Enabled: review each agent turn against what was asked</span></label>
            <label><span>Engine:</span><select class="vdt-select" data-sup="engine">${engineOpts}</select></label>
            <label><span>Model:</span><input type="text" data-sup="model" value="${esc(st.model || '')}" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off"></label>
            <label><span>Delivery:</span><select class="vdt-select" data-sup="delivery">${DELIVERY.map(([v, t]) => `<option value="${v}"${v === st.delivery ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label><span>Max concurrent sessions:</span><input type="text" data-sup="maxConcurrent" value="${esc(st.maxConcurrent == null ? 3 : st.maxConcurrent)}" inputmode="numeric" autocomplete="off"></label>
            <label class="cd-check"><input type="checkbox" data-sup="autoStart"${st.autoStart === false ? '' : ' checked'}><span>Start queued work automatically</span></label>
            <label class="cd-check"><input type="checkbox" data-sup="manageLocks"${st.manageLocks ? ' checked' : ''}><span>Manage busy locks for agents</span></label>
            <label class="cd-check"><input type="checkbox" data-sup="trackArtifacts"${st.trackArtifacts ? ' checked' : ''}><span>Track work folders and temp files</span></label>
            <p class="cd-sup-actions"><button type="button" class="btn-standard primary" data-act="sup-save"${sup.busy ? ' disabled' : ''}>Save</button>${sup.draft ? ' <span class="mmc-hint">Not saved yet.</span>' : ''}</p>
        </div>`;
        const reviews = supReviews().filter((r) => !r.dismissed);
        const rows = reviews.map((r) => {
            const v = VERDICT[r.verdict] || [r.verdict || '', `${VI}/info-16.png`];
            return { key: `v:${r.id}`, icon: v[1], data: { title: r.title || shortId(r.sessionId), account: r.account || '', verdict: v[0], summary: r.summary || '', at: r.at || 0 } };
        });
        const list = c.listView([
            { t: 'Session', w: 140, key: 'title', text: (d) => d.title },
            { t: 'Account', w: 70, key: 'account', text: (d) => d.account },
            { t: 'Verdict', w: 80, key: 'verdict', text: (d) => d.verdict },
            { t: 'Summary', w: 250, key: 'summary', text: (d) => d.summary },
            { t: 'When', w: 128, key: 'at', text: (d) => when(d.at), value: (d) => d.at }
        ], rows, { sortId: 'cd-sup', sort: { key: 'at', dir: -1 }, empty: sup.data && sup.data.settings && sup.data.settings.enabled ? 'No review yet. Each agent turn that ends is reviewed.' : 'The supervisor is off. Turn it on above to review finished agent turns.' });
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
        const artRows = arts.map((a) => ({ key: `ar:${a.id}`, icon: a.kind === 'file' ? `${VI}/explorer/file-16.png` : FOLDER16, cls: a.state === 'orphan' ? 'cd-stale' : '', data: { path: a.path, kind: ART_KIND[a.kind] || a.kind || '', who: a.agentName || shortId(a.sessionId), size: a.sizeBytes, age: a.ageHours, state: ART_STATE[a.state] || a.state || '' } }));
        const artList = c.listView([
            { t: 'Path', w: 230, key: 'path', text: (d) => d.path },
            { t: 'Kind', w: 70, key: 'kind', text: (d) => d.kind },
            { t: 'Session', w: 110, key: 'who', text: (d) => d.who },
            { t: 'Size', w: 64, key: 'size', num: true, text: (d) => bytesText(d.size), value: (d) => d.size || 0 },
            { t: 'Age', w: 60, key: 'age', num: true, text: (d) => (d.age == null ? '' : ageText(Math.round(d.age * 60))), value: (d) => d.age || 0 },
            { t: 'State', w: 64, key: 'state', text: (d) => d.state }
        ], artRows, { sortId: 'cd-sup-arts', sort: { key: 'age', dir: -1 }, empty: st.trackArtifacts ? 'No work folder or temp file is tracked.' : 'Tracking is off. Tick "Track work folders and temp files" above.' });
        const total = stats.artifactBytes != null ? stats.artifactBytes : arts.reduce((n, a) => n + (a.sizeBytes || 0), 0);
        const side = sup.busy || sup.error || `${stats.reviewed || 0} reviewed, ${stats.gaps || 0} with gaps${stats.lastAt ? `, last ${when(stats.lastAt)}` : ''}`;
        const html = c.page('Supervisor', side, [
            { id: 'cd-sup-set', title: 'Settings', body: form },
            { id: 'cd-sup-list', title: `Reviews (${reviews.length})`, body: `<div class="cd-sup-list">${list}</div>` },
            { id: 'cd-sup-detail', title: 'Selected Review', body: `<div class="cd-sup-detail">${supDetailHtml()}</div>` },
            { id: 'cd-sup-locks', title: `Locks (${locks.length})`, body: `<div class="cd-sup-list">${lockList}</div><p class="cd-sup-actions"><button type="button" class="btn-standard" data-act="sup-lock-remove"${sup.busy ? ' disabled' : ''}>Remove</button> <span class="mmc-hint">Removes the selected lock when its agent is gone (an orphan).</span></p>` },
            { id: 'cd-sup-arts', title: `Work folders and temp files (${arts.length})`, body: `<div class="cd-sup-list">${artList}</div><p class="mmc-hint">${arts.length ? `${esc(bytesText(total))} in all.` : ''}</p><p class="cd-sup-actions"><button type="button" class="btn-standard" data-act="sup-art-clean"${sup.busy ? ' disabled' : ''}>Clean</button> <button type="button" class="btn-standard" data-act="sup-art-forget"${sup.busy ? ' disabled' : ''}>Forget</button> <span class="mmc-hint">Clean deletes it from disk; Forget only stops tracking it.</span></p>` }
        ]);
        return {
            html,
            mount: (pane) => {
                const read = (ev) => {
                    const el = ev.target.closest('[data-sup]');
                    if (!el) return;
                    const d = S.sup.draft || Object.assign({}, SUP_DEFAULT, (S.sup.data && S.sup.data.settings) || {});
                    d[el.dataset.sup] = el.type === 'checkbox' ? el.checked : el.value;
                    S.sup.draft = d;
                    if (el.dataset.sup === 'engine') {
                        const e = supEngine(el.value);
                        const m = pane.querySelector('[data-sup="model"]');
                        if (m) m.placeholder = (e && e.defaultModel) || '';
                    }
                    const note = pane.querySelector('.cd-sup-form .cd-sup-actions');
                    if (note && !note.querySelector('.mmc-hint')) note.insertAdjacentHTML('beforeend', ' <span class="mmc-hint">Not saved yet.</span>');
                };
                pane.addEventListener('input', read);
                pane.addEventListener('change', read);
            }
        };
    }
    function workPage(c) {
        if (!S.sup.loaded) { void loadSupervisor(); return c.page('Work Queue', '', [{ id: 'cd-wq-wait', title: 'Work Queue', body: '<p class="mmc-hint">Reading the work queue...</p>' }]); }
        if (S.sup.stale) { S.sup.stale = false; void loadSupervisor(); }
        if (S.sup.unavailable) return c.page('Work Queue', '', [{ id: 'cd-wq-gone', title: 'Work Queue', body: `<p>${NOT_YET}</p>` }]);
        const rows = supWork().map((w) => ({
            key: `w:${w.id}`,
            icon: workIcon(w.state),
            cls: w.state === 'running' || w.state === 'starting' ? 'cd-live' : (w.state === 'failed' ? 'cd-stale' : ''),
            data: { title: w.title || String(w.id), state: WORK_STATE[w.state] || w.state || '', source: WORK_SOURCE[w.source] || w.source || '', account: w.account && w.account.name ? w.account.name : (w.account == null ? '' : String(w.account)), model: [w.model, w.effort].filter(Boolean).join(' / '), session: w.sessionId ? shortId(w.sessionId) : '', at: w.createdAt || 0, message: w.message || '' }
        }));
        const lv = c.listView([
            { t: 'Request', w: 230, key: 'title', text: (d) => d.title },
            { t: 'State', w: 76, key: 'state', text: (d) => d.state },
            { t: 'From', w: 66, key: 'source', text: (d) => d.source },
            { t: 'Account', w: 90, key: 'account', text: (d) => d.account },
            { t: 'Model / Effort', w: 100, key: 'model', text: (d) => d.model },
            { t: 'Session', w: 70, key: 'session', text: (d) => d.session },
            { t: 'Queued', w: 128, key: 'at', text: (d) => when(d.at), value: (d) => Number(d.at) || Date.parse(d.at) || 0 },
            { t: 'Note', w: 220, key: 'message', text: (d) => d.message }
        ], rows, { sortId: 'cd-work', sort: { key: 'at', dir: -1 }, empty: 'The queue is empty. A request from New Session..., Plaud or an agent waits here until an account has room.', fit: true });
        return { html: lv, list: true };
    }

    /** The selected review's detail again, without drawing the page (the settings keep what is typed). */
    function supSelect(key) {
        if (!key || !key.startsWith('v:')) return;
        S.sup.sel = key.slice(2);
        const box = S.c && S.c.modal.querySelector('.cd-sup-detail');
        if (box) box.innerHTML = supDetailHtml();
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
                    icon: `${ITEMS}/people-near-me-16.png`,
                    desc: 'The agents working now, their claims and messages',
                    children: [
                        { id: 'co-agents', name: 'Agents', icon: `${ITEMS}/user-accounts-16.png` },
                        { id: 'co-claims', name: 'Claims', icon: FOLDER16 },
                        { id: 'co-messages', name: 'Messages', icon: '/static_images/vista-cmdbar/mail.png' },
                        { id: 'co-builds', name: 'Build Gates', icon: `${ITEMS}/administrative-tools-16.png`, desc: 'Builds waiting until every agent is ready' },
                        { id: 'co-locks', name: 'Busy Locks', icon: `${ITEMS}/bitlocker-drive-encryption-16.png`, desc: 'The .agent-* busy locks in the repo' },
                        { id: 'co-supervisor', name: 'Supervisor', icon: `${ITEMS}/parental-controls-16.png`, desc: 'Reviews of finished agent turns against what was asked', children: [{ id: 'co-work', name: 'Work Queue', icon: `${A}/session-16.png`, desc: 'Requests waiting for, starting on and running on an account' }] }
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
            'Fleet manages the Claude accounts of this host, its Remote Control, the Claude sessions running on it and the agents coordinating on it.',
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
        return c.page(`${TITLE} (Local)`, S.error ? `Error: ${S.error}` : '', [{ id: 'cd-sum-overview', title: 'Overview', body: overview }, { id: 'cd-sum-usage', title: 'Plan Usage', body: `<div class="cd-usage">${usageHtml()}</div>` }].concat(sections));
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
            const status = [a.active ? 'Engine' : '', a.onHost ? 'On host' : '', isPreferred(a.index) ? 'Preferred' : ''].filter(Boolean).join(', ') || (a.remoteLogin ? 'Ready' : 'No login linked');
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
                name: f.settings && f.settings.preferred ? `${f.name} (Preferred)` : f.name,
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
        if (chat.view === 'detail') return { html: detailPage(c, id, chat), split: false };
        const row = chat.row || rowOf(id) || { id };
        const l = liveOf(id);
        const acct = row.account ? row.account.name : '';
        const side = [stateText(row), acct, row.folder].filter(Boolean).join(' - ');
        const linkBits = `<span class="mmc-link" data-act="detail-toggle">Details</span>${l && serverOrigin(id) ? ' <span class="mmc-link" data-act="takeover">Take Over in Fleet</span>' : ''}${l && l.link ? ` <span class="mmc-link" data-act="open-link" data-arg="${esc(l.link)}">Open in claude.ai</span> <span class="mmc-link" data-act="copy-link" data-arg="${esc(l.link)}">Copy link</span>` : ''}`;
        const top = chat.more ? `<div class="cd-earlier"><button type="button" class="btn-standard" data-act="earlier" data-arg="${esc(id)}"${chat.loading ? ' disabled' : ''}>Show Earlier Messages</button></div>` : '';
        const body = chat.error ? `<p class="cd-err">${esc(chat.error)}</p>` : (chat.messages.length ? logHtml(chat) : `<p class="mmc-hint">${chat.loading ? 'Reading the conversation...' : 'No messages yet.'}</p>`);
        let composer;
        if (l && serverOrigin(id)) {
            composer = `<div class="cd-compose cd-ended"><span>This session runs inside Remote Control's server, so Fleet has no terminal to type into.</span><button type="button" class="btn-standard primary" data-act="takeover" data-arg="${esc(id)}">Take Over in Fleet...</button></div>`;
        } else if (l) {
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
        const m = S.c && S.c.node === `t:${id}` ? S.c.modal : null;
        if (!m || !chat) return;
        const a = m.querySelector('.cd-agent-box');
        const t = m.querySelector('.cd-task-box');
        if (a) a.innerHTML = agentBoxHtml(chat);
        if (t) t.innerHTML = taskBoxHtml(chat);
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
        const agentRows = agents.map((x) => ({ key: `ag:${x.agentId}`, icon: `${A}/session-16.png`, cls: x.finished ? '' : 'cd-live', data: { desc: x.description || x.agentId, type: x.type || '', model: x.model || '', state: x.finished ? 'Finished' : 'Running', last: x.lastActivity || 0, messages: x.messages || 0 } }));
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
            { id: 'cd-dt-agents', title: `Background Agents (${agents.length})`, body: `<div class="cd-dt-list">${agentList}</div><div class="cd-dt-box cd-agent-box">${agentBoxHtml(chat)}</div>` },
            { id: 'cd-dt-tasks', title: `Background Tasks (${tasks.length})`, body: `<div class="cd-dt-list">${taskList}</div><div class="cd-dt-box cd-task-box">${taskBoxHtml(chat)}</div>` },
            { id: 'cd-dt-claims', title: `Claims (${claims.length})`, body: table([['Path']], claims.map((p) => `<tr><td>${esc(p)}</td></tr>`), 'It holds no claim.') },
            { id: 'cd-dt-files', title: `Files Edited (${d.edited ? d.edited.total || edited.length : 0})`, body: table([['File'], ['Via', 76], ['Edits', 46], ['Uncommitted', 84]], edited.map((f) => `<tr><td>${esc(f.path)}</td><td>${f.via === 'shell' ? 'Shell' : esc(f.via || '')}</td><td class="is-num">${f.edits == null ? '' : f.edits}</td><td>${f.uncommitted == null ? '' : (f.uncommitted ? 'Yes' : 'No')}</td></tr>`), 'It has edited no file.') },
            { id: 'cd-dt-reviews', title: `Supervisor Reviews (${reviews.length})`, body: table([['Verdict', 100], ['Summary'], ['When', 130]], reviews.map((r) => `<tr><td>${esc((VERDICT[r.verdict] || [r.verdict || ''])[0])}</td><td>${esc(r.summary || '')}</td><td>${esc(when(r.at))}</td></tr>`), 'The supervisor has not reviewed this session.') }
        ]);
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
    }
    function withBars(html) {
        return { html, mount: (pane) => paintBars(pane) };
    }

    function page(n, c) {
        switch (n.id) {
            case 'root': return withBars(rootPage(c));
            case 'accounts': return accountsPage(c);
            case 'rc': return rcPage(c);
            case 'rc-host': return hostRcPage(c);
            case 'co-builds': return buildsPage(c);
            case 'co-locks': return locksPage(c);
            case 'co-supervisor': return supervisorPage(c);
            case 'co-work': return workPage(c);
            case 'sessions': return sessionsPage(c, false);
            case 'running': return sessionsPage(c, true);
            case 'co-root': return withBars(rootPage(c));
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
            case 'co-work': return [{ text: 'New Request...', action: 'new-session' }, { text: 'Read Again', action: 'sup-refresh' }];
            case 'co-supervisor': return [{ text: 'Read Again', action: 'sup-refresh' }, { text: 'Save Settings', action: 'sup-save', disabled: !S.sup.draft }, { separator: true }, { text: 'Remove Lock...', action: 'sup-lock-remove' }, { text: 'Clean...', action: 'sup-art-clean' }, { text: 'Forget', action: 'sup-art-forget' }];
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
        const server = !!l && serverOrigin(id);
        const typed = server
            ? [{ text: 'Take Over in Fleet...', action: 'takeover' }]
            : [
                { text: 'Send Message...', action: 'message', disabled: !l },
                { text: 'Stop Current Turn', action: 'interrupt', disabled: !(l && l.status === 'busy') },
                { text: 'Compact', action: 'compact', disabled: !l },
                { text: 'Set Model...', action: 'set-model', disabled: !l },
                { text: 'Set Effort...', action: 'set-effort', disabled: !l },
                { text: 'Show Screen', action: 'screen', disabled: !l }
            ];
        return [{ text: 'Open', action: 'open-session' }].concat(typed, [
            { separator: true },
            { text: chatOf(id) && chatOf(id).view === 'detail' ? 'Conversation' : 'Details', action: 'detail-toggle' },
            { separator: true },
            { text: 'Resume in Remote Control...', action: 'resume', disabled: !!l },
            { text: 'Open in claude.ai', action: 'open-link', disabled: !(l && l.link) },
            { text: 'Copy Link', action: 'copy-link', disabled: !(l && l.link) },
            { separator: true },
            { text: 'End Session', action: 'end', disabled: !(l && l.origin === 'rc') }
        ]);
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
        if (key.startsWith('v:')) {
            const r = supReview(key.slice(2));
            if (!r) return null;
            const sendable = r.verdict === 'gaps' && !r.delivered && !!liveOf(r.sessionId);
            return { title: r.title || 'Review', items: [{ text: 'Send to Session', action: 'sup-send', disabled: !sendable || !!S.sup.busy }, { text: 'Re-check', action: 'sup-recheck', disabled: !!S.sup.busy }, { text: 'Dismiss', action: 'sup-dismiss', disabled: !!r.dismissed }, { separator: true }, { text: 'Open Session', action: 'open-session' }] };
        }
        if (key.startsWith('w:')) {
            const w = workOf(key.slice(2));
            if (!w) return null;
            return { title: w.title || 'Request', items: [{ text: 'Start Now', action: 'work-start', disabled: w.state !== 'queued' || !!S.sup.busy }, { text: 'Cancel', action: 'work-cancel', disabled: !WORK_OPEN.has(w.state) || !!S.sup.busy }, { separator: true }, { text: 'Open Session', action: 'work-open', disabled: !w.sessionId }] };
        }
        if (key.startsWith('lk:')) { const l = supLocks().find((x) => `${x.root || ''}|${x.file}` === key.slice(3)); return { title: 'Busy Lock', items: [{ text: 'Remove...', action: 'sup-lock-remove', disabled: !l || l.state !== 'orphan' || !!S.sup.busy }] }; }
        if (key.startsWith('ar:')) { const a = supArtifacts().find((x) => String(x.id) === key.slice(3)); return { title: 'Work Folder', items: [{ text: 'Clean...', action: 'sup-art-clean', disabled: !a || !a.cleanable || !!S.sup.busy }, { text: 'Forget', action: 'sup-art-forget', disabled: !a || !!S.sup.busy }] }; }
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
        const sid = arg && /^[0-9a-f-]{36}$/.test(arg) ? arg : (selId(c, 's:') || (c.node && c.node.startsWith('t:') ? c.node.slice(2) : '') || ((supReview(selId(c, 'v:')) || {}).sessionId || ''));
        switch (a) {
            case 'refresh':
                S.sessionsLoaded = false;
                S.chats.forEach((ch, id) => { if (c.node === `t:${id}`) void loadChat(id, false); });
                if (S.locks) S.locks = null;
                if (S.inspect && c.node === `i:${S.inspect.id}`) void loadInspect(S.inspect.id);
                await Promise.all([refreshAccounts(), loadSessions(false), loadMessages()]);
                return true;
            case 'fleet-refresh': await loadFleet(); return true;
            case 'sup-refresh': await loadSupervisor(); return true;
            case 'work-start': {
                const w = workOf(selId(c, 'w:'));
                if (w) await supAct(c, { action: 'work_start', id: w.id }, 'Starting the request...');
                return true;
            }
            case 'work-cancel': {
                const w = workOf(selId(c, 'w:'));
                if (!w) return true;
                const ok = await c.box(`<p>Cancel <b>${esc(w.title || w.id)}</b>?${w.sessionId ? ' Its session is stopped.' : ' It is taken off the queue.'}</p>`,
                    [{ text: 'Cancel Request', value: true, className: 'btn-standard primary' }, { text: 'Keep', value: false, className: 'btn-standard' }], { icon: 'warning' });
                if (ok === true) await supAct(c, { action: 'work_cancel', id: w.id }, 'Cancelling...');
                return true;
            }
            case 'work-open': {
                const w = workOf(selId(c, 'w:'));
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
                const ok = await c.box(clean ? `<p>Delete <b>${esc(art.path)}</b> from the disk? That frees <b>${esc(bytesText(art.sizeBytes) || '0 B')}</b> and cannot be undone.</p>` : `<p>Forget <b>${esc(art.path)}</b>? It stays on the disk; it is only no longer tracked here.</p>`,
                    [{ text: clean ? 'Clean' : 'Forget', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'warning' });
                if (ok === true) await supAct(c, { action: clean ? 'artifact_clean' : 'artifact_forget', id: art.id }, clean ? 'Cleaning...' : 'Forgetting...');
                return true;
            }
            case 'sup-save': {
                if (!S.sup.draft) return true;
                const d = S.sup.draft;
                await supAct(c, { action: 'save', settings: { enabled: !!d.enabled, engine: d.engine, model: String(d.model || '').trim(), delivery: d.delivery, manageLocks: !!d.manageLocks, trackArtifacts: !!d.trackArtifacts, maxConcurrent: Math.max(1, Math.min(32, Math.round(Number(d.maxConcurrent)) || 3)), autoStart: d.autoStart !== false } }, 'Saving...');
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
            case 'takeover': await takeoverBox(c, c.node && c.node.startsWith('t:') ? c.node.slice(2) : sid); return true;
            case 'detail-toggle': {
                const chat = chatOf(sid);
                if (!chat) return true;
                chat.view = chat.view === 'detail' ? 'chat' : 'detail';
                if (chat.view === 'chat') S.chatScrolled = false;
                c.render();
                return true;
            }
            case 'detail-refresh': await loadDetail(sid); return true;
            case 'agent-earlier': await loadAgentPage(c.node && c.node.startsWith('t:') ? c.node.slice(2) : sid, arg, true); return true;
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
        else if (key.startsWith('a:')) void action('account-props', c);
        else if (key.startsWith('g:')) void action('agent-session', c);
        else if (key.startsWith('m:')) void action('read-message', c);
        else if (key.startsWith('r:')) void action('fleet-props', c);
        else if (key.startsWith('b:')) void action('build-props', c);
        else if (key.startsWith('l:')) void action('lock-inspect', c);
        else if (key.startsWith('w:')) void action('work-open', c);
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
        summary: ['Ready to start', 'Check what will happen, then click Finish.']
    };
    const pathName = (id) => (WIZ_PATHS.find((p) => p[0] === id) || [])[1] || '';
    const acctLabel = (v) => (v === 'auto' ? 'Auto (the preferred account, else the most headroom)' : (accountName(Number(v)) || ''));

    /** Model, effort and permissions follow the account picked, until the person changes them. */
    function wizPrefill(box, val) {
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
        return `<div class="cd-carry cd-recs">${recs.map((r) => `<label class="cd-check"><input type="checkbox" data-cd="rec:${esc(r.id)}"${W.picked && W.picked.has(String(r.id)) ? ' checked' : ''}><span>${esc(r.name || r.id)} <i>${esc([when(r.startAt), dur(r.durationMs)].filter(Boolean).join(', '))}</i></span></label>`).join('')}</div>`;
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
            return `${acct}
                <label><span>Folder:</span><input type="text" data-cd="cwd" value="${esc(W.cwd)}" spellcheck="false" autocomplete="off"></label>
                <label class="cd-top"><span>Request:</span><textarea data-cd="prompt" data-cd-focus rows="5" spellcheck="true" placeholder="What should it do?">${esc(W.prompt)}</textarea></label>
                <label><span>Model:</span><select class="vdt-select" data-cd="model">${modelOptions(W.model || 'sonnet')}</select></label>
                <label><span>Or model ID:</span><input type="text" data-cd="modelId" value="${esc(W.modelId || '')}" spellcheck="false" autocomplete="off" placeholder="A full model ID (optional)"></label>
                <label><span>Effort:</span><select class="vdt-select" data-cd="effort">${effortOptions(W.effort)}</select></label>
                ${direct ? `<label><span>Permissions:</span><select class="vdt-select" data-cd="mode">${modeSelect(W.mode || 'bypassPermissions')}</select></label>` : ''}${err}`;
        }
        if (page === 'plaud') {
            return `<label class="cd-check"><input type="checkbox" data-cd="plaudAll"${W.all ? ' checked' : ''}><span>Every recording not worked yet</span></label>
                <p class="mmc-hint">Or tick the recordings (newest first):</p>${wizRecs(W)}${err}`;
        }
        // summary
        const rows = [['What', pathName(W.path)]];
        if (W.path === 'plaud') {
            rows.push(['Recordings', W.all ? 'Every recording not worked yet' : plural((W.picked || new Set()).size, 'recording')]);
        } else {
            rows.push(['Account', acctLabel(W.account)], ['Folder', W.cwd], ['Model', (MODEL_CHOICES.find((m) => m[0] === modelOf(W)) || [])[1] || modelOf(W) || 'Sonnet'], ['Effort', (EFFORTS.find((e) => e[0] === (W.effort || '')) || [])[1] || 'Default']);
            if (W.path === 'direct') rows.push(['Permissions', (MODES.find((m) => m[0] === W.mode) || [])[1] || W.mode]);
            rows.push(['Checked by supervisor', W.path === 'supervised' ? 'Yes (queued on the Supervisor)' : 'No']);
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
        else if (page === 'plaud') { W.all = !!fields.plaudAll; W.picked = new Set(Object.keys(fields).filter((k) => k.startsWith('rec:') && fields[k] === true).map((k) => k.slice(4))); }
        else if (page === 'supervised' || page === 'direct') {
            W.account = fields.account; W.cwd = String(fields.cwd || '').trim(); W.prompt = String(fields.prompt || '').trim();
            W.model = fields.model; W.modelId = String(fields.modelId || '').trim(); W.effort = fields.effort || '';
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
                    const job = { action: 'enqueue', title: first.trim().slice(0, 80), prompt: W.prompt, cwd: W.cwd, model: modelOf(W) || 'sonnet', effort: W.effort || undefined, startNow: true };
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
                const payload = { action: 'start', cwd: W.cwd, prompt: W.prompt, account: acct, model: modelOf(W) || 'sonnet', effort: W.effort || undefined, supervised: false };
                if (W.path === 'direct') payload.mode = W.mode;
                const r = await send('claude_desk_session', payload);
                const res = r.result || {};
                if (res.state === 'failed') { c.note(''); W.err = `The session did not start. ${res.message || ''}`.trim(); return false; }
                link = res.link || '';
                body = `<p>The session is ${res.state === 'connected' || res.state === 'live' ? 'running in Remote Control' : 'starting'}${res.account ? ` on <b>${esc(res.account.name)}</b>` : ''}.</p>
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

    /** Work items as a small table: request, state, session. */
    function workTable(items, whoOf) {
        return `<table class="cd-table"><thead><tr><th>Request</th>${whoOf ? '<th>Recording</th>' : ''}<th class="cd-w80">State</th><th class="cd-w80">Session</th></tr></thead><tbody>${items.map((x) => `<tr><td>${esc(x.title || x.id)}</td>${whoOf ? `<td>${esc(whoOf(x) || x.recordingId || '')}</td>` : ''}<td>${esc(WORK_STATE[x.state] || x.state || '')}</td><td>${esc(x.sessionId ? shortId(x.sessionId) : '')}</td></tr>`).join('')}</tbody></table>`;
    }

    async function newSessionBox(c, accountIndex) {
        const pinned = Number.isInteger(accountIndex);
        const W = { path: pinned ? 'direct' : 'supervised', account: pinned ? String(accountIndex) : 'auto', cwd: DEFAULT_CWD, prompt: '', mode: 'bypassPermissions', picked: new Set(), err: '' };
        if (!pinned && defaultAccount() == null) W.account = 'auto';
        let page = 'type';
        for (;;) {
            let order = ['type', W.path, 'summary'];
            const r = await wizPage(c, W, page, page === 'type');
            if (r === 'cancel') return;
            order = ['type', W.path, 'summary']; // the first page may have changed the path
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
        let cur = { name: a.name, preferred: !!st.preferred, maxWeekly: st.maxWeeklyPct == null ? '' : st.maxWeeklyPct, maxSession: st.maxSessionPct == null ? '' : st.maxSessionPct,
            model: known ? model : 'sonnet', modelId: known ? '' : model, effort: st.defaultEffort || '', mode: st.defaultMode || 'bypassPermissions' };
        for (;;) {
            const { value, fields } = await form(c, `
                <table class="cd-props">${rows.map(([k, v]) => `<tr><td>${esc(k)}:</td><td>${esc(v)}</td></tr>`).join('')}</table>
                ${f ? '' : `<p class="mmc-hint">The account settings are not available on this server yet.</p>`}
                <label><span>Name:</span><input type="text" data-cd="name" data-cd-focus value="${esc(cur.name)}" spellcheck="false" autocomplete="off"></label>
                <label class="cd-check"><input type="checkbox" data-cd="preferred"${cur.preferred ? ' checked' : ''}><span>Preferred account: new sessions use it first (only one account is preferred)</span></label>
                <label><span>Max weekly usage:</span><input type="text" data-cd="maxWeekly" value="${esc(cur.maxWeekly)}" inputmode="numeric" placeholder="% (blank: no limit)" autocomplete="off"></label>
                <label><span>Max session usage:</span><input type="text" data-cd="maxSession" value="${esc(cur.maxSession)}" inputmode="numeric" placeholder="% (blank: no limit)" autocomplete="off"></label>
                <label><span>Default model:</span><select class="vdt-select" data-cd="model">${modelOptions(cur.model)}</select></label>
                <label><span>Or model ID:</span><input type="text" data-cd="modelId" value="${esc(cur.modelId)}" spellcheck="false" autocomplete="off" placeholder="A full model ID (optional)"></label>
                <label><span>Default effort:</span><select class="vdt-select" data-cd="effort">${effortOptions(cur.effort)}</select></label>
                <label><span>Permissions:</span><select class="vdt-select" data-cd="mode">${modeSelect(cur.mode)}</select></label>
                ${err ? `<p class="cd-err">${esc(err)}</p>` : ''}`,
            [{ text: 'Save', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { title: `${a.name} Properties`, width: 480, icon: 'fas fa-circle-info' });
            if (value !== true) return;
            cur = { name: fields.name, preferred: !!fields.preferred, maxWeekly: fields.maxWeekly, maxSession: fields.maxSession, model: fields.model, modelId: fields.modelId, effort: fields.effort, mode: fields.mode };
            const weekly = pctOf(fields.maxWeekly);
            const session = pctOf(fields.maxSession);
            const name = String(fields.name || '').trim();
            if (weekly.error || session.error) { err = 'A maximum usage is a percentage from 1 to 100, or blank for none.'; continue; }
            if (!name) { err = 'The account needs a name.'; continue; }
            try {
                const r = await send('claude_fleet_account', { action: 'save', index, name, preferred: !!fields.preferred, maxWeeklyPct: weekly.value, maxSessionPct: session.value, defaultModel: modelOf(fields) || 'sonnet', defaultEffort: fields.effort || '', defaultMode: fields.mode });
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
            if (S.c && S.c.node === `t:${id}`) S.c.render();
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

    async function screenBox(c, id) {
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
            about: { version: VERSION, lines: ['Claude accounts, Remote Control, sessions and agent coordination.'] },
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
                if (n.id === 'co-work') return S.sup.busy || (S.sup.counts ? `${S.sup.counts.active} running, ${S.sup.counts.queued} queued` : plural(supWork().filter((w) => WORK_OPEN.has(w.state)).length, 'open request'));
                if (n.id === 'co-supervisor') return S.sup.busy || (S.sup.data && S.sup.data.stats ? `${plural(S.sup.data.stats.reviewed || 0, 'review')}, ${S.sup.data.stats.gaps || 0} with gaps` : '');
                if (n.id.startsWith('t:')) { const ch = S.chats.get(n.id.slice(2)); return ch ? plural(ch.messages.length, 'message') : ''; }
                return `Remote Control: ${RC_TEXT[(S.rc && S.rc.state) || 'unknown'] || 'Unknown'}`;
            },
            onSelectRow: (key, n) => { if (n && n.id === 'co-supervisor') supSelect(key); else if (n && n.id.startsWith('t:')) detailSelect(key, n.id.slice(2)); },
            onSelect: undefined,
            onOpen: () => {},
            onClose: () => {
                const app0 = S.app;
                S.c = null;
                void unwatch();
                void usageWatch(false);
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
            void usageWatch(usageWanted(id));
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
        void usageWatch(usageWanted(c.node));
        void loadSessions(false);
        void loadFleet();
    }
    const programFaults = () => (root.programFaults && root.programFaults.registerProgram ? root.programFaults : null);

    root.melatonClaudeDesk = { start, _state: () => S };
    if (typeof melatonApps !== 'undefined') melatonApps.define(ID, start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
