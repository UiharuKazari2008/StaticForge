#!/usr/bin/env node
'use strict';

/**
 * modules/fleetLanding.js against a throwaway git repo with a bare 'origin': landed, not landed, landed under another sha
 * (patch-id), uncommitted, conflict markers, removed lines of another's work vs a moved block, and the Supervisor gate.
 *
 *   node scripts/test-fleet-landing.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const L = require('../modules/fleetLanding');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-'));
const bare = path.join(tmp, 'origin.git');
const work = path.join(tmp, 'work');
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) }).trim();
const write = (f, t) => fs.writeFileSync(path.join(work, f), t);
const commit = (msg, env) => { sh(work, 'add', '-A'); execFileSync('git', ['commit', '-q', '-m', msg], { cwd: work, env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, env || {}) }); return sh(work, 'rev-parse', 'HEAD'); };
const num = (n, p = 'l') => Array.from({ length: n }, (_, i) => `${p}${i} content line number ${i}`).join('\n') + '\n';
const MARK = (c, t) => c.repeat(7) + (t || '');

sh(tmp, 'init', '-q', '--bare', '-b', 'main', bare);
sh(tmp, 'init', '-q', '-b', 'main', work);
sh(work, 'remote', 'add', 'origin', bare);
write('base.txt', 'base\n');
commit('base');
sh(work, 'push', '-q', 'origin', 'main');

let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const started = Date.now() - 3 * 24 * 3600 * 1000;
const item = () => ({ id: 1, sessionId: 'aaaaaaaa-0000-0000-0000-000000000001', startedAt: started, cwd: work });
const run = (extra) => L.checkLanding(item(), { deps: Object.assign({ edited: async () => [], transcript: async () => ({ commits: [], pushed: [] }), editors: async () => [] }, extra) });
const kinds = (r) => r.problems.map((p) => p.kind).sort();
const later = () => Date.now() + 60000;

test('everything landed: ok', async () => {
    write('a.txt', num(3, 'a'));
    const sha = commit('add a');
    sh(work, 'push', '-q', 'origin', 'main');
    const r = await run({ edited: async () => [{ path: 'a.txt', lastAt: Date.now() }], transcript: async () => ({ commits: [{ sha: sha.slice(0, 9), subject: 'add a' }], pushed: [] }), fetch: false });
    assert.deepStrictEqual(r.problems, []);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.commits.length, 1);
    assert.strictEqual(r.commits[0].landed, 'ancestor');
});

test('a commit only on local main: not-landed', async () => {
    write('b.txt', num(3, 'b'));
    const sha = commit('add b');
    const r = await run({ edited: async () => [{ path: 'b.txt', lastAt: Date.now() }], transcript: async () => ({ commits: [{ sha, subject: 'add b' }], pushed: [] }), fetch: false });
    assert.deepStrictEqual(kinds(r), ['not-landed']);
    assert.match(r.problems[0].text, /add b/);
    assert.deepStrictEqual(r.problems[0].commits, [sha]);
    // the same commit found with no transcript sha: local main, same subject, only files it wrote
    const r2 = await run({ edited: async () => [{ path: 'b.txt', lastAt: Date.now() }], transcript: async () => ({ commits: [{ sha: '1234567', subject: 'add b' }], pushed: [] }), fetch: false });
    assert.deepStrictEqual(kinds(r2), ['not-landed']);
    assert.strictEqual(r2.commits[0].how, 'local main, same subject and only files it wrote');
});

test('the same patch landed under another sha: ok by patch-id', async () => {
    // origin gets the b commit cherry-picked in a separate worktree, with a different subject so only the patch-id matches
    const wt = path.join(tmp, 'wt');
    sh(work, 'worktree', 'add', '-q', '--detach', wt, 'refs/remotes/origin/main');
    const bsha = sh(work, 'log', '-1', '--format=%H', '--grep=add b');
    sh(wt, 'cherry-pick', bsha);
    sh(wt, 'commit', '--amend', '-q', '-m', 'b file (picked)');
    sh(wt, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
    sh(work, 'worktree', 'remove', '--force', wt);
    sh(work, 'fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main');
    const r = await run({ edited: async () => [{ path: 'b.txt', lastAt: Date.now() }], transcript: async () => ({ commits: [{ sha: bsha, subject: 'add b' }], pushed: [] }), fetch: false });
    assert.deepStrictEqual(r.problems, []);
    assert.strictEqual(r.commits[0].landed, 'patch-id');
});

test('an uncommitted edit by the session', async () => {
    write('a.txt', num(3, 'a') + 'extra\n');
    const r = await run({ edited: async () => [{ path: 'a.txt', lastAt: later() }], fetch: false });
    assert.deepStrictEqual(kinds(r), ['uncommitted']);
    assert.deepStrictEqual(r.problems[0].files, ['a.txt']);
    // an older write than the file's last commit is not flagged
    const r2 = await run({ edited: async () => [{ path: 'a.txt', lastAt: started + 1000 }], fetch: false });
    assert.deepStrictEqual(r2.problems, []);
    sh(work, 'checkout', '-q', '--', 'a.txt');
});

test('a conflict marker in its file', async () => {
    write('c.txt', ['one', MARK('<', ' HEAD'), 'ours', MARK('='), 'theirs', MARK('>', ' branch'), ''].join('\n'));
    const r = await run({ edited: async () => [{ path: 'c.txt', lastAt: later() }], fetch: false });
    assert.ok(kinds(r).includes('conflict'));
    assert.deepStrictEqual(r.problems.find((p) => p.kind === 'conflict').files, ['c.txt']);
    fs.rmSync(path.join(work, 'c.txt'));
    // a markdown rule alone is not a conflict
    write('d.md', 'Title\n=======\n');
    const r2 = await run({ edited: async () => [{ path: 'd.md', lastAt: later() }], fetch: false });
    assert.ok(!kinds(r2).includes('conflict'));
    fs.rmSync(path.join(work, 'd.md'));
});

test('removing 5 lines another commit added yesterday: removed-others; a moved block is not', async () => {
    write('shared.txt', num(8, 'keep') + num(5, 'theirs'));
    const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const other = commit('other session adds shared', { GIT_AUTHOR_DATE: day, GIT_COMMITTER_DATE: day });
    // removal
    write('shared.txt', num(8, 'keep'));
    const rm = commit('mine: tidy shared');
    const r = await run({ edited: async () => [{ path: 'shared.txt', lastAt: Date.now() }], transcript: async () => ({ commits: [{ sha: rm, subject: 'mine: tidy shared' }], pushed: [] }), fetch: false });
    const p = r.problems.find((x) => x.kind === 'removed-others');
    assert.ok(p, JSON.stringify(r.problems));
    assert.match(p.text, /removed 5 lines/);
    assert.strictEqual(p.commits[0], other);
    // a moved block: the 5 lines come back elsewhere in the same commit, plus a whitespace-only change
    write('shared.txt', num(8, 'keep') + num(5, 'theirs'));
    commit('restore shared');
    write('shared.txt', num(5, 'theirs') + num(8, 'keep'));
    const mv = commit('mine: reorder shared');
    const r2 = await run({ edited: async () => [{ path: 'shared.txt', lastAt: Date.now() }], transcript: async () => ({ commits: [{ sha: mv, subject: 'mine: reorder shared' }], pushed: [] }), fetch: false });
    assert.ok(!r2.problems.some((x) => x.kind === 'removed-others'), JSON.stringify(r2.problems));
    // the diff parser alone
    const d = ['--- a/x', '+++ b/x', '@@ -1,2 +1,1 @@', '-  indented line here', '-gone for good', '+indented   line here'].join('\n');
    assert.deepStrictEqual(L.removedLines(d).map((x) => x.text), ['gone for good']);
});

test('a file of its own deleted while another session edited it recently', async () => {
    write('own.txt', num(3, 'own'));
    commit('add own');
    fs.rmSync(path.join(work, 'own.txt'));
    commit('remove own');
    const r = await run({ edited: async () => [{ path: 'own.txt', lastAt: Date.now() }], editors: async () => [{ agentId: 'claude-bbbbbbbb', lastAt: Date.now() - 3600000 }], fetch: false });
    assert.ok(kinds(r).includes('removed-others'), JSON.stringify(r.problems));
    const r2 = await run({ edited: async () => [{ path: 'own.txt', lastAt: Date.now() }], editors: async () => [], fetch: false });
    assert.ok(!kinds(r2).includes('removed-others'));
});

test('transcript reader: commit and push output', async () => {
    const f = path.join(tmp, 't.jsonl');
    const ts = new Date().toISOString();
    const use = (id, cmd) => JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: cmd } }] } });
    const res = (id, text) => JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
    fs.writeFileSync(f, [use('t1', 'git commit -m "x y"'), res('t1', '[main 1a2b3c4d] x y\n 1 file changed'), use('t2', 'git push origin HEAD:main'), res('t2', 'To bare\n   abc1234..def5678  HEAD -> main')].join('\n') + '\n');
    const t = await L.readTranscript(f, 0);
    assert.deepStrictEqual(t.commits, [{ sha: '1a2b3c4d', subject: 'x y' }]);
    assert.deepStrictEqual(t.pushed, ['def5678']);
});

test('gate: ok, steer once, then hand on', async () => {
    const calls = { steer: [], comment: [], enq: [], set: [] };
    const hooks = (res, live) => ({
        checkLanding: async () => res, setWork: (id, f) => calls.set.push(f), emit: () => {}, comment: (w, t) => calls.comment.push(t),
        enqueue: (i) => { calls.enq.push(i); return { id: 77 }; }, steer: async (s, t) => { calls.steer.push(t); }, isLive: () => live
    });
    const w = { id: 501, session_id: 'aaaaaaaa-0000-0000-0000-000000000009', started_at: 1, title: 'T', cwd: work };
    let r = await L.gate(hooks({ ok: true, problems: [], commits: [{ sha: 'a'.repeat(40) }, { sha: 'b'.repeat(40) }] }, true), w, 'fine');
    assert.deepStrictEqual([r.done, r.note], [true, ' - landed: 2 commits on origin/main']);
    const bad = { ok: false, problems: [{ kind: 'not-landed', text: 'commit abc is not on origin/main', commits: ['abc'] }], commits: [{ sha: 'c'.repeat(40) }] };
    r = await L.gate(hooks(bad, true), w, 'fine');
    assert.strictEqual(r.done, false);
    assert.strictEqual(calls.steer.length, 1);
    assert.match(calls.steer[0], /^\[Supervisor\] Before this item is done: \(1\) commit abc/);
    assert.match(calls.set[0].message, /^Landing: commit abc/);
    r = await L.gate(hooks(bad, true), w, 'fine'); // same problems after the steer: it did not fix them
    assert.strictEqual(r.done, true);
    assert.match(r.note, /handed to item 77/);
    assert.strictEqual(calls.steer.length, 1, 'not steered twice for the same problem set');
    assert.strictEqual(calls.enq[0].startNow, true);
    assert.match(calls.enq[0].prompt, /Land work item 501/);
    // a gone session is handed on at once
    r = await L.gate(hooks(bad, false), Object.assign({}, w, { id: 502 }), 'fine');
    assert.match(r.note, /handed to item 77/);
});

(async () => {
    for (const [name, fn] of tests) {
        try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 4).join('\n     ')}`); }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
