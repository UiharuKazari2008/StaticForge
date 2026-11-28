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
// a scratch inbox: a test must never publish into the live one (its notices land on Yukimi's phone, #1196)
process.env.NOTIFICATION_INBOX_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-agent-supervisor-')), 'notifications.db');
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
process.env.AGENT_SUPERVISOR_SOCKET = path.join(tmp, 'state', 'supervisor.sock');
process.env.AGENT_SUPERVISOR_SETTLE_MS = '0';
process.env.AGENT_SUPERVISOR_NO_REVIVE = '1'; // fake sessions here are not running: only the revive tests turn it on
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
    if (method === 'GET' && (m = /^\/repos\/([^/]+\/[^/]+)\/issues\?state=open&type=issues&limit=\d+(?:&q=.*)?$/.exec(u))) {
        return ok([...yzIssues.entries()].filter(([k, v]) => k.startsWith(`${m[1]}#`) && v.state === 'open' && v.listed).map(([k, v]) => ({ number: Number(k.split('#')[1]), id: 9000 + Number(k.split('#')[1]), title: v.title, labels: [{ name: 'type:bug' }] })));
    }
    if (method === 'GET' && u === '/user') return ok({ login: 'director.yozora' });
    if (method === 'GET' && (m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/timeline/.exec(u))) { const v = yzIssues.get(`${m[1]}#${m[2]}`) || {}; return ok(v.closedBy ? [{ type: 'comment', user: { login: 'x' } }, { type: 'close', user: { login: v.closedBy } }] : []); }
    if (method === 'PATCH' && (m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(u))) { const k = `${m[1]}#${m[2]}`; const v = yzIssues.get(k) || {}; if (body && body.state) v.state = body.state; yzIssues.set(k, v); return ok({ number: Number(m[2]), state: v.state }); }
    if (method === 'GET' && (m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(u))) { const v = yzIssues.get(`${m[1]}#${m[2]}`) || { state: 'open' }; return ok({ number: Number(m[2]), id: 9000 + Number(m[2]), state: v.state, title: v.title || '', body: v.body || '', labels: [] }); }
    return ok({});
});
const launcher = require('../modules/claudeSessionLauncher');

let failed = 0;
// put an item back to queued (a test started it already)
function db_setQueued(id) { require('../modules/agentCoord/store').open().prepare("UPDATE supervisor_work SET state = 'queued', session_id = NULL WHERE id = ?").run(id); }
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 8).join("\n     ")}`); }
}

const SID = 'aaaaaaaa-1111-2222-3333-444444444444';
const file = path.join(tmp, '.claude', 'projects', '-repo', `${SID}.jsonl`);
const line = (o) => `${JSON.stringify(o)}\n`;
const user = (text, ts) => line({ type: 'user', uuid: `u${ts}`, timestamp: ts, message: { role: 'user', content: text } });
const asst = (content, ts) => line({ type: 'assistant', uuid: `a${ts}`, timestamp: ts, message: { role: 'assistant', content } });

const settingsCfg = { agentSupervisor: { enabled: true, engine: 'tokenrouter', delivery: 'inbox', reviewScope: 'all', landingCheck: false } };
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
        await sup.refreshArtifacts({ sessionId: SID3 });
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
            // the session is idle when its review ends (a session still working keeps the item running: see the in-flight test)
            fs.writeFileSync(path.join(tmp, '.claude', 'sessions', `${process.pid}1.json`), JSON.stringify({ pid: process.pid, sessionId: sup.getWork(a.id).sessionId, status: 'idle', cwd: tmp }));
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

    await test('expired login: a start that fails on account A moves on to account B (item not failed); every account failing fails the item; resume moves on too', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const fs8 = require('../modules/claudeFleetSettings');
        const realPick = fleetMcp.pickForStart;
        const realStart = launcher.start;
        const realResume = launcher.resume;
        const accounts = [{ index: 0, name: 'A' }, { index: 1, name: 'B' }];
        const bad = new Set([0]);
        const tries = [];
        fleetMcp.pickForStart = async () => {
            const a = accounts.find((x) => !fs8.loginFailedOf(x.index));
            if (!a) throw new Error('No Claude account has room');
            return Object.assign({ settings: {} }, a);
        };
        launcher.start = async (g, o) => { tries.push(o.account); return bad.has(o.account) ? { state: 'failed', message: 'OAuth token has expired' } : { id: `ffffffff-0000-0000-0000-00000000000${tries.length}`, state: 'connected', link: '' }; };
        settingsCfg.agentSupervisor = Object.assign(settingsCfg.agentSupervisor, { maxConcurrent: 10, autoStart: true });
        try {
            const w = sup.enqueue({ title: 'Login A', prompt: 'x', topology: 'direct', startNow: true }, { gr });
            await sup.pumpWork(gr);
            await new Promise((r) => setTimeout(r, 50));
            await sup.pumpWork(gr);
            assert.deepStrictEqual(tries, [0, 1], 'A failed on its login, B took the item');
            assert.strictEqual(sup.getWork(w.id).state, 'running');
            assert.match(sup.getWork(w.id).message, /Running on B/);
            assert.ok(fs8.loginFailedOf(0), 'A is recorded as login-failed');
            // every account fails
            fs8.clearLoginFailed(0); fs8.clearLoginFailed(1);
            bad.add(1); tries.length = 0;
            const z = sup.enqueue({ title: 'Login all', prompt: 'y', topology: 'direct', startNow: true }, { gr });
            for (let i = 0; i < 4; i += 1) { await sup.pumpWork(gr); await new Promise((r) => setTimeout(r, 30)); }
            assert.deepStrictEqual(tries, [0, 1]);
            assert.strictEqual(sup.getWork(z.id).state, 'failed');
            assert.match(sup.getWork(z.id).message, /No account with a working login/);
            // resume: the item's account failed on its login, the session resumes on the next one
            fs8.clearLoginFailed(0); fs8.clearLoginFailed(1); bad.delete(1);
            const resumedOn = [];
            launcher.resume = async (g, id, o) => { resumedOn.push(o.account); return bad.has(o.account) ? { state: 'failed', message: 'Not logged in' } : { id, state: 'connected' }; };
            bad.add(0);
            const got = await sup._test.resumeOnAccount('abababab-0000-0000-0000-000000000001', ['auto']);
            assert.deepStrictEqual(resumedOn, [0, 1]);
            assert.strictEqual(got.pick.name, 'B');
            assert.ok(got.res && got.res.state === 'connected');
            bad.add(1); fs8.clearLoginFailed(0); fs8.clearLoginFailed(1); resumedOn.length = 0;
            const none = await sup._test.resumeOnAccount('abababab-0000-0000-0000-000000000002', ['auto']);
            assert.strictEqual(none.pick, null);
            assert.strictEqual(none.loginFailed, true);
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; launcher.resume = realResume; fs8.clearLoginFailed(0); fs8.clearLoginFailed(1); }
    });

    await test('login expired under a running session: the turn ending authentication_failed marks the account (runtime), kills + resumes the session on another account, steers; busy is never killed; debounce; usage read does not clear; newer credentials do', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const fs8 = require('../modules/claudeFleetSettings');
        const host = require('../modules/claudeAccountHost');
        const realPick = fleetMcp.pickForStart; const realList = host.listAccounts; const realFind = launcher.findFile;
        const realResume = launcher.resume; const realSteer = launcher.steer;
        const SA = 'c1c1c1c1-0000-0000-0000-00000000000a'; const SB = 'c1c1c1c1-0000-0000-0000-00000000000b'; const SC = 'c1c1c1c1-0000-0000-0000-00000000000c';
        const cfgA = path.join(tmp, 'claude-accounts', 'idA', 'config'); fs.mkdirSync(cfgA, { recursive: true });
        const files = {};
        const failLine = JSON.stringify({ type: 'assistant', isApiErrorMessage: true, error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Login expired · Please run /login' }] } }) + '\n';
        const okLine = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }) + '\n';
        [[SA, failLine], [SB, failLine], [SC, okLine]].forEach(([id, line]) => { files[id] = path.join(tmp, `${id}.jsonl`); fs.writeFileSync(files[id], JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n' + line); });
        const status = { [SA]: 'idle', [SB]: 'busy', [SC]: 'idle' };
        const live = () => new Map([SA, SB, SC].map((id) => [id, { id, pid: 1, status: status[id], configDir: cfgA, tmuxSession: `rc-${id.slice(0, 8)}` }]));
        const killed = []; const resumed = []; const typed = []; const posts = [];
        sup._test.setFailoverDeps({ kill: async (l) => { killed.push(l.id); } });
        sup._test.setCollisionDeps({ live });
        host.listAccounts = () => [{ index: 0, id: 'idA', name: 'A' }, { index: 1, id: 'idB', name: 'B' }];
        fleetMcp.pickForStart = async () => { const a = [{ index: 0, name: 'A' }, { index: 1, name: 'B' }].find((x) => !fs8.loginFailedOf(x.index)); if (!a) throw new Error('No Claude account has room'); return Object.assign({ settings: {} }, a); };
        launcher.findFile = async (id) => files[id] || null;
        launcher.resume = async (g, id, o) => { resumed.push([id, o.account]); return { id, state: 'connected' }; };
        launcher.steer = async (id, text) => { typed.push([id, text]); };
        try {
            fs8.clearLoginFailed(0);
            assert.strictEqual(await sup._test.loginTurn(SC), false, 'an ok turn is left alone');
            assert.strictEqual(fs8.loginFailedOf(0), null);
            assert.strictEqual(await sup._test.loginTurn(SB), false, 'a busy session is never killed');
            assert.deepStrictEqual(killed, []);
            assert.strictEqual(await sup._test.loginTurn(SA), true);
            assert.ok(fs8.loginFailedOf(0) && fs8.loginFailedOf(0).runtime, 'account A marked (runtime)');
            assert.deepStrictEqual(killed, [SA]);
            assert.deepStrictEqual(resumed, [[SA, 1]]);
            assert.strictEqual(typed.length, 1);
            assert.match(typed[0][1], /^\[Supervisor\] The A account login expired.*now runs on the B account: continue exactly where you were/);
            // the idle session whose turn did not fail stayed; the busy one moves the moment it ends its (failed) turn
            status[SB] = 'idle';
            assert.strictEqual(await sup._test.loginTurn(SB), true);
            assert.deepStrictEqual(killed, [SA, SB]);
            // debounce: the same session again within 10 minutes is not moved again
            assert.strictEqual(await sup._test.loginTurn(SA), true);
            assert.deepStrictEqual(killed, [SA, SB], 'debounced');
            // a usage read (other token) does not clear the runtime mark
            const lim = [{ kind: 'session', label: 'session', percent: 5, resetsAt: 1 }];
            assert.strictEqual(fs8.availability({ index: 0, limits: lim, at: Date.now() + 5000 }, Object.assign({}, fs8.DEFAULTS)).state, 'login');
            assert.ok(fs8.loginFailedOf(0));
            // a newer credentials file does
            const cred = path.join(cfgA, '.credentials.json'); fs.writeFileSync(cred, '{}');
            const later = new Date(Date.now() + 5000); fs.utimesSync(cred, later, later);
            assert.notStrictEqual(fs8.availability({ index: 0, limits: lim, at: Date.now() }, Object.assign({}, fs8.DEFAULTS)).state, 'login');
            assert.strictEqual(fs8.loginFailedOf(0), null);
        } finally {
            sup._test.setFailoverDeps(null); sup._test.setCollisionDeps(null); fleetMcp.pickForStart = realPick; host.listAccounts = realList; launcher.findFile = realFind; launcher.resume = realResume; launcher.steer = realSteer;
            fs8.clearLoginFailed(0); fs8.clearLoginFailed(1); sup._test.loginMoves.clear();
        }
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
            // every planner and agent task ends with "Make no mistakes." and the planner puts it at the end of its agents' briefs
            assert.ok(ps.prompt.trimEnd().endsWith('Make no mistakes.'), 'the brief ends with "Make no mistakes."');
            assert.match(ps.prompt, /End every brief you give a background agent or a part with the line "Make no mistakes\."/);
            // auto: plan first. ONE planner session starts (no model call guesses a shape); it reports the shape with fleet_work_shape
            const nReplies = replies.length;
            const a = sup.enqueue({ title: 'Auto', prompt: 'tiny fix', topology: 'auto', startNow: true }, { gr });
            await sup.pumpWork(gr);
            const as = starts.find((o) => o.title === 'Auto');
            assert.match(as.prompt, /You are the PLANNER for Fleet work item/);
            assert.match(as.prompt, /fleet_work_shape/);
            assert.ok(as.prompt.trimEnd().endsWith('Make no mistakes.') && /End every brief you give a background agent or a part/.test(as.prompt));
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
        // a broken JSON answer (one bad element) keeps the good findings around it (Nov 25 2026: "Expected ',' or ']'")
        const broken = '{"findings":[{"rules":["alpha","beta"],"kind":"contradiction","severity":"high","text":"good one","suggestion":"x"},{"rules":["alpha"],"kind":"vague","severity":"low","text":"bad "quote" here","suggestion":"y"},{"rules":["beta"],"kind":"vague","severity":"low","text":"good two","suggestion":"z"}]}';
        sup._test.setFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: broken } }] }) }));
        const salv = await sup.reviewRules(g3, opts);
        assert.ok(salv.findings.some((f) => f.text === 'good one') && salv.findings.some((f) => f.text === 'good two'), JSON.stringify(salv.findings.map((f) => f.text)));
        assert.ok(!salv.error, salv.error);
        assert.throws(() => sup._test.parseLooseJson('no json at all'), /not JSON/);
    });

    await test('429: a rate-limited call waits and is retried (at most three times)', async () => {
        process.env.AGENT_SUPERVISOR_429_MS = '20';
        let n = 0;
        sup._test.setFetch(async () => { n += 1; return n <= 2 ? { ok: false, status: 429, headers: { get: () => null }, text: async () => 'Too many requests' } : { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }) }; });
        const g5 = Object.assign({}, gr, { getConfig: () => ({ agentSupervisor: { enabled: true, engine: 'tokenrouter' } }) });
        const o = await sup.askJson(g5, 'Answer in JSON.', 'x', 'json');
        assert.strictEqual(o.ok, true);
        assert.strictEqual(n, 3);
        n = -10;
        await assert.rejects(() => sup.askJson(g5, 'Answer in JSON.', 'x', 'json'), /429/);
        assert.strictEqual(n, -6, 'one try and three retries');
        delete process.env.AGENT_SUPERVISOR_429_MS;
    });

    await test('askJson: an empty / cut-off answer is asked once more with more room', async () => {
        const seen = [];
        sup._test.setFetch(async (url, opts) => { const b = JSON.parse(opts.body); seen.push(b); const content = seen.length === 1 ? '' : '{"findings":[]}'; return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: seen.length === 1 ? 'length' : 'stop' }] }) }; });
        const g6 = Object.assign({}, gr, { getConfig: () => ({ agentSupervisor: { enabled: true, engine: 'tokenrouter' } }) });
        const o = await sup.askJson(g6, 'Answer in JSON.', 'x', 'json', { maxTokens: 3000 });
        assert.deepStrictEqual(o.findings, []);
        assert.strictEqual(seen.length, 2);
        assert.strictEqual(seen[1].max_tokens, 6000);
    });

    await test('JSON mode: a prompt that never says JSON gets "Answer in JSON." (DeepSeek 400s otherwise)', async () => {
        const seen = [];
        sup._test.setFetch(async (url, opts) => { seen.push(JSON.parse(opts.body)); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"title":"x"}' } }] }) }; });
        const g4 = Object.assign({}, gr, { getConfig: () => ({ agentSupervisor: { enabled: true, engine: 'tokenrouter' } }) });
        const o = await sup.askJson(g4, 'Title these requests in 8 words.', 'fix the bar', 'json');
        assert.strictEqual(o.title, 'x');
        const last = seen[seen.length - 1];
        assert.ok(last.messages.some((m) => /json/i.test(m.content)), JSON.stringify(last.messages));
        await sup.askJson(g4, 'Answer ONLY a JSON object.', 'y', 'json');
        assert.ok(!/Answer in JSON\./.test(seen[seen.length - 1].messages[0].content), 'a prompt that already says JSON is left alone');
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


    // ------------------------------------------------------------ #1191: several issues in one run, Remote Control optional
    const settle = (ms) => new Promise((r) => setTimeout(r, ms || 80));
    const waitFor = async (fn, what) => { for (let i = 0; i < 100; i += 1) { if (fn()) return; await settle(20); } throw new Error(`timed out: ${what}`); };
    const putIssue = (n, extra) => yzIssues.set(`DreamScape/StaticForge#${n}`, Object.assign({ state: 'open', title: `Runtime Compile ${n}`, body: `Body of ${n}` }, extra || {}));
    const RAW = () => require('../modules/agentCoord/store').open();
    const R = (n) => `DreamScape/StaticForge#${n}`;
    let multiId = null;

    await test('several issues, one run: five refs become ONE item (primary + four carried); one ref is as before; Remote Control defaults off', async () => {
        settingsCfg.agentSupervisor = Object.assign(settingsCfg.agentSupervisor, { maxConcurrent: 10, autoStart: false });
        [1179, 1180, 1181, 1182, 1183, 1190].forEach((n) => putIssue(n));
        yzIssues.get(R(1180)).body = 'x'.repeat(3000);
        const before = sup.listWork({ limit: 300 }).length;
        yzCalls.length = 0;
        const w = sup.enqueue({ title: 'Runtime errors', prompt: 'Fix every runtime compile error', issues: [R(1179), `https://yozora.bluesteel.737.jp.net/${R(1180).replace('#', '/issues/')}`, R(1181), R(1182), R(1183), R(1179)] });
        multiId = w.id;
        assert.strictEqual(sup.listWork({ limit: 300 }).length, before + 1, 'one item, not five');
        await settle();
        const got = sup.getWork(w.id);
        assert.strictEqual(got.issues.length, 5, JSON.stringify(got.issues));
        assert.deepStrictEqual(got.issues.map((i) => i.number), [1179, 1180, 1181, 1182, 1183]);
        assert.deepStrictEqual(got.issues.map((i) => i.primary), [true, false, false, false, false]);
        assert.deepStrictEqual([got.issue.repo, got.issue.number], ['DreamScape/StaticForge', 1179], 'issue (singular) is the primary');
        assert.strictEqual(got.issues[1].title, 'Runtime Compile 1180', 'titles come back from the link');
        assert.strictEqual(got.remoteControl, false);
        assert.strictEqual(JSON.parse(RAW().prepare('SELECT issue_refs FROM supervisor_work WHERE id = ?').get(w.id).issue_refs).length, 4, 'the primary is not repeated in issue_refs');
        assert.strictEqual(yzCalls.filter((c) => c.method === 'POST' && /\/issues\/\d+\/labels$/.test(c.url)).length, 5, 'each is linked (the fleet label)');
        assert.ok(!yzCalls.some((c) => c.method === 'POST' && /\/issues$/.test(c.url)), 'no issue of its own is made for a run that names its issues');
        // a string with several refs
        const w3 = sup.enqueue({ title: 'Strings', prompt: 'p', issues: `${R(1179)}, #1180 ${R(1181)}`, remoteControl: true });
        assert.deepStrictEqual(sup.getWork(w3.id).issues.map((i) => i.number), [1179, 1180, 1181]);
        assert.strictEqual(sup.getWork(w3.id).remoteControl, true);
        // one ref (issue or issues): exactly today's single issue
        const w1 = sup.enqueue({ title: 'Single', prompt: 'one', issue: R(1190) });
        await settle();
        const one = sup.getWork(w1.id);
        assert.deepStrictEqual([one.issues.length, one.issue.number, one.issues[0].primary], [1, 1190, true]);
        assert.strictEqual(RAW().prepare('SELECT issue_refs FROM supervisor_work WHERE id = ?').get(w1.id).issue_refs, null);
        const w2 = sup.enqueue({ title: 'Single b', prompt: 'one', issues: [R(1190)] });
        await settle();
        assert.strictEqual(sup.getWork(w2.id).issues.length, 1);
        assert.deepStrictEqual(sup.getWork(sup.enqueue({ title: 'None', prompt: 'x', source: 'yozora' }).id).issues, [], 'no issue: []');
    });

    await test('several issues, one run: the brief names every issue with title and excerpt, each extra gets its own start comment; a single issue brief is unchanged; Remote Control reaches the launcher', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart;
        const realStart = launcher.start;
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        const starts = [];
        let n = 0;
        launcher.start = async (g, o) => { n += 1; starts.push(o); return { id: `bbbbbbbb-0000-0000-0000-0000000002${String(n).padStart(2, '0')}`, state: 'running', link: '' }; };
        try {
            yzCalls.length = 0;
            const w = sup.enqueue({ title: 'Runtime errors started', prompt: 'Fix every runtime compile error', topology: 'direct', issues: [R(1179), R(1180), R(1181)], startNow: true }, { gr });
            await waitFor(() => sup.getWork(w.id).state === 'running', 'multi item running');
            const o = starts.find((x) => x.title === 'Runtime errors started');
            assert.strictEqual(o.remoteControl, false, 'a work item starts without Remote Control unless asked');
            assert.match(o.prompt, /covers 3 Yozora issues TOGETHER/);
            [1179, 1180, 1181].forEach((i) => { assert.ok(o.prompt.includes(`DreamScape/StaticForge#${i}`) && o.prompt.includes(`Runtime Compile ${i}`) && o.prompt.includes(`https://yozora.bluesteel.737.jp.net/DreamScape/StaticForge/issues/${i}`), `names #${i}`); });
            assert.ok(o.prompt.includes('Body of 1179'), 'a body excerpt');
            assert.ok(/Close an issue only when its own ask is done/.test(o.prompt) && /Comment your progress on EACH/.test(o.prompt));
            assert.ok(!/x{1501}/.test(o.prompt) && /x{1500}/.test(o.prompt), 'the excerpt is cut at 1500 characters');
            await waitFor(() => yzCalls.filter((c) => /\/comments$/.test(c.url)).length >= 3, 'start comments');
            const cm = yzCalls.filter((c) => /\/comments$/.test(c.url));
            assert.ok(cm.some((c) => /issues\/1179\/comments/.test(c.url) && /started as a supervised session/.test(c.body.body)), 'the primary has the lifecycle comment');
            const e1 = cm.find((c) => /issues\/1180\/comments/.test(c.url));
            assert.match(e1.body.body, /part of the Fleet run on DreamScape\/StaticForge#1179, covering #1179, #1181/);
            assert.ok(cm.some((c) => /issues\/1181\/comments/.test(c.url)), 'every extra has its own');
            // a single issue: today's text
            const s1 = sup.enqueue({ title: 'Single started', prompt: 'one issue', topology: 'direct', issue: R(1190), startNow: true }, { gr });
            await waitFor(() => sup.getWork(s1.id).state === 'running', 'single running');
            const so = starts.find((x) => x.title === 'Single started');
            assert.match(so.prompt, /This work is tracked in Yozora DreamScape\/StaticForge#1190 \(https:\/\/yozora\.bluesteel\.737\.jp\.net\/DreamScape\/StaticForge\/issues\/1190, label fleet\)\. Comment your progress there as you go/);
            assert.ok(!/TOGETHER/.test(so.prompt));
            // Remote Control on
            const rc = sup.enqueue({ title: 'With RC', prompt: 'rc', topology: 'direct', remoteControl: true, startNow: true }, { gr });
            await waitFor(() => sup.getWork(rc.id).state === 'running', 'rc running');
            assert.strictEqual(starts.find((x) => x.title === 'With RC').remoteControl, true);
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; }
    });

    await test('several issues, one run: at the end each issue closes only when its own ask is done, the others hear what is left; failed closes nothing', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart;
        const realStart = launcher.start;
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        let n = 0;
        launcher.start = async () => { n += 1; return { id: `cccccccc-0000-0000-0000-0000000003${String(n).padStart(2, '0')}`, state: 'running', link: '' }; };
        const review = (sid, verdict, issues, missed) => RAW().prepare("INSERT INTO supervisor_reviews (session_id, at, trigger, verdict, summary, missed, issues) VALUES (?, ?, 'turn-end', ?, ?, ?, ?)")
            .run(sid, Date.now(), verdict, 'sum', JSON.stringify(missed || []), issues ? JSON.stringify(issues) : null);
        const closed = (since) => yzCalls.slice(since).filter((c) => c.method === 'PATCH' && c.body && c.body.state === 'closed').map((c) => Number(/issues\/(\d+)$/.exec(c.url)[1])).sort();
        const commentsOn = (since, num) => yzCalls.slice(since).filter((c) => new RegExp(`issues/${num}/comments$`).test(c.url)).map((c) => c.body.body);
        try {
            [1301, 1302, 1303, 1304, 1305, 1306].forEach((i) => putIssue(i));
            const a = sup.enqueue({ title: 'Three', prompt: 'three issues', topology: 'direct', issues: [R(1301), R(1302), R(1303)], startNow: true }, { gr });
            await waitFor(() => sup.getWork(a.id).state === 'running', 'running');
            await settle(150);
            const mark = yzCalls.length;
            const sidA = sup.getWork(a.id).sessionId;
            review(sidA, 'ok', [{ ref: R(1301), done: true, left: '' }, { ref: R(1302), done: true, left: '' }, { ref: R(1303), done: false, left: 'the macro case still fails' }]);
            sup.workAfterReview({ sessionId: sidA, verdict: 'ok', missed: [], summary: 'mostly' });
            await waitFor(() => yzCalls.slice(mark).some((c) => /issues\/1303\/comments$/.test(c.url)) && closed(mark).length >= 2, 'end comments');
            await settle(100);
            assert.deepStrictEqual(closed(mark), [1301, 1302], 'only the issues whose own ask is done close');
            assert.ok(commentsOn(mark, 1303).some((t) => /not finished/.test(t) && /Left: the macro case still fails/.test(t) && /Left open/.test(t)), commentsOn(mark, 1303).join(' | '));
            assert.ok(commentsOn(mark, 1302).some((t) => /done - part of the Fleet run on DreamScape\/StaticForge#1301/.test(t)));
            assert.ok(commentsOn(mark, 1301).some((t) => /found nothing missed/.test(t) && /Closing as done/.test(t)), 'the primary has the usual done comment');
            assert.strictEqual(sup.getWork(a.id).state, 'done');
            // ok and the review names no issues: every issue is done (an ok verdict means nothing was missed)
            const b = sup.enqueue({ title: 'Two plain', prompt: 'two', topology: 'direct', issues: [R(1304), R(1305)], startNow: true }, { gr });
            await waitFor(() => sup.getWork(b.id).state === 'running', 'b running');
            await settle(150);
            const markB = yzCalls.length;
            sup.workAfterReview({ sessionId: sup.getWork(b.id).sessionId, verdict: 'ok', missed: [], summary: 'all' });
            await waitFor(() => closed(markB).length >= 2, 'both closed');
            assert.deepStrictEqual(closed(markB), [1304, 1305]);
            // failed: nothing closed, each extra hears what is left from the last review
            const c = sup.enqueue({ title: 'Fails', prompt: 'fails', topology: 'direct', issues: [R(1306), R(1301)], startNow: true }, { gr });
            await waitFor(() => sup.getWork(c.id).state === 'running', 'c running');
            await settle(150);
            const markC = yzCalls.length;
            const sidC = sup.getWork(c.id).sessionId;
            review(sidC, 'gaps', [{ ref: R(1301), done: false, left: 'compile still red' }], [{ item: 'tests' }]);
            sup.setWork(c.id, { state: 'failed', ended_at: Date.now(), message: 'It stopped with gaps' });
            await waitFor(() => commentsOn(markC, 1301).length >= 1 && commentsOn(markC, 1306).length >= 1, 'failed comments');
            await settle(100);
            assert.deepStrictEqual(closed(markC), [], 'a failed run closes nothing');
            assert.ok(commentsOn(markC, 1301).some((t) => /Nothing was closed/.test(t) && /compile still red/.test(t)), commentsOn(markC, 1301).join(' | '));
            assert.ok(commentsOn(markC, 1306).some((t) => /did not finish/.test(t) && /Nothing was closed/.test(t)));
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; }
    });

    await test('several issues, one run: the review asks for per-issue answers; the verdict parser keeps them clean', () => {
        const meta = { sessionId: 'x', issuesList: [{ repo: 'DreamScape/StaticForge', number: 1, title: 'One' }, { repo: 'DreamScape/StaticForge', number: 2, title: 'Two' }] };
        const text = sup._test.promptFor(sup._test.capTurn({ request: 'r', steering: [], actions: [], final: 'f', said: [] }), meta);
        assert.match(text, /## Issues this run covers \(2\)\n1\. DreamScape\/StaticForge#1 - One\n2\. DreamScape\/StaticForge#2 - Two/);
        assert.match(text, /"issues":\[\{"ref":"owner\/repo#N","done":true\|false,"left"/);
        assert.ok(!/Issues this run covers/.test(sup._test.promptFor(sup._test.capTurn({ request: 'r', steering: [], actions: [], final: 'f', said: [] }), { sessionId: 'x' })), 'a single-issue review is unchanged');
        const v = sup._test.parseVerdict(JSON.stringify({ verdict: 'ok', summary: 's', missed: [], issues: [{ ref: '#1179', done: true }, { ref: 'https://yozora.bluesteel.737.jp.net/Org/Repo/issues/7', left: 'half' }, { ref: 'junk' }, 'bad'] }));
        assert.deepStrictEqual(v.issues, [{ ref: 'DreamScape/StaticForge#1179', done: true, left: '' }, { ref: 'Org/Repo#7', done: false, left: 'half' }]);
        assert.strictEqual(sup._test.parseVerdict('{"verdict":"ok","missed":[]}').issues, undefined);
    });

    await test('mergeWork: three waiting requests become one queued item with the union of their issues; the three are cancelled + joined with no cancel comment and no close', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart;
        fleetMcp.pickForStart = async () => { throw new Error('no account in this test'); };
        try {
            [1401, 1402, 1403, 1404].forEach((i) => putIssue(i));
            const a = sup.enqueue({ title: 'Req A', prompt: 'brief A', issue: R(1401), cwd: tmp, model: 'opus', effort: 'high' });
            const b = sup.enqueue({ title: 'Req B', prompt: 'brief B', issues: [R(1402), R(1403)] });
            const c = sup.enqueue({ title: 'Req C', prompt: 'brief C', issue: R(1401) });
            await settle(150);
            assert.deepStrictEqual([a, b, c].map((x) => sup.getWork(x.id).state), ['held', 'held', 'held']);
            const mark = yzCalls.length;
            const r = sup.mergeWork([a.id, b.id, c.id], { gr });
            assert.deepStrictEqual(r.joined, [a.id, b.id, c.id]);
            const nw = r.work;
            assert.strictEqual(nw.state, 'queued', JSON.stringify(nw));
            assert.strictEqual(nw.startNow, true, 'she picked it to run: it starts now by default');
            assert.strictEqual(nw.title, 'Req A (+2 more)');
            assert.deepStrictEqual(nw.issues.map((i) => [i.number, i.primary]), [[1401, true], [1402, false], [1403, false]], 'the union, the first item\'s primary first, no duplicates');
            assert.deepStrictEqual([nw.cwd, nw.model, nw.effort, nw.source, nw.remoteControl, nw.joinedInto], [tmp, 'opus', 'high', 'fleet', false, null]);
            const full = sup.workPrompt(nw.id);
            assert.ok(full.startsWith('One run covering these Fleet requests together:') && ['Req A', 'brief A', 'Req B', 'brief B', 'Req C', 'brief C'].every((t) => full.includes(t)));
            [a, b, c].forEach((x) => { const g = sup.getWork(x.id); assert.deepStrictEqual([g.state, g.joinedInto, g.message], ['cancelled', nw.id, `Joined into item ${nw.id} (one run)`]); });
            await settle(150);
            const sent = yzCalls.slice(mark);
            assert.ok(!sent.some((x) => x.method === 'PATCH'), 'nothing closed');
            assert.ok(!sent.some((x) => /\/comments$/.test(x.url) && /cancelled in Fleet/.test(x.body.body)), 'no cancel comment');
            [1401, 1402, 1403].forEach((i) => {
                const joined = sent.filter((x) => new RegExp(`issues/${i}/comments$`).test(x.url) && /Joined Fleet item/.test(x.body.body));
                assert.strictEqual(joined.length, 1, `#${i} hears once`);
                assert.ok(joined[0].body.body.includes(`Joined Fleet item ${nw.id}: one run with`), joined[0].body.body);
            });
            assert.ok(/#1402, #1403/.test(sent.find((x) => /issues\/1401\/comments$/.test(x.url)).body.body));
            assert.deepStrictEqual(sup.listWork({ limit: 300 }).find((x) => x.id === nw.id).issues.length, 3);
            // a joined item can be started again on its own: it is no longer joined
            sup.holdWork(a.id);
            assert.strictEqual(sup.getWork(a.id).joinedInto, null);
        } finally { fleetMcp.pickForStart = realPick; }
    });

    await test('mergeWork: refuses a running item and a single id; names the one; leaves everything as it was', async () => {
        const x = sup.enqueue({ title: 'M1', prompt: 'm1' });
        const y = sup.enqueue({ title: 'M2', prompt: 'm2' });
        RAW().prepare("UPDATE supervisor_work SET state = 'running' WHERE id = ?").run(x.id);
        assert.throws(() => sup.mergeWork([x.id, y.id]), new RegExp(`Work item ${x.id} \\(M1\\) is running`));
        assert.strictEqual(sup.getWork(y.id).state, 'held');
        assert.throws(() => sup.mergeWork([y.id]), /Pick two or more/);
        assert.throws(() => sup.mergeWork([y.id, y.id]), /Pick two or more/);
        assert.throws(() => sup.mergeWork([y.id, 999999]), /No work item 999999/);
        RAW().prepare("UPDATE supervisor_work SET state = 'held' WHERE id = ?").run(x.id);
        const done = sup.mergeWork([x.id, y.id], { startNow: false, title: ' Both ', remoteControl: true });
        assert.deepStrictEqual([done.work.title, done.work.state, done.work.remoteControl], ['Both', 'held', true], 'startNow false: waits to be started');
        assert.throws(() => sup.mergeWork([x.id, y.id]), /already joined|is cancelled|only a waiting/, 'a joined item is not joined twice');
    });

    await test('several issues: pullIssues does not make an item of an issue a run carries; a closed extra does not end the run, a closed primary does', async () => {
        settingsCfg.agentSupervisor.autoStart = false;
        const mid = multiId;
        [1180, 1181, 1182, 1183, 1179].forEach((i) => yzIssues.set(R(i), Object.assign(yzIssues.get(R(i)), { external: true })));
        yzIssues.set(R(1999), { state: 'open', external: true, title: 'Unrelated', body: 'b' });
        const r = await sup.pullIssues(gr, { force: true });
        assert.strictEqual(r.added, 1, JSON.stringify(r));
        assert.ok(!sup.listWork({ limit: 300 }).some((x) => x.id !== mid && x.source === 'yozora' && x.issue && [1180, 1181, 1182, 1183].includes(x.issue.number)), 'carried issues stay with their run');
        // one of the carried issues closes: the run goes on
        yzIssues.get(R(1181)).state = 'closed';
        await sup.pullIssues(gr, { force: true });
        assert.strictEqual(sup.getWork(mid).state, 'held', 'an extra closing does not end the item');
        yzIssues.get(R(1179)).state = 'closed';
        await sup.pullIssues(gr, { force: true });
        assert.strictEqual(sup.getWork(mid).state, 'cancelled', 'the primary closing ends it, as today');
    });

    // ------------------------------------------------------------ #1276: a dispatch / the wizard that names an issue the hook already carded
    // makes no second item: the hook's Waiting item is adopted, a running one is answered for
    const FQ = 'DreamScape/StaticForge';
    const rowsOn = (n) => RAW().prepare('SELECT * FROM supervisor_work WHERE issue_repo = ? AND issue_number = ?').all(FQ, n);
    const totalRows = () => RAW().prepare('SELECT COUNT(*) AS n FROM supervisor_work').get().n;
    const rowOf = (id) => RAW().prepare('SELECT * FROM supervisor_work WHERE id = ?').get(id);
    // an issue filed on Yozora with the fleet label, pulled by the hook: its one item
    const hookIn = async (n, extra) => {
        putIssue(n, Object.assign({ external: true, title: `Hook issue ${n}`, body: `hook body ${n}` }, extra || {}));
        const r = await sup.pullIssues(gr, { force: true });
        assert.strictEqual(r.added, 1, `the hook carded #${n}: ${JSON.stringify(r)}`);
        const rows = rowsOn(n);
        assert.strictEqual(rows.length, 1, `one hook row on #${n}`);
        return rows[0];
    };
    const with1276 = async (fn) => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart;
        const realStart = launcher.start;
        const starts = [];
        let sid = 0;
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        launcher.start = async (g, o) => { starts.push(o); sid += 1; return { id: `eeeeeeee-1276-0000-0000-00000000${String(sid).padStart(4, '0')}`, state: 'connected', link: 'https://claude.ai/code/session_1276' }; };
        settingsCfg.agentSupervisor = Object.assign(settingsCfg.agentSupervisor, { maxConcurrent: 10, autoStart: false });
        try {
            await sup.pullIssues(gr, { force: true }); // issues earlier tests left on Yozora are carded first: a test's own pull adds exactly its issue
            await fn({ fleetMcp, starts });
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; settingsCfg.agentSupervisor.autoStart = false; }
    };

    await test('#1276 a: hook first, then dispatch: the issue\'s Waiting item is adopted (same id, one row), holding the dispatch\'s brief; the hook does not card it again', async () => {
        await with1276(async () => {
            const hook = await hookIn(2761);
            assert.deepStrictEqual([hook.state, hook.source, hook.source_ref], ['held', 'yozora', `issue:${R(2761)}`]);
            RAW().prepare('UPDATE supervisor_work SET check_json = ? WHERE id = ?').run('{"verdict":"stale"}', hook.id);
            const before = totalRows();
            const mark = yzCalls.length;
            const w = sup.enqueue({ title: 'Dispatch A', prompt: 'dispatch brief a', source: 'director', issues: [R(2761)], model: 'sonnet', effort: 'medium', cwd: tmp, startNow: false }, { gr });
            assert.strictEqual(w.id, hook.id, 'the same item');
            assert.strictEqual(w.adopted, true);
            assert.deepStrictEqual(w.joined, []);
            assert.strictEqual(totalRows(), before, 'no second row');
            assert.strictEqual(rowsOn(2761).length, 1);
            const row = rowOf(hook.id);
            assert.deepStrictEqual([row.title, row.prompt, row.source, row.source_ref, row.model, row.effort, row.cwd, row.state, row.start_now, row.message, row.check_json, row.created_at],
                ['Dispatch A', 'dispatch brief a', 'director', null, 'sonnet', 'medium', tmp, 'held', 0, 'Waiting to be started', null, hook.created_at]);
            assert.deepStrictEqual([row.issue_repo, row.issue_number, row.topology], [FQ, 2761, 'planner']);
            const again = await sup.pullIssues(gr, { force: true });
            assert.strictEqual(again.added, 0, JSON.stringify(again));
            assert.strictEqual(rowsOn(2761).length, 1);
            await settle(120);
            const sent = yzCalls.slice(mark);
            const said = sent.filter((c) => c.method === 'POST' && /issues\/2761\/comments$/.test(c.url));
            assert.strictEqual(said.length, 1, JSON.stringify(said));
            assert.strictEqual(said[0].body.body, `**Fleet:** Fleet item ${hook.id} took over the dispatched brief (the issue's waiting item was reused, no second item was made): dispatch brief a`);
            assert.ok(!sent.some((c) => c.method === 'PATCH' && c.body && c.body.state === 'closed'), 'nothing closed');
            assert.strictEqual(sent.filter((c) => /\/comments$/.test(c.url)).length, 1, 'no other comment');
            // a brief over 1500 characters is cut in the comment, kept whole on the item
            const h2 = await hookIn(2762);
            const m2 = yzCalls.length;
            sup.enqueue({ prompt: 'z'.repeat(1700), source: 'director', issues: [R(2762)] }, { gr });
            await settle(120);
            const cut = yzCalls.slice(m2).find((c) => /issues\/2762\/comments$/.test(c.url) && /took over/.test(c.body.body));
            assert.ok(cut && cut.body.body.endsWith(`${'z'.repeat(1500)}...`) && !cut.body.body.includes('z'.repeat(1501)), 'cut at 1500 characters');
            assert.strictEqual(sup.workPrompt(h2.id).length, 1700);
            assert.strictEqual(rowOf(h2.id).title, 'Hook issue 2762', 'no title given: the row keeps its own');
        });
    });

    await test('#1276 b: hook first, then dispatch with startNow: still one row, and it leaves Waiting (started with the dispatch\'s brief, not the issue text)', async () => {
        await with1276(async ({ starts }) => {
            const hook = await hookIn(2763);
            const before = totalRows();
            const w = sup.enqueue({ title: 'Dispatch B', prompt: 'dispatch brief b', source: 'director', issues: [R(2763)], model: 'sonnet', startNow: true }, { gr });
            assert.deepStrictEqual([w.id, w.adopted], [hook.id, true]);
            assert.strictEqual(totalRows(), before);
            await waitFor(() => sup.getWork(hook.id).state === 'running', 'the adopted item starts');
            assert.strictEqual(rowsOn(2763).length, 1);
            const s = starts.find((o) => o.workId === hook.id);
            assert.ok(s && s.prompt.startsWith('dispatch brief b') && !s.prompt.includes('hook body 2763'), s && s.prompt.slice(0, 80));
            assert.strictEqual(s.title, 'Dispatch B');
            assert.strictEqual((await sup.pullIssues(gr, { force: true })).added, 0);
            RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id = ?").run(hook.id);
        });
    });

    await test('#1276 c: dispatch first, then the hook: the hook finds the item by its issue and adds none', async () => {
        await with1276(async () => {
            const w = sup.enqueue({ title: 'Dispatch C', prompt: 'dispatch brief c', source: 'director', issues: [R(2764)] }, { gr });
            assert.ok(!w.adopted && !w.existing, 'nothing to take over: a new item as before');
            putIssue(2764, { external: true, title: 'Hook issue 2764', body: 'hook body 2764' });
            const r = await sup.pullIssues(gr, { force: true });
            assert.strictEqual(r.added, 0, JSON.stringify(r));
            assert.strictEqual(rowsOn(2764).length, 1);
            assert.strictEqual(rowsOn(2764)[0].id, w.id);
        });
    });

    await test('#1276 d: several issues in one dispatch, each carded by the hook: one adopted item carrying all (primary = first named), the others joined into it with no close and no cancel comment', async () => {
        await with1276(async () => {
            const a = await hookIn(2765);
            const b = await hookIn(2766);
            const c = await hookIn(2767);
            const before = totalRows();
            const mark = yzCalls.length;
            // named in another order than carded: the first NAMED issue's item is the one adopted
            const w = sup.enqueue({ title: 'Dispatch D', prompt: 'dispatch brief d', source: 'director', issues: [R(2766), R(2765), R(2767)] }, { gr });
            assert.deepStrictEqual([w.id, w.adopted, w.joined], [b.id, true, [a.id, c.id]]);
            assert.strictEqual(totalRows(), before);
            assert.deepStrictEqual(w.issues.map((i) => [i.number, i.primary]), [[2766, true], [2765, false], [2767, false]]);
            [a, c].forEach((x) => {
                const g = sup.getWork(x.id);
                assert.deepStrictEqual([g.state, g.joinedInto, g.message, g.startNow], ['cancelled', b.id, `Joined into item ${b.id} (one run)`, false]);
                assert.ok(rowOf(x.id).ended_at, 'ended');
            });
            assert.strictEqual(sup.getWork(b.id).state, 'held');
            assert.strictEqual(sup.workPrompt(b.id), 'dispatch brief d');
            await settle(150);
            const sent = yzCalls.slice(mark);
            assert.ok(!sent.some((x) => x.method === 'PATCH'), 'no close');
            assert.ok(!sent.some((x) => /\/comments$/.test(x.url) && /cancelled in Fleet/.test(x.body.body)), 'no cancel comment');
            assert.strictEqual(sent.filter((x) => /\/comments$/.test(x.url)).length, 1, 'one comment: the take-over, on the primary');
            assert.ok(/issues\/2766\/comments$/.test(sent.find((x) => /\/comments$/.test(x.url)).url));
            assert.strictEqual((await sup.pullIssues(gr, { force: true })).added, 0, 'the hook does not card the carried issues again');
            assert.strictEqual(totalRows(), before);
            // the first named issue has no item: the earliest named issue that has one is adopted and takes the first as its primary
            const e = await hookIn(2769);
            putIssue(2768);
            const w2 = sup.enqueue({ title: 'Dispatch D2', prompt: 'dispatch brief d2', source: 'director', issues: [R(2768), R(2769)] }, { gr });
            assert.deepStrictEqual([w2.id, w2.adopted, w2.joined], [e.id, true, []]);
            assert.deepStrictEqual(w2.issues.map((i) => [i.number, i.primary]), [[2768, true], [2769, false]]);
            assert.strictEqual((await sup.pullIssues(gr, { force: true })).added, 0);
        });
    });

    await test('#1276 e: the hook\'s item already runs: no second item and nothing changed; the answer says so', async () => {
        await with1276(async () => {
            const hook = await hookIn(2770);
            const sess = 'eeeeeeee-1276-1111-0000-000000000001';
            RAW().prepare("UPDATE supervisor_work SET state = 'running', session_id = ?, message = 'Running on Main' WHERE id = ?").run(sess, hook.id);
            const frozen = rowOf(hook.id);
            const before = totalRows();
            const w = sup.enqueue({ title: 'Dispatch E', prompt: 'dispatch brief e', source: 'director', issues: [R(2770)], startNow: true }, { gr });
            assert.deepStrictEqual([w.id, w.existing, w.adopted], [hook.id, true, undefined]);
            assert.strictEqual(w.note, `Work item ${hook.id} already runs ${R(2770)}: no second item was made. Steer its session instead.`);
            assert.strictEqual(totalRows(), before);
            assert.deepStrictEqual(rowOf(hook.id), frozen, 'the running item is untouched');
            assert.strictEqual(sup.workPrompt(hook.id), `Yozora issue ${R(2770)}: Hook issue 2770\nhttps://yozora.bluesteel.737.jp.net/${FQ}/issues/2770\n\nhook body 2770`);
            // every started state answers the same; with a waiting item on another named issue that one is adopted (the running one is left alone)
            ['waiting', 'input', 'starting'].forEach((st) => {
                RAW().prepare('UPDATE supervisor_work SET state = ? WHERE id = ?').run(st, hook.id);
                assert.deepStrictEqual([sup.enqueue({ prompt: 'again', source: 'director', issues: [R(2770)] }, { gr }).existing, totalRows()], [true, before], st);
            });
            const other = await hookIn(2771);
            const mix = sup.enqueue({ prompt: 'dispatch brief e2', source: 'director', issues: [R(2770), R(2771)] }, { gr });
            assert.deepStrictEqual([mix.id, mix.adopted], [other.id, true]);
            RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id IN (?, ?)").run(hook.id, other.id);
        });
    });

    await test('#1276 f: a plain new issue still gets exactly one Waiting item with the hook\'s brief', async () => {
        await with1276(async () => {
            const before = totalRows();
            const row = await hookIn(2772, { title: 'Plain 2772', body: 'plain body' });
            assert.strictEqual(totalRows(), before + 1);
            assert.deepStrictEqual([row.state, row.source, row.source_ref, row.title, row.start_now, row.message, row.issue_id], ['held', 'yozora', `issue:${R(2772)}`, 'Plain 2772', 0, 'Waiting to be started', 1]);
            assert.strictEqual(row.prompt, `Yozora issue ${R(2772)}: Plain 2772\nhttps://yozora.bluesteel.737.jp.net/${FQ}/issues/2772\n\nplain body`);
            assert.strictEqual((await sup.pullIssues(gr, { force: true })).added, 0);
            assert.strictEqual(totalRows(), before + 1);
        });
    });

    await test('#1276 g: everything else behaves as before: deliberate duplicates, separate, other sources, parts, finished hook items', async () => {
        await with1276(async () => {
            // two items that are not the hook's on one issue are still two items
            const p = sup.enqueue({ title: 'P', prompt: 'p', issue: R(2773) }, { gr });
            const q = sup.enqueue({ title: 'Q', prompt: 'q', issue: R(2773), source: 'director' }, { gr });
            assert.ok(p.id !== q.id && !p.adopted && !q.adopted && !q.existing);
            assert.strictEqual(rowsOn(2773).length, 2);
            // separate: true beside a hook item
            const h = await hookIn(2774);
            const s = sup.enqueue({ title: 'S', prompt: 's', issues: [R(2774)], source: 'director', separate: true }, { gr });
            assert.ok(s.id !== h.id && !s.adopted);
            assert.strictEqual(rowsOn(2774).length, 2);
            assert.strictEqual(rowOf(h.id).prompt, h.prompt, 'the hook item is as it was');
            // a source yozora item that names the issue, and a part (parentId), are never taken for an adoption
            const h2 = await hookIn(2775);
            const y = sup.enqueue({ title: 'Y', prompt: 'y', issues: [R(2775)], source: 'yozora', sourceRef: 'maint-error:1276-g' }, { gr });
            assert.ok(y.id !== h2.id && !y.adopted && !y.existing);
            const part = sup.enqueue({ title: 'Part', prompt: 'part', issues: [R(2775)], source: 'fleet', parentId: p.id }, { gr });
            assert.ok(part.id !== h2.id && !part.adopted && !part.existing && part.parentId === p.id);
            assert.strictEqual(rowsOn(2775).length, 3);
            RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id IN (?, ?)").run(part.id, y.id);
            // a finished hook item (done / failed / cancelled) is not adopted: a new item is made
            for (const [n, st] of [[2776, 'done'], [2777, 'failed'], [2778, 'cancelled']]) {
                const hk = await hookIn(n);
                RAW().prepare('UPDATE supervisor_work SET state = ? WHERE id = ?').run(st, hk.id);
                const nw = sup.enqueue({ title: `New ${n}`, prompt: `new ${n}`, issues: [R(n)], source: 'director' }, { gr });
                assert.ok(nw.id !== hk.id && !nw.adopted && !nw.existing, st);
                assert.strictEqual(rowOf(hk.id).state, st);
                assert.strictEqual(rowOf(hk.id).prompt, hk.prompt);
                assert.strictEqual(rowsOn(n).length, 2, st);
            }
            // a hook item that is a planned run (groups) or was joined into another is not a candidate either
            const hj = await hookIn(2779);
            RAW().prepare("UPDATE supervisor_work SET topology = 'groups' WHERE id = ?").run(hj.id);
            assert.ok(!sup.enqueue({ prompt: 'groups', issues: [R(2779)], source: 'director' }, { gr }).adopted);
            const hm = await hookIn(2790);
            RAW().prepare('UPDATE supervisor_work SET joined_into = ? WHERE id = ?').run(hj.id, hm.id);
            const nm = sup.enqueue({ prompt: 'joined', issues: [R(2790)], source: 'director' }, { gr });
            assert.ok(nm.id !== hm.id && !nm.adopted && !nm.existing);
            // an item of another source on the issue (the hook never carded it)
            const o = sup.enqueue({ title: 'O', prompt: 'o', issue: R(2780), source: 'fleet' }, { gr });
            const o2 = sup.enqueue({ title: 'O2', prompt: 'o2', issues: [R(2780)], source: 'director' }, { gr });
            assert.ok(o2.id !== o.id && !o2.adopted && !o2.existing);
        });
    });

    await test('#1276 h: an empty or too long brief naming a carded issue throws before anything is changed', async () => {
        await with1276(async () => {
            const hook = await hookIn(2781);
            const frozen = rowOf(hook.id);
            const before = totalRows();
            const mark = yzCalls.length;
            assert.throws(() => sup.enqueue({ title: 'T', prompt: '   ', issues: [R(2781)], source: 'director' }, { gr }), /needs a prompt/);
            assert.throws(() => sup.enqueue({ title: 'T', prompt: 'x'.repeat(60001), issues: [R(2781)], source: 'director' }, { gr }), /too long/);
            assert.deepStrictEqual(rowOf(hook.id), frozen);
            assert.strictEqual(totalRows(), before);
            await settle(80);
            assert.strictEqual(yzCalls.length, mark, 'nothing sent to Yozora');
        });
    });

    await test('#1276 i: mergeWork over a hook item and a director item still makes one new run and ends both as joined (its picks are never adopted)', async () => {
        await with1276(async ({ fleetMcp }) => {
            fleetMcp.pickForStart = async () => { throw new Error('no account in this test'); };
            const hook = await hookIn(2782);
            const dir = sup.enqueue({ title: 'Dir', prompt: 'dir brief', issues: [R(2783)], source: 'director' }, { gr });
            const mark = yzCalls.length;
            const r = sup.mergeWork([hook.id, dir.id], { gr });
            const nw = r.work;
            assert.ok(![hook.id, dir.id].includes(nw.id) && !nw.adopted && !nw.existing, JSON.stringify(nw));
            assert.deepStrictEqual(r.joined, [hook.id, dir.id]);
            assert.deepStrictEqual(nw.issues.map((i) => i.number), [2782, 2783]);
            [hook, dir].forEach((x) => { const g = sup.getWork(x.id); assert.deepStrictEqual([g.state, g.joinedInto, g.message], ['cancelled', nw.id, `Joined into item ${nw.id} (one run)`]); });
            await settle(120);
            const sent = yzCalls.slice(mark);
            assert.ok(!sent.some((x) => x.method === 'PATCH'), 'no close');
            assert.ok(!sent.some((x) => /\/comments$/.test(x.url) && /cancelled in Fleet|took over/.test(x.body.body)), 'no cancel or take-over comment');
            assert.strictEqual((await sup.pullIssues(gr, { force: true })).added, 0);
            RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id = ?").run(nw.id);
        });
    });

    await test('#1276 j: a queued hook item whose start is in flight (its account is being picked) is not taken over: the answer says it runs, and it starts with its own brief', async () => {
        await with1276(async ({ fleetMcp, starts }) => {
            let release = null;
            fleetMcp.pickForStart = () => new Promise((res) => { release = () => res({ index: 0, name: 'Main', settings: {} }); });
            const hook = await hookIn(2784, { now: true });
            await waitFor(() => release, 'the pump is picking an account');
            assert.strictEqual(sup.getWork(hook.id).state, 'queued', 'still queued in the row while the account is picked');
            assert.ok(sup._test.startsInFlight.has(hook.id), 'but its start is in flight');
            const before = totalRows();
            const w = sup.enqueue({ prompt: 'dispatch brief j', source: 'director', issues: [R(2784)] }, { gr });
            assert.deepStrictEqual([w.id, w.existing, w.adopted], [hook.id, true, undefined]);
            assert.strictEqual(totalRows(), before);
            assert.ok(sup.workPrompt(hook.id).includes('hook body 2784'), 'its brief is as it was');
            release();
            await waitFor(() => sup.getWork(hook.id).state === 'running', 'it starts');
            assert.ok(starts.find((o) => o.workId === hook.id).prompt.includes('hook body 2784'));
            assert.ok(!sup._test.startsInFlight.has(hook.id), 'nothing left in flight');
            RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id = ?").run(hook.id);
        });
    });

    await test('#1276 k: an item in the pump\'s snapshot that is taken over or folded before its turn starts with the new brief, a folded one never starts; a failed pick leaves nothing in flight', async () => {
        await with1276(async ({ fleetMcp, starts }) => {
            // park every other queued item so this pass sees only these
            const made = [];
            const parked = RAW().prepare("SELECT id FROM supervisor_work WHERE state = 'queued'").all().map((x) => x.id);
            RAW().prepare("UPDATE supervisor_work SET state = 'held' WHERE state = 'queued'").run();
            try {
                fleetMcp.pickForStart = async () => { throw new Error('no account yet'); };
                const x = sup.enqueue({ title: 'X', prompt: 'x brief 1276', startNow: true }, { gr });
                const y = await hookIn(2785, { now: true });
                const z = await hookIn(2786, { now: true });
                made.push(x.id, y.id, z.id);
                await settle(60);
                assert.deepStrictEqual([x.id, y.id, z.id].map((i) => sup.getWork(i).state), ['queued', 'queued', 'queued']);
                assert.ok([x.id, y.id, z.id].every((i) => !sup._test.startsInFlight.has(i)), 'a pick that failed leaves nothing in flight');
                const picks = [];
                fleetMcp.pickForStart = () => new Promise((res) => { picks.push(() => res({ index: 0, name: 'Main', settings: {} })); });
                const pass = sup.pumpWork(gr);
                await waitFor(() => picks.length === 1, 'the pass picks an account for the first item');
                assert.ok(sup._test.startsInFlight.has(x.id) && !sup._test.startsInFlight.has(y.id) && !sup._test.startsInFlight.has(z.id));
                // y and z are in the pass's snapshot, not reached yet: a dispatch takes y over and folds z into it
                const w = sup.enqueue({ title: 'Dispatch K', prompt: 'dispatch brief k', source: 'director', issues: [R(2785), R(2786)], startNow: true, model: 'sonnet' }, { gr });
                assert.deepStrictEqual([w.id, w.adopted, w.joined], [y.id, true, [z.id]]);
                fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
                picks[0]();
                await pass;
                await waitFor(() => sup.getWork(y.id).state === 'running', 'the adopted item starts');
                assert.deepStrictEqual(starts.map((o) => o.workId).sort(), [x.id, y.id].sort(), 'x and the adopted y started, the folded z never');
                const sy = starts.find((o) => o.workId === y.id);
                assert.ok(sy.prompt.startsWith('dispatch brief k') && !sy.prompt.includes(`Yozora issue ${R(2785)}: Hook issue 2785`), sy.prompt.slice(0, 60));
                assert.deepStrictEqual([sy.title, sy.model], ['Dispatch K', 'sonnet']);
                assert.strictEqual(sup.getWork(z.id).state, 'cancelled');
                assert.strictEqual(sup._test.startsInFlight.size, 0);
            } finally {
                made.forEach((i) => RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id = ?").run(i));
                parked.forEach((i) => RAW().prepare("UPDATE supervisor_work SET state = 'queued' WHERE id = ? AND state = 'held'").run(i));
            }
        });
    });

    await test('issues_open: open issues of a watched repo newest first with the item carrying each; a title filter; an unwatched repo is refused', async () => {
        [1501, 1502, 1503].forEach((i) => putIssue(i, { listed: true }));
        const carrier = sup.enqueue({ title: 'Carries 1502', prompt: 'c', issue: R(1502) });
        await settle(80);
        const r = await sup.issuesOpen(gr, {});
        assert.strictEqual(r.repo, 'DreamScape/StaticForge');
        assert.ok(r.repos.includes('DreamScape/StaticForge'));
        const byNum = new Map(r.issues.map((i) => [i.number, i]));
        assert.deepStrictEqual([...byNum.keys()].filter((n) => n >= 1500), [1501, 1502, 1503]);
        const one = byNum.get(1502);
        assert.deepStrictEqual([one.repo, one.title, one.url, one.labels, one.item], ['DreamScape/StaticForge', 'Runtime Compile 1502', 'https://yozora.bluesteel.737.jp.net/DreamScape/StaticForge/issues/1502', ['type:bug'], carrier.id]);
        assert.strictEqual(byNum.get(1501).item, null);
        assert.ok(typeof byNum.get(1501).id === 'number');
        const q = await sup.issuesOpen(gr, { q: '1503' });
        assert.deepStrictEqual(q.issues.map((i) => i.number), [1503]);
        await assert.rejects(() => sup.issuesOpen(gr, { repo: 'Nobody/Elsewhere' }), /not one of the watched repositories/);
    });

    await test('updateWork: remoteControl and issues (several) on an item that is not running; the socket op forwards them for the caller\'s own item', async () => {
        [1601, 1602].forEach((i) => putIssue(i));
        const w = sup.enqueue({ title: 'Edit issues', prompt: 'p' });
        const u = sup.updateWork(w.id, { remoteControl: true, issues: [R(1601), R(1602)] });
        assert.strictEqual(u.remoteControl, true);
        assert.deepStrictEqual(u.issues.map((i) => [i.number, i.primary]), [[1601, true], [1602, false]]);
        await settle(80);
        assert.strictEqual(sup.getWork(w.id).issues[1].title, 'Runtime Compile 1602');
        assert.strictEqual(sup.updateWork(w.id, { issues: [] }).issues.length, 1, 'an empty list drops the others, keeps the primary');
        assert.throws(() => sup.updateWork(w.id, { issues: 'no issue here' }), /name issues as owner\/repo#N/);
        assert.strictEqual(sup.updateWork(w.id, { remoteControl: false }).remoteControl, false);
    });

    await test('backstop: an ok review whose final answer waits on Yukimi becomes input (item 72); plain done stays ok; gaps stay gaps', async () => {
        const B = sup._test.waitBackstop;
        const ok = { verdict: 'ok', summary: 'fine', missed: [] };
        const a = B(ok, 'Nothing changed this turn, so there is nothing to commit. #1193 stays open for Yukimi\'s two answers (battery source, and what the tap should open).');
        // it never ends ok (item 72), but a statement is not a question for Yukimi (#1256): it goes back to the agent to ask plainly or finish
        assert.strictEqual(a.verdict, 'gaps');
        assert.ok(!a.questions || !a.questions.length, JSON.stringify(a.questions));
        assert.ok(/stays open/.test(a.missed[0].evidence), JSON.stringify(a.missed));
        const b = B(ok, 'Built it. Should the card say Plaud or Voice Notes? Which do you prefer?');
        assert.strictEqual(b.verdict, 'input');
        assert.ok(b.questions.some((q) => /Which do you prefer\?/.test(q.question)));
        assert.strictEqual(B(ok, 'Built, tested (12 passed) and pushed as abc123. Closing as done.').verdict, 'ok');
        assert.strictEqual(B({ verdict: 'gaps', missed: [{ item: 'x' }] }, 'stays open for your answers').verdict, 'gaps');
    });

    await test('input verdict: the parser keeps questions; answered ones are typed in, open ones wait as Input Required; Yukimi\'s answers send it back; input counts as active', async () => {
        const P = sup._test.parseVerdict;
        const pv = P('{"verdict":"ok","summary":"s","questions":[{"question":"Which login?","answer":"Build the login code","why":"its own job"},"Pay for it?"]}');
        assert.strictEqual(pv.verdict, 'input', 'ok with questions is input');
        assert.deepStrictEqual(pv.questions.map((q) => [q.question, q.answer]), [['Which login?', 'Build the login code'], ['Pay for it?', '']]);
        assert.strictEqual(P('{"verdict":"input","missed":[{"item":"x"}],"questions":["q"]}').verdict, 'gaps', 'gaps win, both are kept');
        assert.strictEqual(P('{"verdict":"input","missed":[{"item":"x"}],"questions":["q"]}').questions.length, 1);
        assert.strictEqual(P('{"verdict":"input","summary":"Waiting on the battery source"}').questions[0].question, 'Waiting on the battery source');
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart;
        const realStart = launcher.start;
        const realSteer = launcher.steer;
        const realResume = launcher.resume;
        const realFind = launcher.findFile;
        const typed = [];
        const resumed = [];
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        settingsCfg.agentSupervisor = Object.assign(settingsCfg.agentSupervisor, { maxConcurrent: 50, autoStart: true });
        let n = 0;
        launcher.start = async () => { n += 1; return { id: `eeeeeeee-0000-0000-0000-0000000004${String(n).padStart(2, '0')}`, state: 'running', link: '' }; };
        launcher.steer = async (id, text) => { typed.push([id, text]); return { sent: true }; };
        launcher.resume = async (g, id) => { resumed.push(id); return { id, state: 'connected' }; };
        launcher.findFile = async () => '/nonexistent/transcript.jsonl';
        try {
            const mk = async (title) => {
                const w = sup.enqueue({ title, prompt: `do ${title}`, topology: 'direct', startNow: true }, { gr });
                await waitFor(() => sup.getWork(w.id).state === 'running', `${title} running`);
                return sup.getWork(w.id);
            };
            // every question answered by the Supervisor: typed in, running again
            const a = await mk('InputAnswered');
            await sup.workAfterReview({ sessionId: a.sessionId, agentId: 'claude-x', verdict: 'input', missed: [], summary: 's', questions: [{ question: 'Needs another login?', answer: 'Fine: build the code that asks for the login and continue', why: 'its own job' }] });
            assert.strictEqual(sup.getWork(a.id).state, 'running');
            assert.match(sup.getWork(a.id).message, /Supervisor answered 1 question/);
            assert.ok(typed.length === 1 && typed[0][0] === a.sessionId && /answers to the questions you ended on/.test(typed[0][1]) && /asks for the login/.test(typed[0][1]) && /do not wait for Yukimi/.test(typed[0][1]), JSON.stringify(typed));
            // one open question: Input Required, nothing typed, questions saved (the answered one with the Supervisor's answer)
            const b = await mk('InputOpen');
            typed.length = 0;
            await sup.workAfterReview({ sessionId: b.sessionId, verdict: 'input', missed: [], summary: 's', questions: [{ question: 'Should I also test it?', answer: 'Yes', why: 'asked' }, { question: 'Spend 20 USD on credits?', answer: '', why: '' }] });
            const wb = sup.getWork(b.id);
            assert.strictEqual(wb.state, 'input');
            assert.match(wb.message, /^Input Required: Spend 20 USD/);
            assert.deepStrictEqual(wb.questions.map((q) => q.answer), ['Yes', '']);
            assert.strictEqual(typed.length, 0, 'nothing typed into the session yet');
            // a question that needs real work becomes a started work item and the agent is told so; Yukimi is not asked
            const pf = P('{"verdict":"input","questions":[{"question":"Commits are not on origin/main; who pushes them?","answer":"","followUp":{"title":"Land the missing commits","brief":"Merge them onto origin/main without losing work."}}]}');
            assert.strictEqual(pf.questions[0].followUp.title, 'Land the missing commits');
            const f = await mk('InputFollowUp');
            typed.length = 0;
            await sup.workAfterReview({ sessionId: f.sessionId, verdict: 'input', missed: [], summary: 's', questions: pf.questions });
            assert.strictEqual(sup.getWork(f.id).state, 'running', 'not Input Required');
            const fu = sup.listWork({ limit: 300 }).find((x) => x.title === 'Land the missing commits');
            assert.ok(fu && fu.startNow, 'the follow-up is queued to start now');
            await waitFor(() => !['queued', 'starting'].includes(sup.getWork(fu.id).state), 'follow-up started');
            assert.ok(typed.some(([id, t]) => id === f.sessionId && t.includes(`work item ${fu.id}`)), JSON.stringify(typed));
            // input is active: it carries its issue (issuesOpen) and holds no slot
            await assert.rejects(() => sup.answerWork(a.id, { answers: ['x'] }), /only an item that is Input Required/);
            // Yukimi answers: her text, else the Supervisor's proposal; a stopped session is resumed first
            const w2 = await sup.answerWork(b.id, { answers: ['', 'No, stay within the free quota'] });
            assert.strictEqual(w2.state, 'running');
            assert.match(w2.message, /Yukimi answered 2 questions/);
            assert.deepStrictEqual(w2.questions, []);
            assert.deepStrictEqual(resumed, [b.sessionId], 'its session was not live: resumed first');
            const sent = typed[typed.length - 1][1];
            assert.ok(/Should I also test it\? - Yes/.test(sent) && /Spend 20 USD on credits\? - No, stay within the free quota/.test(sent), sent);
            // input rows are active for the issue logic
            putIssue(1701, { listed: true });
            const c = sup.enqueue({ title: 'InputIssue', prompt: 'p', topology: 'direct', startNow: true, issues: [R(1701)] }, { gr });
            await waitFor(() => sup.getWork(c.id).state === 'running', 'c running');
            await sup.workAfterReview({ sessionId: sup.getWork(c.id).sessionId, verdict: 'input', missed: [], summary: 's', questions: [{ question: 'Which colour?', answer: '' }] });
            assert.strictEqual(sup.getWork(c.id).state, 'input');
            await settle(100);
            const open = await sup.issuesOpen(gr, {});
            assert.strictEqual((open.issues.find((i) => i.number === 1701) || {}).item, c.id, 'an Input Required item still carries its issue');
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; launcher.steer = realSteer; launcher.resume = realResume; launcher.findFile = realFind; }
    });

    await test('finished items work again: a busy session reopens its done item; a review that finds more reopens it; Send Back to Work steers and runs it; cancelled stays', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart;
        const realStart = launcher.start;
        const realSteer = launcher.steer;
        const realResume = launcher.resume;
        const realFind = launcher.findFile;
        const typed = [];
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        let n = 0;
        launcher.start = async () => { n += 1; return { id: `ffffffff-0000-0000-0000-0000000005${String(n).padStart(2, '0')}`, state: 'running', link: '' }; };
        launcher.steer = async (id, text) => { typed.push([id, text]); return { sent: true }; };
        launcher.resume = async (g, id) => ({ id, state: 'connected' });
        launcher.findFile = async () => '/nonexistent/transcript.jsonl';
        const rec = (sid, status) => fs.writeFileSync(path.join(tmp, '.claude', 'sessions', `${process.pid}88.json`), JSON.stringify({ pid: process.pid, sessionId: sid, status, cwd: tmp }));
        try {
            const a = sup.enqueue({ title: 'Reopen A', prompt: 'do A', topology: 'direct', startNow: true }, { gr });
            await waitFor(() => sup.getWork(a.id).state === 'running', 'a running');
            const sid = sup.getWork(a.id).sessionId;
            rec(sid, 'idle'); // its turn ended (a session still working keeps the item running)
            await sup.workAfterReview({ sessionId: sid, verdict: 'ok', missed: [], summary: 'done' });
            assert.strictEqual(sup.getWork(a.id).state, 'done');
            assert.ok(sup.getWork(a.id).endedAt);
            // the session is told to continue: it goes busy again
            rec(sid, 'idle'); sup._test.scan(false);
            assert.strictEqual(sup.getWork(a.id).state, 'done', 'idle is not working');
            rec(sid, 'busy'); sup._test.scan(false);
            assert.strictEqual(sup.getWork(a.id).state, 'running');
            assert.strictEqual(sup.getWork(a.id).endedAt, null);
            assert.match(sup.getWork(a.id).message, /^Working again/);
            // done again (its turn ended); an ok review leaves it done, a review with gaps reopens it
            rec(sid, 'idle');
            await sup.workAfterReview({ sessionId: sid, verdict: 'ok', missed: [], summary: 'done' });
            assert.strictEqual(sup.getWork(a.id).state, 'done');
            await sup.workAfterReview({ sessionId: sid, verdict: 'ok', missed: [], summary: 'again' });
            assert.strictEqual(sup.getWork(a.id).state, 'done');
            await sup.workAfterReview({ sessionId: sid, verdict: 'gaps', missed: [{ item: 'tests' }], summary: '' });
            assert.strictEqual(sup.getWork(a.id).state, 'waiting');
            assert.strictEqual(sup.getWork(a.id).endedAt, null);
            // Send Back to Work: only done / failed, needs a note, steers and runs
            await assert.rejects(() => sup.reopenWork(a.id, { note: 'x' }), /only a done or failed item/);
            rec(sid, 'idle');
            await sup.workAfterReview({ sessionId: sid, verdict: 'ok', missed: [], summary: 'done' });
            await assert.rejects(() => sup.reopenWork(a.id, { note: '  ' }), /Write what it should do next/);
            typed.length = 0;
            const r = await sup.reopenWork(a.id, { note: 'Also handle the empty case' });
            assert.strictEqual(r.state, 'running');
            assert.match(r.message, /^Working again: Also handle the empty case/);
            assert.ok(typed.length === 1 && /^\[Supervisor\] Sent back by Yukimi: Also handle the empty case/.test(typed[0][1]), JSON.stringify(typed));
            // cancelled items and items whose issue closed are never reopened
            await sup.workAfterReview({ sessionId: sid, verdict: 'ok', missed: [], summary: 'done' });
            RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id = ?").run(a.id);
            rec(sid, 'idle'); sup._test.scan(false); rec(sid, 'busy'); sup._test.scan(false);
            assert.strictEqual(sup.getWork(a.id).state, 'cancelled');
            RAW().prepare("UPDATE supervisor_work SET state = 'done', message = ? WHERE id = ?").run('Its issue was closed on Yozora', a.id);
            await sup.workAfterReview({ sessionId: sid, verdict: 'gaps', missed: [{ item: 'x' }], summary: '' });
            assert.strictEqual(sup.getWork(a.id).state, 'done', 'a closed issue is not reopened');
            // an issue Fleet's own sync closed is reopened when the session works again; one Yukimi closed stays closed
            RAW().prepare("UPDATE supervisor_work SET issue_repo = 'DreamScape/StaticForge', issue_number = 7193 WHERE id = ?").run(a.id);
            yzIssues.set('DreamScape/StaticForge#7193', { state: 'closed', closedBy: 'yukimi', title: 't' });
            rec(sid, 'idle'); sup._test.scan(false); rec(sid, 'busy'); sup._test.scan(false);
            await new Promise((res) => setTimeout(res, 50));
            assert.strictEqual(sup.getWork(a.id).state, 'done', 'closed by Yukimi: stays done');
            assert.strictEqual(yzIssues.get('DreamScape/StaticForge#7193').state, 'closed');
            yzIssues.get('DreamScape/StaticForge#7193').closedBy = 'director.yozora';
            rec(sid, 'idle'); sup._test.scan(false); rec(sid, 'busy'); sup._test.scan(false);
            await waitFor(() => sup.getWork(a.id).state === 'running', 'fleet-closed issue reopens');
            assert.strictEqual(yzIssues.get('DreamScape/StaticForge#7193').state, 'open');
            // Send Back to Work reopens its issue whoever closed it
            RAW().prepare("UPDATE supervisor_work SET state = 'done', message = ? WHERE id = ?").run('Its issue was closed on Yozora', a.id);
            yzIssues.set('DreamScape/StaticForge#7193', { state: 'closed', closedBy: 'yukimi', title: 't' });
            await sup.reopenWork(a.id, { note: 'Finish the login' });
            assert.strictEqual(sup.getWork(a.id).state, 'running');
            assert.strictEqual(yzIssues.get('DreamScape/StaticForge#7193').state, 'open');
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; launcher.steer = realSteer; launcher.resume = realResume; launcher.findFile = realFind; }
    });

    await test('in flight: an ok review with a running background agent keeps the item running; settleWork ends it when the agent finished; a queued review keeps it Active; nothing in flight is done as before', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart;
        const realStart = launcher.start;
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        let n = 0;
        launcher.start = async () => { n += 1; return { id: `eeeeeeee-0000-0000-0000-0000000007${String(n).padStart(2, '0')}`, state: 'running', link: '' }; };
        const mkAgent = (sid, agentId, meta, ageMs) => {
            const dir = path.join(tmp, '.claude', 'projects', '-repo', sid, 'subagents');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
            const jf = path.join(dir, `agent-${agentId}.jsonl`);
            fs.writeFileSync(jf, '{}\n');
            const t = new Date(Date.now() - (ageMs || 0));
            fs.utimesSync(jf, t, t);
            return path.join(dir, `agent-${agentId}.meta.json`);
        };
        try {
            const mk = async (title) => {
                const a = sup.enqueue({ title, prompt: 'x', topology: 'direct', startNow: true }, { gr });
                await sup.pumpWork(gr);
                await sup.pumpWork(gr);
                await waitFor(() => sup.getWork(a.id).state === 'running', `${title} running ${JSON.stringify(sup.getWork(a.id))}`);
                const sid = sup.getWork(a.id).sessionId;
                fs.writeFileSync(path.join(tmp, '.claude', 'projects', '-repo', `${sid}.jsonl`), '');
                return { id: a.id, sid };
            };
            // nothing in flight: done as before
            const plain = await mk('Plain');
            await sup.workAfterReview({ sessionId: plain.sid, verdict: 'ok', missed: [], summary: 'fine' });
            assert.strictEqual(sup.getWork(plain.id).state, 'done');
            // a running background agent: the item stays running with the reason
            const a = await mk('Planner');
            const metaFile = mkAgent(a.sid, 'a1111111111111111', { description: 'worker', requestShape: 'background' }, 1000);
            mkAgent(a.sid, 'a2222222222222222', { description: 'old', finished: true }, 1000);
            mkAgent(a.sid, 'a3333333333333333', { description: 'stale' }, 30 * 60 * 1000);
            const f = sup.sessionInFlight(a.sid, { fresh: true });
            assert.strictEqual(f.bgAgents, 1, 'only the unfinished, recently active agent runs');
            assert.match(f.why, /1 agent/);
            RAW().prepare('INSERT INTO supervisor_reviews (session_id, at, trigger, verdict, summary) VALUES (?, ?, ?, ?, ?)').run(a.sid, Date.now(), 'turn-end', 'ok', 'all planned');
            await sup.workAfterReview({ sessionId: a.sid, verdict: 'ok', missed: [], summary: 'all planned' });
            assert.strictEqual(sup.getWork(a.id).state, 'running');
            assert.match(sup.getWork(a.id).message, /^Background work still running: 1 agent/);
            assert.strictEqual(sup.settleWork(a.sid), false, 'still running: stays');
            // the agent finishes: settleWork makes it done from the last ok review
            fs.writeFileSync(metaFile, JSON.stringify({ description: 'worker', finished: true }));
            assert.strictEqual(sup.settleWork(a.sid), true);
            assert.strictEqual(sup.getWork(a.id).state, 'done');
            assert.strictEqual(sup.getWork(a.id).message, 'all planned');
            // a queued review keeps an item Active with the checking note; an ok review while another is queued stays running
            const b = await mk('Queued');
            sup._test.queue.push({ sessionId: b.sid, trigger: 'turn-end' }); // a review waiting in the queue
            await sup.workAfterReview({ sessionId: b.sid, verdict: 'ok', missed: [], summary: 'ok' });
            assert.strictEqual(sup.getWork(b.id).state, 'running');
            assert.strictEqual(sup.getWork(b.id).message, 'The Supervisor is checking its last turn');
            sup._test.queue.length = 0;
            // a review that gets queued sets the note on its running item
            const c = await mk('Checking');
            sup._test.queueReview(c.sid, 'turn-end');
            assert.strictEqual(sup.getWork(c.id).state, 'running', 'stays Active, never done during a review');
            assert.ok(sup.listWork().some((w) => w.id === c.id && ['starting', 'running', 'waiting'].includes(w.state)));
            sup._test.queue.length = 0;
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; }
    });

    // ------------------------------------------------------------ Nov 25 2026: no false collisions, no deadlock, holds and waits end by themselves
    await test('shell parser: read-only commands are not edits; sed -i, redirects, tee, mv / cp, git checkout --, python writes are', () => {
        const { shellWritePaths: W } = require('../modules/agentCoord/activityIndex');
        const none = ['git log origin/main..HEAD', 'curl -A "Mozilla/5.0" https://x.test/st.js', 'cat a.js | grep foo > /dev/null', 'sed -n 1,5p modules/a.js', 'node --check modules/a.js', 'git add modules/a.js && git commit -m "x"', 'git diff modules/a.js', 'git show HEAD:modules/a.js', 'ls modules/ 2>/dev/null', 'grep -rn foo modules/ | head', 'echo "a > b.js"', 'git status --short', 'node scripts/test-x.js'];
        none.forEach((c) => assert.deepStrictEqual(W(c), [], c));
        assert.deepStrictEqual(W('sed -i "s/a/b/" modules/a.js'), ['modules/a.js']);
        assert.deepStrictEqual(W("sed -i -e 's/a/b/' k.js m.js"), ['k.js', 'm.js']);
        assert.deepStrictEqual(W('echo hi > out.txt'), ['out.txt']);
        assert.deepStrictEqual(W('echo x >> a/b.js 2>&1'), ['a/b.js']);
        assert.deepStrictEqual(W('cat > f.js <<EOF\nhello > no.js\nEOF'), ['f.js']);
        assert.deepStrictEqual(W('printf x | tee -a log.txt'), ['log.txt']);
        assert.deepStrictEqual(W('mv a.js b.js && cp b.js c.js'), ['b.js', 'c.js']);
        assert.deepStrictEqual(W('git checkout -- modules/a.js'), ['modules/a.js']);
        assert.deepStrictEqual(W('git checkout main'), []);
        assert.deepStrictEqual(W('git restore --source=HEAD~1 q.js'), ['q.js']);
        assert.deepStrictEqual(W('python3 - <<E\nopen("z.py","w").write(1)\nE'), ['z.py']);
        assert.deepStrictEqual(W('node -e "require(\'fs\').writeFileSync(\'w.json\', \'{}\')"'), ['w.json']);
        assert.deepStrictEqual(W('bash -c "echo 1 > inner.js"'), ['inner.js']);
        assert.deepStrictEqual(W('*** Begin Patch\n*** Update File: modules/p.js\n*** End Patch'), ['modules/p.js']);
        assert.deepStrictEqual(W('echo x > /tmp/scratch.txt'), []);
    });

    await test('parseVerdict: waitsOn is kept with its kind, who, paths and what; an unknown kind or no description is dropped', () => {
        const P = sup._test.parseVerdict;
        const v = P('{"verdict":"ok","summary":"s","waitsOn":{"kind":"commit","who":"ba605089","paths":["./modules/a.js"],"what":"ba605089 to commit modules/a.js"}}');
        assert.deepStrictEqual(v.waitsOn, { kind: 'commit', who: 'ba605089', paths: ['modules/a.js'], what: 'ba605089 to commit modules/a.js' });
        assert.strictEqual(P('{"verdict":"ok","waitsOn":{"kind":"mood","what":"x"}}').waitsOn, undefined);
        assert.strictEqual(P('{"verdict":"ok","waitsOn":{"kind":"build"}}').waitsOn, undefined);
        assert.strictEqual(P('{"verdict":"ok","waitsOn":null}').waitsOn, undefined);
    });

    await test('standing rule: the review prompt makes the Supervisor own completion; a "which option do you prefer" question with a recommended option is answered, not escalated', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart; const realStart = launcher.start; const realSteer = launcher.steer;
        const typed = [];
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        launcher.start = async () => ({ id: 'eeeeeeee-0000-0000-0000-000000000901', state: 'running', link: '' });
        launcher.steer = async (id, t) => { typed.push(t); return { sent: true }; };
        settingsCfg.agentSupervisor = Object.assign(settingsCfg.agentSupervisor, { maxConcurrent: 50, autoStart: true, delivery: 'steer' });
        const prompts = [];
        sup._test.setFetch(async (url, opts) => { const b = JSON.parse(opts.body); prompts.push(b.messages[0].content); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict: 'input', summary: 'asks which option', questions: [{ question: 'Which option do you prefer, A or B? (B is recommended)', answer: 'Decided by the Supervisor: B, the recommended option', why: 'recommended' }] }) } }] }) }; });
        try {
            const w = sup.enqueue({ title: 'Options', prompt: 'do options', topology: 'direct', startNow: true }, { gr });
            await waitFor(() => sup.getWork(w.id).state === 'running', 'running');
            const sid = sup.getWork(w.id).sessionId;
            const tf = path.join(tmp, '.claude', 'projects', '-repo', `${sid}.jsonl`);
            fs.writeFileSync(tf, [user('do options', '2026-11-25T10:00:00Z'), asst([{ type: 'text', text: 'Which option do you prefer, A or B? B is recommended.' }], '2026-11-25T10:00:05Z')].join(''));
            const rv = await sup.review(sid, 'recheck', { gr });
            assert.match(prompts[0], /take control of getting the task completed and fully tested and reviewed/);
            assert.match(prompts[0], /spending money, a secret \/ password \/ login only she has, creating an account only she can make, or an irreversible outward action/);
            assert.match(prompts[0], /never escalated/);
            assert.strictEqual(rv.verdict, 'input');
            assert.ok(rv.questions[0].answer.length > 0);
            assert.strictEqual(sup.getWork(w.id).state, 'running', 'answered by the Supervisor, not Input Required');
            assert.ok(typed.some((t) => /answers to the questions you ended on/.test(t) && /B, the recommended option/.test(t)), JSON.stringify(typed));
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; launcher.steer = realSteer; settingsCfg.agentSupervisor.delivery = 'inbox'; }
    });

    const A1 = '11111111-aaaa-bbbb-cccc-000000000001'; const B1 = '22222222-aaaa-bbbb-cccc-000000000002';
    const mkLive = (ids) => new Map(ids.map(([id, status, name]) => [id, { id, cwd: '/r', status, givenName: name, pid: 1 }]));
    function collisionWorld(over) {
        const w = { live: new Map(), tool: {}, shell: {}, commit: { at: 0, hash: '' }, dirty: true };
        const deps = {
            live: () => w.live, rootOf: () => '/r',
            tool: (sid) => w.tool[sid] || [], shell: (sid) => w.shell[sid] || new Map(),
            git: { lastCommit: () => w.commit, differs: () => w.dirty, gitLogPath: () => '' }
        };
        sup._test.setCollisionDeps(deps);
        return Object.assign(w, over || {});
    }

    await test('collision: only the later editor is held, the first is told to commit including the other\'s hunks; no second hold, no deadlock', async () => {
        const realSteer = launcher.steer; const realInt = launcher.interrupt;
        const typed = [];
        launcher.steer = async (id, t) => { typed.push([id, t]); return { sent: true }; };
        launcher.interrupt = async () => ({ interrupted: true });
        const w = collisionWorld();
        w.live = mkLive([[A1, 'idle', 'alpha'], [B1, 'busy', 'beta']]);
        const t0 = Date.now() - 600000;
        w.tool[A1] = [{ path: 'modules/ws/handlers/314.js', first: t0, last: t0 + 1000 }];
        w.tool[B1] = [{ path: 'modules/ws/handlers/314.js', first: t0 + 200000, last: t0 + 210000 }];
        w.commit = { at: t0 - 100000, hash: 'old1234' };
        const s = { autoPauseOnCollision: true, managerSessionId: '' };
        try {
            // checked from the first editor's turn end, and again from the later one's: one hold, the later editor's
            await sup.checkCollisions(A1, s);
            await sup.checkCollisions(B1, s);
            const holds = sup.listHolds().filter((h) => h.kind === 'collision');
            assert.deepStrictEqual(holds.map((h) => [h.sessionId, h.other]), [[B1, A1]], JSON.stringify(holds));
            assert.ok(typed.some(([id, t]) => id === B1 && /PAUSE/.test(t)), 'the later editor is paused');
            const tellFirst = typed.filter(([id]) => id === A1);
            assert.ok(tellFirst.length === 1 && /Commit that file now/.test(tellFirst[0][1]) && /including the other session's hunks/.test(tellFirst[0][1]), JSON.stringify(typed));
            assert.ok(sup._test.watchState().timer, 'the 60 s timer exists while a hold is open');
            // a busy first editor is not typed into (inbox note only): fresh pair with the busy one first
        } finally {
            for (const h of sup.listHolds()) await sup.resumeSession(h.sessionId).catch(() => {});
            launcher.steer = realSteer; launcher.interrupt = realInt; sup._test.setCollisionDeps({});
        }
        assert.ok(!sup._test.watchState().timer, 'no timer once no hold is open');
    });

    await test('collision: no hold when the other side is itself held, for the Manager Session, or for the counterpart of an open hold', async () => {
        const realSteer = launcher.steer; const realInt = launcher.interrupt;
        launcher.steer = async () => ({ sent: true }); launcher.interrupt = async () => ({ interrupted: true });
        const C1 = '33333333-aaaa-bbbb-cccc-000000000003';
        const w = collisionWorld();
        w.live = mkLive([[A1, 'idle', 'alpha'], [B1, 'idle', 'beta'], [C1, 'idle', 'gamma']]);
        const t0 = Date.now() - 600000;
        const same = (first) => [{ path: 'f.js', first, last: first + 5000 }];
        w.tool[A1] = same(t0); w.tool[B1] = same(t0 + 100000);
        w.commit = { at: t0 - 1000, hash: 'x' };
        try {
            // the other side (A1, the first editor) is held by hand: nobody is held for the collision
            w.live = mkLive([[A1, 'idle', 'alpha'], [B1, 'idle', 'beta']]);
            await sup.pauseSession(A1, { mode: 'hold', reason: 'merging', by: 'Fleet' });
            await sup.checkCollisions(B1, { autoPauseOnCollision: true, managerSessionId: '' });
            assert.deepStrictEqual(sup.listHolds().filter((h) => h.kind === 'collision'), []);
            await sup.resumeSession(A1);
            // the Manager Session is never held
            await sup.checkCollisions(B1, { autoPauseOnCollision: true, managerSessionId: B1 });
            assert.ok(!sup.listHolds().some((h) => h.sessionId === B1), 'manager is not held');
            // B1 is held for A1 (A1 edited first)
            await sup.checkCollisions(B1, { autoPauseOnCollision: true, managerSessionId: '' });
            assert.deepStrictEqual(sup.listHolds().filter((h) => h.kind === 'collision').map((h) => [h.sessionId, h.other]), [[B1, A1]]);
            // a second file where B1 edited first and A1 later: A1 is the counterpart of the open hold and B1 is held: nobody else is held
            w.tool[B1] = w.tool[B1].concat([{ path: 'g.js', first: t0, last: t0 + 1000 }]);
            w.tool[A1] = w.tool[A1].concat([{ path: 'g.js', first: t0 + 300000, last: t0 + 310000 }]);
            await sup.checkCollisions(A1, { autoPauseOnCollision: true, managerSessionId: '' });
            assert.ok(!sup.listHolds().some((h) => h.sessionId === A1), 'the counterpart of an open hold is never held');
            assert.strictEqual(sup.listHolds().filter((h) => h.kind === 'collision').length, 1, 'never two holds for one pair');
            // a third session colliding with the held B1 only (C1 later than B1 on h.js): B1 is held, so C1 is not held over it
            w.live = mkLive([[A1, 'idle', 'alpha'], [B1, 'idle', 'beta'], [C1, 'idle', 'gamma']]);
            w.tool[B1] = w.tool[B1].concat([{ path: 'h.js', first: t0, last: t0 + 1000 }]);
            w.tool[C1] = [{ path: 'h.js', first: t0 + 300000, last: t0 + 310000 }];
            await sup.checkCollisions(C1, { autoPauseOnCollision: true, managerSessionId: '' });
            assert.ok(!sup.listHolds().some((h) => h.sessionId === C1), 'no hold while the other side is itself held');
        } finally {
            for (const h of sup.listHolds()) await sup.resumeSession(h.sessionId).catch(() => {});
            launcher.steer = realSteer; launcher.interrupt = realInt; sup._test.setCollisionDeps({});
        }
    });

    await test('hold ends when the other side commits (named with the commit), when the file equals HEAD, and after 20 minutes', async () => {
        const realSteer = launcher.steer; const realInt = launcher.interrupt;
        const typed = [];
        launcher.steer = async (id, t) => { typed.push([id, t]); return { sent: true }; };
        launcher.interrupt = async () => ({ interrupted: true });
        const w = collisionWorld();
        w.live = mkLive([[A1, 'idle', 'ba605089'], [B1, 'idle', 'beta']]);
        const t0 = Date.now() - 600000;
        w.tool[A1] = [{ path: 'modules/ws/handlers/314-claudeDeskHandler.js', first: t0, last: t0 + 1000 }];
        w.tool[B1] = [{ path: 'modules/ws/handlers/314-claudeDeskHandler.js', first: t0 + 100000, last: t0 + 110000 }];
        w.commit = { at: t0 - 1000, hash: 'old' };
        const s = { autoPauseOnCollision: true, managerSessionId: '' };
        try {
            await sup.checkCollisions(B1, s);
            assert.strictEqual(sup.listHolds().length, 1);
            assert.strictEqual(await sup.recheckHolds(), 0, 'still overlapping: stays');
            // the counterpart commits the file: held session continues with the note naming what changed
            w.commit = { at: Date.now() + 1000, hash: 'ead32be74' };
            w.dirty = false;
            assert.strictEqual(await sup.recheckHolds(), 1);
            assert.strictEqual(sup.listHolds().length, 0);
            const resumeNote = typed.filter(([id, t]) => id === B1 && /RESUME/.test(t)).pop();
            assert.match(resumeNote[1], /ba605089 committed 314-claudeDeskHandler\.js in ead32be74: continue/);
            assert.ok(!sup._test.watchState().timer);
            // the file equals HEAD again (nobody committed it by name): the overlap is gone
            w.commit = { at: t0 - 1000, hash: 'old' }; w.dirty = true;
            await sup.checkCollisions(B1, s);
            assert.strictEqual(sup.listHolds().length, 1);
            w.dirty = false;
            await sup.recheckHolds();
            assert.strictEqual(sup.listHolds().length, 0);
            assert.match(typed.filter(([id, t]) => id === B1 && /RESUME/.test(t)).pop()[1], /no longer differs from HEAD|committed|released/);
            // 20 minutes: resumed anyway
            w.dirty = true;
            await sup.checkCollisions(B1, s);
            assert.strictEqual(sup.listHolds().length, 1);
            assert.strictEqual(await sup.recheckHolds(), 0);
            require('../modules/agentCoord/store').open().prepare('UPDATE supervisor_holds SET at = ? WHERE ended_at IS NULL').run(Date.now() - 21 * 60000);
            assert.strictEqual(await sup.recheckHolds(), 1);
            assert.match(typed.filter(([id, t]) => id === B1 && /RESUME/.test(t)).pop()[1], /commit the file including the other session's hunks, then continue/);
        } finally {
            for (const h of sup.listHolds()) await sup.resumeSession(h.sessionId).catch(() => {});
            launcher.steer = realSteer; launcher.interrupt = realInt; sup._test.setCollisionDeps({});
        }
    });

    await test('a turn that ends waiting for a commit continues by itself when the commit lands; a wait nobody can watch is reminded after 15 minutes (3 times at most)', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart; const realStart = launcher.start; const realSteer = launcher.steer;
        const typed = [];
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        let n = 0;
        launcher.start = async () => { n += 1; return { id: `eeeeeeee-0000-0000-0000-0000000007${String(n).padStart(2, '0')}`, state: 'running', link: '' }; };
        launcher.steer = async (id, t) => { typed.push([id, t]); return { sent: true }; };
        settingsCfg.agentSupervisor = Object.assign(settingsCfg.agentSupervisor, { maxConcurrent: 50, autoStart: true });
        const world = collisionWorld();
        try {
            const it = sup.enqueue({ title: 'Waits', prompt: 'waits', topology: 'direct', startNow: true }, { gr });
            await waitFor(() => sup.getWork(it.id).state === 'running', 'running');
            const sid = sup.getWork(it.id).sessionId;
            world.live = mkLive([[sid, 'idle', 'waiter']]);
            await sup.workAfterReview({ sessionId: sid, verdict: 'ok', missed: [], summary: 'waiting', waitsOn: { kind: 'commit', who: 'ba605089', paths: ['x.js'], what: 'ba605089 to commit x.js' } });
            assert.strictEqual(sup.getWork(it.id).state, 'running', 'not done, not Input Required');
            assert.strictEqual(sup.getWork(it.id).message, 'Waiting for ba605089 to commit x.js');
            assert.strictEqual(sup._test.openWaits().length, 1);
            assert.ok(sup._test.watchState().timer, 'timer exists only while a wait is open');
            typed.length = 0;
            await sup.recheckWaits();
            assert.strictEqual(typed.length, 0, 'x.js is still uncommitted');
            world.dirty = false; world.commit = { at: Date.now() + 1000, hash: 'abc1234' };
            await sup.recheckAll();
            assert.strictEqual(typed.length, 1);
            assert.match(typed[0][1], /^\[Supervisor\] ba605089 to commit x\.js is done \(x\.js committed in abc1234\): continue the work now\./);
            assert.match(sup.getWork(it.id).message, /^Continuing: ba605089 to commit x\.js is done/);
            assert.strictEqual(sup._test.openWaits().length, 0);
            assert.ok(!sup._test.watchState().timer);
            // an unwatchable wait (no paths, no known agent): after 15 minutes "check and continue", at most 3 times
            await sup.workAfterReview({ sessionId: sid, verdict: 'ok', missed: [], summary: 'w2', waitsOn: { kind: 'commit', who: 'someone', paths: [], what: 'someone to commit' } });
            typed.length = 0;
            const raw = () => require('../modules/agentCoord/store').open();
            for (let i = 0; i < 5; i += 1) {
                raw().prepare('UPDATE supervisor_waits SET at = at - 1000000, last_nudge_at = CASE WHEN last_nudge_at IS NULL THEN NULL ELSE last_nudge_at - 1000000 END WHERE ended_at IS NULL').run();
                await sup.recheckWaits();
            }
            const nudges = typed.filter(([, t]) => /Check whether someone to commit is clear now and continue; do not wait for Yukimi\./.test(t));
            assert.strictEqual(nudges.length, 3, JSON.stringify(typed));
            // the session going busy again ends the wait without a word
            await sup.workAfterReview({ sessionId: sid, verdict: 'ok', missed: [], summary: 'w3', waitsOn: { kind: 'agent', who: 'x', paths: [], what: 'x to finish' } });
            world.live = mkLive([[sid, 'busy', 'waiter']]);
            typed.length = 0;
            await sup.recheckWaits();
            assert.strictEqual(typed.length, 0); assert.strictEqual(sup._test.openWaits().length, 0);
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; launcher.steer = realSteer; sup._test.setCollisionDeps({}); }
    });

    await test('a dead session of a running item is resumed with the note (once per call, 3 an hour, then failed); a cancelled item or a held session is never resumed', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart; const realStart = launcher.start; const realSteer = launcher.steer; const realResume = launcher.resume;
        const typed = []; const resumed = []; const picks = [];
        fleetMcp.pickForStart = async (g, want) => { picks.push(want); return { index: 2, name: 'Second', settings: {} }; };
        let n = 0;
        launcher.start = async () => { n += 1; return { id: `eeeeeeee-0000-0000-0000-0000000008${String(n).padStart(2, '0')}`, state: 'running', link: '' }; };
        launcher.steer = async (id, t) => { typed.push([id, t]); return { sent: true }; };
        launcher.resume = async (g, id, o) => { resumed.push([id, o && o.account]); return { id, state: 'connected' }; };
        settingsCfg.agentSupervisor = Object.assign(settingsCfg.agentSupervisor, { maxConcurrent: 50, autoStart: true });
        const world = collisionWorld(); // no live sessions: every session is dead
        sup._test.setRevive(true);
        try {
            const it = sup.enqueue({ title: 'Dies', prompt: 'dies', topology: 'direct', startNow: true, account: 'Main' }, { gr });
            await waitFor(() => sup.getWork(it.id).state === 'running', 'running');
            const sid = sup.getWork(it.id).sessionId;
            const r1 = await sup.maybeRevive(it.id, { missed: [{ item: 'run the tests' }], waitsOn: { kind: 'commit', what: 'ba605089 to commit x.js' } });
            assert.strictEqual(r1, 'resumed');
            assert.deepStrictEqual(resumed, [[sid, 2]]);
            assert.deepStrictEqual(picks[0], 'Main', 'its own account is asked first');
            const note = typed[typed.length - 1][1];
            assert.match(note, /^\[Supervisor\] Your session stopped \(.+\) and was started again: carry on from where you were; Open gaps: \(1\) run the tests You were waiting for ba605089 to commit x\.js/);
            assert.strictEqual(sup.getWork(it.id).state, 'running');
            assert.strictEqual(await sup.maybeRevive(it.id, null), 'resumed');
            assert.strictEqual(await sup.maybeRevive(it.id, null), 'resumed');
            assert.strictEqual(resumed.length, 3);
            assert.strictEqual(await sup.maybeRevive(it.id, null), 'failed', 'a fourth stop within the hour fails the item');
            assert.strictEqual(resumed.length, 3, 'not resumed a fourth time');
            assert.strictEqual(sup.getWork(it.id).state, 'failed');
            assert.match(sup.getWork(it.id).message, /giving up/);
            // a cancelled item is never resumed
            const c = sup.enqueue({ title: 'Cancelled', prompt: 'c', topology: 'direct' }, { gr });
            sup.cancelWork(c.id);
            require('../modules/agentCoord/store').open().prepare("UPDATE supervisor_work SET session_id = 'cccccccc-0000-0000-0000-000000000001' WHERE id = ?").run(c.id);
            resumed.length = 0;
            assert.strictEqual(await sup.maybeRevive(c.id, null), '');
            assert.strictEqual(resumed.length, 0);
            // an item whose session is under a hold is never resumed
            const h = await sup.pauseSession('dddddddd-0000-0000-0000-000000000001', { mode: 'hold' }).catch(() => null);
            assert.strictEqual(h, null, 'it was not live, so it cannot be held (nothing to resume)');
        } finally { sup._test.setRevive(false); fleetMcp.pickForStart = realPick; launcher.start = realStart; launcher.steer = realSteer; launcher.resume = realResume; sup._test.setCollisionDeps({}); }
    });

    await test('steer cap: gaps that survive two Supervisor rounds go to a started follow-up item, not an inbox', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart; const realStart = launcher.start; const realSteer = launcher.steer;
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        let n = 0;
        launcher.start = async () => { n += 1; return { id: `abababab-0000-0000-0000-0000000009${String(n).padStart(2, '0')}`, state: 'running', link: '' }; };
        launcher.steer = async () => ({ sent: true });
        try {
            const w = sup.enqueue({ title: 'CapItem', prompt: 'do cap', topology: 'direct', startNow: true }, { gr });
            await waitFor(() => sup.getWork(w.id).state === 'running', 'cap running');
            const sid = sup.getWork(w.id).sessionId;
            sup.markSupervised(sid);
            RAW().prepare("INSERT INTO supervisor_state (session_id, status, supervised, auto_steers, updated_at) VALUES (?, 'seen', 1, 2, ?) ON CONFLICT(session_id) DO UPDATE SET auto_steers = 2").run(sid, Date.now());
            const ins = RAW().prepare("INSERT INTO supervisor_reviews (session_id, agent_id, title, account, at, trigger, verdict, summary, request, steering, missed) VALUES (?, 'claude-x', 't', '', ?, 'turn-end', 'gaps', 's', 'r', '[]', ?)").run(sid, Date.now(), JSON.stringify([{ item: 'Watch the reload before logon', evidence: 'not observed' }]));
            const rv = sup.getReview(ins.lastInsertRowid);
            await sup._test.deliver(rv, Object.assign({}, sup.settings(gr), { delivery: 'steer' }), { auto: true, fromSupervisor: true });
            const kid = sup.listWork({ limit: 300 }).find((x) => x.title.startsWith(`Finish work item ${w.id}`));
            assert.ok(kid && kid.startNow, 'a follow-up item is queued to start');
            assert.ok(/Watch the reload before logon/.test(kid.prompt));
            assert.strictEqual(sup.getWork(w.id).state, 'done');
            assert.match(sup.getWork(w.id).message, /handed to work item/);
            // the follow-up starts on the stub launcher before the stubs are put back
            await waitFor(() => !['queued', 'starting'].includes(sup.getWork(kid.id).state), 'cap follow-up started');
            RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id = ?").run(kid.id);
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; launcher.steer = realSteer; }
    });

    await test('stall sweep: an idle session with an open item is kicked (gaps again / review), then handed on after three kicks', async () => {
        const fleetMcp = require('../modules/claudeFleetMcp');
        const realPick = fleetMcp.pickForStart; const realStart = launcher.start; const realSteer = launcher.steer;
        const typed = [];
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        let n = 0;
        launcher.start = async () => { n += 1; return { id: `cdcdcdcd-0000-0000-0000-0000000008${String(n).padStart(2, '0')}`, state: 'running', link: '' }; };
        launcher.steer = async (id, t) => { typed.push([id, t]); return { sent: true }; };
        try {
            // earlier tests leave started follow-ups behind: clear the slots
            RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE state IN ('queued','starting','running','waiting','input')").run();
            const w = sup.enqueue({ title: 'StallItem', prompt: 'do stall', topology: 'direct', startNow: true }, { gr });
            sup.pumpWork().catch(() => {});
            await waitFor(() => sup.getWork(w.id).state === 'running', 'stall running');
            const sid = sup.getWork(w.id).sessionId;
            fs.writeFileSync(path.join(tmp, '.claude', 'sessions', `${process.pid}77.json`), JSON.stringify({ pid: process.pid, sessionId: sid, status: 'idle', cwd: tmp }));
            const old = Date.now() - 60 * 60000;
            RAW().prepare('UPDATE supervisor_work SET started_at = ? WHERE id = ?').run(old, w.id);
            RAW().prepare("INSERT INTO supervisor_reviews (session_id, agent_id, title, account, at, trigger, verdict, summary, request, steering, missed) VALUES (?, 'claude-x', 't', '', ?, 'turn-end', 'gaps', 's', 'r', '[]', ?)").run(sid, old, JSON.stringify([{ item: 'Prove check 5 on screen', evidence: 'argued only' }]));
            sup._test.stallKicks.clear();
            let now = Date.now();
            assert.strictEqual(sup._test.sweepStalled(now), 1, 'kicked');
            await settle(50);
            assert.ok(typed.some(([id, t]) => id === sid && /Prove check 5 on screen/.test(t)), JSON.stringify(typed));
            assert.strictEqual(sup._test.sweepStalled(now + 60000), 0, 'not again within 30 minutes');
            sup._test.sweepStalled(now += 31 * 60000); sup._test.sweepStalled(now += 31 * 60000); sup._test.sweepStalled(now += 31 * 60000);
            const kid = sup.listWork({ limit: 300 }).find((x) => x.title.startsWith(`Finish work item ${w.id}`));
            assert.ok(kid, 'handed to a fresh item after three kicks');
            assert.strictEqual(sup.getWork(w.id).state, 'done');
        } finally { fleetMcp.pickForStart = realPick; launcher.start = realStart; launcher.steer = realSteer; }
    });

    await test('cancel: an issue another item still carries is not closed', async () => {
        const ins = (title, state) => RAW().prepare("INSERT INTO supervisor_work (title, prompt, source, state, created_at, message, engine, issue_repo, issue_number) VALUES (?, 'p', 'director', ?, ?, '', 'claude', 'DreamScape/StaticForge', 7230)").run(title, state, Date.now()).lastInsertRowid;
        const a = ins('PartA', 'running');
        const b = ins('PartB', 'cancelled');
        const rowB = RAW().prepare('SELECT * FROM supervisor_work WHERE id = ?').get(b);
        assert.strictEqual(sup._test.issueCarriedByOthers(rowB), true, 'PartA still carries #7230');
        RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id = ?").run(a);
        assert.strictEqual(sup._test.issueCarriedByOthers(rowB), false, 'nobody else carries it');
    });

    await test('stopWork: a running item is killed (then hold: Waiting, then delete: cancelled), its issue is never closed, a waiting one is just held / cancelled', async () => {
        const ins = (title, state, n) => RAW().prepare("INSERT INTO supervisor_work (title, prompt, source, state, created_at, message, engine, issue_repo, issue_number, session_id) VALUES (?, 'p', 'director', ?, ?, '', 'claude', 'DreamScape/StaticForge', ?, ?)").run(title, state, Date.now(), n, 'cccccccc-1111-2222-3333-444444444444').lastInsertRowid;
        const killed = [];
        const checked = [];
        sup.setKillDeps({
            killWork: async (item, o) => { killed.push([item.id, o.then, o.by]); const kd = sup.killDeps(); kd.mark(item.id, o.then === 'hold' ? { state: 'held', session_id: null, message: 'Stopped' } : { state: 'cancelled', ended_at: Date.now(), message: 'Stopped' }); return { itemId: item.id, then: o.then, killed: [], released: {}, files: [] }; },
            damageCheck: async (r, o) => { checked.push(o.item.id); return { patch: '', broken: [] }; }
        });
        try {
            yzCalls.length = 0;
            const a = ins('StopA', 'running', 8801);
            const r = await sup.stopWork(a, { then: 'hold', by: 'Fleet' });
            assert.strictEqual(r.item.state, 'held');
            await r.damage;
            assert.deepStrictEqual(checked, [a], 'the damage check follows');
            const b = ins('StopB', 'input', 8802);
            const rb = await sup.stopWork(b, { then: 'delete' });
            assert.strictEqual(rb.item.state, 'cancelled');
            assert.deepStrictEqual(killed.map((k) => k.slice(0, 2)), [[a, 'hold'], [b, 'delete']]);
            await settle(50);
            assert.ok(!yzCalls.some((c) => c.method === 'PATCH' && /issues\/880[12]$/.test(c.url) && c.body && c.body.state === 'closed'), 'no issue was closed');
            // nothing running: the old behaviour, no kill
            const h = ins('StopC', 'held', 8803);
            const rc = await sup.stopWork(h, { then: 'delete' });
            assert.strictEqual(rc.item.state, 'cancelled');
            assert.strictEqual(killed.length, 2, 'a held item is not killed');
            await assert.rejects(() => sup.stopWork(a + 1000, {}), /No such work item/);
            await assert.rejects(() => { const d = ins('StopD', 'done', 8804); return sup.stopWork(d, {}); }, /nothing is running/);
        } finally { sup.setKillDeps(null); }
    });

    await test('closeWorkAsDone: a waiting item ends done and its issue is commented and closed; a running one is refused', async () => {
        const id = RAW().prepare("INSERT INTO supervisor_work (title, prompt, source, state, created_at, message, engine, issue_repo, issue_number) VALUES ('DoneAlready', 'p', 'yozora', 'held', ?, '', 'claude', 'DreamScape/StaticForge', 7300)").run(Date.now()).lastInsertRowid;
        const before = yzCalls.length;
        const r = await sup.closeWorkAsDone(id, { evidence: 'commit abc did it', by: 'maintenance check' });
        assert.strictEqual(r.item.state, 'done');
        const mine = yzCalls.slice(before);
        assert.ok(mine.some((c) => c.method === 'POST' && /\/issues\/7300\/comments$/.test(c.url) && /commit abc did it/.test(c.body.body)), JSON.stringify(mine));
        assert.ok(mine.some((c) => c.method === 'PATCH' && /\/issues\/7300$/.test(c.url) && c.body.state === 'closed'));
        const run = RAW().prepare("INSERT INTO supervisor_work (title, prompt, source, state, created_at, message, engine) VALUES ('Busy', 'p', 'fleet', 'running', ?, '', 'claude')").run(Date.now()).lastInsertRowid;
        await assert.rejects(() => sup.closeWorkAsDone(run, {}), /stop it first/);
        RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id = ?").run(run);
    });

    await test('lost starts: a starting item with no session goes back to queued on start(), one with a session is untouched; starting_at follows setWork', async () => {
        const MSG = 'Back in the queue: its start never got a session';
        const ins = (title, state, sid, at) => RAW().prepare("INSERT INTO supervisor_work (title, prompt, source, state, created_at, message, engine, session_id, starting_at) VALUES (?, 'p', 'fleet', ?, ?, 'Starting on Secoundary', 'claude', ?, ?)").run(title, state, Date.now(), sid, at).lastInsertRowid;
        const row = (id) => RAW().prepare('SELECT * FROM supervisor_work WHERE id = ?').get(id);
        const keepAuto = settingsCfg.agentSupervisor.autoStart;
        settingsCfg.agentSupervisor.autoStart = false; // the pass start() kicks leaves queued items alone
        try {
            // setWork dates the entry into starting and clears it on leaving
            const w = sup.enqueue({ title: 'StartAge', prompt: 'p', source: 'fleet' });
            assert.strictEqual(row(w.id).starting_at, null);
            const t0 = Date.now();
            sup.setWork(w.id, { state: 'starting', message: 'Starting on x' });
            assert.ok(row(w.id).starting_at >= t0, 'entering starting sets starting_at');
            sup.setWork(w.id, { message: 'Still starting' });
            assert.ok(row(w.id).starting_at >= t0 && row(w.id).state === 'starting', 'other updates leave it');
            sup.setWork(w.id, { state: 'running', session_id: 'ffffffff-1111-2222-3333-444444444444' });
            assert.strictEqual(row(w.id).starting_at, null, 'leaving starting clears it');
            RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id = ?").run(w.id);
            // boot: the sweep runs in start(), once
            const lost = ins('LostStart', 'starting', null, Date.now());
            const lostEmpty = ins('LostStartEmpty', 'starting', '', null);
            const live = ins('LiveStart', 'starting', 'ffffffff-5555-2222-3333-444444444444', Date.now() - 60 * 60000);
            sup.stop();
            sup.start(gr);
            try {
                assert.strictEqual(row(lost).state, 'queued');
                assert.strictEqual(row(lost).message, MSG);
                assert.strictEqual(row(lost).starting_at, null);
                assert.strictEqual(row(lostEmpty).state, 'queued', 'an empty session id is no session');
                assert.strictEqual(row(live).state, 'starting', 'a starting item with a session is untouched');
                assert.strictEqual(row(live).message, 'Starting on Secoundary');
            } finally { sup.stop(); }
            await settle(50);
            [lost, lostEmpty, live].forEach((id) => RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id = ?").run(id));
        } finally { settingsCfg.agentSupervisor.autoStart = keepAuto; }
    });

    await test('lost starts: activeCount keeps a start under 5 minutes and its slot, puts back one of 5 minutes or more (not counted), leaves one with a session', async () => {
        const MSG = 'Back in the queue: its start never got a session';
        const ins = (title, sid, at) => RAW().prepare("INSERT INTO supervisor_work (title, prompt, source, state, created_at, message, engine, session_id, starting_at) VALUES (?, 'p', 'fleet', 'starting', ?, 'Starting on Secoundary', 'claude', ?, ?)").run(title, Date.now(), sid, at).lastInsertRowid;
        const row = (id) => RAW().prepare('SELECT * FROM supervisor_work WHERE id = ?').get(id);
        const keepAuto = settingsCfg.agentSupervisor.autoStart;
        settingsCfg.agentSupervisor.autoStart = false;
        const made = [];
        try {
            const base = sup._test.activeCount();
            const young = ins('StartYoung', null, Date.now() - 4 * 60000); made.push(young);
            assert.strictEqual(sup._test.activeCount(), base + 1, 'a start in flight holds its slot');
            assert.strictEqual(row(young).state, 'starting');
            assert.strictEqual(row(young).message, 'Starting on Secoundary');
            const old = ins('StartOld', null, Date.now() - 5 * 60000 - 1000); made.push(old);
            assert.strictEqual(sup._test.activeCount(), base + 1, 'the old one is not counted');
            assert.strictEqual(row(old).state, 'queued');
            assert.strictEqual(row(old).message, MSG);
            assert.strictEqual(row(old).starting_at, null);
            assert.strictEqual(row(young).state, 'starting', 'the young one stays');
            // a start with a session is never put back, however old
            const withSession = ins('StartSession', 'ffffffff-6666-2222-3333-444444444444', Date.now() - 60 * 60000); made.push(withSession);
            assert.strictEqual(sup._test.activeCount(), base + 2, 'a starting item with a session still counts');
            assert.strictEqual(row(withSession).state, 'starting');
            assert.strictEqual(row(withSession).message, 'Starting on Secoundary');
            // a row dated before the column existed is dated now (its 5 minutes start here), counted, not put back
            const undated = ins('StartUndated', null, null); made.push(undated);
            const t0 = Date.now();
            assert.strictEqual(sup._test.activeCount(), base + 3);
            assert.strictEqual(row(undated).state, 'starting');
            assert.ok(row(undated).starting_at >= t0, 'dated now');
            // a start still in flight in this process (a slow launch) is never put back, however old
            const slow = ins('StartSlow', null, Date.now() - 30 * 60000); made.push(slow);
            sup._test.startsInFlight.add(slow);
            try {
                assert.strictEqual(sup._test.activeCount(), base + 4, 'a slow start in flight holds its slot');
                assert.strictEqual(row(slow).state, 'starting');
            } finally { sup._test.startsInFlight.delete(slow); }
            assert.strictEqual(sup._test.activeCount(), base + 3, 'once its launch is gone, the old start goes back');
            assert.strictEqual(row(slow).state, 'queued');
        } finally {
            await settle(50);
            made.forEach((id) => RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE id = ?").run(id));
            settingsCfg.agentSupervisor.autoStart = keepAuto;
        }
    });

    await test('sweepClearGates: a clear gate tells its idle requester to begin it; an orphan gate is cancelled', async () => {
        const coordS = require('../modules/agentCoord/store');
        const realSteer = launcher.steer;
        const typed = [];
        launcher.steer = async (id, t) => { typed.push([id, t]); return { sent: true }; };
        const child = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        const SIDG = 'eeeeeeee-1111-2222-3333-444444444444';
        const rec = path.join(tmp, '.claude', 'sessions', `${child.pid}.json`);
        fs.writeFileSync(rec, JSON.stringify({ pid: child.pid, sessionId: SIDG, status: 'idle', cwd: tmp }));
        try {
            coordS.upsertAgent({ id: 'gate-req', kind: 'claude', name: 'Gate requester', sessionId: SIDG, cwd: tmp });
            const g = coordS.buildRequest('gate-req', { target: 'test-target', note: 'x', repo: 'testrepo' });
            const id = g.build.id;
            const st = coordS.builds({}).find((x) => x.build.id === id);
            assert.ok(st.canBegin, JSON.stringify(st.waitingOn));
            {
                await sup.sweepClearGates(Date.now());
                assert.ok(typed.some(([sid, t]) => sid === SIDG && new RegExp(`coord_build_begin ${id}`).test(t)), JSON.stringify(typed));
                const n = typed.length;
                await sup.sweepClearGates(Date.now() + 1000);
                assert.strictEqual(typed.length, n, 'not again within 3 minutes');
            }
            coordS.upsertAgent({ id: 'gate-req2', kind: 'claude', name: 'Gone requester', sessionId: 'dddddddd-0000-0000-0000-000000000000', cwd: tmp });
            const g2 = coordS.buildRequest('gate-req2', { target: 'test-target-2', note: 'y', repo: 'testrepo' });
            await sup.sweepClearGates(Date.now() + 6 * 60000);
            assert.ok(!coordS.builds({}).some((x) => x.build.id === g2.build.id), 'orphan gate cancelled');
            try { coordS.adminEndBuild(id, 'test', 'done'); } catch (_) { /* ended */ }
        } finally { child.kill('SIGKILL'); fs.rmSync(rec, { force: true }); launcher.steer = realSteer; }
    });

    // ---- permission prompts (#1351): a session sitting on Claude Code's "Do you want to proceed?" is answered after two quiet minutes
    {
        const coordP = require('../modules/agentCoord/store');
        const PSID = (n) => `f${String(n).padStart(7, '0')}-aaaa-bbbb-cccc-000000000000`;
        const mkPrompt = (cmd, sig) => ({ question: 'Do you want to proceed?', options: [{ n: 1, text: 'Yes', on: true }, { n: 2, text: 'No', on: false }], context: ['Bash command', `  ${cmd}`], signature: sig });
        const world = { live: new Map(), prompts: {}, mtimes: {}, reads: [], answers: [], tells: [], answerResult: { answered: true, key: 1, option: 'Yes', gone: true } };
        const decideFake = (p) => {
            const cmd = p.context.slice(1).join(' ').trim();
            if (/--force/.test(cmd)) return { decision: 'deny', kind: 'git-force', reason: 'a forced push can lose commits: push without --force', command: cmd };
            if (/rm -rf/.test(cmd)) return { decision: 'hers', kind: 'delete', reason: 'it deletes files outside the work tree', command: cmd };
            return { decision: 'approve', kind: 'repo-script', reason: 'a script of the repo itself', command: cmd };
        };
        const installDeps = (extra) => sup._setPromptDeps(Object.assign({
            prompt: async (id) => { world.reads.push(id); const p = world.prompts[id]; if (p instanceof Error) throw p; return p || null; },
            answer: async (id, choice, sig) => { world.answers.push([id, choice, sig]); return world.answerResult.answered ? Object.assign({}, world.answerResult, { key: choice === 'yes' ? 1 : 2 }) : world.answerResult; },
            decide: decideFake,
            mtime: (id) => world.mtimes[id],
            tell: async (id, text) => { world.tells.push([id, text]); return true; }
        }, extra || {}));
        let issueNo = 7300;
        const mkItem = (sid, state = 'running') => {
            issueNo += 1;
            const id = RAW().prepare("INSERT INTO supervisor_work (title, prompt, source, state, created_at, message, engine, issue_repo, issue_number, session_id) VALUES ('PromptItem', 'p', 'director', ?, ?, '', 'claude', 'DreamScape/StaticForge', ?, ?)").run(state, Date.now(), issueNo, sid).lastInsertRowid;
            return { id, issue: issueNo, sid };
        };
        const addSession = (n, status = 'busy') => { const sid = PSID(n); world.live.set(sid, { id: sid, cwd: '/r', status, givenName: `P${n}`, pid: 1 }); return sid; };
        const reset = () => {
            RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE state IN ('queued','starting','running','waiting','input')").run();
            world.live = new Map(); world.prompts = {}; world.mtimes = {}; world.reads = []; world.answers = []; world.tells = [];
            world.answerResult = { answered: true, key: 1, option: 'Yes', gone: true };
            sup._test.promptWatch.clear();
            installDeps();
            sup._test.setCollisionDeps({ live: () => world.live });
        };
        const comments = (issue) => yzCalls.filter((c) => c.method === 'POST' && new RegExp(`issues/${issue}/comments$`).test(c.url)).map((c) => c.body.body);
        const quietSince = (sid, base) => { world.mtimes[sid] = base - 5 * 60000; };
        const MIN = 60000;
        try {
            await test('permission prompt: seen once, then one minute on, nothing is pressed; at two minutes a repo script is approved (Yes) once, written on the item, the issue and the inbox; not again; one more try after ten minutes', async () => {
                reset();
                const sid = addSession(1); const it = mkItem(sid);
                const base = Date.now(); quietSince(sid, base);
                world.prompts[sid] = mkPrompt('node scripts/x.js', 'sigA');
                assert.strictEqual(await sup.sweepPermissionPrompts(base), 0);
                assert.strictEqual(await sup.sweepPermissionPrompts(base + MIN), 0);
                assert.strictEqual(world.answers.length, 0, 'a person has two minutes');
                assert.strictEqual(sup._test.promptWatch.get(sid).since, base, 'the clock started at the first sighting');
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 2 * MIN), 1);
                assert.deepStrictEqual(world.answers, [[sid, 'yes', 'sigA']]);
                assert.match(sup.getWork(it.id).message, /^Permission prompt approved: node scripts\/x\.js \(a script of the repo itself\)$/);
                assert.strictEqual(sup.getWork(it.id).state, 'running');
                await settle(60);
                const cm = comments(it.issue);
                assert.strictEqual(cm.length, 1, JSON.stringify(cm));
                assert.match(cm[0], /sat on a permission prompt for 2 minutes: approved \(pressed 1\) `node scripts\/x\.js` - a script of the repo itself\./);
                const inbox = coordP.inbox(`claude-${sid.slice(0, 8)}`, { peek: true });
                assert.ok(inbox.some((m) => /approved the permission prompt "node scripts\/x\.js"/.test(m.body)), JSON.stringify(inbox));
                assert.deepStrictEqual(world.tells, [], 'approving types nothing');
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 3 * MIN), 0);
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 11 * MIN), 0);
                assert.strictEqual(world.answers.length, 1, 'not answered twice');
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 12 * MIN + 1), 1, 'still there ten minutes after: one more try');
                assert.strictEqual(world.answers.length, 2);
                assert.match(sup.getWork(it.id).message, /a second try/);
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 13 * MIN), 0);
            });

            await test('permission prompt: a forced push is declined (No), the session is told the reason and not to retry; the item stays running', async () => {
                reset();
                const sid = addSession(2); const it = mkItem(sid);
                const base = Date.now(); quietSince(sid, base);
                world.prompts[sid] = mkPrompt('git push --force origin main', 'sigB');
                await sup.sweepPermissionPrompts(base);
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 2 * MIN), 1);
                assert.deepStrictEqual(world.answers, [[sid, 'no', 'sigB']]);
                assert.strictEqual(world.tells.length, 1);
                assert.strictEqual(world.tells[0][0], sid);
                assert.ok(world.tells[0][1].startsWith(sup.STEER_PREFIX), 'a Supervisor note');
                assert.match(world.tells[0][1], /declined the permission prompt "git push --force origin main" \(a forced push can lose commits: push without --force\)/);
                assert.match(world.tells[0][1], /Do not retry the same command\./);
                assert.strictEqual(sup.getWork(it.id).state, 'running');
                assert.match(sup.getWork(it.id).message, /^Permission prompt declined: git push --force origin main/);
                await settle(60);
                assert.match(comments(it.issue)[0], /declined \(pressed 2\) `git push --force origin main` - a forced push can lose commits/);
            });

            await test('permission prompt: a decision left to her declines it too and puts the item in Input Required with one question', async () => {
                reset();
                const sid = addSession(3); const it = mkItem(sid);
                const base = Date.now(); quietSince(sid, base);
                world.prompts[sid] = mkPrompt('rm -rf /home/kanmi/old', 'sigC');
                await sup.sweepPermissionPrompts(base);
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 2 * MIN), 1);
                assert.deepStrictEqual(world.answers, [[sid, 'no', 'sigC']]);
                assert.strictEqual(world.tells.length, 1);
                const w = sup.getWork(it.id);
                assert.strictEqual(w.state, 'input');
                assert.match(w.message, /^Input Required: /);
                const q = JSON.parse(RAW().prepare('SELECT input_questions FROM supervisor_work WHERE id = ?').get(it.id).input_questions);
                assert.strictEqual(q.length, 1);
                assert.match(q[0].question, /rm -rf \/home\/kanmi\/old/);
                assert.strictEqual(q[0].answer, '');
                await settle(60);
                assert.ok(comments(it.issue).some((c) => /declined \(pressed 2\) `rm -rf/.test(c)), 'the decision is on the issue');
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 3 * MIN), 0, 'an Input Required item is no longer read');
            });

            await test('permission prompt: a changed signature restarts the clock; a gone prompt clears the watch; moved transcript clears it and costs no read', async () => {
                reset();
                const sid = addSession(4); mkItem(sid);
                const base = Date.now(); quietSince(sid, base);
                world.prompts[sid] = mkPrompt('node scripts/a.js', 'sig1');
                await sup.sweepPermissionPrompts(base);
                world.prompts[sid] = mkPrompt('node scripts/b.js', 'sig2');
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 2 * MIN), 0, 'a different prompt: not acted on');
                assert.strictEqual(sup._test.promptWatch.get(sid).sig, 'sig2');
                assert.strictEqual(sup._test.promptWatch.get(sid).since, base + 2 * MIN);
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 3 * MIN), 0);
                assert.strictEqual(world.answers.length, 0);
                world.prompts[sid] = null; // answered by a person
                await sup.sweepPermissionPrompts(base + 3 * MIN + 1000);
                assert.ok(!sup._test.promptWatch.has(sid), 'a gone prompt deletes the entry');
                world.prompts[sid] = mkPrompt('node scripts/b.js', 'sig2'); // the same one again: a new clock
                await sup.sweepPermissionPrompts(base + 4 * MIN);
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 5 * MIN), 0, 'one minute is not two');
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 6 * MIN), 1);
                // the transcript moved: it works, the watch is forgotten and the pane is not read
                world.prompts[sid] = mkPrompt('node scripts/c.js', 'sig3');
                await sup.sweepPermissionPrompts(base + 20 * MIN);
                assert.ok(sup._test.promptWatch.has(sid));
                world.mtimes[sid] = base + 20 * MIN - 5000;
                const reads = world.reads.length;
                await sup.sweepPermissionPrompts(base + 20 * MIN);
                assert.ok(!sup._test.promptWatch.has(sid), 'a working session forgets its watch');
                assert.strictEqual(world.reads.length, reads, 'and costs no tmux read');
            });

            await test('permission prompt: only live, not idle sessions with an active item are read; a prompt that cannot be read is no prompt', async () => {
                reset();
                const noItem = addSession(5);
                const idle = addSession(6, 'idle'); mkItem(idle);
                const notLive = PSID(7); mkItem(notLive);
                const ended = addSession(8); mkItem(ended, 'done');
                const thrower = addSession(9); mkItem(thrower);
                const base = Date.now();
                [noItem, idle, notLive, ended, thrower].forEach((x) => quietSince(x, base));
                world.prompts[noItem] = mkPrompt('node scripts/a.js', 's5'); world.prompts[idle] = mkPrompt('node scripts/a.js', 's6'); world.prompts[ended] = mkPrompt('node scripts/a.js', 's8');
                world.prompts[thrower] = Object.assign(new Error('Take Over in Fleet'), { code: 'NEEDS_TAKEOVER' });
                await sup.sweepPermissionPrompts(base);
                await sup.sweepPermissionPrompts(base + 5 * MIN);
                assert.deepStrictEqual([...new Set(world.reads)], [thrower], `only the one that qualifies is read (${world.reads})`);
                assert.strictEqual(world.answers.length, 0);
                assert.ok(!sup._test.promptWatch.has(thrower));
            });

            await test('permission prompt: answerPermission answered:false is not retried in the same sweep, decided stays unset, the next sweep tries again', async () => {
                reset();
                const sid = addSession(10); const it = mkItem(sid);
                const base = Date.now(); quietSince(sid, base);
                world.prompts[sid] = mkPrompt('node scripts/x.js', 'sigD');
                world.answerResult = { answered: false, why: 'prompt changed' };
                await sup.sweepPermissionPrompts(base);
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 2 * MIN), 0);
                assert.strictEqual(world.answers.length, 1, 'one press attempt in the sweep');
                assert.strictEqual(sup._test.promptWatch.get(sid).decided, 0);
                assert.strictEqual(sup.getWork(it.id).message, '', 'nothing is written for a press that did not happen');
                world.answerResult = { answered: true, key: 1, option: 'Yes', gone: true };
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 3 * MIN), 1);
                assert.strictEqual(world.answers.length, 2);
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 4 * MIN), 0);
                assert.strictEqual(world.answers.length, 2);
            });

            await test('permission prompt: at most 12 sessions are read per sweep and the next sweep goes on where it stopped (none starves)', async () => {
                reset();
                const base = Date.now();
                const sids = [];
                for (let n = 20; n < 35; n += 1) { const sid = addSession(n); mkItem(sid); quietSince(sid, base); sids.push(sid); }
                await sup.sweepPermissionPrompts(base);
                assert.strictEqual(world.reads.length, 12);
                const first = world.reads.slice();
                await sup.sweepPermissionPrompts(base + MIN);
                assert.strictEqual(world.reads.length, 24);
                assert.deepStrictEqual(world.reads.slice(12, 15), sids.slice(12), 'the three it left out come first');
                assert.strictEqual(new Set(world.reads).size, 15, 'every session was read');
                assert.deepStrictEqual(first, sids.slice(0, 12));
            });

            await test('permission prompt: AGENT_SUPERVISOR_PROMPTS=0 turns the sweep off; a disabled Supervisor does nothing', async () => {
                reset();
                const sid = addSession(40); mkItem(sid);
                const base = Date.now(); quietSince(sid, base);
                world.prompts[sid] = mkPrompt('node scripts/x.js', 'sigE');
                process.env.AGENT_SUPERVISOR_PROMPTS = '0';
                try { assert.strictEqual(await sup.sweepPermissionPrompts(base + 5 * MIN), 0); } finally { delete process.env.AGENT_SUPERVISOR_PROMPTS; }
                assert.strictEqual(world.reads.length, 0);
                settingsCfg.agentSupervisor.enabled = false;
                try { assert.strictEqual(await sup.sweepPermissionPrompts(base + 5 * MIN), 0); } finally { settingsCfg.agentSupervisor.enabled = true; }
                assert.strictEqual(world.reads.length, 0);
            });

            await test('permission prompt: the real pane reader and the real policy end to end', async () => {
                const policyFile = path.join(__dirname, '..', 'modules', 'permissionPromptPolicy.js');
                if (!fs.existsSync(policyFile) || typeof launcher.readPermissionPrompt !== 'function') { console.log('     skipped: modules/permissionPromptPolicy.js does not exist yet'); return; }
                reset();
                const pane = [' Bash command', '   git -C /home/kanmi/staticforge status', '   Show status', ' This command requires approval', ' Do you want to proceed?', ' \u276f 1. Yes', '   2. No', ' Esc to cancel'];
                const real = launcher.readPermissionPrompt(pane);
                assert.ok(real && real.signature, 'the pane reads as a permission prompt');
                const sid = addSession(41); mkItem(sid);
                const base = Date.now(); quietSince(sid, base);
                sup._setPromptDeps({
                    prompt: async () => launcher.readPermissionPrompt(pane),
                    answer: async (id, choice, sig) => { world.answers.push([id, choice, sig]); return world.answerResult; },
                    mtime: (id) => world.mtimes[id], tell: async (id, t) => { world.tells.push([id, t]); return true; }
                });
                await sup.sweepPermissionPrompts(base);
                assert.strictEqual(await sup.sweepPermissionPrompts(base + 2 * MIN), 1);
                assert.deepStrictEqual(world.answers, [[sid, 'yes', real.signature]], 'git status is read only: approved');
            });
        } finally {
            sup._setPromptDeps({});
            sup._test.setCollisionDeps({});
            sup._test.promptWatch.clear();
            RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE state IN ('queued','starting','running','waiting','input')").run();
        }
    }

    require('../modules/agentCoord/store').close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
