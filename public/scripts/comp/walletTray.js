/**
 * Wallet tray icon (Yozora #430). One click opens a Vista notification-area flyout with two
 * tabs, Alerts and Status, for every connected account and API key; right-click = the wallet
 * menu (NovelAI standing, RunPod pods, Refresh, Service Keys). It replaces the NovelAI credits
 * and subscription-renewal tray icons and the RunPod tray icon.
 *
 *   Status   one row per account, a status dot on the left: NovelAI (Anlas fixed + paid,
 *            subscription and days left, V5 usage and refill a day), each Cursor profile,
 *            Claude (5-hour / 7-day windows), TokenRouter (balance), OpenAI (key status and
 *            month spend; OpenAI gives API keys no balance), RunPod (running pods, spend an
 *            hour, balance)
 *   Alerts   out of / almost out of usage, NovelAI renewal within 7 days, fixed Anlas about to
 *            expire, account standing. Opens first while this session has alerts it has not
 *            shown yet (sessionStorage); a yellow triangle marks the icon while any is active.
 *
 * Data: NovelAI from optionsData (balance, user.subscription, opusUsage); the rest from the
 * wallet_status packet (modules/walletStatus.js, admin only; restricted users see NovelAI).
 *
 *   walletTray.update()                  repaint the icon (and the open flyout) from current data
 *   walletTray.refresh({ force })        ask the server again
 *   walletTray.toggleFlyout(anchor, tab) / attachMenu(anchor)
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const POLL_MS = 5 * 60 * 1000;
    const LIVE_TICK_MS = 30 * 1000;
    const SEEN_KEY = 'sf_wallet_seen_alerts';
    const DAY_MS = 24 * 60 * 60 * 1000;
    const WEEK_MS = 7 * DAY_MS;
    const TIER_NAMES = { 0: 'Free', 1: 'Tablet', 2: 'Scroll', 3: 'Opus' };

    let server = null;       // last wallet_status data
    let serverError = '';
    let restricted = false;
    let loading = false;
    let pollTimer = null;
    let tickTimer = null;
    let wired = false;
    let icon = null;
    let flyout = null;
    let flyoutAnchor = null;
    let flyoutTimer = null;
    let activeTab = 'status';
    let freshIds = new Set(); // alerts this flyout showed for the first time

    // ---- formatting ---------------------------------------------------------------------------

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function num(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function count(value) {
        const n = num(value);
        return n == null ? '-' : Math.round(n).toLocaleString('en-US');
    }

    function usd(value) {
        const n = num(value);
        if (n == null) return '-';
        if (n !== 0 && Math.abs(n) < 0.01) return `$${n.toFixed(3)}`;
        return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
    }

    function plural(n, word) {
        return `${n} ${word}${n === 1 ? '' : 's'}`;
    }

    // "12 minutes" / "5 hours" / "3 days" until (or since) a time
    function span(ms) {
        const mins = Math.max(0, Math.round(Math.abs(ms) / 60000));
        if (mins < 90) return plural(Math.max(1, mins), 'minute');
        const hours = Math.round(mins / 60);
        if (hours < 48) return plural(hours, 'hour');
        return plural(Math.round(hours / 24), 'day');
    }

    function percentText(value) {
        const n = num(value);
        return n == null ? '-' : `${Math.round(n)}%`;
    }

    // ---- NovelAI (client data) ----------------------------------------------------------------

    function renewalData(expiresAtUnix, now) {
        // getSubscriptionRenewalDisplayData: public/scripts/comp/trayIndicators.js
        if (typeof root.getSubscriptionRenewalDisplayData === 'function') {
            return root.getSubscriptionRenewalDisplayData(expiresAtUnix);
        }
        const ms = expiresAtUnix * 1000 - now;
        return {
            msUntilRenewal: ms,
            hoursUntilRenewal: Math.ceil(ms / 3600000),
            daysUntilRenewal: Math.ceil(ms / DAY_MS),
            timeRemaining: span(ms),
            renewalDateTimeStr: new Date(expiresAtUnix * 1000).toLocaleString()
        };
    }

    function novelAiData(now = Date.now()) {
        const opts = root.optionsData || null;
        // isAccountDataDeferred: public/scripts/comp/accountDataBootstrap.js
        const deferred = typeof root.isAccountDataDeferred === 'function' && root.isAccountDataDeferred();
        const standing = typeof root.resolveAccountStanding === 'function' ? root.resolveAccountStanding() : 'unknown';
        const incident = typeof root.getActiveUpstreamIncident === 'function' ? root.getActiveUpstreamIncident() : null;
        const balance = opts && opts.balance && !deferred ? opts.balance : null;
        const sub = opts && opts.user && opts.user.subscription && typeof opts.user.subscription === 'object' ? opts.user.subscription : null;
        const tier = sub ? num(sub.tier) : null;
        const usage = (opts && (opts.opusUsage || (sub && sub.usage))) || null;
        const out = {
            deferred,
            standing,
            banMessage: standing === 'banned' && typeof root.getBanMessage === 'function' ? root.getBanMessage() : '',
            incident,
            hasBalance: !!balance,
            fixed: balance ? num(balance.fixedTrainingStepsLeft) || 0 : null,
            paid: balance ? num(balance.purchasedTrainingSteps) || 0 : null,
            total: balance ? num(balance.totalCredits) : null,
            tier,
            tierName: tier == null ? '' : (TIER_NAMES[tier] || 'Unknown'),
            renewal: sub && num(sub.expiresAt) ? renewalData(num(sub.expiresAt), now) : null,
            expiresAt: sub && num(sub.expiresAt) ? num(sub.expiresAt) * 1000 : null,
            v5: null
        };
        if (tier === 3 && sub.active !== false && usage) {
            const percent = num(usage.percent);
            const remaining = usage.isNegative ? 0 : Math.max(0, percent == null ? 0 : percent);
            const seconds = num(usage.timeUntilNextPercent);
            const refill = seconds && seconds > 0 ? Math.round((86400 / seconds) * 10) / 10 : 0;
            out.v5 = {
                remaining,
                used: Math.max(0, Math.round(100 - remaining)),
                extended: remaining > 100,
                negative: usage.isNegative === true,
                refillPerDay: refill
            };
        }
        return out;
    }

    // ---- rows and alerts ----------------------------------------------------------------------

    function alert(list, id, level, service, title, text) {
        list.push({ id, level, service, title, text: text || '' });
    }

    function worst(levels) {
        if (levels.includes('bad')) return 'bad';
        if (levels.includes('warn')) return 'warn';
        if (levels.includes('off')) return 'off';
        return 'ok';
    }

    function novelAiRow(n, alerts) {
        const lines = [];
        const levels = [];
        if (n.deferred) {
            return { key: 'novelai', service: 'novelai', dot: 'off', name: 'NovelAI', value: '', lines: ['Account data unavailable'] };
        }
        if (n.standing === 'banned') {
            levels.push('bad');
            lines.push('Account banned');
            alert(alerts, 'novelai:banned', 'critical', 'NovelAI', 'NovelAI account banned', n.banMessage || 'Image generation is blocked for this account.');
        } else if (n.incident) {
            const outage = n.incident.severity === 'outage' || num(n.incident.statusCode) >= 400;
            levels.push(outage ? 'bad' : 'warn');
            lines.push(`${n.incident.component}: ${n.incident.status}`);
            alert(alerts, `novelai:incident:${n.incident.key || n.incident.component}`, outage ? 'critical' : 'warning',
                'NovelAI', `NovelAI ${n.incident.component}: ${n.incident.status}`, 'See status.novelai.net.');
        }
        if (n.hasBalance) {
            if (n.total === -1) {
                levels.push('warn');
                lines.push('Anlas: balance unavailable');
            } else {
                lines.push(`Anlas: ${count(n.fixed)} fixed, ${count(n.paid)} paid`);
                if (n.total === 0) {
                    levels.push('bad');
                    alert(alerts, 'novelai:anlas:out', 'critical', 'NovelAI', 'Out of Anlas', 'NovelAI has no fixed or paid Anlas left.');
                } else if (n.total != null && n.total < 250) {
                    levels.push('warn');
                    alert(alerts, 'novelai:anlas:low', 'warning', 'NovelAI', 'Anlas almost used up', `${count(n.total)} Anlas left.`);
                }
            }
        } else {
            levels.push('off');
            lines.push('Anlas: loading...');
        }
        if (n.tier != null) {
            const r = n.renewal;
            if (n.tier > 0 && r && r.msUntilRenewal > 0) {
                lines.push(`${n.tierName}: renews in ${r.timeRemaining}`);
                if (r.msUntilRenewal <= WEEK_MS) {
                    levels.push('warn');
                    alert(alerts, `novelai:renewal:${n.expiresAt}`, 'warning', 'NovelAI',
                        `${n.tierName} subscription renews in ${r.timeRemaining}`, r.renewalDateTimeStr);
                }
                // checkFixedTrainingSteps (trayIndicators.js): more than 500 fixed Anlas in the last 15 days
                const days = Math.max(1, r.daysUntilRenewal);
                if (n.fixed > 500 && r.daysUntilRenewal <= 15) {
                    const pace = r.hoursUntilRenewal < 96
                        ? `${Math.max(1, Math.round(n.fixed / Math.max(1, r.hoursUntilRenewal)))} an hour`
                        : `${Math.round(n.fixed / days)} a day`;
                    alert(alerts, `novelai:fixed-expiring:${n.expiresAt}`, 'warning', 'NovelAI',
                        `${count(n.fixed)} fixed Anlas expire in ${r.timeRemaining}`, `Use about ${pace} to burn them before renewal.`);
                }
            } else {
                lines.push(n.tier > 0 ? `${n.tierName}: renewal date unknown` : 'No subscription');
            }
        }
        if (n.v5) {
            const v = n.v5;
            const refill = v.refillPerDay > 0 ? `refills ${v.refillPerDay}% a day` : 'not refilling';
            lines.push(v.extended
                ? `V5 usage: +${Math.round(v.remaining - 100)}% extended, ${refill}`
                : `V5 usage: ${v.used}% used, ${refill}`);
            if (v.negative || v.remaining <= 0) {
                levels.push('bad');
                alert(alerts, 'novelai:v5:out', 'critical', 'NovelAI', 'Opus V5 usage used up', `The meter ${refill}.`);
            } else if (v.used >= 95) {
                levels.push('warn');
                alert(alerts, 'novelai:v5:high', 'warning', 'NovelAI', 'Opus V5 usage almost used up', `${Math.round(v.remaining)}% left, ${refill}.`);
            }
        }
        return {
            key: 'novelai',
            service: 'novelai',
            dot: worst(levels),
            name: n.tierName && n.tier > 0 ? `NovelAI ${n.tierName}` : 'NovelAI',
            value: n.hasBalance && n.total != null && n.total >= 0 ? `${count(n.total)} Anlas` : '',
            lines
        };
    }

    function cursorRows(data, alerts) {
        const accounts = data && Array.isArray(data.accounts) ? data.accounts : [];
        return accounts.map((acc) => {
            const who = acc.personas && acc.personas.length ? ` (${acc.personas.join(', ')})` : '';
            const name = `Cursor: ${acc.name}${who}`;
            const lines = [];
            if (acc.percent == null) {
                lines.push(`Usage unavailable${acc.error ? `: ${acc.error}` : ''}`);
                return { key: `cursor:${acc.id}`, service: 'cursor', dot: 'off', name, value: '', lines, title: acc.email || '' };
            }
            const bits = [acc.plan, acc.daysLeft != null ? `${plural(acc.daysLeft, 'day')} left` : '', acc.costLabel ? `${acc.costLabel} API` : ''].filter(Boolean);
            if (bits.length) lines.push(bits.join(', '));
            if (acc.autoPercent != null || acc.apiPercent != null) {
                lines.push(`Auto ${percentText(acc.autoPercent)}, other models ${percentText(acc.apiPercent)}`);
            }
            let dot = 'ok';
            if (acc.percent >= 100 || acc.limited) {
                dot = 'bad';
                alert(alerts, `cursor:${acc.id}:out`, 'critical', 'Cursor', `${acc.name}: included usage used up`, 'Further requests may not be processed until the cycle resets.');
            } else if (acc.percent >= 90) {
                dot = 'warn';
                alert(alerts, `cursor:${acc.id}:high`, 'warning', 'Cursor', `${acc.name}: ${percentText(acc.percent)} of included usage used`,
                    acc.daysLeft != null ? `${plural(acc.daysLeft, 'day')} left in the cycle.` : '');
            }
            return { key: `cursor:${acc.id}`, service: 'cursor', dot, name, value: percentText(acc.percent), lines, title: acc.email || '' };
        });
    }

    function claudeWindow(label, id, row, now, alerts, levels) {
        if (!row || row.percent == null) return `${label}: -`;
        if (row.resetsAt && row.resetsAt <= now) return `${label}: reset ${span(now - row.resetsAt)} ago`;
        const resets = row.resetsAt ? `, resets in ${span(row.resetsAt - now)}` : '';
        if (row.percent >= 100) {
            levels.push('bad');
            alert(alerts, `claude:${id}:${row.resetsAt}:out`, 'critical', 'Claude', `Claude ${label.toLowerCase()} limit reached`,
                row.resetsAt ? `Resets in ${span(row.resetsAt - now)}.` : '');
        } else if (row.percent >= 90) {
            levels.push('warn');
            alert(alerts, `claude:${id}:${row.resetsAt}:high`, 'warning', 'Claude', `Claude ${label.toLowerCase()} window ${row.percent}% used`,
                row.resetsAt ? `Resets in ${span(row.resetsAt - now)}.` : '');
        }
        return `${label}: ${row.percent}% used${resets}`;
    }

    function claudeRow(data, now, alerts) {
        if (!data.at) {
            return { key: 'claude', service: 'claude', dot: 'off', name: 'Claude', value: '', lines: ['Usage shows after the first Claude turn'] };
        }
        const levels = [];
        const lines = [
            claudeWindow('5 hours', 'five_hour', data.fiveHour, now, alerts, levels),
            claudeWindow('7 days', 'seven_day', data.sevenDay, now, alerts, levels),
            `As of the last Claude turn, ${span(now - data.at)} ago`
        ];
        const live = [data.fiveHour, data.sevenDay].filter((row) => row && row.percent != null && !(row.resetsAt && row.resetsAt <= now));
        const top = live.length ? Math.max(...live.map((row) => row.percent)) : null;
        return { key: 'claude', service: 'claude', dot: worst(levels), name: 'Claude', value: top == null ? '' : `${top}%`, lines };
    }

    function tokenRouterRow(data, alerts) {
        if (!data.managementKey) {
            return { key: 'tokenrouter', service: 'tokenrouter', dot: 'off', name: 'TokenRouter', value: '',
                lines: ['Add the management key in Security Center to see the balance'] };
        }
        if (data.error) {
            return { key: 'tokenrouter', service: 'tokenrouter', dot: 'off', name: 'TokenRouter', value: '', lines: [`Balance unavailable: ${data.error}`] };
        }
        let dot = 'ok';
        if (data.remaining <= 0) {
            dot = 'bad';
            alert(alerts, 'tokenrouter:out', 'critical', 'TokenRouter', 'TokenRouter balance used up', 'Top up to keep the TokenRouter engine running.');
        } else if (data.remaining < 2) {
            dot = 'warn';
            alert(alerts, 'tokenrouter:low', 'warning', 'TokenRouter', `TokenRouter balance low: ${usd(data.remaining)}`, '');
        }
        return {
            key: 'tokenrouter', service: 'tokenrouter', dot, name: 'TokenRouter', value: usd(data.remaining),
            lines: [`Top-up ${usd(data.topUp)} + vouchers ${usd(data.vouchers)}`, `Spent ${usd(data.spent)}`]
        };
    }

    function openAiRow(data, alerts) {
        const lines = [];
        let dot = 'ok';
        if (data.keyState === 'fail') {
            dot = 'bad';
            lines.push(data.keyMessage || 'Key refused');
            alert(alerts, 'openai:key:fail', 'critical', 'OpenAI', 'OpenAI refused the API key', data.keyMessage || '');
        } else if (data.keyState === 'warn') {
            dot = 'warn';
            lines.push(data.keyMessage || 'Key could not be confirmed');
            if (/HTTP (402|429)/.test(data.keyMessage || '')) {
                alert(alerts, 'openai:key:limited', 'warning', 'OpenAI', 'OpenAI key is limited', data.keyMessage);
            }
        } else if (data.keyState === 'ok') {
            lines.push('API key accepted');
        } else {
            dot = 'off';
            lines.push('API key not checked yet');
        }
        lines.push(data.spentThisMonth != null ? `This month: ${usd(data.spentThisMonth)} spent` : 'Balance is not reported to API keys');
        return { key: 'openai', service: 'openai', dot, name: 'OpenAI', value: data.spentThisMonth != null ? usd(data.spentThisMonth) : '', lines,
            title: data.spendError || 'OpenAI only shows the prepaid balance on platform.openai.com' };
    }

    // data: the wallet_status runpod block, or { pods } alone for a restricted user
    function runpodRow(data, alerts) {
        const pods = Array.isArray(data.pods) ? data.pods : [];
        const lines = [];
        const running = pods.filter((pod) => pod.status === 'running' || pod.status === 'starting');
        lines.push(pods.length ? `${running.length} of ${plural(pods.length, 'pod')} running` : 'No managed pods');
        running.forEach((pod) => {
            const rate = num(pod.costPerHr);
            const started = Date.parse(pod.lastStartedAt);
            const run = rate != null && Number.isFinite(started) ? rate * Math.max(0, (Date.now() - started) / 3600000) : null;
            const cost = [rate != null ? `${usd(rate)} an hour` : '', run != null ? `${usd(run)} this run` : ''].filter(Boolean).join(', ');
            lines.push(`${pod.name}: ${pod.status === 'starting' ? 'starting' : 'running'}${cost ? `, ${cost}` : ''}`);
        });
        const busy = pods.some((pod) => pod.status === 'starting' || pod.status === 'stopping');
        let dot = pods.some((pod) => pod.error) ? 'warn' : 'ok';
        if (data.error) {
            lines.push(`Balance unavailable: ${data.error}`);
            return { key: 'runpod', service: 'runpod', dot: 'off', name: 'RunPod', value: '', lines };
        }
        const balance = num(data.balance);
        if (balance == null) {
            return { key: 'runpod', service: 'runpod', dot: busy ? 'warn' : dot, name: 'RunPod', value: '', lines };
        }
        const spend = num(data.spendPerHr);
        if (spend != null) lines.push(`Spending ${usd(spend)} an hour`);
        const hoursLeft = spend && spend > 0 && balance > 0 ? balance / spend : null;
        if (balance <= 0) {
            dot = 'bad';
            alert(alerts, 'runpod:out', 'critical', 'RunPod', 'RunPod balance used up', 'Pods stop when the balance runs out.');
        } else if ((hoursLeft != null && hoursLeft < 24) || balance < 2) {
            dot = 'warn';
            alert(alerts, 'runpod:low', 'warning', 'RunPod', `RunPod balance low: ${usd(balance)}`,
                hoursLeft != null && hoursLeft < 24 * 30 ? `About ${span(hoursLeft * 3600000)} left at the current spend.` : '');
        }
        if (hoursLeft != null && running.length) lines.push(`About ${span(hoursLeft * 3600000)} left at this spend`);
        return { key: 'runpod', service: 'runpod', dot: busy && dot === 'ok' ? 'warn' : dot, name: 'RunPod', value: usd(balance), lines };
    }

    // The RunPod tray snapshot (runpodTray.js) gets pod pushes between wallet refreshes
    function runpodLive() {
        const snap = typeof root.getRunpodTraySnapshot === 'function' ? root.getRunpodTraySnapshot() : null;
        return snap && Array.isArray(snap.pods) && snap.fetchedAt ? snap : null;
    }

    /** { rows, alerts } from NovelAI client data + the last wallet_status snapshot. */
    function model(now = Date.now()) {
        const alerts = [];
        const rows = [novelAiRow(novelAiData(now), alerts)];
        const s = server || {};
        if (s.cursor && !s.cursor.error) rows.push(...cursorRows(s.cursor, alerts));
        if (s.claude && !s.claude.error) rows.push(claudeRow(s.claude, now, alerts));
        if (s.tokenrouter) rows.push(tokenRouterRow(s.tokenrouter, alerts));
        if (s.openai && !s.openai.error) rows.push(openAiRow(s.openai, alerts));
        const live = runpodLive();
        if (s.runpod) rows.push(runpodRow(live && live.pods.length ? { ...s.runpod, pods: live.pods } : s.runpod, alerts));
        else if (restricted && live && live.pods.length) rows.push(runpodRow({ pods: live.pods }, alerts));
        alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1));
        return { rows, alerts };
    }

    // ---- seen alerts (this session) -----------------------------------------------------------

    function seenSet() {
        try {
            const raw = root.sessionStorage && root.sessionStorage.getItem(SEEN_KEY);
            return new Set(raw ? JSON.parse(raw) : []);
        } catch (_) {
            return new Set();
        }
    }

    function markSeen(alerts) {
        const seen = seenSet();
        alerts.forEach((a) => seen.add(a.id));
        try {
            if (root.sessionStorage) root.sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
        } catch (_) { /* private mode */ }
    }

    function unseen(alerts) {
        const seen = seenSet();
        return alerts.filter((a) => !seen.has(a.id));
    }

    // ---- tray icon ----------------------------------------------------------------------------

    function bootPending() {
        return typeof root.isDesktopTrayBootPending === 'function' && root.isDesktopTrayBootPending();
    }

    function iconTitle(rows, alerts) {
        const lines = ['Wallet'];
        rows.forEach((row) => {
            if (row.value) lines.push(`${row.name}: ${row.value}`);
        });
        if (alerts.length) lines.push(plural(alerts.length, 'alert'));
        return lines.join('\n');
    }

    /** options.reveal: false hides it (tray boot), true shows it; otherwise shown once the tray booted. */
    function update(options = {}) {
        icon = icon || (doc && doc.getElementById('walletTrayIcon'));
        if (!icon) return;
        const { rows, alerts } = model();
        const mark = icon.querySelector('.wallet-tray-alert');
        if (mark) mark.classList.toggle('hidden', !alerts.length);
        icon.classList.toggle('has-alerts', alerts.length > 0);
        const title = iconTitle(rows, alerts);
        icon.title = title;
        icon.setAttribute('aria-label', title);
        // Tray boot reveals it (systemTrayManager.js revealPlan); later repaints never hide it
        if (options.reveal === false) icon.classList.add('hidden');
        else if (options.reveal === true || !bootPending()) icon.classList.remove('hidden');
        renderFlyout();
    }

    // ---- server data --------------------------------------------------------------------------

    function ws() {
        return root.wsClient || null;
    }

    async function refresh(options = {}) {
        const client = ws();
        if (!client || typeof client.sendMessage !== 'function' || (typeof client.isConnected === 'function' && !client.isConnected())) return;
        if (loading && !options.force) return;
        loading = true;
        renderFlyout();
        try {
            const data = await client.sendMessage('wallet_status', { refresh: options.force === true }, false);
            restricted = !!(data && data.restricted);
            if (data && !data.restricted) server = data;
            serverError = '';
        } catch (error) {
            serverError = (error && error.message) || 'Wallet status unavailable';
        } finally {
            loading = false;
            update();
        }
    }

    // ---- flyout -------------------------------------------------------------------------------

    function ensureFlyout() {
        if (flyout || !doc) return flyout;
        flyout = doc.createElement('div');
        flyout.id = 'walletTrayFlyout';
        flyout.className = 'wallet-flyout hidden';
        flyout.setAttribute('role', 'dialog');
        flyout.setAttribute('aria-label', 'Wallet');
        flyout.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const tab = ev.target.closest('[data-wallet-tab]');
            if (tab) {
                setTab(tab.dataset.walletTab);
                return;
            }
            const link = ev.target.closest('[data-wallet-action]');
            if (!link) return;
            runAction(link.dataset.walletAction);
        });
        doc.body.appendChild(flyout);
        // Outside click / Escape closes it, like Vista's flyouts
        doc.addEventListener('pointerdown', (ev) => {
            if (!flyout || flyout.classList.contains('hidden')) return;
            if (flyout.contains(ev.target) || (flyoutAnchor && flyoutAnchor.contains(ev.target))) return;
            hideFlyout();
        }, true);
        doc.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && flyout && !flyout.classList.contains('hidden')) hideFlyout();
        }, true);
        return flyout;
    }

    function setTab(tab) {
        activeTab = tab === 'alerts' ? 'alerts' : 'status';
        update();
    }

    function rowHtml(row) {
        const dotTitle = { ok: 'OK', warn: 'Needs attention', bad: 'Out', off: 'Unavailable' }[row.dot] || '';
        return `
            <div class="wallet-row" data-wallet-row="${esc(row.key)}"${row.title ? ` title="${esc(row.title)}"` : ''}>
                <span class="wallet-dot wallet-dot-${esc(row.dot)}" title="${esc(dotTitle)}"></span>
                <div class="wallet-row-text">
                    <div class="wallet-row-head">
                        <span class="wallet-row-name">${esc(row.name)}</span>
                        ${row.value ? `<span class="wallet-row-value">${esc(row.value)}</span>` : ''}
                    </div>
                    ${row.lines.map((line) => `<span class="wallet-row-sub">${esc(line)}</span>`).join('')}
                </div>
            </div>`;
    }

    function alertHtml(a, fresh) {
        const glyph = a.level === 'critical' ? 'fas fa-circle-xmark' : 'fas fa-triangle-exclamation';
        return `
            <div class="wallet-alert wallet-alert-${esc(a.level)}${fresh ? ' wallet-alert-new' : ''}">
                <i class="${glyph} wallet-alert-icon" aria-hidden="true"></i>
                <div class="wallet-row-text">
                    <span class="wallet-alert-title">${esc(a.title)}</span>
                    <span class="wallet-row-sub">${esc(a.service)}${a.text ? ` - ${esc(a.text)}` : ''}</span>
                </div>
            </div>`;
    }

    function renderFlyout() {
        if (!flyout || flyout.classList.contains('hidden')) return;
        const { rows, alerts } = model();
        let body;
        if (activeTab === 'alerts') {
            // Shown now = seen for this session; the first showing keeps its highlight while open
            const newly = unseen(alerts);
            if (newly.length) {
                newly.forEach((a) => freshIds.add(a.id));
                markSeen(alerts);
            }
            body = alerts.length
                ? alerts.map((a) => alertHtml(a, freshIds.has(a.id))).join('')
                : '<div class="wallet-empty"><i class="fas fa-circle-check" aria-hidden="true"></i> There are no alerts.</div>';
        } else {
            body = rows.map(rowHtml).join('');
            if (restricted) body += '<div class="wallet-note">Other accounts are shown to administrators.</div>';
            else if (serverError && !server) body += `<div class="wallet-note">Other accounts unavailable: ${esc(serverError)}</div>`;
            else if (!server && loading) body += '<div class="wallet-note">Checking accounts...</div>';
        }
        const tab = (id, label, extra) => `<button type="button" class="wallet-tab${activeTab === id ? ' active' : ''}" role="tab"
            aria-selected="${activeTab === id}" data-wallet-tab="${id}">${label}${extra || ''}</button>`;
        const alertBadge = alerts.length ? ` <span class="wallet-tab-count">(${alerts.length})</span>` : '';
        const html = `
            <div class="wallet-tabs" role="tablist">${tab('alerts', 'Alerts', alertBadge)}${tab('status', 'Status')}</div>
            <div class="wallet-flyout-body" role="tabpanel">${body}</div>
            <div class="wallet-flyout-links">
                <button type="button" class="wallet-flyout-link" data-wallet-action="refresh"${loading ? ' disabled' : ''}>${loading ? 'Refreshing...' : 'Refresh'}</button>
                ${restricted ? '' : '<button type="button" class="wallet-flyout-link" data-wallet-action="keys">Service keys</button>'}
            </div>`;
        if (flyout.innerHTML !== html) {
            const scroller = flyout.querySelector('.wallet-flyout-body');
            const top = scroller ? scroller.scrollTop : 0;
            flyout.innerHTML = html;
            const next = flyout.querySelector('.wallet-flyout-body');
            if (next && top) next.scrollTop = top;
            positionFlyout();
        }
    }

    function positionFlyout() {
        if (!flyout || !doc) return;
        const width = flyout.offsetWidth || 340;
        const margin = 8;
        let rect = flyoutAnchor ? flyoutAnchor.getBoundingClientRect() : null;
        if (!rect || !rect.width) {
            // No visible anchor (tray still hidden during boot): the notification-area corner
            const taskbar = doc.getElementById('desktopTaskbar');
            const top = taskbar && taskbar.getBoundingClientRect().height ? taskbar.getBoundingClientRect().top : root.innerHeight - 40;
            rect = { right: root.innerWidth - margin, top };
        }
        const right = Math.max(margin, root.innerWidth - rect.right - 12);
        const left = Math.min(root.innerWidth - width - margin, root.innerWidth - right - width);
        flyout.style.left = `${Math.max(margin, left)}px`;
        flyout.style.bottom = `${Math.max(margin, root.innerHeight - rect.top + 6)}px`;
        flyout.style.maxHeight = `${Math.max(160, rect.top - margin - 6)}px`;
    }

    function showFlyout(anchor, tab) {
        if (!ensureFlyout()) return;
        // The network flyout shares the corner
        if (root.melatonControlPanel && typeof root.melatonControlPanel.hideTrayFlyout === 'function') root.melatonControlPanel.hideTrayFlyout();
        flyoutAnchor = anchor || null;
        activeTab = tab || (unseen(model().alerts).length ? 'alerts' : 'status');
        freshIds = new Set();
        flyout.classList.remove('hidden');
        update();
        positionFlyout();
        refresh({ force: true });
        if (flyoutTimer) clearInterval(flyoutTimer);
        flyoutTimer = setInterval(() => {
            if (!flyout || flyout.classList.contains('hidden')) { clearInterval(flyoutTimer); flyoutTimer = null; return; }
            renderFlyout();
        }, LIVE_TICK_MS);
    }

    function hideFlyout() {
        if (flyoutTimer) clearInterval(flyoutTimer);
        flyoutTimer = null;
        freshIds = new Set();
        if (flyout) flyout.classList.add('hidden');
    }

    function toggleFlyout(anchor, tab) {
        if (flyout && !flyout.classList.contains('hidden')) {
            hideFlyout();
            return;
        }
        showFlyout(anchor, tab);
    }

    function runAction(action) {
        if (action === 'refresh') {
            refresh({ force: true });
        } else if (action === 'keys') {
            hideFlyout();
            // openSecurityCenterDsap: public/scripts/comp/securityCenterDsapApplet.js (Service Keys live on the auth view)
            if (typeof root.openSecurityCenterDsap === 'function') root.openSecurityCenterDsap('auth');
        }
    }

    // ---- right-click menu ---------------------------------------------------------------------

    function runpodShown() {
        const live = runpodLive();
        return !!(server && server.runpod) || !!(live && live.pods.length);
    }

    function attachMenu(anchor) {
        const menu = root.contextMenu;
        if (!anchor || !menu || anchor.dataset.walletMenu === '1') return;
        anchor.dataset.walletMenu = '1';
        menu.attachToElement(anchor, {
            maxHeight: true,
            sections: [
                {
                    type: 'list',
                    title: 'NovelAI',
                    initfn: (section) => {
                        // buildCreditsTrayStatusMenuItems: public/scripts/comp/novelAiAccountStatus.js
                        section.items = typeof root.buildCreditsTrayStatusMenuItems === 'function' ? root.buildCreditsTrayStatusMenuItems() : [];
                    },
                    items: []
                },
                {
                    type: 'list',
                    initfn: (section) => {
                        // buildRunpodTrayMenuItems: public/scripts/comp/runpodTray.js (pod start / stop, Periscope logs)
                        const shown = runpodShown() && typeof root.buildRunpodTrayMenuItems === 'function';
                        section.title = shown ? 'RunPod' : '';
                        section.items = shown ? root.buildRunpodTrayMenuItems() : [];
                    },
                    items: []
                },
                {
                    type: 'list',
                    items: [
                        { icon: 'fas fa-triangle-exclamation', text: 'Alerts', action: 'wallet-open-alerts' },
                        { icon: 'fas fa-wallet', text: 'Status', action: 'wallet-open-status' },
                        { icon: 'fas fa-sync', text: 'Refresh', action: 'wallet-refresh' },
                        { icon: 'fas fa-key', text: 'Service keys', action: 'wallet-keys', hidden: () => restricted }
                    ]
                }
            ],
            onAction: (action, target, item) => {
                if (action === 'wallet-open-alerts' || action === 'wallet-open-status') {
                    showFlyout(anchor, action === 'wallet-open-alerts' ? 'alerts' : 'status');
                } else if (action === 'wallet-refresh') {
                    refresh({ force: true });
                } else if (action === 'wallet-keys') {
                    runAction('keys');
                } else if (String(action).startsWith('runpod-')) {
                    // handleRunpodTrayAction: public/scripts/comp/runpodTray.js
                    if (typeof root.handleRunpodTrayAction === 'function') root.handleRunpodTrayAction(action, item);
                } else if (doc) {
                    // NovelAI items (ban message, dismiss incident): mainMenuManager.js contextMenuAction
                    doc.dispatchEvent(new CustomEvent('contextMenuAction', { detail: { action, target, item, menu } }));
                }
            }
        });
    }

    // ---- wiring -------------------------------------------------------------------------------

    /** systemTrayManager.startBackgroundTrayServices: desktop only, once. */
    function init() {
        if (wired || !doc) return;
        icon = doc.getElementById('walletTrayIcon');
        if (!icon) return;
        wired = true;
        icon.addEventListener('click', () => toggleFlyout(icon));
        attachMenu(icon);
        update({ reveal: false });
        refresh();
        if (!pollTimer) pollTimer = setInterval(() => refresh(), POLL_MS);
        // Renewal countdowns, Claude window resets and run costs move with the clock
        if (!tickTimer) tickTimer = setInterval(() => update(), 60 * 1000);
        const client = ws();
        if (client && typeof client.registerRefreshCallback === 'function') {
            client.registerRefreshCallback('wallet-tray', 85, () => refresh());
        }
    }

    const api = {
        init,
        update,
        refresh,
        toggleFlyout,
        hideFlyout,
        attachMenu,
        model,
        isOpen: () => !!(flyout && !flyout.classList.contains('hidden')),
        _test: {
            novelAiData,
            cursorRows,
            claudeRow,
            tokenRouterRow,
            openAiRow,
            runpodRow,
            span,
            usd,
            unseen,
            markSeen,
            setServer: (data) => { server = data; restricted = false; },
            setRestricted: (value) => { restricted = !!value; }
        }
    };
    if (root) root.walletTray = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
