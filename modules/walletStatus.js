'use strict';
// Wallet tray (Yozora #430): usage and balance of every connected account and API key for
// the taskbar wallet flyout (public/scripts/comp/walletTray.js). NovelAI stays on the client
// (optionsData balance / subscription / opusUsage, already pushed by ping); this gathers the
// rest, each provider on its own so one failure only marks its own row:
//
//   cursor       every Cursor profile in secure config cursorAccounts (cursorUsage.js, 60 s cache)
//   claude       the 5-hour and 7-day windows of the last Claude turn (Director claude-usage.json)
//   tokenrouter  the account wallet (tokenRouterBridge.wallet: management key, 60 s cache)
//   runpod       managed pods (RunpodPodManager snapshot) and the account balance (GraphQL myself)
//   keys         services the key tripwire stopped calling (apiKeyManager locks, Unlock =
//                unlock_api_service) and keys Security Center's check refused (apiKeyHealth);
//                local state, so it is read on every request instead of cached
//
// Grok is left out of keys (it is being retired). OpenAI is left out: it gives API keys no balance (/dashboard/billing/credit_grants answers 403
// "must be made with a session key"), and work is moving to TokenRouter anyway.
//
// getWalletStatus(gr, { refresh, fresh }) -> { fetchedAt, cursor, claude, tokenrouter, runpod, keys };
// a service that is not set up is null.
const fs = require('fs');
const path = require('path');

const CACHE_MS = 2 * 60 * 1000;
// A refresh (flyout opened) still reuses a snapshot this young.
const REFRESH_FLOOR_MS = 20 * 1000;
const RUNPOD_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;
// Same rule as Security Center's Login button (securityCenterDsapApplet.js loginNeeded), plus a
// profile with no saved credentials at all.
const LOGIN_NEEDED_RE = /expired|not logged|login|unauthorized|no credentials/i;
const KEY_SKIP_SERVICES = new Set(['grok']);

let snapshot = null;
let inflight = null;
let runpodCache = { at: 0, key: '', value: null };

function shortError(error) {
    return String((error && error.message) || error || 'unavailable').replace(/\s+/g, ' ').slice(0, 160);
}

function secureConfig(gr, configPath) {
    try {
        return gr.getSecureConfig(configPath ? { path: configPath } : undefined) || null;
    } catch (_) {
        return null;
    }
}

function activeKey(gr, service) {
    try {
        const key = gr.getApiKeyManager().getActiveApiKey(service);
        return key ? String(key).trim() : '';
    } catch (_) {
        return '';
    }
}

// ---- Cursor: every saved profile ----

async function cursorStatus(gr) {
    const data = secureConfig(gr, 'cursorAccounts');
    const store = require('./cursorAccountAuthStore');
    const usage = require('./cursorUsage');
    const saved = data && Array.isArray(data.accounts) && data.accounts.length;
    // No saved profiles and no host login: Cursor is not set up on this server
    if (!saved && !(store.getHostAccountInfo() || {}).token) return null;
    const raw = saved ? data.accounts : [{ id: 'default', name: 'Host Account (Default)', isDefault: true }];
    const personas = {};
    ['wren', 'xi'].forEach((persona) => {
        const id = (data && data[persona] && data[persona].activeAccountId) || 'default';
        (personas[id] = personas[id] || []).push(persona === 'xi' ? 'Xi' : 'Wren');
    });
    const accounts = await Promise.all(raw.filter((acc) => acc && acc.id).map(async (acc) => {
        const pub = store.publicCursorAccount(acc) || {};
        let meta = {};
        try { meta = store.readAccountProfileMeta(acc.id) || {}; } catch (_) { /* optional */ }
        let row = null;
        let error = null;
        if (acc.isEmpty) {
            error = 'Not logged in yet';
        } else {
            try {
                row = await usage.getCursorUsageForAccount(acc.id);
            } catch (err) {
                error = shortError(err);
            }
        }
        const pubUsage = usage.publicAccountUsage(row);
        // publicAccountUsage fills gaps with an em dash placeholder
        const text = (value) => (value === '\u2014' ? '' : value || '');
        if (!error && pubUsage.percent == null) error = pubUsage.title || 'Usage unavailable';
        let email = pub.email || '';
        if (!email && pub.isDefault) {
            try { email = (store.getHostAccountInfo() || {}).email || ''; } catch (_) { /* optional */ }
        }
        if (email === 'system@cursor.sh') email = '';
        return {
            id: acc.id,
            name: meta.displayName || pub.name || 'Cursor account',
            email,
            color: pub.color || '',
            personas: personas[acc.id] || [],
            plan: text(pubUsage.plan),
            percent: pubUsage.percent,
            autoPercent: pubUsage.autoPercent,
            apiPercent: pubUsage.apiPercent,
            limited: pubUsage.limited,
            daysLeft: pubUsage.daysLeft,
            costLabel: text(pubUsage.costLabel),
            needsLogin: !!(acc.isEmpty || /pending login/i.test(acc.email || '') || (pubUsage.percent == null && LOGIN_NEEDED_RE.test(error || ''))),
            error
        };
    }));
    return { accounts };
}

// ---- Claude: subscription windows from the last Claude turn ----

function claudeUsageFile() {
    return path.join(require('./cursorDirector').layout().root, 'claude-usage.json');
}

function windowRow(row) {
    if (!row) return null;
    const n = Number(row.utilization);
    const at = Number(row.resetsAt);
    return {
        percent: Number.isFinite(n) ? Math.round(n <= 1 ? n * 100 : n) : null,
        resetsAt: Number.isFinite(at) && at > 0 ? at * 1000 : null
    };
}

// disk: { at, info } as cursorDirector.noteClaudeUsage writes it.
function summarizeClaude(disk) {
    const info = disk && disk.info;
    if (!info) return { at: null, status: null, fiveHour: null, sevenDay: null };
    const windows = info.unifiedWindows || {};
    return {
        at: Number(disk.at) || null,
        status: typeof info.status === 'string' ? info.status : null,
        resetsAt: Number(info.resetsAt) > 0 ? Number(info.resetsAt) * 1000 : null,
        fiveHour: windowRow(windows.five_hour),
        sevenDay: windowRow(windows.seven_day)
    };
}

function claudeStatus() {
    let disk = null;
    try {
        disk = JSON.parse(fs.readFileSync(claudeUsageFile(), 'utf8'));
    } catch (_) {
        disk = null;
    }
    if (!disk) {
        let installed = false;
        try { installed = !!require('./cursorDirector').findClaude(); } catch (_) { /* not installed */ }
        return installed ? summarizeClaude(null) : null;
    }
    return summarizeClaude(disk);
}

// ---- TokenRouter: the account wallet ----

async function tokenRouterStatus(gr) {
    if (!activeKey(gr, 'tokenrouter')) return null;
    let bridge;
    try {
        bridge = require('./tokenRouterBridge');
    } catch (_) {
        return null;
    }
    try {
        bridge.bindGlobalResources(gr);
        const info = await bridge.wallet(gr);
        if (!info || !info.configured) return { managementKey: false };
        if (info.error) return { managementKey: true, error: info.error };
        return {
            managementKey: true,
            remaining: info.remaining,
            topUp: info.topUp,
            vouchers: info.vouchers,
            spent: info.spent
        };
    } catch (error) {
        return { managementKey: true, error: shortError(error) };
    }
}

// ---- RunPod: pods and balance ----

async function runpodBalance(key) {
    const fp = require('crypto').createHash('sha256').update(key).digest('hex').slice(0, 16);
    if (runpodCache.value && runpodCache.key === fp && Date.now() - runpodCache.at < RUNPOD_TTL_MS) {
        return runpodCache.value;
    }
    let value;
    try {
        const res = await fetch('https://api.runpod.io/graphql', {
            method: 'POST',
            headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ query: 'query { myself { clientBalance currentSpendPerHr spendLimit } }' }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        const body = await res.json().catch(() => null);
        const me = body && body.data && body.data.myself;
        if (!res.ok || !me) {
            const detail = body && Array.isArray(body.errors) && body.errors[0] && body.errors[0].message;
            value = { error: detail ? String(detail).slice(0, 160) : `Balance unavailable (HTTP ${res.status})` };
        } else {
            const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
            value = { balance: num(me.clientBalance), spendPerHr: num(me.currentSpendPerHr), spendLimit: num(me.spendLimit) };
        }
    } catch (error) {
        value = { error: `Balance unavailable (${shortError(error)})` };
    }
    runpodCache = { at: Date.now(), key: fp, value };
    return value;
}

async function runpodStatus(gr) {
    const key = activeKey(gr, 'runpod');
    let snap = { pods: [] };
    try {
        snap = gr.getRunpodPodManager().getCachedSnapshot() || snap;
    } catch (_) { /* manager not started */ }
    const pods = (Array.isArray(snap.pods) ? snap.pods : []).map((pod) => ({
        id: pod.id,
        name: pod.name || pod.id,
        status: pod.status || 'unknown',
        costPerHr: Number.isFinite(Number(pod.costPerHr)) ? Number(pod.costPerHr) : null,
        lastStartedAt: pod.lastStartedAt || null,
        gpuName: pod.gpuName || null,
        error: pod.error || null
    }));
    if (!key && !pods.length) return null;
    const money = key ? await runpodBalance(key) : { error: 'RunPod API key is not configured' };
    return {
        pods,
        running: pods.filter((pod) => pod.status === 'running' || pod.status === 'starting').length,
        ...money
    };
}

// ---- Service keys: tripwire locks and refused keys ----

function keyStatus(gr) {
    let manager;
    try {
        manager = gr.getApiKeyManager();
    } catch (_) {
        return { locks: [], failed: [] };
    }
    if (!manager || !manager.SERVICE_METADATA) return { locks: [], failed: [] };
    const label = (service) => (manager.SERVICE_METADATA[service] && manager.SERVICE_METADATA[service].label) || service;
    const locks = [];
    (manager.TRIPWIRE_SERVICES ? [...manager.TRIPWIRE_SERVICES] : []).forEach((service) => {
        if (KEY_SKIP_SERVICES.has(service)) return;
        const lock = typeof manager.getServiceLock === 'function' ? manager.getServiceLock(service) : null;
        if (!lock || !lock.locked) return;
        locks.push({
            service,
            label: label(service),
            failureCount: lock.failureCount || 0,
            lastStatus: lock.lastStatus || null,
            lastMessage: lock.lastMessage ? String(lock.lastMessage).slice(0, 200) : '',
            lockedAt: lock.lockedAt || null
        });
    });
    const failed = [];
    let statuses = {};
    try {
        statuses = require('./apiKeyHealth').publicStatuses(gr) || {};
    } catch (_) { /* key checks not available */ }
    Object.keys(statuses).forEach((service) => {
        if (KEY_SKIP_SERVICES.has(service)) return;
        const keys = typeof manager.getServiceKeys === 'function' ? manager.getServiceKeys(service) : [];
        (statuses[service] || []).forEach((row) => {
            Object.keys(row).forEach((slot) => {
                const st = row[slot];
                if (slot === 'index' || !st || st.state !== 'fail') return;
                const entry = keys[row.index] || {};
                failed.push({
                    service,
                    label: label(service),
                    slot,
                    index: row.index,
                    keyName: entry.name || '',
                    message: st.message || 'Key refused',
                    checkedAt: st.checkedAt || null
                });
            });
        });
    });
    return { locks, failed };
}

// ---- Snapshot ----

async function settle(label, fn) {
    try {
        return await fn();
    } catch (error) {
        console.warn(`Wallet status ${label} failed: ${shortError(error)}`);
        return { error: shortError(error) };
    }
}

async function collect(gr) {
    const [cursor, claude, tokenrouter, runpod] = await Promise.all([
        settle('cursor', () => cursorStatus(gr)),
        settle('claude', () => claudeStatus()),
        settle('tokenrouter', () => tokenRouterStatus(gr)),
        settle('runpod', () => runpodStatus(gr))
    ]);
    return { fetchedAt: Date.now(), cursor, claude, tokenrouter, runpod };
}

// refresh: the flyout opened (reuses a snapshot younger than REFRESH_FLOOR_MS);
// fresh: something just changed, e.g. a Cursor login finished (always reads again).
async function getWalletStatus(gr, options = {}) {
    const age = snapshot ? Date.now() - snapshot.fetchedAt : Infinity;
    const floor = options.fresh ? 0 : REFRESH_FLOOR_MS;
    let value;
    if (snapshot && (age < floor || (!options.refresh && !options.fresh && age < CACHE_MS))) {
        value = snapshot;
    } else {
        if (!inflight) {
            inflight = collect(gr).then((next) => {
                snapshot = next;
                return next;
            }).finally(() => {
                inflight = null;
            });
        }
        value = await inflight;
    }
    return { ...value, keys: keyStatus(gr) };
}

module.exports = {
    getWalletStatus,
    _test: {
        summarizeClaude,
        keyStatus,
        LOGIN_NEEDED_RE,
        reset() {
            snapshot = null;
            inflight = null;
            runpodCache = { at: 0, key: '', value: null };
        }
    }
};
