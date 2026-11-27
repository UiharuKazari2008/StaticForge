#!/usr/bin/env node
'use strict';

/**
 * modules/fleetLanding.js against throwaway git repos with a bare 'origin': landed, not landed, landed under another sha
 * (patch-id), uncommitted, conflict markers, removed lines of another's work vs a moved block, and the Supervisor gate; a live
 * tree whose HEAD is behind origin/main, files another session holds, and commits made with `git commit -q` (#1391). The
 * coord database and the Claude folder are throwaway ones: the real ones are never read or written.
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
process.env.AGENT_COORD_DB = path.join(tmp, 'coord', 'coord.db');
process.env.DREAMSCAPE_CLAUDE_HOME = path.join(tmp, 'claude-home');
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
const run = (extra) => L.checkLanding(item(), { deps: Object.assign({ edited: async () => [], transcript: async () => ({ commits: [], pushed: [] }), claims: async () => [], editors: async () => [] }, extra) });
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

// ---------------------------------------------------------------- #1391: a stale live tree, other sessions' files, quiet commits

const SID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ENV = (extra) => Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, extra || {});
const daysAgo = (n) => { const d = new Date(Date.now() - n * 24 * 3600 * 1000).toISOString(); return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d }; };

/** Puts files into a tree: text, null (delete) or { link: target }. */
function put(root, files) {
    for (const [f, v] of Object.entries(files)) {
        const abs = path.join(root, f);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.rmSync(abs, { force: true });
        if (v === null) continue;
        if (typeof v === 'object') fs.symlinkSync(v.link, abs); else fs.writeFileSync(abs, v);
    }
}

/** A repo of its own: a live tree that is never pulled, its bare origin, and sessions that land from their own worktrees. */
function liveTree(name, base) {
    const dir = path.join(tmp, name);
    const origin = path.join(dir, 'origin.git');
    const live = path.join(dir, 'proj');
    fs.mkdirSync(dir, { recursive: true });
    sh(dir, 'init', '-q', '--bare', '-b', 'main', origin);
    sh(dir, 'init', '-q', '-b', 'main', live);
    sh(live, 'remote', 'add', 'origin', origin);
    const commitIn = (root, msg, env) => { sh(root, 'add', '-A'); execFileSync('git', ['commit', '-q', '-m', msg], { cwd: root, env: ENV(env) }); return sh(root, 'rev-parse', 'HEAD'); };
    put(live, base || { 'base.txt': 'base\n' });
    commitIn(live, 'base', daysAgo(20));
    sh(live, 'push', '-q', 'origin', 'main');
    sh(live, 'fetch', '-q', 'origin');
    let n = 0;
    const inWorktree = (fn, push) => {
        n += 1;
        const wt = path.join(dir, `wt${n}`);
        sh(live, 'worktree', 'add', '-q', '--detach', wt, 'refs/remotes/origin/main');
        const out = fn(wt);
        if (push !== false) { sh(wt, 'push', '-q', 'origin', 'HEAD:refs/heads/main'); sh(live, 'fetch', '-q', 'origin'); }
        sh(live, 'worktree', 'remove', '--force', wt);
        return out;
    };
    const t = {
        live,
        git: (...a) => sh(live, ...a),
        put: (files) => put(live, files),
        commit: (files, msg, env) => { put(live, files); sh(live, 'add', '--', ...Object.keys(files)); execFileSync('git', ['commit', '-q', '-m', msg, '--', ...Object.keys(files)], { cwd: live, env: ENV(env) }); return sh(live, 'rev-parse', 'HEAD'); },
        land: (files, msg, env) => inWorktree((wt) => { put(wt, files); return commitIn(wt, msg, env); }),
        pick: (sha, push) => inWorktree((wt) => { sh(wt, 'cherry-pick', sha); return sh(wt, 'rev-parse', 'HEAD'); }, push),
        deps: (extra) => Object.assign({ edited: async () => [], transcript: async () => ({ commits: [], pushed: [], subjects: [] }), claims: async () => [], editors: async () => [], fetch: false }, extra),
        check: (extra, item_) => L.checkLanding(Object.assign({ id: 1, sessionId: SID, startedAt: started, cwd: live }, item_ || {}), { deps: t.deps(extra) })
    };
    return t;
}

const wrote = (...files) => { const at = later(); return async () => files.map((f) => ({ path: f, lastAt: at })); };
const says = (o) => async () => Object.assign({ commits: [], pushed: [], subjects: [] }, o);
const flagged = (r) => (r.problems.find((p) => p.kind === 'uncommitted') || { files: [] }).files.slice().sort();

function gateHooks(check, live) {
    const calls = { steer: [], comment: [], enq: [], set: [] };
    const hooks = { checkLanding: check, setWork: (id, f) => calls.set.push(f), emit: () => {}, comment: (w, t) => calls.comment.push(t), enqueue: (i) => { calls.enq.push(i); return { id: 88 }; }, steer: async (s, t) => { calls.steer.push(t); }, isLive: () => live };
    return { calls, hooks };
}
let gateId = 900;
const row = () => { gateId += 1; return { id: gateId, session_id: SID, started_at: started, title: 'T', cwd: '' }; };

/** A transcript file holding these Bash commands: [command, output, isError]. */
function transcriptFile(name, calls) {
    const f = path.join(tmp, name);
    const ts = new Date().toISOString();
    const out = [];
    calls.forEach(([command, output, isError], n) => {
        out.push(JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_use', id: `u${n}`, name: 'Bash', input: { command } }] } }));
        out.push(JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: `u${n}`, content: output || '', is_error: !!isError }] } }));
    });
    fs.writeFileSync(f, `${out.join('\n')}\n`);
    return f;
}

test('a file that holds what origin/main holds is landed, whatever the stale HEAD says', async () => {
    const t = liveTree('stale', { 'x.txt': 'one\n', 'gone.txt': 'old\n', 'dir/with space.txt': 'one\n', 'tool.sh': 'echo 1\n' });
    t.land({ 'x.txt': 'two\n', 'new.txt': 'new\n', 'gone.txt': null, 'dir/with space.txt': 'two\n', 'tool.sh': 'echo 2\n', ln: { link: 'x.txt' }, 'odd[1].txt': 'odd\n' }, 'another session lands');
    const all = ['x.txt', 'new.txt', 'gone.txt', 'dir/with space.txt', 'tool.sh', 'ln', 'odd[1].txt'];
    t.put({ 'x.txt': 'two\n', 'new.txt': 'new\n', 'gone.txt': null, 'dir/with space.txt': 'two\n', 'tool.sh': 'echo 2\n', ln: { link: 'x.txt' }, 'odd[1].txt': 'odd\n' });
    assert.ok(t.git('status', '--porcelain', '--untracked-files=all').split('\n').length >= 6, 'the live tree is dirty against its own HEAD');
    const r = await t.check({ edited: wrote(...all) });
    assert.deepStrictEqual(r.problems, []);
    assert.deepStrictEqual([r.ok, r.held], [true, []]);
    assert.ok(r.notes.some((x) => /same as origin\/main/.test(x)), JSON.stringify(r.notes));
    // what differs from both is still flagged: other text, a link that points elsewhere, a file where origin has a link
    t.put({ 'x.txt': 'mine\n', ln: { link: 'base.txt' } });
    const r2 = await t.check({ edited: wrote(...all) });
    assert.deepStrictEqual(flagged(r2), ['ln', 'x.txt']);
    assert.match(r2.problems[0].text, /^2 files it wrote differ from origin\/main and are not committed: /);
    t.put({ 'x.txt': 'two\n', ln: 'x.txt' });
    assert.deepStrictEqual(flagged(await t.check({ edited: wrote(...all) })), ['ln']);
    t.put({ ln: { link: 'x.txt' } });
    // a mode change that neither HEAD nor origin has is not committed
    fs.chmodSync(path.join(t.live, 'tool.sh'), 0o755);
    assert.deepStrictEqual(flagged(await t.check({ edited: wrote(...all) })), ['tool.sh']);
});

test('with no origin/main the check keeps to HEAD', async () => {
    const t = liveTree('noorigin', { 'x.txt': 'one\n' });
    t.put({ 'x.txt': 'two\n' });
    t.git('update-ref', '-d', 'refs/remotes/origin/main');
    const r = await t.check({ edited: wrote('x.txt') });
    assert.deepStrictEqual(flagged(r), ['x.txt']);
    assert.match(r.problems[0].text, /differs from HEAD and are not committed/);
    assert.ok(r.notes.some((x) => /landing not checked/.test(x)));
});

test('a version origin/main held since the item started is landed; one from before it is not', async () => {
    const t = liveTree('moved', { 'x.txt': 'one\n', 'y.txt': 'zero\n' });
    t.land({ 'y.txt': 'ancient\n' }, 'long ago', daysAgo(10));
    t.land({ 'y.txt': 'newer\n' }, 'y again');
    t.land({ 'x.txt': 'landed by the item\n' }, 'the item lands x');
    t.land({ 'x.txt': 'another session on top\n' }, 'origin moves on');
    t.put({ 'x.txt': 'landed by the item\n' });
    const r = await t.check({ edited: wrote('x.txt') });
    assert.deepStrictEqual(r.problems, []);
    assert.ok(r.notes.some((x) => /origin moved on\): x\.txt/.test(x)), JSON.stringify(r.notes));
    t.put({ 'y.txt': 'ancient\n' }); // held 10 days ago, the item started 3 days ago
    assert.deepStrictEqual(flagged(await t.check({ edited: wrote('x.txt', 'y.txt') })), ['y.txt']);
});

test('a file another agent claims is not this item\'s: held, nobody is steered or sent to land it', async () => {
    const t = liveTree('claimed', { 'x.txt': 'one\n', 'c.txt': 'c\n' });
    t.put({ 'x.txt': 'someone else is working\n', 'c.txt': ['one', MARK('<', ' HEAD'), 'ours', MARK('='), 'theirs', MARK('>', ' branch'), ''].join('\n') });
    const claims = async (paths) => paths.map((f) => ({ file: f, agentId: 'claude-bbbbbbbb', path: f }));
    const r = await t.check({ edited: wrote('x.txt', 'c.txt'), claims });
    assert.deepStrictEqual([r.ok, r.problems], [true, []]);
    assert.deepStrictEqual(r.held.map((h) => [h.file, h.holder]).sort(), [['c.txt', 'claude-bbbbbbbb'], ['x.txt', 'claude-bbbbbbbb']]);
    assert.ok(r.notes.some((x) => /x\.txt, held by claude-bbbbbbbb/.test(x)));
    // the item's own claim does not excuse it
    const own = await t.check({ edited: wrote('x.txt'), claims: async () => [{ file: 'x.txt', agentId: 'claude-aaaaaaaa', path: 'x.txt' }] });
    assert.deepStrictEqual(flagged(own), ['x.txt']);
    for (const live of [true, false]) {
        const { calls, hooks } = gateHooks(() => t.check({ edited: wrote('x.txt', 'c.txt'), claims }), live);
        const res = await L.gate(hooks, row(), 'done');
        assert.strictEqual(res.done, true);
        assert.deepStrictEqual([calls.enq.length, calls.steer.length, calls.set.length], [0, 0, 0]);
        assert.match(calls.comment[0], /landing check passed/);
        assert.match(calls.comment[0], /not this item's: x\.txt, held by claude-bbbbbbbb \(it holds a live claim on x\.txt\)/);
    }
});

test('with no claim: a later edit by another session holds the file, an earlier one does not', async () => {
    const t = liveTree('edited', { 'x.txt': 'one\n' });
    t.put({ 'x.txt': 'changed\n' });
    const at = later();
    const edited = async () => [{ path: 'x.txt', lastAt: at }];
    const r = await t.check({ edited, editors: async () => [{ agentId: 'claude-cccccccc', lastAt: at + 1000 }] });
    assert.deepStrictEqual([r.ok, r.held.map((h) => h.holder)], [true, ['claude-cccccccc']]);
    assert.match(r.held[0].why, /after this item did/);
    const r2 = await t.check({ edited, editors: async () => [{ agentId: 'claude-cccccccc', lastAt: at - 1000 }] });
    assert.deepStrictEqual([flagged(r2), r2.held], [['x.txt'], []]);
    const r3 = await t.check({ edited, editors: async () => [{ agentId: 'claude-aaaaaaaa', lastAt: at + 1000 }] });
    assert.deepStrictEqual(flagged(r3), ['x.txt']);
});

test('one held file and one really uncommitted file: only the second is handed on, the first is left alone', async () => {
    const t = liveTree('mixed', { 'theirs.txt': 'one\n', 'mine.txt': 'one\n' });
    t.put({ 'theirs.txt': 'their work\n', 'mine.txt': 'my work\n' });
    const deps = { edited: wrote('theirs.txt', 'mine.txt'), claims: async () => [{ file: 'theirs.txt', agentId: 'claude-bbbbbbbb', path: 'theirs.txt' }] };
    const r = await t.check(deps);
    assert.deepStrictEqual(flagged(r), ['mine.txt']);
    assert.ok(!r.problems[0].text.includes('theirs.txt'));
    const gone = gateHooks(() => t.check(deps), false);
    await L.gate(gone.hooks, row(), 'done');
    const prompt = gone.calls.enq[0].prompt;
    assert.match(prompt, /\nFiles: mine\.txt\n/);
    assert.match(prompt, /Leave these files alone, they are not this item's \(do not commit, restore or delete them\): theirs\.txt \(held by claude-bbbbbbbb\)\./);
    assert.match(prompt, /\nCommits: \(none found\)\n/);
    assert.match(gone.calls.comment[0], /not this item's: theirs\.txt, held by claude-bbbbbbbb/);
    const alive = gateHooks(() => t.check(deps), true);
    await L.gate(alive.hooks, row(), 'done');
    assert.match(alive.calls.steer[0], /Leave these files alone[^]*theirs\.txt \(held by claude-bbbbbbbb\)/);
    assert.match(alive.calls.comment[0], /not this item's: theirs\.txt, held by claude-bbbbbbbb/);
    // a held file another finding names (lines the commits removed there) still stays out of the files to land
    const both = gateHooks(async () => {
        const res = await t.check(deps);
        res.problems.push({ kind: 'removed-others', text: 'it removed 3 lines from theirs.txt, other.txt', files: ['theirs.txt', 'other.txt'], commits: ['abc'] });
        return res;
    }, false);
    await L.gate(both.hooks, row(), 'done');
    assert.match(both.calls.enq[0].prompt, /\nFiles: mine\.txt, other\.txt\n/);
});

const LONG = 'fix(thing): a subject that is long enough to be this item\'s own (#9)';
const quiet = (subject) => [`git add p.txt && git commit -q -m "${subject}\n\nCo-Authored-By: X <x@y>" -- p.txt && git push -q 2>&1 | tail -1`, ''];

test('transcript reader: subjects from quiet commit commands, [detached HEAD] lines, failed commands skipped', async () => {
    const f = transcriptFile('forms.jsonl', [
        quiet('one: double quoted, then a body'),
        ["git commit -q -F - -- a.txt b.txt <<'EOF'\ntwo: from a heredoc, with \"quotes\" and it's own apostrophe\n\nbody line\nEOF\necho done", ''],
        ["git add -A && git commit -q -m \"$(cat <<'EOF'\nthree: cat in a substitution (it's fine)\n\nbody )\nEOF\n)\" && git status", ''],
        ["git -C /some/dir -c user.name='a b' -c \"credential.helper=\" commit -qam 'four: single quoted after git options'", ''],
        ['T=$(git write-tree) && H=$(GIT_INDEX_FILE=/tmp/i git commit-tree $T -p origin/main -m "five: commit-tree in a substitution") && git push -q origin $H:main', ''],
        ["git commit -F- <<-END\n\tsix: first line of a paragraph\n\tand its second line\n\n\tbody\n\tEND", ''],
        ["(( n = 1 << 2 ))\ngit commit -q --message='seven: after shell arithmetic' -m 'not the subject'", ''],
        ["cat <<'EOF' | git commit -q -F -\neight: piped from cat\nEOF", ''],
        ["cat > /tmp/note.md <<'EOF'\nthen run git commit -m \"quoted inside a document\"\ngit commit -m \"also in the document\"\nEOF\n# git commit -m \"in a comment\"\necho \"git commit -m 'echoed'\" && git log -1", ''],
        ["timeout 60 git commit -q -m \"nine: behind a wrapper \\\"escaped\\\"\"", ''],
        ['git commit -q -m "this one failed" && git push', 'hook said no', true],
        ['git commit --amend --no-edit -q', ''],
        ['git cherry-pick 99c09b6bd 2>&1 | tail -3', '[detached HEAD 0edf57481] fix: picked in a worktree\n 2 files changed']
    ]);
    const r = await L.readTranscript(f, 0);
    assert.deepStrictEqual(r.subjects, [
        'one: double quoted, then a body', "two: from a heredoc, with \"quotes\" and it's own apostrophe", "three: cat in a substitution (it's fine)",
        'four: single quoted after git options', 'five: commit-tree in a substitution', 'six: first line of a paragraph\nand its second line',
        'seven: after shell arithmetic', 'eight: piped from cat', 'nine: behind a wrapper "escaped"'
    ]);
    assert.deepStrictEqual(r.commits, [{ sha: '0edf57481', subject: 'fix: picked in a worktree' }]);
});

test('a quiet commit landed under another hash is found by its command: one entry, patch-id, landedAs', async () => {
    const t = liveTree('quiet');
    const local = t.commit({ 'p.txt': num(4, 'p') }, LONG);
    t.land({ 'other.txt': 'o\n' }, 'origin is ahead');
    const onOrigin = t.pick(local);
    assert.notStrictEqual(onOrigin, local);
    const f = transcriptFile('quiet.jsonl', [quiet(LONG)]);
    const r = await t.check({ transcript: () => L.readTranscript(f, 0) });
    assert.deepStrictEqual(r.problems, []);
    assert.strictEqual(r.commits.length, 1, JSON.stringify(r.commits));
    assert.deepStrictEqual([r.commits[0].sha, r.commits[0].landed, r.commits[0].landedAs], [local, 'patch-id', onOrigin]);
    // the worktree's printed copy is the same piece of work, still one entry
    const r2 = await t.check({ transcript: says({ commits: [{ sha: onOrigin.slice(0, 9), subject: LONG }], subjects: [LONG] }) });
    assert.deepStrictEqual(r2.commits.map((c) => [c.sha, c.landedAs]), [[local, onOrigin]]);
    // far past the patch-id window the subject search still finds the copy, and its patch id
    const tree = t.git('rev-parse', 'refs/remotes/origin/main^{tree}');
    let tip = t.git('rev-parse', 'refs/remotes/origin/main');
    for (let n = 0; n < 405; n += 1) tip = execFileSync('git', ['commit-tree', tree, '-p', tip, '-m', `filler ${n}`], { cwd: t.live, encoding: 'utf8', env: ENV() }).trim();
    t.git('push', '-q', 'origin', `${tip}:refs/heads/main`);
    t.git('fetch', '-q', 'origin');
    const r3 = await t.check({ transcript: says({ subjects: [LONG] }) });
    assert.deepStrictEqual(r3.commits.map((c) => [c.sha, c.landed, c.landedAs]), [[local, 'patch-id', onOrigin]]);
});

test('landed with its conflicts resolved (another patch, same subject), and a two-line subject', async () => {
    const t = liveTree('resolved', { 'p.txt': 'a\n' });
    const local = t.commit({ 'p.txt': 'a\nmine\n' }, LONG);
    const two = 'feat(thing): the first line of a two line subject\nand the line that follows it';
    const local2 = t.commit({ 'q.txt': 'q\n' }, two);
    const copy = t.land({ 'p.txt': 'a\ntheirs\nmine\n' }, LONG);
    const copy2 = t.land({ 'q.txt': 'q resolved\n' }, two);
    const f = transcriptFile('two.jsonl', [quiet(LONG), [`git commit -q -F - -- q.txt <<'EOF'\n${two}\n\nbody\nEOF`, '']]);
    const r = await t.check({ transcript: () => L.readTranscript(f, 0) });
    assert.deepStrictEqual(r.problems, []);
    assert.deepStrictEqual(r.commits.map((c) => [c.sha, c.landed, c.landedAs]).sort(), [[local, 'subject', copy], [local2, 'subject', copy2]].sort());
});

test('a quiet commit that is not on origin is found and flagged; the landing prompt says where each commit is', async () => {
    const t = liveTree('unlanded');
    const landed = t.commit({ 'p.txt': 'p\n' }, `${LONG} landed`);
    t.land({ 'other.txt': 'o\n' }, 'origin is ahead');
    const copy = t.pick(landed);
    const local = t.commit({ 'u.txt': 'u\n' }, `${LONG} never pushed`);
    const unpushed = t.pick(local, false); // a worktree copy whose push never happened: the same piece of work
    const deps = { transcript: says({ commits: [{ sha: unpushed, subject: `${LONG} never pushed` }], subjects: [`${LONG} landed`, `${LONG} never pushed`] }) };
    const r = await t.check(deps);
    assert.deepStrictEqual(kinds(r), ['not-landed']);
    assert.deepStrictEqual(r.problems[0].commits, [local]);
    assert.strictEqual(r.commits.length, 2, JSON.stringify(r.commits));
    const { calls, hooks } = gateHooks(() => t.check(deps), false);
    await L.gate(hooks, row(), 'done');
    assert.ok(calls.enq[0].prompt.includes(`\nCommits: ${local.slice(0, 8)} (not on origin/main), ${landed.slice(0, 8)} (on origin/main as ${copy.slice(0, 8)})\n`), calls.enq[0].prompt);
});

test('a short subject counts only when its commit holds nothing but files the item wrote', async () => {
    const t = liveTree('short');
    const sha = t.commit({ 'theirs.txt': 't\n' }, 'wip');
    const r = await t.check({ edited: wrote('mine.txt'), transcript: says({ subjects: ['wip'] }) });
    assert.deepStrictEqual([r.ok, r.commits], [true, []]);
    const r2 = await t.check({ edited: wrote('theirs.txt'), transcript: says({ subjects: ['wip'] }) });
    assert.deepStrictEqual([kinds(r2), r2.commits.map((c) => c.sha)], [['not-landed'], [sha]]);
    // an unrelated commit on origin with the same short subject does not count as its copy
    t.land({ 'elsewhere.txt': 'e\n' }, 'wip');
    const r3 = await t.check({ edited: wrote('theirs.txt'), transcript: says({ commits: [{ sha, subject: 'wip' }] }) });
    assert.deepStrictEqual(kinds(r3), ['not-landed']);
});

test('removed lines are judged on the origin copy, not on the stale local history', async () => {
    const t = liveTree('blame', { 's.txt': num(8, 'keep') });
    const added = num(8, 'keep') + num(5, 'mine');
    t.commit({ 's.txt': added }, 'chore: another session backs up the whole live tree', daysAgo(1));
    const first = `${LONG} adds the lines`;
    const second = `${LONG} reworks the lines`;
    t.land({ 's.txt': added }, first);
    const local = t.commit({ 's.txt': num(8, 'keep') }, second);
    const copy = t.pick(local);
    // the local sha is known too (as when git printed it): its local parent would credit the lines to the backup commit
    const r = await t.check({ edited: wrote('s.txt'), transcript: says({ commits: [{ sha: local, subject: second }], subjects: [first, second] }) });
    assert.deepStrictEqual(r.problems, []);
    assert.ok(r.commits.some((c) => c.sha === local && c.landedAs === copy), JSON.stringify(r.commits));
});

test('gone files: a path origin/main ever had is judged on origin/main alone', async () => {
    const t = liveTree('gonefile', { 'dropped.txt': 'd\n' });
    t.land({ 'newer.txt': 'n\n' }, 'added on origin only');
    const editors = async () => [{ agentId: 'claude-bbbbbbbb', lastAt: Date.now() - 3600000 }];
    const r = await t.check({ edited: wrote('newer.txt'), editors });
    assert.deepStrictEqual(r.problems, []);
    t.land({ 'dropped.txt': null }, 'deleted on origin, still in the stale HEAD');
    t.put({ 'dropped.txt': null });
    const r2 = await t.check({ edited: wrote('dropped.txt'), editors });
    assert.deepStrictEqual(kinds(r2), ['removed-others']);
    assert.match(r2.problems[0].text, /^dropped\.txt is deleted on origin\/main but claude-bbbbbbbb edited it recently$/);
});

test('the real claim and edit lookups (a throwaway coord db): live claims, and only edits of this very file', async () => {
    const store = require('../modules/agentCoord/store');
    assert.ok(store.dbPath().startsWith(tmp), 'never the real coord db');
    const t = liveTree('coord', { 'claimed.txt': '1\n', 'edited.txt': '1\n', 'rel.txt': '1\n', 'mine.txt': '1\n' });
    t.put({ 'claimed.txt': '2\n', 'edited.txt': '2\n', 'rel.txt': '2\n', 'mine.txt': '2\n' });
    const sid = (c) => `${c.repeat(8)}-0000-0000-0000-000000000001`;
    const agent = (c, repo) => store.upsertAgent({ id: `claude-${c.repeat(8)}`, kind: 'claude', sessionId: sid(c), repo, cwd: t.live });
    agent('a', 'proj'); agent('b', 'proj'); agent('c', 'proj'); agent('d', 'other-repo'); agent('e', 'proj');
    store.claim('claude-bbbbbbbb', 'proj', ['claimed.txt']);
    store.claim('claude-aaaaaaaa', 'proj', ['mine.txt']); // its own claim
    const projects = path.join(process.env.DREAMSCAPE_CLAUDE_HOME, '.claude', 'projects', 'p');
    fs.mkdirSync(projects, { recursive: true });
    const edits = (c, paths, at) => fs.writeFileSync(path.join(projects, `${sid(c)}.jsonl`), paths.map((p) => JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { content: [{ type: 'tool_use', id: p, name: 'Edit', input: { file_path: p } }] } })).join('\n') + '\n');
    const after = Date.now() + 3600000;
    edits('a', [path.join(t.live, 'mine.txt')], after);                                     // its own
    edits('c', [path.join(t.live, 'edited.txt'), '/somewhere/worktree/mine.txt'], after);   // this file; a worktree's copy
    edits('d', ['mine.txt'], after);                                                        // another repo's file of that name
    edits('e', ['rel.txt'], after);                                                         // relative, same repo
    const r = await t.check({ edited: wrote('claimed.txt', 'edited.txt', 'rel.txt', 'mine.txt'), claims: undefined, editors: undefined });
    assert.deepStrictEqual(r.held.map((h) => `${h.file} ${h.holder}`).sort(), ['claimed.txt claude-bbbbbbbb', 'edited.txt claude-cccccccc', 'rel.txt claude-eeeeeeee'], JSON.stringify(r));
    assert.deepStrictEqual(flagged(r), ['mine.txt']);
});

test('a failed command (refused push): its unpushed commit is found when it holds a file the item wrote, another is not', async () => {
    write('refused.txt', num(3, 'refused'));
    const subject = 'add the file whose push was refused by origin';
    const sha = commit(subject);
    const deps = (edited) => ({ edited: async () => edited, transcript: async () => ({ commits: [], pushed: [], subjects: [], unsure: [subject] }), fetch: false });
    const r = await run(deps([{ path: 'refused.txt', lastAt: Date.now() }]));
    assert.deepStrictEqual(kinds(r), ['not-landed'], JSON.stringify(r.problems));
    assert.deepStrictEqual(r.problems[0].commits, [sha]);
    const r2 = await run(deps([{ path: 'base.txt', lastAt: started + 1000 }]));
    assert.deepStrictEqual(r2.commits, []);
    const f = path.join(tmp, 'failed.jsonl');
    const ts = new Date().toISOString();
    fs.writeFileSync(f, [
        JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_use', id: 'x1', name: 'Bash', input: { command: `git commit -q -m "${subject}" && git push -q` } }] } }),
        JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: 'x1', is_error: true, content: 'rejected' }] } })
    ].join('\n') + '\n');
    const t = await L.readTranscript(f, 0);
    assert.deepStrictEqual([t.subjects, t.unsure], [[], [subject]]);
    sh(work, 'push', '-q', 'origin', 'HEAD:refs/heads/side-refused');
});

test('gate: only removed lines and the steer fails: done, no landing item', async () => {
    const calls = { enq: 0, comment: [] };
    const hooks = {
        checkLanding: async () => ({ ok: false, commits: [], held: [], problems: [{ kind: 'removed-others', text: 'it removed 2 lines', files: ['a'], commits: ['abc'] }] }),
        setWork: () => {}, emit: () => {}, comment: (w, t) => calls.comment.push(t), enqueue: () => { calls.enq += 1; return { id: 9 }; },
        steer: async () => { throw new Error('no terminal'); }, isLive: () => true
    };
    const r = await L.gate(hooks, { id: 601, session_id: 'aaaaaaaa-0000-0000-0000-000000000009', started_at: 1, title: 'T', cwd: work }, 'fine');
    assert.strictEqual(r.done, true);
    assert.strictEqual(calls.enq, 0);
    assert.match(calls.comment[0], /could not be asked/);
});

test('a commit whose content origin/main holds under another commit (squashed) is landed; one file short is not', async () => {
    const t = liveTree('squashed', { 'x.txt': 'one\n', 'y.txt': 'one\n', 'z.txt': 'one\n' });
    t.put({ 'x.txt': 'two\n', 'y.txt': 'two\n' });
    t.git('add', 'x.txt', 'y.txt');
    t.git('commit', '-q', '-m', 'the item commits two files on local main');
    const sha = t.git('rev-parse', 'HEAD');
    const deps = { edited: wrote('x.txt', 'y.txt'), transcript: async () => ({ commits: [{ sha, subject: 'the item commits two files on local main' }], pushed: [] }) };
    // origin has one of the two files only: still not landed
    t.land({ 'x.txt': 'two\n', 'z.txt': 'other work\n' }, 'somebody squashes the first half');
    assert.deepStrictEqual(kinds(await t.check(deps)), ['not-landed']);
    // the second arrives in another commit, then origin moves on past it
    t.land({ 'y.txt': 'two\n' }, 'the second half under other words');
    const r = await t.check(deps);
    assert.deepStrictEqual(r.problems, [], JSON.stringify(r.problems));
    assert.deepStrictEqual([r.commits[0].landed, r.commits[0].landedAs], ['content', undefined]);
    t.land({ 'y.txt': 'three\n' }, 'origin moves on again');
    assert.deepStrictEqual((await t.check(deps)).problems, []);
});

(async () => {
    for (const [name, fn] of tests) {
        try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 4).join('\n     ')}`); }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
