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
process.env.AGENT_SUPERVISOR_SETTLE_MS = '0';
fs.mkdirSync(path.join(tmp, '.claude', 'projects', '-repo'), { recursive: true });
fs.mkdirSync(path.join(tmp, '.claude', 'sessions'), { recursive: true });

const sup = require('../modules/agentSupervisor');
// a fake Yozora: every call recorded, never the network (#1154 Yozora tracking)
const yzCalls = [];
const yzIssues = new Map(); // "repo#n" -> { state, labels, body, title }
let yzNext = 100;
require('../modules/fleetYozora')._setFetch(async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const u = String(url).replace('https://yozora.bluesteel.737.jp.net/api/v1', '');
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    yzCalls.push({ method, url: u, body });
    const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    let m;
    if (method === 'GET' && /\/labels\?/.test(u)) return ok([{ id: 1, name: 'fleet' }, { id: 2, name: 'status:ready' }, { id: 3, name: 'status:in-progress' }, { id: 4, name: 'status:review' }, { id: 5, name: 'status:blocked' }, { id: 6, name: 'status:done' }]);
    if (method === 'POST' && (m = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(u))) { const n = yzNext++; yzIssues.set(`${m[1]}#${n}`, { state: 'open', labels: body.labels, body: body.body, title: body.title }); return ok({ number: n, id: 9000 + n }); }
    if (method === 'GET' && (m = /^\/repos\/([^/]+\/[^/]+)\/issues\?state=open.*labels=fleet/.exec(u))) {
        return ok([...yzIssues.entries()].filter(([k, v]) => k.startsWith(`${m[1]}#`) && v.state === 'open' && v.external).map(([k, v]) => ({ number: Number(k.split('#')[1]), id: 1, title: v.title, body: v.body, labels: [{ name: 'fleet' }].concat(v.now ? [{ name: 'fleet:now' }] : []) })));
    }
    if (method === 'GET' && (m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(u))) { const v = yzIssues.get(`${m[1]}#${m[2]}`) || { state: 'open' }; return ok({ number: Number(m[2]), id: 9000, state: v.state, labels: [] }); }
    return ok({});
});
const launcher = require('../modules/claudeSessionLauncher');

let failed = 0;
// put an item back to queued (a test started it already)
function db_setQueued(id) { require('../modules/agentCoord/store').open().prepare("UPDATE supervisor_work SET state = 'queued', session_id = NULL WHERE id = ?").run(id); }
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); }
}

const SID = 'aaaaaaaa-1111-2222-3333-444444444444';
const file = path.join(tmp, '.claude', 'projects', '-repo', `${SID}.jsonl`);
const line = (o) => `${JSON.stringify(o)}\n`;
const user = (text, ts) => line({ type: 'user', uuid: `u${ts}`, timestamp: ts, message: { role: 'user', content: text } });
const asst = (content, ts) => line({ type: 'assistant', uuid: `a${ts}`, timestamp: ts, message: { role: 'assistant', content } });

const settingsCfg = { agentSupervisor: { enabled: true, engine: 'tokenrouter', delivery: 'inbox', reviewScope: 'all' } };
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
        sup.markSupervised(SID); // steering goes only into supervised sessions
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
        // supervised Clean: hard guard first (never reaches the engine)
        calls = [];
        const g1 = await sup.cleanArtifact(inRepo.id, { gr });
        assert.ok(g1.decision === 'refused' && /Only work folders/.test(g1.reason) && calls.length === 0, JSON.stringify(g1));
        // modified in the last 2 hours: refused without asking the engine
        const r0 = await sup.cleanArtifact(dir.id, { gr });
        assert.ok(r0.decision === 'refused' && /last 2 hours/.test(r0.reason) && calls.length === 0 && fs.existsSync(scratch), JSON.stringify(r0));
        const old = new Date(Date.now() - 5 * 3600 * 1000);
        const age = (p) => { fs.utimesSync(path.join(p, 'big.bin'), old, old); fs.utimesSync(path.join(p, 'log.txt'), old, old); fs.utimesSync(p, old, old); };
        fs.writeFileSync(path.join(scratch, 'log.txt'), 'x');
        // a busy lock inside
        fs.writeFileSync(path.join(scratch, '.agent-x'), 'a'); age(scratch); fs.utimesSync(path.join(scratch, '.agent-x'), old, old);
        const rl = await sup.cleanArtifact(dir.id, { gr });
        assert.ok(rl.decision === 'refused' && /busy lock/.test(rl.reason) && calls.length === 0, JSON.stringify(rl));
        fs.unlinkSync(path.join(scratch, '.agent-x'));
        age(scratch);
        // the engine says unsafe
        answer = { verdict: 'unsafe', reason: 'It looks like a database' };
        const ru = await sup.cleanArtifact(dir.id, { gr });
        assert.ok(ru.decision === 'unsafe' && /database/.test(ru.reason) && calls.length === 1 && fs.existsSync(scratch), JSON.stringify(ru));
        assert.strictEqual(sup.artifactStatus().find((a) => a.id === dir.id).decision, 'unsafe');
        // safe -> trashed -> restored
        answer = { verdict: 'safe', reason: 'build scratch' };
        const r = await sup.cleanArtifact(dir.id, { gr });
        assert.ok(r.decision === 'trashed' && r.freedBytes >= 4096 && !fs.existsSync(scratch) && fs.existsSync(r.trash) && r.trash.includes('.fleet-trash'), JSON.stringify(r));
        const ts = sup.artifactStatus().find((a) => a.id === dir.id);
        assert.ok(ts.state === 'trashed' && ts.canRestore && !ts.cleanable, JSON.stringify(ts));
        sup.restoreArtifact(dir.id);
        assert.ok(fs.existsSync(path.join(scratch, 'big.bin')) && sup.artifactStatus().find((a) => a.id === dir.id).decision === 'restored');
        // trashed again, then purged after 7 days
        age(scratch);
        const r2 = await sup.cleanArtifact(dir.id, { gr });
        assert.strictEqual(r2.decision, 'trashed', JSON.stringify(r2));
        assert.deepStrictEqual(sup.purgeTrash(), []);
        require('../modules/agentCoord/store').open().prepare('UPDATE artifacts SET decided_at = ? WHERE id = ?').run(Date.now() - 8 * 86400000, dir.id);
        assert.strictEqual(sup.purgeTrash().length, 1);
        assert.ok(!fs.existsSync(r2.trash) && sup.artifactStatus().find((a) => a.id === dir.id).decision === 'purged');
        // engine budget: a run past its cap defers
        assert.strictEqual((await sup.cleanArtifact(inRepo.id, { gr, budget: { calls: 10, max: 10 } })).decision, 'refused');
        sup.forgetArtifact(inRepo.id);
        assert.ok(!sup.artifactStatus().some((a) => a.id === inRepo.id));
    });

    await test('artifacts: the parser never records /, the repo, HOME, bare words or relative paths; a dirty worktree is refused', async () => {
        const store = require('../modules/agentCoord/store');
        const repoRoot = path.join(__dirname, '..');
        const got = store.shellArtifacts(`mkdir / ; mkdir ${repoRoot}/ ; mkdir ${os.homedir()} ; git worktree add and ; git worktree add ../wt/feature-x ; mkdir -p build ; mkdir ~/.cache ; mkdir /tmp ; mkdir /tmp/ok-dir ; git worktree add -b f /tmp/wt-real`).map((a) => `${a.kind}:${a.path}`);
        assert.deepStrictEqual(got, ['dir:/tmp/ok-dir', 'worktree:/tmp/wt-real'], JSON.stringify(got));
        assert.strictEqual(store.acceptArtifactPath('~/.claude/x'), `${os.homedir()}/.claude/x`);
        ['/', '/tmp', '/home', os.homedir(), repoRoot, 'and', '../x', '~'].forEach((p) => assert.strictEqual(store.acceptArtifactPath(p), '', p));
        // dirty worktree in /tmp: refused with git evidence, engine never asked
        const cp = require('child_process');
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-wt-'));
        const main = path.join(base, 'main'); const wt = path.join(base, 'wt');
        fs.mkdirSync(main);
        const git = (cwd, ...a) => cp.execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, stdio: 'ignore' });
        git(main, 'init', '-q'); fs.writeFileSync(path.join(main, 'a'), '1'); git(main, 'add', '.'); git(main, 'commit', '-qm', 'i');
        git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
        const SID4 = 'dddddddd-5555-6666-7777-888888888888';
        const d = store.open();
        d.prepare('INSERT INTO artifacts (session_id, path, kind, created_at, cmd, cwd) VALUES (?, ?, ?, ?, ?, ?)').run(SID4, wt, 'worktree', Date.now() - 86400000, 'git worktree add', '');
        const row = d.prepare('SELECT id FROM artifacts WHERE session_id = ?').get(SID4);
        const old = new Date(Date.now() - 5 * 3600 * 1000);
        const ageAll = () => { [wt, path.join(wt, 'a'), path.join(wt, '.git')].forEach((p) => fs.utimesSync(p, old, old)); };
        fs.writeFileSync(path.join(wt, 'dirty'), 'x'); fs.utimesSync(path.join(wt, 'dirty'), old, old); ageAll();
        calls = [];
        const rd = await sup.cleanArtifact(row.id, { gr });
        assert.ok(rd.decision === 'refused' && /uncommitted/.test(rd.reason) && calls.length === 0 && fs.existsSync(wt), JSON.stringify(rd));
    });

    await test('work queue: starts supervised sessions up to the slot limit; Start Now passes it; reviews set done / waiting', async () => {
        settingsCfg.agentSupervisor = Object.assign(settingsCfg.agentSupervisor, { maxConcurrent: 1, autoStart: true });
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart;
        const realStart = launcher.start;
        const started = [];
        let n = 0;
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: { defaultModel: 'sonnet', defaultMode: 'bypassPermissions' } });
        launcher.start = async (g, o) => {
            n += 1;
            const id = `dddddddd-0000-0000-0000-00000000000${n}`;
            started.push(o);
            fs.writeFileSync(path.join(tmp, '.claude', 'sessions', `${process.pid}${n}.json`), JSON.stringify({ pid: process.pid, sessionId: id, status: 'busy', cwd: tmp }));
            return { id, state: 'connected', link: `https://claude.ai/code/session_${n}` };
        };
        try {
            sup.bind(gr);
            const a = sup.enqueue({ title: 'A', prompt: 'do A', topology: 'direct' }, { gr });
            await sup.pumpWork(gr);
            assert.strictEqual(sup.getWork(a.id).state, 'held', 'a new item waits to be started');
            sup.startWork(a.id, { now: false });
            await sup.pumpWork(gr);
            const b = sup.enqueue({ title: 'B', prompt: 'do B', topology: 'direct', hold: false }, { gr });
            await sup.pumpWork(gr);
            assert.strictEqual(sup.getWork(a.id).state, 'running');
            assert.strictEqual(sup.getWork(b.id).state, 'queued');
            assert.match(sup.getWork(b.id).message, /slot/);
            assert.ok(sup.isSupervised(sup.getWork(a.id).sessionId));
            assert.match(started[0].prompt, /supervised Fleet session/);
            assert.strictEqual(started[0].model, 'sonnet');
            sup.startWork(b.id);
            await sup.pumpWork(gr);
            assert.strictEqual(sup.getWork(b.id).state, 'running', 'Start Now passes the slot limit');
            sup.workAfterReview({ sessionId: sup.getWork(a.id).sessionId, verdict: 'gaps', missed: [{ item: 'tests' }], summary: '' });
            assert.strictEqual(sup.getWork(a.id).state, 'waiting');
            sup.workAfterReview({ sessionId: sup.getWork(a.id).sessionId, verdict: 'ok', missed: [], summary: 'all done' });
            assert.strictEqual(sup.getWork(a.id).state, 'done');
            const c = sup.enqueue({ title: 'C', prompt: 'do C', sourceRef: 'plaud:x1', source: 'plaud' }, { gr });
            assert.strictEqual(sup.enqueue({ title: 'C again', prompt: 'do C', sourceRef: 'plaud:x1', source: 'plaud' }, { gr }).id, c.id, 'one item per recording');
            assert.strictEqual(sup.cancelWork(c.id).state, 'cancelled');
            assert.strictEqual(sup.holdWork(c.id).state, 'held', 'a cancelled item goes back to waiting');
            assert.strictEqual(sup.cancelWork(c.id).state, 'cancelled');
            assert.ok(sup.summary().version > 0);
            // an agent asks over the socket
            sup.start(gr);
            await new Promise((r) => setTimeout(r, 100));
            const reply = await new Promise((resolve, reject) => {
                let buf = '';
                const sock = require('net').createConnection(process.env.AGENT_SUPERVISOR_SOCKET, () => sock.write(`${JSON.stringify({ op: 'enqueue', title: 'From an agent', prompt: 'do D' })}\n`));
                sock.on('data', (ch) => { buf += ch; }); sock.on('end', () => resolve(JSON.parse(buf))); sock.on('error', reject);
            });
            assert.ok(reply.ok && reply.work.source === 'agent' && reply.work.state === 'held', JSON.stringify(reply));
            sup.stop();
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; }
    });

    await test('Yozora tracking: an issue per item, comments on start / gaps / done, status labels, tracked time; pulled fleet issues queue; a closed issue ends its item', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart;
        const realStart = launcher.start;
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        let started = null;
        launcher.start = async (g, o) => { started = o; return { id: 'eeeeeeee-0000-0000-0000-000000000001', state: 'connected', link: 'https://claude.ai/code/session_x' }; };
        settingsCfg.agentSupervisor = Object.assign(settingsCfg.agentSupervisor, { maxConcurrent: 10, autoStart: true });
        try {
            yzCalls.length = 0;
            const w = sup.enqueue({ title: 'Tracked', prompt: 'Do it.\n\nAcceptance\n- tests pass\n- docs updated', startNow: true }, { gr });
            for (let i = 0; i < 50 && !(sup.getWork(w.id).state === 'running' && sup.getWork(w.id).issue); i += 1) await new Promise((r) => setTimeout(r, 20));
            const got = sup.getWork(w.id);
            assert.ok(got.issue && got.issue.repo === 'DreamScape/StaticForge', JSON.stringify(got));
            const created = yzCalls.find((c) => c.method === 'POST' && /\/issues$/.test(c.url));
            assert.ok(created.body.labels.includes(1), 'labelled fleet');
            assert.match(created.body.body, /## Definition of done\n\n- \[ \] tests pass\n- \[ \] docs updated/);
            assert.match(created.body.body, /<!-- fleet-work:\d+ -->/);
            assert.match(started.prompt, /tracked in Yozora DreamScape\/StaticForge#\d+/);
            for (let i = 0; i < 50 && !yzCalls.some((c) => /\/comments$/.test(c.url)); i += 1) await new Promise((r) => setTimeout(r, 20));
            assert.match(yzCalls.find((c) => /\/comments$/.test(c.url)).body.body, /started as a supervised session on Main/);
            sup.workAfterReview({ sessionId: got.sessionId, verdict: 'gaps', missed: [{ item: 'docs' }], summary: '' });
            sup.workAfterReview({ sessionId: got.sessionId, verdict: 'ok', missed: [], summary: 'all done' });
            for (let i = 0; i < 50 && !yzCalls.some((c) => /\/times$/.test(c.url)); i += 1) await new Promise((r) => setTimeout(r, 20));
            const comments = yzCalls.filter((c) => /\/comments$/.test(c.url)).map((c) => c.body.body);
            assert.ok(comments.some((t) => /sent back to the session:\n- docs/.test(t)), comments.join(' | '));
            assert.ok(comments.some((t) => /found nothing missed/.test(t)));
            assert.ok(yzCalls.some((c) => c.method === 'PUT' && /\/labels$/.test(c.url) && c.body.labels.includes(6)), 'status:done on done');
            assert.ok(yzCalls.some((c) => c.method === 'PATCH' && c.body && c.body.state === 'closed'), 'closed once the Supervisor verified it');
            // pull: an issue filed on Yozora with fleet + fleet:now
            yzIssues.set('DreamScape/StaticForge#500', { state: 'open', external: true, now: true, title: 'From Yozora', body: 'Please do X' });
            const pulled = await sup.pullIssues(gr, { force: true });
            assert.strictEqual(pulled.added, 1, 'pulled ' + JSON.stringify(pulled));
            const item = sup.listWork().find((x) => x.issue && x.issue.number === 500);
            assert.ok(item && item.source === 'yozora' && item.startNow);
            const again = await sup.pullIssues(gr, { force: true }); assert.strictEqual(again.added, 0, 'pulled once ' + JSON.stringify(again));
            // closed on Yozora: a queued one is cancelled
            settingsCfg.agentSupervisor.autoStart = false;
            const q = sup.enqueue({ title: 'Later', prompt: 'later', issueFields: { repo: 'DreamScape/StaticForge', number: 501 } }, { gr });
            await sup.pumpWork(gr);
            assert.strictEqual(sup.getWork(q.id).state, 'held');
            yzIssues.set('DreamScape/StaticForge#501', { state: 'closed' });
            await sup.pullIssues(gr, { force: true });
            assert.strictEqual(sup.getWork(q.id).state, 'cancelled', 'closed ' + JSON.stringify(sup.getWork(q.id)));
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; settingsCfg.agentSupervisor.autoStart = true; }
    });

    await test('pause: hold types PAUSE and records it; freeze stops the process tree (SIGSTOP) and resume continues it', async () => {
        const realSteer = launcher.steer;
        const realInt = launcher.interrupt;
        const typed = [];
        launcher.steer = async (id, t) => { typed.push(t); return { sent: true }; };
        launcher.interrupt = async () => ({ interrupted: true });
        const child = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        const SIDP = 'ffffffff-1111-2222-3333-444444444444';
        const rec = path.join(tmp, '.claude', 'sessions', `${child.pid}.json`);
        fs.writeFileSync(rec, JSON.stringify({ pid: child.pid, sessionId: SIDP, status: 'busy', cwd: tmp }));
        const stateOf = () => fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(') ')[1][0];
        try {
            await sup.pauseSession(SIDP, { mode: 'hold', reason: 'merging' });
            assert.match(typed[0], /PAUSE \(Fleet\): merging/);
            assert.strictEqual(sup.listHolds()[0].mode, 'hold');
            await assert.rejects(sup.pauseSession(SIDP, {}), /paused already/);
            await sup.resumeSession(SIDP);
            assert.match(typed[1], /RESUME/);
            await sup.pauseSession(SIDP, { mode: 'freeze', reason: 'collision' });
            await new Promise((r) => setTimeout(r, 100));
            assert.strictEqual(stateOf(), 'T', 'stopped');
            await sup.resumeSession(SIDP);
            await new Promise((r) => setTimeout(r, 100));
            assert.notStrictEqual(stateOf(), 'T', 'running again');
        } finally { child.kill('SIGKILL'); fs.rmSync(rec, { force: true }); launcher.steer = realSteer; launcher.interrupt = realInt; }
    });

    await test('fan-out: auto plans first (a planner reports its shape); surfaces splits into child items and the parent settles; planner gets the stage models', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart;
        const realStart = launcher.start;
        const starts = [];
        let n = 0;
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        launcher.start = async (g, o) => { n += 1; starts.push(o); return { id: `aaaaaaaa-0000-0000-0000-0000000001${String(n).padStart(2, '0')}`, state: 'connected', link: '' }; };
        const replies = [];
        sup._test.setFetch(async (url, opts) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(replies.shift() || { verdict: 'ok', missed: [] }) } }] }) }));
        settingsCfg.agentSupervisor = Object.assign(settingsCfg.agentSupervisor, { maxConcurrent: 10, autoStart: true });
        try {
            const p = sup.enqueue({ title: 'Plan it', prompt: 'big feature', topology: 'planner', stages: { planner: { model: 'fable', effort: 'xhigh' }, workers: { model: 'haiku', effort: 'low' } }, startNow: true }, { gr });
            await sup.pumpWork(gr);
            const ps = starts.find((o) => o.title === 'Plan it');
            assert.deepStrictEqual([ps.model, ps.effort], ['fable', 'xhigh']);
            assert.match(ps.prompt, /You are the PLANNER/);
            assert.match(ps.prompt, /model "haiku" and effort "low"/);
            // auto: plan first. ONE planner session starts (no model call guesses a shape); it reports the shape with fleet_work_shape
            const nReplies = replies.length;
            const a = sup.enqueue({ title: 'Auto', prompt: 'tiny fix', topology: 'auto', startNow: true }, { gr });
            await sup.pumpWork(gr);
            const as = starts.find((o) => o.title === 'Auto');
            assert.match(as.prompt, /You are the PLANNER for Fleet work item/);
            assert.match(as.prompt, /fleet_work_shape/);
            assert.ok(as.prompt.includes(`id: ${a.id}`), 'the item id is in its prompt');
            assert.strictEqual(sup.getWork(a.id).topology, 'auto', 'until the planner reports, the shape is open');
            assert.match(sup.getWork(a.id).message, /^Planning/);
            assert.strictEqual(replies.length, nReplies);
            await assert.rejects(sup.shapeWork(a.id, { sessionId: 'someone-else', topology: 'direct' }), /not this session's/);
            await assert.rejects(sup.shapeWork(a.id, { sessionId: sup.getWork(a.id).sessionId, topology: 'bogus' }), /topology is/);
            const sd = await sup.shapeWork(a.id, { sessionId: sup.getWork(a.id).sessionId, topology: 'direct', reason: 'one file' });
            assert.strictEqual(sd.item.topology, 'direct');
            assert.match(sd.item.message, /Planned: direct - one file/);
            await assert.rejects(sup.shapeWork(a.id, { sessionId: sup.getWork(a.id).sessionId, topology: 'planner' }), /already has its shape/);
            // an auto item whose planner picks surfaces: parts become child items (parentId); the parent stays open until they end
            const b = sup.enqueue({ title: 'AutoSplit', prompt: 'server and ui', topology: 'auto', startNow: true }, { gr });
            await sup.pumpWork(gr);
            const bsid = sup.getWork(b.id).sessionId;
            const sb = await sup.shapeWork(b.id, { sessionId: bsid, topology: 'surfaces', reason: 'independent', parts: [{ title: 'Srv', surface: 'server', paths: ['modules/q.js'], brief: 'srv brief' }, { title: 'Ui', surface: 'ui', paths: ['apps/q'], brief: 'ui brief' }] });
            assert.strictEqual(sb.parts, 2);
            const bk = sup.listWork().filter((x) => x.parentId === b.id);
            assert.strictEqual(bk.length, 2);
            assert.ok(bk.every((k) => k.topology === 'direct'));
            assert.deepStrictEqual(sup.workTree({ id: bk[0].id }).items.map((x) => x.id).sort((x, y) => x - y), [b.id, bk[0].id, bk[1].id].sort((x, y) => x - y), 'the tree climbs to the top item');
            assert.strictEqual(sup.workTree({ sessionId: bsid }).root.id, b.id);
            sup.workAfterReview({ sessionId: bsid, verdict: 'ok', missed: [], summary: 'planner turn' });
            assert.strictEqual(sup.getWork(b.id).state, 'running', 'its parts are still open');
            await sup.pumpWork(gr);
            await sup.pumpWork(gr);
            assert.ok(starts.some((o) => /AutoSplit: Srv/.test(o.title)), 'the parts start as sessions');
            replies.push({ parts: [{ title: 'Server', surface: 'server', paths: ['modules/x.js'], brief: 'do server' }, { title: 'Desktop', surface: 'desktop', paths: ['apps/y'], brief: 'do desktop' }] });
            const sp = sup.enqueue({ title: 'Split', prompt: 'server and desktop', topology: 'surfaces', startNow: true }, { gr });
            await sup.pumpWork(gr);
            await sup.pumpWork(gr);
            const kids = sup.listWork().filter((x) => x.parentId === sp.id);
            assert.strictEqual(kids.length, 2);
            assert.ok(kids.every((k) => k.topology === 'direct'));
            assert.match(starts.find((o) => /Split: Server/.test(o.title)).prompt, /You own modules\/x\.js/);
            kids.forEach((k) => { const w = sup.getWork(k.id); if (w.sessionId) sup.workAfterReview({ sessionId: w.sessionId, verdict: 'ok', missed: [], summary: 'ok' }); });
            assert.strictEqual(sup.getWork(sp.id).state, 'done', JSON.stringify(sup.getWork(sp.id)));
            assert.ok(p);
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; }
    });

    await test('spend: calls recorded with tokens and cost; out of funds fails over to the next engine and says so', async () => {
        const g2 = Object.assign({}, gr, { getConfig: () => ({ agentSupervisor: { enabled: true, engine: 'tokenrouter', fallbackEngines: [{ engine: 'tokenrouter', model: 'cheap/fallback-model' }] } }) });
        const calls2 = [];
        sup._test.setFetch(async (url, opts) => {
            calls2.push(JSON.parse(opts.body).model);
            if (calls2.length === 1) return { ok: false, status: 402, text: async () => '{"error":"Insufficient balance, top up"}' };
            return { ok: true, status: 200, text: async () => JSON.stringify({ usage: { prompt_tokens: 1200, completion_tokens: 80, cost: 0.0021 }, choices: [{ message: { content: '{"verdict":"ok","missed":[]}' } }] }) };
        });
        // the fallback "engine" resolves like TokenRouter (only its name differs in the chain)
        const r = await sup.callEngine(g2, [{ role: 'user', content: 'x' }], { kind: 'review' });
        assert.deepStrictEqual(calls2, ['deepseek/deepseek-v4.1-flash', 'cheap/fallback-model']);
        assert.strictEqual(r.failedOverFrom, 'tokenrouter');
        const sp = await sup.spend(g2);
        const today = sp.windows.today;
        assert.ok(today.some((x) => x.calls >= 1), JSON.stringify(today));
        const refused = require('../modules/agentCoord/store').open().prepare("SELECT COUNT(*) n FROM supervisor_usage WHERE ok = 0 AND error LIKE '%402%'").get().n;
        assert.ok(refused >= 1, 'the refusal is recorded');
        assert.ok(sp.failovers.length >= 1 && sp.failovers[0].fromEngine === 'tokenrouter', JSON.stringify(sp.failovers));
        assert.ok(today.some((x) => x.cost > 0.002), 'cost summed');
    });

    await test('spend: a call TokenRouter sends no cost for is priced from the catalog (per million tokens)', async () => {
        const f = path.join(os.tmpdir(), `ds-sup-catalog-${process.pid}.json`);
        fs.writeFileSync(f, JSON.stringify({ at: Date.now(), families: [{ id: 'cat/model-x', input: 0.15, output: 0.6 }] }));
        process.env.DREAMSCAPE_TOKENROUTER_CATALOG = f;
        sup._test.resetPrices();
        try {
            const c = sup.priceCall('tokenrouter', 'cat/model-x', 1000000, 500000);
            assert.ok(Math.abs(c - 0.45) < 1e-9, String(c));
            assert.strictEqual(sup.priceCall('tokenrouter', 'cat/unknown', 10, 10), null);
            assert.strictEqual(sup.priceCall('other', 'cat/model-x', 10, 10), null);
        } finally { delete process.env.DREAMSCAPE_TOKENROUTER_CATALOG; sup._test.resetPrices(); fs.rmSync(f, { force: true }); }
    });

    await test('rules review: file checks + stubbed engine findings stored, pushed, dismissable; one run at a time', async () => {
        const rd = path.join(tmp, 'repo');
        fs.mkdirSync(path.join(rd, '.cursor', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(rd, '.cursor', 'rules', 'alpha.mdc'), '---\ndescription: Alpha rule\nalwaysApply: true\n---\nRun `scripts/gone.js` first. Also `scripts/here.js`.\n');
        fs.writeFileSync(path.join(rd, '.cursor', 'rules', 'beta.mdc'), '---\ndescription: Beta rule\n---\nNever run scripts/here.js.\n');
        fs.writeFileSync(path.join(rd, '.cursor', 'rules', 'jp.mdc'), '---\ndescription: Japanese\n---\n' + '\u3053\u3093\u306b\u3061\u306f'.repeat(8) + '\n');
        fs.mkdirSync(path.join(rd, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(rd, 'scripts', 'here.js'), '');
        fs.writeFileSync(path.join(rd, 'CLAUDE.md'), '# x\n@.cursor/rules/alpha.mdc\n@.cursor/rules/ghost.mdc\n\n## Rules on demand\n\n| Rule | Read it when |\n| --- | --- |\n| `.cursor/rules/jp.mdc` | testing |\n| `.cursor/rules/phantom.mdc` | never |\n');
        const g3 = Object.assign({}, gr, { getConfig: () => ({ agentSupervisor: { enabled: true, engine: 'tokenrouter' } }) });
        let prompts = 0; let release;
        const gate = new Promise((r) => { release = r; });
        sup._test.setFetch(async (url, opts) => {
            prompts += 1;
            await gate;
            const content = JSON.stringify({ findings: [{ rules: ['alpha', 'beta'], kind: 'contradiction', severity: 'high', text: 'alpha says run here.js, beta says never.', suggestion: 'Pick one.' }, { rules: ['nope'], kind: 'duplicate', severity: 'low', text: 'dup', suggestion: 'merge' }] });
            return { ok: true, status: 200, text: async () => JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0001 }, choices: [{ message: { content } }] }) };
        });
        let pushes = 0;
        const off = sup.onReview(() => { pushes += 1; });
        const opts = { repo: rd };
        const run = sup.reviewRules(g3, opts);
        await assert.rejects(() => sup.reviewRules(g3, opts), /already running/);
        assert.ok(sup.rulesState(opts).running, 'running state is visible');
        release();
        const rv = await run;
        off();
        assert.ok(pushes >= 3, `status pushed (${pushes})`);
        assert.strictEqual(prompts, 1);
        const kinds = rv.findings.map((f) => f.kind);
        ['missing-file', 'missing-import', 'outdated-reference', 'not-english', 'contradiction', 'duplicate'].forEach((k) => assert.ok(kinds.includes(k), `${k} in ${kinds}`));
        assert.ok(!rv.findings.some((f) => /here\.js`, which/.test(f.text)), 'an existing file is not flagged');
        const miss = rv.findings.filter((f) => f.kind === 'missing-import').map((f) => f.rules[0]);
        assert.deepStrictEqual(miss, ['beta'], 'a rule in the Rules on demand table counts as listed');
        assert.ok(rv.findings.some((f) => f.kind === 'missing-file' && /phantom/.test(f.text)), 'a table row naming a missing file is flagged');
        assert.ok(rv.findings.some((f) => f.kind === 'outdated-reference' && /scripts\/gone\.js/.test(f.text)));
        assert.ok(rv.model && rv.ruleCount === 3);
        const st = sup.rulesState(opts);
        assert.strictEqual(st.running, null);
        assert.strictEqual(st.last.id, rv.id);
        assert.deepStrictEqual(st.rules.map((r) => r.name), ['alpha', 'beta', 'jp']);
        assert.strictEqual(st.rules[0].description, 'Alpha rule');
        assert.ok(/gone\.js/.test(sup.ruleText('alpha', opts).text));
        const id = rv.findings[0].id;
        assert.strictEqual(sup.dismissRuleFinding(id).findings.find((f) => f.id === id).dismissed, true);
        assert.throws(() => sup.dismissRuleFinding('999'), /No such finding/);
        // an engine failure keeps the file checks and records the error
        sup._test.setFetch(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
        const bad = await sup.reviewRules(g3, opts);
        assert.ok(bad.error && bad.findings.some((f) => f.kind === 'missing-file'));
    });

    await test('sizePlanner: opus / high by default, opus / xhigh large, fable / xhigh very large or hard, max on a retry', async () => {
        const w = { prompt: 'Build it.' };
        sup._test.setFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }));
        const g4 = Object.assign({}, gr, { getConfig: () => ({ agentSupervisor: { enabled: true, engine: 'tokenrouter' } }) });
        answer = { size: 'normal', hard: false, retry: false, reason: 'small' };
        let z = await sup.sizePlanner(g4, w); assert.deepStrictEqual([z.model, z.effort], ['opus', 'high'], JSON.stringify(z));
        answer = { size: 'large', hard: false, retry: false, reason: 'many files' };
        z = await sup.sizePlanner(g4, w); assert.deepStrictEqual([z.model, z.effort], ['opus', 'xhigh'], JSON.stringify(z));
        answer = { size: 'very_large', hard: false, retry: false, reason: 'surfaces' };
        z = await sup.sizePlanner(g4, w); assert.deepStrictEqual([z.model, z.effort], ['fable', 'xhigh'], JSON.stringify(z));
        answer = { size: 'normal', hard: true, retry: true, reason: 'failed before' };
        z = await sup.sizePlanner(g4, w); assert.deepStrictEqual([z.model, z.effort], ['fable', 'max'], JSON.stringify(z));
        // the model policy: defaults are the rule's table, a changed maximum caps the pick, junk is validated away
        const pol = sup.settings(g4).modelPolicy;
        assert.deepStrictEqual([pol.plan.model, pol.plan.effort, pol.huge.model, pol.part.effort], ['opus', 'high', 'fable', 'medium']);
        const clean = sup.cleanPolicy({ plan: { model: 'gpt', effort: 'xhigh', maxModel: 'opus', maxEffort: 'medium' }, huge: 5 });
        assert.deepStrictEqual([clean.plan.model, clean.plan.effort, clean.plan.maxEffort, clean.huge.model], ['opus', 'medium', 'medium', 'fable'], 'bad model falls back, a default above its maximum is cut down');
        const g5 = Object.assign({}, gr, { getConfig: () => ({ agentSupervisor: { enabled: true, engine: 'tokenrouter', modelPolicy: { large: { model: 'opus', effort: 'xhigh', maxModel: 'opus', maxEffort: 'high' }, huge: { model: 'opus', effort: 'high', maxModel: 'opus', maxEffort: 'high' } } } }) });
        answer = { size: 'large', hard: false, retry: false, reason: 'many files' };
        z = await sup.sizePlanner(g5, w); assert.deepStrictEqual([z.model, z.effort], ['opus', 'high'], 'the row maximum caps xhigh: ' + JSON.stringify(z));
        answer = { size: 'very_large', hard: false, retry: false, reason: 'surfaces' };
        z = await sup.sizePlanner(g5, w); assert.deepStrictEqual([z.model, z.effort], ['opus', 'high'], JSON.stringify(z));
        assert.deepStrictEqual(sup.capToPolicy('part', 'fable', 'max', g4), { model: 'sonnet', effort: 'high' });
        assert.strictEqual(sup.policyFor('part', g4).effort, 'medium');
        assert.strictEqual(sup.cleanStages({}).planner.auto, true, 'nobody picked: the Supervisor sizes it');
        assert.strictEqual(sup.cleanStages({ planner: { model: 'opus', effort: 'high' } }).planner.auto, false, 'a picked planner stays');
    });

    await test('updateWork: only items that are not running; validated as enqueue; a changed brief is commented on its issue and clears the check', async () => {
        const w = sup.enqueue({ title: 'Edit me', prompt: 'old brief', source: 'yozora', issueFields: { repo: 'DreamScape/StaticForge', number: 601 } });
        const store = require('../modules/agentCoord/store');
        store.open().prepare('UPDATE supervisor_work SET check_json = ? WHERE id = ?').run(JSON.stringify({ verdict: 'outdated', suggestedBrief: 'x', at: 1 }), w.id);
        assert.strictEqual(sup.getWork(w.id).check.verdict, 'outdated');
        const before = yzCalls.length;
        const u = sup.updateWork(w.id, { prompt: 'new brief', title: '  New   title ', topology: 'direct', stages: { workers: { effort: 'low' } }, account: 'auto', effort: 'high' });
        assert.strictEqual(u.title, 'New title');
        assert.strictEqual(sup.workPrompt(w.id), 'new brief');
        assert.strictEqual(u.topology, 'direct');
        assert.strictEqual(u.stages.workers.effort, 'low');
        assert.strictEqual(u.stages.workers.model, 'sonnet', 'a partial stage keeps the rest');
        assert.strictEqual(u.check, null, 'the check was about the old brief');
        await new Promise((r) => setTimeout(r, 50));
        assert.ok(yzCalls.slice(before).some((c) => c.method === 'POST' && /issues\/601\/comments/.test(c.url) && /Brief updated by Yozora: new brief/.test(c.body.body)));
        const n = yzCalls.length;
        sup.updateWork(w.id, { model: 'haiku' });
        await new Promise((r) => setTimeout(r, 30));
        assert.strictEqual(yzCalls.length, n, 'no brief change, no comment');
        assert.strictEqual(sup.updateWork(w.id, { appendNote: 'More.' }).prompt, 'new brief\n\nMore.');
        assert.throws(() => sup.updateWork(w.id, { prompt: '  ' }), /needs a prompt/);
        assert.throws(() => sup.updateWork(w.id, { prompt: 'x'.repeat(60001) }), /too long/);
        assert.throws(() => sup.updateWork(w.id, { topology: 'weird' }), /topology is one of/);
        assert.throws(() => sup.updateWork(w.id, { effort: 'ultra' }), /effort is/);
        assert.throws(() => sup.updateWork(w.id, { title: ' ' }), /needs a title/);
        assert.throws(() => sup.updateWork(99999, { title: 'x' }), /No such work item/);
        store.open().prepare("UPDATE supervisor_work SET state = 'running' WHERE id = ?").run(w.id);
        assert.throws(() => sup.updateWork(w.id, { title: 'x' }), /running/);
        store.open().prepare("UPDATE supervisor_work SET state = 'held' WHERE id = ?").run(w.id);
    });

    await test('fleet_* socket ops: read views for every agent; update / hold / cancel only the caller\'s own items; no start op', async () => {
        const net = require('net');
        const ask = (req) => new Promise((resolve, reject) => {
            let buf = '';
            const sk = net.createConnection(process.env.AGENT_SUPERVISOR_SOCKET, () => sk.write(`${JSON.stringify(req)}\n`));
            sk.on('data', (c) => { buf += c; }); sk.on('end', () => resolve(JSON.parse(buf))); sk.on('error', reject);
        });
        sup.start(gr);
        await new Promise((r) => setTimeout(r, 100));
        try {
            const mine = sup.enqueue({ title: 'Mine', prompt: 'my brief', source: 'agent', sourceRef: 'agent:claude-aaaa1111#1' });
            const theirs = sup.enqueue({ title: 'Theirs', prompt: 'their brief', source: 'agent', sourceRef: 'agent:claude-bbbb2222#1' });
            const yoz = sup.enqueue({ title: 'Yozora one', prompt: 'y', source: 'yozora', sourceRef: 'issue:x/y#9' });
            const l = await ask({ op: 'fleet_work_list', state: 'held', search: 'brief', limit: 5 });
            assert.ok(l.ok && l.result.work.some((w) => w.id === mine.id && w.state === 'Waiting'), JSON.stringify(l));
            const g = await ask({ op: 'fleet_work_get', id: mine.id });
            assert.ok(g.ok && g.result.brief === 'my brief');
            const u = await ask({ op: 'fleet_work_update', id: mine.id, by: 'claude-aaaa1111', appendNote: 'More.' });
            assert.ok(u.ok && sup.workPrompt(mine.id) === 'my brief\n\nMore.', JSON.stringify(u));
            const denied = await ask({ op: 'fleet_work_update', id: theirs.id, by: 'claude-aaaa1111', title: 'hijack' });
            assert.ok(!denied.ok && /not queued by you/.test(denied.error));
            assert.ok(!(await ask({ op: 'fleet_work_cancel', id: yoz.id, by: 'claude-aaaa1111' })).ok);
            assert.ok(!(await ask({ op: 'fleet_work_cancel', id: mine.id })).ok, 'no caller id, no change');
            assert.ok(!(await ask({ op: 'fleet_work_start', id: mine.id, by: 'claude-aaaa1111' })).ok, 'agents start nothing');
            const h = await ask({ op: 'fleet_work_hold', id: mine.id, by: 'claude-aaaa1111' });
            assert.ok(h.ok && h.result.item.state === 'Waiting');
            const c = await ask({ op: 'fleet_work_cancel', id: mine.id, by: 'claude-aaaa1111', reason: 'outdated' });
            assert.ok(c.ok && c.result.item.state === 'Cancelled' && /outdated/.test(sup.getWork(mine.id).message), JSON.stringify(c));
            const m = await ask({ op: 'fleet_maintenance_report' });
            assert.ok(m.ok && m.result.run === null || m.result.checks, JSON.stringify(m));
            const st = await ask({ op: 'fleet_status' }); // the sandbox's fake resources lack the account host: the op must still be routed
            assert.ok(st.ok || !/op must be/.test(st.error), JSON.stringify(st).slice(0, 300));
        } finally { sup.stop(); }
    });

    require('../modules/agentCoord/store').close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
