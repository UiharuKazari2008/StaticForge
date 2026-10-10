'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const xiLaunch = require('../modules/xiLaunch');
const xiDirector = require('../modules/xiDirector');

const ALPHA_KEY = 'crsr_alpha_account_key_000000000000';
const BETA_KEY = 'crsr_beta_account_key_0000000000000';
const INHERITED = 'crsr_inherited_parent_key_0000000000';

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function bindSources(args) {
    const sources = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--bind' || args[i] === '--ro-bind') sources.push(path.resolve(args[i + 1]));
    }
    return sources;
}

function envValue(args, key) {
    for (let i = 0; i < args.length - 2; i++) {
        if (args[i] === '--setenv' && args[i + 1] === key) return args[i + 2];
    }
    return undefined;
}

function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xi-launch-test-'));
    const projectDir = path.join(root, 'project');
    const homeAccessDir = path.join(root, 'home-access');
    const secretDir = path.join(root, 'secret');
    const accountsDir = path.join(root, 'accounts');
    const secureConfigPath = path.join(root, 'secure.config.json');
    const runRoot = path.join(root, 'runs');
    fs.mkdirSync(projectDir);
    fs.mkdirSync(homeAccessDir);
    fs.mkdirSync(secretDir);
    fs.writeFileSync(path.join(projectDir, 'marker.txt'), 'project-ok\n');
    fs.writeFileSync(path.join(homeAccessDir, 'marker.txt'), 'access-ok\n');
    fs.writeFileSync(path.join(secretDir, 'marker.txt'), 'secret-no\n');

    const previous = {
        CURSOR_API_KEY: process.env.CURSOR_API_KEY,
        CURSOR_AUTH_TOKEN: process.env.CURSOR_AUTH_TOKEN,
        CURSOR_CONFIG_DIR: process.env.CURSOR_CONFIG_DIR,
        CURSOR_AGENT: process.env.CURSOR_AGENT,
        CURSOR_CONVERSATION_ID: process.env.CURSOR_CONVERSATION_ID,
        VSCODE_IPC_HOOK: process.env.VSCODE_IPC_HOOK
    };
    process.env.CURSOR_API_KEY = INHERITED;
    process.env.CURSOR_AUTH_TOKEN = 'inherited-session-token';
    process.env.CURSOR_CONFIG_DIR = '/tmp/inherited-cursor-config';
    process.env.CURSOR_AGENT = '1';
    process.env.CURSOR_CONVERSATION_ID = 'conv-inherited';
    process.env.VSCODE_IPC_HOOK = 'vscode-hook';

    const homes = [];
    try {
        writeJson(secureConfigPath, {
            cursorAccounts: {
                xi: { activeAccountId: 'alpha' },
                accounts: [
                    { id: 'alpha', name: 'Alpha', email: 'alpha@example.com', token: ALPHA_KEY, tokenKind: 'apiKey' },
                    { id: 'beta', name: 'Beta', email: 'beta@example.com', token: BETA_KEY, tokenKind: 'apiKey' }
                ]
            }
        });
        writeJson(path.join(accountsDir, 'alpha', 'auth.json'), { apiKey: ALPHA_KEY });
        writeJson(path.join(accountsDir, 'beta', 'auth.json'), { apiKey: BETA_KEY });

        const common = {
            projectDir,
            homeAccessDir,
            secureConfigPath,
            accountsDir,
            projectRoot: root,
            runRoot,
            includeAgent: false,
            command: ['/bin/true'],
            extraEnv: {
                CURSOR_API_KEY: INHERITED,
                DREAMSCAPE_MCP_URL: 'http://127.0.0.1:9/mcp',
                NOT_ALLOWED: 'nope'
            }
        };

        const alpha = xiLaunch.buildLaunch(common);
        homes.push(alpha.runHome);
        assert.strictEqual(alpha.accountId, 'alpha');
        assert.ok(alpha.runHome);
        const alphaAuth = JSON.parse(fs.readFileSync(alpha.authFile, 'utf8'));
        assert.strictEqual(alphaAuth.apiKey, ALPHA_KEY);
        assert.strictEqual(alphaAuth.accessToken, undefined);
        assert.ok(!alpha.args.join('\n').includes(ALPHA_KEY));
        assert.ok(!alpha.args.join('\n').includes(BETA_KEY));
        assert.ok(!alpha.args.join('\n').includes(INHERITED));
        assert.strictEqual(alpha.env.CURSOR_API_KEY, undefined);
        assert.strictEqual(alpha.env.CURSOR_AUTH_TOKEN, undefined);
        assert.strictEqual(alpha.env.CURSOR_AGENT, undefined);
        assert.strictEqual(alpha.env.VSCODE_IPC_HOOK, undefined);
        assert.strictEqual(alpha.env.NOT_ALLOWED, undefined);
        assert.strictEqual(alpha.env.CURSOR_CONFIG_DIR, '/home/xi/.config/cursor');
        assert.notStrictEqual(alpha.env.CURSOR_CONFIG_DIR, process.env.CURSOR_CONFIG_DIR);
        assert.strictEqual(alpha.env.DREAMSCAPE_MCP_URL, 'http://127.0.0.1:9/mcp');
        assert.strictEqual(alpha.hostEnv.CURSOR_API_KEY, undefined);
        Object.keys(alpha.env).forEach((key) => {
            assert.ok(xiLaunch.JAIL_ENV_KEYS.includes(key), `unexpected jail env ${key}`);
        });
        Object.keys(alpha.hostEnv).forEach((key) => {
            assert.ok(!key.startsWith('CURSOR_') && !key.startsWith('VSCODE_'));
        });
        assert.ok(alpha.args.includes('--clearenv'));
        assert.strictEqual(envValue(alpha.args, 'CURSOR_API_KEY'), undefined);
        assert.strictEqual(envValue(alpha.args, 'CURSOR_CONFIG_DIR'), '/home/xi/.config/cursor');

        const sources = bindSources(alpha.args);
        assert.ok(sources.includes(path.resolve(projectDir)));
        assert.ok(sources.includes(path.resolve(homeAccessDir)));
        assert.ok(sources.includes(path.resolve(alpha.runHome)));
        assert.ok(!sources.includes(path.resolve(secretDir)));
        assert.ok(!sources.includes(path.resolve(os.homedir())));
        sources.forEach((src) => {
            const home = path.resolve(os.homedir());
            if (src === home) assert.fail('sandbox bind mounts the whole home directory');
        });

        writeJson(secureConfigPath, {
            cursorAccounts: {
                xi: { activeAccountId: 'beta' },
                accounts: [
                    { id: 'alpha', name: 'Alpha', token: ALPHA_KEY, tokenKind: 'apiKey' },
                    { id: 'beta', name: 'Beta', token: BETA_KEY, tokenKind: 'apiKey' }
                ]
            }
        });
        const beta = xiLaunch.buildLaunch(common);
        homes.push(beta.runHome);
        assert.notStrictEqual(beta.runHome, alpha.runHome);
        assert.strictEqual(beta.accountId, 'beta');
        const betaAuth = JSON.parse(fs.readFileSync(beta.authFile, 'utf8'));
        assert.strictEqual(betaAuth.apiKey, BETA_KEY);
        assert.ok(!beta.args.join('\n').includes(BETA_KEY));
        assert.ok(!beta.args.join('\n').includes(ALPHA_KEY));

        const viaDirector = xiDirector._test.launchPlan([], {
            projectDir,
            homeAccessDir,
            secureConfigPath,
            accountsDir,
            projectRoot: root,
            runRoot,
            includeAgent: false,
            command: ['/bin/true']
        });
        homes.push(viaDirector.runHome);
        assert.strictEqual(viaDirector.accountId, 'beta');
        assert.strictEqual(viaDirector.env.CURSOR_API_KEY, undefined);
        assert.ok(!viaDirector.args.join('\n').includes(INHERITED));
        assert.ok(!viaDirector.hostEnv.CURSOR_API_KEY);

        const homeProbe = path.join(os.homedir(), '.profile');
        const script = [
            'echo ENV_START',
            'printenv | sort',
            'echo ENV_END',
            `echo PROJECT:$(cat ${JSON.stringify(path.join(projectDir, 'marker.txt'))})`,
            `echo ACCESS:$(cat ${JSON.stringify(path.join(homeAccessDir, 'marker.txt'))})`,
            `if [ -e ${JSON.stringify(path.join(secretDir, 'marker.txt'))} ]; then echo SECRET:VISIBLE; else echo SECRET:HIDDEN; fi`,
            `if [ -e ${JSON.stringify(homeProbe)} ]; then echo HOME:VISIBLE; else echo HOME:HIDDEN; fi`,
            `if [ -d ${JSON.stringify(os.homedir())} ]; then echo HOMEDIR:VISIBLE; else echo HOMEDIR:HIDDEN; fi`
        ].join('\n');
        const live = xiLaunch.buildLaunch(Object.assign({}, common, {
            command: ['/bin/sh', '-c', script],
            extraEnv: { CURSOR_API_KEY: INHERITED }
        }));
        homes.push(live.runHome);
        const ran = spawnSync(live.bin, live.args, {
            env: live.hostEnv,
            encoding: 'utf8',
            timeout: 20000
        });
        const output = `${ran.stdout || ''}\n${ran.stderr || ''}`;
        if (ran.status !== 0) {
            throw new Error(`bwrap probe failed (${ran.status}): ${output}`);
        }
        assert.ok(output.includes('PROJECT:project-ok'));
        assert.ok(output.includes('ACCESS:access-ok'));
        assert.ok(output.includes('SECRET:HIDDEN'));
        assert.ok(output.includes('HOME:HIDDEN'));
        assert.ok(output.includes('HOMEDIR:HIDDEN'));
        assert.ok(!output.includes(INHERITED));
        assert.ok(!output.includes(ALPHA_KEY));
        assert.ok(!output.includes(BETA_KEY));
        assert.ok(!output.includes('CURSOR_API_KEY'));
        assert.ok(!output.includes('CURSOR_AUTH_TOKEN'));
        assert.ok(!output.includes('VSCODE_IPC_HOOK'));
        assert.ok(!output.includes('inherited-cursor-config'));
        assert.ok(output.includes('CURSOR_CONFIG_DIR=/home/xi/.config/cursor'));

        // Stored per-account key: mounted read-only, exported only inside the jail.
        const keyStore = require('../modules/cursorAccountApiKey');
        const STORED = 'crsr_stored_beta_key__00000000000000';
        assert.strictEqual(keyStore.setKey('beta', STORED, accountsDir), STORED.slice(-4));
        assert.strictEqual((fs.statSync(keyStore.keyFile('beta', accountsDir)).mode & 0o777), 0o600);
        const keyed = xiLaunch.buildLaunch(common);
        homes.push(keyed.runHome);
        const flatKeyed = keyed.args.join('\n');
        assert.ok(!flatKeyed.includes(STORED));
        assert.ok(!flatKeyed.includes(INHERITED));
        assert.strictEqual(envValue(keyed.args, 'CURSOR_API_KEY'), undefined);
        assert.strictEqual(keyed.env.CURSOR_API_KEY, undefined);
        assert.strictEqual(keyed.hostEnv.CURSOR_API_KEY, undefined);
        assert.strictEqual(keyed.apiKeyMount, xiLaunch.JAIL_KEY_FILE);
        const ro = keyed.args.indexOf('--ro-bind', keyed.args.indexOf(keyStore.keyFile('beta', accountsDir)) - 1);
        assert.strictEqual(keyed.args[ro + 1], keyStore.keyFile('beta', accountsDir));
        assert.strictEqual(keyed.args[ro + 2], xiLaunch.JAIL_KEY_FILE);
        const keyRun = xiLaunch.buildLaunch(Object.assign({}, common, {
            command: ['/bin/sh', '-c', 'test "$CURSOR_API_KEY" = "$(cat ' + xiLaunch.JAIL_KEY_FILE + ')" && echo KEY:OK']
        }));
        homes.push(keyRun.runHome);
        const keyOut = spawnSync(keyRun.bin, keyRun.args, { env: keyRun.hostEnv, encoding: 'utf8' });
        assert.ok(String(keyOut.stdout).includes('KEY:OK'), 'stored key not exported in jail');
        assert.ok(!String(keyOut.stdout).includes(STORED));
        // A refreshable session wins over the stored key.
        writeJson(path.join(accountsDir, 'beta', 'auth.json'), { accessToken: 'session-access-token-x', refreshToken: 'session-refresh-token-x' });
        const session = xiLaunch.buildLaunch(common);
        homes.push(session.runHome);
        assert.strictEqual(session.apiKeyMount, null);
        assert.ok(!session.args.includes(xiLaunch.JAIL_KEY_FILE));
        assert.throws(() => keyStore.setKey('beta', 'not-a-key', accountsDir), /Not a Cursor API key/);
        keyStore.clearKey('beta', accountsDir);
        assert.strictEqual(keyStore.last4('beta', accountsDir), '');

        assert.throws(() => {
            xiLaunch.buildLaunch(Object.assign({}, common, { homeAccessDir: os.homedir() }));
        }, /whole home directory/);

        console.log('xi launch sandbox tests passed');
    } finally {
        Object.keys(previous).forEach((key) => {
            if (previous[key] == null) delete process.env[key];
            else process.env[key] = previous[key];
        });
        homes.forEach((dir) => {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
        });
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main();
