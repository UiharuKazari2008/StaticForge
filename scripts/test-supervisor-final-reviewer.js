#!/usr/bin/env node
'use strict';

/**
 * Supervisor "Final reviewer": settings normalization, the Claude CLI call against a fake CLI (args, minimal env,
 * stdin, JSON result, fences) and the fall back to the Supervisor's engine when the CLI fails.
 *
 *   node scripts/test-supervisor-final-reviewer.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-final-reviewer-'));
process.env.NOTIFICATION_INBOX_DB = path.join(tmp, 'notifications.db');
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
process.env.AGENT_SUPERVISOR_SOCKET = path.join(tmp, 'state', 'supervisor.sock');
process.env.AGENT_SUPERVISOR_BG_PER_MIN = '100000';
// secrets that must never reach the CLI
process.env.ANTHROPIC_API_KEY = 'sk-leak-1';
process.env.CLAUDE_CODE_SOMETHING = 'leak-2';

const sup = require('../modules/agentSupervisor');
const fleetMcp = require('../modules/claudeFleetMcp');
fleetMcp.pickForStart = async () => ({ index: 1, name: 'Acct B', settings: {} });

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 8).join('\n     ')}`); }
}

const cfg = { agentSupervisor: { enabled: true, engine: 'tokenrouter', delivery: 'inbox' } };
const gr = {
    getConfig: () => cfg,
    modifyConfig: () => ({ assign: async (p, v) => { cfg[p[0]] = v; } }),
    getApiKeyManager: () => ({ getActiveApiKey: (s) => (s === 'tokenrouter' ? 'sk-test' : ''), getServiceKeys: () => [{ apiKey: 'tok-A' }, { apiKey: 'tok-SECRET-B' }] })
};

const dump = path.join(tmp, 'dump.json');
const fake = path.join(tmp, 'fake-claude.js');
function writeFake(mode) {
    fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs'); let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
    fs.writeFileSync(${JSON.stringify(dump)}, JSON.stringify({ args: process.argv.slice(2), env: process.env, stdin, cwd: process.cwd() }));
    if (${JSON.stringify(mode)} === 'fail') { console.error('boom'); process.exit(3); }
    process.stdout.write(JSON.stringify({ result: '\`\`\`json\\n{"verdict":"ok","summary":"fine","missed":[]}\\n\`\`\`', total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } }));
});
`);
    fs.chmodSync(fake, 0o755);
    process.env.DREAMSCAPE_CLAUDE_CLI = fake;
}

(async () => {
    await test('settings: reviewer defaults to the Supervisor and unknown values fall back', async () => {
        assert.deepStrictEqual(sup.settings(gr).reviewer, { engine: '', model: 'opus', effort: '' });
        assert.deepStrictEqual(sup._test.cleanReviewer({ engine: 'x', model: 'gpt', effort: 'huge' }), { engine: '', model: 'opus', effort: '' });
        const s = await sup.saveSettings(gr, { reviewer: { engine: 'claude', model: 'sonnet', effort: 'medium' } });
        assert.deepStrictEqual(s.reviewer, { engine: 'claude', model: 'sonnet', effort: 'medium' });
        const s2 = await sup.saveSettings(gr, { reviewer: { effort: 'max' } });
        assert.deepStrictEqual(s2.reviewer, { engine: 'claude', model: 'sonnet', effort: 'max' });
        const s3 = await sup.saveSettings(gr, { maxConcurrent: 2 });
        assert.strictEqual(s3.reviewer.effort, 'max');
        await sup.saveSettings(gr, { reviewer: { engine: '', model: 'opus', effort: '' } });
    });

    await test('callClaudeReviewer: flags, minimal env, token, stdin, fences stripped, result shape', async () => {
        writeFake('ok');
        const r = await sup._test.callClaudeReviewer(gr, [{ role: 'system', content: 'SYS PROMPT' }, { role: 'user', content: 'THE TURN' }], { engine: 'claude', model: 'opus', effort: 'medium' });
        assert.deepStrictEqual(r, { content: '{"verdict":"ok","summary":"fine","missed":[]}', finish: 'stop', engine: 'Claude (Acct B)', model: 'opus', failedOverFrom: null });
        const d = JSON.parse(fs.readFileSync(dump, 'utf8'));
        const a = d.args.join(' ');
        assert.ok(/--model opus/.test(a) && /--effort medium/.test(a) && /--system-prompt SYS PROMPT/.test(a), a);
        assert.ok(d.args.includes('-p') && d.args.includes('--tools') && d.args.includes('--strict-mcp-config') && d.args.includes('--no-session-persistence'));
        assert.strictEqual(d.stdin, 'THE TURN');
        assert.strictEqual(d.env.CLAUDE_CODE_OAUTH_TOKEN, 'tok-SECRET-B');
        assert.strictEqual(d.env.ANTHROPIC_API_KEY, undefined);
        const claudeVars = Object.keys(d.env).filter((k) => /^(ANTHROPIC|CLAUDE)/.test(k)).sort();
        assert.deepStrictEqual(claudeVars, ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR']);
        assert.strictEqual(d.env.HOME, d.env.CLAUDE_CONFIG_DIR);
        assert.ok(!fs.existsSync(d.cwd), 'temp dir removed');
        assert.ok(!JSON.stringify(r).includes('tok-SECRET'));
    });

    await test('askModel: Claude reviewer answers the review; a failing CLI falls back to the normal engine', async () => {
        let fetched = 0;
        sup._test.setFetch(async () => { fetched += 1; return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"verdict":"gaps","summary":"fallback","missed":[{"item":"x"}]}' } }] }) }; });
        const s = Object.assign({}, sup.settings(gr), { reviewer: { engine: 'claude', model: 'opus', effort: '' } });
        writeFake('ok');
        let v = await sup._test.askModel(gr, s, 'turn');
        assert.strictEqual(v.verdict, 'ok');
        assert.strictEqual(v.model, 'opus');
        assert.strictEqual(fetched, 0);
        writeFake('fail');
        v = await sup._test.askModel(gr, s, 'turn');
        assert.strictEqual(v.summary, 'fallback');
        assert.strictEqual(fetched, 1);
    });

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `${failed} failed` : 'all passed');
    process.exit(failed ? 1 : 0);
})();
