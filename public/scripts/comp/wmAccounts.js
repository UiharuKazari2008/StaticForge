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
 *   Options... Menu > Options... (hidden Settings page accounts-options, #829): which account events
 *              raise a WM notification (renewal, daily usage against the refill, low fixed / paid
 *              Anlas, a low balance of another account, NovelAI API down); see "notifications" below.
 *   icons      each account shows its service's icon on Today (6.1 rows: wm61 svc-*, 6.5 panel pages:
 *              ti-x-svc-*-lg; scripts/generate-wm-account-art.js).
 *   Today      registerTodayItem 'accounts' block after Calendar: a table Account | Balance | Status
 *              (NovelAI Anlas included); option Show: 'all' = every account, 'notices' = only the
 *              accounts with alerts or warnings, hidden without any, 'balances' = just the figures,
 *              one column each; option Accounts: which balances (NovelAI's Anlas and usage apart);
 *              tap opens the app.
 *              Styles: public/css/wm-today-widgets.css (.wac-today-*).
 *
 * The desktop tray does not run on phones (systemTrayManager is desktop only), so this file asks
 * for wallet_status once connected and every 5 minutes while the page is visible. Styles:
 * public/css/wm-accounts.css. Icon: wm61 app-accounts (drawn, ~/.cache/wm61/tools/draw-app-accounts.js).
 */
(function () {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'accounts';
    const POLL_MS = 5 * 60 * 1000;
    const TICK_MS = 30 * 1000;
    const STALE_MS = 60 * 1000;
    const TODAY_CACHE_MS = 15 * 1000;
    const SEEN_KEY = 'sf_wallet_seen_alerts'; // walletTray.js: alerts this session has shown
    const ACTION_LABELS = { login: 'Log In', unlock: 'Unlock', 'novelai-site': 'Open NovelAI', 'app-requests': 'View Requests' };
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
        const req = appRequestsAlert();
        if (req) current = { ...current, alerts: [req, ...(current.alerts || [])] };
        return current;
    }

    /**
     * Programs waiting for an application key (admin only, #831): an alert whose link opens
     * Settings > System > Application Requests (wmSettingsSystem.js window.wmAppRequests). Its id
     * carries the requests' ids, so a new request shows as unseen again.
     */
    function appRequestsAlert() {
        const ar = window.wmAppRequests;
        let list = [];
        try { list = ar && typeof ar.pending === 'function' ? ar.pending() : []; } catch (_) { list = []; }
        if (!list.length) return null;
        const names = [...new Set(list.map((r) => r.appName).filter(Boolean))];
        return {
            id: `app-requests:${list.map((r) => r.id).sort().join(',')}`,
            level: 'warning',
            title: list.length === 1 ? 'Application key request' : `${list.length} application key requests`,
            service: 'Dreamscape',
            text: names.length ? `${names.slice(0, 2).join(', ')}${names.length > 2 ? ', ...' : ''} waiting for approval` : 'Waiting for approval',
            action: { name: 'app-requests' }
        };
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
        const ar = window.wmAppRequests;
        fetching = Promise.all([
            Promise.resolve(w.refresh({ force: opts.force === true })),
            ar && typeof ar.refresh === 'function' ? ar.refresh(opts.force === true) : null
        ])
            .catch(() => { /* the notes show the error */ })
            .finally(() => {
                fetching = null;
                lastFetch = Date.now();
                todayCache.at = 0;
                rowsCache.at = 0;
                render();
                checkSoon();
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
        if (action && action.name === 'app-requests') {
            const ar = window.wmAppRequests;
            if (ar && typeof ar.open === 'function') ar.open();
            return;
        }
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
        // the screen off or behind an Android program: drawn when it is seen again (wake)
        if (sh && typeof sh.onScreen === 'function' && !sh.onScreen(page)) { pageStale = true; return; }
        pageStale = false;
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
        items.push('-', { label: 'Options...', disabled: !(window.wmSettings && typeof window.wmSettings.open === 'function'), action: openOptions });
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
            }, ((window.wmShell && window.wmShell.holdMs) || 600));
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
            if (!page || page.hidden || sh.current !== APP_ID || !awake()) {
                // stopped while the page stays open (the screen off, behind): its countdowns are old then
                if (page && !page.hidden && sh.current === APP_ID) pageStale = true;
                clearInterval(tickTimer); tickTimer = null; return;
            }
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

    /**
     * The balances an account shows on Today, each one picked on its own (Options > Accounts):
     * NovelAI is two, its Anlas and its usage; every other account is one, its Balance figure (or
     * its first figure). id: the check box value; label: the check box; caption / value: the
     * Balances view's column.
     */
    function accountParts(row) {
        const sides = rowSides(row);
        const anlas = sides.find((x) => x.label === 'Anlas');
        if (anlas) {
            const parts = [{ id: `${row.key}:anlas`, label: `${row.name.replace(/\s+(opus|scroll|tablet|paper)$/i, '')} Anlas`, caption: 'Anlas', value: todayBalance(row) }];
            sides.filter((x) => /usage/i.test(x.label)).forEach((x, i) => parts.push({
                id: `${row.key}:usage${i ? i + 1 : ''}`,
                label: `${row.name.replace(/\s+(opus|scroll|tablet|paper)$/i, '')} ${x.label.replace(/^Usage$/, 'usage')}`,
                caption: x.label,
                value: x.value && x.value !== '-' ? x.value : (x.summary || '')
            }));
            return parts;
        }
        let value = todayBalance(row);
        if (!value) {
            const fig = sides.find((x) => (x.value && x.value !== '-') || x.summary);
            value = fig ? (fig.value && fig.value !== '-' ? fig.value : fig.summary) : (row.value || '');
        }
        return [{ id: row.key, label: row.name, caption: row.name, value }];
    }

    // ---- service icons (#829): wm61 svc-<name> (16 / -lg 32, @2x @4x) and the 6.5 panels ti-x-svc-<name>-lg,
    // scripts/generate-wm-account-art.js; a Director engine without its own art shows the Director's
    const SVC_ART = new Set(['novelai', 'cursor', 'claude', 'tokenrouter', 'runpod', 'deepseek', 'gemini']);
    const KIND_ART = { deepseek: 'deepseek', google: 'gemini', tokenrouter: 'tokenrouter' };
    const KIND_LABEL = { tokenrouter: 'TokenRouter', openrouter: 'OpenRouter', openai: 'OpenAI', google: 'Google AI', nvidia: 'NVIDIA NIM', deepseek: 'DeepSeek', deepinfra: 'DeepInfra' };

    /** A Director engine's host kind (customRows' title: "host, kind"; generic hosts name none). */
    function engineKind(row) {
        const last = String(row.title || '').split(', ').pop();
        return KIND_LABEL[last] ? last : '';
    }

    /** { small, panel } art names for an account row (or an alert's own line: the wallet). */
    function serviceArt(row) {
        let svc = row && row.service;
        if (svc === 'custom') svc = KIND_ART[engineKind(row)] || '';
        if (SVC_ART.has(svc)) return { small: `svc-${svc}`, panel: `x:svc-${svc}-lg` };
        if (row && row.service === 'custom') return { small: 'app-director', panel: 'x:app-director-lg' };
        return { small: 'app-accounts', panel: 'x:app-accounts-lg' };
    }

    /** The service / account type a row stands for (the sub-line), and its own name when it has one. */
    function serviceLabel(row) {
        if (row.service === 'cursor') return 'Cursor';
        if (row.service === 'custom') return KIND_LABEL[engineKind(row)] && KIND_LABEL[engineKind(row)] !== row.name ? `${row.name} (${KIND_LABEL[engineKind(row)]})` : row.name;
        return row.name;
    }

    function accountName(row) {
        return row.service === 'cursor' ? String(row.name).replace(/^Cursor:\s*/, '') : '';
    }

    function smallIconHtml(name) {
        if (!name) return '';
        const base = `/static_images/wm61/${name}`;
        return `<img class="wac-today-ico" src="${base}.png" srcset="${base}.png 1x, ${base}@2x.png 2x, ${base}@4x.png 4x" alt="" draggable="false">`;
    }

    function todayHidden() {
        let v = '';
        try { v = (typeof sh.todayOption === 'function' && sh.todayOption(APP_ID, 'accounts')) || ''; } catch (_) { v = ''; }
        return new Set(String(v).split(',').filter(Boolean));
    }

    /** Options > Accounts: a check box per balance of every account the wallet knows now. */
    function accountChoices() {
        const { rows } = readModel();
        const out = [];
        rows.forEach((row) => accountParts(row).forEach((p) => out.push([p.id, p.label])));
        return out;
    }

    function todayRows() {
        const show = todayShow();
        const hidden = todayHidden();
        const { rows, alerts } = readModel();
        let out = rows.filter((row) => accountParts(row).some((p) => !hidden.has(p.id))).map((row) => {
            // a hidden Anlas leaves the balance column empty, a hidden usage the status its default
            const parts = accountParts(row);
            const anlasOff = parts.some((p) => p.caption === 'Anlas' && hidden.has(p.id));
            const usageOff = parts.some((p) => p.id !== row.key && p.caption !== 'Anlas' && hidden.has(p.id));
            const view = usageOff ? Object.assign({}, row, { sides: rowSides(row).filter((x) => !/usage/i.test(x.label)), side: null }) : row;
            const art = serviceArt(row);
            return { name: row.name, balance: anlasOff ? '' : todayBalance(row), status: todayStatus(view, alerts), level: row.dot || 'ok', key: row.key,
                service: serviceLabel(row), account: accountName(row), small: art.small, panel: art.panel };
        });
        if (show === 'notices') {
            out = out.filter((r) => r.level === 'warn' || r.level === 'bad' || alerts.some((a) => String(a.id || '').startsWith(`${r.key}:`)));
            // alerts no row carries (service keys ...): their own line
            alerts.filter((a) => !rows.some((row) => String(a.id || '').startsWith(`${row.key}:`)))
                .forEach((a) => out.push({ name: a.service || 'Accounts', balance: '', status: a.title, level: a.level === 'critical' ? 'bad' : 'warn', key: a.id,
                    service: a.service || 'Accounts', account: '', small: 'app-accounts', panel: 'x:app-accounts-lg' }));
        }
        return out;
    }

    /**
     * The 6.5 home screen panel (wmTitanium.js): an account a page with its service's icon (#829); the
     * account's own name or its figure is the main line, the service / account type the line under it,
     * then the status.
     */
    function todayTitanium() {
        const pages = todayShow() === 'balances'
            ? todayBalanceCols().map((c) => ({ icon: c.panel, title: c.value, line2: c.label }))
            : todayRows().map((r) => {
                const main = r.account || r.balance || r.status || r.service;
                const third = [r.account && r.balance, main === r.status ? '' : r.status].filter(Boolean).join(', ');
                return { icon: r.panel, title: main, line2: main === r.service ? '' : r.service, line3: third };
            });
        if (!pages.length) return null;
        const go = () => { if (current.alerts.length) tab = 'alerts'; sh.open(APP_ID, { fromStart: true }); };
        return {
            label: 'accounts', icon: 'x:app-accounts-lg',
            pages,
            softKey: { label: 'Accounts', action: go }, onTap: go
        };
    }

    let todayKey = '';
    /** Balances only: one column per picked balance, its caption over the figure. */
    function todayBalanceCols() {
        const hidden = todayHidden();
        const out = [];
        readModel().rows.forEach((row) => accountParts(row).forEach((p) => {
            if (!hidden.has(p.id) && p.value) out.push({ caption: p.caption, value: p.value, level: row.dot || 'ok', label: p.label, panel: serviceArt(row).panel, small: serviceArt(row).small });
        }));
        return out;
    }

    function renderToday(el) {
        const now = Date.now();
        const show = todayShow();
        const cacheKey = `${show}|${[...todayHidden()].join(',')}`;
        if (now - rowsCache.at >= TODAY_CACHE_MS || rowsCache.show !== cacheKey || !rowsCache.rows) {
            rowsCache = { at: now, show: cacheKey, rows: show === 'balances' ? todayBalanceCols() : todayRows() };
        }
        const rows = rowsCache.rows;
        if (!rows.length) return false;
        el.classList.toggle('is-balances', show === 'balances');
        if (show === 'balances') {
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
            const html = rows.map((c) => `<div class="wac-today-col"><span class="wac-today-cap">${smallIconHtml(c.small)}${esc(c.caption)}</span><span class="wac-today-fig">${esc(c.value.replace(/\s+Anlas$/, ''))}</span></div>`).join('');
            if (html !== todayKey) { todayKey = html; el.innerHTML = html; }
            return true;
        }
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
            + rows.map((r) => `<div class="wac-today-row"><span class="wac-today-name">${smallIconHtml(r.small)}${esc(r.name)}</span>`
                + `<span class="wac-today-bal">${esc(r.balance)}</span>`
                + `<span class="wac-today-st"><i class="wac-today-light is-${esc(r.level)}" title="${esc(DOT_TITLES[r.level] || '')}"></i>${esc(r.status)}</span></div>`).join('');
        if (html !== todayKey) { todayKey = html; el.innerHTML = html; }
        return true;
    }

    // ---------------------------------------------------------------- notifications (#829)
    // Menu > Options... (a hidden Settings page, accounts-options): which account events raise a WM
    // notification (class "Other notifications"), each once until its condition clears. Checked on
    // every server ping (balance, V5 usage, account health, subscription and status.novelai.net ride on
    // it, web_server.js) and after each wallet_status read (the other accounts' balances): no polling.
    //   renewal  the subscription renews within N days / has renewed (expiresAt moved on) / renewal failed
    //   daily    today's spend nears the subscription's daily refill: the month's fixed Anlas
    //            (perks.moduleTrainingSteps, else the tier's) over 30 days; Opus V5 usage against its
    //            refill per day (opusUsage.timeUntilNextPercent). Counted by this phone from local midnight.
    //   fixed / paid  fixed or paid Anlas under a threshold (fixed: subscribers only)
    //   balance  a Balance figure of another account (TokenRouter, RunPod, a Director engine host) under $N
    //   api      the NovelAI API is not answering (account health upstreamUnavailable) or
    //            status.novelai.net reports an incident

    const NOTIFY_KEY = 'wmAccountNotify';
    const NOTIFIED_KEY = 'wmAccountNotified';
    const DAY_KEY = 'wmAccountUsageDay';
    const SUB_KEY = 'wmAccountSubSeen';
    const NOTIFY_DEFAULTS = { renewal: true, renewalDays: 3, daily: true, dailyPct: 80, fixed: true, fixedBelow: 250, paid: false, paidBelow: 250, balance: true, balanceBelow: 5, api: true };
    const MONTHLY_ANLAS = { 1: 1000, 2: 1000, 3: 10000 }; // Tablet, Scroll, Opus
    const TIERS = { 0: 'Free', 1: 'Tablet', 2: 'Scroll', 3: 'Opus' };
    const CHOICES = {
        renewalDays: [[1, '1 day'], [3, '3 days'], [7, '7 days']],
        dailyPct: [[50, 'at 50%'], [75, 'at 75%'], [80, 'at 80%'], [90, 'at 90%']],
        fixedBelow: [[100, '100'], [250, '250'], [500, '500'], [1000, '1,000']],
        paidBelow: [[100, '100'], [250, '250'], [500, '500'], [1000, '1,000']],
        balanceBelow: [[1, '$1'], [5, '$5'], [10, '$10'], [25, '$25']]
    };

    const lsRead = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : fallback; } catch (_) { return fallback; } };
    const lsWrite = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) { /* private mode */ } };
    const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const fmt = (n) => Math.round(n).toLocaleString();

    function notifySettings() {
        return Object.assign({}, NOTIFY_DEFAULTS, lsRead(NOTIFY_KEY, {}));
    }

    const openNotes = new Map(); // condition key -> appNote handle

    function raise(key, title, text, icon) {
        const note = sh && typeof sh.appNote === 'function'
            ? sh.appNote({
                title,
                html: esc(text),
                event: 'notification',
                icon: icon || null,
                softKeys: () => ({
                    left: { label: 'View', action: () => { if (note) note.close(); openNotes.delete(key); sh.open(APP_ID, { fromStart: true }); } },
                    right: { label: 'Dismiss', action: () => { if (note) note.close(); openNotes.delete(key); } }
                })
            })
            : null;
        if (note) openNotes.set(key, note);
        else if (sh && typeof sh.notify === 'function') sh.notify({ title, text, icon: 'warning', asNote: true, timeout: false });
    }

    /** conds: [{ key, title, text }] that hold now; each is raised once until it is gone from the list. */
    function settle(conds, scope) {
        const done = lsRead(NOTIFIED_KEY, {});
        const now = new Set(conds.map((c) => c.key));
        let changed = false;
        conds.forEach((c) => {
            if (done[c.key]) return;
            done[c.key] = Date.now();
            changed = true;
            raise(c.key, c.title, c.text, c.icon);
        });
        // cleared: notify again next time; a notification still up for it goes (the API answers again ...)
        Object.keys(done).forEach((k) => {
            if (!k.startsWith(`${scope}:`) || now.has(k)) return;
            delete done[k];
            changed = true;
            const n = openNotes.get(k);
            if (n && !k.startsWith('nai:renewed')) { n.close(); openNotes.delete(k); }
        });
        if (changed) lsWrite(NOTIFIED_KEY, done);
    }

    function localDay(t = Date.now()) {
        const d = new Date(t);
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }

    /** Today's spend (Anlas, V5 percent) as this phone saw it fall since local midnight. */
    function trackDay(total, v5Remaining) {
        const today = localDay();
        let d = lsRead(DAY_KEY, null);
        const was = JSON.stringify(d);
        if (!d || d.day !== today) d = { day: today, lastTotal: total, spent: 0, lastV5: v5Remaining, v5Drop: 0 };
        if (total != null) {
            if (d.lastTotal != null && total < d.lastTotal) d.spent += d.lastTotal - total;
            d.lastTotal = total; // a rise (renewal, a purchase) only moves the mark
        }
        if (v5Remaining != null) {
            if (d.lastV5 != null && v5Remaining < d.lastV5) d.v5Drop = Math.round((d.v5Drop + d.lastV5 - v5Remaining) * 10) / 10;
            d.lastV5 = v5Remaining;
        }
        if (JSON.stringify(d) !== was) lsWrite(DAY_KEY, d);
        return d;
    }

    function novelAiConds(cfg) {
        const opts = window.optionsData;
        if (!opts) return null;
        const deferred = typeof window.isAccountDataDeferred === 'function' && window.isAccountDataDeferred();
        const out = [];
        // the API first: it holds while account data is missing
        if (cfg.api) {
            const incident = typeof window.getActiveUpstreamIncident === 'function' ? window.getActiveUpstreamIncident({ respectInhibit: false }) : null;
            if (opts.upstreamUnavailable === true && opts.userDataError !== 'No NovelAI API key configured') {
                out.push({ key: 'nai:api:down', icon: 'status-error', title: 'NovelAI', text: `The NovelAI API is not responding.${opts.userDataError ? ` ${String(opts.userDataError).replace(/\.?$/, '.')}` : ''}` });
            } else if (incident) {
                out.push({ key: `nai:api:incident:${incident.key || incident.component}`, icon: 'status-warning', title: 'NovelAI', text: `NovelAI ${incident.component}: ${incident.status}.` });
            }
        }
        if (deferred || !opts.balance) return out;
        const b = opts.balance;
        const fixed = num(b.fixedTrainingStepsLeft) || 0;
        const paid = num(b.purchasedTrainingSteps) || 0;
        const total = num(b.totalCredits);
        const sub = opts.user && opts.user.subscription && typeof opts.user.subscription === 'object' ? opts.user.subscription : null;
        const tier = sub ? num(sub.tier) : null;
        const tierName = TIERS[tier] || 'NovelAI';
        const expiresMs = sub && num(sub.expiresAt) ? num(sub.expiresAt) * 1000 : null;
        // V5 usage (Opus): remaining percent and its refill per day
        const usage = opts.opusUsage || (sub && sub.usage) || null;
        let v5 = null;
        if (tier === 3 && usage && num(usage.percent) != null) {
            const secs = num(usage.timeUntilNextPercent);
            v5 = { remaining: usage.isNegative ? 0 : Math.max(0, num(usage.percent)), refill: secs && secs > 0 ? 86400 / secs : 0 };
        }
        const day = trackDay(total != null && total >= 0 ? total : null, v5 ? v5.remaining : null);

        if (cfg.renewal && sub) {
            const seen = lsRead(SUB_KEY, {});
            if (expiresMs && seen.expiresAt && expiresMs > seen.expiresAt + 86400000 && seen.expiresAt <= Date.now() + 3600000) {
                // the old renewal date came and the date moved on: renewed (kept until the next cycle's own notices)
                out.push({ key: `nai:renewed:${expiresMs}`, icon: null, title: 'NovelAI', text: `Your ${tierName} subscription renewed. It next renews on ${new Date(expiresMs).toLocaleDateString()}.` });
            }
            if (expiresMs && expiresMs !== seen.expiresAt) lsWrite(SUB_KEY, { expiresAt: expiresMs });
            if (opts.subscriptionRenewalFailed) {
                out.push({ key: 'nai:renewal-failed', icon: 'status-error', title: 'NovelAI', text: `Your ${tierName} subscription could not renew. Renew it or update billing on novelai.net.` });
            } else if (tier > 0 && expiresMs && expiresMs > Date.now() && expiresMs - Date.now() <= cfg.renewalDays * 86400000) {
                const hours = Math.max(1, Math.round((expiresMs - Date.now()) / 3600000));
                const when = hours < 48 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${Math.round(hours / 24)} days`;
                out.push({ key: `nai:renewal:${expiresMs}`, icon: null, title: 'NovelAI', text: `Your ${tierName} subscription renews in ${when} (${new Date(expiresMs).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}). Unused fixed Anlas (${fmt(fixed)}) expire then.` });
            } else {
                // the renewed notice stays one until the cycle after
                const done = lsRead(NOTIFIED_KEY, {});
                Object.keys(done).filter((k) => k.startsWith('nai:renewed:')).forEach((k) => out.push({ key: k }));
            }
        }
        if (cfg.daily && tier > 0) {
            const monthly = num(sub && sub.perks && sub.perks.moduleTrainingSteps) || MONTHLY_ANLAS[tier] || 0;
            const budget = monthly / 30;
            if (budget > 0 && day.spent >= budget * (cfg.dailyPct / 100)) {
                out.push({ key: `nai:daily:anlas:${day.day}`, icon: 'status-warning', title: 'NovelAI', text: `${fmt(day.spent)} Anlas used today, ${Math.round((day.spent / budget) * 100)}% of the daily refill (about ${fmt(budget)} a day from ${fmt(monthly)} fixed Anlas a month).` });
            }
            if (v5 && v5.refill > 0 && day.v5Drop >= v5.refill * (cfg.dailyPct / 100)) {
                out.push({ key: `nai:daily:v5:${day.day}`, icon: 'status-warning', title: 'NovelAI', text: `V5 usage down ${day.v5Drop}% today, ${Math.round((day.v5Drop / v5.refill) * 100)}% of what it refills in a day (${Math.round(v5.refill * 10) / 10}%).` });
            }
        }
        if (cfg.fixed && tier > 0 && total !== -1 && fixed < cfg.fixedBelow) {
            out.push({ key: 'nai:fixed-low', icon: 'status-warning', title: 'NovelAI', text: `Fixed Anlas are low: ${fmt(fixed)} left.${expiresMs && expiresMs > Date.now() ? ` They refill on ${new Date(expiresMs).toLocaleDateString()}.` : ''}` });
        }
        if (cfg.paid && total !== -1 && paid < cfg.paidBelow) {
            out.push({ key: 'nai:paid-low', icon: 'status-warning', title: 'NovelAI', text: `Paid Anlas are low: ${fmt(paid)} left.` });
        }
        return out;
    }

    /** A Balance figure as dollars ("$4.20", "4.20 USD"); other currencies are left alone. */
    function dollars(text) {
        const s = String(text || '');
        if (!/\$|USD/i.test(s)) return null;
        return num(s.replace(/[^0-9.-]/g, ''));
    }

    function balanceConds(cfg) {
        if (!cfg.balance) return [];
        const out = [];
        readModel().rows.forEach((row) => {
            if (row.service === 'novelai') return;
            rowSides(row).forEach((side) => {
                if (side.label !== 'Balance') return;
                const v = dollars(side.value);
                if (v == null || v >= cfg.balanceBelow) return;
                out.push({ key: `acct:low:${row.key}`, icon: 'status-warning', title: serviceLabel(row), text: `${serviceLabel(row)} balance is low: ${side.value} left.` });
            });
        });
        return out;
    }

    let checkTimer = null;
    function checkSoon() {
        clearTimeout(checkTimer);
        // after the ping's own handlers stored what it brought
        checkTimer = setTimeout(checkNow, 50);
    }

    function checkNow() {
        const cfg = notifySettings();
        try {
            const nai = novelAiConds(cfg);
            if (nai) settle(nai, 'nai');
            // the other accounts only once wallet_status answered (admins)
            if (state().hasServer) settle(balanceConds(cfg), 'acct');
        } catch (err) { console.warn('[wmAccounts] notifications', err); }
    }

    function optionsPage() {
        const ws = window.wmSettings;
        if (!ws || typeof ws.registerPage !== 'function') return;
        const ui = ws.ui;
        const row = (k, label, d, thr) => {
            const cur = thr ? (CHOICES[thr].find(([v]) => v === d[thr]) || CHOICES[thr][0]) : null;
            return `<div class="wac-opt">${ui.check(`wac-${k}`, label, d[k], `data-k="${k}"`)}${thr ? ui.comboHtml(thr, cur[1], !d[k]) : ''}</div>`;
        };
        ws.registerPage({
            id: 'accounts-options', tab: 'personal', label: 'Options', icon: 'app-accounts', hidden: true,
            title: 'Accounts',
            tabs: [['notifications', 'Notifications']],
            init: () => notifySettings(),
            render(el, _tab, d) {
                el.innerHTML = `${ui.text('Show a notification when:')}
                    ${ui.sub('NovelAI')}
                    ${row('renewal', 'Renewal is within', d, 'renewalDays')}
                    ${row('daily', 'Usage nears the daily refill', d, 'dailyPct')}
                    ${row('fixed', 'Fixed Anlas fall below', d, 'fixedBelow')}
                    ${row('paid', 'Paid Anlas fall below', d, 'paidBelow')}
                    ${row('api', 'The NovelAI API is not responding', d)}
                    ${ui.sub('Other accounts')}
                    ${row('balance', 'A balance falls below', d, 'balanceBelow')}`;
                el.querySelectorAll('input[type="checkbox"][data-k]').forEach((cb) => cb.addEventListener('change', () => {
                    d[cb.dataset.k] = cb.checked;
                    const combo = cb.closest('.wac-opt').querySelector('.wm-combo');
                    if (combo) combo.disabled = !cb.checked;
                }));
                el.querySelectorAll('.wm-combo[data-act]').forEach((btn) => ui.bindCombo(btn, CHOICES[btn.dataset.act], d[btn.dataset.act], (v) => { d[btn.dataset.act] = v; }, 'right'));
            },
            commit(d) {
                const out = {};
                Object.keys(NOTIFY_DEFAULTS).forEach((k) => { out[k] = d[k]; });
                lsWrite(NOTIFY_KEY, out);
                checkSoon();
                return [];
            }
        });
    }

    function openOptions() {
        if (window.wmSettings && typeof window.wmSettings.open === 'function') window.wmSettings.open('accounts-options', null, { direct: true });
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
        // #829: balance, usage, account health, subscription and NovelAI status arrive with every ping
        ws.on('ping', checkSoon);
    }

    function startPolling() {
        const first = () => {
            if (!connected()) return false;
            wireWs();
            refresh();
            return true;
        };
        if (!first()) {
            // the link not up yet: the first read when it comes up (no 3 s poll for it)
            let done = false;
            const c = window.wsClient;
            if (c && typeof c.on === 'function') c.on('connected', () => { if (!done) done = first(); }, { signal: appScopeSignal });
        }
        // over the Melaton Miniport (#815) it keeps the wallet current for every window: no poll here,
        // a read when it says the wallet changed (answered from its copy, also with the screen off)
        syncPoll();
        try { if (window.melatonContinuity && window.melatonContinuity.miniportData) window.melatonContinuity.miniportData.on('wallet_status', () => refresh()); } catch (_) { /* polls instead */ }
        // the screen off, the page hidden or behind an Android program: the poll and the page's tick stop;
        // seen again, an overdue read goes at once and the page is drawn as it is now
        const wake = () => {
            syncPoll();
            // the tick stops: the countdowns on the page are old from now, so it is drawn on the wake
            if (!awake()) { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; pageStale = true; } return; }
            if (Date.now() - lastFetch > POLL_MS && !miniportWallet()) refresh();
            if (page && !page.hidden && sh.current === APP_ID) { if (pageStale) render(); if (!tickTimer) schedule(); }
        };
        window.addEventListener('melatonscreen', wake, { signal: appScopeSignal });
        document.addEventListener('visibilitychange', wake, { signal: appScopeSignal });
        document.addEventListener('wmBehind', wake, { signal: appScopeSignal });
    }

    let pollTimer = null;
    let pageStale = false;
    /** Something of the page is seen: the screen on, the page shown, not behind an Android program. */
    const awake = () => (typeof sh.onScreen === 'function' ? sh.onScreen() : !document.hidden);
    const miniportWallet = () => !!(window.melatonContinuity && window.melatonContinuity.miniportOwns && window.melatonContinuity.miniportOwns('wallet_status'));
    /** The 5-minute wallet read (when the Miniport does not keep it) runs only while the phone is seen. */
    function syncPoll() {
        const on = awake();
        if (on && !pollTimer) pollTimer = setInterval(() => { if (!awake()) syncPoll(); else if (!miniportWallet()) refresh(); }, POLL_MS);
        else if (!on && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
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
            hide() { clearInterval(tickTimer); tickTimer = null; },
            onEnd() { clearInterval(tickTimer); tickTimer = null; page = null; sel = null; },
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
                options: [
                    { key: 'show', label: 'Show', choices: [['all', 'Balances for all accounts'], ['notices', 'Notices only'], ['balances', 'Just balances (in columns)']], value: 'all' },
                    // the accounts the wallet knows now (NovelAI's Anlas and usage apart)
                    { key: 'accounts', label: 'Accounts', type: 'checks', value: '', get choices() { return accountChoices(); } }
                ],
                render: renderToday,
                titanium: todayTitanium
            });
        }
        optionsPage();
        startPolling();
        checkSoon();
    }

    window.wmAccounts = { open: (t) => { if (t) tab = t; sh.open(APP_ID, { fromStart: true }); }, refresh: () => refresh({ force: true }), todayText: () => { todayCache.at = 0; return todayText(); }, options: openOptions, checkNotifications: checkNow };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
