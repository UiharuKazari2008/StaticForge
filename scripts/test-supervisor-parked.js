#!/usr/bin/env node
'use strict';

/**
 * The Sent Back lifecycle (Yozora #1256, item 127 sat Sent Back for 15 hours with its session gone): modules/agentSupervisor.js
 * sent_back_at / sent_back_checks / parked_at, rowWork's sentBackAt / sessionGone / parked / parkedAt, sweepStalled's gone-session
 * resume, the one re-review and the park, and the closing of a parked item's idle session (fleetMemory.parkedSessions).
 *
 *   node scripts/test-supervisor-parked.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-parked-'));
// a scratch inbox: fixture notices must never reach a real phone
process.env.NOTIFICATION_INBOX_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-supervisor-parked-')), 'notifications.db');
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
process.env.AGENT_SUPERVISOR_SOCKET = path.join(tmp, 'state', 'supervisor.sock');
process.env.AGENT_SUPERVISOR_SETTLE_MS = '0';
process.env.AGENT_SUPERVISOR_NO_REVIVE = '1'; // only the revive cases turn it on
process.env.AGENT_SUPERVISOR_BG_PER_MIN = '100000';
process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET = `test-parked-${process.pid}`; // never Fleet's own tmux server
fs.mkdirSync(path.join(tmp, '.claude', 'projects', '-repo'), { recursive: true });
fs.mkdirSync(path.join(tmp, '.claude', 'sessions'), { recursive: true });

const sup = require('../modules/agentSupervisor');
const store = require('../modules/agentCoord/store');
const fm = require('../modules/fleetMemory');
const launcher = require('../modules/claudeSessionLauncher');
const fleetMcp = require('../modules/claudeFleetMcp');
const inbox = require('../modules/notificationInbox');

const yzCalls = [];
require('../modules/fleetYozora')._setFetch(async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    yzCalls.push({ method, url: String(url).replace('https://yozora.bluesteel.737.jp.net/api/v1', ''), body: opts && opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, text: async () => JSON.stringify({ number: 1, id: 1, state: 'open', labels: [] }) };
});
const commentsOn = (n) => yzCalls.filter((c) => c.method === 'POST' && new RegExp(`/issues/${n}/comments$`).test(c.url)).map((c) => c.body.body);

const published = [];
const realPublish = inbox.publish;
inbox.publish = (n) => { published.push(n); };

const cfg = { agentSupervisor: { enabled: true, engine: 'tokenrouter', delivery: 'inbox', reviewScope: 'all', landingCheck: false, maxConcurrent: 50, autoStart: false } };
const gr = {
    getConfig: () => cfg,
    modifyConfig: () => ({ assign: async (p, v) => { cfg[p[0]] = v; } }),
    getApiKeyManager: () => ({ getActiveApiKey: (s) => (s === 'tokenrouter' ? 'sk-test' : '') })
};
sup._test.setFetch(async () => {

    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict: 'gaps', summary: 'still open', missed: [{ item: 'Close out the loose end', evidence: '' }] }) } }] }) };
});

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 8).join('\n     ')}`); }
}
const RAW = () => store.open();
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 60));
const waitFor = async (fn, what) => { for (let i = 0; i < 100; i += 1) { if (fn()) return; await settle(20); } throw new Error(`timed out: ${what}`); };

const sid = (n) => `${String(n).repeat(8)}-0000-4000-8000-${String(n).repeat(12)}`;
const line = (o) => `${JSON.stringify(o)}\n`;
function transcript(id) {
    fs.writeFileSync(path.join(tmp, '.claude', 'projects', '-repo', `${id}.jsonl`), [
        line({ type: 'user', uuid: 'u1', timestamp: '2026-11-26T08:00:00Z', message: { role: 'user', content: 'Close out the loose end' } }),
        line({ type: 'assistant', uuid: 'a1', timestamp: '2026-11-26T08:00:05Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Mostly done.' }] } })
    ].join(''));
}
let liveMap = new Map();
const setLive = (...entries) => { liveMap = new Map(entries.map(([id, status]) => [id, { id, status, origin: 'rc' }])); sup._test.setCollisionDeps({ live: () => liveMap }); };
const insert = (o) => RAW().prepare("INSERT INTO supervisor_work (title, prompt, source, source_ref, state, created_at, started_at, message, engine, session_id, issue_repo, issue_number, parent_id) VALUES (?, 'p', ?, ?, ?, ?, ?, ?, 'claude', ?, ?, ?, NULL)")
    .run(o.title || 'Item', o.source || 'director', o.sourceRef || null, o.state || 'running', Date.now(), Date.now(), o.message || '', o.sid || null, o.issue ? 'DreamScape/StaticForge' : null, o.issue || null).lastInsertRowid;
const row = (id) => RAW().prepare('SELECT * FROM supervisor_work WHERE id = ?').get(id);
// the last review of a session counts as recent, so the older kick logic stays out of the way of what is tested here
const freshReview = (s, at) => RAW().prepare('UPDATE supervisor_reviews SET at = ? WHERE session_id = ?').run(at, s);
const addReview = (s, at, missed) => RAW().prepare("INSERT INTO supervisor_reviews (session_id, agent_id, title, account, at, trigger, verdict, summary, request, steering, missed) VALUES (?, 'claude-x', 't', '', ?, 'turn-end', 'gaps', 's', 'r', '[]', ?)").run(s, at, JSON.stringify(missed));
const MIN = 60000;
// the sweeps act on every open item: each case starts with the earlier cases' items out of the way
const clearOthers = () => RAW().prepare("UPDATE supervisor_work SET state = 'cancelled', parked_at = NULL, sent_back_at = NULL WHERE state IN ('held','queued','starting','running','waiting','input')").run();

(async () => {
    sup.bind(gr);
    sup.listWork(); // opens the database and creates / migrates the supervisor tables
    const D = fs.mkdtempSync(path.join(os.tmpdir(), 'parked-close-'));
    sup._test.closeDeps.rc = async () => ({ candidates: [], itemsBySession: new Map() });

    await test('sent_back_at is set when the state becomes waiting and cleared when it leaves; waiting to waiting keeps the age', async () => {
        const id = insert({ state: 'running', sid: sid(1), message: 'Working' });
        assert.strictEqual(row(id).sent_back_at, null);
        const t0 = Date.now();
        sup.setWork(id, { state: 'waiting', message: 'Gaps sent back: x' });
        const a = row(id).sent_back_at;
        assert.ok(a >= t0 && a <= Date.now() + 5, 'dated now');
        assert.strictEqual(row(id).sent_back_checks, 0);
        assert.strictEqual(sup.getWork(id).sentBackAt, a);
        RAW().prepare('UPDATE supervisor_work SET sent_back_at = ?, sent_back_checks = 1 WHERE id = ?').run(t0 - 5 * MIN, id);
        sup.setWork(id, { state: 'waiting', message: 'Gaps sent back: y' });
        assert.strictEqual(row(id).sent_back_at, t0 - 5 * MIN, 'a new gaps review of an item that stays Sent Back keeps its age');
        assert.strictEqual(row(id).sent_back_checks, 1);
        sup.setWork(id, { state: 'running', message: 'Working again' });
        assert.strictEqual(row(id).sent_back_at, null, 'cleared when it leaves waiting');
        assert.strictEqual(sup.getWork(id).sentBackAt, null);
        sup.setWork(id, { state: 'waiting', message: 'again' });
        assert.strictEqual(row(id).sent_back_checks, 0, 'a new Sent Back starts its count again');
        assert.ok(row(id).sent_back_at > t0 - 5 * MIN);
    });

    await test('rowWork: sessionGone comes from the live map (one read per list), parked / parkedAt from state input + parked_at', async () => {
        const live = insert({ state: 'running', sid: sid(2) });
        const gone = insert({ state: 'waiting', sid: sid(3) });
        const doneGone = insert({ state: 'done', sid: sid(4) });
        const noSession = insert({ state: 'running' });
        const pk = insert({ state: 'input', sid: sid(5) });
        RAW().prepare('UPDATE supervisor_work SET parked_at = 1234 WHERE id = ?').run(pk);
        const plain = insert({ state: 'input', sid: sid(2) });
        setLive([sid(2), 'idle'], [sid(5), 'idle']);
        let reads = 0;
        const realLive = liveMap;
        sup._test.setCollisionDeps({ live: () => { reads += 1; return realLive; } });
        const list = sup.listWork({ limit: 300 });
        assert.strictEqual(reads, 1, 'liveSessionsById once per list');
        const by = (id) => list.find((x) => x.id === id);
        assert.strictEqual(by(live).sessionGone, false);
        assert.strictEqual(by(gone).sessionGone, true);
        assert.strictEqual(by(doneGone).sessionGone, false, 'a finished item has no session to miss');
        assert.strictEqual(by(noSession).sessionGone, false);
        assert.strictEqual(by(pk).parked, true);
        assert.strictEqual(by(pk).parkedAt, 1234);
        assert.strictEqual(by(plain).parked, false, 'Input Required for a real question is not parked');
        assert.strictEqual(by(plain).parkedAt, null);
        assert.strictEqual(by(gone).sentBackAt, row(gone).sent_back_at || null);
        assert.ok(Object.prototype.hasOwnProperty.call(by(live), 'sentBackAt'));
        setLive();
    });

    await test('ageText: minutes below an hour, then hours and minutes', () => {
        assert.strictEqual(sup._test.ageText(45 * MIN), '45 min');
        assert.strictEqual(sup._test.ageText(130 * MIN), '2 h 10 min');
        assert.strictEqual(sup._test.ageText(120 * MIN), '2 h');
        assert.strictEqual(sup._test.ageText(1000), '1 min');
    });

    await test('a Sent Back item with a gone session is handed to the revive path (and a running one is checked first)', async () => {
        clearOthers();
        const realPick = fleetMcp.pickForStart; const realResume = launcher.resume; const realSteer = launcher.steer;
        const resumed = []; const typed = [];
        fleetMcp.pickForStart = async () => ({ index: 1, name: 'Second', settings: {} });
        launcher.resume = async (g, id, o) => { resumed.push([id, o && o.account]); liveMap.set(id, { id, status: 'idle', origin: 'rc' }); return { id, state: 'connected' }; };
        launcher.steer = async (id, t) => { typed.push([id, t]); return { sent: true }; };
        sup._test.setRevive(true);
        try {
            setLive();
            const w = insert({ state: 'waiting', sid: sid(6), message: 'Gaps sent back: Close out #852', issue: 8521 });
            const t0 = Date.now();
            RAW().prepare('UPDATE supervisor_work SET sent_back_at = ? WHERE id = ?').run(t0 - 15 * 60 * MIN, w);
            // item 127 itself: a session that is gone, Sent Back for 15 hours. Age is past the park limit but nothing was re-checked yet: resumed first
            assert.strictEqual(sup._test.sweepStalled(t0), 1);
            await waitFor(() => resumed.length === 1, 'resumed');
            assert.deepStrictEqual(resumed[0][0], sid(6));
            await waitFor(() => row(w).state === 'running', 'running again');
            assert.strictEqual(row(w).sent_back_at, null, 'back at work: no Sent Back age');
            assert.match(typed[typed.length - 1][1], /started again/);
            // a running item whose process is gone goes through the same door: checked (waiting) and reviewed, as sessionEnded does
            const r = insert({ state: 'running', sid: sid(7), message: 'Working' });
            transcript(sid(7));
            assert.strictEqual(sup._test.sweepStalled(t0), 1);
            assert.strictEqual(row(r).state, 'waiting');
            assert.match(row(r).message, /session ended/);
            await settle(120);
            // a session that runs (live map) is left alone
            const ok = insert({ state: 'waiting', sid: sid(8) });
            setLive([sid(8), 'idle']);
            RAW().prepare('UPDATE supervisor_work SET sent_back_at = ? WHERE id = ?').run(t0 - 5 * MIN, ok);
            freshReview(sid(8), t0);
            resumed.length = 0;
            sup._test.sweepStalled(t0);
            assert.deepStrictEqual(resumed, []);
            // revive switched off or no account: the sweep still counts the attempt and never parks before the first re-check
            sup._test.setRevive(false);
            setLive();
            const nr = insert({ state: 'waiting', sid: sid(9), message: 'Gaps sent back: z' });
            transcript(sid(9));
            RAW().prepare('UPDATE supervisor_work SET sent_back_at = ? WHERE id = ?').run(t0 - 70 * MIN, nr);
            sup._test.sweepStalled(t0);
            assert.strictEqual(row(nr).sent_back_checks, 1, 'the resume attempt is its re-check');
            assert.strictEqual(row(nr).state, 'waiting', 'not parked at 70 minutes');
            sup._test.sweepStalled(t0 + 55 * MIN); // 125 minutes old, re-checked, session still gone: parked
            assert.strictEqual(row(nr).state, 'input');
            assert.ok(row(nr).parked_at);
            assert.strictEqual(sup.sessionEnded(sid(9)), false, 'sessionEnded leaves an Input Required item alone');
        } finally { sup._test.setRevive(false); fleetMcp.pickForStart = realPick; launcher.resume = realResume; launcher.steer = realSteer; setLive(); }
    });

    await test('a Sent Back item with an idle session: reviewed once after the first limit, parked after the second with its age, questions and one comment', async () => {
        clearOthers();
        const w = insert({ state: 'waiting', sid: sid(1), sourceRef: 'supervisor:gaps:5', message: 'Gaps sent back: Close out the loose end', issue: 9101 });
        transcript(sid(1));
        setLive([sid(1), 'idle']);
        RAW().prepare('DELETE FROM supervisor_reviews WHERE session_id = ?').run(sid(1));
        const t0 = Date.now();
        RAW().prepare('UPDATE supervisor_work SET sent_back_at = ?, sent_back_checks = 0 WHERE id = ?').run(t0, w);
        addReview(sid(1), t0, [{ item: 'Close out the loose end', evidence: '' }, { item: 'Say what was tested', evidence: '' }]);
        published.length = 0;
        const at = (m) => { freshReview(sid(1), t0 + m * MIN - 5 * MIN); return t0 + m * MIN; };
        assert.strictEqual(sup._test.sweepStalled(at(59)), 0, 'nothing before the first limit');
        assert.strictEqual(row(w).sent_back_checks, 0);
        assert.strictEqual(sup._test.sweepStalled(at(61)), 1, 're-reviewed');
        assert.strictEqual(row(w).sent_back_checks, 1, 'recorded in the row');
        await waitFor(() => RAW().prepare("SELECT COUNT(*) n FROM supervisor_reviews WHERE session_id = ? AND trigger = 'stall'").get(sid(1)).n === 1, 'stall review stored');
        const nReviews = () => RAW().prepare('SELECT COUNT(*) n FROM supervisor_reviews WHERE session_id = ?').get(sid(1)).n;
        assert.strictEqual(nReviews(), 2, 'the one inserted review and the one re-review');
        assert.strictEqual(row(w).state, 'waiting');
        assert.strictEqual(row(w).sent_back_at, t0, 'the re-review leaves the age alone');
        assert.strictEqual(sup._test.sweepStalled(at(80)), 0, 'once only');
        assert.strictEqual(sup._test.sweepStalled(at(119)), 0, 'not parked before the second limit');
        assert.strictEqual(row(w).state, 'waiting');
        await settle(100);
        assert.strictEqual(nReviews(), 2, 'not reviewed a second time');
        // counters live in the row: a reopened database handle still sees them
        store.close();
        assert.strictEqual(row(w).sent_back_checks, 1);
        assert.strictEqual(sup._test.sweepStalled(at(130)), 1, 'parked');
        const r = row(w);
        assert.strictEqual(r.state, 'input');
        assert.strictEqual(r.parked_at, t0 + 130 * MIN);
        assert.strictEqual(r.sent_back_at, null);
        assert.match(r.message, /^Needs a person: sent back 2 h 10 min ago and still open: /);
        assert.ok(r.message.length <= 240);
        const qs = JSON.parse(r.input_questions);
        assert.ok(qs.length >= 1 && qs.every((q) => q.question && q.answer === '' && /sent back 2 h 10 min ago/.test(q.why)), r.input_questions);
        assert.ok(qs.some((q) => /Close out the loose end/.test(q.question)));
        const cs = commentsOn(9101).filter((t) => /Sent Back for/.test(t));
        assert.strictEqual(cs.length, 1, 'one comment');
        assert.match(cs[0], /^\*\*Fleet \/ Supervisor:\*\* this item has been Sent Back for 2 h 10 min and still cannot finish:\n- /);
        assert.match(cs[0], /It is parked as Input Required: it needs a person \(answer in Fleet, or Send Back to Work with a note\)\.$/);
        const g = sup.getWork(w);
        assert.deepStrictEqual([g.state, g.parked, g.parkedAt, g.sentBackAt], ['input', true, t0 + 130 * MIN, null]);
        assert.ok(g.questions.length && g.questions[0].why);
        assert.strictEqual(published.filter((n) => /:attention$/.test(n.id || '')).length, 1, `the phone is told once: ${JSON.stringify(published.map((n) => n.id))}`);
        assert.strictEqual(sup._test.sweepStalled(at(140)), 0);
        assert.strictEqual(commentsOn(9101).filter((t) => /Sent Back for/.test(t)).length, 1, 'no second comment');
        assert.strictEqual(published.filter((n) => /:attention$/.test(n.id || '')).length, 1, 'no second notice');
        setLive();
    });

    await test('a busy session, an open wait and a hold are never parked; a regular item with open gaps is handed on first', async () => {
        clearOthers();
        const t0 = Date.now();
        const busy = insert({ state: 'waiting', sid: sid(2), sourceRef: 'supervisor:gaps:5' });
        transcript(sid(2));
        RAW().prepare('UPDATE supervisor_work SET sent_back_at = ?, sent_back_checks = 1 WHERE id = ?').run(t0 - 300 * MIN, busy);
        setLive([sid(2), 'busy']);
        assert.strictEqual(sup._test.sweepStalled(t0), 0);
        assert.strictEqual(row(busy).state, 'waiting', 'busy: never parked');
        setLive([sid(2), 'idle']);
        RAW().prepare("INSERT INTO supervisor_waits (work_id, session_id, kind, who, what, at) VALUES (?, ?, 'agent', 'x', 'another agent', ?)").run(busy, sid(2), t0);
        assert.strictEqual(sup._test.sweepStalled(t0), 0);
        assert.strictEqual(row(busy).state, 'waiting', 'a watched wait is not parked');
        RAW().prepare('UPDATE supervisor_waits SET ended_at = ? WHERE work_id = ?').run(t0, busy);
        // a regular item (not a hand-off item) with a gaps review: the existing hand-off takes it, nothing is parked
        const realStart = launcher.start; const realPick = fleetMcp.pickForStart;
        let n = 0;
        launcher.start = async () => { n += 1; return { id: `cdcdcdcd-0000-0000-0000-0000000009${String(n).padStart(2, '0')}`, state: 'running', link: '' }; };
        fleetMcp.pickForStart = async () => ({ index: 0, name: 'Main', settings: {} });
        try {
            const reg = insert({ state: 'waiting', sid: sid(3), message: 'Gaps sent back: Prove it' });
            RAW().prepare('UPDATE supervisor_work SET sent_back_at = ?, sent_back_checks = 1 WHERE id = ?').run(t0 - 300 * MIN, reg);
            addReview(sid(3), t0, [{ item: 'Prove it on screen', evidence: '' }]);
            setLive([sid(3), 'idle']);
            RAW().prepare('UPDATE supervisor_work SET state = \'cancelled\' WHERE id = ?').run(busy);
            assert.strictEqual(sup._test.sweepStalled(t0), 1);
            assert.strictEqual(row(reg).state, 'done', 'handed on, not parked');
            assert.match(row(reg).message, /handed to work item/);
            assert.strictEqual(row(reg).parked_at, null);
            // no review rows at all: the gap text falls back to the item message
            const bare = insert({ state: 'waiting', sid: sid(4), message: 'Gaps sent back: Close out #852' });
            RAW().prepare('UPDATE supervisor_work SET sent_back_at = ?, sent_back_checks = 1 WHERE id = ?').run(t0 - 300 * MIN, bare);
            setLive([sid(4), 'idle']);
            assert.strictEqual(sup._test.sweepStalled(t0), 1);
            assert.strictEqual(row(bare).state, 'input');
            assert.match(row(bare).message, /^Needs a person: sent back 5 h ago and still open: Close out #852$/);
            assert.strictEqual(JSON.parse(row(bare).input_questions)[0].question, 'Close out #852');
        } finally { launcher.start = realStart; fleetMcp.pickForStart = realPick; setLive(); RAW().prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE state IN ('queued','starting','running','waiting')").run(); }
    });

    await test('parkedSessions through the sweep: only an idle parked session past the limit closes (message line once), never one with work in flight', async () => {
        const t0 = Date.now();
        const LIM = 60 * MIN;
        const mk = (n, agoMin, status) => {
            const id = insert({ state: 'input', sid: sid(n), message: 'Needs a person: sent back 2 h ago and still open: x' });
            RAW().prepare('UPDATE supervisor_work SET parked_at = ? WHERE id = ?').run(t0 - agoMin * MIN, id);
            return { id, s: sid(n), status };
        };
        const old = mk(2, 61, 'idle'); const young = mk(3, 30, 'idle'); const busy = mk(4, 600, 'busy'); const gone = mk(5, 90, null);
        setLive([old.s, 'idle'], [young.s, 'idle'], [busy.s, 'busy']);
        const closed = [];
        sup._test.closeDeps.rc = async () => {
            const rows = RAW().prepare("SELECT id, state, session_id, parked_at FROM supervisor_work WHERE state = 'input' AND parked_at IS NOT NULL AND id IN (?, ?, ?, ?)").all(old.id, young.id, busy.id, gone.id);
            return fm.rcCandidates({ names: [old, young, busy, gone].map((x) => `rc-${x.s.slice(0, 8)}`), live: [...liveMap.values()], rows });
        };
        sup._test.closeDeps.disconnect = async (s) => { closed.push(s); };
        const out = await sup._test.closeParkedSessions(t0);
        assert.deepStrictEqual(closed.sort(), [old.s, gone.s].sort(), 'old idle + one whose process is gone; not the young one, not the busy one');
        assert.deepStrictEqual(out.sort(), closed.sort());
        const sfx = 'its session was closed to free memory; it resumes when the item goes on';
        assert.ok(row(old.id).message.endsWith(`(${sfx})`));
        assert.strictEqual(row(young.id).message.includes(sfx), false);
        assert.strictEqual(row(busy.id).message.includes(sfx), false);
        await sup._test.closeParkedSessions(t0 + 5 * MIN);
        assert.strictEqual(row(old.id).message.split(sfx).length, 2, 'the message line is added once');
        // still parked and still resumable
        assert.strictEqual(row(old.id).state, 'input');
        assert.ok(row(old.id).parked_at);
        // the sweep itself reaches it (only while some item is parked)
        closed.length = 0;
        sup._test.sweepStalled(t0 + 10 * MIN);
        await settle(100);
        assert.ok(closed.includes(old.s), 'sweepStalled calls it');
        sup._test.closeDeps.rc = async () => ({ candidates: [], itemsBySession: new Map() });
        delete sup._test.closeDeps.disconnect;
        setLive();
    });

    await test('answering a parked item and Send Back to Work resume a closed session first, then type into it', async () => {
        const realPick = fleetMcp.pickForStart; const realResume = launcher.resume; const realSteer = launcher.steer;
        const order = [];
        fleetMcp.pickForStart = async () => ({ index: 1, name: 'Second', settings: {} });
        launcher.resume = async (g, id) => { order.push(`resume ${id}`); liveMap.set(id, { id, status: 'idle', origin: 'rc' }); return { id, state: 'connected' }; };
        launcher.steer = async (id, t) => { order.push(`steer ${id} ${t.slice(0, 60)}`); return { sent: true }; };
        try {
            // a Sent Back item is not sent back by hand (only done / failed / parked); a parked one is
            setLive();
            const w = insert({ state: 'waiting', sid: sid(6) });
            transcript(sid(6));
            await assert.rejects(() => sup.reopenWork(w, { note: 'go' }), /only a done or failed/);
            const qs = [{ question: 'Close out #852', answer: '', why: 'sent back 2 h ago' }];
            const mkParked = (n) => { const id = insert({ state: 'input', sid: sid(n) }); RAW().prepare('UPDATE supervisor_work SET parked_at = ?, input_questions = ? WHERE id = ?').run(Date.now() - 90 * MIN, JSON.stringify(qs), id); transcript(sid(n)); return id; };
            const a = mkParked(7);
            const ra = await sup.answerWork(a, { answers: ['Done on the issue'] });
            assert.strictEqual(ra.state, 'running');
            assert.deepStrictEqual([ra.parked, ra.parkedAt], [false, null], 'parked_at ends with the state');
            assert.deepStrictEqual(order.map((x) => x.split(' ')[0]), ['resume', 'steer'], order.join(' | '));
            order.length = 0;
            setLive();
            const b = mkParked(8);
            const rb = await sup.reopenWork(b, { note: 'Finish it and report on the issue' });
            assert.strictEqual(rb.state, 'running');
            assert.deepStrictEqual([rb.parked, rb.parkedAt, rb.questions.length], [false, null, 0]);
            assert.deepStrictEqual(order.map((x) => x.split(' ')[0]), ['resume', 'steer'], order.join(' | '));
            assert.match(order[1], /Sent back by Yukimi/);
        } finally { fleetMcp.pickForStart = realPick; launcher.resume = realResume; launcher.steer = realSteer; setLive(); }
    });

    inbox.publish = realPublish;
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(D, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
