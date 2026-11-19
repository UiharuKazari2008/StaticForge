/**
 * Melaton Mobile: Claude Accounts (Yukimi, Nov 19). The phone's way to pick the Claude account the
 * Director's Claude engine uses (the desktop keeps CardSpace for it: one backend), plus the host side:
 * the Claude Remote Control on the server, which reconnects on every switch.
 *
 *   Accounts  one row per CardSpace Claude account (service key 'claude'): status dot, name, Active,
 *             the linked claude.ai login (email, plan) Remote Control signs in with, or "No Remote
 *             Control login linked". Tap selects; Switch (left soft key) makes it the engine's account
 *             and reconnects Remote Control (switch_claude_account). Menu: Switch, Reconnect, Link Host
 *             Login, Unlink Login, Add Account..., Rename..., Delete, Refresh.
 *   Host      the server: host name, Claude CLI version, Remote Control (systemd unit state, since,
 *             restarts, session name, what its tmux pane says, sessions / capacity), the claude.ai login
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

    async function confirmEndSessions(verb) {
        const rc = data.host && data.host.remoteControl;
        const n = rc && rc.pane && rc.pane.sessions;
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
        if (!(await confirmEndSessions(acc.active ? 'Reconnecting' : `Switching to ${acc.name}`))) return;
        status = { state: 'reconnecting', message: `Switching to ${acc.name}` };
        render();
        await act(() => send('switch_claude_account', { index: acc.index }));
    }

    async function remote(action) {
        if (action !== 'stop' && !(await confirmEndSessions(action === 'start' ? 'Starting' : 'Reconnecting'))) return;
        if (action === 'stop' && !(await confirmEndSessions('Stopping'))) return;
        if (action !== 'stop') { status = { state: 'reconnecting', message: 'Reconnecting Remote Control' }; render(); }
        await act(() => send('claude_remote_control', { action }));
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

    function hostHtml() {
        const h = data.host;
        if (!h) return '<div class="wac-empty">No host information.</div>';
        const rc = h.remoteControl || {};
        const pane = rc.pane || {};
        const row = (label, value) => `<div class="wca-kv"><span class="wca-k">${esc(label)}</span><span class="wca-v">${esc(value == null || value === '' ? '-' : value)}</span></div>`;
        const login = h.login;
        const eng = h.engine || {};
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

    function render() {
        if (!page || page.hidden) return;
        setHtml(page.querySelector('.wca-status-slot'), statusStrip());
        const accountsPanel = page.querySelector('.wca-panel-accounts');
        const hostPanel = page.querySelector('.wca-panel-host');
        accountsPanel.hidden = tab !== 'accounts';
        hostPanel.hidden = tab !== 'host';
        let list;
        if (error && !loaded) list = `<div class="wac-note">${esc(error)}</div>`;
        else if (!loaded) list = '<div class="wac-empty">Loading...</div>';
        else if (!data.accounts.length) list = '<div class="wac-empty">No Claude accounts. Menu &gt; Add Account...</div>';
        else list = data.accounts.map(accountRow).join('') + (error ? `<div class="wac-note">${esc(error)}</div>` : '');
        setHtml(accountsPanel, list);
        setHtml(hostPanel, hostHtml());
        page.querySelectorAll('.wm-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
        sh.refreshSoftKeys();
    }

    function setTab(next) {
        tab = next === 'host' ? 'host' : 'accounts';
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
            { label: 'Host', checked: tab === 'host', action: () => setTab('host') },
            '-'
        ];
        if (tab === 'accounts') {
            const acc = selected();
            if (acc) items.push(...accountItems(acc), '-');
            items.push({ label: 'Add Account...', action: addAccount });
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
                <div class="wac-panel wca-panel-host" hidden></div>
            </div>
            <div class="wm-tabs" role="tablist">
                <button type="button" class="wm-tab" role="tab" data-tab="accounts">Accounts</button>
                <button type="button" class="wm-tab" role="tab" data-tab="host">Host</button>
            </div>`;
        p.querySelector('.wm-tabs').addEventListener('click', (e) => {
            const t = e.target.closest('.wm-tab');
            if (t) setTab(t.dataset.tab);
        });
        p.addEventListener('click', (e) => {
            const b = e.target.closest('[data-wca]');
            if (b) { void remote(b.dataset.wca); return; }
            const row = e.target.closest('.wca-panel-accounts .wac-row');
            if (row && !held) select(Number(row.dataset.index));
        });
        const list = p.querySelector('.wac-scroll');
        let holdTimer = null;
        let held = false;
        list.addEventListener('pointerdown', (e) => {
            const row = e.target.closest('.wca-panel-accounts .wac-row');
            if (!row) return;
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
        list.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    function show() {
        render();
        if (!loaded) userRefresh(); else void load();
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
                const acc = selected();
                const left = tab === 'host'
                    ? { label: 'Reconnect', action: () => remote('reconnect') }
                    : acc ? { label: acc.active ? 'Reconnect' : 'Switch', action: () => switchTo(acc) } : { label: 'Refresh', action: userRefresh };
                return { left, right: { label: 'Menu', menu: menuItems } };
            }
        });
        const c = ws();
        if (c && typeof c.on === 'function') c.on('claude_remote_control_status', onStatus, { signal: appScopeSignal });
    }

    window.wmClaudeAccounts = { open: (t) => { if (t) tab = t === 'host' ? 'host' : 'accounts'; sh.open(APP_ID, { fromStart: true }); }, refresh: load };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
