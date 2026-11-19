'use strict';

/**
 * Add a Claude account by signing in from the phone (Yukimi, Nov 19: "add new account button where it will
 * give me a copyable login link ... with a button to open in alchemy"). Claude Accounts' Add Account
 * (public/scripts/comp/wmClaudeAccounts.js) drives the host's `claude` CLI through two OAuth sign-ins and
 * shows each one's link (copy / Open in Alchemy) and a field for the code claude.ai shows back:
 *
 *   1. `claude auth login --claudeai`  the full claude.ai login (user:sessions:claude_code included) that
 *                                      Remote Control signs in with: becomes the account's linked login.
 *   2. `claude setup-token`            the long-lived (1 year, user:inference) token the Claude engine
 *                                      uses: becomes the CardSpace Claude key (apiKeyManager.addApiKey).
 *
 * Both run ISOLATED: HOME and CLAUDE_CONFIG_DIR are a fresh owner-only dir under
 * .cache/secrets/claude-accounts/pending-<8 hex>/ and the environment is built from scratch (no
 * CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_* / XDG / DISPLAY, BROWSER=true), so the host's own login
 * (~/.claude), the running Remote Control and every Claude agent are never touched. The CLI runs in a pty
 * (`script`, 1000 columns so the link never wraps); the link is read from its output, the code is typed
 * into it. One sign-in at a time; each step times out after STEP_MS; cancel / timeout / error kill the
 * process group and remove the pending dir.
 *
 * Nothing here returns, logs or broadcasts a token or a code: the public state carries the sign-in link
 * (an OAuth authorize URL: no secret), the step and what happened. CLI text that is shown is cleaned of
 * links, the submitted code and anything token-shaped.
 *
 * Overrides (tests / preview): DREAMSCAPE_CLAUDE_LOGIN_CLI (the claude binary), DREAMSCAPE_CLAUDE_ACCOUNTS_DIR
 * (claudeAccountHost's store), DREAMSCAPE_CLAUDE_LOGIN_STEP_MS. A read-only instance
 * (DREAMSCAPE_CLAUDE_RC_READONLY=1) runs the flow but never saves the account.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const claudeHost = require('./claudeAccountHost');

const STATUS_TYPE = 'claude_account_login_status';
const SERVICE = 'claude';
const URL_WAIT_MS = 45 * 1000;
const VERIFY_WAIT_MS = 90 * 1000;
const KEEP_FINISHED_MS = 15 * 60 * 1000;
const OUT_CAP = 256 * 1024;
const ACTIVE = new Set(['starting', 'waiting_code', 'verifying']);
const STEPS = {
    login: { number: 1, args: ['auth', 'login', '--claudeai'], title: 'Sign in to claude.ai' },
    token: { number: 2, args: ['setup-token'], title: 'Allow the engine token' }
};

function stepMs() { return Number(process.env.DREAMSCAPE_CLAUDE_LOGIN_STEP_MS) || 10 * 60 * 1000; }
function readOnly() { return process.env.DREAMSCAPE_CLAUDE_RC_READONLY === '1'; }

let gResources = null;
let pending = null; // one sign-in at a time
let swept = false;

// ---------------------------------------------------------------- text

function stripAnsi(text) {
    return String(text || '')
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, ' ') // OSC (hyperlinks, title, queries)
        .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, ' ') // CSI (cursor moves become a space)
        .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
        .replace(/\x1b[@-_]/g, '')
        .replace(/\x1b./g, '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
        .replace(/\r\n?/g, '\n');
}

const URL_RE = /https:\/\/[a-z0-9.-]+\/[^\s"'<>]*oauth\/authorize\?[^\s"'<>]+/gi;
const TOKEN_RE = /sk-ant-oat\d+-[A-Za-z0-9_-]{20,}/g;
const CODE_RE = /^[A-Za-z0-9_\-#.~=+/]{8,4096}$/;

function findLink(text) {
    const all = String(text || '').match(URL_RE) || [];
    for (const raw of all) {
        try {
            const u = new URL(raw);
            if (/(^|\.)(claude\.com|claude\.ai|anthropic\.com)$/i.test(u.hostname)) return u.href;
        } catch (_) { /* next */ }
    }
    return '';
}

function findToken(text) {
    const all = String(text || '').match(TOKEN_RE) || [];
    return all.length ? all[all.length - 1] : '';
}

/** A line or two of CLI text that is safe to show: no links, no code, nothing token-shaped. */
function cleanMessage(text, code) {
    let s = String(text || '');
    if (code) s = s.split(code).join('…');
    const lines = s.split('\n')
        .map((l) => l.replace(/https?:\/\/\S+/g, '<link>').replace(/sk-ant-\S+/g, '…').replace(/[A-Za-z0-9_#.~=+/-]{24,}/g, '…').replace(/\s+/g, ' ').trim())
        .filter((l) => l && /[A-Za-z]{3}/.test(l) && !/^[─━│┃╭╮╯╰▐▛▜▌▝▘█▓▒░*·.\s]+$/.test(l) && !/paste code here/i.test(l));
    const errs = lines.filter((l) => /\b(error|invalid|failed|expired|denied|unauthori[sz]ed|not)\b/i.test(l));
    return (errs.length ? errs.slice(-2) : lines.slice(-2)).join(' · ').slice(0, 240);
}

// ---------------------------------------------------------------- files / processes

function storeRoot() { return claudeHost.storeDir(); }

function makePrivateDir(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    return dir;
}

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function cliPath() {
    if (process.env.DREAMSCAPE_CLAUDE_LOGIN_CLI) return process.env.DREAMSCAPE_CLAUDE_LOGIN_CLI;
    try { return require('./cursorDirector').findClaude(); } catch (_) { return null; }
}

function scriptPath() {
    return ['/usr/bin/script', '/bin/script'].find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch (_) { return false; } }) || null;
}

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The CLI's whole environment: built from scratch so no token or session of the server's leaks in. */
function isolatedEnv(home) {
    const env = {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        HOME: home,
        CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
        TMPDIR: path.join(home, 'tmp'),
        TERM: 'xterm-256color',
        LANG: process.env.LANG || 'C.UTF-8',
        BROWSER: 'true',
        DISABLE_AUTOUPDATER: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
    };
    ['USER', 'LOGNAME', 'SHELL'].forEach((k) => { if (process.env[k]) env[k] = process.env[k]; });
    return env;
}

function killTree(child) {
    if (!child || child.exitCode != null || child.signalCode != null) return;
    const pid = child.pid;
    const send = (sig) => { try { process.kill(-pid, sig); } catch (_) { try { child.kill(sig); } catch (__) { /* gone */ } } };
    send('SIGTERM');
    setTimeout(() => send('SIGKILL'), 2000).unref();
}

function removeDir(dir) {
    // only a sign-in's own dir (or one inside it) under the store
    if (!dir || !/^pending-[0-9a-f]{8}(\/|$)/.test(path.relative(storeRoot(), dir))) return;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* gone */ }
}

/** A sign-in left by an earlier server (restart mid-flow): its process and dir go. */
function sweep() {
    if (swept) return;
    swept = true;
    let names = [];
    try { names = fs.readdirSync(storeRoot()); } catch (_) { return; }
    names.filter((n) => /^pending-[0-9a-f]{8}$/.test(n)).forEach((n) => {
        const dir = path.join(storeRoot(), n);
        const pid = Number((() => { try { return fs.readFileSync(path.join(dir, 'pid'), 'utf8'); } catch (_) { return ''; } })());
        if (pid > 1) {
            let cmd = '';
            try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch (_) { cmd = ''; }
            if (/claude|script/.test(cmd)) { try { process.kill(-pid, 'SIGKILL'); } catch (_) { /* gone */ } }
        }
        removeDir(dir);
    });
}

// ---------------------------------------------------------------- state

function publicState() {
    if (!pending) return { state: 'idle' };
    const p = pending;
    const step = STEPS[p.step] || STEPS.login;
    return {
        id: p.id,
        state: p.state,
        step: p.step,
        stepNumber: step.number,
        steps: 2,
        stepTitle: step.title,
        url: p.state === 'waiting_code' || p.state === 'verifying' ? p.url : '',
        name: p.name || '',
        message: p.message || '',
        signedInAs: p.login ? claudeHost.describeLogin(p.login.creds, p.login.oauthAccount) : null,
        account: p.account || null,
        startedAt: p.startedAt,
        expiresAt: p.expiresAt || null
    };
}

function broadcast() {
    try {
        const srv = gResources && (gResources.getWebSocketServer ? gResources.getWebSocketServer() : gResources.webSocketServer);
        const admin = (info) => !!(info && info.authenticated !== false && /^(admin|dev_admin)$/.test(String(info.userType || '')));
        if (srv && typeof srv.broadcast === 'function') srv.broadcast({ type: STATUS_TYPE, data: publicState(), timestamp: new Date().toISOString() }, admin);
    } catch (error) {
        console.warn(`[claudeAccounts] sign-in status broadcast skipped: ${error.message}`);
    }
}

function set(p, fields) {
    if (pending !== p) return; // a cancelled / replaced sign-in says nothing more
    Object.assign(p, fields);
    broadcast();
}

function endProcess(p) {
    clearTimeout(p.doneCheck);
    p.doneCheck = null;
    clearTimeout(p.timer);
    clearTimeout(p.verifyTimer);
    p.timer = null;
    p.verifyTimer = null;
    const child = p.child;
    p.child = null;
    if (child) { child.removeAllListeners('close'); killTree(child); }
}

/** Ends the sign-in's process and files; the state (done / error) stays to be read a while. */
function wrapUp(p, fields) {
    endProcess(p);
    removeDir(p.dir);
    p.code = '';
    set(p, Object.assign({ expiresAt: null }, fields));
    clearTimeout(p.forget);
    p.forget = setTimeout(() => { if (pending === p && !ACTIVE.has(p.state)) { p.login = null; pending = null; } }, KEEP_FINISHED_MS);
    if (p.forget.unref) p.forget.unref();
}

function fail(p, message) {
    // step 1's login is kept in memory so Try Again redoes only the failed step
    wrapUp(p, { state: 'error', message: message || 'The sign-in failed' });
}

function runStep(p, stepName) {
    endProcess(p);
    const bin = cliPath();
    if (!bin) { fail(p, 'The Claude CLI is not installed on this host'); return; }
    const step = STEPS[stepName];
    makePrivateDir(p.dir);
    const home = makePrivateDir(path.join(p.dir, stepName));
    makePrivateDir(path.join(home, '.claude'));
    makePrivateDir(path.join(home, 'tmp'));
    const env = isolatedEnv(home);
    const script = scriptPath();
    const command = [bin, ...step.args].map(shQuote).join(' ');
    const child = script
        ? spawn(script, ['-qfec', `stty cols 1000 rows 50 2>/dev/null; exec ${command}`, '/dev/null'], { cwd: home, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
        : spawn(bin, step.args, { cwd: home, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    p.child = child;
    p.out = '';
    p.codeAt = -1;
    p.code = '';
    p.home = home;
    const expiresAt = Date.now() + stepMs();
    set(p, { step: stepName, state: 'starting', url: '', message: `Starting ${step.title.toLowerCase()} on the host`, expiresAt: new Date(expiresAt).toISOString() });
    try { if (child.pid) fs.writeFileSync(path.join(p.dir, 'pid'), String(child.pid), { mode: 0o600 }); } catch (_) { /* swept by name */ }

    const onData = (chunk) => {
        if (p.child !== child) return;
        p.out = (p.out + stripAnsi(chunk.toString('utf8'))).slice(-OUT_CAP);
        if (p.state === 'starting') {
            const url = findLink(p.out);
            if (url) set(p, { state: 'waiting_code', url, message: '' });
        } else if (p.state === 'verifying' && !p.doneCheck) {
            // a CLI that shows its result and then waits for a key: finish once the result is there
            p.doneCheck = setTimeout(() => {
                p.doneCheck = null;
                if (pending !== p || p.child !== child || p.state !== 'verifying') return;
                if (stepDone(p, stepName)) { endProcess(p); void finishStep(p, stepName, 0); }
            }, 1500);
        }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.stdin.on('error', () => { /* the CLI ended: exit says why */ });
    child.on('error', (error) => { if (p.child === child) fail(p, `Could not start the Claude CLI: ${error.code || error.message}`); });
    child.on('close', (code) => {
        if (p.child !== child) return;
        p.child = null;
        clearTimeout(p.timer);
        clearTimeout(p.verifyTimer);
        void finishStep(p, stepName, code);
    });
    p.timer = setTimeout(() => {
        if (pending !== p || !ACTIVE.has(p.state)) return;
        fail(p, p.state === 'starting' ? 'The Claude CLI gave no sign-in link' : 'The sign-in timed out: start again');
    }, stepMs());
    // no link in time: the CLI is stuck or changed its output
    setTimeout(() => {
        if (pending === p && p.child === child && p.state === 'starting') fail(p, `The Claude CLI gave no sign-in link${cleanMessage(p.out) ? `: ${cleanMessage(p.out)}` : ''}`);
    }, Math.min(URL_WAIT_MS, stepMs())).unref();
}

function stepDone(p, stepName) {
    if (stepName === 'token') return !!findToken(p.out.slice(Math.max(0, p.codeAt)));
    const creds = readJson(path.join(p.home, '.claude', '.credentials.json'));
    return !!(creds && creds.claudeAiOauth && creds.claudeAiOauth.accessToken) && /success|logged in|signed in/i.test(p.out.slice(Math.max(0, p.codeAt)));
}

async function finishStep(p, stepName, exitCode) {
    if (pending !== p) return;
    const said = cleanMessage(p.codeAt >= 0 ? p.out.slice(p.codeAt) : p.out, p.code);
    if (p.codeAt < 0) { fail(p, `The Claude CLI stopped before the code${said ? `: ${said}` : ''}`); return; }
    if (exitCode !== 0) { fail(p, `claude.ai did not accept that code${said ? `: ${said}` : ''}`); return; }
    if (stepName === 'login') {
        const cfg = path.join(p.home, '.claude');
        const creds = readJson(path.join(cfg, '.credentials.json'));
        const cj = readJson(path.join(cfg, '.claude.json')) || readJson(path.join(p.home, '.claude.json')) || {};
        if (!creds || !creds.claudeAiOauth || !creds.claudeAiOauth.accessToken) { fail(p, 'The sign-in finished but left no claude.ai login'); return; }
        p.login = { creds, oauthAccount: cj.oauthAccount || null };
        removeDir(p.home); // the login lives in memory until the account is saved
        if (!p.name && cj.oauthAccount && cj.oauthAccount.emailAddress) p.name = cj.oauthAccount.emailAddress;
        runStep(p, 'token');
        return;
    }
    const token = findToken(p.out.slice(Math.max(0, p.codeAt)));
    p.out = '';
    if (!token) { fail(p, `The Claude CLI made no engine token${said ? `: ${said}` : ''}`); return; }
    try {
        const account = saveAccount(p, token);
        wrapUp(p, { state: 'done', message: readOnly() ? 'Read-only instance: the account was not saved' : '', account });
    } catch (error) {
        fail(p, error.message);
    } finally {
        p.login = null;
    }
}

function freeName(keys, wanted) {
    const base = String(wanted || 'Claude').trim().slice(0, 80) || 'Claude';
    const taken = new Set(keys.map((k) => k.name));
    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i++) if (!taken.has(`${base} (${i})`)) return `${base} (${i})`;
    return `${base} ${crypto.randomBytes(2).toString('hex')}`;
}

/** The CardSpace key (engine token) + its linked Remote Control login. */
function saveAccount(p, token) {
    const login = p.login ? claudeHost.describeLogin(p.login.creds, p.login.oauthAccount) : null;
    const m = gResources.getApiKeyManager();
    const keys = m.getServiceKeys(SERVICE) || [];
    const same = keys.findIndex((k) => String(k.apiKey || '').trim() === token);
    const name = same >= 0 ? (keys[same].name || `Claude ${same + 1}`) : freeName(keys, p.name || (login && login.email));
    if (readOnly()) return { index: null, name, email: login ? login.email : '', plan: login ? login.plan : '', linked: false };
    const index = same >= 0 ? same : m.addApiKey(SERVICE, name, token).index;
    let linked = false;
    if (p.login) { claudeHost.linkLogin(gResources, index, p.login.creds, p.login.oauthAccount); linked = true; }
    console.log(`[claudeAccounts] added Claude account "${name}" (#${index}) by sign-in${linked ? ' with its Remote Control login' : ''}`);
    return { index, name, email: login ? login.email : '', plan: login ? login.plan : '', linked };
}

// ---------------------------------------------------------------- actions

function start(gr, opts = {}) {
    if (gr) gResources = gr;
    sweep();
    if (pending && ACTIVE.has(pending.state)) {
        if (!opts.restart) return publicState(); // the phone picks the running one back up
        cancel(gr);
    }
    if (pending) { clearTimeout(pending.forget); pending = null; }
    makePrivateDir(storeRoot());
    const id = crypto.randomBytes(4).toString('hex');
    pending = {
        id,
        dir: path.join(storeRoot(), `pending-${id}`),
        step: 'login',
        state: 'starting',
        name: typeof opts.name === 'string' ? opts.name.trim().slice(0, 80) : '',
        url: '',
        message: '',
        startedAt: new Date().toISOString(),
        login: null,
        account: null,
        out: ''
    };
    runStep(pending, 'login');
    return publicState();
}

function submitCode(gr, code, opts = {}) {
    if (gr) gResources = gr;
    const p = pending;
    if (!p || !ACTIVE.has(p.state)) throw new Error('No sign-in is waiting for a code');
    if (p.state !== 'waiting_code' || !p.child) throw new Error(p.state === 'verifying' ? 'Already checking a code' : 'The sign-in link is not ready yet');
    // claude.ai shows the code with "#state"; a pasted link or spaces around it are cut away
    const clean = String(code || '').trim().replace(/\s+/g, '');
    if (!CODE_RE.test(clean)) throw new Error('That does not look like a claude.ai code');
    if (typeof opts.name === 'string' && opts.name.trim()) p.name = opts.name.trim().slice(0, 80);
    p.code = clean;
    p.codeAt = p.out.length;
    const child = p.child;
    set(p, { state: 'verifying', message: 'Checking the code' });
    child.stdin.write(clean);
    setTimeout(() => { if (p.child === child) child.stdin.write('\r'); }, 250).unref();
    p.verifyTimer = setTimeout(() => {
        if (pending === p && p.child === child && p.state === 'verifying') fail(p, `claude.ai did not answer${cleanMessage(p.out.slice(p.codeAt), p.code) ? `: ${cleanMessage(p.out.slice(p.codeAt), p.code)}` : ''}`);
    }, VERIFY_WAIT_MS);
    return publicState();
}

/** Try Again after an error: redoes the step that failed (step 1's login is kept). */
function retry(gr) {
    if (gr) gResources = gr;
    const p = pending;
    if (!p || p.state !== 'error') return start(gr, {});
    clearTimeout(p.forget);
    p.account = null;
    runStep(p, p.login ? 'token' : 'login');
    return publicState();
}

function setName(gr, name) {
    if (gr) gResources = gr;
    if (pending && ACTIVE.has(pending.state) && typeof name === 'string') pending.name = name.trim().slice(0, 80);
    return publicState();
}

function cancel(gr) {
    if (gr) gResources = gr;
    const p = pending;
    if (!p) return { state: 'idle' };
    endProcess(p);
    removeDir(p.dir);
    clearTimeout(p.forget);
    p.login = null;
    p.code = '';
    p.out = '';
    pending = null;
    broadcast();
    return { state: 'idle' };
}

function status(gr) {
    if (gr) gResources = gr;
    sweep();
    return publicState();
}

module.exports = {
    STATUS_TYPE,
    start,
    submitCode,
    retry,
    setName,
    cancel,
    status,
    _text: { stripAnsi, findLink, findToken, cleanMessage, isolatedEnv }
};
