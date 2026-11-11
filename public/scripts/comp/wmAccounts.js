/**
 * Melaton Mobile: Accounts, Yozora #732 (parent #709). The desktop wallet tray icon's Account
 * Manager flyout (walletTray.js, #430) as a WM 6.1 program, plus a Today row.
 *
 * Same data and wording as the flyout: walletTray.model() builds the rows and alerts (NovelAI from
 * optionsData; Cursor profiles, Claude windows, TokenRouter, RunPod, custom Director engines and
 * service-key trouble from the wallet_status packet, modules/walletStatus.js, admin only) and
 * walletTray.refresh() asks the server again. Nothing new on the server.
 *
 *   page       Settings-style: green header, list rows (status dot, bold name, the flyout's lines,
 *              then each right-hand column as label / value / meter rows), tabs Alerts | Status
 *              at the bottom. Opens on Alerts while this session has alerts it has not shown yet
 *              (the flyout's own sessionStorage list), else Status.
 *   soft keys  Refresh | Menu (Alerts, Status, the selected item's action: Log In, Unlock, Open
 *              NovelAI). Service keys stay on the desktop (Control Panel has no phone page).
 *   Today      registerTodayItem 'accounts' block after Calendar: a table Account | Balance | Status
 *              (NovelAI Anlas included); option Show: 'all' = every account, 'notices' = only the
 *              accounts with alerts or warnings, hidden without any; tap opens the app.
 *              Styles: public/css/wm-today-widgets.css (.wac-today-*).
 *
 * The desktop tray does not run on phones (systemTrayManager is desktop only), so this file asks
 * for wallet_status once connected and every 5 minutes while the page is visible. Styles:
 * public/css/wm-accounts.css. Icon: wm61 app-accounts (drawn, ~/.cache/wm61/tools/draw-app-accounts.js).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'accounts';
    const POLL_MS = 5 * 60 * 1000;
    const TICK_MS = 30 * 1000;
    const STALE_MS = 60 * 1000;
    const TODAY_CACHE_MS = 15 * 1000;
    const SEEN_KEY = 'sf_wallet_seen_alerts'; // walletTray.js: alerts this session has shown
    const ACTION_LABELS = { login: 'Log In', unlock: 'Unlock', 'novelai-site': 'Open NovelAI' };
    const DOT_TITLES = { ok: 'OK', warn: 'Needs attention', bad: 'Out', off: 'Unavailable' };

    let sh = null;
    let page = null;
    let tab = 'status';
    let sel = null; // `${tab}:${key}`
    let tickTimer = null;
    let lastFetch = 0;
    let fetching = null;
    let current = { rows: [], alerts: [] };
    let todayCache = { at: 0, show: '', text: '' };
    let rowsCache = { at: 0, show: '', rows: null }; // Today's block

    const esc = (s) => sh.escapeHtml(s);

    function wallet() {
        return window.walletTray || null;
    }

    function readModel() {
        const w = wallet();
        try { current = w && typeof w.model === 'function' ? w.model() : { rows: [], alerts: [] }; } catch (_) { current = { rows: [], alerts: [] }; }
        return current;
    }

    function state() {
        const w = wallet();
        try { return (w && typeof w.state === 'function' && w.state()) || {}; } catch (_) { return {}; }
    }

    // ---------------------------------------------------------------- seen alerts (shared with the flyout)

    function seenSet() {
        try { return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]')); } catch (_) { return new Set(); }
    }

    function markSeen(alerts) {
        const seen = seenSet();
        alerts.forEach((a) => seen.add(a.id));
        try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200))); } catch (_) { /* private mode */ }
    }

    // ---------------------------------------------------------------- server

    function connected() {
        const ws = window.wsClient;
        return !!(ws && typeof ws.isConnected === 'function' && ws.isConnected() && ws.initializationCompleted);
    }

    /** Ask wallet_status again (force: the server still reuses a snapshot under 20 s). */
    function refresh(opts = {}) {
        const w = wallet();
        if (!w || typeof w.refresh !== 'function' || !connected()) return Promise.resolve();
        if (fetching) return fetching;
        fetching = Promise.resolve(w.refresh({ force: opts.force === true }))
            .catch(() => { /* the notes show the error */ })
            .finally(() => {
                fetching = null;
                lastFetch = Date.now();
                todayCache.at = 0;
                rowsCache.at = 0;
                render();
            });
        return fetching;
    }

    function userRefresh() {
        return sh.busy(() => refresh({ force: true }), { paint: true });
    }

    // ---------------------------------------------------------------- actions

    function phoneAction(action) {
        if (!action || !ACTION_LABELS[action.name]) return null;
        if (action.name === 'novelai-site' && typeof window.openWebUrl !== 'function') return null;
        return action;
    }

    function selectedAction() {
        if (!sel) return null;
        const [t, ...rest] = sel.split(':');
        const key = rest.join(':');
        if (t === 'alerts') {
            const a = current.alerts.find((x) => x.id === key);
            return a ? phoneAction(a.action) : null;
        }
        const row = current.rows.find((r) => r.key === key);
        const line = row && row.lines.find((l) => l && typeof l === 'object' && l.link);
        return line ? phoneAction(line.link) : null;
    }

    function runAction(action) {
        const w = wallet();
        if (!action || !w || typeof w.runAction !== 'function') return;
        try { w.runAction(action.name, action.arg); } catch (err) { console.warn('[wmAccounts] action', action.name, err); }
        // unlock and a finished login refresh the wallet on their own: list again after them
        setTimeout(render, 1500);
        setTimeout(render, 5000);
    }

    // ---------------------------------------------------------------- page

    function lineHtml(line) {
        if (line && typeof line === 'object') {
            const act = phoneAction(line.link);
            return `<div class="wac-line">${esc(line.text)}${act ? ` <span class="wac-link">${esc(ACTION_LABELS[act.name])}</span>` : ''}</div>`;
        }
        return `<div class="wac-line">${esc(line)}</div>`;
    }

    function meterHtml(percent, level) {
        const w = Math.max(0, Math.min(100, Number(percent) || 0));
        return `<span class="wac-meter wac-lv-${esc(level || 'ok')}" aria-hidden="true"><i style="width:${w}%"></i></span>`;
    }

    // One right-hand column of the flyout: a value (+ meter), several bars, or figures with units
    function sideHtml(side) {
        const lv = (l) => (l && l !== 'ok' ? ` wac-lv-${esc(l)}` : '');
        let html = '';
        if (side.bars) {
            html = side.bars.map((bar) => `<span class="wac-fig-label">${esc(side.label)} ${esc(bar.caption)}</span>`
                + `<span class="wac-fig-value${lv(bar.level)}">${esc(bar.value)}</span>${meterHtml(bar.meter, bar.level)}`).join('');
        } else if (side.figures) {
            html = `<span class="wac-fig-label">${esc(side.label)}</span>`
                + `<span class="wac-fig-value is-wide${lv(side.level)}">${side.figures.map((f) => `${esc(f.value)} ${esc(f.unit)}`).join(', ')}</span>`;
        } else {
            html = `<span class="wac-fig-label">${esc(side.label)}</span>`
                + (side.meter == null
                    ? `<span class="wac-fig-value is-wide${lv(side.level)}">${esc(side.value)}</span>`
                    : `<span class="wac-fig-value${lv(side.level)}">${esc(side.value)}</span>${meterHtml(side.meter, side.level)}`);
        }
        (side.lines || []).forEach((l) => { html += `<span class="wac-fig-note">${esc(l)}</span>`; });
        return html;
    }

    function rowSides(row) {
        return row.sides || (row.side ? [row.side] : []);
    }

    function statusRowHtml(row) {
        const key = `status:${row.key}`;
        const sides = rowSides(row);
        return `<div class="wac-row${sel === key ? ' is-selected' : ''}" role="option" aria-selected="${sel === key}" data-sel="${esc(key)}">
            <span class="wac-dot wac-dot-${esc(row.dot)}" title="${esc(DOT_TITLES[row.dot] || '')}"></span>
            <div class="wac-main">
                <div class="wac-name">${esc(row.name)}${row.value ? ` <span class="wac-lv-${esc(row.valueLevel || 'ok')}">${esc(row.value)}</span>` : ''}</div>
                ${row.lines.map(lineHtml).join('')}
                ${sides.length ? `<div class="wac-figs">${sides.map(sideHtml).join('')}</div>` : ''}
            </div>
        </div>`;
    }

    function alertRowHtml(a) {
        const key = `alerts:${a.id}`;
        const act = phoneAction(a.action);
        return `<div class="wac-row${sel === key ? ' is-selected' : ''}" role="option" aria-selected="${sel === key}" data-sel="${esc(key)}">
            <span class="wac-alert-ico">${sh.art.img(a.level === 'critical' ? 'msgbox-error' : 'msgbox-warning')}</span>
            <div class="wac-main">
                <div class="wac-title">${esc(a.title)}</div>
                <div class="wac-line">${esc(a.service)}${a.text ? ` - ${esc(a.text)}` : ''}</div>
                ${act ? `<div class="wac-line"><span class="wac-link">${esc(ACTION_LABELS[act.name])}</span></div>` : ''}
            </div>
        </div>`;
    }

    function setHtml(el, html) {
        if (el && el.innerHTML !== html) el.innerHTML = html;
    }

    function render() {
        if (!page || page.hidden) return;
        const { rows, alerts } = readModel();
        const st = state();
        const keys = new Set([...rows.map((r) => `status:${r.key}`), ...alerts.map((a) => `alerts:${a.id}`)]);
        if (sel && !keys.has(sel)) sel = null;
        let status = rows.map(statusRowHtml).join('');
        if (st.restricted) status += '<div class="wac-note">Other accounts are shown to administrators.</div>';
        else if (st.error && !st.hasServer) status += `<div class="wac-note">Other accounts unavailable: ${esc(st.error)}</div>`;
        const alertList = alerts.length ? alerts.map(alertRowHtml).join('') : '<div class="wac-empty">There are no alerts.</div>';
        const onAlerts = tab === 'alerts';
        if (onAlerts) markSeen(alerts);
        const statusPanel = page.querySelector('.wac-panel-status');
        const alertsPanel = page.querySelector('.wac-panel-alerts');
        statusPanel.hidden = onAlerts;
        alertsPanel.hidden = !onAlerts;
        setHtml(statusPanel, status);
        setHtml(alertsPanel, alertList);
        const tabs = page.querySelectorAll('.wm-tab');
        tabs[0].textContent = alerts.length ? `Alerts (${alerts.length})` : 'Alerts';
        tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
        sh.refreshSoftKeys();
    }

    function setTab(next) {
        if (next === tab) return;
        tab = next === 'alerts' ? 'alerts' : 'status';
        sel = null;
        if (page) page.querySelector('.wac-scroll').scrollTop = 0;
        render();
    }

    function select(key) {
        sel = key;
        page.querySelectorAll('.wac-row').forEach((r) => {
            const on = r.dataset.sel === key;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        sh.refreshSoftKeys();
    }

    function menuItems() {
        const act = selectedAction();
        const items = [
            { label: 'Alerts', checked: tab === 'alerts', action: () => setTab('alerts') },
            { label: 'Status', checked: tab === 'status', action: () => setTab('status') }
        ];
        if (act) items.push('-', { label: ACTION_LABELS[act.name], action: () => runAction(act) });
        return items;
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-accounts');
        p.innerHTML = `
            <div class="wm-form-hdr">Account Manager</div>
            <div class="wac-scroll wm-set-scroll" role="listbox" aria-label="Accounts">
                <div class="wac-panel wac-panel-status"></div>
                <div class="wac-panel wac-panel-alerts" hidden></div>
            </div>
            <div class="wm-tabs" role="tablist">
                <button type="button" class="wm-tab" role="tab" data-tab="alerts">Alerts</button>
                <button type="button" class="wm-tab" role="tab" data-tab="status">Status</button>
            </div>`;
        p.querySelector('.wm-tabs').addEventListener('click', (e) => {
            const t = e.target.closest('.wm-tab');
            if (t) setTab(t.dataset.tab);
        });
        const list = p.querySelector('.wac-scroll');
        let holdTimer = null;
        let held = false;
        list.addEventListener('pointerdown', (e) => {
            const row = e.target.closest('.wac-row');
            if (!row) return;
            held = false;
            const { clientX: x, clientY: y } = e;
            clearTimeout(holdTimer);
            holdTimer = setTimeout(() => {
                held = true;
                select(row.dataset.sel);
                const act = selectedAction();
                if (act) sh.menuAt(x, y, [{ label: ACTION_LABELS[act.name], action: () => runAction(act) }]);
            }, 600);
        });
        const cancel = () => clearTimeout(holdTimer);
        list.addEventListener('pointerup', cancel);
        list.addEventListener('pointercancel', cancel);
        list.addEventListener('scroll', cancel, { passive: true });
        list.addEventListener('contextmenu', (e) => e.preventDefault());
        list.addEventListener('click', (e) => {
            const row = e.target.closest('.wac-row');
            if (!row || held) return;
            // the link in a row is its action (Log In ...), as the flyout's link
            if (e.target.closest('.wac-link')) {
                select(row.dataset.sel);
                runAction(selectedAction());
                return;
            }
            select(row.dataset.sel);
        });
    }

    function schedule() {
        clearInterval(tickTimer);
        // renewal countdowns, Claude window resets and run costs move with the clock
        tickTimer = setInterval(() => {
            if (!page || page.hidden || sh.current !== APP_ID) { clearInterval(tickTimer); return; }
            render();
        }, TICK_MS);
    }

    function show() {
        const st = state();
        // first open with no server answer yet: the user waits for it (NovelAI shows at once)
        const unseen = readModel().alerts.some((a) => !seenSet().has(a.id));
        if (unseen) tab = 'alerts';
        render();
        schedule();
        if (!st.hasServer && !st.restricted) userRefresh();
        else if (Date.now() - lastFetch > STALE_MS) refresh({ force: true });
    }

    // ---------------------------------------------------------------- Today

    // Settings > Today > Items > Options...: 'all' = balances of every account (alerts counted
    // first), 'notices' = only warnings / low balance / expiring, the row hidden when there are none
    function todayShow() {
        try { return (typeof sh.todayOption === 'function' && sh.todayOption(APP_ID, 'show')) || 'all'; } catch (_) { return 'all'; }
    }

    function alertsText(alerts) {
        if (!alerts.length) return '';
        return alerts.length === 1 ? alerts[0].title : `${alerts.length} alerts: ${alerts[0].title}`;
    }

    function todayText() {
        const now = Date.now();
        const show = todayShow();
        if (now - todayCache.at < TODAY_CACHE_MS && todayCache.show === show) return todayCache.text;
        const { rows, alerts } = readModel();
        const st = state();
        let text = alertsText(alerts);
        if (show !== 'notices') {
            const balances = [];
            rows.forEach((row) => rowSides(row).forEach((side) => {
                if (side.label === 'Balance' && side.value && side.value !== '-') balances.push(`${row.name} ${side.value}`);
            }));
            if (balances.length) text = `${alerts.length ? `${alerts.length === 1 ? '1 alert' : `${alerts.length} alerts`}; ` : ''}${balances.join(', ')}`;
            else if (!text && (st.hasServer || st.restricted)) text = 'No account alerts';
        }
        todayCache = { at: now, show, text };
        return text;
    }

    /**
     * Today's Accounts block (Yukimi Nov 10: "better designed with columns"): a compact WM table,
     * Account | Balance | Status, one line per account (the flyout's rows): the balance column holds
     * NovelAI's Anlas (fixed + paid, optionsData.balance.totalCredits) or the account's Balance
     * figure, the status column a small status light and the account's alert, else its usage figure.
     * Show 'notices' keeps only the accounts with an alert or a warning light (hidden when none).
     */
    const shortLabel = (label) => (label === 'V5 usage' ? 'V5' : label === 'Usage' ? '' : label === 'API' ? 'API' : label);

    function todayBalance(row) {
        for (const side of rowSides(row)) {
            if (side.label === 'Anlas') {
                const b = window.optionsData && window.optionsData.balance;
                const total = b && Number(b.totalCredits);
                if (Number.isFinite(total) && total >= 0) return `${total.toLocaleString()} Anlas`;
                return side.summary || '';
            }
            if (side.label === 'Balance' && side.value && side.value !== '-') return side.value;
        }
        return '';
    }

    function todayStatus(row, alerts) {
        const a = alerts.find((x) => String(x.id || '').startsWith(`${row.key}:`));
        if (a && row.dot !== 'ok') return a.title;
        for (const side of rowSides(row)) {
            if (side.label === 'Anlas' || side.label === 'Balance') continue;
            const lab = shortLabel(side.label);
            if (side.bars) return side.summary || side.bars.map((x) => `${x.caption} ${x.value}`).join(', ');
            if (side.value && side.value !== '-') return lab ? `${lab} ${side.value}` : side.value;
        }
        return a ? a.title : (row.value || DOT_TITLES[row.dot] || '');
    }

    function todayRows() {
        const show = todayShow();
        const { rows, alerts } = readModel();
        let out = rows.map((row) => ({ name: row.name, balance: todayBalance(row), status: todayStatus(row, alerts), level: row.dot || 'ok', key: row.key }));
        if (show === 'notices') {
            out = out.filter((r) => r.level === 'warn' || r.level === 'bad' || alerts.some((a) => String(a.id || '').startsWith(`${r.key}:`)));
            // alerts no row carries (service keys ...): their own line
            alerts.filter((a) => !rows.some((row) => String(a.id || '').startsWith(`${row.key}:`)))
                .forEach((a) => out.push({ name: a.service || 'Accounts', balance: '', status: a.title, level: a.level === 'critical' ? 'bad' : 'warn', key: a.id }));
        }
        return out;
    }

    let todayKey = '';
    function renderToday(el) {
        const now = Date.now();
        const show = todayShow();
        if (now - rowsCache.at >= TODAY_CACHE_MS || rowsCache.show !== show || !rowsCache.rows) rowsCache = { at: now, show, rows: todayRows() };
        const rows = rowsCache.rows;
        if (!rows.length) return false;
        if (!el.dataset.wacToday) {
            el.dataset.wacToday = '1';
            el.classList.add('wac-today');
            el.setAttribute('role', 'button');
            el.tabIndex = 0;
            el.addEventListener('click', () => {
                if (current.alerts.length) tab = 'alerts';
                sh.open(APP_ID, { fromStart: true });
            });
        }
        const html = '<div class="wac-today-head"><span>Account</span><span>Balance</span><span>Status</span></div>'
            + rows.map((r) => `<div class="wac-today-row"><span class="wac-today-name">${esc(r.name)}</span>`
                + `<span class="wac-today-bal">${esc(r.balance)}</span>`
                + `<span class="wac-today-st"><i class="wac-today-light is-${esc(r.level)}" title="${esc(DOT_TITLES[r.level] || '')}"></i>${esc(r.status)}</span></div>`).join('');
        if (html !== todayKey) { todayKey = html; el.innerHTML = html; }
        return true;
    }

    // ---------------------------------------------------------------- wiring

    let wsWired = false;

    function wireWs() {
        const ws = window.wsClient;
        if (wsWired || !ws || typeof ws.on !== 'function') return;
        wsWired = true;
        // key tripwire and Security Center key checks (the desktop tray listens the same way)
        ws.on('api_service_lock_changed', () => refresh({ force: true }));
        ws.on('api_key_status_changed', () => refresh({ force: true }));
    }

    function startPolling() {
        const first = () => {
            if (!connected()) return false;
            wireWs();
            refresh();
            return true;
        };
        if (!first()) {
            const t = setInterval(() => { if (first()) clearInterval(t); }, 3000);
        }
        setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    }

    function register() {
        sh = window.wmShell;
        sh.registerApp({
            id: APP_ID,
            title: 'Accounts',
            icon: 'app-accounts',
            inStart: 'programs',
            mount,
            show,
            hide() { clearInterval(tickTimer); },
            onEnd() { clearInterval(tickTimer); page = null; sel = null; },
            softKeys() {
                return {
                    left: { label: 'Refresh', action: userRefresh },
                    right: { label: 'Menu', menu: menuItems }
                };
            }
        });
        if (typeof sh.registerTodayItem === 'function') {
            sh.registerTodayItem({
                id: APP_ID,
                label: 'Accounts',
                after: 'calendar',
                options: [{ key: 'show', label: 'Show', choices: [['all', 'Balances for all accounts'], ['notices', 'Notices only']], value: 'all' }],
                render: renderToday
            });
        }
        startPolling();
    }

    window.wmAccounts = { refresh: () => refresh({ force: true }), todayText: () => { todayCache.at = 0; return todayText(); } };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
