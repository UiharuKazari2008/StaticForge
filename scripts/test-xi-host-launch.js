#!/usr/bin/env node
'use strict';
// Yozora host launch (sandbox: false): no bwrap, real HOME, scrubbed env, token off argv.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const xiLaunch = require('../modules/xiLaunch');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xi-host-'));
const project = path.join(root, 'project');
const token = path.join(root, 'token');
fs.mkdirSync(project);
fs.writeFileSync(token, 'sk-ant-oat-test-secret-value\n');
process.env.CURSOR_API_KEY = 'inherited-cursor-key';
try {
    const plan = xiLaunch.buildLaunch({
        sandbox: false, runtime: 'claude', projectDir: project, homeAccessDir: path.join(root, 'access'),
        runRoot: path.join(root, 'runs'), claudeTokenFile: token, agentBin: '/bin/true',
        agentArgs: ['-p', 'hi'], extraEnv: { DREAMSCAPE_MCP_URL: 'http://127.0.0.1:1/mcp', CURSOR_X: 'no', HOME: '/nope' }
    });
    assert.strictEqual(plan.sandbox, false);
    assert.strictEqual(plan.bin, '/bin/sh');
    assert.ok(!plan.args.some((a) => a.includes('bwrap')));
    assert.ok(!plan.args.join(' ').includes('sk-ant-oat-test-secret-value'), 'token on argv');
    assert.strictEqual(plan.env.HOME, os.homedir());
    assert.strictEqual(plan.env.PM2_HOME, path.join(os.homedir(), '.pm2'));
    assert.strictEqual(plan.env.DREAMSCAPE_MCP_URL, 'http://127.0.0.1:1/mcp');
    assert.ok(!('CURSOR_API_KEY' in plan.env) && !('CURSOR_X' in plan.env) && !('CLAUDE_CONFIG_DIR' in plan.env));
    assert.strictEqual(plan.hostEnv, plan.env);
    assert.deepStrictEqual(plan.args.slice(-3), ['/bin/true', '-p', 'hi']);
    const probe = xiLaunch.buildLaunch({
        sandbox: false, runtime: 'claude', projectDir: project, homeAccessDir: path.join(root, 'access'),
        runRoot: path.join(root, 'runs'), claudeTokenFile: token,
        command: ['/bin/sh', '-c', 'test "$CLAUDE_CODE_OAUTH_TOKEN" = sk-ant-oat-test-secret-value && echo OK']
    });
    const out = require('child_process').spawnSync(probe.bin, probe.args, { env: probe.hostEnv, encoding: 'utf8' });
    assert.strictEqual(out.stdout.trim(), 'OK');
    assert.strictEqual(
        xiLaunch.claudeSessionPath({ sandbox: false, projectDir: '/home/kanmi/staticforge', sessionId: 'abc' }),
        path.join(os.homedir(), '.claude', 'projects', '-home-kanmi-staticforge', 'abc.jsonl'));
    console.log('test-xi-host-launch: ok');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
