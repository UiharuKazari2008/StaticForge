#!/usr/bin/env node
'use strict';
// Director Claude CLI runs (Xi host, Xi jail, Wren) always get CLAUDE_CONFIG_DIR = a Fleet account's own folder
// (the CardSpace-selected account, when moved) or the Director's folder; never empty, never the host ~/.claude.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'director-cfg-'));
const store = path.join(root, 'accounts');
const home = path.join(root, 'claudehome');
process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR = store;
process.env.DREAMSCAPE_CLAUDE_HOME = home;
fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{"host":"login"}');

const xiLaunch = require('../modules/xiLaunch');
const accountHost = require('../modules/claudeAccountHost');
const runtime = require('../modules/claudeAccountRuntime');
const dcc = require('../modules/directorClaudeConfig');

const project = path.join(root, 'project');
fs.mkdirSync(project);
const TOKEN = 'sk-ant-oat-test-token-selected-account';
const tokenFile = path.join(root, 'token');
fs.writeFileSync(tokenFile, `${TOKEN}\n`);
const hostDir = path.join(home, '.claude');
const envValue = (args, key) => { for (let i = 0; i < args.length - 2; i++) if (args[i] === '--setenv' && args[i + 1] === key) return args[i + 2]; return undefined; };
const base = { runtime: 'claude', projectDir: project, homeAccessDir: path.join(root, 'access'), runRoot: path.join(root, 'runs'), claudeTokenFile: tokenFile, includeAgent: false, command: ['/bin/true'] };

try {
    // 1. selected account not moved: the Director folder, never the host's, and no login in it
    const directorDir = path.join(store, 'director', 'config');
    for (const sandbox of [false, true]) {
        const plan = xiLaunch.buildLaunch(Object.assign({}, base, { sandbox }));
        const got = sandbox ? envValue(plan.args, 'CLAUDE_CONFIG_DIR') : plan.env.CLAUDE_CONFIG_DIR;
        assert.strictEqual(got, directorDir, `sandbox=${sandbox} uses the Director folder`);
        assert.strictEqual(plan.configDir, directorDir);
    }
    assert.ok(!fs.existsSync(path.join(directorDir, '.credentials.json')), 'host login never copied in');
    assert.ok(fs.lstatSync(path.join(directorDir, 'projects')).isSymbolicLink(), 'transcripts shared with the host projects');
    assert.strictEqual(fs.statSync(directorDir).mode & 0o777, 0o700);

    // 2. selected account moved to its own folder: that folder (host and jail, claude and tokenrouter runtimes)
    const id = accountHost._accountId({ apiKey: TOKEN });
    assert.ok(/^[0-9a-f]{16}$/.test(id));
    const accDir = runtime.configDir(id);
    fs.mkdirSync(accDir, { recursive: true });
    fs.writeFileSync(path.join(store, id, 'fleet.json'), JSON.stringify({ movedAt: 1, name: 'T' }));
    for (const runtimeName of ['claude', 'tokenrouter']) {
        const host = xiLaunch.buildLaunch(Object.assign({}, base, { sandbox: false, runtime: runtimeName }));
        assert.strictEqual(host.env.CLAUDE_CONFIG_DIR, accDir, `host ${runtimeName}`);
        assert.strictEqual(host.configAccountId, id);
        const jail = xiLaunch.buildLaunch(Object.assign({}, base, { sandbox: true, runtime: runtimeName }));
        assert.strictEqual(envValue(jail.args, 'CLAUDE_CONFIG_DIR'), accDir, `jail ${runtimeName}`);
        const at = jail.args.indexOf('--bind');
        assert.ok(jail.args.some((a, i) => a === '--bind' && jail.args[i + 1] === accDir && jail.args[i + 2] === accDir), 'folder bound into the jail');
        assert.ok(at >= 0);
    }
    // an extraEnv CLAUDE_CONFIG_DIR cannot point the jail elsewhere
    const forced = xiLaunch.buildLaunch(Object.assign({}, base, { sandbox: true, extraEnv: { CLAUDE_CONFIG_DIR: hostDir } }));
    assert.strictEqual(envValue(forced.args, 'CLAUDE_CONFIG_DIR'), accDir);

    // 3. the token wrapper still applies for the claude runtime (host mode: sh wrapper, token off argv)
    const claudePlan = xiLaunch.buildLaunch(Object.assign({}, base, { sandbox: false, runtime: 'claude' }));
    assert.strictEqual(claudePlan.bin, '/bin/sh');
    assert.ok(claudePlan.args.join(' ').includes('CLAUDE_CODE_OAUTH_TOKEN'));
    assert.ok(!claudePlan.args.join(' ').includes(TOKEN));
    assert.strictEqual(xiLaunch.buildLaunch(Object.assign({}, base, { sandbox: false, runtime: 'tokenrouter' })).bin, '/bin/true', 'no token wrapper for tokenrouter');

    // 4. transcript lookup follows the config dir; an older chat in the host config is adopted
    const sid = 'sess-1';
    const slug = path.resolve(project).replace(/[^a-zA-Z0-9]/g, '-');
    assert.strictEqual(xiLaunch.claudeSessionPath({ sandbox: false, projectDir: project, sessionId: sid, claudeTokenFile: tokenFile }), path.join(accDir, 'projects', slug, `${sid}.jsonl`));
    fs.mkdirSync(path.join(hostDir, 'projects', slug), { recursive: true });
    fs.writeFileSync(path.join(hostDir, 'projects', slug, 'old.jsonl'), '{}\n');
    const adopted = xiLaunch.claudeSessionPath({ sandbox: false, projectDir: project, sessionId: 'old', claudeTokenFile: tokenFile });
    assert.ok(fs.existsSync(adopted) && adopted.startsWith(accDir), 'older chat copied into the account folder');
    const legacyAccess = path.join(root, 'access', 'claude-config');
    fs.mkdirSync(path.join(legacyAccess, 'projects', slug), { recursive: true });
    fs.writeFileSync(path.join(legacyAccess, 'projects', slug, 'jailed.jsonl'), '{}\n');
    assert.ok(fs.existsSync(xiLaunch.claudeSessionPath({ sandbox: true, homeAccessDir: path.join(root, 'access'), projectDir: project, sessionId: 'jailed', claudeTokenFile: tokenFile })));

    // 5. Wren: both Claude jails set the folder after --clearenv and bind it
    const d = require('../modules/cursorDirector')._test;
    const jailIn = { bin: 'bwrap', args: ['--bind', 'a', 'b', '--chdir', '/workspace', '--clearenv'], agent: '/x', root: '/r' };
    process.env.CLAUDE_TOKEN_FILE = tokenFile;
    if (require('../modules/cursorDirector').findClaude()) {
        const cj = d.claudeJail(jailIn);
        assert.strictEqual(envValue(cj.args, 'CLAUDE_CONFIG_DIR'), accDir);
        assert.ok(cj.args.indexOf('CLAUDE_CONFIG_DIR') > cj.args.indexOf('--clearenv'), 'setenv after clearenv');
        assert.ok(cj.args.indexOf(accDir) < cj.args.indexOf('--chdir'), 'bind before chdir');
        assert.notStrictEqual(envValue(cj.args, 'CLAUDE_CONFIG_DIR'), hostDir);
        assert.strictEqual(jailIn.args.length, 6, 'input jail untouched');
    }
    console.log('test-director-claude-config: ok');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
