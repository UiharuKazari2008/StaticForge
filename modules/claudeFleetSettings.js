'use strict';

/**
 * Per-account Fleet settings and whether an account is free to take work (#1154, Yukimi Nov 24 2026:
 * "in accounts I should be able to rename an account or change other settings as well as add 'Preferred
 * account' and 'max weekly usage' and 'max session usage'"; "show banners on accounts that are approaching
 * their limits or are now no longer free to schedule work").
 *
 *   settings   config fleet.accounts.<account id> = { preferred, maxWeeklyPct, maxSessionPct, defaultModel,
 *              defaultEffort, defaultMode } (account id = claudeAccountHost's: sha256 of its token, 16 hex);
 *              the name is the CardSpace key's own name (apiKeyManager.updateApiKey). One account is preferred.
 *   availability(usageRow, settings)   from the account's plan usage (claudeUsage rows) and its caps:
 *              exhausted  a limit at 100% (or the API says so)       not schedulable
 *              capped     a limit at or past the account's own max   not schedulable
 *              near       a limit at 80%+, or within 10 points of its max
 *              login      its login expired (usage row needsLogin / a login error, or a session start failed on it:
 *                         markLoginFailed)                           not schedulable until a good usage read or start
 *              free / unknown (no usage read yet: schedulable, said so)
 *
 * Yozora's dispatch (claudeFleetMcp) and Fleet's New Session "Auto" pick from schedulable accounts only:
 * the preferred one first while it is free, then the most headroom.
 */

const MODES = new Set(['bypassPermissions', 'acceptEdits', 'auto', 'default', 'plan']);
const EFFORTS = new Set(['', 'low', 'medium', 'high', 'xhigh', 'max']);
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;
const NEAR_PCT = 80;
const NEAR_CAP = 10;

const PRIORITIES = ['high', 'normal', 'low'];
const DEFAULTS = { priority: 'normal', preferred: false, maxWeeklyPct: null, maxSessionPct: null, defaultModel: 'sonnet', defaultEffort: '', defaultMode: 'bypassPermissions', renewalDay: null };

function all(gr) {
    try { return (gr && gr.getConfig && gr.getConfig().fleet && gr.getConfig().fleet.accounts) || {}; } catch (_) { return {}; }
}

function get(gr, id) {
    const v = all(gr)[id] || {};
    return {
        priority: PRIORITIES.includes(v.priority) ? v.priority : 'normal',
        preferred: v.preferred === true,
        maxWeeklyPct: Number.isFinite(v.maxWeeklyPct) ? v.maxWeeklyPct : null,
        maxSessionPct: Number.isFinite(v.maxSessionPct) ? v.maxSessionPct : null,
        defaultModel: typeof v.defaultModel === 'string' && v.defaultModel ? v.defaultModel : DEFAULTS.defaultModel,
        defaultEffort: EFFORTS.has(v.defaultEffort) ? v.defaultEffort : DEFAULTS.defaultEffort,
        defaultMode: MODES.has(v.defaultMode) ? v.defaultMode : DEFAULTS.defaultMode,
        renewalDay: Number.isInteger(v.renewalDay) && v.renewalDay >= 1 && v.renewalDay <= 31 ? v.renewalDay : null
    };
}

const pct = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1 || n > 100) throw new Error('A max usage is a percent from 1 to 100 (blank for none)');
    return n;
};

/** Saves an account's settings (and its name). Answers the saved settings. */
async function save(gr, index, patch = {}) {
    const host = require('./claudeAccountHost');
    const acc = host.listAccounts(gr).find((a) => a.index === Number(index));
    if (!acc) throw new Error('No such Claude account');
    if (patch.name !== undefined) {
        const name = String(patch.name || '').trim().slice(0, 60);
        if (!name) throw new Error('An account needs a name');
        if (name !== acc.name) await gr.getApiKeyManager().updateApiKey('claude', acc.index, name, '');
    }
    const cur = get(gr, acc.id);
    const next = Object.assign({}, cur);
    if (patch.preferred !== undefined) next.preferred = patch.preferred === true;
    if (patch.priority !== undefined) {
        if (!PRIORITIES.includes(patch.priority)) throw new Error('priority is high, normal or low');
        next.priority = patch.priority;
    }
    if (patch.maxWeeklyPct !== undefined) next.maxWeeklyPct = pct(patch.maxWeeklyPct);
    if (patch.maxSessionPct !== undefined) next.maxSessionPct = pct(patch.maxSessionPct);
    if (patch.renewalDay !== undefined) {
        // the subscription's billing day of month (the profile does not carry a renewal date); blank clears it
        if (patch.renewalDay === null || patch.renewalDay === '') next.renewalDay = null;
        else {
            const d = Number(patch.renewalDay);
            if (!Number.isInteger(d) || d < 1 || d > 31) throw new Error('The renewal day is a day of the month from 1 to 31 (blank for none)');
            next.renewalDay = d;
        }
    }
    if (patch.defaultModel !== undefined) {
        const m = String(patch.defaultModel || '').trim();
        if (m && !MODEL_RE.test(m)) throw new Error('That is not a model name');
        next.defaultModel = m || DEFAULTS.defaultModel;
    }
    if (patch.defaultEffort !== undefined) {
        if (!EFFORTS.has(String(patch.defaultEffort || ''))) throw new Error('effort is low, medium, high, xhigh or max');
        next.defaultEffort = String(patch.defaultEffort || '');
    }
    if (patch.defaultMode !== undefined) {
        if (!MODES.has(patch.defaultMode)) throw new Error('Unknown permission mode');
        next.defaultMode = patch.defaultMode;
    }
    const cfg = gr.modifyConfig('config');
    if (next.preferred) {
        // one preferred account: the others lose it
        for (const [id, v] of Object.entries(all(gr))) {
            if (id !== acc.id && v && v.preferred) await cfg.assign(['fleet', 'accounts', id, 'preferred'], false);
        }
    }
    await cfg.assign(['fleet', 'accounts', acc.id], next);
    return get(gr, acc.id);
}

function limitCap(limit, s) {
    const k = String((limit && limit.kind) || '');
    if (k === 'session' || k === 'five_hour') return s.maxSessionPct;
    if (k.startsWith('weekly') || k.startsWith('seven_day')) return s.maxWeeklyPct;
    return null;
}

/**
 * { state, schedulable, message, resetsAt, costWarning } for an account from its usage row and its settings.
 * costWarning (Yukimi Nov 24: "if extra usage is on that's a red banner for high costs"): extra usage is on,
 * so work past the plan's limits is billed; past a limit with it on the account is not schedulable.
 */
function availability(usage, s) {
    const out = availabilityOf(usage, s);
    trackLogin(usage, out);
    out.pace = paceFor(usage, s);
    const extra = usage && (usage.extraEnabled || (usage.extra && usage.extra.enabled));
    if (!extra) return Object.assign(out, { costWarning: '' });
    const x = (usage && usage.extra) || {};
    // used_credits / monthly_limit come in minor units (decimal_places, 2 for cents): 1875 is $18.75; a 0 limit is no limit set
    const dec = Number.isFinite(x.decimals) ? x.decimals : 2;
    const sym = { USD: '$', EUR: '\u20ac', GBP: '\u00a3', JPY: '\u00a5' }[x.currency || 'USD'];
    const money = (n) => { const v = (n / 10 ** dec).toFixed(dec); return sym ? `${sym}${v}` : `${v} ${x.currency}`; };
    const spent = Number.isFinite(x.used) ? ` (${money(x.used)} spent this month${Number.isFinite(x.limit) && x.limit > 0 ? ` of ${money(x.limit)}` : ', no monthly limit'})` : '';
    return Object.assign(out, { costWarning: `Extra usage is on: work past the plan's limits on this account is billed${spent}` });
}

// ---------------------------------------------------------------- expired logins (Yukimi Nov 25: "If login expired then move on to next account until it's fixed")
const LOGIN_RE = /sign in again|login expired|login refused|HTTP 401|not logged in|please run \/login|oauth token has expired|invalid api key/i;
const LOGIN_MSG = 'Login expired: sign in again (Fleet > Accounts > the account) - work goes to the other accounts until then';
const CRED_MSG = 'Claude Code login expired: sign in again (Fleet > Accounts > Sign In Again) - work goes to the other accounts until then';

// Runtime marks live in the agent-coord DB (table claude_login_marks), loaded once on first use, so a Dreamscape restart keeps
// "this account needs signing in" (Nov 26: Douglas's CLI login expired, the restart forgot it and Fleet showed it healthy).
// A cleared mark keeps its row (cleared_at) so "a failure was ever recorded" stays known; ok_at is the last proven working start.
const loginFailed = new Map(); // account index -> { at, message, name, runtime, configDir }
let marksDb = null;
let marksLoaded = false;
function marksStore() {
    try {
        const d = require('./agentCoord/store').open();
        if (d !== marksDb) {
            d.exec('CREATE TABLE IF NOT EXISTS claude_login_marks (idx INTEGER PRIMARY KEY, at INTEGER NOT NULL, message TEXT NOT NULL DEFAULT \'\', name TEXT NOT NULL DEFAULT \'\', runtime INTEGER NOT NULL DEFAULT 0, config_dir TEXT NOT NULL DEFAULT \'\', cleared_at INTEGER, ok_at INTEGER)');
            marksDb = d; marksLoaded = false;
        }
        return d;
    } catch (_) { return null; }
}
function loadMarks() {
    const d = marksStore();
    if (!d || marksLoaded) return d;
    marksLoaded = true;
    try {
        d.prepare('SELECT * FROM claude_login_marks WHERE cleared_at IS NULL').all().forEach((r) => {
            if (!loginFailed.has(r.idx)) loginFailed.set(r.idx, { at: r.at, message: r.message, name: r.name, runtime: !!r.runtime, configDir: r.config_dir });
        });
    } catch (_) { /* memory only */ }
    return d;
}
function markRow(index) {
    const d = loadMarks();
    try { return d ? d.prepare('SELECT * FROM claude_login_marks WHERE idx = ?').get(Number(index)) || null : null; } catch (_) { return null; }
}

/** Is this error / note text a login-expiry one (a usage read's or the launcher's)? */
function isLoginError(text) { return LOGIN_RE.test(String(text || '')); }
/**
 * extra = { runtime: true, configDir } marks a failure a RUNNING session hit (its turn ended "Login expired"): the usage read uses another token, so a good
 * usage read proves nothing and never clears it; it clears when the account's credentials file changes (checked when availability is asked) or a start succeeds.
 */
function markLoginFailed(index, message, name, extra) {
    if (!Number.isFinite(index)) return;
    const x = extra || {};
    loadMarks();
    const m = { at: Date.now(), message: String(message || '').slice(0, 200), name: name || '', runtime: !!x.runtime, configDir: x.configDir ? String(x.configDir) : '' };
    loginFailed.set(Number(index), m);
    const d = marksStore();
    if (d) { try { d.prepare('INSERT INTO claude_login_marks (idx, at, message, name, runtime, config_dir, cleared_at) VALUES (?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(idx) DO UPDATE SET at=excluded.at, message=excluded.message, name=excluded.name, runtime=excluded.runtime, config_dir=excluded.config_dir, cleared_at=NULL').run(Number(index), m.at, m.message, m.name, m.runtime ? 1 : 0, m.configDir); } catch (_) { /* memory only */ } }
}
function loginFailedOf(index) { loadMarks(); return loginFailed.get(Number(index)) || null; }
function dropMark(index, proved) {
    loadMarks();
    const had = loginFailed.delete(Number(index));
    const d = marksStore();
    if (d) {
        try {
            const t = Date.now();
            if (proved) d.prepare('INSERT INTO claude_login_marks (idx, at, cleared_at, ok_at) VALUES (?, 0, ?, ?) ON CONFLICT(idx) DO UPDATE SET cleared_at=COALESCE(cleared_at, excluded.cleared_at), ok_at=excluded.ok_at').run(Number(index), t, t);
            else d.prepare('UPDATE claude_login_marks SET cleared_at = ? WHERE idx = ? AND cleared_at IS NULL').run(t, Number(index));
        } catch (_) { /* memory only */ }
    }
    return had;
}
/** A start / resume on the account worked (the callers' clear): drops the mark and records the proof. */
function clearLoginFailed(index) { return dropMark(index, true); }

// ---- a dead Claude Code login seen in the account's config dir, without waiting for a failure (no timer: read when availability is asked)
const credCache = new Map(); // account id -> { mtimeMs, size, info }
/** { exists, mtimeMs, hasRefresh, expiresAt } of the account's config-dir .credentials.json. Field presence and the expiry number only; no token value is kept. */
function credInfo(id, dir) {
    const file = require('path').join(dir, '.credentials.json');
    let st;
    try { st = require('fs').statSync(file); } catch (_) { return { exists: false, mtimeMs: 0, hasRefresh: false, expiresAt: 0 }; }
    const c = credCache.get(id);
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.info;
    let info = { exists: true, mtimeMs: st.mtimeMs, hasRefresh: false, expiresAt: 0, oauth: false };
    try {
        const o = (JSON.parse(require('fs').readFileSync(file, 'utf8')) || {}).claudeAiOauth;
        if (o && typeof o === 'object') info = { exists: true, mtimeMs: st.mtimeMs, oauth: true, hasRefresh: typeof o.refreshToken === 'string' && o.refreshToken.length > 0, expiresAt: Number.isFinite(o.expiresAt) ? o.expiresAt : 0 };
    } catch (_) { /* unreadable: not judged */ }
    credCache.set(id, { mtimeMs: st.mtimeMs, size: st.size, info });
    return info;
}
/** A live busy session (agent-coord) is running on this config dir right now: the login works. */
function busyOnDir(dir) {
    try {
        const path = require('path');
        const want = path.resolve(dir);
        return require('./agentCoord/store').listAgents().some((a) => a.configDir && a.status === 'busy' && path.resolve(a.configDir) === want);
    } catch (_) { return false; }
}
/**
 * Is the account's Claude Code login dead? No refresh token left and no future expiry (expired, zero or missing), unless the account is proven to work:
 * a busy session on its config dir, or a start that succeeded after the credentials file was last written.
 */
function credentialsDead(usage, now) {
    if (!usage || !usage.id || !/^[0-9a-f]{16}$/.test(String(usage.id))) return null;
    let dir;
    try { dir = require('./claudeAccountRuntime').configDir(usage.id); } catch (_) { return null; }
    const ci = credInfo(usage.id, dir);
    if (!ci.exists || !ci.oauth || ci.hasRefresh) return null;
    if (ci.expiresAt > (now || Date.now())) return null; // still inside its access token: fine until then
    const m = Number.isFinite(usage.index) ? markRow(usage.index) : null;
    if (m && m.ok_at && m.ok_at > ci.mtimeMs) return null;
    if (busyOnDir(dir)) return null;
    return { mtimeMs: ci.mtimeMs, expiresAt: ci.expiresAt, hasRefresh: false };
}

function availabilityOf(usage, s) {
    const idx = usage && Number.isFinite(usage.index) ? usage.index : null;
    const hasRows = !!(usage && Array.isArray(usage.limits) && usage.limits.some((l) => Number.isFinite(l.percent)));
    let failed = idx !== null ? loginFailedOf(idx) : null;
    // a runtime failure (a session's turn ended "Login expired"): only a newer credentials file clears it (stat on ask, no timer)
    if (failed && failed.runtime && failed.configDir) {
        let m = 0;
        try { m = require('fs').statSync(require('path').join(failed.configDir, '.credentials.json')).mtimeMs; } catch (_) { m = 0; }
        if (m > failed.at) { dropMark(idx, false); failed = null; }
    }
    // a later good usage read (limits, no needsLogin) clears a recorded START failure, not a runtime one (another token)
    if (failed && !failed.runtime && hasRows && !usage.needsLogin && !isLoginError(usage.error || usage.note) && Number.isFinite(usage.at) && usage.at > failed.at) { dropMark(idx, false); }
    const stillFailed = idx !== null ? loginFailedOf(idx) : null;
    if ((usage && (usage.needsLogin || isLoginError(usage.error || usage.note))) || stillFailed) return { state: 'login', schedulable: false, message: LOGIN_MSG, resetsAt: null, since: stillFailed ? stillFailed.at : 0 };
    const dead = credentialsDead(usage, Date.now());
    if (dead) return { state: 'login', schedulable: false, message: CRED_MSG, resetsAt: null, since: dead.mtimeMs, credentials: true };
    const limits = (usage && Array.isArray(usage.limits) ? usage.limits : []).filter((l) => Number.isFinite(l.percent));
    if (!limits.length) return { state: 'unknown', schedulable: true, message: usage && usage.error ? `Usage unknown: ${usage.error}` : 'Usage not read yet', resetsAt: null };
    const label = (l) => l.label || l.short || l.kind;
    const when = (l) => l.resetsAt || null;
    const full = limits.filter((l) => l.percent >= 100 || l.severity === 'exceeded');
    if (full.length) {
        const l = full.sort((a, b) => (when(b) || 0) - (when(a) || 0))[0];
        return { state: 'exhausted', schedulable: false, message: `${label(l)} limit reached (${l.percent}%): no new work until it resets`, resetsAt: when(l) };
    }
    const capped = limits.map((l) => ({ l, cap: limitCap(l, s) })).filter((x) => x.cap && x.l.percent >= x.cap);
    if (capped.length) {
        const { l, cap } = capped[0];
        return { state: 'capped', schedulable: false, message: `${label(l)} at ${l.percent}%, past this account's max of ${cap}%: no new work until it resets`, resetsAt: when(l) };
    }
    const near = limits.map((l) => ({ l, cap: limitCap(l, s) })).filter((x) => x.l.percent >= NEAR_PCT || (x.cap && x.l.percent >= x.cap - NEAR_CAP));
    if (near.length) {
        const { l, cap } = near.sort((a, b) => b.l.percent - a.l.percent)[0];
        return { state: 'near', schedulable: true, message: `${l.label || l.short || l.kind} at ${l.percent}%${cap ? ` (max ${cap}%)` : ''}: close to its limit`, resetsAt: when(l) };
    }
    return { state: 'free', schedulable: true, message: '', resetsAt: null };
}

// Edge detection for the Fleet notice: the state an account was last seen in (memory; the inbox's digest keeps a restart from sounding twice)
const lastState = new Map();
function trackLogin(usage, out) {
    const idx = usage && Number.isFinite(usage.index) ? usage.index : null;
    if (idx === null) return;
    const was = lastState.get(idx);
    const now = out.state === 'login';
    lastState.set(idx, now ? 'login' : 'ok');
    if (now === (was === 'login')) return;
    try {
        const fn = require('./fleetNotices');
        const mark = loginFailedOf(idx);
        const name = (usage.name || (mark && mark.name) || `Claude ${idx + 1}`);
        if (now) fn.accountLogin({ index: idx, id: usage.id || '', name, since: out.since || 0 });
        else fn.accountLoginCleared({ index: idx, id: usage.id || '' });
    } catch (e) { console.warn(`[claude-fleet] login notice: ${e.message}`); }
}

const DAY_MS = 86400000;
const AHEAD_PTS = 10;

/**
 * Pace of an account's week (Yukimi Nov 25: tap another account when one is using up today's share of the week).
 * Pure: weekly = { percent, resetsAt (ms) }, cap = the account's own maxWeeklyPct or null (100), dayStartPct = the
 * weekly % when today began, now. todayShare is the even share of what was left this morning (cap - dayStartPct over
 * the days left then, at least 1); state is over (used today's share), ahead (more than 10 points ahead of an even
 * week) or ok; unknown (treated as ok) without a weekly row.
 */
function pace(weekly, cap, dayStartPct, now) {
    if (!weekly || !Number.isFinite(weekly.percent) || !Number.isFinite(weekly.resetsAt)) return { state: 'unknown', message: 'No weekly usage row: pace unknown, treated as on pace' };
    const at = now || Date.now();
    const top = Number.isFinite(cap) && cap > 0 ? cap : 100;
    const weekPct = weekly.percent;
    const start = Number.isFinite(dayStartPct) ? Math.min(Math.max(dayStartPct, 0), weekPct) : 0;
    const e = Math.min(1, Math.max(0, 1 - (weekly.resetsAt - at) / (7 * DAY_MS)));
    const d = new Date(at); d.setHours(0, 0, 0, 0);
    const daysLeft = Math.max(1, (weekly.resetsAt - d.getTime()) / DAY_MS);
    const todayShare = Math.max(0, (top - start) / daysLeft);
    const usedToday = weekPct - start;
    const expected = e * top;
    const r1 = (n) => Math.round(n * 10) / 10;
    const state = usedToday >= todayShare ? 'over' : (weekPct > expected + AHEAD_PTS ? 'ahead' : 'ok');
    const message = state === 'over' ? `Used today's share (${r1(usedToday)}% of ${r1(todayShare)}%)` : (state === 'ahead' ? `Ahead of pace (${r1(weekPct)}% used, ${r1(expected)}% expected)` : 'On pace');
    return { state, weekPct: r1(weekPct), dayStartPct: r1(start), usedToday: r1(usedToday), todayShare: r1(todayShare), expectedPct: r1(expected), cap: top, daysLeft: r1(daysLeft), ratio: todayShare > 0 ? usedToday / todayShare : 99, message };
}

/** Pace from a usage row ({ id, limits }) and the account's settings, with today's starting % from the usage history. */
function paceFor(usage, s) {
    const l = usage && Array.isArray(usage.limits) ? usage.limits.find((x) => x && (x.kind === 'weekly_all' || x.kind === 'seven_day') && Number.isFinite(x.percent) && Number.isFinite(x.resetsAt)) : null;
    if (!l) return pace(null);
    let start = 0;
    if (usage.id) { try { start = require('./claudeUsageHistory').dayStartWeekPct(usage.id, l.resetsAt - 7 * DAY_MS, l.percent); } catch (_) { start = 0; } }
    return pace(l, s && s.maxWeeklyPct, start);
}

/** The usage row for an account index from claudeUsage's last read (no fetch). */
function usageFor(index) {
    try {
        const snap = require('./claudeUsage').cached();
        const row = snap && (snap.accounts || []).find((a) => a.index === index);
        if (!row) return Number.isFinite(index) && loginFailedOf(index) ? { id: null, index, needsLogin: false, plan: '', limits: [], at: null, error: null, extra: null, extraEnabled: false, billingDay: null } : null;
        return { id: row.id || null, index: row.index, name: row.name || '', needsLogin: !!row.needsLogin, plan: row.plan || '', limits: row.limits || [], at: row.at || null, error: row.error || null, extra: row.extra || null, extraEnabled: !!row.extraEnabled, billingDay: row.billingDay || null };
    } catch (_) { return null; }
}

module.exports = { get, save, availability, pace, usageFor, isLoginError, markLoginFailed, credentialsDead, loginFailedOf, clearLoginFailed, LOGIN_MSG, CRED_MSG, DEFAULTS, PRIORITIES, _limitCap: limitCap };
