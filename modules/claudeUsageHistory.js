'use strict';

/**
 * Fleet's "Last 30 days" timeline (Yukimi, Nov 24 2026): per account and day, the highest session % and the weekly %
 * the usage reads saw (the Claude plan usage is not stored anywhere else), plus the Supervisor's cost per day from
 * its usage table. No timer of its own: claudeUsage.read() hands every new snapshot to record(); the rows live in
 * coord.db (claude_usage_daily) and are kept 90 days.
 */

const KEEP_DAYS = 90;
const DAY_MS = 86400000;

const coord = () => require('./agentCoord/store');
let dbOverride = null;

function db() {
    const d = dbOverride || coord().open();
    if (!d.__usageDaily) {
        d.exec('CREATE TABLE IF NOT EXISTS claude_usage_daily (day TEXT NOT NULL, account TEXT NOT NULL, name TEXT NOT NULL DEFAULT \'\', session_pct REAL, week_pct REAL, at INTEGER NOT NULL, PRIMARY KEY (day, account))');
        try { d.__usageDaily = true; } catch (_) { /* a frozen handle: the CREATE is idempotent */ }
    }
    return d;
}

/** Local calendar day, YYYY-MM-DD. */
function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function limitPct(limits, pick) {
    const row = (limits || []).find(pick);
    return row && Number.isFinite(Number(row.percent)) ? Number(row.percent) : null;
}

/** One snapshot { at, accounts: [{ id, name, limits }] }: per account and day keeps the max of each percent. */
function record(snapshot, now) {
    const at = now || Date.now();
    const rows = snapshot && Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
    if (!rows.length) return 0;
    let n = 0;
    try {
        const d = db();
        const day = dayKey(at);
        const up = d.prepare(`INSERT INTO claude_usage_daily (day, account, name, session_pct, week_pct, at) VALUES (@day, @account, @name, @session, @week, @at)
            ON CONFLICT(day, account) DO UPDATE SET name = excluded.name, at = excluded.at,
            session_pct = CASE WHEN excluded.session_pct IS NULL THEN session_pct WHEN session_pct IS NULL OR excluded.session_pct > session_pct THEN excluded.session_pct ELSE session_pct END,
            week_pct = CASE WHEN excluded.week_pct IS NULL THEN week_pct WHEN week_pct IS NULL OR excluded.week_pct > week_pct THEN excluded.week_pct ELSE week_pct END`);
        rows.forEach((a) => {
            if (!a || !a.id) return;
            const session = limitPct(a.limits, (l) => l.kind === 'session');
            const week = limitPct(a.limits, (l) => l.kind === 'weekly_all' || l.kind === 'seven_day');
            if (session === null && week === null) return;
            up.run({ day, account: String(a.id), name: String(a.name || ''), session, week, at });
            n += 1;
        });
        d.prepare('DELETE FROM claude_usage_daily WHERE day < ?').run(dayKey(at - KEEP_DAYS * DAY_MS));
    } catch (e) { console.warn(`[claudeUsageHistory] not recorded: ${e.message}`); }
    return n;
}

/** { days: ['YYYY-MM-DD' oldest..today], supervisor: { day: { cost, calls, tokens, unpriced } }, accounts: [{ id, name, days: { day: { session, week } } }] } */
function history(daysWanted, now) {
    const at = now || Date.now();
    const n = Math.max(1, Math.min(90, Math.floor(Number(daysWanted)) || 30));
    const days = [];
    for (let i = n - 1; i >= 0; i -= 1) days.push(dayKey(at - i * DAY_MS));
    const out = { days, supervisor: {}, accounts: [] };
    const d = db();
    try {
        d.prepare(`SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch', 'localtime') day, COUNT(*) calls, SUM(COALESCE(cost, 0)) cost,
            SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)) tokens, SUM(CASE WHEN ok = 1 AND cost IS NULL THEN 1 ELSE 0 END) unpriced
            FROM supervisor_usage WHERE at >= ? GROUP BY day`).all(Date.parse(`${days[0]}T00:00:00`)).forEach((r) => {
            out.supervisor[r.day] = { cost: Number(r.cost) || 0, calls: r.calls, tokens: r.tokens || 0, unpriced: r.unpriced || 0 };
        });
    } catch (_) { /* the Supervisor's table is not there yet: no cost */ }
    const byAcc = new Map();
    d.prepare('SELECT day, account, name, session_pct, week_pct FROM claude_usage_daily WHERE day >= ? ORDER BY day').all(days[0]).forEach((r) => {
        if (!byAcc.has(r.account)) byAcc.set(r.account, { id: r.account, name: r.name, days: {} });
        const a = byAcc.get(r.account);
        a.name = r.name || a.name;
        a.days[r.day] = { session: r.session_pct, week: r.week_pct };
    });
    out.accounts = Array.from(byAcc.values());
    return out;
}

module.exports = { record, history, dayKey, KEEP_DAYS, _setDb(d) { dbOverride = d; } };
