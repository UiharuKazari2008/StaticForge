/**
 * Melaton Mobile: Fleet (was Claude Accounts; renamed Nov 24; Yukimi, Nov 19). The phone's way to pick the Claude account the
 * Director's Claude engine uses (the desktop keeps CardSpace for it: one backend), plus the host side:
 * the Claude Remote Control on the server, which reconnects on every switch.
 *
 *   Queue     (the first tab, #1198) the work queue, as it is right now: a strip of counts (Running, Input, Waiting,
 *             Unsupervised working, usage flags) and a Dashboard row, then the sections Input Required, Active (Running /
 *             Sent Back), Unsupervised (live sessions no request owns), Waiting (held for you; the first 8, then
 *             "Show all"), Pending (queued) and Finished today (folded). Every row is one line: state dot, title, where it is up to ("Running 3/7").
 *             Fed by the claude_fleet_phone status feed (status_subscribe while the tab is shown and the screen is on;
 *             pushes only, no timer). A row opens its page: state, where its workflow is (doing, tasks, parts), account /
 *             model, issue (opens in Alchemy), the Supervisor's note and the session's last messages
 *             (claude_desk_transcript, read when the page opens and after a send). Input Required: each question with the
 *             Supervisor's proposed answer and a field, Send = work_answer. Waiting: Start = work_start (Menu: Cancel
 *             Request). A live session, and every unsupervised one: a reply box (Send = steer), Menu: Stop Current Turn,
 *             Pause / Resume. Dashboard (one step from the list): the counts, Supervisor calls (today / 7 days / 30 days),
 *             each account's plan usage on one line and the open usage flags.
 *   Accounts  one row per CardSpace Claude account (service key 'claude'): status dot, name, Active,
 *             its plan usage as WM progress bars (session / week / scoped week, percent, resets time; pushed by
 *             the claude_usage feed while the page is shown, no timer),
 *             the linked claude.ai login (email, plan) Remote Control signs in with, or "No Remote
 *             Control login linked". Tap selects; Switch (left soft key) makes it the engine's account
 *             and reconnects Remote Control (switch_claude_account). Menu: Switch, Reconnect, Link Host
 *             Login, Unlink Login, Add Account..., Add with Token..., Rename..., Delete, Refresh.
 *   Add       (Add Account button under the list, or Menu) signs a new account in on the host
 *             (claude_account_login, modules/claudeAccountLogin.js): step 1 the claude.ai login Remote
 *             Control uses, step 2 the engine's long-lived token. Each step shows its sign-in link
 *             (Copy, Open in Alchemy: openGrimoireUrl) and a Paste code field for the code claude.ai shows
 *             back. The account (CardSpace key + linked login) is made when both are done. A sign-in
 *             keeps running when the page is left; the list offers Resume.
 *   Bring over  Switch / Reconnect first lists the Remote Control sessions running now (title, folder,
 *             last activity) with a Bring over box each; the confirm says which come over and which end.
 *             Picked ones start again under the new login (a copy with the whole history), the rest end.
 *             CardSpace's "Use this account" brings none over.
 *   Sessions  every Claude session on the host (get_claude_sessions, transcripts in ~/.claude/projects):
 *             title or first prompt, last prompt and its time, folder, message count, Live / Remote
 *             Control. Reconnect resumes it into Remote Control (no copy) and shows its claude.ai link;
 *             live already: Open. Disconnect ends its rc-* tmux session (claude_session_action).
 *   Host      the server: host name, Claude CLI version, Remote Control (systemd unit state, since,
 *             restarts, session name, what its tmux pane says, sessions / capacity), Permissions (one set shared
 *             by every account: mode, allow / deny / ask rule counts, trusted folders), the last
 *             switch's Bring over results, the claude.ai login
 *             signed in on the host, the engine's account and token file. Reconnect / Start / Stop.
 *   status    a strip over both tabs: Remote Control Connected / Reconnecting... / Error (Retry) from
 *             claude_remote_control_status pushes and the packets' answers.
 *   Own folders (#1154) on the Host tab: one row per account with its own Remote Control state ("Own
 *             folder": its own config dir and claude-remote@<id>.service; "Host login": the host's
 *             claude-remote.service), what it says and its sessions. Tap selects, hold or Menu: Move to Own
 *             Folder, Start / Stop / Reconnect, Leave Own Folder (claude_remote_fleet). Moving the host's
 *             account restarts the host's Remote Control: a warning, then the Bring over list of its
 *             sessions, then confirmHost. claude_remote_fleet_status pushes re-render it. Once an account
 *             has its own folder (or the host's account moved), Switch only picks the Director's account:
 *             no Remote Control restart, no Bring over.
 *
 * Adding, renaming and deleting go through CardSpace's own packets (add_api_key / update_api_key /
 * delete_api_key, service 'claude'). Admin only (the server answers others with an error). No token
 * is ever shown: the server sends none. Styles: wm-accounts.css (the Accounts program's rows) +
 * wm-claude-accounts.css. Server: modules/claudeAccountHost.js, ws/handlers/313-claudeAccountsHandler.js.
 */
(function () {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'claude-accounts';
    const STATE_LABEL = { connected: 'Connected', reconnecting: 'Reconnecting...', error: 'Error', stopped: 'Stopped', unknown: 'Unknown' };
    const STATE_DOT = { connected: 'ok', reconnecting: 'warn', error: 'bad', stopped: 'off', unknown: 'off' };
    const FLEET_LABEL = { connected: 'Connected', reconnecting: 'Working...', starting: 'Starting...', error: 'Error', stopped: 'Stopped', 'not-moved': 'No own Remote Control', unknown: 'Unknown' };
    const FLEET_DOT = { connected: 'ok', reconnecting: 'warn', starting: 'warn', error: 'bad', stopped: 'off', 'not-moved': 'off', unknown: 'off' };

    let sh = null;
    let page = null;
    let tab = 'queue';
    let sel = null; // account index (Accounts tab)
    let data = { accounts: [], host: null };
    let fleet = { accounts: [], hostMigrated: false }; // each account's own Remote Control (claude_remote_fleet, #1154)
    let fsel = null; // account index (Host tab's own-folder rows)
    let status = { state: 'unknown', message: '' };
    let error = '';
    let loaded = false;
    let pollTimer = null;
    let adding = false; // the Add Account page is up (Accounts tab)
    let lg = { state: 'idle' }; // claude_account_login state (never a token or code)
    let editing = null; // the account Settings page (#1154): { index, draft, name } while it is up
    let picking = null; // the Bring over page: { verb, run(carry), picks: Set of session ids }
    let sx = { total: 0, sessions: [], loaded: false, error: '', limit: 30 }; // Sessions tab
    const sxBusy = new Set(); // session ids with an action running
    const sxNote = {}; // id -> last action's answer (message, link)
    const LG_ACTIVE = new Set(['starting', 'waiting_code', 'verifying']);
    // Queue tab (#1198): the claude_fleet_phone feed's snapshot and where the tab is (list | detail | dashboard)
    const Q_FEED = 'claude_fleet_phone';
    const qEmpty = () => ({ work: [], unsupervised: [], counts: {}, calls: {}, flags: [], notify: {} });
    let qsnap = qEmpty();
    let qOn = false; // subscribed to the feed
    let qLoaded = false;
    let qGone = false; // the server has no such feed yet
    let qErr = '';
    let qpage = 'list';
    let qsel = null; // 'w:<work id>' or 'u:<session id>' while the detail page is up
    let qScroll = 0; // the list's scroll position while a page above it is up
    let qFin = false; // Finished today unfolded
    let qAllHeld = false; // Waiting shows its first Q_HELD_SHOWN rows until unfolded (53 waiting buried the live sessions)
    const Q_HELD_SHOWN = 8;
    const qdraft = {}; // typed answers ('a:<id>:<n>') and replies ('r:<session>'), kept across pushes
    let qtr = { sid: '', messages: [], state: 'idle', error: '' }; // the open page's last messages

    const esc = (s) => sh.escapeHtml(s == null ? '' : String(s));

    function ws() { return window.wsClient || null; }
    function connected() {
        const c = ws();
        // connected is enough: a session still waiting on NovelAI's account data can manage Claude
        return !!(c && typeof c.isConnected === 'function' && c.isConnected());
    }
    async function send(type, payload) {
        const c = ws();
        if (!c || typeof c.sendMessage !== 'function') throw new Error('Not connected to Dreamscape');
        const r = await c.sendMessage(type, payload || {}, false);
        const d = r && r.data && typeof r.data === 'object' && !Array.isArray(r.data) && ('accounts' in r.data || 'success' in r.data) ? r.data : r;
        if (d && d.success === false) throw new Error(d.error || d.message || 'The server refused');
        return d || {};
    }
    const errText = (e) => (e && (e.message || e.error || e.details)) || String(e || 'Failed');

    function take(d) {
        if (!d) return;
        if (Array.isArray(d.sessions) && typeof d.total === 'number') { sx.sessions = d.sessions; sx.total = d.total; sx.loaded = true; sx.error = ''; }
        if (d.login) lg = d.login;
        if (d.fleet && Array.isArray(d.fleet.accounts)) fleet = d.fleet;
        if (Array.isArray(d.accounts)) data.accounts = d.accounts;
        if (d.host) {
            data.host = d.host;
            if (d.host.remoteControl && d.host.remoteControl.status) status = d.host.remoteControl.status;
        }
        loaded = true;
        error = '';
        if (sel != null && !data.accounts.some((a) => a.index === sel)) sel = null;
        if (sel == null) { const a = data.accounts.find((x) => x.active); sel = a ? a.index : null; }
    }

    async function load() {
        if (!connected()) { error = 'Not connected to Dreamscape'; render(); return; }
        try { take(await send('get_claude_accounts')); } catch (e) { error = errText(e); }
        render();
        if (tab === 'sessions') void loadSessions();
    }
    async function loadSessions() {
        if (!connected()) return;
        try { take(await send('get_claude_sessions', { limit: sx.limit })); } catch (e) { sx.error = errText(e); sx.loaded = true; }
        render();
    }
    function userRefresh() { return sh.busy(() => load(), { paint: true }); }

    // while reconnecting, the push may be missed (phone asleep): ask again until it settles
    function watchSettle() {
        clearTimeout(pollTimer);
        if (status.state !== 'reconnecting') return;
        pollTimer = setTimeout(async () => { await load(); watchSettle(); }, 4000);
    }

    // ---------------------------------------------------------------- actions

    const selected = () => data.accounts.find((a) => a.index === sel) || null;

    async function act(fn) {
        try { take(await fn()); } catch (e) { await sh.messageBox({ title: 'Fleet', icon: 'error', text: errText(e) }); }
        render();
        watchSettle();
    }

    const liveRc = () => ((data.host && Array.isArray(data.host.sessions)) ? data.host.sessions : []);
    const sessLabel = (x) => `${x.title || x.id.slice(0, 8)}${x.folder ? ` (${x.folder})` : ''}`;

    /** Switch / Reconnect: pick the sessions to bring over first (when any run), then confirm. */
    async function withCarry(verb, run, extraNote) {
        const list = liveRc();
        if (!list.length) {
            if (!(await confirmEndSessions(verb))) return;
            return run([]);
        }
        picking = { verb, run, picks: new Set(), note: extraNote || '' };
        adding = false;
        if (tab !== 'accounts') tab = 'accounts';
        render();
    }
    async function pickDone() {
        const p = picking;
        if (!p) return;
        const list = liveRc();
        const come = list.filter((x) => p.picks.has(x.id));
        const end = list.filter((x) => !p.picks.has(x.id));
        const lines = [`${p.verb} restarts Remote Control on ${(data.host && data.host.hostname) || 'the host'}.`];
        if (p.note) lines.push(p.note);
        if (come.length) lines.push(`Comes over (${come.length}): ${come.map(sessLabel).join(', ')}`);
        if (end.length) lines.push(`Ends (${end.length}): ${end.map(sessLabel).join(', ')}`);
        const v = await sh.messageBox({ title: 'Fleet', icon: end.length ? 'warning' : 'question', text: lines.join('\n\n'), buttons: [{ text: 'Continue', value: true, default: true }, { text: 'Cancel', value: false }] });
        if (v !== true) return;
        picking = null;
        await p.run(come.map((x) => x.id));
    }
    function pickCancel() { picking = null; render(); }

    async function confirmEndSessions(verb) {
        const rc = data.host && data.host.remoteControl;
        const n = (rc && rc.pane && rc.pane.sessions) || liveRc().length;
        if (!n) return true;
        const v = await sh.messageBox({
            title: 'Fleet',
            icon: 'warning',
            text: `${verb} restarts Remote Control on ${data.host.hostname || 'the host'}. Its ${n} running session${n === 1 ? '' : 's'} will end.`,
            buttons: [{ text: 'Continue', value: true, default: true }, { text: 'Cancel', value: false }]
        });
        return v === true;
    }

    const fleetAcc = (index) => fleet.accounts.find((f) => f.index === index) || null;
    /** A switch that only picks the Director's account (the account, or the host's, runs in its own folder). */
    const directorOnly = (acc) => !!(fleet.hostMigrated || (fleetAcc(acc.index) || {}).moved);

    async function switchTo(acc) {
        if (!acc) return;
        if (directorOnly(acc)) {
            const fa = fleetAcc(acc.index);
            // its own Remote Control: "Reconnect" restarts only that one, a switch restarts nothing
            if (acc.active && fa && fa.moved) { await fleetAct('reconnect', fa); return; }
            await act(() => send('switch_claude_account', { index: acc.index, carry: [] }));
            return;
        }
        await withCarry(acc.active ? 'Reconnecting' : `Switching to ${acc.name}`, async (carry) => {
            status = { state: 'reconnecting', message: `Switching to ${acc.name}` };
            render();
            await act(() => send('switch_claude_account', { index: acc.index, carry }));
        });
    }

    async function remote(action) {
        if (action === 'stop') {
            if (!(await confirmEndSessions('Stopping'))) return;
            await act(() => send('claude_remote_control', { action }));
            return;
        }
        await withCarry(action === 'start' ? 'Starting' : 'Reconnecting', async (carry) => {
            status = { state: 'reconnecting', message: 'Reconnecting Remote Control' };
            render();
            await act(() => send('claude_remote_control', { action, carry }));
        });
    }

    // ---------------------------------------------------------------- own folders (each account's own Remote Control)

    async function fleetSend(action, fa, extra) {
        try {
            take(await send('claude_remote_fleet', Object.assign({ action, index: fa.index }, extra || {})));
        } catch (e) {
            await sh.messageBox({ title: 'Fleet', icon: 'error', text: errText(e) });
        }
        render();
    }

    async function fleetAct(action, fa) {
        if (!fa) return;
        const n = (fa.sessions || []).length;
        const ends = n ? ` Its ${n} running session${n === 1 ? '' : 's'} end${n === 1 ? 's' : ''}.` : '';
        if (action === 'stop' || action === 'leave' || action === 'reconnect') {
            const text = action === 'stop' ? `Stop ${fa.name}'s Remote Control?${ends} It starts again with the host, or with Start.`
                : action === 'leave' ? `Take ${fa.name} out of its own folder? Its Remote Control stops and is not started again.${ends} Its sessions can be resumed later.`
                    : `Reconnect ${fa.name}'s Remote Control?${ends}`;
            if (action !== 'reconnect' || n) {
                const v = await sh.messageBox({ title: fa.remoteName || fa.name, icon: 'warning', text, buttons: [{ text: action === 'stop' ? 'Stop' : action === 'leave' ? 'Leave' : 'Reconnect', value: true }, { text: 'Cancel', value: false, default: true }] });
                if (v !== true) return;
            }
        }
        await fleetSend(action, fa);
    }

    async function moveFolder(fa) {
        if (!fa || !fa.canMove) return;
        if (!fa.moveRestartsHost) {
            const v = await sh.messageBox({
                title: 'Move to Own Folder',
                icon: 'question',
                text: `Give ${fa.name} a folder of its own? It gets its own Remote Control (${fa.remoteName}) on its own login and runs next to the other accounts. Settings, permissions and sessions stay shared.`,
                buttons: [{ text: 'Move', value: true, default: true }, { text: 'Cancel', value: false }]
            });
            if (v === true) await fleetSend('move', fa);
            return;
        }
        const others = fleet.accounts.filter((f) => f.index !== fa.index && f.hasLogin && !f.moved).map((f) => f.name);
        const v = await sh.messageBox({
            title: 'Move to Own Folder',
            icon: 'warning',
            text: [`${fa.name} is on the host's login. Moving it stops the host's Remote Control (claude-remote.service) and ends every session it runs, including a Claude session that may be working through it right now.`,
                others.length ? `Move the other accounts first: ${others.join(', ')}.` : 'The other accounts already have their own folders.',
                'You can pick sessions to bring over next.'].join('\n\n'),
            buttons: [{ text: 'Continue', value: true }, { text: 'Cancel', value: false, default: true }]
        });
        if (v !== true) return;
        await withCarry(`Moving ${fa.name}`, (carry) => fleetSend('move', fa, { confirmHost: true, carry }), 'Its own Remote Control starts once the host\'s has stopped; picked sessions continue there.');
    }

    function fleetItems(fa) {
        if (!fa) return [];
        const items = [];
        if (fa.canMove) items.push({ label: 'Move to Own Folder...', action: () => moveFolder(fa) });
        if (fa.moved) {
            const up = fa.state === 'connected' || fa.state === 'reconnecting' || fa.state === 'starting';
            items.push(up ? { label: 'Stop', action: () => fleetAct('stop', fa) } : { label: 'Start', action: () => fleetAct('start', fa) });
            items.push({ label: 'Reconnect', action: () => fleetAct('reconnect', fa) });
            items.push({ label: 'Leave Own Folder...', disabled: !!fa.onHost, action: () => fleetAct('leave', fa) });
        }
        return items;
    }

    function onFleet(msg) {
        const d = (msg && (msg.data || msg)) || null;
        if (!d || !Array.isArray(d.accounts)) return;
        fleet = d;
        render();
    }

    // ---------------------------------------------------------------- Sessions tab

    function openLink(url) {
        if (!url) return;
        const go = window.openGrimoireUrl;
        if (typeof go === 'function') Promise.resolve().then(() => go(url)).catch(() => window.open(url, '_blank', 'noopener'));
        else window.open(url, '_blank', 'noopener');
    }
    async function sessionAct(action, id) {
        const row = sx.sessions.find((x) => x.id === id);
        if (!row || sxBusy.has(id)) return;
        if (action === 'open') { openLink(row.link || (sxNote[id] && sxNote[id].link)); return; }
        if (action === 'disconnect') {
            const v = await sh.messageBox({ title: 'Disconnect', icon: 'warning', text: `End ${row.title}? Its tmux session ${row.tmuxSession || ''} is closed; the conversation is kept and Reconnect brings it back.`, buttons: [{ text: 'Disconnect', value: true }, { text: 'Cancel', value: false, default: true }] });
            if (v !== true) return;
        }
        sxBusy.add(id);
        sxNote[id] = { message: action === 'reconnect' ? 'Starting it in Remote Control...' : 'Disconnecting...' };
        render();
        try {
            const d = await send('claude_session_action', { action, id, limit: sx.limit });
            take(d);
            const r = d.result || {};
            sxNote[id] = { message: r.message || (r.state === 'disconnected' ? 'Disconnected' : r.state || ''), link: r.link || '', state: r.state };
        } catch (e) {
            sxNote[id] = { message: errText(e), state: 'failed' };
        }
        sxBusy.delete(id);
        render();
    }

    async function link(acc) {
        if (!acc) return;
        const login = data.host && data.host.login;
        if (!login) { await sh.messageBox({ title: 'Fleet', icon: 'warning', text: 'The host has no claude.ai login. Sign in with claude on the host first.' }); return; }
        const v = await sh.messageBox({
            title: 'Link Host Login',
            icon: 'question',
            text: `Use the host's claude.ai login (${login.email || 'signed in'}${login.plan ? `, ${login.plan}` : ''}) for Remote Control when ${acc.name} is active?`,
            buttons: [{ text: 'Link', value: true, default: true }, { text: 'Cancel', value: false }]
        });
        if (v === true) await act(() => send('link_claude_account_login', { index: acc.index }));
    }

    async function unlink(acc) {
        if (!acc || !acc.remoteLogin) return;
        await act(() => send('unlink_claude_account_login', { index: acc.index }));
    }

    async function addAccount() {
        const name = await sh.messageBox({ title: 'Add Claude Account', text: 'Account name:', input: { placeholder: 'e.g. Claude Max' }, buttons: [{ text: 'Next', value: true, default: true }, { text: 'Cancel', value: false }] });
        if (!name) return;
        const token = await sh.messageBox({ title: 'Add Claude Account', text: 'OAuth token (run claude setup-token):', input: { type: 'password' }, buttons: [{ text: 'Add', value: true, default: true }, { text: 'Cancel', value: false }] });
        if (!token || !String(token).trim()) return;
        await act(async () => { await send('add_api_key', { service: 'claude', name, apiKey: String(token).trim() }); return send('get_claude_accounts'); });
    }

    // ---------------------------------------------------------------- account Settings (#1154)

    const MODEL_CHOICES = [['', 'Account default'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['fable', 'Fable']];
    const EFFORT_CHOICES = [['', 'Account default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];
    const PRIORITY_CHOICES = [['high', 'High'], ['normal', 'Normal'], ['low', 'Low']];
    const MODE_CHOICES = [['', 'Account default'], ['default', 'Ask first'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['auto', 'Auto'], ['dontAsk', 'Do not ask'], ['bypassPermissions', 'Bypass permissions']];
    const withCurrent = (list, v) => (v && !list.some(([k]) => k === v) ? list.concat([[v, v]]) : list);
    const pctText = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : String(Math.round(Number(v))));
    const settingsUi = () => (window.wmSettings && window.wmSettings.ui) || null;

    function openSettings(acc) {
        const ui = settingsUi();
        if (!acc || !ui) { if (acc) void sh.messageBox({ title: 'Settings', icon: 'error', text: 'The form controls are not loaded yet. Try again in a moment.' }); return; }
        const fa = fleetAcc(acc.index);
        const st = (fa && fa.settings) || {};
        editing = {
            index: acc.index,
            built: false,
            saving: false,
            draft: {
                name: (fa && fa.name) || acc.name || '',
                preferred: !!st.preferred,
                priority: st.priority || 'normal',
                maxWeeklyPct: pctText(st.maxWeeklyPct),
                maxSessionPct: pctText(st.maxSessionPct),
                renewalDay: pctText(st.renewalDay),
                defaultModel: st.defaultModel || '',
                defaultEffort: st.defaultEffort || '',
                defaultMode: st.defaultMode || ''
            }
        };
        adding = false;
        picking = null;
        tab = 'accounts';
        render();
        sh.refreshTitleAction();
    }

    function buildSettings(panel) {
        const ui = settingsUi();
        const e = editing;
        const d = e.draft;
        const acc = data.accounts.find((a) => a.index === e.index);
        const label = (list, v) => (list.find(([k]) => k === v) || [v, v])[1];
        const model = withCurrent(MODEL_CHOICES, d.defaultModel);
        const effort = withCurrent(EFFORT_CHOICES, d.defaultEffort);
        const mode = withCurrent(MODE_CHOICES, d.defaultMode);
        const prio = PRIORITY_CHOICES;
        panel.innerHTML = `<div class="wm-form-hdr wca-sub-hdr">${esc((acc && acc.name) || 'Account')}: Settings</div>
            <div class="wca-form">
                ${ui.row('Name', ui.edit('wca-f-name', d.name, 'maxlength="60" data-f="name"'), { for: 'wca-f-name' })}
                ${ui.check('preferred', 'Preferred account', d.preferred, 'data-f="preferred"')}
                ${ui.row('Priority', ui.comboHtml('priority', label(prio, d.priority)), { wide: true })}
                ${ui.row('Max weekly usage %', ui.edit('wca-f-week', d.maxWeeklyPct, 'inputmode="numeric" maxlength="3" placeholder="None" data-f="maxWeeklyPct"'), { for: 'wca-f-week', wide: true })}
                ${ui.row('Max session usage %', ui.edit('wca-f-sess', d.maxSessionPct, 'inputmode="numeric" maxlength="3" placeholder="None" data-f="maxSessionPct"'), { for: 'wca-f-sess', wide: true })}
                ${ui.row('Renewal day', ui.edit('wca-f-renew', d.renewalDay, 'inputmode="numeric" maxlength="2" placeholder="Day of month" data-f="renewalDay"'), { for: 'wca-f-renew', wide: true })}
                ${ui.row('Default model', ui.comboHtml('model', label(model, d.defaultModel)), { wide: true })}
                ${ui.row('Default effort', ui.comboHtml('effort', label(effort, d.defaultEffort)), { wide: true })}
                ${ui.row('Permission mode', ui.comboHtml('mode', label(mode, d.defaultMode)), { wide: true })}
                ${ui.note('Only one account can be preferred. A lower priority account gets work only after the higher ones. Leave a maximum blank for no limit: the account is then used until it is out.')}
                <div class="wac-note wca-form-err" hidden></div>
            </div>`;
        panel.dataset.h = 'settings';
        e.built = true;
        panel.querySelectorAll('input[data-f]').forEach((inp) => {
            if (inp.type === 'checkbox') inp.addEventListener('change', () => { d.preferred = inp.checked; });
            else inp.addEventListener('input', () => { d[inp.dataset.f] = inp.value; });
        });
        ui.bindCombo(panel.querySelector('[data-act="priority"]'), prio, d.priority, (v) => { d.priority = v; });
        ui.bindCombo(panel.querySelector('[data-act="model"]'), model, d.defaultModel, (v) => { d.defaultModel = v; });
        ui.bindCombo(panel.querySelector('[data-act="effort"]'), effort, d.defaultEffort, (v) => { d.defaultEffort = v; });
        ui.bindCombo(panel.querySelector('[data-act="mode"]'), mode, d.defaultMode, (v) => { d.defaultMode = v; });
    }

    function formError(text) {
        const el = page && page.querySelector('.wca-form-err');
        if (!el) return;
        el.textContent = text || '';
        el.hidden = !text;
    }

    function closeSettings() {
        editing = null;
        render();
        sh.refreshTitleAction();
    }

    async function saveSettings() {
        const e = editing;
        if (!e || e.saving) return;
        const d = e.draft;
        const name = String(d.name || '').trim();
        if (!name) { formError('Enter a name for the account.'); return; }
        const pct = (v, what) => {
            const t = String(v == null ? '' : v).trim();
            if (!t) return { ok: true, value: null };
            const n = Number(t);
            if (!/^\d{1,3}$/.test(t) || n < 1 || n > 100) { formError(`${what} must be a whole number from 1 to 100, or blank.`); return { ok: false }; }
            return { ok: true, value: n };
        };
        const wk = pct(d.maxWeeklyPct, 'Max weekly usage');
        if (!wk.ok) return;
        const se = pct(d.maxSessionPct, 'Max session usage');
        if (!se.ok) return;
        const rt = String(d.renewalDay == null ? '' : d.renewalDay).trim();
        if (rt && !(/^\d{1,2}$/.test(rt) && Number(rt) >= 1 && Number(rt) <= 31)) { formError('Renewal day must be a day of the month from 1 to 31, or blank.'); return; }
        formError('');
        e.saving = true;
        try {
            const r = await send('claude_fleet_account', {
                action: 'save', index: e.index, name, preferred: !!d.preferred, priority: d.priority || 'normal', maxWeeklyPct: wk.value, maxSessionPct: se.value, renewalDay: rt ? Number(rt) : null,
                defaultModel: d.defaultModel || '', defaultEffort: d.defaultEffort || '', defaultMode: d.defaultMode || ''
            });
            take(r);
            closeSettings();
            void load(); // the account's new name in the CardSpace rows
        } catch (err) {
            e.saving = false;
            const msg = errText(err);
            if (/unknown message type/i.test(msg)) await sh.messageBox({ title: 'Settings', icon: 'warning', text: 'Account settings are not available on this server yet.' });
            else await sh.messageBox({ title: 'Settings', icon: 'error', text: msg });
        }
    }

    // ---------------------------------------------------------------- Add Account (sign in on the host)

    async function loginAct(action, payload, quiet) {
        try {
            const d = await send('claude_account_login', Object.assign({ action }, payload || {}));
            if (d.login) lg = d.login;
            if (Array.isArray(d.accounts)) data.accounts = d.accounts;
        } catch (e) {
            if (!quiet) await sh.messageBox({ title: 'Add Claude Account', icon: 'error', text: errText(e) });
        }
        render();
    }

    function startAdd() {
        adding = true;
        tab = 'accounts';
        render();
        // a sign-in already running is picked back up; a finished one makes way for a new one
        return loginAct(LG_ACTIVE.has(lg.state) ? 'status' : 'start');
    }

    function closeAdd() {
        adding = false;
        if (lg.state === 'done' || lg.state === 'error') lg = { state: 'idle' };
        render();
        void load();
    }

    async function cancelAdd() {
        if (LG_ACTIVE.has(lg.state)) await loginAct('cancel');
        closeAdd();
    }

    const field = (cls) => (page && page.querySelector(cls)) || null;

    function submitCode() {
        const input = field('.wca-code');
        const code = input ? input.value.trim() : '';
        if (!code) { if (input) input.focus(); return; }
        const name = field('.wca-name-input');
        input.value = '';
        return loginAct('code', { code, name: name ? name.value.trim() : undefined });
    }

    async function copyLink(btn) {
        const url = lg.url;
        if (!url) return;
        let ok = false;
        try { await navigator.clipboard.writeText(url); ok = true; } catch (_) { /* older WebView: select + copy */ }
        if (!ok) {
            const f = field('.wca-link-field');
            if (f) { f.focus(); f.select(); try { f.setSelectionRange(0, url.length); } catch (_) { /* textarea */ } try { ok = document.execCommand('copy'); } catch (_) { ok = false; } }
        }
        const b = btn || (page && page.querySelector('[data-wca-add="copy"]'));
        if (b) { b.textContent = ok ? 'Copied' : 'Select + copy'; setTimeout(() => { if (b.isConnected) b.textContent = 'Copy'; }, 2000); }
    }

    function openInAlchemy() {
        const url = lg.url;
        if (!url) return;
        // Alchemy (the phone's browser, wmBrowser.js; Grimoire on the desktop): featureLoader's openGrimoireUrl
        const go = window.openGrimoireUrl;
        if (typeof go === 'function') Promise.resolve().then(() => go(url)).catch(() => window.open(url, '_blank', 'noopener'));
        else window.open(url, '_blank', 'noopener');
    }

    async function switchToAdded() {
        const a = lg.account;
        closeAdd();
        await load();
        const acc = a && data.accounts.find((x) => x.index === a.index);
        if (acc) { select(acc.index); await switchTo(acc); }
    }

    function addClick(what, btn) {
        if (what === 'open') return startAdd();
        if (what === 'copy') return copyLink(btn);
        if (what === 'alchemy') return openInAlchemy();
        if (what === 'code') return submitCode();
        if (what === 'retry') return loginAct('retry');
        if (what === 'cancel') return cancelAdd();
        if (what === 'done') return closeAdd();
        if (what === 'switch') return switchToAdded();
        return null;
    }

    function onLoginStatus(msg) {
        const d = (msg && (msg.data || msg)) || null;
        if (!d || !d.state) return;
        lg = d;
        if (d.state === 'done' && page && !page.hidden) void load();
        render();
    }

    async function rename(acc) {
        if (!acc) return;
        const name = await sh.messageBox({ title: 'Rename', text: 'Account name:', input: { value: acc.name }, buttons: [{ text: 'Save', value: true, default: true }, { text: 'Cancel', value: false }] });
        if (!name || name === acc.name) return;
        await act(async () => { await send('update_api_key', { service: 'claude', index: acc.index, name }); return send('get_claude_accounts'); });
    }

    async function remove(acc) {
        if (!acc) return;
        const v = await sh.messageBox({ title: 'Delete', icon: 'warning', text: `Delete ${acc.name}? CardSpace loses it too.`, buttons: [{ text: 'Delete', value: true }, { text: 'Cancel', value: false, default: true }] });
        if (v !== true) return;
        await act(async () => {
            if (acc.remoteLogin) { try { await send('unlink_claude_account_login', { index: acc.index }); } catch (_) { /* the key goes anyway */ } }
            await send('delete_api_key', { service: 'claude', index: acc.index });
            return send('get_claude_accounts');
        });
    }

    // ---------------------------------------------------------------- page

    function when(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }
    const planText = (l) => [l.plan ? l.plan.replace(/^\w/, (c) => c.toUpperCase()) : '', l.rateLimitTier ? l.rateLimitTier.replace(/^default_claude_/, '').replace(/_/g, ' ') : ''].filter(Boolean).join(' · ');

    function statusStrip() {
        if (fleet.hostMigrated) {
            // the legacy host unit is retired: the strip summarises each account's own Remote Control
            const fl = fleet.accounts.filter((f) => f.moved);
            const up = fl.filter((f) => f.state === 'connected').length;
            const sd = up === fl.length ? 'ok' : up ? 'warn' : 'bad';
            return `<div class="wca-status wca-st-${up === fl.length ? 'connected' : up ? 'reconnecting' : 'error'}" role="status" aria-live="polite">
            <span class="wac-dot wac-dot-${sd}"></span>
            <span class="wca-status-text"><b>Remote Control:</b> ${up} of ${fl.length} connected</span>
        </div>`;
        }
        const st = STATE_LABEL[status.state] ? status.state : 'unknown';
        const retry = st === 'error' || st === 'stopped';
        return `<div class="wca-status wca-st-${esc(st)}" role="status" aria-live="polite">
            <span class="wac-dot wac-dot-${STATE_DOT[st]}"></span>
            <span class="wca-status-text"><b>Remote Control:</b> ${esc(STATE_LABEL[st])}${status.message ? ` <span class="wca-status-msg">${esc(status.message)}</span>` : ''}</span>
            ${retry ? `<button type="button" class="wca-retry" data-wca="${st === 'stopped' ? 'start' : 'reconnect'}">${st === 'stopped' ? 'Start' : 'Retry'}</button>` : ''}
        </div>`;
    }

    // ---- plan usage (statusHub claude_usage via walletTray.watchClaude's count; own listener for the rows) ----
    const usage = new Map(); // account id -> row
    let usageOn = false;
    let usageLoaded = false;
    let usageWired = false;
    const awake = () => (typeof sh.onScreen === 'function' ? sh.onScreen() : !document.hidden);
    const usageIndexRow = (index) => { for (const r of usage.values()) if (r.index === index) return r; return null; };

    function usageApply(changed, removed, whole) {
        if (whole) usage.clear();
        Object.entries(changed || {}).forEach(([id, row]) => { if (id !== '_meta' && row && typeof row === 'object') usage.set(id, row); });
        (removed || []).forEach((id) => usage.delete(id));
        usageLoaded = true;
    }

    async function usageWatch(on) {
        const c = ws();
        const tray = window.walletTray && typeof window.walletTray.watchClaude === 'function' ? window.walletTray : null;
        if (on === usageOn) return;
        usageOn = on;
        if (tray) tray.watchClaude('fleet', on);
        if (!c || typeof c.sendMessage !== 'function') return;
        if (on) {
            try {
                const r = await c.sendMessage('status_subscribe', { feed: 'claude_usage' }, false);
                if (usageOn) { usageApply((r && (r.items || (r.data && r.data.items))) || {}, [], true); render(); }
            } catch (_) { usageLoaded = true; render(); }
        } else if (!tray) {
            try { await c.sendMessage('status_unsubscribe', { feed: 'claude_usage' }, false); } catch (_) { /* gone */ }
        }
    }

    const usageLevel = (l) => {
        const sev = String(l.severity || '').toLowerCase();
        if (l.percent >= 90 || /crit|danger|high|error|limit|block/.test(sev)) return 'bad';
        if (l.percent >= 75 || /warn|elevat|approach/.test(sev)) return 'warn';
        return 'ok';
    };
    const usageRank = (l) => (l.kind === 'session' || l.kind === 'five_hour' ? 0 : l.kind === 'weekly_all' || l.kind === 'seven_day' ? 1 : 2);
    const resetText = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
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
        return { elapsedPct, percent, ahead: Math.round(percent - elapsedPct), state: far ? 'far' : (percent > elapsedPct ? 'over' : 'ok'), runOutAt };
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
    const dayText = (ms) => new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    /** { text, tip } of the account's renewal: the day the user set, else the day its subscription began (an estimate). */
    function renewalOf(a, u, now) {
        const fa = fleetAcc(a.index);
        const set = fa && fa.settings && fa.settings.renewalDay;
        const day = set || (u && u.billingDay);
        const at = day ? renewalAfter(day, now) : null;
        if (!at) return null;
        return { text: `Renews ${dayText(at)}`, tip: set ? `Renews on day ${set} of each month (set by you)` : `Estimated from the day this subscription started (day ${day} of the month)` };
    }
    function paceTip(p) {
        if (!p) return '';
        const n = Math.abs(p.ahead);
        const rel = p.ahead === 0 ? 'on pace' : `you are ${n} point${n === 1 ? '' : 's'} ${p.ahead > 0 ? 'ahead' : 'behind'}`;
        return `Even pace: ${Math.round(p.elapsedPct)}% by now - ${rel}`;
    }
    /** The account's usage: the fleet snapshot's own (pushed whenever the server reads it again), else the claude_usage feed's row. */
    function usageOf(a) {
        const fa = fleetAcc(a.index);
        const fu = fa && fa.usage && typeof fa.usage === 'object' ? fa.usage : null;
        if (fu && Array.isArray(fu.limits) && fu.limits.some((l) => l && l.percent != null)) return fu;
        return usageIndexRow(a.index) || (fu && fu.error ? fu : null);
    }
    function usageHtml(a) {
        const u = usageOf(a);
        if (!u) return usageLoaded ? '' : '<div class="wac-line wca-muted">Reading usage...</div>';
        const now = Date.now();
        const limits = (Array.isArray(u.limits) ? u.limits : []).filter((l) => l && l.percent != null).sort((x, y) => usageRank(x) - usageRank(y));
        if (!limits.length) return `<div class="wac-line wca-muted">${esc(u.needsLogin ? (u.error || 'No login linked: no usage') : `Usage unavailable${u.error ? `: ${u.error}` : ''}`)}</div>`;
        const ren = renewalOf(a, u, now);
        const head = ren ? `<div class="wca-use-renews wca-muted" title="${esc(ren.tip)}">${esc(ren.text)}</div>` : '';
        return head + limits.map((l) => {
            const stale = l.resetsAt && l.resetsAt <= now;
            const pace = stale ? null : paceOf(l, now);
            const w = stale ? 0 : Math.max(0, Math.min(100, Math.round(Number(l.percent) || 0)));
            const wk = /^(weekly|seven_day)/.test(String(l.kind || ''));
            const resets = !l.resetsAt ? '' : stale ? 'reset' : (pace && pace.state === 'far' && pace.runOutAt ? `at this rate: out ${resetText(pace.runOutAt)}, ` : '') + `${wk ? 'weekly resets' : 'resets'} ${resetText(l.resetsAt)}`;
            const lv = pace && pace.state === 'far' ? 'bad' : (usageLevel(l) === 'ok' && pace && pace.state === 'over' ? 'warn' : usageLevel(l));
            // 0 draws no fill at all and 100 fills the whole inside (the fill's width in % leaves a hairline or a sliver
            // at fractional device pixels); these two states are classes, not widths
            const edge = w >= 100 ? ' wca-f-full' : w <= 0 ? ' wca-f-zero' : '';
            return `<div class="wca-use"><span class="wca-use-label">${esc(l.label || l.short || l.kind)}</span>`
                + `<span class="wac-meter wac-lv-${lv}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${w}"><i class="${edge.trim()}" data-w="${w}"></i>${pace ? `<b class="wca-pace" data-pace="${pace.elapsedPct.toFixed(1)}" title="${esc(paceTip(pace))}"></b>` : ''}</span>`
                + `<span class="wca-use-pct">${stale ? '' : `${w}%`}</span><span class="wca-use-reset wca-muted"${pace ? ` title="${esc(paceTip(pace))}"` : ''}>${esc(resets)}</span></div>`;
        }).join('');
    }
    function paintBars(root0) {
        root0.querySelectorAll('i[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });
        root0.querySelectorAll('b[data-pace]').forEach((el) => { el.style.left = `${Math.max(0, Math.min(100, Number(el.dataset.pace) || 0))}%`; });
    }

    // ---- availability (server: fleet.accounts[].availability): near a limit = warning, capped / exhausted = error ----
    /** { level: 'warn' | 'bad', text } for an account that is near its limits or no longer free to schedule work on, else null. */
    function noticeOf(fa) {
        const av = fa && fa.availability;
        if (!av || typeof av !== 'object') return null;
        const bad = av.state === 'capped' || av.state === 'exhausted' || (av.schedulable === false && av.state !== 'unknown' && av.state !== 'free');
        if (!bad && av.state !== 'near') return null;
        let text = String(av.message || (bad ? 'No longer free to schedule work' : 'Near its limit')).trim();
        if (av.resetsAt && !/reset/i.test(text)) text += `${/[.!?]$/.test(text) ? '' : '.'} Resets ${resetText(av.resetsAt)}.`;
        return { level: bad ? 'bad' : 'warn', text };
    }
    const noticeLine = (n, who) => `<div class="wca-notice wca-notice-${n.level}" role="status"><span class="wca-notice-ico">${sh.art.img(n.level === 'bad' ? 'msgbox-error' : 'msgbox-warning')}</span><span class="wca-notice-text">${who ? `<b>${esc(who)}:</b> ` : ''}${esc(n.text)}</span></div>`;
    /** Extra usage is on (availability.costWarning): billed past the plan's limits, a red notice whatever the limits say. */
    function costOf(fa) {
        const t = fa && fa.availability && fa.availability.costWarning ? String(fa.availability.costWarning).trim() : '';
        return t ? { level: 'bad', text: t } : null;
    }
    function noticesHtml() {
        return data.accounts.map((a) => {
            const fa = fleetAcc(a.index);
            const who = (fa && fa.name) || a.name;
            const n = noticeOf(fa);
            const cost = costOf(fa);
            return (n ? noticeLine(n, who) : '') + (cost ? noticeLine(cost, who) : '');
        }).join('');
    }

    function accountRow(a) {
        const l = a.remoteLogin;
        const lines = [];
        if (l) {
            lines.push(`<div class="wac-line">${esc(l.email || l.displayName || 'claude.ai login')}</div>`);
            const p = planText(l);
            if (p) lines.push(`<div class="wac-line">${esc(p)}</div>`);
        } else {
            lines.push('<div class="wac-line wca-muted">No Remote Control login linked</div>');
        }
        const fa = fleetAcc(a.index);
        if (fa && fa.moved) lines.push(`<div class="wac-line">Own Remote Control: ${esc(FLEET_LABEL[fa.state] || fa.state)}</div>`);
        const note = noticeOf(fa);
        if (note) lines.push(noticeLine(note));
        const cost = costOf(fa);
        if (cost) lines.push(noticeLine(cost));
        lines.push(usageHtml(a));
        lines.push(`<div class="wac-line wca-muted">Engine key ${esc(a.fingerprint || '')}</div>`);
        const dot = fa && fa.moved ? (FLEET_DOT[fa.state] || 'off') : a.active ? (status.state === 'connected' ? 'ok' : status.state === 'error' ? 'bad' : 'warn') : 'off';
        return `<div class="wac-row${sel === a.index ? ' is-selected' : ''}" role="option" aria-selected="${sel === a.index}" data-index="${a.index}">
            <span class="wac-dot wac-dot-${dot}"></span>
            <div class="wac-main">
                <div class="wac-name">${esc((fa && fa.name) || a.name)}${a.active ? ' <span class="wca-badge">Active</span>' : ''}${a.onHost ? ' <span class="wca-badge wca-badge-host">On host</span>' : ''}${fa && fa.settings && fa.settings.preferred ? ' <span class="wca-badge wca-badge-pref">Preferred</span>' : ''}${fa && fa.settings && fa.settings.priority === 'high' ? ' <span class="wca-badge wca-badge-pref">High</span>' : ''}${fa && fa.settings && fa.settings.priority === 'low' ? ' <span class="wca-badge">Low</span>' : ''}</div>
                ${lines.join('')}
            </div>
        </div>`;
    }

    function addHtml() {
        const st = lg.state;
        const head = lg.stepNumber ? `Step ${lg.stepNumber} of ${lg.steps || 2}: ${lg.stepTitle || ''}` : 'Add Claude Account';
        const who = lg.signedInAs ? `${lg.signedInAs.email || lg.signedInAs.displayName || 'claude.ai'}${lg.signedInAs.plan ? ` (${planText(lg.signedInAs)})` : ''}` : '';
        let body;
        if (st === 'waiting_code' || st === 'verifying') {
            const checking = st === 'verifying';
            const intro = lg.step === 'token'
                ? `Signed in${who ? ` as ${who}` : ''}. Open the link once more and press Authorize with the same account: this is the long-lived token the Claude engine uses.`
                : 'Open this link and sign in with the Claude account to add. claude.ai then shows a code to paste below.';
            body = `<div class="wca-add-text">${esc(intro)}</div>
                <div class="wca-add-label">Sign-in link</div>
                <textarea class="wca-link-field" readonly rows="4" aria-label="Sign-in link">${esc(lg.url)}</textarea>
                <div class="wca-actions wca-add-row">
                    <button type="button" data-wca-add="copy">Copy</button>
                    <button type="button" data-wca-add="alchemy">Open in Alchemy</button>
                </div>
                ${lg.step === 'login' ? `<label class="wca-add-label" for="wca-name">Account name (optional)</label>
                <input id="wca-name" class="wca-name-input wca-input" type="text" autocomplete="off" placeholder="Its email when blank" value="${esc(lg.name || '')}">` : ''}
                <label class="wca-add-label" for="wca-code">Paste code</label>
                <input id="wca-code" class="wca-code wca-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Code from claude.ai"${checking ? ' disabled' : ''}>
                <div class="wca-actions">
                    <button type="button" data-wca-add="code"${checking ? ' disabled' : ''}>${checking ? 'Checking...' : 'Continue'}</button>
                    <button type="button" data-wca-add="cancel">Cancel</button>
                </div>`;
        } else if (st === 'done') {
            const a = lg.account || {};
            body = `<div class="wca-add-text"><b>Added ${esc(a.name || 'the account')}</b></div>
                <div class="wca-kvs">
                    <div class="wca-kv"><span class="wca-k">Account</span><span class="wca-v">${esc(a.email || '-')}</span></div>
                    <div class="wca-kv"><span class="wca-k">Plan</span><span class="wca-v">${esc(a.plan ? a.plan.replace(/^\w/, (c) => c.toUpperCase()) : '-')}</span></div>
                    <div class="wca-kv"><span class="wca-k">Remote Control</span><span class="wca-v">${a.linked ? 'Login linked' : 'Not linked'}</span></div>
                </div>
                ${lg.message ? `<div class="wac-note">${esc(lg.message)}</div>` : ''}
                <div class="wca-actions">
                    ${a.index != null ? '<button type="button" data-wca-add="switch">Switch to it</button>' : ''}
                    <button type="button" data-wca-add="done">Done</button>
                </div>`;
        } else if (st === 'error') {
            body = `<div class="wac-note">${esc(lg.message || 'The sign-in failed')}</div>
                <div class="wca-actions">
                    <button type="button" data-wca-add="retry">Try Again</button>
                    <button type="button" data-wca-add="cancel">Cancel</button>
                </div>`;
        } else {
            body = `<div class="wac-empty">${esc(lg.message || 'Starting the sign-in on the host...')}</div>
                <div class="wca-actions"><button type="button" data-wca-add="cancel">Cancel</button></div>`;
        }
        return `<div class="wm-form-hdr wca-sub-hdr">${esc(head)}</div><div class="wca-add">${body}</div>`;
    }

    const ago = (isoText) => {
        const t = Date.parse(isoText || '');
        if (!t) return '';
        const m = Math.round((Date.now() - t) / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m} min ago`;
        if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
        return when(isoText);
    };

    function pickHtml() {
        const p = picking;
        const list = liveRc();
        const rows = list.map((x) => {
            const on = p.picks.has(x.id);
            return `<label class="wac-row wca-pick${on ? ' is-picked' : ''}" data-pick="${esc(x.id)}">
                <input type="checkbox" class="wca-check" data-pick="${esc(x.id)}"${on ? ' checked' : ''}${x.resumable ? '' : ' disabled'} aria-label="Bring over ${esc(x.title)}">
                <div class="wac-main">
                    <div class="wac-name">${esc(x.title)}${x.status === 'busy' ? ' <span class="wca-badge">Working</span>' : ''}</div>
                    <div class="wac-line wca-muted">${esc([x.folder, x.origin === 'server' ? 'Remote Control' : x.tmuxSession, ago(x.lastActivity)].filter(Boolean).join(' · '))}</div>
                    <div class="wac-line">${on ? 'Comes over' : 'Ends'}</div>
                </div>
            </label>`;
        }).join('');
        const n = p.picks.size;
        return `<div class="wm-form-hdr wca-sub-hdr">${esc(p.verb)}: bring sessions over?</div>
            <div class="wca-add-text wca-pick-intro">${esc(`${list.length} Remote Control session${list.length === 1 ? '' : 's'} running. Ticked ones start again under the new login with their history; the rest end.`)}</div>
            ${rows}
            <div class="wca-pick-sum">${esc(`${n} come${n === 1 ? 's' : ''} over · ${list.length - n} end${list.length - n === 1 ? 's' : ''}`)}</div>
            <div class="wca-actions">
                <button type="button" data-wca-pick="all">${n === list.length ? 'None' : 'All'}</button>
                <button type="button" data-wca-pick="go">Continue</button>
                <button type="button" data-wca-pick="cancel">Cancel</button>
            </div>`;
    }

    function sessionRow(x) {
        const busyNow = sxBusy.has(x.id);
        const note = sxNote[x.id];
        const link = x.link || (note && note.link) || '';
        const badges = [x.remoteControl ? '<span class="wca-badge wca-badge-rc">Remote Control</span>' : x.live ? '<span class="wca-badge">Running</span>' : '', x.status === 'busy' ? '<span class="wca-badge">Working</span>' : ''].filter(Boolean).join(' ');
        const buttons = [];
        if (link) buttons.push(`<button type="button" data-wca-sess="open" data-id="${esc(x.id)}">Open</button>`);
        if (!x.remoteControl && !(x.live && !x.canDisconnect)) buttons.push(`<button type="button" data-wca-sess="reconnect" data-id="${esc(x.id)}"${busyNow ? ' disabled' : ''}>${busyNow ? 'Starting...' : 'Reconnect'}</button>`);
        if (x.canDisconnect) buttons.push(`<button type="button" data-wca-sess="disconnect" data-id="${esc(x.id)}"${busyNow ? ' disabled' : ''}>Disconnect</button>`);
        return `<div class="wac-row wca-sess" data-id="${esc(x.id)}">
            <span class="wac-dot wac-dot-${x.remoteControl ? 'ok' : x.live ? 'warn' : 'off'}"></span>
            <div class="wac-main">
                <div class="wac-name">${esc(x.title)} ${badges}</div>
                ${x.lastPrompt ? `<div class="wac-line wca-last">“${esc(x.lastPrompt)}”</div>` : ''}
                <div class="wac-line wca-muted">${esc([x.folder, `${x.messages} message${x.messages === 1 ? '' : 's'}`, ago(x.lastPromptAt || x.lastActivity)].filter(Boolean).join(' · '))}</div>
                ${note && note.message ? `<div class="wac-line wca-sess-note${note.state === 'failed' ? ' is-bad' : ''}">${esc(note.message)}</div>` : ''}
                ${link ? `<div class="wac-line wca-sess-link"><a href="${esc(link)}" target="_blank" rel="noopener" data-wca-sess="open" data-id="${esc(x.id)}">${esc(link.replace(/^https:\/\//, ''))}</a></div>` : ''}
                ${buttons.length ? `<div class="wca-actions wca-sess-actions">${buttons.join('')}</div>` : ''}
            </div>
        </div>`;
    }

    function sessionsHtml() {
        if (!sx.loaded) return '<div class="wac-empty">Loading sessions...</div>';
        if (sx.error && !sx.sessions.length) return `<div class="wac-note">${esc(sx.error)}</div>`;
        if (!sx.sessions.length) return '<div class="wac-empty">No Claude sessions on the host.</div>';
        const live = sx.sessions.filter((x) => x.remoteControl).length;
        return `<div class="wm-form-hdr wca-sub-hdr">${esc(`${sx.total} session${sx.total === 1 ? '' : 's'} · ${live} in Remote Control`)}</div>
            ${sx.sessions.map(sessionRow).join('')}
            ${sx.error ? `<div class="wac-note">${esc(sx.error)}</div>` : ''}
            ${sx.total > sx.sessions.length ? `<div class="wca-actions"><button type="button" data-wca-sess="more">Show ${Math.min(30, sx.total - sx.sessions.length)} more</button></div>` : ''}`;
    }

    function listFooter() {
        if (LG_ACTIVE.has(lg.state)) {
            return `<div class="wac-note wca-add-pending">A sign-in for a new account is waiting (step ${esc(lg.stepNumber || 1)} of 2).</div>
                <div class="wca-actions"><button type="button" data-wca-add="open">Resume Sign-in</button><button type="button" data-wca-add="cancel">Cancel It</button></div>`;
        }
        return '<div class="wca-actions"><button type="button" data-wca-add="open">Add Account</button></div>';
    }

    function carryHtml(row) {
        const c = status && status.carry;
        if (!c || (!c.selected.length && !c.results.length)) return '';
        const lines = c.selected.map((x) => {
            const r = c.results.find((y) => y.id === x.id);
            const st = r ? (r.state === 'carried' ? 'Brought over' : r.state === 'started' ? 'Started' : `Failed: ${r.message || ''}`) : 'Waiting...';
            return row(x.title || x.id.slice(0, 8), st);
        }).join('');
        return `<div class="wm-form-hdr wca-sub-hdr">Last switch: brought over</div><div class="wca-kvs">${lines}${c.ending && c.ending.length ? row('Ended', c.ending.length) : ''}</div>`;
    }

    function fleetRow(f) {
        const where = f.moved ? '<span class="wca-badge wca-badge-rc">Own folder</span>' : f.onHost ? '<span class="wca-badge wca-badge-host">Host login</span>' : '';
        const n = (f.sessions || []).length;
        const lines = [`<div class="wac-line">${esc(FLEET_LABEL[f.state] || f.state)}${f.statusLine && f.state === 'connected' ? ` · ${esc(f.statusLine.replace(/^Connected\s*·?\s*/, ''))}` : ''}</div>`];
        lines.push(`<div class="wac-line wca-muted">${esc([n ? `${n} session${n === 1 ? '' : 's'}` : 'No sessions', f.capacity ? `of ${f.capacity}` : ''].filter(Boolean).join(' '))}</div>`);
        if (f.message && f.state !== 'connected') lines.push(`<div class="wac-line wca-muted">${esc(f.message)}</div>`);
        return `<div class="wac-row wca-fleet-row${fsel === f.index ? ' is-selected' : ''}" role="option" aria-selected="${fsel === f.index}" data-fleet="${f.index}">
            <span class="wac-dot wac-dot-${FLEET_DOT[f.state] || 'off'}"></span>
            <div class="wac-main">
                <div class="wac-name">${esc(f.name)} ${where}</div>
                ${lines.join('')}
            </div>
        </div>`;
    }

    function fleetHtml() {
        if (!fleet.accounts.length) return '';
        return `<div class="wm-form-hdr wca-sub-hdr">Remote Control per account</div>
            ${fleet.accounts.map(fleetRow).join('')}
            <div class="wac-note wca-muted">Tap an account, then Menu (or hold it): Move to Own Folder, Start, Stop, Reconnect.</div>`;
    }

    function hostHtml() {
        const h = data.host;
        if (!h) return '<div class="wac-empty">No host information.</div>';
        const rc = h.remoteControl || {};
        const pane = rc.pane || {};
        const row = (label, value) => `<div class="wca-kv"><span class="wca-k">${esc(label)}</span><span class="wca-v">${esc(value == null || value === '' ? '-' : value)}</span></div>`;
        const login = h.login;
        const eng = h.engine || {};
        const perm = h.permissions || null;
        return `<div class="wm-form-hdr wca-sub-hdr">${esc(h.hostname || 'Host')}</div>
            <div class="wca-kvs">
                ${row('Claude CLI', h.cliVersion || 'unknown')}
                ${row('Engine account', eng.account ? eng.account.name : 'none')}
                ${row('Engine token', eng.tokenFile ? 'In place' : 'Missing (old default used)')}
            </div>
            ${fleetHtml()}
            <div class="wm-form-hdr wca-sub-hdr">Remote Control on the host's login</div>
            ${fleet.hostMigrated ? '<div class="wac-note">The host\'s account runs in its own folder: this service is no longer used.</div>' : ''}
            <div class="wca-kvs">
                ${row('Service', rc.installed === false ? `${rc.unit || ''} not installed` : `${rc.active || 'unknown'}${rc.sub ? ` (${rc.sub})` : ''}`)}
                ${row('Session name', rc.sessionName)}
                ${row('Since', rc.since)}
                ${row('Restarts', rc.restarts)}
                ${row('Says', pane.statusLine || (pane.attached === false ? 'No tmux session' : ''))}
                ${row('Sessions', pane.sessions != null ? `${pane.sessions} of ${pane.capacity}` : '')}
                ${pane.errorLine && pane.state !== 'connected' ? row('Last error', pane.errorLine) : ''}
                ${row('Live sessions', liveRc().length ? liveRc().map((x) => x.title).join(', ') : 'none')}
            </div>
            ${carryHtml(row)}
            <div class="wm-form-hdr wca-sub-hdr">Permissions (shared by every account)</div>
            <div class="wca-kvs">
                ${perm ? `${row('Mode', perm.mode)}${row('Remote Control', perm.remoteControlMode ? `--permission-mode ${perm.remoteControlMode}` : 'settings')}${row('Allow rules', `${perm.allow}${perm.projectAllow ? ` + ${perm.projectAllow} in ${perm.project}` : ''}`)}${row('Deny / ask', `${perm.deny} / ${perm.ask}`)}${row('Trusted folders', perm.trustedFolders)}${row('Kept on switch', status.permissionsKept === false ? 'Changed during the last switch' : 'Yes: only the login changes')}` : row('Settings', 'Not readable')}
            </div>
            <div class="wm-form-hdr wca-sub-hdr">Signed in on the host</div>
            <div class="wca-kvs">
                ${login ? `${row('Account', login.email || login.displayName)}${row('Plan', planText(login))}${row('Organization', login.organization)}${row('Login renews', login.expiresAt ? when(new Date(login.expiresAt).toISOString()) : '')}${login.remoteControlCapable === false ? row('Remote Control', 'This login cannot run Remote Control') : ''}` : row('Account', 'Not signed in')}
            </div>
            <div class="wca-actions">
                <button type="button" data-wca="reconnect">Reconnect</button>
                ${rc.active === 'active' ? '<button type="button" data-wca="stop">Stop</button>' : '<button type="button" data-wca="start">Start</button>'}
            </div>`;
    }

    // ---------------------------------------------------------------- Queue tab (#1198)

    const QSTATE = { held: 'Waiting', queued: 'Queued', starting: 'Starting', running: 'Running', waiting: 'Sent Back', input: 'Input', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
    const QLONG = Object.assign({}, QSTATE, { input: 'Input Required', held: 'Waiting for you', queued: 'Pending' });
    const QDOT = { input: 'bad', running: 'ok', starting: 'ok', waiting: 'warn', held: 'warn', queued: 'off', done: 'ok', failed: 'bad', cancelled: 'off' };
    const QSOURCE = { fleet: 'Fleet', plaud: 'Plaud', director: 'Director', agent: 'Agent', yozora: 'Yozora' };
    const Q_LIVE = new Set(['starting', 'running', 'waiting', 'input']); // a request in these states has a session to talk to
    const qWork = () => (Array.isArray(qsnap.work) ? qsnap.work : []);
    const qLoose = () => (Array.isArray(qsnap.unsupervised) ? qsnap.unsupervised : []);
    const hasId = (v) => v != null && v !== '';
    const progOf = (o) => (o && o.parts && o.parts.total ? o.parts : (o && o.tasks && o.tasks.total ? o.tasks : null));
    const askedHold = (h) => (h && h.mode === 'freeze' ? 'Frozen' : 'Paused');

    /** The short state / "where it is" text on a row: "Running 3/7", "Sent Back", "Paused", "Working", "Idle". */
    function qStateText(it) {
        if (it.kind === 'live') {
            const d = it.d;
            const p = d.tasks && d.tasks.total ? ` ${d.tasks.done}/${d.tasks.total}` : '';
            return `${d.held ? askedHold(d.held) : d.status === 'busy' ? 'Working' : 'Idle'}${p}`;
        }
        const w = it.d;
        const p = progOf(w);
        const open = w.state === 'starting' || w.state === 'running' || w.state === 'waiting';
        const base = w.held ? askedHold(w.held) : qWorkLabel(w, Date.now());
        return `${base}${p && open ? ` ${p.done}/${p.total}` : ''}${w.sessionGone && !w.held ? ' - session gone' : ''}`;
    }
    // qage:begin (pure; scripts/test-fleet-work-rows.js runs this block) - the age is worked out when a row is drawn, never ticked
    /** "45 min", "2 h 10 min", "3 h", "2 d 4 h" for a span in ms; '' when there is no usable start. */
    function qAgeText(sinceMs, nowMs) {
        const t = Number(sinceMs);
        if (!Number.isFinite(t) || t <= 0) return '';
        const m = Math.max(0, Math.floor((nowMs - t) / 60000));
        if (m < 1) return 'under 1 min';
        if (m < 60) return `${m} min`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
        return `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`;
    }
    /** The state text of a work row: "Sent Back 2 h 10 min", "Needs a person 3 h", else the plain label. Absent fields change nothing. */
    function qWorkLabel(w, nowMs) {
        if (w.state === 'waiting' && w.sentBackAt) { const a = qAgeText(w.sentBackAt, nowMs); return a ? `Sent Back ${a}` : 'Sent Back'; }
        if (w.state === 'input' && w.parked) { const a = qAgeText(w.parkedAt, nowMs); return a ? `Needs a person ${a}` : 'Needs a person'; }
        return QSTATE[w.state] || w.state || '';
    }
    // qage:end
    const qDotOf = (it) => (it.kind === 'live' ? (it.d.held ? 'warn' : it.d.status === 'busy' ? 'ok' : 'off') : (it.d.held ? 'warn' : it.d.sessionGone ? 'bad' : QDOT[it.d.state] || 'off'));
    const qKey = (it) => `${it.kind === 'live' ? 'u' : 'w'}:${it.d.id}`;
    const qTitle = (it) => it.d.title || (it.kind === 'live' ? String(it.d.id).slice(0, 8) : `Request ${it.d.id}`);
    const qSid = (it) => (it.kind === 'live' ? String(it.d.id) : (it.d.sessionId || ''));
    const qCanReply = (it) => !!qSid(it) && (it.kind === 'live' || Q_LIVE.has(it.d.state));
    const ageMs = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? ago(new Date(Number(ms)).toISOString()) : '');
    function qItem(key) {
        const k = String(key || '');
        const id = k.slice(2);
        if (k.startsWith('w:')) { const d = qWork().find((w) => String(w.id) === id); return d ? { kind: 'work', d } : null; }
        if (k.startsWith('u:')) { const d = qLoose().find((u) => String(u.id) === id); return d ? { kind: 'live', d } : null; }
        return null;
    }

    function queueApply(changed, removed, whole) {
        if (whole) qsnap = qEmpty();
        Object.entries(changed || {}).forEach(([k, v]) => { if (k in qsnap) qsnap[k] = v; });
        (removed || []).forEach((k) => { if (k in qsnap) qsnap[k] = qEmpty()[k]; });
        qLoaded = true;
    }

    async function queueWatch(on) {
        if (on === qOn) return;
        qOn = on;
        const c = ws();
        if (!c || typeof c.sendMessage !== 'function') return;
        if (on) {
            try {
                const r = await c.sendMessage('status_subscribe', { feed: Q_FEED }, false);
                if (!qOn) return;
                if (r && (r.success === false || (r.error && !r.items))) throw new Error(r.error || r.message || 'The server refused');
                qGone = false;
                qErr = '';
                queueApply((r && (r.items || (r.data && r.data.items))) || {}, [], true);
            } catch (e) {
                if (!qOn) return;
                qLoaded = true;
                const m = errText(e);
                qGone = /unknown status feed|unknown message type|not.?found/i.test(m);
                qErr = qGone ? '' : m;
            }
            render();
        } else {
            try { await c.sendMessage('status_unsubscribe', { feed: Q_FEED }, false); } catch (_) { /* gone */ }
        }
    }

    /** Which feeds the page wants right now: the queue on the Queue tab, the plan usage on Accounts and the Dashboard. Screen off = none. */
    function syncWatch() {
        const seen = !!page && !page.hidden && awake();
        void queueWatch(seen && tab === 'queue');
        void usageWatch(seen && (tab === 'accounts' || (tab === 'queue' && qpage === 'dashboard')));
    }

    // ---- list

    /** The items of one section, each part right under its parent when both are in it: [item, isChild]. */
    function qOrdered(list) {
        const ids = new Set(list.map((w) => String(w.id)));
        const isKid = (w) => hasId(w.parentId) && ids.has(String(w.parentId));
        const kids = new Map();
        list.forEach((w) => { if (isKid(w)) { const k = String(w.parentId); if (!kids.has(k)) kids.set(k, []); kids.get(k).push(w); } });
        const out = [];
        list.forEach((w) => { if (isKid(w)) return; out.push([w, false]); (kids.get(String(w.id)) || []).forEach((c) => out.push([c, true])); });
        return out;
    }

    function qRow(it, child) {
        const d = it.d;
        const title = qTitle(it);
        const st = qStateText(it);
        const parent = it.kind === 'work' && hasId(d.parentId) ? qWork().find((w) => String(w.id) === String(d.parentId)) : null;
        const tip = [title, d.doing ? `Doing: ${d.doing}` : '', st, parent ? `Part of ${parent.title || parent.id}` : '', d.account ? `Account: ${d.account}` : '',
            it.kind === 'work' ? [d.engine, d.model, d.effort].filter(Boolean).join(' / ') : (d.folder || ''), d.message || ''].filter(Boolean).join(' - ');
        const warn = it.kind === 'work' && (d.state === 'input' || !!d.sessionGone);
        return `<div class="wca-q-row${child ? ' wca-q-child' : ''}" role="button" data-wca-q="open" data-key="${esc(qKey(it))}" title="${esc(tip)}"><span class="wac-dot wac-dot-${qDotOf(it)}"></span>`
            + `<span class="wca-q-title">${esc(title)}</span><span class="wca-q-state ${warn ? 'wac-lv-warn' : 'wca-muted'}">${esc(st)}</span></div>`;
    }

    function qSection(title, rows, extra) {
        return `<div class="wm-form-hdr wca-sub-hdr">${esc(title)} (${rows.length})</div>${extra || rows.map(([it, child]) => qRow(it, child)).join('')}`;
    }

    function qChip(n, label, tip, warn) {
        return `<span class="wca-chip${warn ? ' wca-chip-warn' : ''}" title="${esc(tip)}"><b class="wca-chip-n${warn ? ' wac-lv-warn' : ''}">${esc(n)}</b><span class="wca-chip-l">${esc(label)}</span></span>`;
    }
    function qCounts() {
        const c = qsnap.counts && typeof qsnap.counts === 'object' ? qsnap.counts : {};
        const w = qWork();
        const num = (k, fallback) => (Number.isFinite(Number(c[k])) ? Number(c[k]) : fallback);
        return {
            running: num('running', w.filter((x) => x.state === 'starting' || x.state === 'running' || x.state === 'waiting').length),
            input: num('input', w.filter((x) => x.state === 'input').length),
            held: num('held', w.filter((x) => x.state === 'held').length),
            pending: num('pending', w.filter((x) => x.state === 'queued').length),
            sentBack: num('sentBack', w.filter((x) => x.state === 'waiting').length),
            live: num('live', 0),
            busy: num('busy', 0),
            gaps: num('gaps', 0),
            flags: num('flags', 0),
            holds: num('holds', 0),
            restartWaits: num('restartWaits', 0)
        };
    }

    function qStrip() {
        const c = qCounts();
        const looseAll = qLoose(); // the chip counts what the Unsupervised section lists (the working ones in its tooltip)
        const loose = looseAll.length;
        const looseBusy = looseAll.filter((u) => u.status === 'busy').length;
        return `<div class="wca-chips" role="status">${qChip(c.running, 'Running', 'Work running now (starting, running, sent back)')}${qChip(c.input, 'Input', 'Work waiting for your answer', c.input > 0)}`
            + `${qChip(c.held, 'Waiting', 'Work waiting for you to start it')}${qChip(loose, 'Unsup.', `Unsupervised sessions: ${loose}, ${looseBusy} working now`)}${c.flags > 0 ? qChip(c.flags, 'Flags', 'Heavy usage flags', true) : ''}</div>`
            + '<div class="wca-q-row wca-q-link" role="button" data-wca-q="dashboard" title="Dashboard: usage, counts and Supervisor calls"><span class="wca-q-go">&gt;</span><span class="wca-q-title">Dashboard</span><span class="wca-q-state wca-muted">Usage, counts, calls</span></div>';
    }

    function listHtml() {
        if (qGone) return '<div class="wac-note">This server has no phone queue yet.</div>';
        if (qErr && !qLoaded) return `<div class="wac-note">${esc(qErr)}</div>`;
        if (!qLoaded) return '<div class="wac-empty">Reading the queue...</div>';
        const items = qWork().map((d) => ({ kind: 'work', d }));
        const by = (...states) => qOrdered(items.filter((it) => states.includes(it.d.state)).map((it) => it.d)).map(([d, child]) => [{ kind: 'work', d }, child]);
        const input = by('input');
        const active = by('starting', 'running', 'waiting');
        const held = by('held');
        const pending = by('queued');
        const loose = qLoose().map((d) => [{ kind: 'live', d }, false]);
        const done = by('done', 'failed', 'cancelled');
        const parts = [qStrip()];
        if (!items.length && !loose.length) {
            parts.push('<div class="wac-note">Nothing in the queue.</div>');
        } else {
            if (input.length) parts.push(qSection('Input Required', input));
            parts.push(qSection('Active', active, active.length ? '' : '<div class="wac-note">Nothing is running.</div>'));
            // live sessions next to the running work: they are what can be answered now
            if (loose.length) parts.push(qSection('Unsupervised', loose));
            const fold = (act, open, label) => `<div class="wca-q-row wca-q-link" role="button" data-wca-q="${act}" title="${esc(label)}"><span class="wca-q-go">${open ? '-' : '+'}</span><span class="wca-q-title">${esc(label)}</span></div>`;
            if (held.length) {
                const cut = !qAllHeld && held.length > Q_HELD_SHOWN;
                const shown = cut ? held.slice(0, Q_HELD_SHOWN) : held;
                const more = held.length > Q_HELD_SHOWN ? fold('allheld', qAllHeld, qAllHeld ? 'Show fewer' : `Show all ${held.length} waiting`) : '';
                parts.push(qSection('Waiting', held, shown.map(([it, child]) => qRow(it, child)).join('') + more));
            }
            if (pending.length) parts.push(qSection('Pending', pending));
            if (done.length) {
                const foldDone = (label) => `<div class="wca-q-row wca-q-link" role="button" data-wca-q="finished" title="${esc(label)}"><span class="wca-q-go">${qFin ? '-' : '+'}</span><span class="wca-q-title">${esc(label)}</span></div>`;
                parts.push(qSection('Finished today', done, qFin ? done.map(([it, child]) => qRow(it, child)).join('') + foldDone('Hide finished') : foldDone(`Show ${done.length} finished`)));
            }
        }
        if (qErr) parts.push(`<div class="wac-note">${esc(qErr)}</div>`);
        return parts.join('');
    }

    // ---- detail

    const kvRow = (label, html) => (html == null || html === '' ? '' : `<div class="wca-kv"><span class="wca-k">${esc(label)}</span><span class="wca-v">${html}</span></div>`);
    const textBlock = (text) => `<div class="wca-d-text">${esc(text)}</div>`;

    function qMessagesHtml() {
        let body;
        if (qtr.state === 'error') body = `<div class="wac-note">${esc(qtr.error || 'Could not read the messages')}</div>`;
        else if (qtr.state === 'loading' && !qtr.messages.length) body = '<div class="wac-note">Reading messages...</div>';
        else if (!qtr.messages.length) body = '<div class="wac-note">No messages yet.</div>';
        else {
            body = qtr.messages.map((m) => {
                const text = String(m.text || '');
                const t = typeof m.time === 'number' ? ageMs(m.time) : ago(m.time);
                return `<div class="wca-msg wca-msg-${m.role === 'user' ? 'user' : 'assistant'}"><div class="wca-msg-who wca-muted">${esc(m.role === 'user' ? 'You' : 'Claude')}${t ? ` - ${esc(t)}` : ''}</div>`
                    + `<div class="wca-msg-text">${esc(text.length > 1200 ? `${text.slice(0, 1200)}...` : text)}</div></div>`;
            }).join('');
        }
        return `<div class="wm-form-hdr wca-sub-hdr">Last messages</div>${body}`;
    }

    function detailHtml() {
        const it = qItem(qsel);
        if (!it) return '<div class="wm-form-hdr wca-sub-hdr">Queue item</div><div class="wac-note">This item is no longer in the queue.</div>';
        const d = it.d;
        const out = [];
        const sid = qSid(it);
        out.push(`<div class="wm-form-hdr wca-sub-hdr">${esc(it.kind === 'live' ? (d.held ? askedHold(d.held) : d.status === 'busy' ? 'Working' : 'Idle') : (d.state === 'input' && d.parked ? 'Needs a person' : QLONG[d.state] || d.state || 'Request'))}</div>`);
        out.push(`<div class="wca-d-title">${esc(qTitle(it))}</div>`);
        const rows = [];
        const parent = it.kind === 'work' && hasId(d.parentId) ? qWork().find((w) => String(w.id) === String(d.parentId)) : null;
        rows.push(kvRow('State', esc(qStateText(it))));
        if (it.kind === 'work' && d.sessionGone) out.push(noticeLine({ level: 'bad', text: 'Its session is gone: nothing is working on this item.' }, ''));
        if (d.held) {
            // a collision reason names both sessions and every file: the gist here, the whole text in the tooltip
            const why = String(d.held.reason || 'Paused');
            rows.push(kvRow(askedHold(d.held), why.length > 100 ? `<span title="${esc(why)}">${esc(`${why.slice(0, 99)}...`)}</span>` : esc(why)));
        }
        rows.push(kvRow('Doing', d.doing ? esc(d.doing) : ''));
        if (d.tasks && d.tasks.total) rows.push(kvRow('Tasks', `${esc(d.tasks.done)} of ${esc(d.tasks.total)} done`));
        if (it.kind === 'work') {
            if (d.parts && d.parts.total) rows.push(kvRow('Parts', `${esc(d.parts.done)} of ${esc(d.parts.total)} done`));
            if (parent) rows.push(kvRow('Part of', esc(parent.title || parent.id)));
            rows.push(kvRow('From', esc(QSOURCE[d.source] || d.source || '')));
            rows.push(kvRow('Account', esc(d.account || '')));
            rows.push(kvRow('Model', esc([d.engine, d.model, d.effort].filter(Boolean).join(' / '))));
            if (d.issue) rows.push(kvRow('Issue', /^https?:\/\//.test(d.issueUrl || '') ? `<span class="wac-link" data-wca-q="issue" data-url="${esc(d.issueUrl)}">${esc(d.issue)}</span>` : esc(d.issue)));
            rows.push(kvRow('Queued', esc(ageMs(d.createdAt))));
            rows.push(kvRow('Started', esc(ageMs(d.startedAt))));
            rows.push(kvRow('Ended', esc(ageMs(d.endedAt))));
        } else {
            rows.push(kvRow('Folder', esc(d.folder || '')));
            rows.push(kvRow('Account', esc(d.account || '')));
            rows.push(kvRow('Started', esc(ageMs(d.startedAt))));
        }
        if (sid) rows.push(kvRow('Session', esc(sid.slice(0, 8))));
        out.push(`<div class="wca-kvs">${rows.join('')}</div>`);
        if (it.kind === 'work' && d.message) out.push(`<div class="wm-form-hdr wca-sub-hdr">Supervisor</div>${textBlock(d.message)}`);
        if (it.kind === 'work' && d.state === 'input') {
            const qs = Array.isArray(d.questions) ? d.questions : [];
            const asked = qs.some((q) => q.ask);
            out.push(`<div class="wm-form-hdr wca-sub-hdr">Questions (${qs.length})</div>`);
            qs.forEach((q, i) => {
                out.push(`<div class="wca-qq"><div class="wca-d-text"><b>${esc(q.question)}</b></div>`
                    + `${q.answer ? `<div class="wca-d-text wca-muted">Supervisor's proposed answer: ${esc(q.answer)}${q.why ? ` (${esc(q.why)})` : ''}</div>` : (q.ask ? `<div class="wca-d-text wca-muted">${esc(q.why || 'Open as a request form: answer it there')}</div>` : `<div class="wca-d-text wca-muted">Only you can decide this.${q.why ? ` ${esc(q.why)}` : ''}</div>`)}`
                    + `${q.ask ? '' : `<textarea class="wca-input wca-draft" rows="2" spellcheck="true" data-draft="a:${esc(d.id)}:${i}" placeholder="${q.answer ? 'Leave empty to send the proposed answer' : 'Your answer'}" aria-label="Your answer to question ${i + 1}"></textarea>`}</div>`);
            });
            if (!qs.length) out.push('<div class="wac-note">It has no open questions.</div>');
            out.push(`<div class="wca-actions"><button type="button" data-wca-q="answer"${asked || !qs.length ? ' disabled' : ''}>Send Answers</button></div>`);
        }
        if (qCanReply(it)) {
            out.push(`<div class="wm-form-hdr wca-sub-hdr">Reply to the session</div><div class="wca-reply"><textarea class="wca-input wca-draft" rows="2" spellcheck="true" data-draft="r:${esc(sid)}" placeholder="Message to this session" aria-label="Message to this session"></textarea></div>`
                + '<div class="wca-actions"><button type="button" data-wca-q="reply">Send</button></div>');
        }
        if (sid) out.push(qMessagesHtml());
        return out.join('');
    }

    // ---- dashboard

    /** What may reach the phone (the Supervisor's settings.notify); a kind the server adds that is not listed shows under its own name. */
    const NOTIFY_KINDS = [
        ['workDone', 'A work item I started is done'],
        ['workAttention', 'A work item needs me (a question for me, or it stopped)'],
        ['maintenance', 'Fleet maintenance reports (daily checks and cleanup)'],
        ['usage', 'Usage and cost flags']
    ];
    function notifyHtml() {
        const n = qsnap.notify && typeof qsnap.notify === 'object' ? qsnap.notify : {};
        const kinds = NOTIFY_KINDS.concat(Object.keys(n).filter((k) => !NOTIFY_KINDS.some((x) => x[0] === k)).map((k) => [k, k]));
        return '<div class="wm-form-hdr wca-sub-hdr">Notifications</div><div class="wca-nts">'
            + kinds.map(([k, t]) => `<label class="wm-check wca-nt"><input type="checkbox" class="wca-ntc" data-notify="${esc(k)}"${n[k] === true ? ' checked' : ''}><span>${esc(t)}</span></label>`).join('')
            + '</div><div class="wca-muted wca-nt-hint">Off by default for anything new; routine alerts always go to the Supervisor.</div>';
    }

    /** A tap on a Notifications switch saves that one kind at once (a partial save); the page repaints in place, scroll kept. */
    async function notifySave(key, on) {
        const prev = qsnap.notify && qsnap.notify[key] === true;
        qsnap.notify = Object.assign({}, qsnap.notify, { [key]: on });
        try {
            await send('claude_desk_supervisor', { action: 'save', settings: { notify: { [key]: on } } });
        } catch (e) {
            qsnap.notify = Object.assign({}, qsnap.notify, { [key]: prev });
            await failBox(errText(e));
        }
        render();
    }

    function dashHtml() {
        if (qGone) return '<div class="wac-note">This server has no phone queue yet.</div>';
        if (!qLoaded) return qErr ? `<div class="wac-note">${esc(qErr)}</div>` : '<div class="wac-empty">Reading the queue...</div>';
        const c = qCounts();
        const row = (label, value, tone) => `<div class="wca-kv"><span class="wca-k" title="${esc(label)}">${esc(label)}</span><span class="wca-v${tone ? ` wac-lv-${tone}` : ''}">${esc(value)}</span></div>`;
        const loose = qLoose();
        const calls = qsnap.calls && typeof qsnap.calls === 'object' ? qsnap.calls : {};
        const callRow = (label, k) => {
            const r = calls[k];
            if (!r) return '';
            const cost = Number(r.cost) || 0;
            return row(label, `${Number(r.calls) || 0} call${Number(r.calls) === 1 ? '' : 's'}, $${cost.toFixed(2)}`);
        };
        const callRows = [callRow('Today', 'today'), callRow('7 days', 'week'), callRow('30 days', 'month')].join('');
        const now = Date.now();
        const accRows = data.accounts.map((a) => {
            const fa = fleetAcc(a.index);
            const u = usageOf(a);
            const limits = u && Array.isArray(u.limits) ? u.limits.filter((l) => l && l.percent != null).sort((x, y) => usageRank(x) - usageRank(y)) : [];
            let text;
            let tone = '';
            if (!limits.length) text = !u ? (usageLoaded ? 'No usage' : 'Reading...') : (u.needsLogin ? 'No login linked' : 'Unavailable');
            else {
                text = limits.map((l) => {
                    const stale = l.resetsAt && l.resetsAt <= now;
                    const name = l.kind === 'session' || l.kind === 'five_hour' ? 'Session' : (l.kind === 'weekly_all' || l.kind === 'seven_day' ? 'Week' : (l.short || l.label || l.kind));
                    return `${name} ${stale ? 'reset' : `${Math.max(0, Math.round(Number(l.percent) || 0))}%`}`;
                }).join(' - ');
                const lv = limits.map(usageLevel);
                tone = lv.includes('bad') ? 'bad' : lv.includes('warn') ? 'warn' : '';
            }
            const tip = `${(fa && fa.name) || a.name}: ${text}${limits.filter((l) => l.resetsAt && l.resetsAt > now).map((l) => ` - ${l.label || l.kind} resets ${resetText(l.resetsAt)}`).join('')}`;
            return `<div class="wca-kv wca-kv-use" title="${esc(tip)}"><span class="wca-k">${esc((fa && fa.name) || a.name)}</span><span class="wca-v wca-cut${tone ? ` wac-lv-${tone}` : ''}">${esc(text)}</span></div>`;
        }).join('');
        const flags = Array.isArray(qsnap.flags) ? qsnap.flags : [];
        return `<div class="wca-dash">${notifyHtml()}<div class="wm-form-hdr wca-sub-hdr">Counts</div><div class="wca-kvs">`
            + `${row('Running work', c.running)}${row('Input required', c.input, c.input > 0 ? 'warn' : '')}${row('Waiting for you', c.held)}${row('Queued', c.pending)}${row('Sent back', c.sentBack)}`
            + `${row('Sessions running', c.live)}${row('Sessions working', c.busy)}${row('Unsupervised', loose.length)}${row('Reviews with gaps', c.gaps, c.gaps > 0 ? 'warn' : '')}${row('Paused', c.holds)}${row('Restart waits', c.restartWaits)}${row('Heavy usage flags', c.flags, c.flags > 0 ? 'warn' : '')}`
            + `</div><div class="wm-form-hdr wca-sub-hdr">Supervisor calls</div><div class="wca-kvs">${callRows || '<div class="wca-muted">No call figures yet.</div>'}</div>`
            + `<div class="wm-form-hdr wca-sub-hdr">Plan usage</div><div class="wca-kvs">${accRows || `<div class="wca-muted">${loaded ? 'No Claude accounts.' : 'Reading usage...'}</div>`}</div>`
            + (flags.length ? `<div class="wm-form-hdr wca-sub-hdr">Usage flags (${flags.length})</div>${flags.map((f) => `<div class="wca-q-row" title="${esc([f.title, f.reason, f.text].filter(Boolean).join(' - '))}"><span class="wac-dot wac-dot-warn"></span><span class="wca-q-title">${esc(f.title || f.sessionId || 'Session')}</span><span class="wca-q-state wca-muted">${esc(f.reason || '')}</span></div>`).join('')}` : '')
            + '</div>';
    }

    // ---- rendering and pages

    const draftField = (key) => (page ? Array.from(page.querySelectorAll('[data-draft]')).find((el) => el.dataset.draft === key) || null : null);

    /** Draws the Queue panel: only when its markup changed; typed fields keep their text and focus, the scroll position stays. */
    function queueRender(panel) {
        const html = qpage === 'dashboard' ? dashHtml() : qpage === 'detail' ? detailHtml() : listHtml();
        if (panel.dataset.h === html) return;
        const sc = page.querySelector('.wac-scroll');
        const top = sc ? sc.scrollTop : 0;
        const act = document.activeElement;
        const focus = act && panel.contains(act) && act.dataset ? { key: act.dataset.draft || '', at: act.selectionStart } : null;
        panel.innerHTML = html;
        panel.dataset.h = html;
        panel.querySelectorAll('[data-draft]').forEach((el) => { const v = qdraft[el.dataset.draft]; if (v) el.value = v; });
        if (focus && focus.key) {
            const f = draftField(focus.key);
            if (f) { f.focus(); try { f.setSelectionRange(focus.at, focus.at); } catch (_) { /* no selection */ } }
        }
        if (sc) sc.scrollTop = top;
    }

    /** Go to a page of the Queue tab (list | detail | dashboard); the list keeps its scroll position for the way back. */
    function qGo(next, key) {
        const sc = page && page.querySelector('.wac-scroll');
        if (qpage === 'list' && next !== 'list' && sc) qScroll = sc.scrollTop;
        qpage = next;
        if (key !== undefined) qsel = key;
        if (next === 'detail') {
            const it = qItem(qsel);
            const sid = it ? qSid(it) : '';
            qtr = { sid, messages: [], state: sid ? 'loading' : 'idle', error: '' };
            if (sid) void loadTranscript(sid);
        }
        render();
        if (sc) sc.scrollTop = next === 'list' ? qScroll : 0; // a new page starts at the top; Back returns where the list was
        syncWatch();
        sh.refreshTitleAction();
    }
    const qSub = () => tab === 'queue' && qpage !== 'list';

    async function loadTranscript(sid) {
        if (!sid) return;
        if (qtr.sid !== sid) qtr = { sid, messages: [], state: 'loading', error: '' };
        try {
            const r = await send('claude_desk_transcript', { id: sid, limit: 8, show: { thinking: false, edits: false, tools: false, results: false } });
            const d = r && (Array.isArray(r.messages) ? r : (r.data && Array.isArray(r.data.messages) ? r.data : null));
            if (qtr.sid !== sid) return;
            qtr.messages = (d ? d.messages : []).filter((m) => m && m.kind === 'text' && (m.role === 'assistant' || m.role === 'user') && !m.sidechain).slice(-8);
            qtr.state = 'ready';
            qtr.error = '';
        } catch (e) {
            if (qtr.sid !== sid) return;
            qtr.state = 'error';
            qtr.error = errText(e);
        }
        render();
    }

    // ---- actions

    const failBox = (text, icon) => sh.messageBox({ title: 'Fleet', icon: icon || 'error', text });

    async function answerItem(it) {
        if (!it || it.kind !== 'work') return;
        const w = it.d;
        const qs = Array.isArray(w.questions) ? w.questions : [];
        if (!qs.length) { await failBox('It has no open questions.', 'warning'); return; }
        if (qs.some((q) => q.ask)) { await failBox('A question is open as a request form: answer it there.', 'warning'); return; }
        // an empty answer sends the Supervisor's proposed one (answerWork)
        const answers = qs.map((q, i) => String(qdraft[`a:${w.id}:${i}`] || '').trim());
        try {
            await sh.busy(() => send('claude_desk_supervisor', { action: 'work_answer', id: w.id, answers }), { paint: true });
            qs.forEach((q, i) => { delete qdraft[`a:${w.id}:${i}`]; });
            qGo('list');
        } catch (e) { await failBox(errText(e)); }
    }

    async function replyItem(it) {
        const sid = it ? qSid(it) : '';
        if (!sid) return;
        const key = `r:${sid}`;
        const text = String(qdraft[key] || '').trim();
        if (!text) { const f = draftField(key); if (f) f.focus(); return; }
        try {
            await sh.busy(() => send('claude_desk_session', { action: 'steer', id: sid, text }), { paint: true });
            delete qdraft[key];
            const f = draftField(key);
            if (f) f.value = '';
            void loadTranscript(sid);
        } catch (e) { await failBox(errText(e)); }
    }

    async function startItem(it) {
        if (!it || it.kind !== 'work') return;
        try {
            const d = await sh.busy(() => send('claude_desk_supervisor', { action: 'work_start', ids: [it.d.id] }), { paint: true });
            if (d && Array.isArray(d.errors) && d.errors.length) { await failBox(d.errors.join('\n'), 'warning'); return; }
            if (qpage === 'detail') qGo('list');
        } catch (e) { await failBox(errText(e)); }
    }

    async function cancelItem(it) {
        if (!it || it.kind !== 'work') return;
        const v = await sh.messageBox({ title: 'Cancel Request', icon: 'warning', text: `Cancel "${qTitle(it)}"? It is not run.`, buttons: [{ text: 'Cancel Request', value: true }, { text: 'Keep', value: false, default: true }] });
        if (v !== true) return;
        try {
            await sh.busy(() => send('claude_desk_supervisor', { action: 'work_cancel', id: it.d.id }), { paint: true });
            if (qpage === 'detail') qGo('list');
        } catch (e) { await failBox(errText(e)); }
    }

    async function interruptItem(it) {
        const sid = it ? qSid(it) : '';
        if (!sid) return;
        try { await sh.busy(() => send('claude_desk_session', { action: 'interrupt', id: sid }), { paint: true }); } catch (e) { await failBox(errText(e)); }
    }

    async function holdItem(it) {
        const sid = it ? qSid(it) : '';
        if (!sid) return;
        const resume = !!it.d.held;
        try {
            await sh.busy(() => send('claude_desk_supervisor', resume ? { action: 'resume', sessionId: sid } : { action: 'pause', sessionId: sid, reason: 'Paused from the phone' }), { paint: true });
        } catch (e) { await failBox(errText(e)); }
    }

    /** What an item offers (its page's Menu, and the hold menu on its row). The answers and the reply box exist on its page only. */
    function qItemMenu(it, onPage) {
        if (!it) return [];
        const items = [];
        if (it.kind === 'work') {
            if (onPage && it.d.state === 'input') items.push({ label: 'Send Answers', action: () => answerItem(it) });
            if (it.d.state === 'held') items.push({ label: 'Start', action: () => startItem(it) });
            if (it.d.state === 'held' || it.d.state === 'queued') items.push({ label: 'Cancel Request...', action: () => cancelItem(it) });
        }
        if (qCanReply(it)) {
            if (onPage) items.push({ label: 'Send Message', action: () => replyItem(it) });
            items.push({ label: 'Stop Current Turn', action: () => interruptItem(it) });
            items.push({ label: it.d.held ? 'Resume' : 'Pause', action: () => holdItem(it) });
        }
        return items;
    }

    function queueRefresh() {
        const sid = qpage === 'detail' ? qSid(qItem(qsel) || { kind: 'work', d: {} }) : '';
        qOn = false; // the feed is joined again for a fresh snapshot
        return sh.busy(async () => { await queueWatch(true); if (sid) await loadTranscript(sid); }, { paint: true });
    }

    function queueMenu() {
        const items = [];
        if (qpage === 'detail') {
            const it = qItem(qsel);
            const mine = qItemMenu(it, true);
            if (mine.length) items.push(...mine, '-');
            if (it && qSid(it)) items.push({ label: 'Refresh Messages', action: () => loadTranscript(qSid(it)) });
            items.push({ label: 'Back to Queue', action: () => qGo('list') });
        } else if (qpage === 'dashboard') {
            items.push({ label: 'Back to Queue', action: () => qGo('list') });
        } else {
            items.push({ label: 'Dashboard', action: () => qGo('dashboard') });
        }
        items.push({ label: 'Refresh', action: queueRefresh });
        return items;
    }

    function queueSoftKeys() {
        const menu = { label: 'Menu', menu: menuItems };
        if (qpage === 'dashboard') return { left: { label: 'Queue', action: () => qGo('list') }, right: menu };
        if (qpage === 'detail') {
            const it = qItem(qsel);
            if (it && it.kind === 'work' && it.d.state === 'input') return { left: { label: 'Send', action: () => answerItem(it) }, right: menu };
            if (it && it.kind === 'work' && it.d.state === 'held') return { left: { label: 'Start', action: () => startItem(it) }, right: menu };
            if (it && qCanReply(it)) return { left: { label: 'Send', action: () => replyItem(it) }, right: menu };
            return { left: { label: 'Queue', action: () => qGo('list') }, right: menu };
        }
        return { left: { label: 'Dashboard', action: () => qGo('dashboard') }, right: menu };
    }

    function queueClick(el) {
        const a = el.dataset.wcaQ;
        if (a === 'open') qGo('detail', el.dataset.key);
        else if (a === 'dashboard') qGo('dashboard');
        else if (a === 'finished') { qFin = !qFin; render(); } else if (a === 'allheld') { qAllHeld = !qAllHeld; render(); } else if (a === 'issue') openLink(el.dataset.url);
        else if (a === 'answer') void answerItem(qItem(qsel));
        else if (a === 'reply') void replyItem(qItem(qsel));
    }

    // the last markup is kept on the element: the usage bars' widths are set on the nodes afterwards, so innerHTML never matches
    function setHtml(el, html) { if (el && el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } }
    // the Add page's fields keep what is typed (and focus) across pushes
    function setHtmlKeep(el, html) {
        if (!el || el.dataset.h === html) return;
        const kept = {};
        el.querySelectorAll('input.wca-input').forEach((i) => { kept[i.id] = i.value; });
        const focused = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : '';
        el.innerHTML = html;
        el.dataset.h = html;
        Object.keys(kept).forEach((id) => { const i = el.querySelector(`#${id}`); if (i && !i.disabled && kept[id]) i.value = kept[id]; });
        if (focused) { const f = el.querySelector(`#${focused}`); if (f && !f.disabled) f.focus(); }
    }

    function render() {
        if (!page || page.hidden) return;
        // the queue is the first thing on screen: the Remote Control strip shows over it only when it is in error
        setHtml(page.querySelector('.wca-status-slot'), tab === 'queue' && status.state !== 'error' ? '' : statusStrip());
        const queuePanel = page.querySelector('.wca-panel-queue');
        const accountsPanel = page.querySelector('.wca-panel-accounts');
        const hostPanel = page.querySelector('.wca-panel-host');
        const sessionsPanel = page.querySelector('.wca-panel-sessions');
        queuePanel.hidden = tab !== 'queue';
        accountsPanel.hidden = tab !== 'accounts';
        hostPanel.hidden = tab !== 'host';
        sessionsPanel.hidden = tab !== 'sessions';
        if (tab === 'queue') queueRender(queuePanel);
        if (tab === 'accounts') { // a panel not shown is drawn when its tab opens (render() runs on every push)
            let list;
            if (error && !loaded) list = `<div class="wac-note">${esc(error)}</div>`;
            else if (!loaded) list = '<div class="wac-empty">Loading...</div>';
            else if (!data.accounts.length) list = `<div class="wac-empty">No Claude accounts yet.</div>${listFooter()}`;
            else list = noticesHtml() + data.accounts.map(accountRow).join('') + (error ? `<div class="wac-note">${esc(error)}</div>` : '') + listFooter();
            if (picking) setHtml(accountsPanel, pickHtml());
            else if (editing) { if (!editing.built) buildSettings(accountsPanel); }
            else if (adding) setHtmlKeep(accountsPanel, addHtml());
            else setHtml(accountsPanel, list);
            if (!picking && !adding && !editing && accountsPanel.querySelector('i[data-w]:not([style]), b[data-pace]:not([style])')) paintBars(accountsPanel);
        }
        if (tab === 'host') setHtml(hostPanel, hostHtml());
        if (tab === 'sessions') setHtml(sessionsPanel, sessionsHtml());
        page.querySelectorAll('.wm-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
        sh.refreshSoftKeys();
    }

    function setTab(next) {
        // the active Queue tab tapped again comes back to the list
        if (next === 'queue' && tab === 'queue' && qpage !== 'list') { qGo('list'); return; }
        tab = next === 'host' || next === 'sessions' || next === 'queue' ? next : 'accounts';
        if (tab === 'sessions') void loadSessions();
        const sc = page && page.querySelector('.wac-scroll');
        if (sc) sc.scrollTop = tab === 'queue' && qpage === 'list' ? qScroll : 0;
        render();
        syncWatch();
        sh.refreshTitleAction();
    }

    function select(index) {
        sel = index;
        page.querySelectorAll('.wca-panel-accounts .wac-row').forEach((r) => {
            const on = Number(r.dataset.index) === index;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        sh.refreshSoftKeys();
    }

    function selectFleet(index) {
        fsel = index;
        page.querySelectorAll('.wca-fleet-row').forEach((r) => {
            const on = Number(r.dataset.fleet) === index;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        sh.refreshSoftKeys();
    }

    function accountItems(acc) {
        if (!acc) return [];
        return [
            { label: acc.active ? 'Reconnect' : directorOnly(acc) ? 'Use for the Director' : 'Switch', action: () => switchTo(acc) },
            '-',
            { label: 'Link Host Login', action: () => link(acc) },
            { label: 'Unlink Login', disabled: !acc.remoteLogin, action: () => unlink(acc) },
            '-',
            { label: 'Settings...', action: () => openSettings(acc) },
            { label: 'Rename...', action: () => rename(acc) },
            { label: 'Delete', action: () => remove(acc) }
        ];
    }

    function menuItems() {
        const items = [
            { label: 'Queue', checked: tab === 'queue', action: () => setTab('queue') },
            { label: 'Accounts', checked: tab === 'accounts', action: () => setTab('accounts') },
            { label: 'Sessions', checked: tab === 'sessions', action: () => setTab('sessions') },
            { label: 'Host', checked: tab === 'host', action: () => setTab('host') },
            '-'
        ];
        if (tab === 'queue') { items.push(...queueMenu()); return items; }
        if (tab === 'accounts' && adding) {
            items.push({ label: 'Copy Link', disabled: !lg.url, action: () => copyLink() });
            items.push({ label: 'Open in Alchemy', disabled: !lg.url, action: openInAlchemy });
            items.push('-');
            if (LG_ACTIVE.has(lg.state)) items.push({ label: 'Cancel Sign-in', action: cancelAdd });
            if (lg.state === 'error') items.push({ label: 'Try Again', action: () => loginAct('retry') });
            items.push({ label: 'Back to Accounts', action: () => { adding = false; render(); } });
            return items;
        }
        if (tab === 'accounts' && editing) {
            items.push({ label: 'Done', action: saveSettings }, { label: 'Cancel', action: closeSettings });
            return items;
        }
        if (tab === 'accounts' && picking) {
            items.push({ label: 'Continue', action: pickDone }, { label: 'Cancel', action: pickCancel });
            return items;
        }
        if (tab === 'sessions') {
            items.push({ label: 'Refresh', action: () => loadSessions() });
            return items;
        }
        if (tab === 'accounts') {
            const acc = selected();
            if (acc) items.push(...accountItems(acc), '-');
            items.push({ label: LG_ACTIVE.has(lg.state) ? 'Resume Sign-in...' : 'Add Account...', action: startAdd });
            items.push({ label: 'Add with Token...', action: addAccount });
        } else {
            const rc = data.host && data.host.remoteControl;
            const fa = fleetAcc(fsel);
            if (fa) { const fi = fleetItems(fa); if (fi.length) items.push({ label: fa.name, disabled: true }, ...fi, '-'); }
            // the host login's own service (claude-remote.service), named so it is not mistaken for an account's
            if (!fleet.hostMigrated) {
                items.push({ label: 'Reconnect Host Login', action: () => remote('reconnect') });
                items.push(rc && rc.active === 'active' ? { label: 'Stop Host Login', action: () => remote('stop') } : { label: 'Start Host Login', action: () => remote('start') });
            }
        }
        items.push('-', { label: 'Refresh', action: userRefresh });
        return items;
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-accounts', 'wm-claude-accounts');
        p.innerHTML = `
            <div class="wm-form-hdr">Fleet</div>
            <div class="wca-status-slot"></div>
            <div class="wac-scroll wm-set-scroll" role="listbox" aria-label="Fleet">
                <div class="wac-panel wca-panel-queue"></div>
                <div class="wac-panel wca-panel-accounts" hidden></div>
                <div class="wac-panel wca-panel-sessions" hidden></div>
                <div class="wac-panel wca-panel-host" hidden></div>
            </div>
            <div class="wm-tabs" role="tablist">
                <button type="button" class="wm-tab" role="tab" data-tab="queue">Queue</button>
                <button type="button" class="wm-tab" role="tab" data-tab="accounts">Accounts</button>
                <button type="button" class="wm-tab" role="tab" data-tab="sessions">Sessions</button>
                <button type="button" class="wm-tab" role="tab" data-tab="host">Host</button>
            </div>`;
        p.querySelector('.wm-tabs').addEventListener('click', (e) => {
            const t = e.target.closest('.wm-tab');
            if (t) setTab(t.dataset.tab);
        });
        p.addEventListener('click', (e) => {
            const qa = e.target.closest('[data-wca-q]');
            if (qa) { if (!held && !qa.disabled) queueClick(qa); return; }
            const pk = e.target.closest('[data-wca-pick]');
            if (pk && picking) {
                const list = liveRc();
                if (pk.dataset.wcaPick === 'go') void pickDone();
                else if (pk.dataset.wcaPick === 'cancel') pickCancel();
                else if (pk.dataset.wcaPick === 'all') { picking.picks = picking.picks.size === list.length ? new Set() : new Set(list.filter((x) => x.resumable).map((x) => x.id)); render(); }
                return;
            }
            const ss = e.target.closest('[data-wca-sess]');
            if (ss) {
                e.preventDefault();
                if (ss.dataset.wcaSess === 'more') { sx.limit += 30; void loadSessions(); return; }
                if (!ss.disabled) void sessionAct(ss.dataset.wcaSess, ss.dataset.id);
                return;
            }
            const add = e.target.closest('[data-wca-add]');
            if (add) { if (!add.disabled) void addClick(add.dataset.wcaAdd, add); return; }
            if (e.target.closest('.wca-link-field')) { e.target.select(); return; }
            const b = e.target.closest('[data-wca]');
            if (b) { void remote(b.dataset.wca); return; }
            const frow = e.target.closest('.wca-fleet-row');
            if (frow && !held) { selectFleet(Number(frow.dataset.fleet)); return; }
            const row = e.target.closest('.wca-panel-accounts .wac-row');
            if (row && !held && !picking) select(Number(row.dataset.index));
        });
        p.addEventListener('input', (e) => {
            const t = e.target.closest ? e.target.closest('[data-draft]') : null;
            if (t) qdraft[t.dataset.draft] = t.value;
        });
        p.addEventListener('change', (e) => {
            const nt = e.target.closest ? e.target.closest('.wca-ntc') : null;
            if (nt) { void notifySave(nt.dataset.notify, nt.checked); return; }
            const c = e.target.closest('.wca-check');
            if (!c || !picking) return;
            if (c.checked) picking.picks.add(c.dataset.pick); else picking.picks.delete(c.dataset.pick);
            render();
        });
        const list = p.querySelector('.wac-scroll');
        let holdTimer = null;
        let held = false;
        list.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.wca-panel-queue')) {
                held = false;
                clearTimeout(holdTimer);
                const qrow = e.target.closest('.wca-q-row[data-key]');
                if (!qrow) return;
                const { clientX: qx, clientY: qy } = e;
                holdTimer = setTimeout(() => {
                    const it = qItem(qrow.dataset.key);
                    if (!it) return;
                    held = true;
                    sh.menuAt(qx, qy, [{ label: 'Open', action: () => qGo('detail', qrow.dataset.key) }, ...(qItemMenu(it, false).length ? ['-', ...qItemMenu(it, false)] : [])]);
                }, ((window.wmShell && window.wmShell.holdMs) || 600));
                return;
            }
            const frow = e.target.closest('.wca-fleet-row');
            if (frow) {
                held = false;
                const { clientX: fx, clientY: fy } = e;
                clearTimeout(holdTimer);
                holdTimer = setTimeout(() => {
                    const fa = fleetAcc(Number(frow.dataset.fleet));
                    const items = fleetItems(fa);
                    held = true;
                    selectFleet(Number(frow.dataset.fleet));
                    if (items.length) sh.menuAt(fx, fy, items);
                }, ((window.wmShell && window.wmShell.holdMs) || 600));
                return;
            }
            const row = e.target.closest('.wca-panel-accounts .wac-row');
            if (!row || picking) return;
            held = false;
            const { clientX: x, clientY: y } = e;
            clearTimeout(holdTimer);
            holdTimer = setTimeout(() => {
                held = true;
                select(Number(row.dataset.index));
                sh.menuAt(x, y, accountItems(selected()));
            }, ((window.wmShell && window.wmShell.holdMs) || 600));
        });
        const cancel = () => clearTimeout(holdTimer);
        list.addEventListener('pointerup', cancel);
        list.addEventListener('pointercancel', cancel);
        list.addEventListener('scroll', cancel, { passive: true });
        list.addEventListener('contextmenu', (e) => { if (!e.target.closest('.wca-add')) e.preventDefault(); });
        p.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.closest('.wca-code, .wca-name-input')) { e.preventDefault(); void submitCode(); }
        });
    }

    function show() {
        syncWatch();
        render();
        if (!loaded && tab !== 'queue') userRefresh(); else void load(); // the queue needs no wait cursor: its own note says it is reading
        void loginAct('status', null, true); // a sign-in left running shows as Resume
    }

    function onStatus(msg) {
        const d = (msg && (msg.data || msg)) || null;
        if (!d || !d.state) return;
        status = d;
        if (d.state !== 'reconnecting') { clearTimeout(pollTimer); if (page && !page.hidden) void load(); }
        render();
    }

    function register() {
        sh = window.wmShell;
        sh.registerApp({
            id: APP_ID,
            title: 'Fleet',
            icon: '/static_images/wm-android/fleet', // the box truck (Program Icons store sets, rendered from public/static_images/app_icons/fleet.png)
            icon65: '/static_images/wm-android/fleet-65',
            inStart: 'programs',
            mount,
            show,
            titleKind: () => (editing || qSub() ? 'ok' : 'close'),
            onTitleOk() {
                if (qSub()) { qGo('list'); return true; }
                if (!editing) return false;
                void saveSettings();
                return true;
            },
            onBack() {
                if (qSub()) { qGo('list'); return true; }
                if (!editing) return false;
                closeSettings();
                return true;
            },
            hide() { clearTimeout(pollTimer); void usageWatch(false); void queueWatch(false); },
            onEnd() { clearTimeout(pollTimer); page = null; editing = null; qpage = 'list'; void usageWatch(false); void queueWatch(false); },
            softKeys() {
                if (tab === 'queue') return queueSoftKeys();
                if (tab === 'accounts' && editing) return { left: { label: 'Done', action: saveSettings }, right: { label: 'Cancel', action: closeSettings } };
                if (tab === 'accounts' && picking) return { left: { label: 'Continue', action: pickDone }, right: { label: 'Menu', menu: menuItems } };
                if (tab === 'sessions') return { left: { label: 'Refresh', action: () => loadSessions() }, right: { label: 'Menu', menu: menuItems } };
                if (tab === 'accounts' && adding) {
                    const st = lg.state;
                    const left = st === 'waiting_code' ? { label: 'Continue', action: submitCode }
                        : st === 'done' ? { label: 'Done', action: closeAdd }
                            : st === 'error' ? { label: 'Try Again', action: () => loginAct('retry') }
                                : st === 'verifying' ? { label: 'Checking...', action: () => {} }
                                    : { label: 'Cancel', action: cancelAdd };
                    return { left, right: { label: 'Menu', menu: menuItems } };
                }
                const acc = selected();
                const fa = tab === 'host' ? fleetAcc(fsel) : null;
                const left = tab === 'host'
                    ? (fa && fa.canMove ? { label: 'Move', action: () => moveFolder(fa) }
                        : fa && fa.moved ? { label: 'Reconnect', action: () => fleetAct('reconnect', fa) }
                            : fleet.hostMigrated ? { label: 'Refresh', action: userRefresh }
                                : { label: 'Reconnect', action: () => remote('reconnect') })
                    : acc ? { label: acc.active ? 'Reconnect' : directorOnly(acc) ? 'Use' : 'Switch', action: () => switchTo(acc) } : { label: 'Refresh', action: userRefresh };
                return { left, right: { label: 'Menu', menu: menuItems } };
            }
        });
        const c = ws();
        if (c && typeof c.on === 'function') {
            c.on('claude_remote_control_status', onStatus, { signal: appScopeSignal });
            c.on('claude_account_login_status', onLoginStatus, { signal: appScopeSignal });
            c.on('claude_remote_fleet_status', onFleet, { signal: appScopeSignal });
            c.on('claude_usage_status', (msg) => {
                if (!usageOn) return;
                const d = msg && msg.changed ? msg : (msg && msg.data) || {};
                usageApply(d.changed, d.removed, false);
                render();
            }, { signal: appScopeSignal });
            c.on('claude_fleet_phone_status', (msg) => {
                if (!qOn) return;
                const d = msg && msg.changed ? msg : (msg && msg.data) || {};
                queueApply(d.changed, d.removed, false);
                render();
            }, { signal: appScopeSignal });
            // the server forgets a dropped socket's subscriptions; the screen back on joins again
            c.on('connected', () => {
                if (usageOn) { usageOn = false; void usageWatch(true); }
                if (qOn) { qOn = false; void queueWatch(true); }
            }, { signal: appScopeSignal });
            window.addEventListener('melatonscreen', () => { if (page && !page.hidden && sh.current === APP_ID) syncWatch(); }, { signal: appScopeSignal });
        }
    }

    // (no page global: other programs open it with wmShell.open('claude-accounts'), app-scope #890)

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
