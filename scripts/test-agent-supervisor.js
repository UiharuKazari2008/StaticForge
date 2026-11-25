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
process.env.AGENT_SUPERVISOR_BG_PER_MIN = '100000';
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
        const rcall = calls.find((c) => /## Request/.test(c.body.messages[1].content)); // (the user's list is read first: its own call)
        assert.match(rcall.body.messages[1].content, /## Request\nNow add a test/); // only the new turn (offset kept)
        assert.doesNotMatch(rcall.body.messages[1].content.split("## The user's list")[0], /README/); // (the list holds the earlier ask)
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

    await test('rules review: memory findings; explain -> proposal; accept queues a held item or steers the Manager Session; reject keeps the reason', async () => {
        const rd = path.join(tmp, 'repo2');
        fs.mkdirSync(path.join(rd, '.cursor', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(rd, '.cursor', 'rules', 'alpha.mdc'), '---\ndescription: Alpha rule\nalwaysApply: true\n---\nNever restart the server.\n');
        fs.writeFileSync(path.join(rd, 'CLAUDE.md'), '# x\n@.cursor/rules/alpha.mdc\n');
        const opts = { repo: rd, memories: [
            { id: 11, title: 'Yukimi: always answer short', kind: 'preference', scope: 'global', pinned: true, body: 'Short answers.' },
            { id: 12, title: 'Do not restart', kind: 'lesson', scope: 'global', body: 'Never restart the server while testing.' },
            { id: 13, title: 'Old build host', kind: 'fact', scope: 'global', body: 'Builds run on Ruiko1.' }
        ] };
        const g5 = Object.assign({}, gr, { getConfig: () => ({ agentSupervisor: { enabled: true, engine: 'tokenrouter' } }) });
        let memPrompt = '';
        const reply = (content) => ({ ok: true, status: 200, text: async () => JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 }, choices: [{ message: { content: JSON.stringify(content) } }] }) });
        sup._test.setFetch(async (url, o) => {
            const msgs = JSON.parse(o.body).messages;
            const sys = msgs[0].content; const user = msgs[1].content;
            if (/audit the written rules/.test(sys)) return reply({ findings: [] });
            if (/review the shared memory/.test(sys)) {
                memPrompt = user;
                return reply({ findings: [
                    { memoryId: 11, kind: 'memory-to-rule', rule: 'new', text: 'A standing preference.', draft: { mode: 'new', rule: 'Short Answers', description: 'Answer in a few lines.', alwaysApply: true, text: '# Short answers\n\nAnswer in a few lines.' } },
                    { memoryId: 12, kind: 'memory-duplicate', rule: 'alpha', text: 'alpha says it already.' },
                    { memoryId: 13, kind: 'memory-outdated', text: 'Ruiko1 is gone.' },
                    { memoryId: 99, kind: 'memory-outdated', text: 'unknown memory is dropped' }
                ] });
            }
            if (/Yukimi keep the written rules/.test(sys)) return reply({ verdict: 'new-rule', title: 'No server restarts while testing', reasoning: 'Alpha forbids restarts but only for the server, not tests.', rules: ['alpha'], draft: { file: 'no-restart-while-testing', description: 'Do not restart.', alwaysApply: false, trigger: 'before any restart', text: '# No restart\n\nDo not restart while Yukimi tests.' } });
            return reply({});
        });
        const rv = await sup.reviewRules(g5, opts);
        assert.ok(/\[preference, global, pinned\] Yukimi: always answer short/.test(memPrompt) && memPrompt.indexOf('#11') < memPrompt.indexOf('#12'), 'memories are given, pinned first');
        const mf = rv.findings.filter((f) => /^memory-/.test(f.kind));
        assert.deepStrictEqual(mf.map((f) => [f.kind, f.memoryId]), [['memory-to-rule', 11], ['memory-duplicate', 12], ['memory-outdated', 13]]);
        const toRule = mf[0];
        assert.strictEqual(toRule.draft.kind, 'new-rule'); assert.strictEqual(toRule.draft.file, 'short-answers.mdc'); assert.strictEqual(toRule.draft.alwaysApply, true);
        assert.deepStrictEqual(mf[1].rules, ['alpha']);
        // an explanation becomes a draft proposal with her words and the reasoning
        const p = await sup.explainRuleIssue(g5, 'agents keep restarting the server while I test', opts);
        assert.strictEqual(p.status, 'draft'); assert.strictEqual(p.draft.kind, 'new-rule'); assert.strictEqual(p.draft.file, 'no-restart-while-testing.mdc');
        assert.ok(/restarting the server/.test(p.input) && /Alpha forbids/.test(p.reasoning));
        assert.ok(sup.rulesState(opts).proposals.some((x) => x.id === p.id));
        await assert.rejects(() => sup.explainRuleIssue(g5, '   ', opts), /Describe/);
        // accept queues a held item with the edited draft; the engine is not called again
        const a = await sup.acceptRuleProposal(g5, p.id, { text: '# No restart\n\nEdited text.' }, opts);
        assert.strictEqual(a.status, 'accepted'); assert.strictEqual(a.how, 'work');
        const w = sup.getWork(a.workId);
        assert.strictEqual(w.state, 'held'); assert.strictEqual(w.title, `Apply rule proposal #${p.id}`);
        assert.ok(/Edited text\./.test(w.prompt) && /no-restart-while-testing\.mdc/.test(w.prompt) && /Rules on demand/.test(w.prompt) && /English/.test(w.prompt) && /cursor-rules/.test(w.prompt));
        await assert.rejects(() => sup.acceptRuleProposal(g5, p.id, {}, opts), /already accepted/);
        // with a Manager Session it is steered there instead
        const mgrId = '11111111-2222-3333-4444-555555555555';
        const g6 = Object.assign({}, gr, { getConfig: () => ({ agentSupervisor: { enabled: true, engine: 'tokenrouter', managerSessionId: mgrId } }) });
        const steered = []; const realSteer = launcher.steer;
        launcher.steer = async (id, text) => { steered.push([id, text]); };
        try {
            const p2 = await sup.explainRuleIssue(g6, 'second problem', opts);
            const a2 = await sup.acceptRuleProposal(g6, p2.id, {}, opts);
            assert.strictEqual(a2.how, 'manager'); assert.strictEqual(a2.workId, null);
            assert.strictEqual(steered.length, 1); assert.strictEqual(steered[0][0], mgrId); assert.ok(/Apply rule proposal #/.test(steered[0][1]));
            // a finding's Accept... makes its own accepted proposal and marks the finding done
            const fa = await sup.acceptRuleFinding(g6, toRule.id, { text: 'Answer in a few lines. Edited.' }, opts);
            assert.strictEqual(fa.status, 'accepted'); assert.strictEqual(fa.memoryId, 11);
            assert.ok(/Edited\./.test(steered[1][1]) && /short-answers\.mdc/.test(steered[1][1]));
            assert.strictEqual(sup.rulesState(opts).last.findings.find((f) => f.id === toRule.id).dismissed, true);
        } finally { launcher.steer = realSteer; }
        // reject keeps the reason
        const p3 = await sup.explainRuleIssue(g5, 'third', opts);
        const r3 = sup.rejectRuleProposal(p3.id, 'Not a rule, a one-off');
        assert.strictEqual(r3.status, 'rejected'); assert.strictEqual(r3.reason, 'Not a rule, a one-off');
        assert.throws(() => sup.rejectRuleProposal(p3.id, ''), /already rejected/);
        // a memory already accepted or rejected is not offered again
        let again = '';
        sup._test.setFetch(async (u, o) => { const m = JSON.parse(o.body).messages; if (/review the shared memory/.test(m[0].content)) again = m[1].content; return reply({ findings: [] }); });
        await sup.reviewRules(g5, opts);
        assert.ok(!/#11 /.test(again) && /#12 /.test(again), 'a decided memory is skipped');
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

    // ---- task lists and titles (modules/sessionTasks.js) ----
    const SID2 = 'bbbbbbbb-1111-2222-3333-444444444444';
    const file2 = path.join(tmp, '.claude', 'projects', '-repo', `${SID2}.jsonl`);
    const steerLine = (text, ts) => line({ type: 'attachment', uuid: `q${ts}`, timestamp: ts, attachment: { type: 'queued_command', commandMode: 'prompt', origin: { kind: 'human' }, prompt: text } });
    const toolResult = (ts) => line({ type: 'user', uuid: `r${ts}`, timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Fix the footer please (a file said so)' }] } });
    const engineCalls = [];
    let titleN = 0;
    const route = async (url, opts) => {
        const b = JSON.parse(opts.body);
        const sys = b.messages[0].content;
        const usr = b.messages[1].content;
        engineCalls.push({ sys, usr, max: b.max_tokens });
        let out;
        if (/checklist/.test(sys)) {
            const msgs = (usr.split('## New message(s)')[1] || '').replace(/^[^\n]*\n/, '').split(/\n\n(?=\d+\. )/).map((x) => x.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean);
            out = { items: msgs.flatMap((m, i) => m.split(' and ').map((t) => ({ text: t.trim(), msg: i + 1 }))), drop: /Forget the header/.test(usr) ? [Number((/#(\d+) \[ \] Fix the header/.exec(usr) || [])[1])] : [] };
        } else if (/^Title these coding requests/.test(sys)) out = { title: `Title number ${++titleN} for the session that is far too long to fit in the sixty characters allowed` };
        else if (/Supervisor for coding agents/.test(sys)) out = answer;
        else out = {};
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }) };
    };
    const T = sup.sessionTasks();
    await test('task list: new human and steering messages become asks (not Supervisor notes or tool results), one engine call per batch, incremental', async () => {
        sup._test.setFetch(route);
        settingsCfg.agentSupervisor.enabled = true;
        sup.bind(gr);
        fs.writeFileSync(file2, user('Fix the header and add a footer', '2026-11-24T11:00:00Z') + toolResult('2026-11-24T11:00:05Z') + asst([{ type: 'text', text: 'On it.' }], '2026-11-24T11:00:10Z')
            + user('[Supervisor] Your last turn may have left these unaddressed: (1) x', '2026-11-24T11:00:20Z') + steerLine('also make the logo blue', '2026-11-24T11:00:30Z'));
        const l = await T.sync(SID2);
        assert.deepStrictEqual(l.asks.map((a) => a.text), ['Fix the header', 'add a footer', 'also make the logo blue'], JSON.stringify(l.asks));
        assert.strictEqual(engineCalls.filter((c) => /checklist/.test(c.sys)).length, 1, 'one call for the whole first batch');
        assert.ok(engineCalls.find((c) => /checklist/.test(c.sys)).max <= 1000, 'small budget');
        assert.ok(!engineCalls.some((c) => /Supervisor\] Your last turn|a file said so/.test(c.usr)), 'notes and tool results are not asks');
        assert.strictEqual(l.counts.asksTotal, 3);
        const n = engineCalls.length;
        assert.strictEqual(await T.sync(SID2), null, 'nothing new: nothing read, no call');
        assert.strictEqual(engineCalls.length, n);
        fs.appendFileSync(file2, steerLine('Forget the header, do the sidebar', '2026-11-24T11:01:00Z'));
        const l2 = await T.sync(SID2);
        assert.ok(l2.asks.some((a) => a.text === 'do the sidebar') || l2.asks.some((a) => /sidebar/.test(a.text)), JSON.stringify(l2.asks));
        assert.ok(!l2.asks.some((a) => a.text === 'Fix the header'), 'a replaced ask is dropped');
        assert.ok(l2.asks.every((a) => a.sourceAt != null));
    });

    await test('task list: the agent ticks an ask with evidence, the user unticks, edits, removes; push on every change', async () => {
        const seen = [];
        const off = T.onChange((sid) => seen.push(sid));
        const l = T.list(SID2);
        const a = l.asks.find((x) => x.text === 'add a footer');
        const u = T.update(a.id, { done: true, evidence: 'ran the page, footer shows' }, 'agent');
        assert.ok(u.done && u.doneBy === 'agent' && u.evidence === 'ran the page, footer shows');
        const un = T.update(a.id, { done: false }, 'user');
        assert.ok(!un.done && un.evidence === '');
        assert.strictEqual(T.update(a.id, { text: 'add a green footer' }, 'user').text, 'add a green footer');
        T.remove(a.id);
        assert.ok(!T.list(SID2).asks.some((x) => x.id === a.id));
        assert.ok(seen.length >= 4 && seen.every((x) => x === SID2));
        off();
    });

    await test('titles: a Supervisor title on the first human message and then after every 5 more; none when the session has its own custom title; a Fleet name beats all', async () => {
        const SID3 = 'cccccccc-1111-2222-3333-444444444444';
        const file3 = path.join(tmp, '.claude', 'projects', '-repo', `${SID3}.jsonl`);
        fs.writeFileSync(file3, user('Make the login faster', '2026-11-24T12:00:00Z'));
        titleN = 0;
        await T.sync(SID3);
        assert.strictEqual(titleN, 1);
        const t1 = T.titleFor(SID3);
        assert.ok(t1 && t1.length <= 60, t1);
        assert.strictEqual(require('../modules/claudeSessions').titleOf(SID3, null, { title: 'Claude\'s own very long title', firstPrompt: 'Make the login faster' }), t1);
        for (let i = 2; i <= 5; i += 1) { fs.appendFileSync(file3, user(`message ${i}`, `2026-11-24T12:0${i}:00Z`)); await T.sync(SID3); }
        assert.strictEqual(titleN, 1, 'four more messages: no new title yet');
        fs.appendFileSync(file3, user('message 6', '2026-11-24T12:09:00Z'));
        await T.sync(SID3);
        assert.strictEqual(titleN, 2, 'the 5th more message writes the next title');
        assert.notStrictEqual(T.titleFor(SID3), t1);
        assert.strictEqual(T.setName(SID3, 'My own name'), 'My own name');
        for (let i = 7; i <= 12; i += 1) fs.appendFileSync(file3, user(`message ${i}`, `2026-11-24T13:0${i % 10}:00Z`));
        await T.sync(SID3);
        assert.strictEqual(titleN, 2, 'a Fleet-side name is kept');
        assert.strictEqual(require('../modules/claudeSessions').titleOf(SID3, { givenName: 'x' }, null), 'My own name');
        assert.strictEqual(T.setName(SID3, ''), '');
        // a session with its own custom-title entry: the Supervisor writes none
        const SID4 = 'dddddddd-1111-2222-3333-444444444444';
        fs.writeFileSync(path.join(tmp, '.claude', 'projects', '-repo', `${SID4}.jsonl`), line({ type: 'custom-title', customTitle: 'Mine', sessionId: SID4 }) + user('Do a thing', '2026-11-24T14:00:00Z'));
        titleN = 0;
        await T.sync(SID4);
        assert.strictEqual(titleN, 0);
        assert.strictEqual(T.titleFor(SID4), '');
        assert.strictEqual(require('../modules/claudeSessions').titleOf(SID4, null, { title: 'Mine', titleKind: 'custom', firstPrompt: 'Do a thing' }), 'Mine');
    });

    await test('agent list: TodoWrite / TaskCreate / TaskUpdate calls in the transcript are mirrored', async () => {
        const SID5 = 'eeeeeeee-1111-2222-3333-444444444444';
        const file5 = path.join(tmp, '.claude', 'projects', '-repo', `${SID5}.jsonl`);
        const tu = (name, input, ts) => asst([{ type: 'tool_use', id: `t${ts}`, name, input }], ts);
        fs.writeFileSync(file5, user('Do it', '2026-11-24T15:00:00Z')
            + tu('TodoWrite', { todos: [{ content: 'Read the code', status: 'completed', activeForm: 'Reading' }, { content: 'Write the fix', status: 'in_progress', activeForm: 'Writing' }] }, '2026-11-24T15:00:05Z')
            + tu('TaskCreate', { subject: 'Check the phone' }, '2026-11-24T15:00:06Z'));
        let l = await T.sync(SID5);
        assert.deepStrictEqual(l.tasks.map((t) => [t.text, t.done]), [['Read the code', true], ['Write the fix', false], ['Check the phone', false]]);
        fs.appendFileSync(file5, tu('TodoWrite', { todos: [{ content: 'Read the code', status: 'completed' }, { content: 'Write the fix', status: 'completed' }] }, '2026-11-24T15:01:00Z') + tu('TaskUpdate', { taskId: '1', status: 'completed' }, '2026-11-24T15:01:01Z'));
        l = await T.sync(SID5);
        assert.deepStrictEqual(l.tasks.map((t) => [t.text, t.done]), [['Read the code', true], ['Write the fix', true], ['Check the phone', true]]);
        assert.deepStrictEqual([l.counts.tasksDone, l.counts.tasksTotal], [3, 3]);
    });

    await test('agent tools over the socket: task_list / task_add / task_done (user asks too) / task_update; only the caller\'s own session', async () => {
        const net = require('net');
        const ask = (req) => new Promise((resolve, reject) => {
            let buf = '';
            const sk = net.createConnection(process.env.AGENT_SUPERVISOR_SOCKET, () => sk.write(`${JSON.stringify(req)}\n`));
            sk.on('data', (c) => { buf += c; }); sk.on('end', () => resolve(JSON.parse(buf))); sk.on('error', reject);
        });
        sup.start(gr);
        await new Promise((r) => setTimeout(r, 100));
        try {
            const add = await ask({ op: 'task_add', sessionId: SID2, text: 'Check the sidebar on the phone' });
            assert.ok(add.ok && add.result.id && add.result.done === false, JSON.stringify(add));
            const list = await ask({ op: 'task_list', sessionId: SID2 });
            assert.ok(list.ok && list.result.tasks.some((t) => t.text === 'Check the sidebar on the phone') && list.result.asks.length >= 2, JSON.stringify(list));
            const askId = list.result.asks[0].id;
            const done = await ask({ op: 'task_done', sessionId: SID2, id: askId, evidence: 'looked at it in the browser' });
            assert.ok(done.ok && done.result.done && done.result.evidence === 'looked at it in the browser', JSON.stringify(done));
            assert.strictEqual(T.list(SID2).asks.find((a) => a.id === askId).doneBy, 'agent');
            const upd = await ask({ op: 'task_update', sessionId: SID2, id: add.result.id, text: 'Check the sidebar', done: true });
            assert.ok(upd.ok && upd.result.text === 'Check the sidebar' && upd.result.done, JSON.stringify(upd));
            assert.ok(!(await ask({ op: 'task_update', sessionId: SID2, id: askId, text: 'rewrite' })).ok, 'the user\'s text is theirs');
            assert.ok(!(await ask({ op: 'task_done', sessionId: SID, id: askId })).ok, 'another session\'s item');
            assert.ok(!(await ask({ op: 'task_list', sessionId: 'nope' })).ok);
        } finally { sup.stop(); }
    });

    await test('review: the prompt carries the user list with ticks and evidence; the review names items done and they are ticked', async () => {
        const l = T.list(SID2);
        const open = l.asks.find((a) => !a.done);
        assert.ok(open, 'an open ask');
        answer = { verdict: 'ok', summary: 'done', missed: [], done: [{ id: open.id, evidence: 'the diff shows it' }, { id: 999999, evidence: 'not mine' }] };
        engineCalls.length = 0;
        fs.appendFileSync(file2, user('Now check it all', '2026-11-24T11:05:00Z') + asst([{ type: 'text', text: 'Checked.' }], '2026-11-24T11:05:10Z'));
        const rv = await sup.review(SID2, 'recheck', { gr });
        assert.strictEqual(rv.verdict, 'ok');
        const rc = engineCalls.find((c) => /Supervisor for coding agents/.test(c.sys));
        assert.match(rc.usr, /## The user's list/);
        assert.match(rc.usr, new RegExp(`#${open.id} \\[ \\] ${open.text}`));
        assert.match(rc.usr, /\[x\] .* -- looked at it in the browser/);
        assert.match(rc.sys, /"done"/);
        const after = T.list(SID2).asks.find((a) => a.id === open.id);
        assert.ok(after.done && after.doneBy === 'supervisor' && after.evidence === 'the diff shows it', JSON.stringify(after));
        assert.ok(T.list(SID2).asks.length >= 2);
    });

    await test('rule check: scripts + judged violations join the turn-end review, are typed in once, and a later clean review resolves them', async () => {
        const SID3 = 'cccccccc-1111-2222-3333-444444444444';
        const file3 = path.join(tmp, '.claude', 'projects', '-repo', `${SID3}.jsonl`);
        const target = 'modules/agentSupervisor.js';
        const diff = `diff --git a/${target} b/${target}\n@@ -10,2 +10,3 @@\n context\n+const t = setInterval(poll, 1000); // my own toggle list\n context\n`;
        let edited = [];
        let scriptRises = true;
        const judgeCalls = [];
        let judged = [{ rule: 'server-push-not-polling', file: target, quote: 'const t = setInterval(poll, 1000);', why: 'a polling timer', fix: 'push over the socket' }, { rule: 'server-push-not-polling', file: target, quote: 'a line that is not in the diff', why: 'invented', fix: 'none' }];
        sup._test.setRuleCheckDeps({
            changedFiles: () => edited,
            diffs: (files) => new Map(files.map((f) => [f, diff])),
            runScript: (repo, sc, args) => {
                if (args[0] === '--list') return { code: 0, stdout: `${target}:11  setInterval(poll, 1000)\n`, stderr: '' };
                if (sc.name === 'check-perf-rules' && scriptRises) return { code: 1, stdout: '', stderr: `perf rules: counts rose\n\n  ${target}: timer 0 -> 1\n    no timers\n    11: setInterval(poll, 1000)\n` };
                return { code: 0, stdout: 'ok', stderr: '' };
            }
        });
        sup._test.setFetch(async (url, opts) => {
            const b = JSON.parse(opts.body);
            const sys = b.messages[0].content;
            let out;
            if (/project rules given/.test(sys)) { judgeCalls.push(b.messages[1].content); out = { violations: judged }; } else out = { verdict: 'ok', summary: 'done', missed: [] };
            return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }) };
        });
        sup.markSupervised(SID3);
        settingsCfg.agentSupervisor.delivery = 'steer';
        const typed = [];
        const realSteer = launcher.steer;
        launcher.steer = async (id, text) => { typed.push(text); return { sent: true }; };
        try {
            // nothing edited: no violations, no judgement call
            fs.writeFileSync(file3, user('Add the toggle list', '2026-11-24T12:00:00Z') + asst([{ type: 'text', text: 'Looked only.' }], '2026-11-24T12:00:10Z'));
            let rv = await sup.review(SID3, 'turn-end', { gr });
            assert.deepStrictEqual([rv.violations.length, judgeCalls.length, (rv.ruleCheck || {}).checked], [0, 0, false], JSON.stringify(rv.ruleCheck));
            // edited: a script rise and one judged violation (the invented quote is dropped)
            edited = [target];
            fs.appendFileSync(file3, user('Now build it', '2026-11-24T12:01:00Z') + asst([{ type: 'text', text: 'Built it.' }], '2026-11-24T12:01:10Z'));
            rv = await sup.review(SID3, 'turn-end', { gr });
            assert.strictEqual(judgeCalls.length, 1);
            assert.match(judgeCalls[0], /### server-push-not-polling/);
            assert.deepStrictEqual(rv.violations.map((v) => `${v.source}:${v.rule}`).sort(), ['judge:server-push-not-polling', 'script:timer'], JSON.stringify(rv.violations));
            assert.strictEqual(rv.violations.find((v) => v.source === 'script').line, 11);
            assert.strictEqual(rv.violations.find((v) => v.source === 'judge').line, 11);
            assert.strictEqual(rv.verdict, 'ok');
            assert.strictEqual(rv.delivered, 'steer');
            assert.strictEqual(typed.length, 1);
            assert.ok(typed[0].startsWith(`${sup.STEER_PREFIX} Rule check: (1) `), typed[0]);
            assert.match(typed[0], /server-push-not-polling: modules\/agentSupervisor\.js:11: a polling timer - push over the socket/);
            const first = rv;
            // the same violation again is not told twice
            fs.appendFileSync(file3, user('Go on', '2026-11-24T12:02:00Z') + asst([{ type: 'text', text: 'Went on.' }], '2026-11-24T12:02:10Z'));
            rv = await sup.review(SID3, 'turn-end', { gr });
            assert.strictEqual(typed.length, 1, 'said once');
            // fixed: a later clean review resolves the earlier ones
            scriptRises = false; judged = []; edited = [target];
            fs.appendFileSync(file3, user('Fix it', '2026-11-24T12:03:00Z') + asst([{ type: 'text', text: 'Fixed.' }], '2026-11-24T12:03:10Z'));
            rv = await sup.review(SID3, 'turn-end', { gr });
            assert.strictEqual(rv.violations.length, 0);
            const old = sup.getReview(first.id);
            assert.ok(old.violations.every((v) => /^Fixed: review #/.test(v.resolved)), JSON.stringify(old.violations));
            assert.strictEqual(old.dismissed, true);
            assert.ok(/Fixed/.test(old.resolved));
            // off: no check at all
            settingsCfg.agentSupervisor.ruleCheck = false;
            scriptRises = true; judged = [{ rule: 'server-push-not-polling', file: target, quote: 'const t = setInterval(poll, 1000);', why: 'w', fix: 'f' }];
            fs.appendFileSync(file3, user('Again', '2026-11-24T12:04:00Z') + asst([{ type: 'text', text: 'Again done.' }], '2026-11-24T12:04:10Z'));
            const before = judgeCalls.length;
            rv = await sup.review(SID3, 'turn-end', { gr });
            assert.deepStrictEqual([rv.violations.length, judgeCalls.length], [0, before]);
        } finally { launcher.steer = realSteer; delete settingsCfg.agentSupervisor.ruleCheck; settingsCfg.agentSupervisor.delivery = 'inbox'; sup._test.setRuleCheckDeps({}); }
    });

    await test('rule check: rise parsers read the three scripts\' output; rules are chosen by path and globs', () => {
        const R = require('../modules/supervisorRuleCheck');
        assert.deepStrictEqual(R.parseRises('perf', 'perf rules: counts rose\n\n  a/b.js: timer 1 -> 3\n    no timers\n    9: x\n').map((x) => [x.file, x.id, x.was, x.now, x.why]), [['a/b.js', 'timer', 1, 3, 'no timers']]);
        assert.deepStrictEqual(R.parseRises('ui', 'UI standard: 1 count(s) rose.\n\n  public/x.js\n    own-toggle: 0 -> 2  (use the tree)\n').map((x) => [x.file, x.id, x.was, x.now, x.why]), [['public/x.js', 'own-toggle', 0, 2, 'use the tree']]);
        assert.deepStrictEqual(R.parseRises('scope', 'app scope: counts went up (fix them):\n  public/y.js: globals 0 -> 1\n').map((x) => [x.file, x.id, x.now]), [['public/y.js', 'globals', 1]]);
        const rules = sup.listRules({ withText: true });
        const ui = R.applicableRules(rules, ['apps/claudedesk/client/claudedesk.js']).map((r) => r.name);
        ['ui-standard', 'no-native-browser-ui', 'vista-icons-not-fa', 'scroll-lists-keep-position', 'sliders-platform', 'no-base64-images'].forEach((n) => assert.ok(ui.includes(n), n));
        const srv = R.applicableRules(rules, ['modules/x.js']).map((r) => r.name);
        assert.ok(srv.includes('server-push-not-polling') && srv.includes('phone-power-server') && !srv.includes('ui-standard'));
        assert.ok(R.applicableRules(rules, ['public/scripts/comp/a.js']).map((r) => r.name).includes('tray-balloons'), 'a glob match');
    });

    require('../modules/agentCoord/store').close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
