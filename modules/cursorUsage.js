'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const PLAN_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo';
const CACHE_MS = 60 * 1000;

let caches = {};

function readAccessToken(persona = 'wren') {
    const cursorAccountAuthStore = require('./cursorAccountAuthStore');
    const cursorDirector = require('./cursorDirector');
    const xiDirector = require('./xiDirector');

    const activeId = cursorAccountAuthStore.getActiveAccountId(persona);
    let token = null;

    // 1. Check live persona auth file
    let liveAuthFile = null;
    if (persona === 'wren') {
        const jailHome = cursorDirector.layout().home;
        liveAuthFile = path.join(jailHome, '.config', 'cursor', 'auth.json');
    } else if (persona === 'xi') {
        if (typeof xiDirector.layout === 'function') {
            liveAuthFile = path.join(xiDirector.layout().configDir, 'auth.json');
        }
    }

    if (liveAuthFile && fs.existsSync(liveAuthFile)) {
        try {
            const raw = JSON.parse(fs.readFileSync(liveAuthFile, 'utf8'));
            token = raw && (raw.accessToken || raw.apiKey);
        } catch (_) {}
    }

    // 2. Check stored profile auth file if live profile auth file didn't yield a token
    if (!token && activeId) {
        const accDir = cursorAccountAuthStore.getAccountDir(activeId);
        const storeAuthFile = path.join(accDir, 'auth.json');
        if (fs.existsSync(storeAuthFile)) {
            try {
                const raw = JSON.parse(fs.readFileSync(storeAuthFile, 'utf8'));
                token = raw && (raw.accessToken || raw.apiKey);
            } catch (_) {}
        }
    }

    // 3. Fallback to host auth file only if default host profile is active
    if (!token && activeId === 'default') {
        const hostAuthFile = path.join(os.homedir(), '.config', 'cursor', 'auth.json');
        if (fs.existsSync(hostAuthFile)) {
            try {
                const raw = JSON.parse(fs.readFileSync(hostAuthFile, 'utf8'));
                token = raw && (raw.accessToken || raw.apiKey);
            } catch (_) {}
        }
    }

    if (!token || typeof token !== 'string') {
        throw new Error(`Cursor is not signed in for ${persona === 'wren' ? 'Wren' : 'Xi'}`);
    }
    return { token, activeId };
}

function roundPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.round(n));
}

function cycleEndMs(body) {
    if (!body || typeof body !== 'object') return null;
    const plan = body.planUsage && typeof body.planUsage === 'object' ? body.planUsage : {};
    const raw = body.billingCycleEnd != null ? body.billingCycleEnd
        : (body.billingCycleEndMs != null ? body.billingCycleEndMs : plan.billingCycleEnd);
    if (raw == null || raw === '') return null;
    if (typeof raw === 'string' && /[T-]/.test(raw) && !/^\d+$/.test(raw)) {
        const parsed = Date.parse(raw);
        return Number.isFinite(parsed) ? parsed : null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function daysLeftFromEnd(endMs, now = Date.now()) {
    if (endMs == null) return null;
    const ms = endMs - now;
    if (ms <= 0) return 0;
    return Math.ceil(ms / 86400000);
}

const PLAN_LABELS = {
    free: 'Free',
    hobby: 'Hobby',
    pro: 'Pro',
    pro_plus: 'Pro+',
    proplus: 'Pro+',
    ultra: 'Ultra',
    business: 'Business',
    enterprise: 'Enterprise',
    team: 'Team'
};

function formatPlanName(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const key = text.toLowerCase().replace(/[\s-]+/g, '_');
    if (PLAN_LABELS[key]) return PLAN_LABELS[key];
    return text;
}

function planLabelFrom(planBody, usageBody) {
    const info = planBody && (planBody.planInfo || planBody);
    const fromPlan = info && (info.planName || info.plan || info.membershipType);
    const fromUsage = usageBody && (usageBody.membershipType || usageBody.planName);
    return formatPlanName(fromPlan) || formatPlanName(fromUsage) || '—';
}

function centsNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function formatUsdFromCents(cents) {
    if (cents == null) return '—';
    const dollars = cents / 100;
    const abs = Math.abs(dollars).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return dollars < 0 ? `-$${abs}` : `$${abs}`;
}

function costFromUsage(body) {
    const plan = body && body.planUsage ? body.planUsage : {};
    const spend = body && body.spendLimitUsage ? body.spendLimitUsage : {};
    const included = centsNumber(plan.totalSpend);
    const onDemandRaw = spend.individualUsed != null ? spend.individualUsed : spend.totalSpend;
    const onDemand = centsNumber(onDemandRaw);
    let total = null;
    if (included != null || onDemand != null) total = (included || 0) + (onDemand || 0);
    const limit = centsNumber(plan.limit);
    const parts = [];
    if (included != null) parts.push(`Included ${formatUsdFromCents(included)}`);
    if (onDemand != null && onDemand > 0) parts.push(`On-demand ${formatUsdFromCents(onDemand)}`);
    if (limit != null && included != null) parts.push(`plan allowance ${formatUsdFromCents(limit)}`);
    return {
        costCents: total,
        costLabel: total == null ? '—' : formatUsdFromCents(total),
        costTitle: parts.join(' · ') || 'API usage cost unavailable'
    };
}

function summarize(body, now = Date.now(), planBody = null) {
    const plan = body && body.planUsage ? body.planUsage : {};
    const percent = roundPercent(plan.totalPercentUsed);
    const autoPercent = roundPercent(plan.autoPercentUsed);
    const apiPercent = roundPercent(plan.apiPercentUsed);
    const endMs = cycleEndMs(body);
    const daysLeft = daysLeftFromEnd(endMs, now);
    // Included usage is still available under 100%. Cursor's displayMessage can
    // say the cap is hit earlier; that does not block a Director turn.
    const limited = percent != null && percent >= 100;
    const parts = [];
    if (autoPercent != null || apiPercent != null) {
        parts.push(`Auto ${autoPercent == null ? '—' : autoPercent + '%'}, other models ${apiPercent == null ? '—' : apiPercent + '%'}`);
    }
    if (limited) parts.push('Past included usage; a request may or may not be processed');
    if (daysLeft != null) {
        parts.push(daysLeft === 0 ? 'Billing cycle ended' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`);
    }
    const daysLabel = daysLeft == null ? '—' : (daysLeft === 1 ? '1 day' : `${daysLeft} days`);
    const cost = costFromUsage(body);
    return {
        percent,
        autoPercent,
        apiPercent,
        limited,
        daysLeft,
        daysLabel,
        cycleEnd: endMs,
        title: parts.join(' · ') || 'Cursor usage',
        label: percent == null ? '—' : `${percent}%`,
        plan: planLabelFrom(planBody, body),
        costCents: cost.costCents,
        costLabel: cost.costLabel,
        costTitle: cost.costTitle
    };
}

function publicAccountUsage(usage) {
    if (!usage) {
        return {
            label: '—',
            title: 'Usage unavailable',
            limited: false,
            percent: null,
            autoPercent: null,
            apiPercent: null,
            daysLeft: null,
            daysLabel: '—',
            plan: '—',
            costCents: null,
            costLabel: '—',
            costTitle: 'API usage cost unavailable'
        };
    }
    return {
        label: usage.label || '—',
        title: usage.title || 'Cursor usage',
        limited: usage.limited === true,
        percent: usage.percent == null ? null : usage.percent,
        autoPercent: usage.autoPercent == null ? null : usage.autoPercent,
        apiPercent: usage.apiPercent == null ? null : usage.apiPercent,
        daysLeft: Number.isFinite(usage.daysLeft) ? usage.daysLeft : null,
        daysLabel: usage.daysLabel || '—',
        plan: usage.plan || '—',
        costCents: usage.costCents == null ? null : usage.costCents,
        costLabel: usage.costLabel || '—',
        costTitle: usage.costTitle || 'API usage cost unavailable'
    };
}

function invalidateCursorUsage(persona) {
    if (!persona) {
        caches = {};
        return;
    }
    delete caches[persona];
    Object.keys(caches).forEach((key) => {
        if (key.startsWith('acct:')) delete caches[key];
    });
}

function readStoredAccountToken(accountId) {
    const cursorAccountAuthStore = require('./cursorAccountAuthStore');
    const accDir = cursorAccountAuthStore.getAccountDir(accountId || 'default');
    const storeAuthFile = path.join(accDir, 'auth.json');
    let token = null;
    if (fs.existsSync(storeAuthFile)) {
        try {
            const raw = JSON.parse(fs.readFileSync(storeAuthFile, 'utf8'));
            token = raw && (raw.accessToken || raw.apiKey);
        } catch (_) {}
    }
    if (!token && (accountId === 'default' || !accountId)) {
        const host = cursorAccountAuthStore.getHostAccountInfo();
        token = host && host.token ? host.token : null;
    }
    return typeof token === 'string' && token ? token : null;
}

function emailForAccount(accountId, token) {
    const cursorAccountAuthStore = require('./cursorAccountAuthStore');
    let email = cursorAccountAuthStore.extractEmailFromToken(token);
    if (email) return email;
    try {
        const accDir = cursorAccountAuthStore.getAccountDir(accountId || 'default');
        const cliFile = path.join(accDir, 'cli-config.json');
        if (fs.existsSync(cliFile)) {
            const cliData = JSON.parse(fs.readFileSync(cliFile, 'utf8'));
            if (cliData.authInfo && cliData.authInfo.email && !String(cliData.authInfo.email).startsWith('(')) {
                return cliData.authInfo.email;
            }
        }
    } catch (_) {}
    return '';
}

function rememberUsage(persona, accountId, value) {
    const at = Date.now();
    if (persona) caches[persona] = { at, value };
    if (accountId) caches[`acct:${accountId}`] = { at, value };
}

function agentBin() {
    const home = process.env.HOME || os.homedir();
    const candidate = path.join(home, '.local', 'bin', 'agent');
    try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
    } catch (_) {
        return 'agent';
    }
}

function refreshCliAuth() {
    return new Promise((resolve) => {
        const child = spawn(agentBin(), ['status', '--format', 'json'], {
            env: { ...process.env, NO_OPEN_BROWSER: '1' },
            stdio: ['ignore', 'ignore', 'ignore']
        });
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            resolve(false);
        }, 15000);
        child.on('error', () => {
            clearTimeout(timer);
            resolve(false);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve(code === 0);
        });
    });
}

async function postDashboard(url, token) {
    return fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1'
        },
        body: '{}'
    });
}

async function fetchUsage(token) {
    const dash = await fetchDashboard(token);
    return dash.usage;
}

async function fetchDashboard(token) {
    const [usageRes, planRes] = await Promise.all([
        postDashboard(USAGE_URL, token),
        postDashboard(PLAN_URL, token)
    ]);
    if (usageRes.status === 401) {
        // A crsr_ API key cannot read the session dashboard; that is not an expired login.
        const error = new Error(/^crsr_/.test(String(token || '')) ? 'Usage needs a browser session (API key is active)' : 'Cursor login expired');
        error.code = 'CURSOR_LOGIN';
        throw error;
    }
    if (!usageRes.ok) {
        throw new Error(`Cursor usage returned ${usageRes.status}`);
    }
    const usage = await usageRes.json();
    let plan = null;
    if (planRes.ok) {
        try { plan = await planRes.json(); } catch (_) {}
    }
    return { usage, plan };
}

async function getCursorUsage(persona = 'wren') {
    const now = Date.now();
    const cached = caches[persona];
    if (cached && now - cached.at < CACHE_MS) return cached.value;

    let { token, activeId } = readAccessToken(persona);
    let dash;
    try {
        dash = await fetchDashboard(token);
    } catch (error) {
        if (error.code !== 'CURSOR_LOGIN') throw error;
        const refreshed = await refreshCliAuth();
        if (!refreshed) throw error;
        const auth = readAccessToken(persona);
        token = auth.token;
        activeId = auth.activeId;
        dash = await fetchDashboard(token);
    }
    const body = dash.usage;

    const cursorAccountAuthStore = require('./cursorAccountAuthStore');
    let email = cursorAccountAuthStore.extractEmailFromToken(token);
    if (!email && activeId) {
        try {
            const accDir = cursorAccountAuthStore.getAccountDir(activeId);
            const cliFile = path.join(accDir, 'cli-config.json');
            if (fs.existsSync(cliFile)) {
                const cliData = JSON.parse(fs.readFileSync(cliFile, 'utf8'));
                if (cliData.authInfo && cliData.authInfo.email) {
                    email = cliData.authInfo.email;
                }
            }
        } catch (_) {}
    }

    const value = {
        ...summarize(body, Date.now(), dash.plan),
        persona,
        activeAccountId: activeId,
        accountEmail: email || ''
    };
    rememberUsage(persona, activeId, value);
    return value;
}

async function getCursorUsageForAccount(accountId) {
    const id = accountId || 'default';
    const now = Date.now();
    const cached = caches[`acct:${id}`];
    if (cached && now - cached.at < CACHE_MS) return cached.value;

    const cursorAccountAuthStore = require('./cursorAccountAuthStore');
    let token = null;
    let personaHit = null;
    for (const persona of ['wren', 'xi']) {
        if (cursorAccountAuthStore.getActiveAccountId(persona) !== id) continue;
        try {
            const auth = readAccessToken(persona);
            token = auth.token;
            personaHit = persona;
            break;
        } catch (_) {}
    }
    if (!token) token = readStoredAccountToken(id);
    if (!token) {
        const empty = {
            ...summarize(null),
            persona: personaHit,
            activeAccountId: id,
            accountEmail: '',
            title: 'No credentials for this profile'
        };
        rememberUsage(null, id, empty);
        return empty;
    }

    let dash;
    try {
        dash = await fetchDashboard(token);
    } catch (error) {
        const failed = {
            ...summarize(null),
            persona: personaHit,
            activeAccountId: id,
            accountEmail: '',
            title: error.message || 'Usage unavailable'
        };
        rememberUsage(null, id, failed);
        return failed;
    }
    const body = dash.usage;
    const value = {
        ...summarize(body, Date.now(), dash.plan),
        persona: personaHit,
        activeAccountId: id,
        accountEmail: emailForAccount(id, token)
    };
    rememberUsage(personaHit, id, value);
    return value;
}

async function handleDirectorGetCursorUsage(handler, ws, message) {
    try {
        const persona = message && message.persona ? message.persona : 'wren';
        const usage = await getCursorUsage(persona);
        handler.sendToClient(ws, {
            type: 'director_get_cursor_usage_response',
            requestId: message.requestId || null,
            data: { success: true, ...usage },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handler.sendToClient(ws, {
            type: 'director_get_cursor_usage_response',
            requestId: message.requestId || null,
            data: {
                success: false,
                persona: message && message.persona ? message.persona : 'wren',
                label: '—',
                title: error.message || 'Cursor usage unavailable',
                limited: false,
                daysLeft: null,
                daysLabel: '—'
            },
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    getCursorUsage,
    getCursorUsageForAccount,
    publicAccountUsage,
    invalidateCursorUsage,
    handleDirectorGetCursorUsage,
    _test: { summarize, roundPercent, cycleEndMs, daysLeftFromEnd, publicAccountUsage, formatPlanName, formatUsdFromCents, costFromUsage }
};
