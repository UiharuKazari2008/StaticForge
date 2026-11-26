#!/usr/bin/env node
'use strict';

/**
 * modules/fleetDeps.js: dependency detection (explicit, issue, files), cycle avoidance, start order, prerequisites,
 * the graph the Fleet page draws, priority. Temp agent-coord DB.
 *
 *   node scripts/test-fleet-deps.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-deps-'));
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');

const store = require('../modules/agentCoord/store');
const deps = require('../modules/fleetDeps');
store.open().exec('CREATE TABLE supervisor_work (id INTEGER PRIMARY KEY, state TEXT NOT NULL)');
const setState = (id, s) => store.open().prepare('INSERT INTO supervisor_work (id, state) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state').run(id, s);
const item = (id, state, prompt, extra = {}) => { setState(id, state); return Object.assign({ id, title: `Item ${id}`, prompt, state, startNow: false, issue: null, issues: [], parentId: null, sourceRef: '' }, extra); };
const edge = (to, from) => deps.depsOf(to).find((e) => e.on === from);
let n = 0;
const ok = (name, fn) => { fn(); n += 1; console.log(`ok - ${name}`); };

ok('explicit: "after item N"', () => {
    const items = [item(1, 'held', 'Build the thing'), item(2, 'held', 'Do this after item 1 is finished')];
    deps.detect(items);
    assert.strictEqual(edge(2, 1).kind, 'explicit');
    assert.deepStrictEqual(deps.blockedBy(2), [1]);
    assert.deepStrictEqual(deps.blockedBy(1), []);
});

ok('issue: "blocked by #N" and owner/repo#N', () => {
    const a = item(11, 'held', 'Work A', { issue: { repo: 'DreamScape/StaticForge', number: 500 }, issues: [{ repo: 'DreamScape/StaticForge', number: 500 }] });
    const b = item(12, 'held', 'Work B, blocked by #500', { issue: { repo: 'DreamScape/StaticForge', number: 501 }, issues: [{ repo: 'DreamScape/StaticForge', number: 501 }] });
    const c = item(13, 'queued', 'Work C, depends on DreamScape/StaticForge#500');
    deps.detect([a, b, c]);
    assert.strictEqual(edge(12, 11).kind, 'issue');
    assert.strictEqual(edge(13, 11).kind, 'issue');
});

ok('follow-up hand-off is linked but does not block', () => {
    const a = item(21, 'running', 'origin');
    const b = item(22, 'queued', 'landing check', { sourceRef: 'supervisor:landing:21' });
    deps.detect([a, b]);
    assert.strictEqual(edge(22, 21).reason, 'follow-up of 21');
    assert.deepStrictEqual(deps.blockedBy(22), []);
});

ok('files: the later item waits; common files and crowded paths ignored', () => {
    const a = item(31, 'running', 'Change `modules/foo.js` and CLAUDE.md');
    const b = item(32, 'held', 'Also edit modules/foo.js and package.json and CLAUDE.md');
    const c = item(33, 'held', 'Touch scripts/other.js only');
    deps.detect([a, b, c]);
    assert.strictEqual(edge(32, 31).kind, 'files');
    assert.ok(/modules\/foo\.js/.test(edge(32, 31).reason));
    assert.ok(!/CLAUDE|package/.test(edge(32, 31).reason));
    assert.strictEqual(deps.depsOf(33).length, 0);
    const crowd = [];
    for (let i = 0; i < 7; i += 1) crowd.push(item(40 + i, 'held', 'edit modules/crowded.js'));
    deps.detect(crowd);
    assert.strictEqual(deps.depsOf(46).length, 0);
});

ok('no cycles: the older edge stays', () => {
    const a = item(51, 'held', 'A');
    const b = item(52, 'held', 'B after item 51');
    const c = item(53, 'held', 'C');
    deps.detect([a, b, c]);
    assert.strictEqual(deps.addDep(51, 52, 'wrong way'), false);
    assert.strictEqual(deps.addDep(53, 52, 'ok'), true);
    assert.strictEqual(deps.addDep(51, 53, 'closes 51>53>52>51'), false);
    assert.strictEqual(deps.addDep(51, 51, 'self'), false);
    const cyc = [item(54, 'held', 'after item 55'), item(55, 'held', 'after item 54')];
    deps.detect(cyc);
    assert.ok(!!edge(54, 55) !== !!edge(55, 54));
});

ok('orderQueued: deps before priority before id; blocked flagged', () => {
    for (let i = 60; i < 66; i += 1) setState(i, 'queued');
    setState(70, 'running'); setState(71, 'done');
    deps.addDep(60, 61, 'needs 61');           // 60 waits for queued 61
    deps.addDep(62, 70, 'running prerequisite');
    deps.addDep(63, 71, 'done prerequisite');
    deps.setPriority(64, 2);
    deps.setPriority(65, 1);
    const rows = [60, 61, 62, 63, 64, 65].map((id) => ({ id, start_now: 0 }));
    rows.find((r) => r.id === 65).start_now = 1;
    const out = deps.orderQueued(rows);
    const ids = out.map((r) => r.id);
    assert.ok(ids.indexOf(61) < ids.indexOf(60), 'prerequisite first');
    assert.deepStrictEqual(ids.slice(0, 2), [64, 65], 'priority first, then start_now');
    assert.deepStrictEqual(out.find((r) => r.id === 60).blocked, [61]);
    assert.ok(/^Waiting for item 61 \(needs 61\)/.test(out.find((r) => r.id === 60).blockedReason));
    assert.deepStrictEqual(out.find((r) => r.id === 62).blocked, [70]);
    assert.strictEqual(out.find((r) => r.id === 63).blocked, undefined, 'done prerequisite does not block');
    assert.strictEqual(out.find((r) => r.id === 61).blocked, undefined);
});

ok('a failed prerequisite still blocks', () => {
    setState(80, 'failed'); setState(81, 'queued');
    deps.addDep(81, 80, 'needs 80');
    assert.deepStrictEqual(deps.blockedBy(81), [80]);
    setState(80, 'cancelled');
    assert.deepStrictEqual(deps.blockedBy(81), []);
});

ok('prerequisites: transitive chain in start order', () => {
    ['held', 'held', 'held', 'done'].forEach((s, i) => setState(90 + i, s));
    deps.addDep(92, 91, 'c'); deps.addDep(91, 90, 'b'); deps.addDep(90, 93, 'done one');
    assert.deepStrictEqual(deps.prerequisites(92), [90, 91]);
    assert.deepStrictEqual(deps.prerequisites(90), []);
});

ok('graph: shape, lanes, queue order, done only when it matters', () => {
    const now = Date.now();
    const mk = (id, state, extra) => Object.assign({ id, title: `T${id}`, state, account: '', model: '', startedAt: null, endedAt: null, issue: null, parentId: null, startNow: false }, extra);
    for (const [id, s] of [[100, 'held'], [101, 'held'], [102, 'queued'], [103, 'running'], [104, 'done'], [105, 'done'], [106, 'held']]) setState(id, s);
    deps.addDep(102, 100, 'after 100');
    deps.addDep(106, 104, 'on recent done');
    deps.setPriority(101, 2);
    const rows = [mk(100, 'held'), mk(101, 'held'), mk(102, 'queued'), mk(103, 'running', { startedAt: now }), mk(104, 'done', { endedAt: now - 1000 }), mk(105, 'done', { endedAt: now - 1000 }), mk(106, 'held')];
    const g = deps.graph(() => rows);
    const node = (id) => g.nodes.find((x) => x.id === id);
    assert.deepStrictEqual(Object.keys(node(100)).sort(), ['account', 'blocked', 'endedAt', 'id', 'issue', 'lane', 'model', 'order', 'parentId', 'priority', 'startedAt', 'state', 'title']);
    assert.strictEqual(node(100).lane, 0);
    assert.strictEqual(node(101).lane, 0);
    assert.strictEqual(node(102).lane, 1);
    assert.strictEqual(node(106).lane, 0, 'done prerequisite does not push a lane');
    assert.deepStrictEqual(node(102).blocked, [100]);
    assert.strictEqual(node(102).order, 1);
    assert.strictEqual(node(100).order, null);
    assert.strictEqual(node(101).priority, 2);
    assert.ok(node(104) && !node(105), 'done kept only when an open item hangs on it');
    assert.deepStrictEqual(g.done, [104]);
    assert.deepStrictEqual(g.running, [103]);
    assert.deepStrictEqual(g.queue, [102]);
    assert.ok(g.waiting.includes(100) && g.waiting.includes(101));
    assert.ok(g.edges.some((e) => e.from === 100 && e.to === 102 && e.kind === 'explicit' && e.reason === 'after 100'));
});

ok('setPriority clamps and persists', () => {
    assert.strictEqual(deps.setPriority(200, 9), 2);
    assert.strictEqual(deps.setPriority(200, -9), -2);
    assert.strictEqual(deps.priorities().get(200), -2);
});

ok('removeDep and detectWithModel are callable', async () => {
    assert.strictEqual(deps.removeDep(2, 1), true);
    assert.strictEqual(deps.removeDep(2, 1), false);
});

(async () => {
    // a removed detected dependency is not detected again; setting it by hand brings it back
    setState(400, 'held'); setState(401, 'held');
    assert.strictEqual(deps.addDep(401, 400, 'same files', 'files'), true);
    assert.strictEqual(deps.removeDep(401, 400), true);
    assert.strictEqual(deps.addDep(401, 400, 'same files', 'files'), false, 'detection does not bring it back');
    assert.strictEqual(deps.addDep(401, 400, 'set in Fleet', 'explicit'), true, 'by hand it comes back');
    console.log('ok - removed stays removed');
    setState(300, 'held'); setState(301, 'held');
    const added = await deps.detectWithModel(async () => ({ deps: [{ item: 301, after: 300, reason: 'needs its schema' }, { item: 301, after: 999, reason: 'bogus' }] }), [{ id: 300, state: 'held', title: 'a', prompt: '' }, { id: 301, state: 'held', title: 'b', prompt: '' }]);
    assert.strictEqual(added.length, 1);
    assert.strictEqual(edge(301, 300).kind, 'model');
    console.log(`ok - detectWithModel\n${n + 1} groups passed`);
})().catch((e) => { console.error(e); process.exit(1); });
