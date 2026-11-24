#!/usr/bin/env node
'use strict';

/**
 * modules/agentSupervisor.js: turn extraction (request, steering, actions, final), verdict parsing, a
 * review end to end against a fake model (temp home, temp coord DB, a real transcript file), delivery to
 * the agent's inbox, the auto-steer loop guard, a turn end seen through the sessions dir, and the MCP
 * check over the unix socket.
 *
 *   node scripts/test-agent-supervisor.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-'));
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
process.env.AGENT_SUPERVISOR_SOCKET = path.join(tmp, 'state', 'supervisor.sock');
fs.mkdirSync(path.join(tmp, '.claude', 'projects', '-repo'), { recursive: true });
fs.mkdirSync(path.join(tmp, '.claude', 'sessions'), { recursive: true });

const sup = require('../modules/agentSupervisor');
const launcher = require('../modules/claudeSessionLauncher');

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); }
}

const SID = 'aaaaaaaa-1111-2222-3333-444444444444';
const file = path.join(tmp, '.claude', 'projects', '-repo', `${SID}.jsonl`);
const line = (o) => `${JSON.stringify(o)}\n`;
const user = (text, ts) => line({ type: 'user', uuid: `u${ts}`, timestamp: ts, message: { role: 'user', content: text } });
const asst = (content, ts) => line({ type: 'assistant', uuid: `a${ts}`, timestamp: ts, message: { role: 'assistant', content } });

const settingsCfg = { agentSupervisor: { enabled: true, engine: 'tokenrouter', delivery: 'inbox' } };
const gr = {
    getConfig: () => settingsCfg,
    modifyConfig: () => ({ assign: async (p, v) => { settingsCfg[p[0]] = v; } }),
    getApiKeyManager: () => ({ getActiveApiKey: (s) => (s === 'tokenrouter' ? 'sk-test' : '') })
};
let calls = [];
let answer = { verdict: 'gaps', summary: 'The README was not updated', missed: [{ item: 'Update the README', evidence: '"also update the README"' }] };
sup._test.setFetch(async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization });
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }) };
});

(async () => {
    await test('turnOf: request, steering, actions and the final answer; supervisor steering is recognised', () => {
        const t = sup._test.turnOf([
            { role: 'user', kind: 'text', text: 'Fix the bug and also update the README' },
            { role: 'assistant', kind: 'tool_use', tool: 'Edit', text: 'src/a.js' },
            { role: 'user', kind: 'text', text: 'actually use tabs' },
            { role: 'assistant', kind: 'text', text: 'Working on it' },
            { role: 'assistant', kind: 'tool_use', tool: 'Bash', text: 'npm test' },
            { role: 'assistant', kind: 'text', text: 'Fixed the bug.' },
            { role: 'assistant', kind: 'tool_use', tool: 'Read', text: 'x', sidechain: true }
        ]);
        assert.deepStrictEqual([t.request, t.steering, t.actions.length, t.final, t.fromSupervisor], ['Fix the bug and also update the README', ['actually use tabs'], 2, 'Fixed the bug.', false]);
        assert.strictEqual(sup._test.turnOf([{ role: 'user', kind: 'text', text: `${sup.STEER_PREFIX} do x` }]).fromSupervisor, true);
    });

    await test('parseVerdict: JSON, fenced JSON, ok with items becomes gaps, junk is unclear', () => {
        assert.strictEqual(sup._test.parseVerdict('{"verdict":"ok","summary":"all done","missed":[]}').verdict, 'ok');
        assert.strictEqual(sup._test.parseVerdict('```json\n{"verdict":"gaps","missed":[{"item":"x"}]}\n```').missed[0].item, 'x');
        assert.strictEqual(sup._test.parseVerdict('{"verdict":"ok","missed":[{"item":"x"}]}').verdict, 'gaps');
        assert.strictEqual(sup._test.parseVerdict('sorry').verdict, 'unclear');
        assert.deepStrictEqual(sup._test.parseVerdict('{"verdict":"gaps","missed":["Update the README"]}').missed, [{ item: 'Update the README', evidence: '' }]);
    });

    await test('defaults: TokenRouter with DeepSeek V4.1 Flash, inbox delivery; engines list it', () => {
        const s = sup.settings({ getConfig: () => ({}) });
        assert.deepStrictEqual([s.engine, s.model, s.delivery, s.enabled], ['tokenrouter', '', 'inbox', true]);
        assert.strictEqual(sup.DEFAULT_MODEL, 'deepseek/deepseek-v4.1-flash');
        assert.strictEqual(sup.engines(gr)[0].defaultModel, 'deepseek/deepseek-v4.1-flash');
    });

    fs.writeFileSync(file, [
        user('Fix the bug and also update the README', '2026-11-24T10:00:00Z'),
        asst([{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/src/a.js', old_string: 'a', new_string: 'b' } }], '2026-11-24T10:00:05Z'),
        user('actually use tabs', '2026-11-24T10:00:06Z'),
        asst([{ type: 'text', text: 'Fixed the bug.' }], '2026-11-24T10:00:09Z')
    ].join(''));

    await test('review: one model call with the turn, stored, gap posted to the agent\'s inbox', async () => {
        calls = [];
        const rv = await sup.review(SID, 'recheck', { gr });
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].url, 'https://api.tokenrouter.com/v1/chat/completions');
        assert.strictEqual(calls[0].body.model, 'deepseek/deepseek-v4.1-flash');
        assert.strictEqual(calls[0].auth, 'Bearer sk-test');
        const u = calls[0].body.messages[1].content;
        assert.match(u, /## Request\nFix the bug and also update the README/);
        assert.match(u, /1\. actually use tabs/);
        assert.match(u, /Edit: /);
        assert.match(u, /Fixed the bug\./);
        assert.deepStrictEqual([rv.verdict, rv.missed[0] && rv.missed[0].item, rv.delivered, rv.trigger], ['gaps', 'Update the README', 'inbox', 'recheck'], JSON.stringify(rv));
        const msgs = require('../modules/agentCoord/store').recentMessages({ agentId: `claude-${SID.slice(0, 8)}` });
        assert.match(msgs[msgs.length - 1].body, /Update the README/);
        assert.strictEqual(sup.summary().open, 1);
    });

    await test('a session that ends a turn (busy -> idle in its record) is reviewed once', async () => {
        const rec = path.join(tmp, '.claude', 'sessions', '999999.json');
        fs.writeFileSync(rec, JSON.stringify({ pid: 999999, sessionId: SID, status: 'busy' }));
        sup.bind(gr);
        sup._test.scan(true);
        fs.appendFileSync(file, user('Now add a test', '2026-11-24T10:01:00Z') + asst([{ type: 'text', text: 'Added the test.' }], '2026-11-24T10:01:30Z'));
        answer = { verdict: 'ok', summary: 'done', missed: [] };
        calls = [];
        const before = sup.summary().reviewed;
        fs.writeFileSync(rec, JSON.stringify({ pid: 999999, sessionId: SID, status: 'idle' }));
        sup._test.scan(false);
        for (let i = 0; i < 50 && sup.summary().reviewed === before; i += 1) await new Promise((r) => setTimeout(r, 20));
        assert.strictEqual(sup.summary().reviewed, before + 1);
        assert.match(calls[0].body.messages[1].content, /## Request\nNow add a test/); // only the new turn (offset kept)
        assert.doesNotMatch(calls[0].body.messages[1].content, /README/);
        sup._test.scan(false); // still idle: nothing new
        await new Promise((r) => setTimeout(r, 50));
        assert.strictEqual(sup.summary().reviewed, before + 1);
    });

    await test('steer delivery: typed in, but at most 2 automatic steers while the turns are the Supervisor\'s own', async () => {
        settingsCfg.agentSupervisor.delivery = 'steer';
        answer = { verdict: 'gaps', summary: 'missed', missed: [{ item: 'x', evidence: 'y' }] };
        const typed = [];
        const realSteer = launcher.steer;
        launcher.steer = async (id, text) => { typed.push(text); return { sent: true }; };
        try {
            fs.appendFileSync(file, user('Do x', '2026-11-24T10:02:00Z') + asst([{ type: 'text', text: 'done' }], '2026-11-24T10:02:10Z'));
            await sup.review(SID, 'turn-end', { gr });
            for (let i = 0; i < 3; i += 1) {
                fs.appendFileSync(file, user(`${sup.STEER_PREFIX} do x`, `2026-11-24T10:0${3 + i}:00Z`) + asst([{ type: 'text', text: 'ok' }], `2026-11-24T10:0${3 + i}:10Z`));
                await sup.review(SID, 'turn-end', { gr });
            }
            assert.strictEqual(typed.length, 2, `typed ${typed.length}`);
            assert.ok(typed[0].startsWith(sup.STEER_PREFIX));
        } finally { launcher.steer = realSteer; settingsCfg.agentSupervisor.delivery = 'inbox'; }
    });

    await test('MCP check over the unix socket answers the review; off answers why', async () => {
        sup.start(gr);
        await new Promise((r) => setTimeout(r, 100));
        answer = { verdict: 'ok', summary: 'all done', missed: [] };
        const ask = () => new Promise((resolve, reject) => {
            const net = require('net');
            let buf = '';
            const s = net.createConnection(process.env.AGENT_SUPERVISOR_SOCKET, () => s.write(`${JSON.stringify({ op: 'check', sessionId: SID })}\n`));
            s.on('data', (c) => { buf += c; });
            s.on('end', () => resolve(JSON.parse(buf)));
            s.on('error', reject);
        });
        const r = await ask();
        assert.ok(r.ok && r.review.verdict === 'ok' && r.review.trigger === 'mcp', JSON.stringify(r));
        assert.strictEqual((fs.statSync(process.env.AGENT_SUPERVISOR_SOCKET).mode & 0o777), 0o600);
        settingsCfg.agentSupervisor.enabled = false;
        const off = await ask();
        assert.ok(!off.ok && /off/.test(off.error));
        settingsCfg.agentSupervisor.enabled = true;
        sup.stop();
    });

    await test('send / dismiss: a gap review is typed in on request, then dismissed', async () => {
        const rv = sup.listReviews().find((x) => x.verdict === 'gaps');
        const realSteer = launcher.steer;
        let typed = '';
        launcher.steer = async (id, text) => { typed = text; return { sent: true }; };
        try {
            const sent = await sup.send(rv.id);
            assert.strictEqual(sent.delivered, 'steer');
            assert.ok(typed.startsWith(sup.STEER_PREFIX));
        } finally { launcher.steer = realSteer; }
        assert.strictEqual(sup.dismiss(rv.id).dismissed, true);
    });

    await test('locks: a session that edited without a lock gets one; gone, it is removed', async () => {
        const repo = path.join(tmp, 'repo');
        fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
        require('child_process').execFileSync('git', ['init', '-q', repo]);
        fs.writeFileSync(path.join(repo, 'src', 'a.js'), '1'); // uncommitted: work in progress
        const SID2 = 'bbbbbbbb-1111-2222-3333-444444444444';
        const f2 = path.join(tmp, '.claude', 'projects', '-repo', `${SID2}.jsonl`);
        fs.writeFileSync(f2, user('edit a', '2026-11-24T11:00:00Z') + asst([{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: path.join(repo, 'src', 'a.js') } }], '2026-11-24T11:00:05Z'));
        const rec = path.join(tmp, '.claude', 'sessions', `${process.pid}.json`);
        fs.writeFileSync(rec, JSON.stringify({ pid: process.pid, sessionId: SID2, status: 'idle', cwd: repo, updatedAt: Date.now() }));
        const store = require('../modules/agentCoord/store');
        store.upsertAgent({ id: 'claude-bbbbbbbb', kind: 'claude', name: 'Worker2', sessionId: SID2, cwd: repo, repo: 'repo', pid: process.pid });
        const changed = await sup.sweepLocks(SID2);
        assert.ok(changed.some((c) => c.planted === '.agent-claude-bbbbbbbb'), JSON.stringify(changed));
        assert.ok(fs.existsSync(path.join(repo, '.agent-claude-bbbbbbbb')));
        assert.strictEqual(sup.lockStatus().find((l) => l.file === '.agent-claude-bbbbbbbb').plantedBy, 'supervisor');
        fs.writeFileSync(path.join(repo, '.agent-nobody'), 'agent: nobody\n');
        assert.strictEqual(sup.lockStatus().find((l) => l.file === '.agent-nobody').state, 'orphan');
        fs.unlinkSync(rec); // the session ends
        const after = await sup.sweepLocks(SID2);
        assert.ok(after.some((c) => c.removed === '.agent-claude-bbbbbbbb'), JSON.stringify(after));
        assert.ok(!fs.existsSync(path.join(repo, '.agent-claude-bbbbbbbb')));
        assert.ok(fs.existsSync(path.join(repo, '.agent-nobody')), 'an orphan lock is only removed from Fleet');
    });

    await test('artifacts: temp folders a session made are tracked; only /tmp-like paths of ended sessions are cleanable', async () => {
        const SID3 = 'cccccccc-1111-2222-3333-444444444444';
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-art-'));
        fs.writeFileSync(path.join(scratch, 'big.bin'), Buffer.alloc(4096));
        const f3 = path.join(tmp, '.claude', 'projects', '-repo', `${SID3}.jsonl`);
        fs.writeFileSync(f3, user('build', '2026-11-24T12:00:00Z') + asst([{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: `mkdir -p ${scratch} && node x.js > ${scratch}/log.txt` } }, { type: 'tool_use', id: 'b2', name: 'Bash', input: { command: `mkdir -p ${tmp}/repo/build` } }], '2026-11-24T12:00:05Z'));
        const store = require('../modules/agentCoord/store');
        store.upsertAgent({ id: 'claude-cccccccc', kind: 'claude', name: 'Builder', sessionId: SID3, cwd: path.join(tmp, 'repo') });
        store.scanSession(SID3);
        sup.refreshArtifacts({ sessionId: SID3 });
        const arts = sup.artifactStatus().filter((a) => a.sessionId === SID3);
        const dir = arts.find((a) => a.path === scratch);
        assert.ok(dir && dir.exists && dir.sizeBytes >= 4096 && dir.state === 'orphan' && dir.cleanable, JSON.stringify(arts));
        const inRepo = arts.find((a) => a.path.endsWith(`${path.sep}repo${path.sep}build`));
        assert.ok(inRepo && !inRepo.cleanable, 'a folder outside /tmp-like roots is never cleaned from here');
        const r = sup.cleanArtifact(dir.id);
        assert.ok(r.freedBytes >= 4096 && !fs.existsSync(scratch));
        assert.throws(() => sup.cleanArtifact(inRepo.id), /Only work folders/);
        sup.forgetArtifact(inRepo.id);
        assert.ok(!sup.artifactStatus().some((a) => a.id === inRepo.id));
    });

    require('../modules/agentCoord/store').close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
