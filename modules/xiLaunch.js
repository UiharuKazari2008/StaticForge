'use strict';

// Xi runs on the host, so each launch gets its own bubblewrap. Wren keeps the
// Dreamspace jail and is not started from here. The sandbox bind-mounts the
// project read-write plus one home-access directory. HOME is a fresh directory
// every run. The active Xi account comes from secure config, and the key is
// written into that HOME. It is never placed on the command line, and Cursor
// variables from the Dreamscape process are not inherited.

const fs = require('fs');
const os = require('os');
const path = require('path');

const JAIL_HOME = '/home/xi';
const JAIL_AGENT_ROOT = '/opt/cursor-agent';
const JAIL_CLAUDE_ROOT = '/opt/claude-code';
const RUN_PARENT = path.join(os.tmpdir(), 'dreamscape-xi-runs');

const JAIL_ENV_KEYS = [
    'HOME', 'PATH', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'TMPDIR', 'TERM',
    'NO_COLOR', 'NO_OPEN_BROWSER', 'GIT_TERMINAL_PROMPT',
    'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
    'CURSOR_CONFIG_DIR',
    'DREAMSCAPE_MCP_URL', 'DREAMSCAPE_MCP_KEY'
];
const JAIL_ENV_ALLOW = new Set(JAIL_ENV_KEYS);

function director() {
    return require('./cursorDirector');
}

const JAIL_KEY_DIR = '/tmp/.xi-secret';
const JAIL_KEY_FILE = `${JAIL_KEY_DIR}/api-key`;
const JAIL_CLAUDE_TOKEN_FILE = `${JAIL_KEY_DIR}/claude-token`;
const DEFAULT_CLAUDE_TOKEN_FILE = path.join(os.homedir(), '.secrets', 'claude-max.oauth');

function resolveClaudeTokenFile(options) {
    const opts = options || {};
    return opts.claudeTokenFile || process.env.CLAUDE_TOKEN_FILE || DEFAULT_CLAUDE_TOKEN_FILE;
}

function apiKeyStore() {
    return require('./cursorAccountApiKey');
}

function authStore() {
    return require('./cursorAccountAuthStore');
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null;
    }
}

function insideDir(parent, child) {
    const base = path.resolve(parent);
    const target = path.resolve(child);
    return target === base || target.startsWith(base + path.sep);
}

function defaultProjectDir() {
    const candidate = path.join(os.homedir(), 'staticforge');
    if (fs.existsSync(candidate)) return candidate;
    return process.cwd();
}

function resolveHomeAccess(options) {
    const opts = options || {};
    if (opts.homeAccessDir) return path.resolve(opts.homeAccessDir);
    const projectDir = path.resolve(opts.projectDir || defaultProjectDir());
    const cwd = path.resolve(opts.cwd || process.cwd());
    const home = opts.homeDir || os.homedir();
    const underHome = cwd === home || cwd.startsWith(home + path.sep);
    if (underHome && !insideDir(projectDir, cwd)) return cwd;
    return path.join(home, '.cache', 'dreamscape-xi');
}

function sanitizeAccountId(accountId) {
    return String(accountId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function loadActiveCredential(options) {
    const opts = options || {};
    const root = opts.projectRoot || process.cwd();
    const securePath = opts.secureConfigPath || path.join(root, 'secure.config.json');
    const secure = readJson(securePath) || {};
    const cursor = secure.cursorAccounts || {};
    const accountId = opts.accountId
        || (cursor.xi && cursor.xi.activeAccountId)
        || 'default';
    const accountsDir = opts.accountsDir || path.join(root, '.cache', 'dreamscape-cursor-accounts');
    const auth = readJson(path.join(accountsDir, sanitizeAccountId(accountId), 'auth.json')) || {};
    const store = authStore();
    let record = store._test.normalizeAuthRecord(auth);
    const accounts = Array.isArray(cursor.accounts) ? cursor.accounts : [];
    const acc = accounts.find((item) => item && item.id === accountId) || null;
    if (!record.apiKey && !record.accessToken && acc && acc.token && !acc.isEmpty) {
        record = store._test.authFromCredential(acc.token, acc.tokenKind);
    }
    const keyFile = apiKeyStore().keyFile(accountId, accountsDir);
    const storedKey = apiKeyStore().readKey(accountId, accountsDir);
    // Prefer the session; the stored key is only for sessions that cannot refresh.
    const useStoredKey = !!storedKey && !record.refreshToken;
    return {
        accountId,
        auth: record,
        email: (acc && acc.email) || '',
        keyFile: useStoredKey ? keyFile : null,
        storedKey: useStoredKey ? storedKey : ''
    };
}

function secretValues(auth) {
    const values = [];
    if (auth && auth.apiKey) values.push(String(auth.apiKey));
    if (auth && auth.accessToken) values.push(String(auth.accessToken));
    if (auth && auth.refreshToken) values.push(String(auth.refreshToken));
    return values.filter((value) => value.length >= 8);
}

function prepareRunHome(options) {
    const opts = options || {};
    if (opts.runHome) {
        fs.mkdirSync(opts.runHome, { recursive: true, mode: 0o700 });
        return opts.runHome;
    }
    const parent = opts.runRoot || RUN_PARENT;
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    return fs.mkdtempSync(path.join(parent, 'home-'));
}

function seedConfig(hostConfigDir, credential) {
    fs.mkdirSync(hostConfigDir, { recursive: true, mode: 0o700 });
    const authFile = path.join(hostConfigDir, 'auth.json');
    fs.writeFileSync(authFile, JSON.stringify(credential.auth || {}, null, 2) + '\n', { mode: 0o600 });
    try { fs.chmodSync(authFile, 0o600); } catch (_) { /* written */ }
    const cli = {
        authInfo: {
            authId: credential.accountId,
            email: credential.email || '',
            displayName: ''
        },
        permissions: {
            allowShellExecution: true,
            allowWebSearch: true,
            allowFileSystem: true
        }
    };
    const cliFile = path.join(hostConfigDir, 'cli-config.json');
    fs.writeFileSync(cliFile, JSON.stringify(cli, null, 2) + '\n', { mode: 0o600 });
    try { fs.chmodSync(cliFile, 0o600); } catch (_) { /* written */ }
    return authFile;
}

function jailEnv(spec) {
    const lang = spec.lang || process.env.LANG || 'C.UTF-8';
    const env = {
        HOME: spec.jailHome,
        PATH: '/usr/local/bin:/usr/bin:/bin',
        LANG: lang,
        LC_ALL: process.env.LC_ALL || lang,
        USER: 'xi',
        LOGNAME: 'xi',
        SHELL: '/bin/bash',
        PWD: spec.projectDir,
        TMPDIR: '/tmp',
        TERM: 'dumb',
        NO_COLOR: '1',
        NO_OPEN_BROWSER: '1',
        GIT_TERMINAL_PROMPT: '0',
        XDG_CONFIG_HOME: `${spec.jailHome}/.config`,
        XDG_CACHE_HOME: `${spec.jailHome}/.cache`,
        XDG_DATA_HOME: `${spec.jailHome}/.local/share`,
        XDG_RUNTIME_DIR: '/tmp'
    };
    if (spec.jailConfig) env.CURSOR_CONFIG_DIR = spec.jailConfig;
    const extra = spec.extraEnv || {};
    Object.keys(extra).forEach((key) => {
        if (!JAIL_ENV_ALLOW.has(key)) return;
        if (key.startsWith('CURSOR_') || key.startsWith('VSCODE_')) return;
        if (extra[key] == null || extra[key] === '') return;
        env[key] = String(extra[key]);
    });
    Object.keys(env).forEach((key) => {
        if (!JAIL_ENV_ALLOW.has(key)) delete env[key];
    });
    return env;
}

function hostSpawnEnv() {
    return {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        LANG: process.env.LANG || 'C.UTF-8'
    };
}

function assertNoInheritedCursor(env) {
    Object.keys(env).forEach((key) => {
        if (key.startsWith('VSCODE_') || (key.startsWith('CURSOR_') && key !== 'CURSOR_CONFIG_DIR')) {
            throw new Error(`Xi launch env kept inherited ${key}`);
        }
    });
}

function assertSecretsOffArgv(args, secrets) {
    const flat = args.join('\n');
    secrets.forEach((secret) => {
        if (secret && flat.includes(secret)) {
            throw new Error('Xi launch put an account credential on the command line');
        }
    });
}

function mountPlan(entries) {
    const dirs = new Set();
    entries.forEach((entry) => {
        const parts = String(entry.dest || '').split(path.sep).filter(Boolean);
        let acc = '';
        parts.forEach((part) => {
            acc += `/${part}`;
            if (acc !== '/') dirs.add(acc);
        });
    });
    return {
        dirArgs: Array.from(dirs).sort((a, b) => a.length - b.length),
        binds: entries
    };
}

function refuseWholeHome(dir) {
    const resolved = path.resolve(dir);
    if (resolved === path.resolve(os.homedir())) {
        const error = new Error('Xi sandbox refuses to bind the whole home directory');
        error.code = 'HOME_BIND_REFUSED';
        throw error;
    }
}

function buildLaunch(options) {
    const opts = options || {};
    const runtime = opts.runtime === 'claude' ? 'claude' : 'cursor';
    const bwrapBin = opts.bwrapBin || director().findBwrap();
    if (!bwrapBin) {
        const error = new Error('bubblewrap (bwrap) is not installed on this host');
        error.code = 'BWRAP_MISSING';
        throw error;
    }
    const projectDir = path.resolve(opts.projectDir || defaultProjectDir());
    const homeAccessDir = path.resolve(resolveHomeAccess({
        homeAccessDir: opts.homeAccessDir,
        projectDir,
        cwd: opts.cwd,
        homeDir: opts.homeDir
    }));
    refuseWholeHome(projectDir);
    refuseWholeHome(homeAccessDir);
    if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
        const error = new Error('Xi project directory does not exist');
        error.code = 'PROJECT_MISSING';
        throw error;
    }
    fs.mkdirSync(homeAccessDir, { recursive: true });

    const useBinary = !(opts.command && opts.command.length) && opts.includeAgent !== false;
    let agent = null;
    let claudeBin = null;
    if (useBinary) {
        if (runtime === 'claude') {
            claudeBin = opts.agentBin || director().findClaude();
            if (!claudeBin) {
                const error = new Error('Claude Code is not installed on this host');
                error.code = 'CLAUDE_MISSING';
                throw error;
            }
        } else {
            const agentBin = opts.agentBin || director().findAgent();
            if (!agentBin) {
                const error = new Error('Cursor is not installed on this host');
                error.code = 'CURSOR_MISSING';
                throw error;
            }
            agent = director()._test.agentJailTarget(agentBin);
        }
    }

    const runHome = prepareRunHome(opts);

    // Cursor carries an account credential seeded into a jailed CLI config.
    // Claude carries no account state here: auth is the mounted token file below.
    let credential = { accountId: null, auth: {}, keyFile: null, storedKey: '' };
    let authFile = null;
    let jailConfig = null;
    let tokenFile = null;
    if (runtime === 'claude') {
        tokenFile = resolveClaudeTokenFile(opts);
        if (!fs.existsSync(tokenFile)) {
            const error = new Error('Claude OAuth token file is missing (run `claude setup-token`)');
            error.code = 'CLAUDE_TOKEN_MISSING';
            throw error;
        }
    } else {
        credential = loadActiveCredential(opts);
        const hostConfig = path.join(runHome, '.config', 'cursor');
        authFile = seedConfig(hostConfig, credential);
        jailConfig = `${JAIL_HOME}/.config/cursor`;
    }

    const env = jailEnv({
        jailHome: JAIL_HOME,
        jailConfig,
        projectDir,
        lang: opts.lang,
        extraEnv: opts.extraEnv
    });
    if (jailConfig && process.env.CURSOR_CONFIG_DIR && env.CURSOR_CONFIG_DIR === process.env.CURSOR_CONFIG_DIR) {
        throw new Error('Xi launch reused the inherited CURSOR_CONFIG_DIR');
    }
    assertNoInheritedCursor(env);

    const args = ['--unshare-all', '--share-net', '--new-session'];
    if (!opts.detach) args.push('--die-with-parent');
    director()._test.systemBindArgs().forEach((part) => args.push(part));
    args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/dev/shm', '--tmpfs', '/tmp');
    if (credential.keyFile) {
        args.push('--dir', JAIL_KEY_DIR, '--ro-bind', credential.keyFile, JAIL_KEY_FILE);
    }
    if (tokenFile) {
        args.push('--dir', JAIL_KEY_DIR, '--ro-bind', tokenFile, JAIL_CLAUDE_TOKEN_FILE);
    }
    if (agent) {
        args.push('--dir', '/opt', '--dir', JAIL_AGENT_ROOT);
        args.push('--ro-bind', agent.hostRoot, JAIL_AGENT_ROOT);
    }
    let claudeTarget = null;
    if (claudeBin) {
        claudeTarget = director()._test.claudeJailTarget(claudeBin, JAIL_CLAUDE_ROOT);
        args.push('--dir', '/opt', '--dir', JAIL_CLAUDE_ROOT);
        args.push('--ro-bind', claudeTarget.hostRoot, JAIL_CLAUDE_ROOT);
    }

    const mounts = [{ src: runHome, dest: JAIL_HOME }];
    mounts.push({ src: projectDir, dest: projectDir });
    if (!insideDir(projectDir, homeAccessDir)) {
        mounts.push({ src: homeAccessDir, dest: homeAccessDir });
    }
    const planned = mountPlan(mounts);
    const skipDirs = new Set(['/tmp', '/dev', '/proc', '/dev/shm']);
    if (agent) {
        skipDirs.add('/opt');
        skipDirs.add(JAIL_AGENT_ROOT);
    }
    if (claudeTarget) {
        skipDirs.add('/opt');
        skipDirs.add(JAIL_CLAUDE_ROOT);
    }
    planned.dirArgs.forEach((dir) => {
        if (!skipDirs.has(dir)) args.push('--dir', dir);
    });
    planned.binds.forEach((entry) => args.push('--bind', entry.src, entry.dest));
    args.push('--chdir', projectDir);
    args.push('--clearenv');
    Object.keys(env).forEach((key) => args.push('--setenv', key, String(env[key] == null ? '' : env[key])));

    let command;
    if (opts.command && opts.command.length) {
        command = opts.command.map((part) => String(part));
    } else if (claudeTarget) {
        command = [claudeTarget.inJail].concat(opts.agentArgs || []).map((part) => String(part));
    } else {
        command = [agent.inJail].concat(opts.agentArgs || []).map((part) => String(part));
    }
    if (credential.keyFile) {
        command = ['/bin/sh', '-c',
            `CURSOR_API_KEY="$(cat ${JAIL_KEY_FILE})"; export CURSOR_API_KEY; exec "$@"`,
            'xi-launch'].concat(command);
    }
    if (tokenFile) {
        command = ['/bin/sh', '-c',
            `CLAUDE_CODE_OAUTH_TOKEN="$(cat ${JAIL_CLAUDE_TOKEN_FILE})"; export CLAUDE_CODE_OAUTH_TOKEN; exec "$@"`,
            'xi-claude-launch'].concat(command);
    }
    args.push('--');
    command.forEach((part) => args.push(part));

    const secrets = secretValues(credential.auth);
    if (credential.storedKey) secrets.push(credential.storedKey);
    assertSecretsOffArgv(args, secrets);
    const hostEnv = hostSpawnEnv();
    assertNoInheritedCursor(hostEnv);

    return {
        bin: bwrapBin,
        args,
        env,
        hostEnv,
        runHome,
        runtime,
        accountId: credential.accountId,
        authFile,
        apiKeyMount: credential.keyFile ? JAIL_KEY_FILE : null,
        tokenMount: tokenFile ? JAIL_CLAUDE_TOKEN_FILE : null,
        jailHome: JAIL_HOME,
        jailConfig,
        projectDir,
        homeAccessDir
    };
}

function spawnLaunch(options) {
    const plan = buildLaunch(options);
    const child = require('child_process').spawn(plan.bin, plan.args, {
        env: plan.hostEnv,
        stdio: options && options.stdio ? options.stdio : 'inherit'
    });
    child.xiLaunch = plan;
    return child;
}

module.exports = {
    JAIL_ENV_KEYS,
    JAIL_HOME,
    JAIL_KEY_FILE,
    JAIL_CLAUDE_TOKEN_FILE,
    DEFAULT_CLAUDE_TOKEN_FILE,
    defaultProjectDir,
    resolveHomeAccess,
    resolveClaudeTokenFile,
    loadActiveCredential,
    buildLaunch,
    spawnLaunch,
    hostSpawnEnv
};
