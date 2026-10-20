'use strict';

// TokenRouter Xi launch: Claude CLI, no OAuth token, bridge env from extraEnv
// (the same ANTHROPIC_* contract Wren's tokenRouterCliEnv writes). The
// TokenRouter API key never enters the jail.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const xiLaunch = require('../modules/xiLaunch');
const director = require('../modules/cursorDirector');

const BRIDGE_SECRET = 'xi-tokenrouter-bridge-secret-000000000000';
const TOKENROUTER_KEY = 'sk-tr-must-not-enter-the-jail-0000000000';

function envValue(args, key) {
    for (let i = 0; i < args.length - 2; i++) {
        if (args[i] === '--setenv' && args[i + 1] === key) return args[i + 2];
    }
    return undefined;
}

function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xi-tokenrouter-launch-test-'));
    const projectDir = path.join(root, 'project');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'marker.txt'), 'project-ok\n');

    const homes = [];
    const previousKey = process.env.TOKENROUTER_API_KEY;
    process.env.TOKENROUTER_API_KEY = TOKENROUTER_KEY;
    try {
        assert.strictEqual(xiLaunch.sanitizeLaunchRuntime('tokenrouter'), 'tokenrouter');
        assert.strictEqual(xiLaunch.usesClaudeCli('tokenrouter'), true);
        assert.strictEqual(xiLaunch.usesClaudeCli('claude'), true);
        assert.strictEqual(xiLaunch.usesClaudeCli('cursor'), false);

        const extraEnv = director._test.tokenRouterCliEnv(
            { url: 'http://127.0.0.1:40901', secret: BRIDGE_SECRET },
            { model: 'deepseek/deepseek-v4.1-flash', effort: 'medium', lane: 'interactive' }
        );

        const plan = xiLaunch.buildLaunch({
            runtime: 'tokenrouter',
            projectDir,
            includeAgent: false,
            command: ['/bin/true'],
            bwrapBin: '/bin/true',
            extraEnv
        });
        homes.push(plan.runHome);
        assert.strictEqual(plan.runtime, 'tokenrouter');
        assert.strictEqual(plan.accountId, null);
        assert.strictEqual(plan.tokenMount, null);
        assert.strictEqual(plan.apiKeyMount, null);
        assert.strictEqual(plan.jailConfig, null);

        assert.strictEqual(envValue(plan.args, 'ANTHROPIC_BASE_URL'), 'http://127.0.0.1:40901');
        assert.strictEqual(envValue(plan.args, 'ANTHROPIC_AUTH_TOKEN'), BRIDGE_SECRET);
        assert.strictEqual(envValue(plan.args, 'ANTHROPIC_DEFAULT_HAIKU_MODEL'), 'deepseek/deepseek-v4.1-flash');
        assert.strictEqual(
            envValue(plan.args, 'ANTHROPIC_CUSTOM_HEADERS'),
            'x-dreamscape-lane: interactive\nx-dreamscape-effort: medium'
        );

        const flat = plan.args.join('\n');
        assert.ok(!flat.includes(TOKENROUTER_KEY), 'TokenRouter API key leaked into bwrap argv');
        assert.strictEqual(plan.env.TOKENROUTER_API_KEY, undefined);
        assert.strictEqual(plan.hostEnv.TOKENROUTER_API_KEY, undefined);

        // No OAuth token file is mounted for TokenRouter (unlike Claude).
        assert.ok(!plan.args.includes(xiLaunch.JAIL_CLAUDE_TOKEN_FILE));
        assert.ok(!plan.args.some((part) => String(part).includes('claude-token')));

        // Claude binary resolution: opts.agentBin stands in for a real install.
        const withBin = xiLaunch.buildLaunch({
            runtime: 'tokenrouter',
            projectDir,
            extraEnv,
            agentArgs: ['-p', '--model', 'deepseek/deepseek-v4.1-flash', 'hello'],
            agentBin: '/bin/true',
            bwrapBin: '/bin/true'
        });
        homes.push(withBin.runHome);
        assert.ok(withBin.args.includes('/bin/true') || withBin.args.some((a) => a.endsWith('/true')));
        assert.ok(withBin.args.includes('--model'));
        assert.ok(withBin.args.includes('deepseek/deepseek-v4.1-flash'));

        console.log('xi tokenrouter launch tests passed');
    } finally {
        if (previousKey == null) delete process.env.TOKENROUTER_API_KEY;
        else process.env.TOKENROUTER_API_KEY = previousKey;
        homes.forEach((dir) => {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
        });
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main();
