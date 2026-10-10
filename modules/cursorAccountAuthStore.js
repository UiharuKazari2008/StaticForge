'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ACCOUNTS_BASE_DIR = path.join(process.cwd(), '.cache', 'dreamscape-cursor-accounts');

const DIRECTOR_CLI_OVERLAY = {
    permissions: {
        allowShellExecution: true,
        allowWebSearch: true,
        allowFileSystem: true
    }
};

function getAccountDir(accountId) {
    const id = (accountId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(ACCOUNTS_BASE_DIR, id);
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function safeCopyFile(src, dst) {
    try {
        if (fs.existsSync(src)) {
            ensureDir(path.dirname(dst));
            fs.copyFileSync(src, dst);
            try { fs.chmodSync(dst, 0o600); } catch (_) {}
            return true;
        }
    } catch (err) {
        console.warn(`[cursorAccountAuthStore] Copy failed ${src} -> ${dst}:`, err.message);
    }
    return false;
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeJson(file, data) {
    try {
        ensureDir(path.dirname(file));
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
        try { fs.chmodSync(file, 0o600); } catch (_) {}
        return true;
    } catch (err) {
        console.warn(`[cursorAccountAuthStore] Write failed ${file}:`, err.message);
        return false;
    }
}

function isEmailString(str) {
    return typeof str === 'string' && str.includes('@') && !str.startsWith('(');
}

function isJwt(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return false;
    return parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part));
}

// User API keys from the Cursor dashboard are `crsr_…`. `sk-` is the older check.
// A session from `agent login` is a JWT. The CLI only exchanges and refreshes real API keys.
function isCursorApiKey(token) {
    const raw = String(token || '').trim();
    if (!raw || raw === 'empty' || raw.startsWith('{') || isJwt(raw)) return false;
    return raw.startsWith('crsr_') || raw.startsWith('sk-');
}

function credentialKind(token, explicit) {
    if (explicit === 'apiKey' || explicit === 'accessToken') return explicit;
    const raw = String(token || '').trim();
    if (!raw || raw === 'empty' || raw.startsWith('{')) return '';
    return isCursorApiKey(raw) ? 'apiKey' : 'accessToken';
}

function dreamscapeApiKeyName(accountId) {
    const id = String(accountId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `dreamscape-${id}`;
}

function normalizeAuthRecord(auth) {
    const src = auth && typeof auth === 'object' ? auth : {};
    const apiKey = typeof src.apiKey === 'string' ? src.apiKey.trim() : '';
    const accessToken = typeof src.accessToken === 'string' ? src.accessToken.trim() : '';
    if (isCursorApiKey(apiKey) || isCursorApiKey(accessToken)) {
        return { apiKey: isCursorApiKey(apiKey) ? apiKey : accessToken };
    }
    const next = {};
    if (accessToken) next.accessToken = accessToken;
    if (typeof src.refreshToken === 'string' && src.refreshToken.trim()) next.refreshToken = src.refreshToken.trim();
    if (apiKey) next.apiKey = apiKey;
    return next;
}

function authFromCredential(rawToken, explicitKind) {
    const raw = String(rawToken || '').trim();
    if (!raw || raw === 'empty') return {};
    if (raw.startsWith('{')) {
        try {
            return normalizeAuthRecord(JSON.parse(raw));
        } catch (_) {
            return { accessToken: raw };
        }
    }
    if (credentialKind(raw, explicitKind) === 'apiKey') return { apiKey: raw };
    return { accessToken: raw };
}

// Login and other Cursor spawns must not inherit the key that launched Dreamscape.
function spawnEnvWithoutInheritedCursor(overrides) {
    const env = {};
    Object.keys(process.env).forEach((key) => {
        if (key.startsWith('CURSOR_') || key.startsWith('VSCODE_')) return;
        env[key] = process.env[key];
    });
    return Object.assign(env, overrides || {});
}

function extractEmailFromToken(token) {
    if (!token || typeof token !== 'string') return '';
    try {
        if (token.startsWith('{')) {
            const parsed = JSON.parse(token);
            if (isEmailString(parsed.email)) return parsed.email;
            if (isEmailString(parsed.emailAddress)) return parsed.emailAddress;
            if (parsed.accessToken) return extractEmailFromToken(parsed.accessToken);
        }
        const parts = token.split('.');
        if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            const candidates = [
                payload.email,
                payload['https://cursor.com/email'],
                payload['https://cursor.sh/email'],
                payload.email_address,
                payload.userEmail,
                payload.user_metadata && payload.user_metadata.email,
                payload.profile && payload.profile.email
            ];
            for (const cand of candidates) {
                if (isEmailString(cand)) return cand;
            }
        }
    } catch (_) {}
    return '';
}

function getHostAccountInfo() {
    let email = '';
    let token = '';
    try {
        const cliPath = path.join(os.homedir(), '.cursor', 'cli-config.json');
        if (fs.existsSync(cliPath)) {
            const data = readJson(cliPath);
            if (data && data.authInfo) {
                const cand = data.authInfo.email || data.authInfo.emailAddress;
                if (isEmailString(cand)) {
                    email = cand;
                }
            }
        }
    } catch (_) {}

    try {
        const authPath = path.join(os.homedir(), '.config', 'cursor', 'auth.json');
        if (fs.existsSync(authPath)) {
            const data = readJson(authPath);
            if (data) {
                token = data.accessToken || data.apiKey || '';
                if (!email && data.accessToken) {
                    const extracted = extractEmailFromToken(data.accessToken);
                    if (isEmailString(extracted)) {
                        email = extracted;
                    }
                }
            }
        }
    } catch (_) {}

    return { email, token };
}

/**
 * Save auth files for a specific account profile.
 */
function saveAccountAuthFiles(accountId, profile, customToken) {
    const accDir = getAccountDir(accountId);
    ensureDir(accDir);

    const rawToken = (customToken !== undefined ? customToken : (profile.token || '')).trim();
    let authData = {};
    const explicitKind = profile && (profile.tokenKind === 'apiKey' || profile.tokenKind === 'accessToken')
        ? profile.tokenKind
        : '';

    const authFile = path.join(accDir, 'auth.json');
    if (profile.isEmpty || rawToken === 'empty') {
        authData = {};
    } else if (rawToken) {
        authData = authFromCredential(rawToken, explicitKind);
    } else if (fs.existsSync(authFile)) {
        authData = normalizeAuthRecord(readJson(authFile) || {});
    } else if (accountId === 'default') {
        const hostAuth = path.join(os.homedir(), '.config', 'cursor', 'auth.json');
        authData = normalizeAuthRecord(readJson(hostAuth) || {});
    } else {
        authData = {};
    }

    writeJson(authFile, authData);

    const cliFile = path.join(accDir, 'cli-config.json');
    let existingCliData = readJson(cliFile);
    if (!existingCliData && accountId === 'default') {
        const hostCli = path.join(os.homedir(), '.cursor', 'cli-config.json');
        existingCliData = readJson(hostCli) || {};
    }
    existingCliData = existingCliData || {};

    const hostInfo = getHostAccountInfo();
    const realEmail = profile.isEmpty ? '(Pending Login)' : (profile.email || extractEmailFromToken(authData.accessToken) || (accountId === 'default' ? hostInfo.email : '') || '');

    const cliData = {
        ...existingCliData,
        authInfo: {
            authId: accountId,
            email: realEmail,
            displayName: String((existingCliData.authInfo && existingCliData.authInfo.displayName) || '').trim()
        },
        ...DIRECTOR_CLI_OVERLAY
    };
    writeJson(cliFile, cliData);

    if (profile.isEmpty || rawToken === 'empty') {
        const cacheFile = path.join(accDir, 'statsig-cache.json');
        if (fs.existsSync(cacheFile)) {
            try { fs.unlinkSync(cacheFile); } catch (_) {}
        }
    } else {
        const hostCache = path.join(os.homedir(), '.cursor', 'statsig-cache.json');
        if (!fs.existsSync(path.join(accDir, 'statsig-cache.json'))) {
            safeCopyFile(hostCache, path.join(accDir, 'statsig-cache.json'));
        }
    }
}

/**
 * Capture live auth files from active persona (Wren/Xi) or host into a saved account profile.
 */
function captureLivePersonaAuthFiles(persona, accountId) {
    const accDir = getAccountDir(accountId);
    ensureDir(accDir);

    const cursorDirector = require('./cursorDirector');
    const xiDirector = require('./xiDirector');

    let sourceDir = null;
    if (persona === 'wren') {
        const jailHome = cursorDirector.layout().home;
        sourceDir = path.join(jailHome, '.config', 'cursor');
    } else if (persona === 'xi') {
        sourceDir = xiDirector.layout ? xiDirector.layout().configDir : null;
    }

    let copiedFromSource = false;
    if (sourceDir && fs.existsSync(sourceDir)) {
        const liveAuth = readJson(path.join(sourceDir, 'auth.json')) || {};
        if (liveAuth.accessToken || liveAuth.apiKey) {
            safeCopyFile(path.join(sourceDir, 'auth.json'), path.join(accDir, 'auth.json'));
            safeCopyFile(path.join(sourceDir, 'cli-config.json'), path.join(accDir, 'cli-config.json'));
            safeCopyFile(path.join(sourceDir, 'statsig-cache.json'), path.join(accDir, 'statsig-cache.json'));
            copiedFromSource = true;
        }
    }

    if (!copiedFromSource) {
        if (accountId === 'default') {
            const hostAuth = path.join(os.homedir(), '.config', 'cursor', 'auth.json');
            const hostCli = path.join(os.homedir(), '.cursor', 'cli-config.json');
            const hostCache = path.join(os.homedir(), '.cursor', 'statsig-cache.json');
            safeCopyFile(hostAuth, path.join(accDir, 'auth.json'));
            safeCopyFile(hostCli, path.join(accDir, 'cli-config.json'));
            safeCopyFile(hostCache, path.join(accDir, 'statsig-cache.json'));
        }
    }

    const authData = readJson(path.join(accDir, 'auth.json')) || {};
    const cliData = readJson(path.join(accDir, 'cli-config.json')) || {};

    const token = authData.accessToken || authData.apiKey || '';
    let email = extractEmailFromToken(token);
    if (!email && cliData.authInfo && cliData.authInfo.email && !cliData.authInfo.email.startsWith('(')) {
        email = cliData.authInfo.email;
    }
    if (!email && token) {
        email = getHostAccountInfo().email || 'authenticated_user@cursor.sh';
    }
    if (!email) {
        email = '(Pending Login)';
    }

    if (cliData.authInfo) {
        cliData.authInfo.authId = accountId;
        cliData.authInfo.email = email;
        writeJson(path.join(accDir, 'cli-config.json'), cliData);
    }

    return { email, token, captured: true };
}

/**
 * Restore stored auth files for an account profile into a target config dir (e.g. Wren or Xi CLI config dir).
 */
function restoreAccountAuthFiles(accountId, targetConfigDir) {
    if (!targetConfigDir) return false;
    const accDir = getAccountDir(accountId);
    ensureDir(targetConfigDir);

    // Ensure account profile files on disk match the account profile metadata in secureConfig
    try {
        const secureConfigPath = path.join(process.cwd(), 'secure.config.json');
        if (fs.existsSync(secureConfigPath)) {
            const data = readJson(secureConfigPath);
            const accounts = data && data.cursorAccounts && data.cursorAccounts.accounts;
            if (Array.isArray(accounts)) {
                const acc = accounts.find(a => a.id === accountId);
                if (acc) {
                    saveAccountAuthFiles(accountId, acc, acc.isEmpty ? 'empty' : (acc.token || ''));
                }
            }
        }
    } catch (_) {}

    // If profile dir doesn't exist yet and account is default, seed it from host
    if (!fs.existsSync(accDir) && (accountId === 'default' || !accountId)) {
        const hostInfo = getHostAccountInfo();
        saveAccountAuthFiles('default', { name: 'Host Account (Default)', email: hostInfo.email || 'Host Logged-in User' }, '');
    }

    let copiedAny = false;
    if (fs.existsSync(accDir)) {
        const authSrc = path.join(accDir, 'auth.json');
        const cliSrc = path.join(accDir, 'cli-config.json');
        const cacheSrc = path.join(accDir, 'statsig-cache.json');

        if (safeCopyFile(authSrc, path.join(targetConfigDir, 'auth.json'))) copiedAny = true;
        if (safeCopyFile(cliSrc, path.join(targetConfigDir, 'cli-config.json'))) copiedAny = true;
        if (safeCopyFile(cacheSrc, path.join(targetConfigDir, 'statsig-cache.json'))) copiedAny = true;
    }

    return copiedAny;
}

/**
 * Delete stored auth files for an account profile.
 */
function deleteAccountAuthFiles(accountId) {
    if (!accountId || accountId === 'default') return false;
    const accDir = getAccountDir(accountId);
    try {
        if (fs.existsSync(accDir)) {
            fs.rmSync(accDir, { recursive: true, force: true });
            return true;
        }
    } catch (err) {
        console.warn(`[cursorAccountAuthStore] Delete failed ${accDir}:`, err.message);
    }
    return false;
}

/**
 * Log out active Cursor account for a persona (Wren/Xi) and clear active profile credentials.
 */
function logoutCursorAccount(persona, activeAccountId) {
    const cursorDirector = require('./cursorDirector');
    const xiDirector = require('./xiDirector');
    const cursorUsage = require('./cursorUsage');

    let targetConfigDir = null;
    if (persona === 'wren') {
        const jailHome = cursorDirector.layout().home;
        targetConfigDir = path.join(jailHome, '.config', 'cursor');
    } else if (persona === 'xi') {
        targetConfigDir = xiDirector.layout ? xiDirector.layout().configDir : null;
    }

    if (targetConfigDir && fs.existsSync(targetConfigDir)) {
        writeJson(path.join(targetConfigDir, 'auth.json'), {});
        const cliData = readJson(path.join(targetConfigDir, 'cli-config.json')) || {};
        cliData.authInfo = cliData.authInfo || {};
        cliData.authInfo.email = '(Logged Out)';
        writeJson(path.join(targetConfigDir, 'cli-config.json'), cliData);
        const cacheFile = path.join(targetConfigDir, 'statsig-cache.json');
        if (fs.existsSync(cacheFile)) {
            try { fs.unlinkSync(cacheFile); } catch (_) {}
        }
    }

    if (activeAccountId) {
        const accDir = getAccountDir(activeAccountId);
        if (fs.existsSync(accDir)) {
            writeJson(path.join(accDir, 'auth.json'), {});
            const cliData = readJson(path.join(accDir, 'cli-config.json')) || {};
            cliData.authInfo = cliData.authInfo || {};
            cliData.authInfo.email = '(Logged Out)';
            writeJson(path.join(accDir, 'cli-config.json'), cliData);
            const cacheFile = path.join(accDir, 'statsig-cache.json');
            if (fs.existsSync(cacheFile)) {
                try { fs.unlinkSync(cacheFile); } catch (_) {}
            }
        }
    }

    if (typeof cursorUsage.invalidateCursorUsage === 'function') {
        cursorUsage.invalidateCursorUsage();
    }

    return { success: true, message: `Logged out Cursor account for ${persona === 'wren' ? 'Wren' : 'Xi'}` };
}

function publicCursorAccount(acc) {
    if (!acc || typeof acc !== 'object') return null;
    const color = typeof acc.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(acc.color) ? acc.color : '';
    return {
        id: acc.id,
        name: acc.name || 'Account',
        email: acc.email || '',
        color,
        isDefault: !!(acc.isDefault || acc.id === 'default'),
        isEmpty: !!acc.isEmpty
    };
}

function normalizeAccountColor(value) {
    const text = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : '';
}

const loginJobs = new Map();
const LOGIN_URL_RE = /https:\/\/cursor\.com\/loginDeepControl\?\S+/;
const LOGIN_WAIT_MS = 5 * 60 * 1000;

function stopLoginJob(job, signal) {
    if (!job) return;
    if (job.timer) clearInterval(job.timer);
    if (job.failTimer) clearTimeout(job.failTimer);
    job.timer = null;
    job.failTimer = null;
    if (job.child && job.child.exitCode == null && job.child.signalCode == null) {
        try { job.child.kill(signal || 'SIGTERM'); } catch (_) { /* already gone */ }
    }
}

function readLoginAuth(dir) {
    const auth = readJson(path.join(dir, 'auth.json'));
    if (!auth || !(auth.accessToken || auth.apiKey)) return null;
    return auth;
}

function finishAccountLogin(accountId) {
    const job = loginJobs.get(accountId);
    if (!job || job.settled) return null;
    const auth = readLoginAuth(job.dir);
    if (!auth) return null;
    job.settled = true;
    stopLoginJob(job, 'SIGTERM');
    const accDir = getAccountDir(accountId);
    ensureDir(accDir);
    safeCopyFile(path.join(job.dir, 'auth.json'), path.join(accDir, 'auth.json'));
    safeCopyFile(path.join(job.dir, 'cli-config.json'), path.join(accDir, 'cli-config.json'));
    try { fs.rmSync(job.dir, { recursive: true, force: true }); } catch (_) { /* staging dir */ }
    loginJobs.delete(accountId);
    const email = extractEmailFromToken(auth.accessToken) || '';
    const listeners = job.listeners.splice(0);
    const result = {
        accountId,
        email,
        token: auth.accessToken || auth.apiKey || '',
        accessToken: auth.accessToken || '',
        apiKey: isCursorApiKey(auth.apiKey) ? auth.apiKey : ''
    };
    listeners.forEach((listener) => {
        if (listener.onDone) listener.onDone(result);
    });
    return result;
}

function failAccountLogin(accountId, message) {
    const job = loginJobs.get(accountId);
    if (!job || job.settled) return;
    job.settled = true;
    stopLoginJob(job, 'SIGTERM');
    try { fs.rmSync(job.dir, { recursive: true, force: true }); } catch (_) { /* staging dir */ }
    loginJobs.delete(accountId);
    const listeners = job.listeners.splice(0);
    listeners.forEach((listener) => {
        if (listener.onFail) listener.onFail(new Error(message || 'Login failed'));
    });
}

// Isolated CURSOR_CONFIG_DIR so a browser login never replaces the live Wren or Xi auth.
// The caller restores the configured active profiles after the new auth is stored.
function beginCursorAccountLogin(accountId, listener) {
    const id = String(accountId || '').trim();
    if (!id) {
        const error = new Error('accountId is required');
        error.code = 'MISSING_ACCOUNT_ID';
        throw error;
    }
    const existing = loginJobs.get(id);
    if (existing && !existing.settled) {
        existing.listeners.push(listener || {});
        if (existing.url && listener && listener.onUrl) listener.onUrl(existing.url);
        return existing;
    }
    const cursorDirector = require('./cursorDirector');
    const agentBin = cursorDirector.findAgent && cursorDirector.findAgent();
    if (!agentBin) {
        const error = new Error('Cursor is not installed');
        error.code = 'CURSOR_MISSING';
        throw error;
    }
    const dir = path.join(getAccountDir(id), 'pending-login');
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* fresh staging dir */ }
    ensureDir(dir);
    const child = require('child_process').spawn(agentBin, ['login'], {
        env: spawnEnvWithoutInheritedCursor({
            NO_OPEN_BROWSER: '1',
            CURSOR_CONFIG_DIR: dir,
            BROWSER: 'echo'
        }),
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const job = {
        child,
        dir,
        url: '',
        settled: false,
        listeners: [listener || {}],
        timer: null,
        failTimer: null
    };
    loginJobs.set(id, job);
    let buf = '';
    const take = (chunk) => {
        buf += chunk.toString();
        if (buf.length > 8000) buf = buf.slice(-4000);
        const match = buf.match(LOGIN_URL_RE);
        if (!match || job.url) return;
        job.url = match[0];
        job.listeners.forEach((item) => {
            if (item.onUrl) item.onUrl(job.url);
        });
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (error) => failAccountLogin(id, error.message || 'Login failed'));
    child.on('exit', () => {
        if (!finishAccountLogin(id) && loginJobs.get(id) === job) {
            failAccountLogin(id, 'Login ended before Cursor saved the session');
        }
    });
    job.timer = setInterval(() => { finishAccountLogin(id); }, 1000);
    job.failTimer = setTimeout(() => failAccountLogin(id, 'Login timed out'), LOGIN_WAIT_MS);
    return job;
}

const DASHBOARD_ROOT = 'https://api2.cursor.sh/aiserver.v1.DashboardService';

function dashboardKeyList(body) {
    if (!body || typeof body !== 'object') return [];
    const list = body.apiKeys || body.api_keys || body.userApiKeys || body.keys;
    return Array.isArray(list) ? list : [];
}

function dashboardKeyId(row) {
    if (!row || typeof row !== 'object') return null;
    const id = row.id != null ? row.id : row.keyId;
    if (typeof id === 'number' && Number.isFinite(id)) return id;
    if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id);
    return null;
}

async function postCursorDashboard(method, accessToken, body, fetchImpl) {
    const doFetch = fetchImpl || fetch;
    const res = await doFetch(`${DASHBOARD_ROOT}/${method}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1'
        },
        body: JSON.stringify(body || {}),
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(20000)
            : undefined
    });
    const text = await res.text();
    let data = {};
    if (text) {
        try { data = JSON.parse(text); } catch (_) { data = { message: String(text).slice(0, 300) }; }
    }
    if (!res.ok) {
        const error = new Error(data.message || data.error || `Cursor ${method} failed (${res.status})`);
        error.status = res.status;
        throw error;
    }
    return data;
}

// Drop every previously minted dreamscape-<accountId> key, then create a new one.
async function provisionNamedApiKey(accountId, accessToken, fetchImpl) {
    const session = String(accessToken || '').trim();
    if (!session) {
        const error = new Error('Cursor login did not return a session');
        error.code = 'MISSING_SESSION';
        throw error;
    }
    const name = dreamscapeApiKeyName(accountId);
    const listed = await postCursorDashboard('ListUserApiKeys', session, {}, fetchImpl);
    const stale = dashboardKeyList(listed).filter((row) => String((row && row.name) || '').trim() === name);
    for (const row of stale) {
        const id = dashboardKeyId(row);
        if (id == null) continue;
        await postCursorDashboard('RevokeUserApiKey', session, { id }, fetchImpl);
    }
    const created = await postCursorDashboard('CreateUserApiKey', session, { name }, fetchImpl);
    const apiKey = created && (created.apiKey || created.api_key);
    if (!isCursorApiKey(apiKey)) {
        const error = new Error('Cursor did not return an API key for this account');
        error.code = 'API_KEY_MISSING';
        throw error;
    }
    return apiKey;
}

// Persist the guided login onto the account profile. The stored credential is the
// named API key. A failed mint keeps the fresh session so restore does not write
// the previous token back over the login that just succeeded.
async function recordGuidedLogin(cursorData, accountId, session, deps) {
    const data = cursorData && typeof cursorData === 'object' ? cursorData : { accounts: [] };
    const incoming = session && typeof session === 'object' ? session : {};
    const accessToken = incoming.accessToken || (isJwt(incoming.token) ? incoming.token : '');
    let apiKey = isCursorApiKey(incoming.apiKey) ? incoming.apiKey : '';
    let provisionError = null;
    if (!apiKey && accessToken) {
        try {
            apiKey = await provisionNamedApiKey(accountId, accessToken, deps && deps.fetchImpl);
        } catch (err) {
            provisionError = err;
        }
    }
    const token = apiKey || accessToken || (isCursorApiKey(incoming.token) ? incoming.token : '');
    const email = incoming.email || extractEmailFromToken(accessToken) || '';
    const tokenKind = (apiKey || isCursorApiKey(token)) ? 'apiKey' : (token ? 'accessToken' : '');
    const profile = {
        id: accountId,
        name: '',
        email: email || '(Pending Login)',
        token,
        tokenKind,
        isEmpty: !token
    };
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const acc = accounts.find((item) => item && item.id === accountId);
    if (acc) {
        if (email) acc.email = email;
        acc.token = token;
        acc.tokenKind = tokenKind;
        acc.isEmpty = !token;
        profile.name = acc.name || '';
        profile.email = acc.email || profile.email;
    }
    saveAccountAuthFiles(accountId, profile, token || 'empty');
    return {
        cursorData: data,
        account: acc || null,
        email: profile.email,
        token,
        tokenKind,
        provisionError
    };
}

function restoreActiveCursorAccounts(gr) {
    const secure = gr && typeof gr.getSecureConfig === 'function' ? gr.getSecureConfig() : null;
    const cursor = (secure && secure.cursorAccounts) || {};
    const wrenId = cursor.wren && cursor.wren.activeAccountId;
    const xiId = cursor.xi && cursor.xi.activeAccountId;
    const cursorDirector = require('./cursorDirector');
    if (wrenId && cursorDirector.layout) {
        const dir = path.join(cursorDirector.layout().home, '.config', 'cursor');
        restoreAccountAuthFiles(wrenId, dir);
    }
    if (xiId) {
        const xiDirector = require('./xiDirector');
        if (xiDirector.layout) restoreAccountAuthFiles(xiId, xiDirector.layout().configDir);
    }
}

function tokenSubject(token) {
    if (!token || typeof token !== 'string') return '';
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return '';
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return String(payload.sub || payload.user_id || payload.userId || '').trim();
    } catch (_) {
        return '';
    }
}

function personaConfigDir(persona) {
    try {
        if (persona === 'wren') {
            const cursorDirector = require('./cursorDirector');
            if (typeof cursorDirector.layout !== 'function') return null;
            const home = cursorDirector.layout().home;
            return home ? path.join(home, '.config', 'cursor') : null;
        }
        if (persona === 'xi') {
            const xiDirector = require('./xiDirector');
            if (typeof xiDirector.layout !== 'function') return null;
            return xiDirector.layout().configDir || null;
        }
    } catch (_) {}
    return null;
}

function authSnapshot(dir) {
    const empty = { token: '', refresh: '', email: '', sub: '', displayName: '' };
    if (!dir) return empty;
    const auth = readJson(path.join(dir, 'auth.json')) || {};
    const cli = readJson(path.join(dir, 'cli-config.json')) || {};
    const info = cli.authInfo || {};
    const token = auth.accessToken || auth.apiKey || '';
    const email = extractEmailFromToken(token) || (isEmailString(info.email) ? info.email : '');
    return {
        token: typeof token === 'string' ? token : '',
        refresh: typeof auth.refreshToken === 'string' ? auth.refreshToken : '',
        email,
        sub: tokenSubject(token),
        displayName: String(info.displayName || '').trim()
    };
}

function identitiesMatch(live, stored) {
    if (!live || !stored) return false;
    if (live.sub && stored.sub) return live.sub === stored.sub;
    const liveEmail = String(live.email || '').trim().toLowerCase();
    const storedEmail = String(stored.email || '').trim().toLowerCase();
    return !!(liveEmail && storedEmail && liveEmail === storedEmail);
}

function credentialBytesDiffer(live, stored) {
    return (live.token || '') !== (stored.token || '') || (live.refresh || '') !== (stored.refresh || '');
}

function accountIdentity(account) {
    const hint = account && typeof account === 'object' ? account : {};
    const stored = authSnapshot(getAccountDir(hint.id || 'default'));
    return {
        token: stored.token || (typeof hint.token === 'string' ? hint.token : ''),
        refresh: stored.refresh,
        email: stored.email || (isEmailString(hint.email) ? hint.email : ''),
        sub: stored.sub || tokenSubject(hint.token),
        displayName: stored.displayName
    };
}

function readAccountProfileMeta(accountId) {
    return accountIdentity({ id: accountId || 'default' });
}

/**
 * Copy live auth into the stored profile only when it is the same account
 * (subject or email) and the token bytes have changed.
 */
function syncActiveAccountCredentials(persona, accountId, accountHint) {
    const liveDir = personaConfigDir(persona);
    const live = authSnapshot(liveDir);
    if (!live.token) return { updated: false, live };
    const stored = accountIdentity({ id: accountId, ...(accountHint || {}) });
    if (!identitiesMatch(live, stored)) return { updated: false, live, mismatch: true };
    if (!credentialBytesDiffer(live, stored)) return { updated: false, live };
    const captured = captureLivePersonaAuthFiles(persona, accountId);
    return {
        updated: true,
        live,
        email: captured.email,
        token: captured.token || live.token,
        displayName: live.displayName || stored.displayName || ''
    };
}

function describeLiveAccount(persona, accounts) {
    const live = authSnapshot(personaConfigDir(persona));
    if (!live.token) return { hasLive: false, known: false, matchedAccountId: '', displayName: '' };
    const list = Array.isArray(accounts) ? accounts : [];
    for (const acc of list) {
        const stored = accountIdentity(acc);
        if (identitiesMatch(live, stored)) {
            return {
                hasLive: true,
                known: true,
                matchedAccountId: acc.id || '',
                displayName: live.displayName || stored.displayName || ''
            };
        }
    }
    return { hasLive: true, known: false, matchedAccountId: '', displayName: live.displayName || '' };
}

function getActiveAccountId(persona = 'wren') {
    try {
        const primaryPath = path.join(process.cwd(), 'secure.config.json');
        const secondaryPath = path.join(process.cwd(), 'config', 'secureConfig.json');
        const targetPath = fs.existsSync(primaryPath) ? primaryPath : (fs.existsSync(secondaryPath) ? secondaryPath : null);
        if (targetPath) {
            const data = readJson(targetPath);
            if (data && data.cursorAccounts) {
                const ca = data.cursorAccounts;
                if (persona === 'wren' && ca.wren && ca.wren.activeAccountId) return ca.wren.activeAccountId;
                if (persona === 'xi' && ca.xi && ca.xi.activeAccountId) return ca.xi.activeAccountId;
            }
        }
    } catch (_) {}
    return 'default';
}

// Copy process.env without inherited Cursor session vars (CURSOR_*, VSCODE_*) so a
// Dreamscape started from a Cursor agent shell cannot leak its key into child logins.
function cleanCursorChildEnv(extra, base) {
    const env = Object.assign({}, base || process.env);
    for (const key of Object.keys(env)) {
        if (key.startsWith('CURSOR_') || key.startsWith('VSCODE_')) delete env[key];
    }
    return Object.assign(env, extra || {});
}

module.exports = {
    cleanCursorChildEnv,
    getAccountDir,
    getHostAccountInfo,
    extractEmailFromToken,
    saveAccountAuthFiles,
    captureLivePersonaAuthFiles,
    restoreAccountAuthFiles,
    deleteAccountAuthFiles,
    logoutCursorAccount,
    getActiveAccountId,
    publicCursorAccount,
    normalizeAccountColor,
    beginCursorAccountLogin,
    restoreActiveCursorAccounts,
    isCursorApiKey,
    isJwt,
    credentialKind,
    dreamscapeApiKeyName,
    spawnEnvWithoutInheritedCursor,
    provisionNamedApiKey,
    recordGuidedLogin,
    tokenSubject,
    identitiesMatch,
    credentialBytesDiffer,
    readAccountProfileMeta,
    syncActiveAccountCredentials,
    describeLiveAccount,
    _test: {
        identitiesMatch,
        credentialBytesDiffer,
        tokenSubject,
        authSnapshot,
        isCursorApiKey,
        credentialKind,
        normalizeAuthRecord,
        authFromCredential,
        spawnEnvWithoutInheritedCursor,
        dreamscapeApiKeyName
    }
};
