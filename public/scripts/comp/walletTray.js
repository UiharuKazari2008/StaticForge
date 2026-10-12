/**
 * Wallet tray icon (Yozora #430). One click opens a Vista notification-area flyout with two
 * tabs, Alerts and Status, for every connected account and API key; right-click = the wallet
 * menu (NovelAI standing, RunPod pods, Refresh, Service Keys). It replaces the NovelAI credits
 * and subscription-renewal tray icons and the RunPod tray icon.
 *
 *   Status   one row per account, a status dot on the left: NovelAI (Anlas fixed + paid,
 *            subscription and days left), each Cursor profile (a Log in link when it needs
 *            one), Claude (5-hour / 7-day windows), TokenRouter (balance), RunPod (running
 *            pods, spend an hour, balance). NovelAI V5, Cursor and Claude usage percents sit in
 *            a column on the right behind a divider (usageSide). No OpenAI: it gives API keys
 *            no balance, and work is moving to TokenRouter.
 *   Alerts   logins needed (with a Log in button), out of / almost out of usage, NovelAI
 *            renewal within 7 days, fixed Anlas about to expire, account standing. Opens first
 *            while this session has alerts it has not shown yet (sessionStorage); a yellow
 *            triangle marks the icon while any is active. Both panels are always laid out, so
 *            the Status height sizes the flyout and switching tabs never resizes it.
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
    // Each Status row fades in from the left in its provider's colour (Cursor profiles use
    // their own Security Center colour). NovelAI: the indigo between its navy (#15193E) and
    // lavender (#B29EF1), which alone wash out to grey / nothing. TokenRouter: tokenrouter.com
    // --tr-color-brand-primary.
    const BRAND = { novelai: '#4f46c8', cursor: '#555555', claude: '#d97757', tokenrouter: '#0086ff', runpod: '#7046e0' };

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
    const extraAnchors = [];  // other openers (the Director usage badge): clicks there toggle, not close

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

    // ---- V5 trend: using faster than it refills ------------------------------------------------

    // The meter refills by itself, so a lower reading than a while ago means usage outran the
    // refill. Readings live in sessionStorage so a tab reload keeps the last hour.
    const V5_SAMPLES_KEY = 'sf_wallet_v5_samples';
    const V5_TREND_MS = 60 * 60 * 1000;
    const V5_TREND_MIN_MS = 5 * 60 * 1000;

    function v5Samples() {
        try {
            const raw = root.sessionStorage && root.sessionStorage.getItem(V5_SAMPLES_KEY);
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (_) {
            return [];
        }
    }

    function v5Trend(remaining, now) {
        let samples = v5Samples().filter((s) => s && now - s.t <= 2 * V5_TREND_MS && s.t <= now);
        const last = samples[samples.length - 1];
        if (!last || last.r !== remaining || now - last.t >= V5_TREND_MIN_MS) samples.push({ t: now, r: remaining });
        samples = samples.slice(-120);
        try {
            if (root.sessionStorage) root.sessionStorage.setItem(V5_SAMPLES_KEY, JSON.stringify(samples));
        } catch (_) { /* private mode */ }
        // The oldest reading of the last hour that is at least 5 minutes old
        const base = samples.find((s) => now - s.t <= V5_TREND_MS && now - s.t >= V5_TREND_MIN_MS);
        if (!base || !(base.r > remaining)) return { draining: false };
        return { draining: true, drop: Math.round((base.r - remaining) * 10) / 10, minutes: Math.round((now - base.t) / 60000) };
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
            // accountDataBootstrap.js: a subscription that was active and is not any more
            renewalFailed: !!(opts && opts.subscriptionRenewalFailed),
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
                refillPerDay: refill,
                trend: v5Trend(remaining, now)
            };
        }
        return out;
    }

    // ---- rows and alerts ----------------------------------------------------------------------

    // action: { label, name, arg } = a button on the right of the alert (runAction)
    function alert(list, id, level, service, title, text, action) {
        list.push({ id, level, service, title, text: text || '', action: action || null });
    }

    function worst(levels) {
        if (levels.includes('bad')) return 'bad';
        if (levels.includes('warn')) return 'warn';
        if (levels.includes('off')) return 'off';
        return 'ok';
    }

    // Colours for figures and meters, the same everywhere: ok green, drain yellow (V5 used
    // faster than it refills), warn orange (low), bad red (empty or nearly empty).
    function usageLevel(percentUsed) {
        if (percentUsed >= 95) return 'bad';
        if (percentUsed >= 80) return 'warn';
        return 'ok';
    }

    // Balances: red at or under `empty`, orange under `low`
    function balanceLevel(amount, empty, low) {
        if (amount == null) return 'ok';
        if (amount <= empty) return 'bad';
        if (amount < low) return 'warn';
        return 'ok';
    }

    // The right-hand column: label, a big figure, an optional meter (percent used), a line
    function sideColumn(label, value, meter, level, line, title) {
        return { label, value, meter, level, lines: line ? [line] : [], title: title || '' };
    }

    // Two usage figures side by side (Claude 5 hours / 7 days, Cursor Auto / other models)
    function usageBar(caption, percent, extra) {
        const known = percent != null && Number.isFinite(Number(percent));
        return { caption, value: known ? `${Math.round(percent)}%` : '-', meter: known ? Number(percent) : 0, level: known ? usageLevel(percent) : 'ok', title: extra || '' };
    }

    const LEVEL_RANK = { ok: 0, drain: 1, warn: 2, bad: 3 };

    function barsColumn(label, bars, extraLevel, title, summary) {
        const level = bars.map((b) => b.level).concat(extraLevel || 'ok')
            .reduce((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a), 'ok');
        return { label, bars, level, lines: [], title: title || '', summary: summary || '' };
    }

    // A red or orange figure makes the dot at least amber; yellow (drain) does not
    function sideDot(side) {
        if (!side) return 'ok';
        return side.level === 'bad' ? 'bad' : side.level === 'warn' ? 'warn' : 'ok';
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
        if (n.renewalFailed) {
            levels.push('bad');
            lines.push('Subscription inactive: renewal failed');
            alert(alerts, 'novelai:renewal-failed', 'critical', 'NovelAI', 'NovelAI subscription renewal failed',
                'The subscription is no longer active. Renew it or update billing on novelai.net.',
                { label: 'NovelAI', name: 'novelai-site' });
        }
        // Anlas get their own column before V5 usage: fixed and paid, no combined total
        let anlas = null;
        if (n.hasBalance) {
            if (n.total === -1) {
                levels.push('warn');
                lines.push('Anlas: balance unavailable');
            } else {
                // Red under 250 in all (the "almost used up" alert), orange under 1,000
                const valueLevel = n.total <= 0 ? 'bad' : balanceLevel(n.total, 249, 1000);
                if (valueLevel !== 'ok') levels.push(valueLevel);
                anlas = {
                    label: 'Anlas',
                    level: valueLevel,
                    figures: [{ value: count(n.fixed), unit: 'fixed' }, { value: count(n.paid), unit: 'paid' }],
                    summary: `${count(n.fixed)} fixed, ${count(n.paid)} paid`,
                    lines: [],
                    title: 'Fixed Anlas come with the subscription and expire at renewal; paid Anlas stay'
                };
                if (n.total <= 0) {
                    alert(alerts, 'novelai:anlas:out', 'critical', 'NovelAI', 'Out of Anlas', 'NovelAI has no fixed or paid Anlas left.');
                } else if (valueLevel === 'bad') {
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
            } else if (!n.renewalFailed) {
                lines.push(n.tier > 0 ? `${n.tierName}: renewal date unknown` : 'No subscription');
            }
        }
        // V5 usage gets the right-hand column of the NovelAI group
        let side = null;
        if (n.v5) {
            const v = n.v5;
            const refill = v.refillPerDay > 0 ? `refills ${v.refillPerDay}% a day` : 'not refilling';
            let level = v.negative || v.remaining <= 0 ? 'bad' : usageLevel(v.used);
            if (level === 'bad' && (v.negative || v.remaining <= 0)) {
                alert(alerts, 'novelai:v5:out', 'critical', 'NovelAI', 'Opus V5 usage used up', `The meter ${refill}.`);
            } else if (level === 'bad') {
                alert(alerts, 'novelai:v5:high', 'warning', 'NovelAI', 'Opus V5 usage almost used up', `${Math.round(v.remaining)}% left, ${refill}.`);
            }
            if (level === 'ok' && v.trend.draining) level = 'drain';
            const draining = v.trend.draining ? `, down ${v.trend.drop}% in ${plural(v.trend.minutes, 'minute')}` : '';
            lines.push(`V5 ${refill}${v.trend.draining ? ' (using faster)' : ''}`);
            side = sideColumn('V5 usage',
                v.extended ? `+${Math.round(v.remaining - 100)}%` : `${v.used}%`,
                v.extended ? 0 : v.used,
                level,
                // NovelAI chunk 52 / module 42283: one percent is about 17.3 normal images
                v.extended ? 'extra free usage' : `~${count(17.3 * v.remaining)} images left`,
                `V5 usage: ${v.extended ? `+${Math.round(v.remaining - 100)}% extended` : `${v.used}% used`}, ${refill}${draining}`);
            levels.push(sideDot(side));
        }
        return {
            key: 'novelai',
            service: 'novelai',
            dot: worst(levels),
            name: n.tierName && n.tier > 0 ? `NovelAI ${n.tierName}` : 'NovelAI',
            value: '',
            lines,
            sides: [anlas, side].filter(Boolean),
            accent: BRAND.novelai
        };
    }

    function cursorRows(data, alerts) {
        const accounts = data && Array.isArray(data.accounts) ? data.accounts : [];
        return accounts.map((acc) => {
            const who = acc.personas && acc.personas.length ? ` (${acc.personas.join(', ')})` : '';
            const name = `Cursor: ${acc.name}${who}`;
            const lines = [];
            if (acc.needsLogin) {
                const login = { label: 'Log in', name: 'login', arg: acc.id };
                const expired = /expired/i.test(acc.error || '');
                lines.push({ text: `${expired ? 'Login expired' : 'Not logged in'}.`, link: login });
                const users = acc.personas && acc.personas.length
                    ? `${acc.personas.join(' and ')} use${acc.personas.length === 1 ? 's' : ''} this profile.`
                    : 'Its usage shows again after a login.';
                alert(alerts, `cursor:${acc.id}:login`, 'warning', 'Cursor',
                    `${acc.name}: Cursor ${expired ? 'login expired' : 'login needed'}`, users, login);
                return { key: `cursor:${acc.id}`, service: 'cursor', dot: 'warn', name, value: '', lines, title: acc.email || '' };
            }
            if (acc.percent == null) {
                lines.push(`Usage unavailable${acc.error ? `: ${acc.error}` : ''}`);
                return { key: `cursor:${acc.id}`, service: 'cursor', dot: 'off', name, value: '', lines, title: acc.email || '' };
            }
            const bits = [acc.plan, acc.daysLeft != null ? `${plural(acc.daysLeft, 'day')} left` : '', acc.costLabel ? `${acc.costLabel} API` : ''].filter(Boolean);
            if (bits.length) lines.push(bits.join(', '));
            const split = acc.autoPercent != null || acc.apiPercent != null;
            if (split) lines.push(`${percentText(acc.percent)} of included usage`);
            const levels = [];
            // The fullest pool decides: the total, Auto, or other models (each can run out alone)
            const pools = [['included usage', acc.limited ? 100 : acc.percent], ['Auto usage', acc.autoPercent], ['other-model usage', acc.apiPercent]]
                .filter(([, p]) => p != null && Number.isFinite(Number(p)))
                .reduce((top, pool) => (pool[1] > top[1] ? pool : top), ['included usage', -1]);
            const [pool, fullest] = pools;
            const detail = [split ? `Auto ${percentText(acc.autoPercent)}, other models ${percentText(acc.apiPercent)}` : '',
                acc.daysLeft != null ? `${plural(acc.daysLeft, 'day')} left in the cycle` : ''].filter(Boolean).join('; ');
            if (fullest >= 100) {
                levels.push('bad');
                alert(alerts, `cursor:${acc.id}:out`, 'critical', 'Cursor', `${acc.name}: ${pool} used up`,
                    `${detail ? `${detail}. ` : ''}Further requests may not be processed until the cycle resets.`);
            } else if (fullest >= 90) {
                levels.push('warn');
                alert(alerts, `cursor:${acc.id}:high`, 'warning', 'Cursor', `${acc.name}: ${percentText(fullest)} of ${pool} used`,
                    detail ? `${detail}.` : '');
            }
            // Auto and other models as two bars; the total (what the cycle limit counts) on the left
            const side = split
                ? barsColumn('Usage', [usageBar('Auto', acc.autoPercent), usageBar('Other', acc.apiPercent, 'Other models')],
                    acc.limited ? 'bad' : usageLevel(acc.percent), 'Included usage this billing cycle: Auto and other models', percentText(acc.percent))
                : sideColumn('Usage', percentText(acc.percent), acc.percent, acc.limited ? 'bad' : usageLevel(acc.percent),
                    '', 'Included usage this billing cycle');
            levels.push(sideDot(side));
            return { key: `cursor:${acc.id}`, service: 'cursor', dot: worst(levels), name, value: '', lines, title: acc.email || '', side };
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
        return `${label}:${resets ? resets.slice(1) : ` ${row.percent}% used`}`;
    }

    // A window past its reset is unknown until the next Claude turn: no figure
    function claudeBar(caption, row, now) {
        if (!row || row.percent == null) return usageBar(caption, null);
        if (row.resetsAt && row.resetsAt <= now) return usageBar(caption, null, 'Reset since the last Claude turn');
        return usageBar(caption, row.percent);
    }

    function claudeRow(data, now, alerts) {
        if (!data.at) {
            return { key: 'claude', service: 'claude', dot: 'off', name: 'Claude', value: '', lines: ['Usage shows after the first Claude turn'] };
        }
        const levels = [];
        const lines = [
            claudeWindow('5 hours', 'five_hour', data.fiveHour, now, alerts, levels),
            claudeWindow('7 days', 'seven_day', data.sevenDay, now, alerts, levels),
            `Updated ${span(now - data.at)} ago`
        ];
        // Both windows side by side
        const bars = [claudeBar('5 hours', data.fiveHour, now), claudeBar('7 days', data.sevenDay, now)];
        const side = barsColumn('Usage', bars, 'ok', '', bars.map((b) => `${b.caption} ${b.value}`).join(', '));
        levels.push(sideDot(side));
        return { key: 'claude', service: 'claude', dot: worst(levels), name: 'Claude', value: '', lines, side,
            title: 'Claude reports these windows on every Claude turn (Wren, Xi, the usage probe)' };
    }

    function tokenRouterRow(data, alerts) {
        if (!data.managementKey) {
            return { key: 'tokenrouter', service: 'tokenrouter', dot: 'off', name: 'TokenRouter', value: '',
                lines: ['Add the management key in Security Center to see the balance'] };
        }
        if (data.error) {
            return { key: 'tokenrouter', service: 'tokenrouter', dot: 'off', name: 'TokenRouter', value: '', lines: [`Balance unavailable: ${data.error}`] };
        }
        // Red at $1 or less, orange under $5
        const level = balanceLevel(data.remaining, 1, 5);
        if (data.remaining <= 0) {
            alert(alerts, 'tokenrouter:out', 'critical', 'TokenRouter', 'TokenRouter balance used up', 'Top up to keep the TokenRouter engine running.');
        } else if (level === 'bad') {
            alert(alerts, 'tokenrouter:low', 'warning', 'TokenRouter', `TokenRouter balance almost used up: ${usd(data.remaining)}`, 'Top up to keep the TokenRouter engine running.');
        }
        const side = sideColumn('Balance', usd(data.remaining), null, level, '', 'Top-up balance plus unexpired vouchers');
        return {
            key: 'tokenrouter', service: 'tokenrouter', dot: sideDot(side), name: 'TokenRouter', value: '',
            lines: [`Top-up ${usd(data.topUp)} + vouchers ${usd(data.vouchers)}`, `Spent ${usd(data.spent)}`],
            side
        };
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
        const levels = [pods.some((pod) => pod.error) || busy ? 'warn' : 'ok'];
        if (data.error) {
            lines.push(`Balance unavailable: ${data.error}`);
            return { key: 'runpod', service: 'runpod', dot: 'off', name: 'RunPod', value: '', lines };
        }
        const balance = num(data.balance);
        if (balance == null) {
            return { key: 'runpod', service: 'runpod', dot: worst(levels), name: 'RunPod', value: '', lines };
        }
        const spend = num(data.spendPerHr);
        if (spend != null) lines.push(`Spending ${usd(spend)} an hour`);
        const hoursLeft = spend && spend > 0 && balance > 0 ? balance / spend : null;
        // Red at $1 or less or under 12 hours of the current spend, orange under $5 or 48 hours
        let level = balanceLevel(balance, 1, 5);
        if (hoursLeft != null && hoursLeft < 12) level = 'bad';
        else if (hoursLeft != null && hoursLeft < 48 && level === 'ok') level = 'warn';
        if (balance <= 0) {
            alert(alerts, 'runpod:out', 'critical', 'RunPod', 'RunPod balance used up', 'Pods stop when the balance runs out.');
        } else if (level === 'bad') {
            alert(alerts, 'runpod:low', 'warning', 'RunPod', `RunPod balance almost used up: ${usd(balance)}`,
                hoursLeft != null && hoursLeft < 24 * 30 ? `About ${span(hoursLeft * 3600000)} left at the current spend.` : '');
        }
        if (hoursLeft != null && running.length) lines.push(`About ${span(hoursLeft * 3600000)} left at this spend`);
        const side = sideColumn('Balance', usd(balance), null, level, '', data.spendLimit ? `Spend limit ${usd(data.spendLimit)}` : '');
        levels.push(sideDot(side));
        return { key: 'runpod', service: 'runpod', dot: worst(levels), name: 'RunPod', value: '', lines, side };
    }

    // The RunPod tray snapshot (runpodTray.js) gets pod pushes between wallet refreshes
    function runpodLive() {
        const snap = typeof root.getRunpodTraySnapshot === 'function' ? root.getRunpodTraySnapshot() : null;
        return snap && Array.isArray(snap.pods) && snap.fetchedAt ? snap : null;
    }

    // Service keys: a service the tripwire stopped calling (Unlock), a key the check refused.
    // The matching account row turns red with the reason.
    function keyAlerts(keys, rows, alerts) {
        if (!keys) return;
        const mark = (service, text) => {
            const row = rows.find((r) => r.service === service);
            if (!row) return;
            row.dot = 'bad';
            row.lines = row.lines.concat(text);
        };
        (keys.locks || []).forEach((lock) => {
            const last = lock.lastStatus ? ` (last HTTP ${lock.lastStatus})` : '';
            alert(alerts, `keys:lock:${lock.service}:${lock.lockedAt || ''}`, 'critical', lock.label,
                `${lock.label} calls are blocked`,
                `Stopped after ${plural(lock.failureCount || 0, 'key error')}${last}. Fix the key, then unlock.`,
                { label: 'Unlock', name: 'unlock', arg: lock.service });
            mark(lock.service, 'Calls blocked after key errors');
        });
        (keys.failed || []).forEach((key) => {
            const which = key.slot === 'apiKey' ? 'API key' : key.slot === 'managementKey' ? 'management key' : 'key';
            const named = key.keyName ? ` "${key.keyName}"` : '';
            alert(alerts, `keys:fail:${key.service}:${key.slot}:${key.index}:${key.checkedAt || ''}`, 'critical', key.label,
                `${key.label} ${which}${named} refused`, key.message,
                { label: 'Service keys', name: 'keys' });
            mark(key.service, `${which.charAt(0).toUpperCase()}${which.slice(1)} refused`);
        });
    }

    function accentFor(row) {
        if (row.service === 'cursor') {
            const id = String(row.key).slice('cursor:'.length);
            const acc = server && server.cursor && Array.isArray(server.cursor.accounts) ? server.cursor.accounts.find((a) => a.id === id) : null;
            if (acc && /^#[0-9a-fA-F]{6}$/.test(acc.color || '')) return acc.color;
        }
        return BRAND[row.service] || '';
    }

    /** { rows, alerts } from NovelAI client data + the last wallet_status snapshot. */
    function model(now = Date.now()) {
        const alerts = [];
        const rows = [novelAiRow(novelAiData(now), alerts)];
        const s = server || {};
        if (s.cursor && !s.cursor.error) rows.push(...cursorRows(s.cursor, alerts));
        if (s.claude && !s.claude.error) rows.push(claudeRow(s.claude, now, alerts));
        if (s.tokenrouter) rows.push(tokenRouterRow(s.tokenrouter, alerts));
        const live = runpodLive();
        if (s.runpod) rows.push(runpodRow(live && live.pods.length ? { ...s.runpod, pods: live.pods } : s.runpod, alerts));
        else if (restricted && live && live.pods.length) rows.push(runpodRow({ pods: live.pods }, alerts));
        keyAlerts(s.keys, rows, alerts);
        rows.forEach((row) => { row.accent = row.accent || accentFor(row); });
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
        const lines = ['Account Manager'];
        rows.forEach((row) => {
            const bits = [row.value].concat(rowSides(row).map((side) => {
                const value = side.summary || side.value;
                return value && value !== '-' ? `${side.label} ${value}` : '';
            })).filter(Boolean);
            if (bits.length) lines.push(`${row.name}: ${bits.join(', ')}`);
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

    // force: ask even while a request is out (the server still reuses a snapshot under 20 s);
    // fresh: the server reads every account again (after a login).
    async function refresh(options = {}) {
        const client = ws();
        if (!client || typeof client.sendMessage !== 'function' || (typeof client.isConnected === 'function' && !client.isConnected())) return;
        if (loading && !options.force) return;
        loading = true;
        renderFlyout();
        try {
            const data = await client.sendMessage('wallet_status', { refresh: options.force === true, fresh: options.fresh === true }, false);
            restricted = !!(data && data.restricted);
            if (data && !data.restricted) server = data;
            serverError = '';
        } catch (error) {
            serverError = (error && error.message) || 'Account status unavailable';
        } finally {
            loading = false;
            update();
        }
    }

    // ---- Cursor login (same flow as Security Center's Login button) ---------------------------

    const pendingLogins = new Set();
    let loginWired = false;

    function wireLoginComplete(client) {
        if (loginWired || !client || typeof client.on !== 'function') return;
        loginWired = true;
        // Broadcast to every client when a guided login is saved (190-adminHandler.js)
        client.on('cursor_account_login_complete', (packet) => {
            const body = (packet && (packet.data || packet)) || {};
            if (pendingLogins.delete(body.accountId) && typeof root.showGlassToast === 'function') {
                if (body.success) {
                    root.showGlassToast('success', 'Cursor login', body.email ? `Saved login for ${body.email}` : 'Login saved for that profile', false, 5000, '<i class="fas fa-right-to-bracket"></i>');
                } else {
                    root.showGlassToast('error', 'Cursor login', body.message || 'Login did not finish', false, 6000);
                }
            }
            refresh({ force: true, fresh: true });
        });
    }

    async function loginCursor(accountId) {
        const client = ws();
        if (!accountId || !client || typeof client.loginCursorAccount !== 'function') return;
        wireLoginComplete(client);
        try {
            const response = await client.loginCursorAccount(accountId);
            const data = (response && response.data) || response;
            if (!data || !data.success || !data.url) throw new Error((data && data.message) || 'Login link did not appear');
            pendingLogins.add(accountId);
            root.open(data.url, '_blank', 'noopener,noreferrer');
            if (typeof root.showGlassToast === 'function') {
                root.showGlassToast('info', 'Cursor login', 'Finish signing in in the new tab. The wallet updates when Cursor accepts it.', false, 7000, '<i class="fas fa-right-to-bracket"></i>');
            }
        } catch (error) {
            if (typeof root.showGlassToast === 'function') {
                root.showGlassToast('error', 'Cursor login', (error && error.message) || 'Could not start login', false, 5000);
            }
        }
    }

    // ---- flyout -------------------------------------------------------------------------------

    // The shell stays; renderFlyout fills its parts. Both panels share one grid cell, so the
    // taller one (Status) sets the height and switching tabs never resizes the flyout.
    function ensureFlyout() {
        if (flyout || !doc) return flyout;
        flyout = doc.createElement('div');
        flyout.id = 'walletTrayFlyout';
        flyout.className = 'wallet-flyout hidden';
        flyout.setAttribute('role', 'dialog');
        flyout.setAttribute('aria-label', 'Account Manager');
        flyout.innerHTML = `
            <div class="wallet-tabs" role="tablist"></div>
            <div class="wallet-flyout-body">
                <div class="wallet-panels">
                    <div class="wallet-panel wallet-panel-status" role="tabpanel" aria-label="Status"></div>
                    <div class="wallet-panel wallet-panel-alerts" role="tabpanel" aria-label="Alerts"></div>
                </div>
            </div>
            <div class="wallet-flyout-links"></div>`;
        flyout.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const tab = ev.target.closest('[data-wallet-tab]');
            if (tab) {
                setTab(tab.dataset.walletTab);
                return;
            }
            const link = ev.target.closest('[data-wallet-action]');
            if (!link || link.disabled) return;
            runAction(link.dataset.walletAction, link.dataset.walletArg);
        });
        doc.body.appendChild(flyout);
        // Outside click / Escape closes it, like Vista's flyouts
        doc.addEventListener('pointerdown', (ev) => {
            if (!flyout || flyout.classList.contains('hidden')) return;
            if (flyout.contains(ev.target) || (flyoutAnchor && flyoutAnchor.contains(ev.target))) return;
            if (extraAnchors.some((el) => el.contains(ev.target))) return;
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

    function actionAttrs(action) {
        return `data-wallet-action="${esc(action.name)}"${action.arg != null ? ` data-wallet-arg="${esc(action.arg)}"` : ''}`;
    }

    // A line is text, or { text, link: { label, name, arg } } with a link after the text
    function lineHtml(line) {
        if (line && typeof line === 'object') {
            const link = line.link ? ` <button type="button" class="wallet-inline-link" ${actionAttrs(line.link)}>${esc(line.link.label)}</button>` : '';
            return `<span class="wallet-row-sub">${esc(line.text)}${link}</span>`;
        }
        return `<span class="wallet-row-sub">${esc(line)}</span>`;
    }

    // A column has one big value (+ meter), or several smaller figures with a unit (NovelAI Anlas)
    function sideHtml(side) {
        const meter = side.meter == null ? '' : `
                    <span class="wallet-meter" aria-hidden="true"><span class="wallet-meter-fill" style="width:${Math.max(0, Math.min(100, Number(side.meter) || 0))}%"></span></span>`;
        let figures;
        if (side.bars) {
            // Each bar carries its own colour, so the column has no level class
            figures = `
                    <span class="wallet-side-bars">${side.bars.map((bar) => `
                        <span class="wallet-side-bar wallet-level-${esc(bar.level)}"${bar.title ? ` title="${esc(bar.title)}"` : ''}>
                            <span class="wallet-side-caption">${esc(bar.caption)}</span>
                            <span class="wallet-side-value">${esc(bar.value)}</span>
                            <span class="wallet-meter" aria-hidden="true"><span class="wallet-meter-fill" style="width:${Math.max(0, Math.min(100, Number(bar.meter) || 0))}%"></span></span>
                        </span>`).join('')}
                    </span>`;
        } else if (side.figures) {
            figures = side.figures.map((fig) => `
                    <span class="wallet-side-figure"><span class="wallet-side-number">${esc(fig.value)}</span> <span class="wallet-side-unit">${esc(fig.unit)}</span></span>`).join('');
        } else {
            figures = `
                    <span class="wallet-side-value">${esc(side.value)}</span>${meter}`;
        }
        const kind = side.bars ? ' wallet-side-multi' : ` wallet-level-${esc(side.level)}${side.figures ? ' wallet-side-figures' : ''}`;
        return `
                <div class="wallet-row-side${kind}"${side.title ? ` title="${esc(side.title)}"` : ''}>
                    <span class="wallet-side-label">${esc(side.label)}</span>${figures}
                    ${(side.lines || []).map((line) => `<span class="wallet-row-sub">${esc(line)}</span>`).join('')}
                </div>`;
    }

    function rowSides(row) {
        return row.sides || (row.side ? [row.side] : []);
    }

    function rowHtml(row) {
        const dotTitle = { ok: 'OK', warn: 'Needs attention', bad: 'Out', off: 'Unavailable' }[row.dot] || '';
        const sides = rowSides(row);
        return `
            <div class="wallet-row${sides.length ? ' wallet-row-split' : ''}" data-wallet-row="${esc(row.key)}"${row.title ? ` title="${esc(row.title)}"` : ''}${/^#[0-9a-fA-F]{6}$/.test(row.accent || '') ? ` style="--wallet-accent:${row.accent}"` : ''}>
                <span class="wallet-dot wallet-dot-${esc(row.dot)}" title="${esc(dotTitle)}"></span>
                <div class="wallet-row-text">
                    <div class="wallet-row-head">
                        <span class="wallet-row-name">${esc(row.name)}</span>
                        ${row.value ? `<span class="wallet-row-value wallet-level-${esc(row.valueLevel || 'ok')}">${esc(row.value)}</span>` : ''}
                    </div>
                    ${row.lines.map(lineHtml).join('')}
                </div>${sides.map(sideHtml).join('')}
            </div>`;
    }

    function alertHtml(a, fresh) {
        const glyph = a.level === 'critical' ? 'fas fa-circle-xmark' : 'fas fa-triangle-exclamation';
        const button = a.action
            ? `<button type="button" class="wallet-alert-button" ${actionAttrs(a.action)}>${esc(a.action.label)}</button>`
            : '';
        return `
            <div class="wallet-alert wallet-alert-${esc(a.level)}${fresh ? ' wallet-alert-new' : ''}">
                <i class="${glyph} wallet-alert-icon" aria-hidden="true"></i>
                <div class="wallet-row-text">
                    <span class="wallet-alert-title">${esc(a.title)}</span>
                    <span class="wallet-row-sub">${esc(a.service)}${a.text ? ` - ${esc(a.text)}` : ''}</span>
                </div>${button}
            </div>`;
    }

    function setHtml(el, html) {
        if (el && el.innerHTML !== html) {
            el.innerHTML = html;
            return true;
        }
        return false;
    }

    function renderFlyout() {
        if (!flyout || flyout.classList.contains('hidden')) return;
        const { rows, alerts } = model();
        const onAlerts = activeTab === 'alerts';
        if (onAlerts) {
            // Shown now = seen for this session; the first showing keeps its highlight while open
            const newly = unseen(alerts);
            if (newly.length) {
                newly.forEach((a) => freshIds.add(a.id));
                markSeen(alerts);
            }
        }
        let status = rows.map(rowHtml).join('');
        if (restricted) status += '<div class="wallet-note">Other accounts are shown to administrators.</div>';
        else if (serverError && !server) status += `<div class="wallet-note">Other accounts unavailable: ${esc(serverError)}</div>`;
        else if (!server && loading) status += '<div class="wallet-note">Checking accounts...</div>';
        const alertList = alerts.length
            ? alerts.map((a) => alertHtml(a, freshIds.has(a.id))).join('')
            : '<div class="wallet-empty"><i class="fas fa-circle-check" aria-hidden="true"></i> There are no alerts.</div>';
        const tab = (id, label, extra) => `<button type="button" class="wallet-tab${activeTab === id ? ' active' : ''}" role="tab" aria-selected="${activeTab === id}" data-wallet-tab="${id}">${label}${extra || ''}</button>`;
        const alertBadge = alerts.length ? ` <span class="wallet-tab-count">(${alerts.length})</span>` : '';
        const statusPanel = flyout.querySelector('.wallet-panel-status');
        const alertsPanel = flyout.querySelector('.wallet-panel-alerts');
        statusPanel.classList.toggle('inactive', onAlerts);
        alertsPanel.classList.toggle('inactive', !onAlerts);
        statusPanel.setAttribute('aria-hidden', String(onAlerts));
        alertsPanel.setAttribute('aria-hidden', String(!onAlerts));
        setHtml(flyout.querySelector('.wallet-tabs'), `${tab('alerts', 'Alerts', alertBadge)}${tab('status', 'Status')}`);
        setHtml(alertsPanel, alertList);
        setHtml(flyout.querySelector('.wallet-flyout-links'), `
                <button type="button" class="wallet-flyout-link" data-wallet-action="refresh"${loading ? ' disabled' : ''}>${loading ? 'Refreshing...' : 'Refresh'}</button>
                ${restricted ? '' : '<button type="button" class="wallet-flyout-link" data-wallet-action="keys">Service keys</button>'}`);
        if (setHtml(statusPanel, status)) positionFlyout();
    }

    function positionFlyout() {
        if (!flyout || !doc) return;
        const width = flyout.offsetWidth || 400;
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

    // Admin only on the server (190-adminHandler.js unlock_api_service), same as Security Center
    async function unlockService(service) {
        const client = ws();
        if (!service || !client) return;
        try {
            await client.sendMessage('unlock_api_service', { service });
            if (typeof root.showGlassToast === 'function') {
                root.showGlassToast('success', 'Service keys', `${service} calls are allowed again`, false, 4000, '<i class="fas fa-unlock"></i>');
            }
        } catch (error) {
            if (typeof root.showGlassToast === 'function') {
                root.showGlassToast('error', 'Service keys', (error && error.message) || 'Could not unlock', false, 5000);
            }
        }
        refresh({ force: true });
    }

    function runAction(action, arg) {
        if (action === 'refresh') {
            refresh({ force: true });
        } else if (action === 'login') {
            loginCursor(arg);
        } else if (action === 'unlock') {
            unlockService(arg);
        } else if (action === 'novelai-site') {
            root.open('https://novelai.net/', '_blank', 'noopener,noreferrer');
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
                        // Cursor profiles that need a login, like the Log in buttons on the Alerts tab
                        const accounts = (server && server.cursor && Array.isArray(server.cursor.accounts) ? server.cursor.accounts : [])
                            .filter((acc) => acc.needsLogin);
                        section.title = accounts.length ? 'Cursor' : '';
                        section.items = accounts.map((acc) => ({
                            icon: 'fas fa-right-to-bracket',
                            text: `Log in ${acc.name}`,
                            action: 'wallet-login',
                            accountId: acc.id
                        }));
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
                } else if (action === 'wallet-login') {
                    loginCursor(item && item.accountId);
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
        if (client && typeof client.on === 'function') {
            // Key tripwire (globalResources.js) and Security Center key checks (apiKeyHealth.js), admins only
            client.on('api_service_lock_changed', () => refresh({ force: true }));
            client.on('api_key_status_changed', () => refresh({ force: true }));
        }
        // The Director's usage badge (Cursor / Claude / TokenRouter) opens the wallet
        const badge = doc.getElementById('directorUsageDisplay');
        if (badge && !badge.dataset.walletOpener) {
            badge.dataset.walletOpener = '1';
            badge.classList.add('wallet-opener');
            extraAnchors.push(badge);
            badge.addEventListener('click', () => toggleFlyout(icon));
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
            runpodRow,
            v5Trend,
            keyAlerts,
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
