'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const CACHE_MS = 60 * 1000;

let cache = { at: 0, value: null };

function authPath() {
    return path.join(os.homedir(), '.config', 'cursor', 'auth.json');
}

function readAccessToken() {
    const raw = JSON.parse(fs.readFileSync(authPath(), 'utf8'));
    const token = raw && raw.accessToken;
    if (!token || typeof token !== 'string') {
        throw new Error('Cursor is not signed in on this host');
    }
    return token;
}

function roundPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.round(n));
}

function summarize(body) {
    const plan = body && body.planUsage ? body.planUsage : {};
    const percent = roundPercent(plan.totalPercentUsed);
    const autoPercent = roundPercent(plan.autoPercentUsed);
    const apiPercent = roundPercent(plan.apiPercentUsed);
    // Included usage is still available under 100%. Cursor's displayMessage can
    // say the cap is hit earlier; that does not block a Director turn.
    const limited = percent != null && percent >= 100;
    const parts = [];
    if (autoPercent != null || apiPercent != null) {
        parts.push(`Auto ${autoPercent == null ? '—' : autoPercent + '%'}, other models ${apiPercent == null ? '—' : apiPercent + '%'}`);
    }
    if (limited) parts.push('Past included usage; a request may or may not be processed');
    return {
        percent,
        autoPercent,
        apiPercent,
        limited,
        title: parts.join(' · ') || 'Cursor usage',
        label: percent == null ? '—' : `${percent}%`
    };
}

function invalidateCursorUsage() {
    cache.at = 0;
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
        const error = new Error('Cursor login on this host expired');
        error.code = 'CURSOR_LOGIN';
        throw error;
    }
    if (!response.ok) {
        throw new Error(`Cursor usage returned ${response.status}`);
    }
    return response.json();
}

async function getCursorUsage() {
    const now = Date.now();
    if (cache.value && now - cache.at < CACHE_MS) return cache.value;
    let token = readAccessToken();
    let body;
    try {
        body = await fetchUsage(token);
    } catch (error) {
        if (error.code !== 'CURSOR_LOGIN') throw error;
        const refreshed = await refreshCliAuth();
        if (!refreshed) throw error;
        token = readAccessToken();
        body = await fetchUsage(token);
    }
    const value = summarize(body);
    cache = { at: Date.now(), value };
    return value;
}

async function handleDirectorGetCursorUsage(handler, ws, message) {
    try {
        const usage = await getCursorUsage();
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
                label: '—',
                title: error.message || 'Cursor usage unavailable',
                limited: false
            },
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    getCursorUsage,
    invalidateCursorUsage,
    handleDirectorGetCursorUsage,
    _test: { summarize, roundPercent }
};
