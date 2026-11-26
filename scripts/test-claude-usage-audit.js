#!/usr/bin/env node
'use strict';

/**
 * modules/claudeUsageAudit.js on fixture transcripts (a temp config dir, never the real ~/.claude): the turn split, one reply
 * written as several lines counted once, files edited, agent shares and which turn an agent belongs to, the flags (heavy
 * turn, heavy agent, burn rate, poor cache reuse, a model above the policy's maximum) firing once and not repeating,
 * acknowledging, prices only when typed, and the maintenance check "Usage review" with a stubbed engine.
 *
 *   node scripts/test-claude-usage-audit.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
const audit = require('../modules/claudeUsageAudit');
// a new flag is a routine alert (#1196): it goes through fleetNotices.routine, which tells the Supervisor first and
// reaches the phone only on the "usage" switch; here the routine call is what is counted
const posted = [];
require('../modules/fleetNotices').routine = (kind, n) => { assert.strictEqual(kind, 'usage'); posted.push(n); return { told: false, published: false }; };

let n = 0;
const ok = (msg) => { n += 1; console.log(`ok ${n} - ${msg}`); };

const SID = '11111111-2222-4333-8444-555555555555';
const dir = path.join(tmp, 'config');
const projDir = path.join(dir, 'projects', '-tmp-x');
fs.mkdirSync(path.join(projDir, SID, 'subagents'), { recursive: true });

const now = Date.now();
const iso = (min) => new Date(now - min * 60000).toISOString();
const asst = (min, id, model, usage, content, extra) => JSON.stringify(Object.assign({ type: 'assistant', timestamp: iso(min), cwd: '/tmp/x', perTurnEffort: 'high', message: { id, model, usage, content: content || [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } }, extra || {}));
const human = (min, text) => JSON.stringify({ type: 'user', timestamp: iso(min), cwd: '/tmp/x', message: { role: 'user', content: text } });
const use = (name, input, id) => ({ type: 'tool_use', id: id || `t${Math.random()}`, name, input });
const big = (min) => JSON.stringify({ type: 'user', timestamp: iso(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'y'.repeat(70000) }] } });
const U = (i, o, cw, cr) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr });

const main = [
    human(50, 'Fix the thing'),
    asst(49, 'm1', 'claude-opus-5-5', U(10, 400, 20000, 100000), [use('Edit', { file_path: '/tmp/x/a.js' }), use('Read', { file_path: '/tmp/x/a.js' })]),
    asst(49, 'm1', 'claude-opus-5-5', U(10, 600, 20000, 100000), [use('Edit', { file_path: '/tmp/x/a.js' }), use('Edit', { file_path: '/tmp/x/b.js' })]), // same reply, more output: counted once
    big(48),
    asst(47, 'm2', 'claude-opus-5-5', U(5, 300, 1000, 150000), [use('Bash', { command: 'npm test' })]),
    human(30, 'Now the docs'),
    asst(29, 'm3', 'claude-opus-5-5', U(5, 200, 500, 160000), [use('Write', { file_path: '/tmp/x/c.md' })])
].join('\n');
fs.writeFileSync(path.join(projDir, `${SID}.jsonl`), `${main}\n`);

const agentLine = (min, id, model, u, tools) => asst(min, id, model, u, tools, { isSidechain: true });
const agentA = [
    agentLine(48.5, 'a1', 'claude-opus-5-5', U(100, 3000, 400000, 600000), [use('Read', { file_path: '/tmp/x/big.js' })]),
    agentLine(48.4, 'a2', 'claude-opus-5-5', U(100, 3000, 300000, 700000), [use('Read', { file_path: '/tmp/x/big.js' })]),
    agentLine(48.3, 'a3', 'claude-opus-5-5', U(100, 3000, 200000, 800000), [use('Read', { file_path: '/tmp/x/big.js' })]),
    agentLine(48.2, 'a4', 'claude-opus-5-5', U(100, 3000, 100000, 900000), [use('Read', { file_path: '/tmp/x/big.js' })])
].join('\n');
const agentB = agentLine(29.5, 'b1', 'claude-sonnet-5-5', U(100, 500, 5000, 10000), [use('Edit', { file_path: '/tmp/x/d.js' })]);
fs.writeFileSync(path.join(projDir, SID, 'subagents', 'agent-aaa.jsonl'), `${agentA}\n`);
fs.writeFileSync(path.join(projDir, SID, 'subagents', 'agent-aaa.meta.json'), JSON.stringify({ description: 'Rename everything', agentType: 'general-purpose', model: 'opus', requestShape: 'background', finished: true }));
fs.writeFileSync(path.join(projDir, SID, 'subagents', 'agent-bbb.jsonl'), `${agentB}\n`);
fs.writeFileSync(path.join(projDir, SID, 'subagents', 'agent-bbb.meta.json'), JSON.stringify({ description: 'Docs sweep', agentType: 'general-purpose', model: 'sonnet', requestShape: 'background', finished: true }));

const cfgOf = (u) => ({ getConfig: () => ({ agentSupervisor: { usageFlags: u } }) });
const work = { bySession: new Map(), items: new Map() };

(async () => {
    const opts = { dirs: [dir], days: 1, now };
    const sc = await audit.scan(opts);
    assert.strictEqual(sc.sessions.length, 1);
    const s = sc.sessions[0];
    assert.strictEqual(s.turns.length, 2);
    ok('two human messages make two turns');
    const f1 = audit.figures(s.turns[0], [], {});
    assert.strictEqual(f1.tokens.output, 600 + 300);
    assert.strictEqual(f1.tokens.cacheWrite, 20000 + 1000);
    assert.strictEqual(f1.calls, 2);
    ok('a reply written as two lines is counted once (the later usage wins)');
    assert.strictEqual(f1.files, 2);
    assert.strictEqual(f1.tools, 5);
    assert.strictEqual(f1.big, 1);
    ok('files edited, tool calls and the big tool result are counted per turn');
    assert.strictEqual(s.agents.length, 2);
    const a = s.agents.find((x) => x.id === 'aaa');
    assert.strictEqual(a.unit.maxRepeat, 4);
    ok('agents are read from subagents/ with their meta; repeated identical calls are seen');

    const tr = await audit.tree({ dirs: [dir], days: 1, now, scanned: sc, work, gr: cfgOf({}) });
    const sess = tr.rows.find((r) => r.kind === 'session');
    const t1 = tr.rows.find((r) => r.kind === 'turn' && r.key.endsWith(':1'));
    const t2 = tr.rows.find((r) => r.kind === 'turn' && r.key.endsWith(':2'));
    const agA = tr.rows.find((r) => r.kind === 'agent' && r.key.endsWith(':aaa'));
    const agB = tr.rows.find((r) => r.kind === 'agent' && r.key.endsWith(':bbb'));
    assert.strictEqual(agA.parent, t1.key);
    assert.strictEqual(agB.parent, t2.key);
    ok('an agent hangs under the turn it started in');
    const sum = (r) => r.fig.tokens.fresh;
    assert.ok(Math.abs(agA.fig.share + agB.fig.share - (sum(agA) + sum(agB)) / sum(sess)) < 1e-9);
    assert.ok(agA.fig.share > 0.8);
    ok('an agent\'s share of the session tokens');
    assert.strictEqual(tr.rows.find((r) => r.kind === 'work').name, 'Sessions without a work item');
    assert.strictEqual(sess.fig.costUsd, null);
    assert.strictEqual(tr.pricesSet, false);
    ok('no work item groups under "without a work item"; no price table means tokens only (no cost)');
    const priced = audit.figures(s.turns[0], [], { opus: { in: 1, out: 2, cacheRead: 0.5, cacheWrite: 1.5 } });
    assert.ok(priced.costUsd > 0);
    assert.strictEqual(audit.figures(s.turns[0], [], { sonnet: { in: 1, out: 2 } }).costUsd, null);
    ok('a cost is shown only for models with a typed price');

    // ---- flags
    const gr = cfgOf({ turnTokens: 500000, tokensPerHour: 900000, agentTokens: 300000, cacheRatioMin: 0.99, cacheRatioMinCalls: 3 });
    const first = await audit.evaluate(SID, { dirs: [dir], gr, now });
    const reasons = first.map((f) => f.reason).sort();
    assert.ok(reasons.includes('turn_tokens'), reasons.join());
    assert.ok(reasons.includes('agent_tokens'));
    assert.ok(reasons.includes('burn_rate'));
    assert.ok(reasons.includes('cache_ratio'));
    assert.ok(reasons.includes('model_over'), 'an Opus agent is above the "part" maximum (sonnet)');
    ok('heavy turn, heavy agent, burn rate, poor cache reuse and a model above the policy all fire');
    assert.strictEqual(posted.length, first.length);
    const again = await audit.evaluate(SID, { dirs: [dir], gr, now });
    assert.strictEqual(again.length, 0);
    assert.strictEqual(posted.length, first.length);
    assert.strictEqual(audit.flagsList({ all: true }).length, first.length);
    ok('the same flags do not repeat and raise one routine alert each');
    const turnFlag = audit.flagsList({}).find((f) => f.reason === 'turn_tokens' && f.ref === '1');
    assert.ok(turnFlag && turnFlag.numbers.fresh > 500000);
    assert.ok(!audit.flagsList({}).some((f) => f.reason === 'turn_tokens' && f.ref === '2'));
    ok('only the turn over the limit is flagged');
    audit.ack(turnFlag.id);
    assert.ok(!audit.flagsList({}).some((f) => f.id === turnFlag.id));
    assert.ok(audit.flagsList({ all: true }).some((f) => f.id === turnFlag.id && f.ackAt));
    assert.ok(!(await audit.evaluate(SID, { dirs: [dir], gr, now })).length);
    ok('acknowledging hides a flag and it is not raised again');
    assert.strictEqual(audit.summary().sessions[SID] > 0, true);
    const quiet = audit.judge(s, Object.assign(audit.settings(cfgOf({})), { turnTokens: 1e12, tokensPerHour: 1e12, agentTokens: 1e12, cacheRatioMin: 0 }), { now });
    assert.deepStrictEqual(quiet.map((f) => f.reason), ['model_over']);
    ok('with generous limits only the policy flag is left');
    assert.ok(!audit.judge(s, Object.assign(audit.settings(cfgOf({})), { modelOverPolicy: false, turnTokens: 1e12, tokensPerHour: 1e12, agentTokens: 1e12, cacheRatioMin: 0 }), { now }).length);
    ok('the policy flag can be turned off');

    // ---- the maintenance check, stubbed engine
    let asked = null;
    const filed = [];
    const ctx = { gr: cfgOf({ turnTokens: 500000, fileWorkItem: true }), usageDirs: [dir], now, work, scanned: sc, askJson: async (sys, user) => { asked = JSON.parse(user); return { findings: [{ subject: 'Rename everything', issue: 'Opus read big.js 4 times (3.2M cache read)', suggestion: 'Use Sonnet and read the file once', severity: 'warn' }] }; }, sup: { settings: () => ({ modelPolicy: { part: { maxModel: 'sonnet' } } }), enqueue: (w) => { filed.push(w); } } };
    const chk = await audit.checkUsage(ctx);
    assert.strictEqual(chk.id, 'usage');
    assert.strictEqual(chk.state, 'warn');
    assert.ok(asked && asked.top.length === 1 && asked.top[0].mostRepeatedCall === 4 && asked.flags.length > 0);
    assert.ok(chk.findings.some((x) => /Suggestion: Use Sonnet/.test(x.text)));
    assert.strictEqual(filed.length, 1);
    ok('the usage check sends the top consumers and flags to the engine and reports its findings (and files a held item when enabled)');
    filed.length = 0;
    const chk2 = await audit.checkUsage(Object.assign({}, ctx, { gr: cfgOf({ turnTokens: 500000 }), askJson: async () => { throw new Error('engine down'); } }));
    assert.ok(chk2.findings.some((x) => /engine could not review/.test(x.text)));
    assert.strictEqual(filed.length, 0);
    ok('an engine failure is a finding, nothing is filed by default');

    const m = require('../modules/fleetMaintenance');
    assert.ok(m.CHECK_IDS.includes('usage'));
    ok('the maintenance run has a "usage" check');
    console.log(`all ${n} ok`);
})().catch((e) => { console.error(e); process.exit(1); });
