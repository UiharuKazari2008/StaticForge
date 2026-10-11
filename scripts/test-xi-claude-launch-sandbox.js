'use strict';

// Claude runtime launch: token is a mounted read-only file, exported only
// inside the jail, never on the host env or argv. Mirrors test-xi-launch-sandbox.js.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const xiLaunch = require('../modules/xiLaunch');

const TOKEN = 'sk-ant-oat-test-token-000000000000000000';

function envValue(args, key) {
    for (let i = 0; i < args.length - 2; i++) {
        if (args[i] === '--setenv' && args[i + 1] === key) return args[i + 2];
    }
    return undefined;
}

function bindSources(args) {
    const sources = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--bind' || args[i] === '--ro-bind') sources.push(path.resolve(args[i + 1]));
    }
    return sources;
}

function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xi-claude-launch-test-'));
    const projectDir = path.join(root, 'project');
    const tokenFile = path.join(root, 'claude-token');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(projectDir + '/marker.txt', 'project-ok\n');
    fs.writeFileSync(tokenFile, TOKEN + '\n');

    const homes = [];
    try {
        const common = {
            runtime: 'claude',
            projectDir,
            claudeTokenFile: tokenFile,
            includeAgent: false,
            command: ['/bin/true']
        };

        const plan = xiLaunch.buildLaunch(common);
        homes.push(plan.runHome);
        assert.strictEqual(plan.runtime, 'claude');
        assert.strictEqual(plan.accountId, null);
        assert.strictEqual(plan.tokenMount, xiLaunch.JAIL_CLAUDE_TOKEN_FILE);
        assert.strictEqual(plan.apiKeyMount, null);
        assert.strictEqual(plan.jailConfig, null);

        // Token value never touches argv, jail env, or host env.
        const flat = plan.args.join('\n');
        assert.ok(!flat.includes(TOKEN), 'token leaked into bwrap argv');
        assert.strictEqual(plan.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
        assert.strictEqual(plan.hostEnv.CLAUDE_CODE_OAUTH_TOKEN, undefined);
        assert.strictEqual(envValue(plan.args, 'CLAUDE_CODE_OAUTH_TOKEN'), undefined);

        // The token file itself is mounted read-only, not read-write.
        const roIdx = plan.args.indexOf('--ro-bind', plan.args.indexOf(tokenFile) - 1);
        assert.strictEqual(plan.args[roIdx + 1], tokenFile);
        assert.strictEqual(plan.args[roIdx + 2], xiLaunch.JAIL_CLAUDE_TOKEN_FILE);
        const sources = bindSources(plan.args);
        assert.ok(sources.includes(path.resolve(tokenFile)));

        // Missing token file is a hard error, not a silent skip.
        assert.throws(() => {
            xiLaunch.buildLaunch(Object.assign({}, common, { claudeTokenFile: path.join(root, 'missing-token') }));
        }, /Claude OAuth token file is missing/);

        // Live bwrap run: the jail exports the token from the mounted file (and
        // only from there); the host process and its env never see it.
        const previousToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
        process.env.CLAUDE_CODE_OAUTH_TOKEN = 'inherited-from-host-should-not-leak';
        try {
            const probe = xiLaunch.buildLaunch(Object.assign({}, common, {
                command: ['/bin/sh', '-c', 'echo TOKEN:$CLAUDE_CODE_OAUTH_TOKEN; printenv | sort']
            }));
            homes.push(probe.runHome);
            const ran = spawnSync(probe.bin, probe.args, { env: probe.hostEnv, encoding: 'utf8', timeout: 20000 });
            const output = `${ran.stdout || ''}\n${ran.stderr || ''}`;
            if (ran.status !== 0) throw new Error(`bwrap probe failed (${ran.status}): ${output}`);
            assert.ok(output.includes(`TOKEN:${TOKEN}`), 'token was not exported inside the jail');
            assert.ok(!output.includes('inherited-from-host-should-not-leak'));
            assert.ok(!flat.includes('inherited-from-host-should-not-leak'));
        } finally {
            if (previousToken == null) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
            else process.env.CLAUDE_CODE_OAUTH_TOKEN = previousToken;
        }

        // Claude binary resolution: opts.agentBin stands in for a real install,
        // same pattern as cursor-agent's tests (avoids depending on what is
        // actually installed on the host running the test).
        const withBin = xiLaunch.buildLaunch({
            runtime: 'claude',
            projectDir,
            claudeTokenFile: tokenFile,
            agentArgs: ['-p', 'hello'],
            agentBin: '/bin/true'
        });
        homes.push(withBin.runHome);
        assert.ok(withBin.args.includes('/bin/true') || withBin.args.some((a) => a.endsWith('/true')));

        console.log('xi claude launch sandbox tests passed');
    } finally {
        homes.forEach((dir) => {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
        });
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main();
