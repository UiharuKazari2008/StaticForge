#!/usr/bin/env node
'use strict';

/**
 * #1197: "queue as one run" groups its work into logical tasks. One work item that covers several Yozora issues asks the
 * Supervisor's engine to group them: related ones share a planner, unrelated ones get their own planner, each a child item of
 * the one parent item (topology 'groups', no session of its own). Temp home, fake Yozora, fake engine, fake session launcher.
 *
 *   node scripts/test-agent-supervisor-groups.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-groups-'));
// a scratch inbox: a test must never touch the live one (its rows land on Yukimi's phone as notices, #1196)
process.env.NOTIFICATION_INBOX_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-agent-supervisor-groups-')), 'notifications.db');
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
process.env.AGENT_SUPERVISOR_SOCKET = path.join(tmp, 'state', 'supervisor.sock');
process.env.AGENT_SUPERVISOR_SETTLE_MS = '0';
process.env.AGENT_SUPERVISOR_BG_PER_MIN = '100000';
fs.mkdirSync(path.join(tmp, '.claude', 'projects', '-repo'), { recursive: true });
fs.mkdirSync(path.join(tmp, '.claude', 'sessions'), { recursive: true });

const sup = require('../modules/agentSupervisor');
const fleetMcp = require('../modules/claudeFleetMcp');
const launcher = require('../modules/claudeSessionLauncher');

// a fake Yozora: every call recorded, never the network
const yzCalls = [];
const yzIssues = new Map(); // "repo#n" -> { state, title, body, external }
require('../modules/fleetYozora')._setFetch(async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const u = String(url).replace('https://yozora.bluesteel.737.jp.net/api/v1', '');
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    yzCalls.push({ method, url: u, body });
    const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    let m;
    if (method === 'GET' && /\/labels\?/.test(u)) return ok([{ id: 1, name: 'fleet' }, { id: 2, name: 'status:ready' }, { id: 3, name: 'status:in-progress' }, { id: 4, name: 'status:review' }, { id: 5, name: 'status:blocked' }, { id: 6, name: 'status:done' }]);
    if (method === 'GET' && (m = /^\/repos\/([^/]+\/[^/]+)\/issues\?state=open.*labels=fleet/.exec(u))) {
        return ok([...yzIssues.entries()].filter(([k, v]) => k.startsWith(`${m[1]}#`) && v.state === 'open' && v.external).map(([k, v]) => ({ number: Number(k.split('#')[1]), id: 1, title: v.title, body: v.body, labels: [{ name: 'fleet' }] })));
    }
    if (method === 'GET' && u === '/user') return ok({ login: 'director.yozora' });
    if (method === 'GET' && /\/timeline/.test(u)) return ok([]);
    if (method === 'PATCH' && (m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(u))) { const k = `${m[1]}#${m[2]}`; const v = yzIssues.get(k) || {}; if (body && body.state) v.state = body.state; yzIssues.set(k, v); return ok({ number: Number(m[2]), state: v.state }); }
    if (method === 'GET' && (m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(u))) { const v = yzIssues.get(`${m[1]}#${m[2]}`) || { state: 'open' }; return ok({ number: Number(m[2]), id: 9000 + Number(m[2]), state: v.state, title: v.title || '', body: v.body || '', labels: [] }); }
    return ok({});
});

const settingsCfg = { agentSupervisor: { enabled: true, engine: 'tokenrouter', delivery: 'inbox', reviewScope: 'all', maxConcurrent: 20, autoStart: true } };
const gr = {
    getConfig: () => settingsCfg,
    modifyConfig: () => ({ assign: async (p, v) => { settingsCfg[p[0]] = v; } }),
    getApiKeyManager: () => ({ getActiveApiKey: (s) => (s === 'tokenrouter' ? 'sk-test' : '') })
};
// the fake engine: a grouping question takes the next prepared answer (an object, or a raw string), anything else (sizing) is "normal"
const groupAnswers = [];
const groupAsked = [];
const engineFetch = async (url, opts) => {
    const b = JSON.parse(opts.body);
    const isGroup = /group the work of one Fleet run/.test(b.messages[0].content);
    let content;
    if (isGroup) { groupAsked.push(b.messages[1].content); const a = groupAnswers.shift(); content = typeof a === 'string' ? a : JSON.stringify(a || {}); } else content = JSON.stringify({ size: 'normal', hard: false, retry: false, reason: 'test' });
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
};
sup._test.setFetch(engineFetch);

const starts = [];
let nStart = 0;
fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
launcher.start = async (g, o) => { nStart += 1; starts.push(o); return { id: `99999999-0000-0000-0000-${String(nStart).padStart(12, '0')}`, state: 'running', link: '' }; };

const RAW = () => require('../modules/agentCoord/store').open();
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 80));
const waitFor = async (fn, what) => { for (let i = 0; i < 150; i += 1) { if (fn()) return; await settle(20); } throw new Error(`timed out: ${what}`); };
const R = (n) => `DreamScape/StaticForge#${n}`;
const putIssue = (n, extra) => yzIssues.set(R(n), Object.assign({ state: 'open', title: `Issue ${n}`, body: `Body of ${n}` }, extra || {}));
const closed = (since) => yzCalls.slice(since || 0).filter((c) => c.method === 'PATCH' && c.body && c.body.state === 'closed').map((c) => Number(/issues\/(\d+)$/.exec(c.url)[1])).sort((a, b) => a - b);
const commentsOn = (since, num) => yzCalls.slice(since || 0).filter((c) => new RegExp(`issues/${num}/comments$`).test(c.url)).map((c) => c.body.body);
const kidsOf = (id) => sup.listWork({ limit: 300 }).filter((x) => x.parentId === id).sort((a, b) => a.id - b.id);
const nums = (w) => w.issues.map((i) => i.number);
const pumpAll = async () => { await sup.pumpWork(gr); await settle(30); await sup.pumpWork(gr); await settle(30); };

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 4).join('\n     ')}`); }
}

(async () => {
    sup.bind(gr);
    let big = null; // the run of test (b): kept for the later tests

    await test('(a) five related issues, the engine says one group: ONE planner session, no children, the item as it was', async () => {
        [3101, 3102, 3103, 3104, 3105].forEach((n) => putIssue(n));
        groupAnswers.push({ groups: [{ title: 'compile errors', units: [1, 2, 3, 4, 5], reason: 'all one feature' }] });
        const before = sup.listWork({ limit: 300 }).length;
        const w = sup.enqueue({ title: 'Five related', prompt: 'Fix every compile error', topology: 'planner', issues: [3101, 3102, 3103, 3104, 3105].map(R), startNow: true }, { gr });
        await pumpAll();
        assert.strictEqual(groupAsked.length, 1, 'the engine was asked once');
        assert.match(groupAsked[0], /^1\. Issue 3101 \[DreamScape\/StaticForge#3101\]\nBody of 3101/m, groupAsked[0]);
        assert.strictEqual(sup.listWork({ limit: 300 }).length, before + 1, 'one item');
        const g = sup.getWork(w.id);
        assert.deepStrictEqual([g.state, g.topology, g.parentId], ['running', 'planner', null]);
        assert.strictEqual(kidsOf(w.id).length, 0);
        const s = starts.filter((o) => o.title === 'Five related');
        assert.strictEqual(s.length, 1, 'one planner session');
        assert.match(s[0].prompt, /You are the PLANNER/);
        assert.match(s[0].prompt, /covers 5 Yozora issues TOGETHER/);
        assert.deepStrictEqual(nums(g), [3101, 3102, 3103, 3104, 3105]);
    });

    await test('(b) joined requests, the engine answers 3 groups: parent topology groups, 3 planner children, each on exactly its group; every issue on one child', async () => {
        const ids = [3201, 3202, 3203, 3204, 3205];
        ids.forEach((n) => putIssue(n));
        const reqs = ids.map((n) => sup.enqueue({ title: `Req ${n}`, prompt: `brief for ${n}`, issue: R(n) }, { gr }));
        await settle(60);
        groupAnswers.push({ groups: [{ title: 'Login flow', units: [1, 2], reason: 'both are the login form' }, { title: 'Docs', units: [3] }, { title: 'Cache', units: [4, 5], reason: 'same cache layer' }] });
        const mark = yzCalls.length;
        const nStarts = starts.length;
        const r = sup.mergeWork(reqs.map((x) => x.id), { gr, title: 'Big run' });
        big = r.work.id;
        await pumpAll();
        await waitFor(() => starts.length >= nStarts + 3, 'three planner sessions');
        const p = sup.getWork(big);
        assert.deepStrictEqual([p.topology, p.state, p.message, p.sessionId], ['groups', 'running', 'Planned as 3 planners', ''], JSON.stringify(p));
        const kids = kidsOf(big);
        assert.strictEqual(kids.length, 3);
        assert.deepStrictEqual(kids.map(nums), [[3201, 3202], [3203], [3204, 3205]]);
        assert.deepStrictEqual(kids.map((k) => k.title), ['Big run: Login flow', 'Big run: Docs', 'Big run: Cache']);
        const all = [].concat(...kids.map(nums));
        assert.strictEqual(new Set(all).size, all.length, 'no issue on two children');
        assert.strictEqual(all.length, 5);
        assert.ok(kids.every((k) => k.topology === 'planner' && k.parentId === big && k.stages.planner.auto === false), 'planner children, each sized on its own: ' + JSON.stringify(kids[0].stages));
        assert.ok(kids.every((k) => k.state === 'running' && k.sessionId), 'started as planner sessions: ' + JSON.stringify(kids.map((k) => k.state)));
        // a child with a single issue was not rolled back and no issue was made for it
        assert.ok(!yzCalls.slice(mark).some((c) => c.method === 'POST' && /\/issues$/.test(c.url)), 'no new issue made');
        assert.deepStrictEqual(nums(sup.getWork(kids[1].id)), [3203]);
        // the sessions: planner prompt, which planner it is, what the others carry, its own work only
        const s = kids.map((k) => starts.find((o) => o.title === k.title));
        assert.ok(s.every((o) => o && /You are the PLANNER/.test(o.prompt) && /planner \d of 3 for Fleet item/.test(o.prompt)));
        assert.match(s[1].prompt, /planner 2 of 3 for Fleet item/);
        assert.match(s[1].prompt, /Your issues: DreamScape\/StaticForge#3203\./);
        assert.match(s[1].prompt, /other planners carry planner 1: DreamScape\/StaticForge#3201, DreamScape\/StaticForge#3202; planner 3: DreamScape\/StaticForge#3204, DreamScape\/StaticForge#3205: do not work those/);
        assert.ok(s[1].prompt.includes('brief for 3203') && !s[1].prompt.includes('brief for 3201') && !s[1].prompt.includes('brief for 3204'), 'only its own request');
        assert.ok(s[0].prompt.includes('brief for 3201') && s[0].prompt.includes('brief for 3202') && !s[0].prompt.includes('brief for 3203'));
        assert.match(s[0].prompt, /covers 2 Yozora issues TOGETHER/);
        assert.ok(!starts.some((o) => o.title === 'Big run'), 'the parent starts no session of its own');
        // each issue hears which planner carries it; the parent posts no "started as one session" text
        await waitFor(() => [3201, 3202, 3203, 3204, 3205].every((n) => commentsOn(mark, n).some((t) => /split into 3 planners/.test(t))), 'planner comments');
        assert.ok(commentsOn(mark, 3203).some((t) => /under planner 2 of 3/.test(t)), commentsOn(mark, 3203).join(' | '));
        assert.ok(commentsOn(mark, 3202).some((t) => /under planner 1 of 3/.test(t) && /together with #3201/.test(t)), commentsOn(mark, 3202).join(' | '));
        await settle(100);
        const texts = yzCalls.slice(mark).filter((c) => /\/comments$/.test(c.url)).map((c) => c.body.body).join('\n');
        assert.strictEqual(commentsOn(mark, 3201).filter((t) => /started as a supervised session on/.test(t)).length, 1, 'only planner 1\'s own start comment, none for the parent');
        assert.ok(texts.length > 0);
        assert.ok(!yzCalls.slice(mark).some((c) => c.method === 'PATCH'), 'nothing closed yet');
        // the tree climbs to the parent
        assert.strictEqual(sup.workTree({ id: kids[2].id }).root.id, big);
    });

    await test('(b2) the engine names only some units: the rest get a group each; more than 6 groups fold into the sixth', async () => {
        [3301, 3302, 3303, 3304, 3305].forEach((n) => putIssue(n));
        groupAnswers.push({ groups: [{ title: 'Pair', units: [1, 2] }, { title: 'Dup', units: [2, 99, 'x'] }, { title: 'Empty', units: [] }] });
        const w = sup.enqueue({ title: 'Partial', prompt: 'partial', topology: 'planner', issues: [3301, 3302, 3303, 3304, 3305].map(R), startNow: true }, { gr });
        await pumpAll();
        assert.deepStrictEqual(kidsOf(w.id).map(nums), [[3301, 3302], [3303], [3304], [3305]], 'first group wins; unnamed units get their own; empty groups dropped');
        const ids = [3311, 3312, 3313, 3314, 3315, 3316, 3317, 3318];
        ids.forEach((n) => putIssue(n));
        groupAnswers.push({ groups: ids.map((n, k) => ({ title: `G${k + 1}`, units: [k + 1] })) });
        const w2 = sup.enqueue({ title: 'Many', prompt: 'many', topology: 'planner', issues: ids.map(R), startNow: true }, { gr });
        await pumpAll();
        const k2 = kidsOf(w2.id);
        assert.strictEqual(k2.length, 6);
        assert.deepStrictEqual(nums(k2[5]), [3316, 3317, 3318], 'extras fold into the last group');
    });

    await test('(c) an answer that cannot be used: a single planner, today\'s behaviour (junk text, wrong shape, no group named)', async () => {
        for (const [k, bad] of [['junk', 'sorry, I cannot do that'], ['shape', { groups: 'nope' }], ['empty', { groups: [] }], ['units', { groups: [{ title: 'x', units: [7, 8] }] }]]) {
            const ids = [3401, 3402, 3403].map((n) => n + 10 * ['junk', 'shape', 'empty', 'units'].indexOf(k));
            ids.forEach((n) => putIssue(n));
            groupAnswers.push(bad);
            const w = sup.enqueue({ title: `Bad ${k}`, prompt: 'x', topology: 'planner', issues: ids.map(R), startNow: true }, { gr });
            await pumpAll();
            assert.strictEqual(kidsOf(w.id).length, 0, k);
            const g = sup.getWork(w.id);
            assert.deepStrictEqual([g.topology, g.state], ['planner', 'running'], k);
            assert.strictEqual(starts.filter((o) => o.title === `Bad ${k}`).length, 1, `${k}: one planner`);
        }
        // an engine that fails (no answer at all) is the same
        sup._test.setFetch(async () => { throw new Error('network down'); });
        [3451, 3452].forEach((n) => putIssue(n));
        const w = sup.enqueue({ title: 'Engine down', prompt: 'x', topology: 'planner', issues: [3451, 3452].map(R), startNow: true }, { gr });
        await pumpAll();
        assert.deepStrictEqual([kidsOf(w.id).length, sup.getWork(w.id).state, starts.filter((o) => o.title === 'Engine down').length], [0, 'running', 1]);
        // direct and surfaces items are never grouped; one issue is not asked about
        const asked = groupAsked.length;
        sup._test.setFetch(async (url, opts) => {
            const b = JSON.parse(opts.body);
            if (/group the work of one Fleet run/.test(b.messages[0].content)) groupAsked.push('x');
            return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ size: 'normal', hard: false, retry: false, reason: 't' }) } }] }) };
        });
        [3461, 3462, 3463].forEach((n) => putIssue(n));
        const d = sup.enqueue({ title: 'Direct many', prompt: 'x', topology: 'direct', issues: [3461, 3462].map(R), startNow: true }, { gr });
        const o = sup.enqueue({ title: 'One issue', prompt: 'x', topology: 'planner', issue: R(3463), startNow: true }, { gr });
        await pumpAll();
        assert.strictEqual(groupAsked.length, asked, 'no grouping question');
        assert.deepStrictEqual([sup.getWork(d.id).state, sup.getWork(o.id).state, kidsOf(d.id).length + kidsOf(o.id).length], ['running', 'running', 0]);
        sup._test.setFetch(engineFetch);
    });

    await test('users cannot pick groups: enqueue and updateWork refuse it as a topology', () => {
        assert.ok(!sup.TOPOLOGIES.includes('groups'));
        const w = sup.enqueue({ title: 'Wants groups', prompt: 'x', topology: 'groups' });
        assert.strictEqual(sup.getWork(w.id).topology, 'planner', 'enqueue ignores it');
        assert.throws(() => sup.updateWork(w.id, { topology: 'groups' }), /topology is one of/);
    });

    await test('(d) a planner child closes its own done issue, labels and times it; the groups parent closes nothing and says how the run ended', async () => {
        const kids = kidsOf(big);
        const review = (sid, issues) => RAW().prepare("INSERT INTO supervisor_reviews (session_id, at, trigger, verdict, summary, missed, issues) VALUES (?, ?, 'turn-end', 'ok', 'sum', '[]', ?)").run(sid, Date.now(), JSON.stringify(issues));
        const mark = yzCalls.length;
        // planner 1: 3201 done, 3202 not
        RAW().prepare('UPDATE supervisor_work SET started_at = ? WHERE id = ?').run(Date.now() - 120000, kids[0].id); // ran 2 minutes: time is added from 30 s
        const s1 = sup.getWork(kids[0].id).sessionId;
        review(s1, [{ ref: R(3201), done: true, left: '' }, { ref: R(3202), done: false, left: 'the macro case still fails' }]);
        await sup.workAfterReview({ sessionId: s1, verdict: 'ok', missed: [], summary: 'mostly' });
        await waitFor(() => closed(mark).includes(3201) && commentsOn(mark, 3202).some((t) => /not finished/.test(t)), 'planner 1 end');
        await settle(100);
        assert.deepStrictEqual(closed(mark), [3201], 'only its own done issue closes');
        assert.ok(commentsOn(mark, 3201).some((t) => /found nothing missed/.test(t) && /Closing as done/.test(t)), 'the child\'s primary has the usual done comment (no part: wrapper): ' + commentsOn(mark, 3201).join(' | '));
        assert.ok(!commentsOn(mark, 3201).some((t) => /part:/.test(t)), 'it is not a surfaces part');
        assert.ok(commentsOn(mark, 3202).some((t) => /Left: the macro case still fails/.test(t) && /Left open/.test(t)), commentsOn(mark, 3202).join(' | '));
        assert.ok(yzCalls.slice(mark).some((c) => /issues\/3201\/labels/.test(c.url)), 'status labels on the child\'s issue');
        assert.ok(yzCalls.slice(mark).some((c) => /issues\/3201\/times/.test(c.url)), 'tracked time added to the child\'s primary');
        assert.strictEqual(sup.getWork(big).state, 'running', 'the parent waits for the others');
        // planner 2 and 3: ok, no per-issue lines: all their issues are done
        for (const k of [kids[1], kids[2]]) {
            const sid = sup.getWork(k.id).sessionId;
            await sup.workAfterReview({ sessionId: sid, verdict: 'ok', missed: [], summary: 'all' });
        }
        await waitFor(() => sup.getWork(big).state === 'done', 'parent settled');
        assert.strictEqual(sup.getWork(big).message, 'All 3 planners done');
        await waitFor(() => commentsOn(mark, 3201).some((t) => /all 3 planners of this run are done/.test(t)), 'parent summary');
        await settle(150);
        assert.deepStrictEqual(closed(mark), [3201, 3203, 3204, 3205], 'every closed issue is one a child\'s own check found done');
        const summary = commentsOn(mark, 3201).filter((t) => /planners of this run/.test(t));
        assert.strictEqual(summary.length, 1, 'one short summary on the primary');
    });

    await test('(d2) a planner that fails: the parent fails with the count, nothing is closed by the run, the primary hears it', async () => {
        [3501, 3502, 3503].forEach((n) => putIssue(n));
        groupAnswers.push({ groups: [{ title: 'One', units: [1] }, { title: 'Two', units: [2, 3] }] });
        const w = sup.enqueue({ title: 'Fails', prompt: 'x', topology: 'planner', issues: [3501, 3502, 3503].map(R), startNow: true }, { gr });
        await pumpAll();
        const kids = kidsOf(w.id);
        assert.strictEqual(kids.length, 2);
        const mark = yzCalls.length;
        sup.setWork(kids[0].id, { state: 'failed', ended_at: Date.now(), message: 'It stopped' });
        sup.settleParent(w.id);
        assert.strictEqual(sup.getWork(w.id).state, 'running', 'one planner still runs');
        const sid = sup.getWork(kids[1].id).sessionId;
        await sup.workAfterReview({ sessionId: sid, verdict: 'ok', missed: [], summary: 'ok' });
        await waitFor(() => sup.getWork(w.id).state === 'failed', 'parent failed');
        assert.strictEqual(sup.getWork(w.id).message, '1 of 2 planners did not finish');
        await waitFor(() => commentsOn(mark, 3501).some((t) => /1 of 2 planners of this run did not finish; nothing was closed by the run itself/.test(t)), 'parent failure comment: ' + commentsOn(mark, 3501).join(' | '));
        assert.ok(!closed(mark).includes(3501), 'the failed planner closed nothing');
        await waitFor(() => closed(mark).includes(3502) && closed(mark).includes(3503), 'the planner that finished closed its issues');
        // Start on the parent restarts the planner that did not finish; the parent runs again
        const back = sup.startWork(w.id);
        assert.strictEqual(back.state, 'running');
        assert.strictEqual(sup.getWork(kids[0].id).state, 'queued');
        assert.throws(() => sup.startWork(w.id), /All its planners are running or done/);
    });

    await test('(e) the issue sweep does not end a groups parent whose primary closed; no child issue becomes an item of its own; the child whose issue closed ends alone', async () => {
        [3601, 3602, 3603].forEach((n) => putIssue(n, { external: true }));
        groupAnswers.push({ groups: [{ title: 'A', units: [1, 2] }, { title: 'B', units: [3] }] });
        const w = sup.enqueue({ title: 'Sweep', prompt: 'x', topology: 'planner', issues: [3601, 3602, 3603].map(R), startNow: true }, { gr });
        await pumpAll();
        const kids = kidsOf(w.id);
        assert.deepStrictEqual(kids.map(nums), [[3601, 3602], [3603]]);
        const before = sup.listWork({ limit: 300 }).length;
        yzIssues.get(R(3601)).state = 'closed';
        const r = await sup.pullIssues(gr, { force: true });
        assert.strictEqual(sup.getWork(w.id).state, 'running', 'the parent is not ended by its primary closing');
        assert.strictEqual(sup.getWork(kids[0].id).state, 'done', 'the child whose primary closed ends');
        assert.strictEqual(sup.getWork(kids[1].id).state, 'running', 'the other planner goes on');
        assert.strictEqual(r.added, 0, 'carried issues are not pulled as new items');
        assert.strictEqual(sup.listWork({ limit: 300 }).length, before, 'no new item');
        // the other planner ends: the parent settles with it
        yzIssues.get(R(3603)).state = 'closed';
        await sup.pullIssues(gr, { force: true });
        assert.strictEqual(sup.getWork(kids[1].id).state, 'done');
        assert.strictEqual(sup.getWork(w.id).state, 'done', JSON.stringify(sup.getWork(w.id)));
        assert.strictEqual(sup.getWork(w.id).message, 'All 2 planners done');
    });

    await test('a groups parent is never started as a session: a requeued one with planners waits for them; one with none runs as a planner', async () => {
        const w = sup.getWork(big);
        assert.throws(() => sup.mergeWork([big, big]), /Pick two or more/);
        await settle(150);
        RAW().prepare("UPDATE supervisor_work SET state = 'queued', start_now = 1, topology = 'groups' WHERE id = ?").run(big);
        const n = starts.length;
        await pumpAll();
        assert.strictEqual(starts.length, n, 'no session for the parent');
        assert.strictEqual(sup.getWork(big).state, 'done', 'its planners are all done: settled');
        assert.ok(w);
        putIssue(3701);
        const e = sup.enqueue({ title: 'Empty groups', prompt: 'x', issue: R(3701), startNow: true, hold: false });
        await settle(60);
        RAW().prepare("UPDATE supervisor_work SET state = 'queued', topology = 'groups', session_id = NULL WHERE id = ?").run(e.id);
        await pumpAll();
        assert.deepStrictEqual([sup.getWork(e.id).topology, sup.getWork(e.id).state], ['planner', 'running']);
    });

    require('../modules/agentCoord/store').close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
