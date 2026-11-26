'use strict';

// Every Director Claude CLI run (Xi on the host, Xi in the jail, Wren) runs with an explicit
// CLAUDE_CONFIG_DIR that is a Fleet account's own folder, never unset (unset = the host's ~/.claude, whose
// login was a duplicate copy of one account's and logged the two copies out of each other; Yukimi, Nov 26 2026).
//
// Which folder: the account CardSpace has selected for the Director (its token is in .cache/secrets/claude.oauth,
// xiLaunch.resolveClaudeTokenFile) -> its Fleet id (claudeAccountHost) -> <store>/<id>/config, when that account was
// moved to its own folder. Otherwise a Director-owned folder <store>/director/config (0700). Auth stays the token env
// (claude runtime) or the TokenRouter env; the host login is never copied or linked into a folder.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIRECTOR_ID = 'director';
// Shared with the host config as Fleet's moved accounts do (transcripts, settings, rules): never the login file.
const SHARED = ['projects', 'sessions', 'settings.json', 'CLAUDE.md', 'skills', 'plugins', 'agents', 'commands', 'file-history'];

function hostConfigDir() {
    return path.join(process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(), '.claude');
}

function accountHost() { return require('./claudeAccountHost'); }
function accountRuntime() { return require('./claudeAccountRuntime'); }

function selectedAccountId(opts) {
    let token = '';
    try {
        const file = require('./xiLaunch').resolveClaudeTokenFile(opts);
        token = fs.readFileSync(file, 'utf8').trim();
    } catch (_) { /* no token file: the Director folder */ }
    if (!token) return '';
    try { return accountHost()._accountId({ apiKey: token }) || ''; } catch (_) { return ''; }
}

function seedDirectorFolder(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch (_) { /* best effort */ }
    const host = hostConfigDir();
    SHARED.forEach((name) => {
        const target = path.join(host, name);
        const link = path.join(dir, name);
        try {
            if (!fs.existsSync(target)) return;
            try { fs.lstatSync(link); return; } catch (_) { /* absent: link it */ }
            fs.symlinkSync(target, link);
        } catch (_) { /* a missing shared entry is not fatal */ }
    });
    const cj = path.join(dir, '.claude.json');
    if (!fs.existsSync(cj)) fs.writeFileSync(cj, JSON.stringify({ hasCompletedOnboarding: true }), { mode: 0o600 });
}

/** { dir, accountId, source: 'account' | 'director' }: the folder a Director Claude CLI run uses. */
function resolve(options) {
    const opts = options || {};
    if (opts.configDir) {
        const dir = path.resolve(opts.configDir);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        return { dir, accountId: opts.configAccountId || null, source: 'account' };
    }
    const id = selectedAccountId(opts);
    if (id) {
        try {
            const rt = accountRuntime();
            const dir = rt.configDir(id);
            if (rt.isMoved(id) && fs.existsSync(dir)) return { dir, accountId: id, source: 'account' };
        } catch (_) { /* not moved: the Director folder */ }
    }
    const dir = path.join(accountHost().storeDir(), DIRECTOR_ID, 'config');
    seedDirectorFolder(dir);
    return { dir, accountId: null, source: 'director' };
}

/** The folder the Director session file for this cwd and id lives in. */
function sessionFile(configDir, projectDir, sessionId) {
    const slug = path.resolve(projectDir).replace(/[^a-zA-Z0-9]/g, '-');
    return path.join(configDir, 'projects', slug, `${sessionId}.jsonl`);
}

/**
 * A chat started before this change keeps its transcript where it ran (the host ~/.claude, Xi's own claude-config,
 * Wren's jail home). Copy it into the folder now in use so --resume still finds it. Returns true when the file exists.
 */
function adoptLegacySession(configDir, projectDir, sessionId, legacyDirs) {
    if (!sessionId) return false;
    const target = sessionFile(configDir, projectDir, sessionId);
    if (fs.existsSync(target)) return true;
    for (const legacy of [hostConfigDir()].concat(legacyDirs || [])) {
        const from = sessionFile(legacy, projectDir, sessionId);
        try {
            if (!fs.existsSync(from)) continue;
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(from, target);
            return true;
        } catch (_) { /* try the next place */ }
    }
    return false;
}

/** bwrap arguments that make the folder (and the host targets of its shared links) visible at the same paths. */
function jailBindArgs(configDir) {
    const args = ['--bind', configDir, configDir];
    let names = [];
    try { names = fs.readdirSync(configDir); } catch (_) { return args; }
    const seen = new Set();
    names.forEach((name) => {
        let real;
        try {
            if (!fs.lstatSync(path.join(configDir, name)).isSymbolicLink()) return;
            real = fs.realpathSync(path.join(configDir, name));
        } catch (_) { return; }
        if (seen.has(real)) return;
        seen.add(real);
        args.push(name === 'projects' ? '--bind' : '--ro-bind', real, real);
    });
    return args;
}

module.exports = { resolve, sessionFile, adoptLegacySession, jailBindArgs, hostConfigDir, DIRECTOR_ID };
