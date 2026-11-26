#!/usr/bin/env node
'use strict';

/**
 * modules/supervisorGapState.js and its wiring in agentSupervisor.review() (#1256): refs in the texts, the state of
 * issues and commits read at review time, the gaps that state already settles, and the end-to-end case of review 343
 * (a turn that only answers a Supervisor note is judged against the brief, never against the note).
 * Temp home, temp coord DB and inbox, a fake Yozora and a fake model: no network, no real phone.
 *
 *   node scripts/test-supervisor-gap-state.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-gap-'));
// a scratch inbox: a test must never publish into the live one (its notices land on Yukimi's phone, #1196)
process.env.NOTIFICATION_INBOX_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-gap-state-')), 'notifications.db');
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
process.env.AGENT_SUPERVISOR_SOCKET = path.join(tmp, 'state', 'supervisor.sock');
process.env.AGENT_SUPERVISOR_SETTLE_MS = '0';
process.env.AGENT_SUPERVISOR_NO_REVIVE = '1';
process.env.AGENT_SUPERVISOR_BG_PER_MIN = '100000';
fs.mkdirSync(path.join(tmp, '.claude', 'projects', '-repo'), { recursive: true });
fs.mkdirSync(path.join(tmp, '.claude', 'sessions'), { recursive: true });

const G = require('../modules/supervisorGapState');
const sup = require('../modules/agentSupervisor');
const yz = require('../modules/fleetYozora');

// a fake Yozora: issue states by "repo#n", every call recorded
const yzCalls = [];
const issues = new Map();
yz._setFetch(async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const u = String(url).replace('https://yozora.bluesteel.737.jp.net/api/v1', '');
    yzCalls.push(`${method} ${u}`);
    const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    let m;
    if (method === 'GET' && (m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(u))) {
        const v = issues.get(`${m[1]}#${m[2]}`);
        if (!v) return { ok: false, status: 404, text: async () => 'not found' };
        return ok({ number: Number(m[2]), id: 9000 + Number(m[2]), state: v.state, title: v.title || '', closed_at: v.closed_at || null, body: '', labels: [] });
    }
    return ok({});
});

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 8).join('\n     ')}`); }
}

const REPO = 'DreamScape/StaticForge';
const line = (o) => `${JSON.stringify(o)}\n`;
const user = (text, ts) => line({ type: 'user', uuid: `u${ts}`, timestamp: ts, message: { role: 'user', content: text } });
const asst = (content, ts) => line({ type: 'assistant', uuid: `a${ts}`, timestamp: ts, message: { role: 'assistant', content } });
const NOTE = '[Supervisor] Your last turn may have left these unaddressed: (1) Post the Done comment on DreamScape/StaticForge#1223 (and close out #852) as the request requires. Please do them now, or say why not.';
const BRIEF = 'Split off from #852. Comment progress on #852 as you go. Build the review judgement.';

const settingsCfg = { agentSupervisor: { enabled: true, engine: 'tokenrouter', delivery: 'inbox', reviewScope: 'all', landingCheck: false } };
const gr = {
    getConfig: () => settingsCfg,
    modifyConfig: () => ({ assign: async (p, v) => { settingsCfg[p[0]] = v; } }),
    getApiKeyManager: () => ({ getActiveApiKey: (s) => (s === 'tokenrouter' ? 'sk-test' : '') })
};
const RAW = () => require('../modules/agentCoord/store').open();

let prompts = [];
let modelAnswer = { verdict: 'gaps', summary: 'one gap', missed: [{ item: 'Close out #852', evidence: '"(and close out #852) as the request requires"' }] };
sup._test.setFetch(async (url, opts) => {
    const b = JSON.parse(opts.body);
    const review = /Supervisor for coding agents/.test(b.messages[0].content);
    if (review) prompts.push(b.messages[1].content);
    const out = review ? modelAnswer : (/checklist/.test(b.messages[0].content) ? { items: [], drop: [] } : { title: 'A title' });
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }) };
});

(async () => {
    await test('refsIn: issue refs, owner/repo refs, URLs and commit shas, capped, plain numbers and words are not shas', () => {
        const r = G.refsIn(['Split off from #852 and DreamScape/nai-prompt-guide#12, see https://yozora.bluesteel.737.jp.net/DreamScape/DSApp-Kotlin/issues/7', 'landed bb1f72600 and 402bb3b1d1234567; port 1234567, deadbeef, 12345678, file.js#3x'], { defaultRepo: REPO });
        assert.deepStrictEqual(r.issues.map((i) => `${i.repo}#${i.number}`), [`${REPO}#852`, 'DreamScape/nai-prompt-guide#12', 'DreamScape/DSApp-Kotlin#7'], JSON.stringify(r.issues));
        assert.deepStrictEqual(r.commits, ['bb1f72600', '402bb3b1d1234567'], JSON.stringify(r.commits));
        const many = G.refsIn([Array.from({ length: 12 }, (_, i) => `#${100 + i} a1b2c3${i}d`).join(' ')], { defaultRepo: REPO });
        assert.strictEqual(many.issues.length, 8);
        assert.strictEqual(many.commits.length, 8);
        assert.deepStrictEqual(G.refsIn([null, undefined, ''], {}), { issues: [], commits: [] });
        assert.strictEqual(G.refsIn(['src/a.js#12'], { defaultRepo: REPO }).issues.length, 1, 'only an owner/repo shaped token before # counts, as a lookup that will say unknown');
    });

    const states = (extra) => Object.assign({ defaultRepo: REPO, issues: [{ repo: REPO, number: 852, state: 'closed', closedAt: '2026-11-25T08:00:00Z', title: 'Fleet review' }, { repo: REPO, number: 900, state: 'open', closedAt: '', title: 'Still going' }, { repo: REPO, number: 901, state: null, closedAt: '', title: '' }], commits: [{ sha: 'bb1f72600', onMain: true }, { sha: 'cc2e83711', onMain: false }, { sha: 'dd3f94822', onMain: null }] }, extra || {});

    await test('section: closed with its date and title, open, commits on / not on origin/main; unknown is left out; empty when nothing was read', () => {
        const text = G.section(states());
        assert.match(text, /^## Current state of what is named \(read now\)/);
        assert.match(text, /- DreamScape\/StaticForge#852: closed 2026-11-25 \(Fleet review\)/);
        assert.match(text, /- DreamScape\/StaticForge#900: open \(Still going\)/);
        assert.match(text, /- commit bb1f72600: on origin\/main/);
        assert.match(text, /- commit cc2e83711: not on origin\/main/);
        assert.ok(!/901|dd3f94822/.test(text), 'unknown is not claimed');
        assert.strictEqual(G.section({ issues: [], commits: [] }), '');
        assert.strictEqual(G.section(null), '');
    });

    await test('settle: close-out of a closed issue is dropped; of an open or unknown issue it is kept', () => {
        const r = G.settle([{ item: 'Close out #852', evidence: 'e' }, { item: 'Close #900 as the request requires' }, { item: 'Mark #901 done' }, { item: 'Close out #852 after the build passes' }, { item: 'Close out #852 and #900' }], states());
        assert.deepStrictEqual(r.missed.map((m) => m.item), ['Close #900 as the request requires', 'Mark #901 done', 'Close out #852 after the build passes', 'Close out #852 and #900']);
        assert.strictEqual(r.satisfied.length, 1);
        assert.match(r.satisfied[0].why, /#852 is already closed/);
    });

    await test('settle: a compound item is rewritten, only the settled parenthetical goes', () => {
        const r = G.settle([{ item: 'Post the Done comment on DreamScape/StaticForge#1223 (and close out #852) as the request requires', evidence: 'quote' }, { item: 'Post the comment (and close out #900)' }, { item: '(and close out #852)' }], states());
        assert.deepStrictEqual(r.missed.map((m) => m.item), ['Post the Done comment on DreamScape/StaticForge#1223 as the request requires', 'Post the comment (and close out #900)', '(and close out #852)']);
        assert.strictEqual(r.missed[0].evidence, 'quote', 'the evidence stays with the rewritten item');
        assert.strictEqual(r.satisfied.length, 1, 'a parenthetical alone has nothing left: it stays as it was');
    });

    await test('settle: pushing a commit that is on origin/main is dropped; not on main, unknown or a vague push stay', () => {
        const r = G.settle([{ item: 'Push commit bb1f72600 to origin/main' }, { item: 'push bb1f726' }, { item: 'Push cc2e83711' }, { item: 'Push dd3f94822' }, { item: 'Push the commit' }, { item: 'Run the tests and push bb1f72600' }], states());
        assert.deepStrictEqual(r.missed.map((m) => m.item), ['Push cc2e83711', 'Push dd3f94822', 'Push the commit', 'Run the tests and push bb1f72600']);
        assert.strictEqual(r.satisfied.length, 2);
        assert.match(r.satisfied[0].why, /bb1f72600 is already on origin\/main/);
    });

    await test('settle: nothing known, nothing to say', () => {
        const items = [{ item: 'Update the README' }];
        assert.deepStrictEqual(G.settle(items, null), { missed: items, satisfied: [] });
        assert.deepStrictEqual(G.settle([], states()), { missed: [], satisfied: [] });
        assert.deepStrictEqual(G.settle(items, states()).satisfied, []);
    });

    await test('stateOf: injected lookups run in parallel, a failure or a slow lookup is unknown and never throws', async () => {
        const t0 = Date.now();
        const st = await G.stateOf({ issues: [{ repo: REPO, number: 1 }, { repo: REPO, number: 2 }, { repo: REPO, number: 3 }], commits: ['aaaa111', 'bbbb222', 'cccc333'] }, {
            defaultRepo: REPO,
            cwd: '/x',
            issue: async (repo, n) => { if (n === 1) return { state: 'closed', closedAt: '2026-11-25T01:00:00Z', title: 'one' }; if (n === 2) throw new Error('boom'); return new Promise(() => {}); },
            commit: async (sha) => { if (sha === 'aaaa111') return true; if (sha === 'bbbb222') return false; throw new Error('no git'); }
        });
        assert.deepStrictEqual(st.issues.map((i) => i.state), ['closed', null, null]);
        assert.deepStrictEqual(st.commits.map((c) => c.onMain), [true, false, null]);
        assert.ok(Date.now() - t0 < 4500, 'one hanging lookup costs 3 s once, not per lookup');
    });

    await test('stateOf: the default lookups read Yozora through fleetYozora and are cached for 60 s', async () => {
        G._clearCache();
        issues.set(`${REPO}#852`, { state: 'closed', title: 'Fleet review', closed_at: '2026-11-25T08:00:00Z' });
        yzCalls.length = 0;
        const refs = { issues: [{ repo: REPO, number: 852 }, { repo: REPO, number: 404 }], commits: [] };
        const a = await G.stateOf(refs, { defaultRepo: REPO });
        assert.deepStrictEqual(a.issues.map((i) => [i.number, i.state]), [[852, 'closed'], [404, null]], 'a 404 is unknown');
        assert.strictEqual(a.issues[0].closedAt, '2026-11-25T08:00:00Z');
        const n = yzCalls.length;
        await G.stateOf(refs, { defaultRepo: REPO });
        assert.strictEqual(yzCalls.length - n, 1, 'only the unknown one is asked again');
    });

    await test('stateOf: the default commit lookup asks git about origin/main through the spawn helper', async () => {
        const cp = require('child_process');
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-git-'));
        const git = (...a) => cp.execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
        git('init', '-q', '-b', 'main');
        git('config', 'user.email', 't@example.test'); git('config', 'user.name', 't');
        fs.writeFileSync(path.join(repo, 'a'), '1'); git('add', 'a'); git('commit', '-q', '-m', 'one');
        const pushed = git('rev-parse', 'HEAD');
        git('update-ref', 'refs/remotes/origin/main', pushed);
        fs.writeFileSync(path.join(repo, 'a'), '2'); git('commit', '-q', '-am', 'two');
        const local = git('rev-parse', 'HEAD');
        G._clearCache();
        const st = await G.stateOf({ issues: [], commits: [pushed.slice(0, 9), local.slice(0, 9), 'abcdef123456789'] }, { cwd: repo });
        assert.deepStrictEqual(st.commits.map((c) => c.onMain), [true, false, null], JSON.stringify(st.commits));
        fs.rmSync(repo, { recursive: true, force: true });
    });

    await test('lastHumanText: the last user text that does not start with the Supervisor prefix', () => {
        const msgs = [{ role: 'user', kind: 'text', text: 'First ask' }, { role: 'assistant', kind: 'text', text: 'ok' }, { role: 'user', kind: 'text', text: 'Second ask' }, { role: 'user', kind: 'text', text: NOTE }];
        assert.strictEqual(G.lastHumanText(msgs, sup.STEER_PREFIX), 'Second ask');
        assert.strictEqual(G.lastHumanText([{ role: 'user', kind: 'text', text: NOTE }], sup.STEER_PREFIX), '');
    });

    // ---- the review end to end (#1256) ----
    sup.bind(gr);
    sup.listWork({ limit: 1 }); // creates the Supervisor's tables
    const newSession = (n) => `eeeeeeee-0000-0000-0000-00000000000${n}`;
    const fileOf = (sid) => path.join(tmp, '.claude', 'projects', '-repo', `${sid}.jsonl`);
    const itemFor = (sid, prompt) => RAW().prepare("INSERT INTO supervisor_work (title, prompt, source, state, created_at, started_at, message, engine, session_id, cwd) VALUES ('Split off', ?, 'director', 'running', ?, ?, '', 'claude', ?, ?)").run(prompt, Date.now(), Date.now(), sid, tmp).lastInsertRowid;
    const stateOfItem = (id) => RAW().prepare('SELECT state FROM supervisor_work WHERE id = ?').get(id).state;
    const noteTurn = (sid) => fs.writeFileSync(fileOf(sid), asst([{ type: 'text', text: 'Earlier turn done.' }], '2026-11-26T09:00:00Z') + user(NOTE, '2026-11-26T09:01:00Z') + asst([{ type: 'text', text: 'Posted the Done comment on #1223. I cannot close out #852: it is already closed.' }], '2026-11-26T09:02:00Z'));

    await test('#1256: a turn that only answers the Supervisor note is judged against the brief; #852 is closed, so the made-up gap is dropped and the item is not sent back', async () => {
        G._clearCache();
        issues.set(`${REPO}#852`, { state: 'closed', title: 'Fleet review of supervised turns', closed_at: '2026-11-25T08:00:00Z' });
        issues.set(`${REPO}#1223`, { state: 'open', title: 'Done comment' });
        const sid = newSession(1);
        const id = itemFor(sid, BRIEF);
        noteTurn(sid);
        prompts = [];
        modelAnswer = { verdict: 'gaps', summary: 'one gap', missed: [{ item: 'Close out #852', evidence: '"(and close out #852) as the request requires"' }] };
        const rv = await sup.review(sid, 'turn-end', { gr });
        assert.strictEqual(prompts.length, 1);
        const p = prompts[0];
        const between = (a, b) => p.slice(p.indexOf(a), p.indexOf(b));
        assert.ok(between('## Request', '## The Supervisor\'s own').includes('Split off from #852. Comment progress on #852'), 'the brief is the Request');
        assert.ok(!between('## Request', '## The Supervisor\'s own').includes('close out #852'), 'the note is not in the Request');
        assert.match(p, /## The Supervisor's own earlier notes to the agent \(1\)\n[^\n]*Yukimi did not[^\n]*earlier claim[^\n]*\n1\. \[Supervisor\] Your last turn may have left these unaddressed: \(1\) Post the Done comment/);
        assert.match(p, /## Current state of what is named \(read now\)\n[\s\S]*- DreamScape\/StaticForge#852: closed 2026-11-25 \(Fleet review of supervised turns\)/);
        assert.match(p, /DreamScape\/StaticForge#1223: open/);
        assert.strictEqual(rv.verdict, 'ok');
        assert.deepStrictEqual(rv.missed, []);
        assert.match(rv.summary, /\[already true: DreamScape\/StaticForge#852 is already closed\]/);
        assert.strictEqual(rv.request, BRIEF, 'the review stores what it was judged against');
        assert.notStrictEqual(stateOfItem(id), 'waiting', 'not Sent Back');
        assert.ok(!(rv.delivered || ''), 'nothing was sent to the session');
    });

    await test('#1256: the same turn with #852 open stays gaps, and the item is sent back', async () => {
        G._clearCache();
        issues.set(`${REPO}#852`, { state: 'open', title: 'Fleet review of supervised turns' });
        const sid = newSession(2);
        const id = itemFor(sid, BRIEF);
        noteTurn(sid);
        prompts = [];
        const rv = await sup.review(sid, 'turn-end', { gr });
        assert.match(prompts[0], /#852: open/);
        assert.strictEqual(rv.verdict, 'gaps');
        assert.deepStrictEqual(rv.missed.map((m) => m.item), ['Close out #852']);
        assert.strictEqual(rv.request, BRIEF);
        assert.strictEqual(stateOfItem(id), 'waiting');
    });

    await test('#1256: a compound gap is rewritten before it is stored and sent: the closed parenthetical goes, the rest is still asked', async () => {
        G._clearCache();
        issues.set(`${REPO}#852`, { state: 'closed', title: 't', closed_at: '2026-11-25T08:00:00Z' });
        const sid = newSession(3);
        const id = itemFor(sid, BRIEF);
        noteTurn(sid);
        modelAnswer = { verdict: 'gaps', summary: 'gaps', missed: [{ item: 'Post the Done comment on DreamScape/StaticForge#1223 (and close out #852) as the request requires', evidence: 'quote' }] };
        const rv = await sup.review(sid, 'turn-end', { gr });
        assert.strictEqual(rv.verdict, 'gaps');
        assert.deepStrictEqual(rv.missed.map((m) => m.item), ['Post the Done comment on DreamScape/StaticForge#1223 as the request requires']);
        assert.match(rv.summary, /\[already true: /);
        assert.strictEqual(stateOfItem(id), 'waiting');
        assert.doesNotMatch(sup._test.noteText(rv), /close out #852/);
        assert.match(sup._test.noteText(rv), /\[evidence: quote\]/);
    });

    await test('#1256: a settled gap leaves a question as input, not ok', async () => {
        G._clearCache();
        issues.set(`${REPO}#852`, { state: 'closed', title: 't', closed_at: '2026-11-25T08:00:00Z' });
        const sid = newSession(4);
        itemFor(sid, BRIEF);
        noteTurn(sid);
        modelAnswer = { verdict: 'gaps', summary: 's', missed: [{ item: 'Close out #852', evidence: 'x' }], questions: [{ question: 'Which colour?', answer: '', why: '' }] };
        const rv = await sup.review(sid, 'turn-end', { gr });
        assert.strictEqual(rv.verdict, 'input');
        assert.deepStrictEqual(rv.missed, []);
    });

    await test('#1256: a session with no work item is judged against the last human text before the note', async () => {
        G._clearCache();
        issues.set(`${REPO}#852`, { state: 'closed', title: 't', closed_at: '2026-11-25T08:00:00Z' });
        const sid = newSession(5);
        // the first turn is seen (its request is read), the next turn is only the note and the agent's answer to it
        fs.writeFileSync(fileOf(sid), user('Please fix the footer and comment on #1223.', '2026-11-26T08:00:00Z') + asst([{ type: 'text', text: 'Fixed the footer.' }], '2026-11-26T08:01:00Z'));
        modelAnswer = { verdict: 'ok', summary: 'fine', missed: [] };
        await sup.review(sid, 'turn-end', { gr });
        fs.appendFileSync(fileOf(sid), user(NOTE, '2026-11-26T09:01:00Z') + asst([{ type: 'text', text: 'Done.' }], '2026-11-26T09:02:00Z'));
        prompts = [];
        const rv = await sup.review(sid, 'turn-end', { gr });
        assert.match(prompts[0], /## Request\nPlease fix the footer and comment on #1223\.\n/);
        assert.match(prompts[0], /## The Supervisor's own earlier notes to the agent \(1\)/);
        assert.strictEqual(rv.request, 'Please fix the footer and comment on #1223.');
    });

    await test('#1256: with neither a brief nor an earlier human request the note is still the request, labelled as the Supervisor\'s own', async () => {
        G._clearCache();
        const sid = newSession(6);
        fs.writeFileSync(fileOf(sid), user(NOTE, '2026-11-26T09:01:00Z') + asst([{ type: 'text', text: 'Done.' }], '2026-11-26T09:02:00Z'));
        prompts = [];
        const rv = await sup.review(sid, 'turn-end', { gr });
        assert.match(prompts[0], /## Request\n\(No request or brief could be found[^\n]*the Supervisor's own earlier note[^\n]*\)\n\[Supervisor\] Your last turn/);
        assert.ok(!/## The Supervisor's own earlier notes/.test(prompts[0]), 'the same text is not shown twice');
        assert.ok(rv);
    });

    await test('turnOf: a Supervisor note is kept apart (notes), Yukimi\'s Sent back note stays steering, a human turn has no notes', () => {
        const t = sup._test.turnOf([{ role: 'user', kind: 'text', text: NOTE }, { role: 'user', kind: 'text', text: `${sup.STEER_PREFIX} Sent back by Yukimi: do the sidebar` }]);
        assert.deepStrictEqual([t.fromSupervisor, t.notes, t.sentBack], [true, [NOTE], [`${sup.STEER_PREFIX} Sent back by Yukimi: do the sidebar`]]);
        const h = sup._test.turnOf([{ role: 'user', kind: 'text', text: 'Do it' }, { role: 'user', kind: 'text', text: NOTE }]);
        assert.deepStrictEqual([h.request, h.fromSupervisor, h.notes], ['Do it', false, []]);
    });

    await test('SYSTEM rules: already-true answers, issue references, quoting the request, the state section', async () => {
        G._clearCache();
        const sid = newSession(7);
        itemFor(sid, BRIEF);
        noteTurn(sid);
        let sys = '';
        sup._test.setFetch(async (url, opts) => { sys = JSON.parse(opts.body).messages[0].content; return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"verdict":"ok","summary":"s","missed":[]}' } }] }) }; });
        await sup.review(sid, 'turn-end', { gr });
        assert.match(sys, /already true \(the issue is closed, the commit is on origin\/main/);
        assert.match(sys, /never an ask to close, finish or "close out" that issue/);
        assert.match(sys, /must quote, in "evidence", the words of the request/);
        assert.match(sys, /Current state of what is named" is given, it is the truth/);
    });

    require('../modules/agentCoord/store').close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
