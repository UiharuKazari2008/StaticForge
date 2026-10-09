'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
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

function summarize(body, now = Date.now()) {
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
    return {
        percent,
        autoPercent,
        apiPercent,
        limited,
        daysLeft,
        daysLabel,
        cycleEnd: endMs,
        title: parts.join(' · ') || 'Cursor usage',
        label: percent == null ? '—' : `${percent}%`
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
            daysLabel: '—'
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
        daysLabel: usage.daysLabel || '—'
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

async function fetchUsage(token) {
    const response = await fetch(USAGE_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1'
        },
        body: '{}'
    });
    if (response.status === 401) {
        const error = new Error('Cursor login expired');
        error.code = 'CURSOR_LOGIN';
        throw error;
    }
    if (!response.ok) {
        throw new Error(`Cursor usage returned ${response.status}`);
    }
    return response.json();
}

async function getCursorUsage(persona = 'wren') {
    const now = Date.now();
    const cached = caches[persona];
    if (cached && now - cached.at < CACHE_MS) return cached.value;

    let { token, activeId } = readAccessToken(persona);
    let body;
    try {
        body = await fetchUsage(token);
    } catch (error) {
        if (error.code !== 'CURSOR_LOGIN') throw error;
        const refreshed = await refreshCliAuth();
        if (!refreshed) throw error;
        const auth = readAccessToken(persona);
        token = auth.token;
        activeId = auth.activeId;
        body = await fetchUsage(token);
    }

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
        ...summarize(body),
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

    let body;
    try {
        body = await fetchUsage(token);
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
    const value = {
        ...summarize(body),
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
    _test: { summarize, roundPercent, cycleEndMs, daysLeftFromEnd, publicAccountUsage }
};
