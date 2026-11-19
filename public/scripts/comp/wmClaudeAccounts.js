/**
 * Melaton Mobile: Claude Accounts (Yukimi, Nov 19). The phone's way to pick the Claude account the
 * Director's Claude engine uses (the desktop keeps CardSpace for it: one backend), plus the host side:
 * the Claude Remote Control on the server, which reconnects on every switch.
 *
 *   Accounts  one row per CardSpace Claude account (service key 'claude'): status dot, name, Active,
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

    let sh = null;
    let page = null;
    let tab = 'accounts';
    let sel = null; // account index (Accounts tab)
    let data = { accounts: [], host: null };
    let status = { state: 'unknown', message: '' };
    let error = '';
    let loaded = false;
    let pollTimer = null;
    let adding = false; // the Add Account page is up (Accounts tab)
    let lg = { state: 'idle' }; // claude_account_login state (never a token or code)
    let picking = null; // the Bring over page: { verb, run(carry), picks: Set of session ids }
    let sx = { total: 0, sessions: [], loaded: false, error: '', limit: 30 }; // Sessions tab
    const sxBusy = new Set(); // session ids with an action running
    const sxNote = {}; // id -> last action's answer (message, link)
    const LG_ACTIVE = new Set(['starting', 'waiting_code', 'verifying']);

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
        try { take(await fn()); } catch (e) { await sh.messageBox({ title: 'Claude Accounts', icon: 'error', text: errText(e) }); }
        render();
        watchSettle();
    }

    const liveRc = () => ((data.host && Array.isArray(data.host.sessions)) ? data.host.sessions : []);
    const sessLabel = (x) => `${x.title || x.id.slice(0, 8)}${x.folder ? ` (${x.folder})` : ''}`;

    /** Switch / Reconnect: pick the sessions to bring over first (when any run), then confirm. */
    async function withCarry(verb, run) {
        const list = liveRc();
        if (!list.length) {
            if (!(await confirmEndSessions(verb))) return;
            return run([]);
        }
        picking = { verb, run, picks: new Set() };
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
        if (come.length) lines.push(`Comes over (${come.length}): ${come.map(sessLabel).join(', ')}`);
        if (end.length) lines.push(`Ends (${end.length}): ${end.map(sessLabel).join(', ')}`);
        const v = await sh.messageBox({ title: 'Claude Accounts', icon: end.length ? 'warning' : 'question', text: lines.join('\n\n'), buttons: [{ text: 'Continue', value: true, default: true }, { text: 'Cancel', value: false }] });
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
            title: 'Claude Accounts',
            icon: 'warning',
            text: `${verb} restarts Remote Control on ${data.host.hostname || 'the host'}. Its ${n} running session${n === 1 ? '' : 's'} will end.`,
            buttons: [{ text: 'Continue', value: true, default: true }, { text: 'Cancel', value: false }]
        });
        return v === true;
    }

    async function switchTo(acc) {
        if (!acc) return;
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
        if (!login) { await sh.messageBox({ title: 'Claude Accounts', icon: 'warning', text: 'The host has no claude.ai login. Sign in with claude on the host first.' }); return; }
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
        const st = STATE_LABEL[status.state] ? status.state : 'unknown';
        const retry = st === 'error' || st === 'stopped';
        return `<div class="wca-status wca-st-${esc(st)}" role="status" aria-live="polite">
            <span class="wac-dot wac-dot-${STATE_DOT[st]}"></span>
            <span class="wca-status-text"><b>Remote Control:</b> ${esc(STATE_LABEL[st])}${status.message ? ` <span class="wca-status-msg">${esc(status.message)}</span>` : ''}</span>
            ${retry ? `<button type="button" class="wca-retry" data-wca="${st === 'stopped' ? 'start' : 'reconnect'}">${st === 'stopped' ? 'Start' : 'Retry'}</button>` : ''}
        </div>`;
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
        lines.push(`<div class="wac-line wca-muted">Engine key ${esc(a.fingerprint || '')}</div>`);
        const dot = a.active ? (status.state === 'connected' ? 'ok' : status.state === 'error' ? 'bad' : 'warn') : 'off';
        return `<div class="wac-row${sel === a.index ? ' is-selected' : ''}" role="option" aria-selected="${sel === a.index}" data-index="${a.index}">
            <span class="wac-dot wac-dot-${dot}"></span>
            <div class="wac-main">
                <div class="wac-name">${esc(a.name)}${a.active ? ' <span class="wca-badge">Active</span>' : ''}${a.onHost ? ' <span class="wca-badge wca-badge-host">On host</span>' : ''}</div>
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
            <div class="wm-form-hdr wca-sub-hdr">Remote Control</div>
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

    function setHtml(el, html) { if (el && el.innerHTML !== html) el.innerHTML = html; }
    // the Add page's fields keep what is typed (and focus) across pushes
    function setHtmlKeep(el, html) {
        if (!el || el.innerHTML === html) return;
        const kept = {};
        el.querySelectorAll('input.wca-input').forEach((i) => { kept[i.id] = i.value; });
        const focused = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : '';
        el.innerHTML = html;
        Object.keys(kept).forEach((id) => { const i = el.querySelector(`#${id}`); if (i && !i.disabled && kept[id]) i.value = kept[id]; });
        if (focused) { const f = el.querySelector(`#${focused}`); if (f && !f.disabled) f.focus(); }
    }

    function render() {
        if (!page || page.hidden) return;
        setHtml(page.querySelector('.wca-status-slot'), statusStrip());
        const accountsPanel = page.querySelector('.wca-panel-accounts');
        const hostPanel = page.querySelector('.wca-panel-host');
        const sessionsPanel = page.querySelector('.wca-panel-sessions');
        accountsPanel.hidden = tab !== 'accounts';
        hostPanel.hidden = tab !== 'host';
        sessionsPanel.hidden = tab !== 'sessions';
        let list;
        if (error && !loaded) list = `<div class="wac-note">${esc(error)}</div>`;
        else if (!loaded) list = '<div class="wac-empty">Loading...</div>';
        else if (!data.accounts.length) list = `<div class="wac-empty">No Claude accounts yet.</div>${listFooter()}`;
        else list = data.accounts.map(accountRow).join('') + (error ? `<div class="wac-note">${esc(error)}</div>` : '') + listFooter();
        if (picking) setHtml(accountsPanel, pickHtml());
        else if (adding) setHtmlKeep(accountsPanel, addHtml());
        else setHtml(accountsPanel, list);
        setHtml(hostPanel, hostHtml());
        if (tab === 'sessions') setHtml(sessionsPanel, sessionsHtml());
        page.querySelectorAll('.wm-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
        sh.refreshSoftKeys();
    }

    function setTab(next) {
        tab = next === 'host' || next === 'sessions' ? next : 'accounts';
        if (tab === 'sessions') void loadSessions();
        const sc = page && page.querySelector('.wac-scroll');
        if (sc) sc.scrollTop = 0;
        render();
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

    function accountItems(acc) {
        if (!acc) return [];
        return [
            { label: acc.active ? 'Reconnect' : 'Switch', action: () => switchTo(acc) },
            '-',
            { label: 'Link Host Login', action: () => link(acc) },
            { label: 'Unlink Login', disabled: !acc.remoteLogin, action: () => unlink(acc) },
            '-',
            { label: 'Rename...', action: () => rename(acc) },
            { label: 'Delete', action: () => remove(acc) }
        ];
    }

    function menuItems() {
        const items = [
            { label: 'Accounts', checked: tab === 'accounts', action: () => setTab('accounts') },
            { label: 'Sessions', checked: tab === 'sessions', action: () => setTab('sessions') },
            { label: 'Host', checked: tab === 'host', action: () => setTab('host') },
            '-'
        ];
        if (tab === 'accounts' && adding) {
            items.push({ label: 'Copy Link', disabled: !lg.url, action: () => copyLink() });
            items.push({ label: 'Open in Alchemy', disabled: !lg.url, action: openInAlchemy });
            items.push('-');
            if (LG_ACTIVE.has(lg.state)) items.push({ label: 'Cancel Sign-in', action: cancelAdd });
            if (lg.state === 'error') items.push({ label: 'Try Again', action: () => loginAct('retry') });
            items.push({ label: 'Back to Accounts', action: () => { adding = false; render(); } });
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
            items.push({ label: 'Reconnect', action: () => remote('reconnect') });
            items.push(rc && rc.active === 'active' ? { label: 'Stop Remote Control', action: () => remote('stop') } : { label: 'Start Remote Control', action: () => remote('start') });
        }
        items.push('-', { label: 'Refresh', action: userRefresh });
        return items;
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-accounts', 'wm-claude-accounts');
        p.innerHTML = `
            <div class="wm-form-hdr">Claude Accounts</div>
            <div class="wca-status-slot"></div>
            <div class="wac-scroll wm-set-scroll" role="listbox" aria-label="Claude accounts">
                <div class="wac-panel wca-panel-accounts"></div>
                <div class="wac-panel wca-panel-sessions" hidden></div>
                <div class="wac-panel wca-panel-host" hidden></div>
            </div>
            <div class="wm-tabs" role="tablist">
                <button type="button" class="wm-tab" role="tab" data-tab="accounts">Accounts</button>
                <button type="button" class="wm-tab" role="tab" data-tab="sessions">Sessions</button>
                <button type="button" class="wm-tab" role="tab" data-tab="host">Host</button>
            </div>`;
        p.querySelector('.wm-tabs').addEventListener('click', (e) => {
            const t = e.target.closest('.wm-tab');
            if (t) setTab(t.dataset.tab);
        });
        p.addEventListener('click', (e) => {
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
            const row = e.target.closest('.wca-panel-accounts .wac-row');
            if (row && !held && !picking) select(Number(row.dataset.index));
        });
        p.addEventListener('change', (e) => {
            const c = e.target.closest('.wca-check');
            if (!c || !picking) return;
            if (c.checked) picking.picks.add(c.dataset.pick); else picking.picks.delete(c.dataset.pick);
            render();
        });
        const list = p.querySelector('.wac-scroll');
        let holdTimer = null;
        let held = false;
        list.addEventListener('pointerdown', (e) => {
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
        render();
        if (!loaded) userRefresh(); else void load();
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
            title: 'Claude Accounts',
            icon: 'svc-claude',
            inStart: 'programs',
            mount,
            show,
            hide() { clearTimeout(pollTimer); },
            onEnd() { clearTimeout(pollTimer); page = null; },
            softKeys() {
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
                const left = tab === 'host'
                    ? { label: 'Reconnect', action: () => remote('reconnect') }
                    : acc ? { label: acc.active ? 'Reconnect' : 'Switch', action: () => switchTo(acc) } : { label: 'Refresh', action: userRefresh };
                return { left, right: { label: 'Menu', menu: menuItems } };
            }
        });
        const c = ws();
        if (c && typeof c.on === 'function') {
            c.on('claude_remote_control_status', onStatus, { signal: appScopeSignal });
            c.on('claude_account_login_status', onLoginStatus, { signal: appScopeSignal });
        }
    }

    window.wmClaudeAccounts = {
        open: (t) => { if (t) tab = t === 'host' || t === 'sessions' ? t : 'accounts'; sh.open(APP_ID, { fromStart: true }); },
        refresh: load,
        addAccount: () => { sh.open(APP_ID, { fromStart: true }); return startAdd(); }
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
