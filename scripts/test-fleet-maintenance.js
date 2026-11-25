#!/usr/bin/env node
'use strict';

/**
 * modules/fleetMaintenance.js: worktree and branch clean-up on temp git repos (merged branch deleted, unmerged kept,
 * dirty worktree kept, clean merged worktree removed), the error log grouping and issue filing against a fake Yozora,
 * the PR queueing, and the disk / thermal parsers on fixtures. Never touches the real repos, Yozora or PM2.
 *
 *   node scripts/test-fleet-maintenance.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maint-'));
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
process.env.FLEET_MAINTENANCE_OFF = '1';
const m = require('../modules/fleetMaintenance');
const T = m._test;

const sh = (cwd, cmd) => cp.execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) }).toString().trim();
let n = 0;
const ok = (msg) => { n += 1; console.log(`ok ${n} - ${msg}`); };
const S = (over) => m.settings(null, Object.assign({ worktreeMinAgeDays: 0, branchMinAgeHours: 0, protectPaths: [] }, over || {}));

(async () => {
    // ---- temp repos: a bare origin, a clone with main pushed
    const origin = path.join(tmp, 'origin.git');
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(origin);
    sh(origin, 'git init --bare -q -b main');
    sh(tmp, `git clone -q ${origin} repo`);
    sh(repo, 'git checkout -q -b main');
    fs.writeFileSync(path.join(repo, 'a.txt'), '1');
    sh(repo, 'git add . && git commit -q -m one && git push -q -u origin main');
    // merged branch (+ pushed), clean worktree on a merged branch, dirty worktree, unmerged worktree, unmerged branch
    sh(repo, 'git branch merged-done && git branch merged-wt && git branch merged-dirty');
    sh(repo, 'git checkout -q -b unmerged-b && echo x > b.txt && git add . && git commit -q -m unmerged && git checkout -q main');
    sh(repo, 'git checkout -q -b unmerged-wt && echo y > c.txt && git add . && git commit -q -m unmergedwt && git checkout -q main');
    sh(repo, 'git push -q origin main');
    const wt = (b) => path.join(tmp, `wt-${b}`);
    sh(repo, `git worktree add -q ${wt('merged-wt')} merged-wt`);
    sh(repo, `git worktree add -q ${wt('merged-dirty')} merged-dirty`);
    fs.writeFileSync(path.join(wt('merged-dirty'), 'dirty.txt'), 'wip');
    sh(repo, `git worktree add -q ${wt('unmerged-wt')} unmerged-wt`);
    // a worktree whose folder is gone
    sh(repo, 'git branch gone-b');
    sh(repo, `git worktree add -q ${wt('gone-b')} gone-b`);
    fs.rmSync(wt('gone-b'), { recursive: true, force: true });

    // parsers
    const parsed = T.parseWorktrees(sh(repo, 'git worktree list --porcelain'));
    assert.strictEqual(parsed.length, 5);
    assert.ok(parsed.some((w) => w.branch === 'merged-wt'));
    ok('worktree list parsed');

    // dry run changes nothing
    const dry = await T.checkWorktrees({ settings: S(), dryRun: true, repos: [repo], liveCwds: [], fetch: true });
    assert.ok(dry.actions.some((a) => /Would remove worktree .*merged-wt/.test(a)), JSON.stringify(dry));
    assert.ok(fs.existsSync(wt('merged-wt')));
    ok('dry run reports and removes nothing');

    // a live session in a worktree keeps it
    const live = await T.checkWorktrees({ settings: S(), dryRun: true, repos: [repo], liveCwds: [path.join(wt('merged-wt'), 'sub')] });
    assert.ok(live.findings.some((f) => /merged-wt.*live session/.test(f.text)), JSON.stringify(live.findings));
    ok('a live session keeps its worktree');

    // a busy lock keeps it
    fs.writeFileSync(path.join(wt('merged-wt'), '.agent-test'), 'x');
    const lock = await T.checkWorktrees({ settings: S(), dryRun: true, repos: [repo], liveCwds: [] });
    assert.ok(lock.findings.some((f) => /merged-wt.*busy lock/.test(f.text)));
    fs.rmSync(path.join(wt('merged-wt'), '.agent-test'));
    ok('a busy lock keeps its worktree');

    // young worktrees are kept by the age guard
    const young = await T.checkWorktrees({ settings: S({ worktreeMinAgeDays: 3 }), dryRun: true, repos: [repo], liveCwds: [] });
    assert.ok(young.findings.some((f) => /less than 3 days/.test(f.text)));
    ok('the age guard keeps a young worktree');

    // the real run
    const wr = await T.checkWorktrees({ settings: S(), dryRun: false, repos: [repo], liveCwds: [] });
    assert.ok(!fs.existsSync(wt('merged-wt')), 'clean merged worktree removed');
    assert.ok(fs.existsSync(wt('merged-dirty')), 'dirty worktree kept');
    assert.ok(fs.existsSync(wt('unmerged-wt')), 'unmerged worktree kept');
    assert.ok(wr.actions.some((a) => /Pruned 1 dead/.test(a)), JSON.stringify(wr.actions));
    assert.ok(!/gone-b/.test(sh(repo, 'git worktree list')), 'dead record pruned');
    assert.ok(wr.findings.some((f) => /merged-dirty.*uncommitted/.test(f.text)));
    assert.ok(wr.findings.some((f) => /unmerged-wt.*not merged and not pushed/.test(f.text)));
    ok('worktrees: clean merged removed, dirty and unmerged kept, dead pruned');
    const again = await T.checkWorktrees({ settings: S(), dryRun: false, repos: [repo], liveCwds: [] });
    assert.ok(!again.actions.length);
    ok('a second run does nothing');

    // branches
    const br = await T.checkBranches({ settings: S(), dryRun: false, repos: [repo], liveCwds: [], yozoraRepos: [] });
    const heads = sh(repo, 'git branch --format="%(refname:short)"').split('\n');
    assert.ok(!heads.includes('merged-done'), 'merged branch deleted');
    assert.ok(!heads.includes('merged-wt'), 'merged branch of the removed worktree deleted');
    assert.ok(!heads.includes('gone-b'), 'merged branch of the pruned worktree deleted');
    assert.ok(heads.includes('merged-dirty'), 'branch checked out in a worktree kept');
    assert.ok(heads.includes('unmerged-b') && heads.includes('unmerged-wt'), 'unmerged branches kept');
    assert.ok(heads.includes('main'));
    assert.ok(br.actions.some((a) => /merged-done/.test(a)));
    ok('branches: merged deleted, unmerged / checked-out / main kept');
    const young2 = await T.checkBranches({ settings: S({ branchMinAgeHours: 24 }), dryRun: true, repos: [repo], liveCwds: [], yozoraRepos: [] });
    assert.ok(!young2.actions.length);
    ok('no branch younger than the minimum age is touched');

    // ---- error log grouping
    const log = [
        '2026-11-24T10:00:00: TypeError: Cannot read properties of undefined (reading \'x\')',
        '2026-11-24T10:00:00:     at foo (/srv/app/modules/a.js:10:5)',
        '2026-11-24T10:00:00:     at bar (/srv/app/modules/b.js:2:1)',
        '2026-11-24T10:05:00: TypeError: Cannot read properties of undefined (reading \'x\')',
        '2026-11-24T10:05:00:     at foo (/srv/app/modules/a.js:11:7)',
        '2026-11-24T10:09:00: Failed job 123 for session 6f1c2d3e-aaaa-bbbb-cccc-1234567890ab',
        '2026-11-24T10:10:00: Failed job 456 for session 11112222-aaaa-bbbb-cccc-1234567890ab',
        '2026-11-24T10:11:00: Failed job 789 for session 33334444-aaaa-bbbb-cccc-1234567890ab',
        '2026-11-24T10:12:00: (node:99) [DEP0060] DeprecationWarning: The `util._extend` API is deprecated.',
        '2026-11-24T10:12:00: (Use `node --trace-deprecation ...` to show where the warning was created)',
        '2026-11-23T01:00:00: very old line'
    ].join('\n');
    const groups = T.groupErrors(log, { since: Date.parse('2026-11-24T00:00:00'), ignore: m.DEFAULTS.errorIgnore });
    assert.strictEqual(groups.length, 2, JSON.stringify(groups.map((g) => g.message)));
    assert.strictEqual(groups[0].count, 3);
    assert.ok(/Failed job/.test(groups[0].message));
    assert.strictEqual(groups[1].count, 2);
    assert.ok(/foo/.test(groups[1].topFrame) && !/:10/.test(groups[1].topFrame));
    assert.strictEqual(T.groupErrors(log, { since: 0, ignore: [] }).length, 5 - 0, 'without filters: the old line and both warnings count');
    ok('error log grouped by normalised message and top frame; noise and old lines dropped');

    // ---- error check end to end with a fake Yozora and a fake queue
    const logFile = path.join(tmp, 'err.log');
    fs.writeFileSync(logFile, `${log}\n`);
    const calls = [];
    const issues = [];
    const yz = {
        DEFAULT_REPO: 'Org/Repo',
        repoForCwd: () => 'Org/Repo',
        labels: async () => new Map([['bug', 1], ['fleet', 2]]),
        call: async (method, url, body) => {
            calls.push({ method, url, body });
            if (method === 'GET' && /issues\?/.test(url)) return [];
            if (method === 'POST' && /\/issues$/.test(url)) { issues.push(body); return { number: 40 + issues.length, id: 1 }; }
            if (method === 'GET' && /pulls\?/.test(url)) return [
                { number: 7, title: 'Good one', mergeable: true, head: { ref: 'f' }, base: { ref: 'main', sha: 'aaa' }, merge_base: 'aaa', user: { login: 'u' } },
                { number: 8, title: 'Conflicted', mergeable: false, head: { ref: 'g' }, base: { ref: 'main', sha: 'aaa' }, merge_base: 'aaa' },
                { number: 9, title: 'Behind', mergeable: true, head: { ref: 'h' }, base: { ref: 'main', sha: 'bbb' }, merge_base: 'aaa' }
            ];
            return {};
        }
    };
    const queued = [];
    const fakeSup = { enqueue: (it) => { queued.push(it); return { id: queued.length }; } };
    const ectx = { settings: S({ errorThreshold: 3 }), dryRun: true, yz, sup: fakeSup, errorLog: logFile };
    // the first run reads the last day only: pin "now" by making the fixture recent
    const recent = log.replace(/2026-11-24T/g, `${new Date().toISOString().slice(0, 10)}T`).replace('2026-11-23T01:00:00', '2001-01-01T00:00:00');
    fs.writeFileSync(logFile, `${recent}\n`);
    const dryErr = await T.checkErrors(ectx);
    assert.ok(dryErr.actions.some((a) => /Would file/.test(a)) && !issues.length, JSON.stringify(dryErr));
    ok('errors dry run files nothing');
    const real = await T.checkErrors(Object.assign({}, ectx, { dryRun: false }));
    assert.strictEqual(issues.length, 1, 'only the group seen 3 times is filed');
    assert.ok(/fleet-maint-error:[0-9a-f]{12}/.test(issues[0].body));
    assert.deepStrictEqual(issues[0].labels, [1, 2]);
    assert.strictEqual(queued.length, 1);
    assert.ok(/^maint-error:/.test(queued[0].sourceRef));
    assert.strictEqual(real.state, 'warn');
    ok('errors: the repeating group becomes one issue and one held work item');
    // second run: nothing new in the log, so nothing happens (the offset moved)
    const second = await T.checkErrors(Object.assign({}, ectx, { dryRun: false }));
    assert.strictEqual(issues.length, 1);
    assert.ok(/No new errors/.test(second.summary), second.summary);
    // the log grows with the same error: a comment, not a second issue
    fs.appendFileSync(logFile, `${new Date().toISOString().slice(0, 19)}: Failed job 999 for session aaaaaaaa-aaaa-bbbb-cccc-1234567890ab\n`);
    const third = await T.checkErrors(Object.assign({}, ectx, { dryRun: false }));
    assert.strictEqual(issues.length, 1);
    assert.ok(calls.some((c) => c.method === 'POST' && /issues\/41\/comments/.test(c.url)), JSON.stringify(calls.map((c) => c.url)));
    assert.ok(third.findings.length);
    ok('errors: later runs comment the count, never a duplicate issue');

    // ---- PRs
    const pr = await T.checkPrs({ settings: S(), dryRun: false, yz, sup: fakeSup, yozoraRepos: ['Org/Repo'], repos: [repo] });
    const prQueued = queued.filter((q) => /^pr:/.test(q.sourceRef));
    assert.strictEqual(prQueued.length, 1);
    assert.strictEqual(prQueued[0].sourceRef, 'pr:Org/Repo#7');
    assert.strictEqual(prQueued[0].source, 'yozora');
    assert.ok(/Merge PR #7: Good one/.test(prQueued[0].title));
    assert.ok(pr.findings.some((f) => /#8.*not mergeable/.test(f.text)) && pr.findings.some((f) => /#9.*behind/.test(f.text)));
    ok('PRs: only the mergeable, up-to-date one is queued (never merged by the run)');

    // ---- Waiting work: verdicts from a stubbed engine, a fake Yozora and a fake queue
    const items = new Map();
    const mk = (id, extra) => items.set(id, Object.assign({ id, title: `Item ${id}`, state: 'held', cwd: repo, createdAt: Date.now() - id * 1000, prompt: `Edit a.txt and gone/missing.js (item ${id})`, issue: { repo: 'Org/Repo', number: 100 + id }, check: null }, extra || {}));
    [1, 2, 3, 4, 5, 6].forEach((i) => mk(i));
    mk(7, { check: { verdict: 'valid', at: Date.now() - 3600 * 1000, issueUpdatedAt: 'same' } }); // checked an hour ago, issue unchanged: skipped
    mk(8, { check: { verdict: 'valid', at: Date.now() - 3600 * 1000, issueUpdatedAt: 'old' } }); // issue changed since: checked again
    mk(9, { state: 'running' });
    const stored = []; const cancelled = []; const asks = [];
    const wsup = {
        listWork: () => [...items.values()], workPrompt: (id) => items.get(id).prompt,
        setWork: (id, f) => { stored.push([id, f]); },
        cancelWork: (id) => { cancelled.push(id); return items.get(id); }, emitChange: () => {}
    };
    const wyz = {
        call: async (method, url) => {
            const mm = /issues\/(\d+)(\/comments)?$/.exec(url);
            const n = Number(mm[1]) - 100;
            if (mm[2]) return [{ user: { login: 'u' }, body: 'c1' }, { user: { login: 'u' }, body: 'c2' }];
            return { state: n === 6 ? 'closed' : 'open', labels: [{ name: 'fleet' }], updated_at: n === 7 ? 'same' : 'new' };
        }
    };
    const verdicts = { 1: 'valid', 2: 'done', 3: 'outdated', 4: 'duplicate', 5: 'bogus', 8: 'valid' };
    const wctx = (over) => Object.assign({ settings: S(), dryRun: false, sup: wsup, yz: wyz, askJson: async (sys, user) => {
        const p = JSON.parse(user); asks.push(p);
        return { verdicts: p.items.map((it) => ({ id: it.id, verdict: verdicts[it.id], evidence: `evidence ${it.id}`, suggestedBrief: it.id === 3 ? 'The new brief' : '', duplicateOf: it.id === 4 ? '#1' : '' })) };
    } }, over || {});
    const dryW = await T.checkWaiting(wctx({ dryRun: true }));
    assert.ok(!stored.length && !cancelled.length, 'a dry run writes nothing');
    assert.ok(dryW.actions.some((a) => /Would cancel #6/.test(a)));
    const wr2 = await T.checkWaiting(wctx());
    assert.strictEqual(wr2.id, 'waiting');
    assert.strictEqual(wr2.title, 'Waiting work');
    assert.deepStrictEqual(cancelled, [6], 'a closed issue cancels its held item');
    const askedIds = [].concat(...asks.slice(-2).map((a) => a.items.map((i) => i.id))).sort();
    assert.deepStrictEqual(askedIds, [1, 2, 3, 4, 5, 8], 'running, closed and recently checked items are not asked');
    assert.ok(asks.every((a) => a.items.length <= 4), 'batched');
    const st = new Map(stored.filter(([, f]) => f.check_json).map(([id, f]) => [id, JSON.parse(f.check_json)]));
    assert.strictEqual(st.get(3).verdict, 'outdated');
    assert.strictEqual(st.get(3).suggestedBrief, 'The new brief');
    assert.strictEqual(st.get(4).duplicateOf, '#1');
    assert.strictEqual(st.get(5).verdict, 'unclear', 'an unknown verdict becomes unclear');
    assert.deepStrictEqual(st.get(1).filesMissing, ['gone/missing.js']);
    assert.ok(stored.every(([, f]) => !('prompt' in f)), 'the brief is never rewritten');
    assert.ok(/1 valid.*1 done|done.*outdated/.test(wr2.summary) && wr2.counts.outdated === 1, wr2.summary);
    // an engine failure stores nothing and warns
    stored.length = 0;
    const bad = await T.checkWaiting(wctx({ askJson: async () => { throw new Error('boom'); } }));
    assert.strictEqual(bad.state, 'warn');
    assert.ok(!stored.some(([, f]) => f.check_json));
    ok('waiting work: verdicts stored on the items, closed issue cancels, recent / running skipped, dry run and engine failure write nothing');

    // ---- disk and thermal parsers
    const df = T.parseDf('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/nvme0n1p2 462217072 274742432 163921824 63% /\ntmpfs 7124736 2768148 4356588 39% /tmp\n');
    assert.deepStrictEqual(df.map((d) => [d.mount, d.pct]), [['/', 63], ['/tmp', 39]]);
    const du = T.parseDu('100\t/x/a\n5000\t/x/big\n900\t/x/mid\n6000\t/x\n'.replace(/\t/g, ' '), 3);
    assert.deepStrictEqual(du.map((d) => d.path), ['/x/big', '/x/mid', '/x/a']);
    ok('df and du parsed');
    const th = T.parseThermal([{ name: 'thermal_zone0 x86_pkg_temp', milli: 91000 }, { name: 'thermal_zone1 acpitz', milli: 45500 }, { name: 'bad', milli: NaN }]);
    assert.deepStrictEqual(th.map((t) => t.c), [91, 45.5]);
    const sens = T.parseSensors({ 'coretemp-isa-0000': { Adapter: 'ISA', 'Core 0': { temp2_input: 55, temp2_max: 100 }, 'Package id 0': { temp1_input: 62.5 } } });
    assert.deepStrictEqual(sens.map((t) => t.c), [62.5, 55]);
    const mem = T.parseMeminfo('MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 400 kB\nSwapTotal: 200 kB\nSwapFree: 50 kB\n');
    assert.deepStrictEqual(mem, { totalKb: 1000, availKb: 400, swapTotalKb: 200, swapFreeKb: 50 });
    assert.deepStrictEqual(T.parseFailedUnits('  foo.service loaded failed failed Foo\n● bar.timer loaded failed failed Bar\n'), ['foo.service', 'bar.timer']);
    ok('thermal, sensors, meminfo and failed units parsed');
    const tdir = path.join(tmp, 'thermal', 'thermal_zone0');
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(path.join(tdir, 'temp'), '90000\n');
    fs.writeFileSync(path.join(tdir, 'type'), 'fake\n');
    const hot = await T.checkThermals({ settings: S({ thermalWarn: 85 }), dryRun: true, thermalDir: path.join(tmp, 'thermal'), meminfo: 'MemTotal: 1000 kB\nMemAvailable: 900 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n' });
    assert.strictEqual(hot.state, 'warn');
    assert.ok(hot.findings.some((f) => /fake 90 C/.test(f.text)));
    ok('a zone above the limit warns');

    // ---- a whole run on the fixtures stores its report; the history keeps it; a disabled check is skipped
    const rep = await m.execute({ trigger: 'manual', dryRun: true, settings: S({ checks: { prs: false, thermals: false, disk: false, sessions: false, errors: false, workfolders: false, cleanup: false } }), ctx: { repos: [repo], liveCwds: [], yozoraRepos: [], yz: null, sup: { artifactStatus: () => [], listWork: () => [] }, liveSessions: [] } });
    assert.ok(rep.id > 0);
    assert.strictEqual(rep.checks.length, 11);
    assert.strictEqual(rep.checks.find((c) => c.id === 'prs').state, 'skipped');
    assert.strictEqual(m.lastRun().id, rep.id);
    assert.strictEqual(m.history()[0].id, rep.id);
    assert.strictEqual(m.getRun(rep.id).dryRun, true);
    assert.ok(m.nextRunAt(Date.now(), '04:30') > Date.now());
    ok('a run stores its report; history and next run time work');

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\nAll ${n} checks passed.`);
})().catch((e) => { console.error(e); process.exit(1); });
