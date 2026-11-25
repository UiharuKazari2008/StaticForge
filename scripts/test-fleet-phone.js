'use strict';

// The phone Fleet Work Queue feed (#1198): modules/fleetPhoneFeed.js builds the contract object. Sandboxed temp
// coordination DB; the Supervisor's lists are stubbed through the require cache.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-fleet-phone-test-'));
process.env.AGENT_COORD_DB = path.join(SANDBOX, 'coord.db');
process.env.DREAMSCAPE_CLAUDE_HOME = path.join(SANDBOX, 'home');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) { /* gone */ } });

const now = Date.now();
const W = (o) => Object.assign({ engine: 'claude', source: 'fleet', account: '', model: 'm', effort: 'high', sessionId: '', createdAt: now - 1000, startedAt: null, endedAt: null, message: '', topology: 'planner', parentId: null, issue: null, issues: [], questions: [] }, o);
const stub = {
    listWork: () => [
        W({ id: 5, title: 'Parent', state: 'running', sessionId: 'sess-a', issue: { repo: 'DreamScape/StaticForge', number: 1198, url: 'http://y/1198' }, issues: [1, 2] }),
        W({ id: 6, title: 'Child', state: 'done', parentId: 5, endedAt: now - 5000 }),
        W({ id: 4, title: 'Ask', state: 'input', questions: [{ question: 'Q?', answer: '', why: 'w', ask: 'a' }], account: 'Main' }),
        W({ id: 3, title: 'Old', state: 'failed', endedAt: now - 3 * 86400000, createdAt: now - 3 * 86400000 })
    ],
    listHolds: () => [{ id: 1, sessionId: 'sess-a', mode: 'hold', reason: 'because' }],
    summary: () => ({ open: 2 }),
    sessionTasks: () => ({ list: () => ({ tasks: [{ text: 'done one', done: true }, { text: 'doing this', done: false }], counts: { tasksDone: 1, tasksTotal: 2 } }) })
};
const supPath = require.resolve('../modules/agentSupervisor');
require.cache[supPath] = { id: supPath, filename: supPath, loaded: true, exports: stub };
const auditPath = require.resolve('../modules/claudeUsageAudit');
require.cache[auditPath] = { id: auditPath, filename: auditPath, loaded: true, exports: { summary: () => ({ open: 1, items: [{ id: 'f1', title: 'T', reason: 'r', text: 'x', sessionId: 's', at: 1 }] }) } };

const coord = require('../modules/agentCoord/store');
const d = coord.open();
d.exec('CREATE TABLE IF NOT EXISTS supervisor_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, kind TEXT, engine TEXT, model TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost REAL, ok INTEGER, error TEXT, failover_from TEXT)');
const ins = d.prepare('INSERT INTO supervisor_usage (at, cost, ok) VALUES (?, ?, 1)');
ins.run(now, 0.5); ins.run(now - 3 * 86400000, 0.25); ins.run(now - 20 * 86400000, 1); ins.run(now - 40 * 86400000, 9);

const f = require('../modules/fleetPhoneFeed');
const live = [
    { id: 'sess-a', status: 'busy', cwd: '/x/proj', startedAt: now - 5 * 3600000, title: 'A' },
    { id: 'sess-b', status: 'idle', cwd: '/x/other', startedAt: now - 60000, title: 'B' },
    { id: 'sess-c', status: 'idle', cwd: '/x/old', startedAt: now - 9 * 3600000, title: 'C' }
];
const s = f.snapshot(null, { live });
assert.deepStrictEqual(Object.keys(s).sort(), ['calls', 'counts', 'flags', 'unsupervised', 'work'].sort());
assert.deepStrictEqual(s.work.map((w) => w.id), [5, 4, 6], 'open first, old ended dropped');
const p = s.work[0];
assert.strictEqual(p.issue, 'StaticForge#1198 +1');
assert.strictEqual(p.issueUrl, 'http://y/1198');
assert.deepStrictEqual(p.parts, { total: 1, done: 1 });
assert.deepStrictEqual(p.held, { mode: 'hold', reason: 'because' });
assert.strictEqual(p.busy, true);
assert.strictEqual(p.doing, 'doing this');
assert.deepStrictEqual(p.tasks, { done: 1, total: 2 });
assert.strictEqual(p.engine, undefined);
assert.strictEqual(s.work[1].questions.length, 1);
assert.strictEqual(s.work[1].account, 'Main');
assert.strictEqual(s.work[2].tasks, null);
assert.deepStrictEqual(s.unsupervised.map((u) => u.id), ['sess-b'], 'owned, and idle-and-old, are left out');
assert.strictEqual(s.unsupervised[0].folder, 'other');
assert.deepStrictEqual(s.counts, { running: 1, input: 1, held: 0, pending: 0, sentBack: 0, live: 3, busy: 1, gaps: 2, flags: 1, holds: 1, restartWaits: 0 });
assert.deepStrictEqual(s.calls.today.calls, 1);
assert.deepStrictEqual(s.calls.week, { calls: 2, cost: 0.75 });
assert.strictEqual(s.calls.month.calls, 3);
assert.strictEqual(s.flags[0].id, 'f1');

// a failing source does not break the snapshot
stub.listWork = () => { throw new Error('boom'); };
const s2 = f.snapshot(null, { live: [] });
assert.deepStrictEqual(s2.work, []);
console.log('fleet phone feed: ok');
