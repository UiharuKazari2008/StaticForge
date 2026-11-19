'use strict';

/**
 * Claude plan usage for EVERY Claude account (Yukimi via Menma, Nov 19 2026: the Account Manager tray and
 * the Accounts app show "plan, current session / 5-hour and weekly limits with percent used and reset
 * times ... per account using that account's own login").
 *
 * Each account in Security Center's Claude keys (claudeAccountHost.listAccounts) is read with its own
 * claude.ai login, the same call the CLI's /usage makes:
 *
 *   GET https://api.anthropic.com/api/oauth/usage   (anthropic-beta: oauth-2025-04-20, Bearer <access token>)
 *     -> limits[] { kind session | weekly_all | weekly_scoped, percent, resets_at, severity, scope.model },
 *        five_hour / seven_day / seven_day_opus / seven_day_sonnet (older shape), extra_usage, spend
 *
 * Which login: the account that is on the host reads ~/.claude/.credentials.json (Remote Control's CLI
 * keeps it fresh); any other the fresher of its linked login and its parallel-session config dir
 * (claudeAccountRuntime). An expired access token of an account that is NOT on the host and that no
 * running CLI holds is refreshed here (the CLI's own refresh: platform.claude.com/v1/oauth/token) and the
 * rotated login is saved back as the account's linked login (and into its config dir), so the next
 * session or switch signs in with it. The host's login and a login a live session holds are never
 * refreshed here: their CLI owns the rotation, and this waits for it.
 *
 * An account without a linked login (only the setup token, which cannot read /api/oauth/usage) shows the
 * 5-hour and 7-day windows of the last Claude turn when it is the engine's account (the Director's
 * claude-usage.json), else asks for a login.
 *
 * read(gr, { force }) -> { at, accounts: [row] } with one cache for the statusHub feed `claude_usage`
 * (modules/ws/handlers/315-claudeUsageHandler.js) and wallet_status (walletStatus.js). Never a token in a
 * row, a log line or an error.
 *
 * Overrides (tests): DREAMSCAPE_CLAUDE_HOME, DREAMSCAPE_CLAUDE_ACCOUNTS_DIR (claudeAccountHost's),
 * _setFetch, _setLiveConfigDirs.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const claudeHost = require('./claudeAccountHost');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const BETA = 'oauth-2025-04-20';
const TTL_MS = 4 * 60 * 1000;          // a read younger than this is reused (feed ticks every 5 min)
const FORCE_FLOOR_MS = 20 * 1000;      // a forced read still reuses one this young
const REFRESH_MARGIN_MS = 2 * 60 * 1000;
const FAIL_BACKOFF_MS = 10 * 60 * 1000; // a refused login refresh is not tried again before this
const TIMEOUT_MS = 12000;

let fetchFn = (...a) => fetch(...a);
let liveDirsFn = null;
let cache = null;       // { at, accounts }
let inflight = null;
const readers = new Set();    // told after every new snapshot (the feed pushes it)
const lastGood = new Map();   // account id -> { at, usage } (kept when a later read fails)
const refreshFailAt = new Map();

function claudeHome() { return process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(); }
const hostCredsFile = () => path.join(claudeHome(), '.claude', '.credentials.json');

async function readJson(file) {
    try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch (_) { return null; }
}

async function writeJsonAtomic(file, value) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.promises.chmod(tmp, 0o600);
    await fs.promises.rename(tmp, file);
}

const oauthOf = (creds) => (creds && creds.claudeAiOauth) || null;
const expiresOf = (creds) => Number(oauthOf(creds) && oauthOf(creds).expiresAt) || 0;
const fresher = (a, b) => (!oauthOf(a) ? (oauthOf(b) ? b : null) : !oauthOf(b) ? a : expiresOf(b) > expiresOf(a) ? b : a);

/** "Max 5x" from rateLimitTier default_claude_max_5x / subscriptionType max; "Pro", "Team", ... */
function planName(oauth) {
    const o = oauth || {};
    const tier = String(o.rateLimitTier || '');
    const sub = String(o.subscriptionType || '');
    const m = tier.match(/max_(\d+)x/i);
    if (m) return `Max ${m[1]}x`;
    if (!sub) return '';
    return sub.charAt(0).toUpperCase() + sub.slice(1);
}

function shortError(e) {
    // never a token: errors here are built from status codes and our own words only
    return String((e && e.message) || e || 'unavailable').replace(/\s+/g, ' ').slice(0, 160);
}

// ---------------------------------------------------------------- the usage reply

// /api/oauth/usage answers percents (37.0 = 37%); a turn's rate_limit_event answers fractions (0.37)
const pct = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };
const fractionPct = (v) => { const n = Number(v); return v !== null && v !== undefined && Number.isFinite(n) ? Math.round(n <= 1 ? n * 100 : n) : null; };
const when = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };

/**
 * The reply as rows the clients draw: limits[] { kind, label, short, percent, resetsAt, severity, active },
 * extra { enabled, used, limit, currency, percent }.
 */
function parseUsage(body) {
    const b = body && typeof body === 'object' ? body : {};
    const limits = [];
    if (Array.isArray(b.limits) && b.limits.length) {
        b.limits.forEach((l) => {
            if (!l || typeof l !== 'object') return;
            const model = l.scope && l.scope.model && (l.scope.model.display_name || l.scope.model.id);
            const surface = l.scope && l.scope.surface && (l.scope.surface.display_name || l.scope.surface.id || l.scope.surface);
            let label; let short;
            if (l.kind === 'session' || l.group === 'session') { label = 'Current session'; short = '5 hours'; }
            else if (l.kind === 'weekly_all') { label = 'Weekly (all models)'; short = 'Week'; }
            else if (model || surface) { label = `Weekly (${model || surface})`; short = String(model || surface); }
            else { label = String(l.kind || 'Limit').replace(/_/g, ' '); short = label; }
            limits.push({ kind: String(l.kind || ''), label, short, percent: pct(l.percent), resetsAt: when(l.resets_at), severity: String(l.severity || 'normal'), active: l.is_active === true });
        });
    } else {
        const win = (key, label, short) => {
            const w = b[key];
            if (!w || typeof w !== 'object') return;
            limits.push({ kind: key, label, short, percent: pct(w.utilization), resetsAt: when(w.resets_at), severity: 'normal', active: false });
        };
        win('five_hour', 'Current session', '5 hours');
        win('seven_day', 'Weekly (all models)', 'Week');
        win('seven_day_opus', 'Weekly (Opus)', 'Opus');
        win('seven_day_sonnet', 'Weekly (Sonnet)', 'Sonnet');
    }
    const x = b.extra_usage && typeof b.extra_usage === 'object' ? b.extra_usage : null;
    const extra = x && x.is_enabled ? {
        enabled: true,
        used: Number.isFinite(Number(x.used_credits)) ? Number(x.used_credits) : null,
        limit: Number.isFinite(Number(x.monthly_limit)) ? Number(x.monthly_limit) : null,
        currency: x.currency || 'USD',
        decimals: Number.isFinite(Number(x.decimal_places)) ? Number(x.decimal_places) : 2,
        percent: pct(x.utilization),
        limitReached: x.spend_limit_reached === true
    } : null;
    return { limits, extra };
}

// ---------------------------------------------------------------- logins

/** pids of the live Claude CLIs (~/.claude/sessions/<pid>.json) whose CLAUDE_CONFIG_DIR is one of ours. */
async function liveConfigDirs() {
    if (liveDirsFn) return liveDirsFn();
    const out = new Set();
    let names = [];
    try { names = await fs.promises.readdir(path.join(claudeHome(), '.claude', 'sessions')); } catch (_) { return out; }
    for (const n of names) {
        const pid = (n.match(/^(\d+)\.json$/) || [])[1];
        if (!pid) continue;
        let env = '';
        try { env = await fs.promises.readFile(`/proc/${pid}/environ`, 'latin1'); } catch (_) { continue; }
        const hit = env.split('\0').find((kv) => kv.startsWith('CLAUDE_CONFIG_DIR='));
        if (hit) out.add(path.resolve(hit.slice('CLAUDE_CONFIG_DIR='.length)));
    }
    return out;
}

async function refreshLogin(creds) {
    const o = oauthOf(creds);
    const res = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: CLIENT_ID, scope: (o.scopes || []).join(' ') }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.access_token) throw new Error(`login refresh refused (HTTP ${res.status})`);
    return {
        claudeAiOauth: Object.assign({}, o, {
            accessToken: body.access_token,
            refreshToken: body.refresh_token || o.refreshToken,
            expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
            scopes: typeof body.scope === 'string' && body.scope ? body.scope.split(' ') : o.scopes
        })
    };
}

/**
 * { creds, source: 'host' | 'linked', note } for an account row from listAccounts, refreshing an idle
 * non-host login when its access token ran out.
 */
async function loginFor(gr, acc, liveDirs) {
    if (acc.onHost) return { creds: await readJson(hostCredsFile()), source: 'host' };
    if (!acc.remoteLogin) return { creds: null, source: null };
    const dir = path.join(claudeHost.storeDir(), acc.id);
    const cdir = path.join(dir, 'config');
    const linked = await readJson(path.join(dir, 'credentials.json'));
    const own = await readJson(path.join(cdir, '.credentials.json'));
    let creds = fresher(linked, own);
    if (!creds || expiresOf(creds) > Date.now() + REFRESH_MARGIN_MS) return { creds, source: 'linked' };
    if (liveDirs.has(path.resolve(cdir))) return { creds, source: 'linked', note: 'Waiting for its running session to renew the login' };
    // a switch copies this login onto the host now: the host's CLI is about to own it
    if ((claudeHost.publicStatus() || {}).state === 'reconnecting') return { creds, source: 'linked', note: 'Waiting for the account switch to finish' };
    if (!oauthOf(creds).refreshToken) return { creds: null, source: 'linked', note: 'Login expired: sign in again (Claude Accounts > Add Account)' };
    const failed = refreshFailAt.get(acc.id) || 0;
    if (Date.now() - failed < FAIL_BACKOFF_MS) return { creds: null, source: 'linked', note: 'Login expired: sign in again (Claude Accounts > Add Account)' };
    try {
        creds = await refreshLogin(creds);
    } catch (e) {
        refreshFailAt.set(acc.id, Date.now());
        console.warn(`[claudeUsage] ${acc.name}: ${shortError(e)}`);
        return { creds: null, source: 'linked', note: 'Login expired: sign in again (Claude Accounts > Add Account)' };
    }
    refreshFailAt.delete(acc.id);
    // the rotated login goes everywhere this account keeps one: its linked login and its config dir
    const meta = (await readJson(path.join(dir, 'account.json'))) || {};
    claudeHost.linkLogin(gr, acc.index, creds, meta.oauthAccount || null);
    if (own) await writeJsonAtomic(path.join(cdir, '.credentials.json'), Object.assign({}, own, { claudeAiOauth: creds.claudeAiOauth }));
    return { creds, source: 'linked' };
}

async function fetchUsage(creds) {
    const res = await fetchFn(USAGE_URL, {
        headers: { authorization: `Bearer ${oauthOf(creds).accessToken}`, 'anthropic-beta': BETA, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (res.status === 401) throw new Error('login refused (HTTP 401)');
    if (res.status === 403) throw new Error('this login cannot read usage (HTTP 403)');
    if (res.status === 429) throw new Error('usage asked too often (HTTP 429)');
    if (!res.ok) throw new Error(`usage unavailable (HTTP ${res.status})`);
    return parseUsage(await res.json());
}

// ---------------------------------------------------------------- the engine's last turn (no linked login)

async function lastTurnUsage() {
    let disk = null;
    try { disk = await readJson(path.join(require('./cursorDirector').layout().root, 'claude-usage.json')); } catch (_) { return null; }
    const w = (disk && disk.info && disk.info.unifiedWindows) || null;
    if (!w) return null;
    const row = (x, kind, label, short) => {
        if (!x) return null;
        const at = Number(x.resetsAt);
        return { kind, label, short, percent: fractionPct(x.utilization), resetsAt: Number.isFinite(at) && at > 0 ? at * 1000 : null, severity: 'normal', active: false };
    };
    return { at: Number(disk.at) || null, limits: [row(w.five_hour, 'session', 'Current session', '5 hours'), row(w.seven_day, 'weekly_all', 'Weekly (all models)', 'Week')].filter(Boolean), extra: null };
}

// ---------------------------------------------------------------- the snapshot

async function readAccount(gr, acc, liveDirs) {
    const login = acc.remoteLogin || null;
    const base = {
        id: acc.id,
        index: acc.index,
        name: acc.name,
        email: (login && login.email) || '',
        organization: (login && login.organization) || '',
        engine: !!acc.active,
        onHost: !!acc.onHost,
        plan: '',
        source: null,
        at: null,
        limits: [],
        extra: null,
        needsLogin: false,
        error: null
    };
    let got;
    try { got = await loginFor(gr, acc, liveDirs); } catch (e) { got = { creds: null, note: shortError(e) }; }
    const creds = got.creds;
    if (creds && oauthOf(creds)) base.plan = planName(oauthOf(creds));
    else if (login) base.plan = planName({ subscriptionType: login.plan, rateLimitTier: login.rateLimitTier });
    if (!creds || !oauthOf(creds) || !oauthOf(creds).accessToken) {
        if (!acc.remoteLogin && acc.active) {
            const turn = await lastTurnUsage();
            if (turn) return Object.assign(base, { source: 'turns', at: turn.at, limits: turn.limits });
        }
        base.needsLogin = !acc.remoteLogin || /sign in again/.test(got.note || '');
        base.error = got.note || (acc.remoteLogin ? 'Login unavailable' : 'Link a claude.ai login to see this account\'s usage');
        const prev = lastGood.get(acc.id);
        if (prev && acc.remoteLogin) Object.assign(base, { source: 'login', at: prev.at, limits: prev.usage.limits, extra: prev.usage.extra });
        return base;
    }
    if (expiresOf(creds) <= Date.now()) {
        // the host's or a running session's login: its CLI renews it; show what the last read saw
        const prev = lastGood.get(acc.id);
        base.error = got.note || 'Waiting for Remote Control to renew the login';
        if (prev) Object.assign(base, { source: 'login', at: prev.at, limits: prev.usage.limits, extra: prev.usage.extra });
        return base;
    }
    try {
        const usage = await fetchUsage(creds);
        const at = Date.now();
        lastGood.set(acc.id, { at, usage });
        return Object.assign(base, { source: 'login', at, limits: usage.limits, extra: usage.extra });
    } catch (e) {
        const prev = lastGood.get(acc.id);
        base.error = shortError(e);
        if (prev) Object.assign(base, { source: 'login', at: prev.at, limits: prev.usage.limits, extra: prev.usage.extra });
        return base;
    }
}

async function collect(gr) {
    let accounts = [];
    try { accounts = claudeHost.listAccounts(gr); } catch (e) { return { at: Date.now(), accounts: [], error: shortError(e) }; }
    const liveDirs = await liveConfigDirs().catch(() => new Set());
    const rows = [];
    // one at a time: a login refresh writes the account store
    for (const acc of accounts) {
        if (!acc.id) continue;
        rows.push(await readAccount(gr, acc, liveDirs));
    }
    return { at: Date.now(), accounts: rows };
}

/** The per-account snapshot; force (an action, a feed poke) still reuses one under 20 s. */
async function read(gr, options = {}) {
    const age = cache ? Date.now() - cache.at : Infinity;
    if (cache && age < (options.force ? FORCE_FLOOR_MS : TTL_MS)) return cache;
    if (!inflight) {
        inflight = collect(gr).then((next) => {
            cache = next;
            readers.forEach((fn) => { try { fn(next); } catch (_) { /* a listener's own trouble */ } });
            return next;
        }).finally(() => { inflight = null; });
    }
    return inflight;
}

/** What read() last answered, without reading (null before the first read). */
const cached = () => cache;

/** fn(snapshot) after every new read (whoever asked for it); answers an off function. */
function onRead(fn) { readers.add(fn); return () => readers.delete(fn); }

module.exports = {
    read,
    cached,
    onRead,
    parseUsage,
    planName,
    TTL_MS,
    _setFetch(fn) { fetchFn = typeof fn === 'function' ? fn : (...a) => fetch(...a); },
    _setLiveConfigDirs(fn) { liveDirsFn = typeof fn === 'function' ? fn : null; },
    _reset() { cache = null; inflight = null; lastGood.clear(); refreshFailAt.clear(); readers.clear(); }
};
