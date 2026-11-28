#!/usr/bin/env node
'use strict';

/**
 * #1154 Claude fleet: per-account Remote Control units, the legacy-switch guard, agent-coord v2 (busy locks,
 * inspect from a transcript, editors, build gates) and Yozora's dispatch account pick. Temp home + temp DB,
 * a fake systemctl / tmux runner: nothing on the host is touched.
 *
 *   node scripts/test-claude-fleet.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const store = require('../modules/agentCoord/store');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-fleet-'));
// a scratch inbox: a test must never publish into the live one (its notices land on Yukimi's phone, #1196)
process.env.NOTIFICATION_INBOX_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-claude-fleet-')), 'notifications.db');
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR = path.join(tmp, 'accounts');
process.env.DREAMSCAPE_SYSTEMD_USER_DIR = path.join(tmp, 'systemd');
process.env.AGENT_COORD_DB = path.join(tmp, 'coord.db');
process.env.DREAMSCAPE_CLAUDE_COORD_MCP = '0';

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); }
}

const ID_A = 'aaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbb';
fs.mkdirSync(path.join(tmp, '.claude', 'projects', '-repo'), { recursive: true });
fs.mkdirSync(path.join(tmp, '.claude', 'sessions'), { recursive: true });
[ID_A, ID_B].forEach((id) => {
    const d = path.join(tmp, 'accounts', id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'x', refreshToken: 'y', expiresAt: Date.now() + 3600e3, scopes: ['user:sessions:claude_code'] } }));
    fs.writeFileSync(path.join(d, 'account.json'), JSON.stringify({ oauthAccount: { emailAddress: `${id}@example.test`, accountUuid: id } }));
});

(async () => {
    const runtime = require('../modules/claudeAccountRuntime');
    const fleet = require('../modules/claudeRemoteFleet');
    const calls = [];
    fleet._setRunner(async (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { code: 0, stdout: '', stderr: '' }; });

    await test('template: own tmux socket per account, rc.sh from the account dir, enabled at default.target', () => {
        const t = fleet._templateText();
        assert.match(t, /ExecStart=\/usr\/bin\/tmux -L claude-rc-%i new-session -d -s claude-rc-%i/);
        assert.match(t, new RegExp(`${process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR.replace(/[/.]/g, '\\$&')}/%i/rc\\.sh`));
        assert.match(t, /ExecStop=\/usr\/bin\/tmux -L claude-rc-%i kill-server/);
        assert.match(t, /WantedBy=default\.target/);
    });

    await test('own folder: prepare + fleet.json make configFor-eligible; the legacy switch is blocked for it', async () => {
        await runtime.prepare(ID_A);
        assert.ok(fs.existsSync(path.join(runtime.configDir(ID_A), '.credentials.json')));
        assert.ok(fs.lstatSync(path.join(runtime.configDir(ID_A), 'projects')).isSymbolicLink());
        assert.strictEqual(fleet.blocksLegacySwitch(ID_A), '');
        await runtime.writeFleetInfo(ID_A, { movedAt: new Date().toISOString(), name: 'A' });
        assert.ok(runtime.isMoved(ID_A));
        assert.match(fleet.blocksLegacySwitch(ID_A), /own Remote Control/);
        assert.strictEqual(fleet.blocksLegacySwitch(ID_B), '');
    });

    await test('host migrated: a link from ~/.claude/.credentials.json into an account dir blocks every switch', () => {
        fs.symlinkSync(path.join(runtime.configDir(ID_A), '.credentials.json'), path.join(tmp, '.claude', '.credentials.json'));
        assert.strictEqual(fleet.hostMigrated(), ID_A);
        assert.match(fleet.blocksLegacySwitch(ID_B), /host's account/);
        fs.unlinkSync(path.join(tmp, '.claude', '.credentials.json'));
        assert.strictEqual(fleet.hostMigrated(), null);
    });

    await test('launcher: model and effort reach the command line, bad values are refused', () => {
        const launcher = require('../modules/claudeSessionLauncher');
        const line = launcher._commandLine({ env: { CLAUDE_CONFIG_DIR: '/x' }, bin: '/bin/claude', args: ['--session-id', 'u', '--model', 'opus', '--effort', 'high'] });
        assert.match(line, /--model opus --effort high/);
        assert.match(line, /CLAUDE_CONFIG_DIR='\/x'/);
        assert.ok(launcher.EFFORTS.has('xhigh'));
    });

    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    execFileSync('git', ['init', '-q', repo]);
    fs.writeFileSync(path.join(repo, 'src', 'a.js'), '1');
    fs.writeFileSync(path.join(repo, 'src', 'b.js'), '1');
    const store = require('../modules/agentCoord/store');
    const SID = '11111111-2222-3333-4444-555555555555';
    store.upsertAgent({ id: 'claude-11111111', kind: 'claude', name: 'Worker', sessionId: SID, cwd: repo, repo: 'repo', pid: process.pid });
    store.upsertAgent({ id: 'claude-99999999', kind: 'claude', name: 'Builder', cwd: repo, repo: 'repo', pid: process.pid });

    await test('claims plant the .agent-<id> busy lock; releasing everything removes it; foreign locks listed as stale', () => {
        fs.writeFileSync(path.join(repo, '.agent-old'), 'agent: old\nintent: left over\n');
        const old = new Date(Date.now() - 4 * 3600e3);
        fs.utimesSync(path.join(repo, '.agent-old'), old, old);
        const c = store.claim('claude-11111111', 'repo', ['src/a.js'], { root: repo });
        assert.strictEqual(c.granted.length, 1);
        assert.ok(fs.existsSync(path.join(repo, '.agent-claude-11111111')));
        const locks = store.lockFiles(repo);
        assert.deepStrictEqual(locks.map((l) => [l.file, l.viaCoord, l.stale]).sort(), [['.agent-claude-11111111', true, false], ['.agent-old', false, true]]);
        const clash = store.claim('claude-99999999', 'repo', ['src'], { root: repo });
        assert.strictEqual(clash.granted.length, 0);
        assert.strictEqual(clash.conflicts[0].holder, 'Worker');
    });

    await test('inspect: edits by tool and by shell (shell only while uncommitted), commands, last message, incremental', () => {
        const line = (content, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content } });
        const file = path.join(tmp, '.claude', 'projects', '-repo', `${SID}.jsonl`);
        fs.writeFileSync(file, [
            line([{ type: 'tool_use', name: 'Edit', input: { file_path: path.join(repo, 'src', 'a.js') } }], '2026-11-24T10:00:00Z'),
            line([{ type: 'tool_use', name: 'Bash', input: { command: "sed -i 's/1/2/' src/b.js src/gone.js", description: 'bump' } }], '2026-11-24T10:01:00Z'),
            line([{ type: 'text', text: 'Done with a and b.' }], '2026-11-24T10:02:00Z')
        ].join('\n') + '\n');
        const r = store.inspect('Worker');
        const files = r.edited.files.map((f) => `${f.path}:${f.via}`).sort();
        assert.deepStrictEqual(files, ["src/a.js:tool", "src/b.js:shell"], JSON.stringify(files)); // src/gone.js is not a changed file
        assert.strictEqual(r.commands[0].description, 'bump');
        assert.strictEqual(r.lastMessage.text, 'Done with a and b.');
        fs.appendFileSync(file, line([{ type: 'tool_use', name: 'Write', input: { file_path: path.join(repo, 'src', 'a.js') } }], '2026-11-24T10:03:00Z') + '\n');
        const again = store.inspect('Worker');
        assert.strictEqual(again.edited.files.find((f) => f.path === 'src/a.js').edits, 2);
        assert.strictEqual(store.editorsOf(['src/a.js'])[0].editedBy[0].name, 'Worker');
    });

    await test('build gate: waits on a busy / claiming agent, begins once it answers, tells everyone', () => {
        const g = store.buildRequest('claude-99999999', { target: 'apk' });
        assert.deepStrictEqual(g.waitingOn.map((w) => w.name), ['Worker']);
        assert.strictEqual(g.notified.length, 1);
        assert.strictEqual(store.buildBegin('claude-99999999', g.build.id).began, false);
        assert.strictEqual(store.buildRequest('claude-99999999', { target: 'apk' }).joined, true);
        store.buildReady('claude-11111111', g.build.id, true, 'saved');
        const b = store.buildBegin('claude-99999999', g.build.id);
        assert.strictEqual(b.began, true);
        assert.throws(() => store.buildBegin('claude-11111111', g.build.id), /Builder|claude-99999999/);
        store.buildEnd('claude-99999999', g.build.id, 'ok');
        const inbox = store.inbox('claude-11111111').map((m) => m.kind);
        assert.deepStrictEqual(inbox, ['question', 'note', 'done']);
        store.releaseAll('claude-11111111');
        assert.ok(!fs.existsSync(path.join(repo, '.agent-claude-11111111')));
    });

    await test('build gate: force needs a reason; an idle agent with no claims counts as ready', () => {
        const g = store.buildRequest('claude-99999999', { target: 'sw-notify' });
        assert.strictEqual(g.participants[0].state, 'auto');
        assert.strictEqual(g.canBegin, true);
        store.claim('claude-11111111', 'repo', ['src/a.js'], { root: repo });
        // a claim with nothing of its own uncommitted does not hold a gate (decided from git, not from a reply)
        assert.strictEqual(store.builds({ repo: 'repo' }).find((x) => x.build.id === g.build.id).canBegin, true);
        store.buildReady('claude-11111111', g.build.id, false, 'mid-edit');
        assert.throws(() => store.buildBegin('claude-99999999', g.build.id, { force: true }), /reason/);
        const f = store.buildBegin('claude-99999999', g.build.id, { force: true, reason: 'hotfix' });
        assert.strictEqual(f.build.forced, 'hotfix');
    });

    await test('dispatch pick: auto takes the most headroom and skips full accounts; a named full one is refused', () => {
        const { pickAccount } = require('../modules/claudeFleetMcp')._test;
        const acc = (index, name, worst, canRun = true) => ({ index, name, canRun, sessions: [], remoteControl: { message: '' }, usage: { worstPercent: worst } });
        const snap = { accounts: [acc(0, 'Main', 80), acc(1, 'Ops', 20), acc(2, 'Full', 99), acc(3, 'NoLogin', 0, false)] };
        assert.strictEqual(pickAccount(snap, 'auto').name, 'Ops');
        assert.strictEqual(pickAccount(snap, 'main').name, 'Main');
        assert.throws(() => pickAccount(snap, 'Full'), /99%/);
        assert.strictEqual(pickAccount(snap, 'Full', true).name, 'Full');
        assert.throws(() => pickAccount(snap, 'NoLogin'), /cannot run/);
        assert.throws(() => pickAccount({ accounts: [acc(2, 'Full', 99)] }, 'auto'), /No Claude account has room/);
    });

    await test('availability: free, near (80%+ or within 10 of a max), capped (past its max), exhausted (100%)', () => {
        const fs8 = require('../modules/claudeFleetSettings');
        const s = (o) => Object.assign({}, fs8.DEFAULTS, o || {});
        const u = (...ps) => ({ limits: ps.map(([kind, percent]) => ({ kind, label: kind, percent, resetsAt: 1 })) });
        assert.strictEqual(fs8.availability(u(['session', 20], ['weekly_all', 30]), s()).state, 'free');
        assert.strictEqual(fs8.availability(u(['session', 85]), s()).state, 'near');
        assert.strictEqual(fs8.availability(u(['weekly_all', 52]), s({ maxWeeklyPct: 60 })).state, 'near');
        const c = fs8.availability(u(['weekly_all', 61]), s({ maxWeeklyPct: 60 }));
        assert.deepStrictEqual([c.state, c.schedulable], ['capped', false]);
        assert.strictEqual(fs8.availability(u(['session', 40]), s({ maxSessionPct: 40 })).state, 'capped');
        const e = fs8.availability(u(['session', 100]), s());
        assert.deepStrictEqual([e.state, e.schedulable], ['exhausted', false]);
        assert.deepStrictEqual([fs8.availability(null, s()).state, fs8.availability(null, s()).schedulable], ['unknown', true]);
    });

    await test('availability: login state from needsLogin / a login error / a recorded start failure; clears on a later good usage read; pick skips it (auto) and refuses it (named)', () => {
        const fs8 = require('../modules/claudeFleetSettings');
        const { pickAccount } = require('../modules/claudeFleetMcp')._test;
        const s = Object.assign({}, fs8.DEFAULTS);
        const lim = [{ kind: 'session', label: 'session', percent: 20, resetsAt: 1 }];
        const a1 = fs8.availability({ index: 7, needsLogin: true, limits: [], error: 'Login expired: sign in again (Claude Accounts > Add Account)' }, s);
        assert.deepStrictEqual([a1.state, a1.schedulable], ['login', false]);
        assert.match(a1.message, /Login expired: sign in again \(Fleet > Accounts/);
        assert.strictEqual(fs8.availability({ index: 7, limits: [], error: 'login refused (HTTP 401)' }, s).state, 'login');
        assert.strictEqual(fs8.availability({ index: 7, limits: [], error: 'Usage read failed (HTTP 500)' }, s).state, 'unknown');
        assert.ok(fs8.isLoginError('OAuth token has expired') && fs8.isLoginError('Not logged in') && !fs8.isLoginError('rate limited'));
        // a recorded runtime failure
        fs8.markLoginFailed(8, 'OAuth token has expired', 'Ops');
        assert.ok(fs8.loginFailedOf(8));
        assert.strictEqual(fs8.availability({ index: 8, limits: lim, at: Date.now() - 60000 }, s).state, 'login', 'an older good read does not clear it');
        assert.strictEqual(fs8.availability({ index: 8, limits: [] }, s).state, 'login');
        assert.strictEqual(fs8.availability({ index: 8, limits: lim, at: Date.now() + 1000 }, s).state, 'free', 'a later good read clears it');
        assert.strictEqual(fs8.loginFailedOf(8), null);
        // a runtime mark (a running session's turn ended "Login expired"): a good usage read never clears it (other token); a newer credentials file does
        const cfg = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'login-cfg-'));
        fs8.markLoginFailed(9, 'Login expired', 'Doug', { runtime: true, configDir: cfg });
        assert.strictEqual(fs8.availability({ index: 9, limits: lim, at: Date.now() + 60000 }, s).state, 'login', 'a later good usage read does not clear a runtime mark');
        const cred = require('path').join(cfg, '.credentials.json');
        require('fs').writeFileSync(cred, '{}');
        const old = new Date(Date.now() - 60000); require('fs').utimesSync(cred, old, old);
        assert.strictEqual(fs8.availability({ index: 9, limits: lim }, s).state, 'login', 'an older credentials file does not clear it');
        const newer = new Date(Date.now() + 5000); require('fs').utimesSync(cred, newer, newer);
        assert.strictEqual(fs8.availability({ index: 9, limits: lim }, s).state, 'free', 'a newer credentials file clears it');
        assert.strictEqual(fs8.loginFailedOf(9), null);
        require('fs').rmSync(cfg, { recursive: true, force: true });
        fs8.markLoginFailed(8, 'x'); fs8.clearLoginFailed(8);
        assert.strictEqual(fs8.loginFailedOf(8), null);
        const acc = (index, name, availability) => ({ index, name, canRun: true, sessions: [], remoteControl: { message: '' }, usage: { worstPercent: 5 }, availability });
        const snap = { accounts: [acc(0, 'Main', { state: 'login', schedulable: false, message: fs8.LOGIN_MSG }), acc(1, 'Ops', { state: 'free', schedulable: true })] };
        assert.strictEqual(pickAccount(snap, 'auto').name, 'Ops');
        assert.strictEqual(pickAccount(snap, 'auto', true).name, 'Ops', 'allowFull does not take an expired login');
        assert.throws(() => pickAccount(snap, 'Main'), /Login expired/);
        assert.throws(() => pickAccount(snap, 'Main', true), /Login expired/);
        assert.throws(() => pickAccount({ accounts: [snap.accounts[0]] }, 'auto'), /No Claude account has room/);
    });

    await test('auto pick: the preferred account while free, skipping capped / exhausted ones', () => {
        const { pickAccount } = require('../modules/claudeFleetMcp')._test;
        const acc = (index, name, worst, extra) => Object.assign({ index, name, canRun: true, sessions: [], remoteControl: { message: '' }, usage: { worstPercent: worst }, availability: { state: 'free', schedulable: true } }, extra || {});
        const snap = { accounts: [acc(0, 'Main', 40, { preferred: true }), acc(1, 'Ops', 10), acc(2, 'Capped', 5, { availability: { state: 'capped', schedulable: false, message: 'past max' } })] };
        assert.strictEqual(pickAccount(snap, 'auto').name, 'Main');
        snap.accounts[0].availability = { state: 'near', schedulable: true };
        assert.strictEqual(pickAccount(snap, 'auto').name, 'Ops');
        assert.throws(() => pickAccount(snap, 'Capped'), /past max/);
        snap.accounts[1].settings = { priority: 'low' };
        snap.accounts.push(acc(3, 'Busy', 60, { settings: { priority: 'normal' } }));
        assert.strictEqual(pickAccount(snap, 'auto').name, 'Main', 'a low-priority account (Ops, the most headroom) waits behind normal ones');
    });

    await test('pace: mid-week on pace, over today\'s share, after a reset, with maxWeeklyPct', () => {
        const { pace } = require('../modules/claudeFleetSettings');
        const DAY = 86400000;
        const d0 = new Date(2026, 10, 25, 12, 0, 0).getTime(); // noon
        const mid = new Date(2026, 10, 25, 0, 0, 0).getTime();
        const resets = mid + 3.5 * DAY; // 3.5 days to go from midnight: halfway through the week
        const wk = (percent) => ({ percent, resetsAt: resets });
        let p = pace(wk(50), null, 46, d0);
        assert.strictEqual(p.state, 'ok');
        assert.strictEqual(p.todayShare, 15.4); // (100 - 46) / 3.5
        assert.strictEqual(p.usedToday, 4);
        p = pace(wk(50), null, 40, d0); // used 10 of a 17.1 share, week 50 vs 50 expected (noon of 3.5 days left = 3.0)
        assert.strictEqual(p.state, 'ok');
        p = pace(wk(60), null, 40, d0); // 20 used today >= 17.1 share
        assert.strictEqual(p.state, 'over');
        p = pace(wk(70), null, 66, d0); // within today's share but 70 vs ~57 expected
        assert.strictEqual(p.state, 'ahead');
        p = pace(wk(9), null, 0, new Date(2026, 10, 25, 12).getTime()); // after a reset: week began today, 7 days left
        assert.strictEqual(pace({ percent: 9, resetsAt: mid + 7 * DAY }, null, 0, d0).todayShare, 14.3);
        assert.strictEqual(pace({ percent: 9, resetsAt: mid + 7 * DAY }, null, 0, d0).state, 'ok');
        p = pace({ percent: 15, resetsAt: mid + 7 * DAY }, null, 0, d0);
        assert.strictEqual(p.state, 'over');
        p = pace({ percent: 15, resetsAt: mid + 7 * DAY }, 60, 0, d0); // own max 60: share 8.6
        assert.strictEqual(p.todayShare, 8.6);
        assert.strictEqual(p.state, 'over');
        assert.strictEqual(pace({ percent: 5, resetsAt: mid + 7 * DAY }, 60, 0, d0).state, 'ok');
        assert.strictEqual(pace(null).state, 'unknown');
        // the history helper: yesterday's row inside the window counts, after a reset (higher) or before the window it does not
        const hist = require('../modules/claudeUsageHistory');
        const Database = require('better-sqlite3');
        const mem = new Database(':memory:');
        hist._setDb(mem);
        hist.record({ accounts: [{ id: 'x', name: 'X', limits: [{ kind: 'weekly_all', percent: 30 }] }] }, d0 - DAY);
        assert.strictEqual(hist.dayStartWeekPct('x', d0 - 5 * DAY, 45, d0), 30);
        assert.strictEqual(hist.dayStartWeekPct('x', d0 - 5 * DAY, 20, d0), 0, 'above today: a reset happened');
        assert.strictEqual(hist.dayStartWeekPct('x', d0 - 0.5 * DAY, 45, d0), 0, 'the window began after yesterday began');
        assert.strictEqual(hist.dayStartWeekPct('nobody', d0 - 5 * DAY, 45, d0), 0);
        hist._setDb(null);
        mem.close();
    });

    await test('auto pick by pace: an over-share preferred / high account loses to an ok normal one; all over -> best; named honoured', () => {
        const { pickAccount } = require('../modules/claudeFleetMcp')._test;
        const acc = (index, name, state, ratio, extra) => Object.assign({ index, name, canRun: true, sessions: [], remoteControl: { message: '' }, usage: { worstPercent: 30 }, availability: { state: 'free', schedulable: true, pace: { state, ratio } } }, extra || {});
        const snap = { accounts: [acc(0, 'Pref', 'over', 1.2, { preferred: true }), acc(1, 'High', 'over', 1.1, { settings: { priority: 'high' } }), acc(2, 'Normal', 'ok', 0.4, { settings: { priority: 'normal' } })] };
        assert.strictEqual(pickAccount(snap, 'auto').name, 'Normal');
        snap.accounts.push(acc(3, 'NormalAhead', 'ahead', 0.1));
        assert.strictEqual(pickAccount(snap, 'auto').name, 'Normal', 'ahead ranks after ok in the same priority');
        snap.accounts[2].settings = { priority: 'low' };
        assert.strictEqual(pickAccount(snap, 'auto').name, 'NormalAhead', 'priority first among the not-over ones');
        snap.accounts[2].availability.pace = { state: 'ok', ratio: 0.2 };
        snap.accounts[2].preferred = true; // preferred and ok: taken first
        assert.strictEqual(pickAccount(snap, 'auto').name, 'Normal');
        const allOver = { accounts: [acc(0, 'A', 'over', 1.5), acc(1, 'B', 'over', 1.05, { settings: { priority: 'high' } }), acc(2, 'C', 'over', 1.1)] };
        assert.strictEqual(pickAccount(allOver, 'auto').name, 'B', 'all over: still the best of them');
        assert.strictEqual(pickAccount(allOver, 'A').name, 'A', 'a named account is honoured');
        const same = { accounts: [acc(0, 'A', 'over', 1.5), acc(1, 'C', 'over', 1.1)] };
        assert.strictEqual(pickAccount(same, 'auto').name, 'C', 'then the most headroom against its pace');
    });

    await test('MCP tools: agent-coord lists the v2 tools; the fleet module is Xi-only', () => {
        const names = require('../modules/agentCoord/mcpServer').TOOLS.map((t) => t.name);
        ['coord_inspect', 'coord_editors', 'coord_locks', 'coord_build_request', 'coord_build_ready', 'coord_build_begin', 'coord_build_end', 'coord_builds', 'fleet_status', 'fleet_work_list', 'fleet_work_get', 'fleet_work_update', 'fleet_work_hold', 'fleet_work_cancel', 'fleet_session_read', 'fleet_maintenance_report'].forEach((n) => assert.ok(names.includes(n), n));
        assert.ok(!names.includes('fleet_work_start'), 'agents start nothing');
        const f = require('../modules/claudeFleetMcp');
        assert.ok(f.isFleetOwner('Xi') && !f.isFleetOwner('Wren'));
        assert.ok(!f.scopesHaveFleet(['universal']) && f.scopesHaveFleet(['sfapp_claude_fleet']));
    });

    await test('Waiting work tools: list / get / update / start / hold / cancel over the queue, per-id results', async () => {
        const yzSent = [];
        require('../modules/fleetYozora')._setFetch(async (url, opts) => { yzSent.push({ method: (opts && opts.method) || 'GET', url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null }); return { ok: true, status: 200, text: async () => '{}' }; });
        const sup = require('../modules/agentSupervisor');
        const { dispatch } = require('../modules/claudeFleetMcp')._test;
        const names = require('../modules/claudeFleetMcp').TOOLS.map((t) => t.name);
        ['fleet_work_list', 'fleet_work_get', 'fleet_work_update', 'fleet_work_start', 'fleet_work_hold', 'fleet_work_cancel'].forEach((n) => assert.ok(names.includes(n), n));
        const w = sup.enqueue({ title: 'Fix the gizmo', prompt: 'Fix modules/gizmo.js', source: 'yozora', issueFields: { repo: 'Org/Repo', number: 77, id: 5 } });
        assert.strictEqual(w.state, 'held');
        const list = await dispatch(null, 'fleet_work_list', { state: 'held', search: 'gizmo' });
        assert.strictEqual(list.count, 1);
        assert.deepStrictEqual([list.work[0].state, list.work[0].issue], ['Waiting', 'Org/Repo#77']);
        assert.strictEqual((await dispatch(null, 'fleet_work_list', { state: 'running' })).count, 0);
        const got = await dispatch(null, 'fleet_work_get', { id: w.id });
        assert.strictEqual(got.brief, 'Fix modules/gizmo.js');
        await assert.rejects(() => dispatch(null, 'fleet_work_get', { id: 9999 }), /No work item/);
        const up = await dispatch(null, 'fleet_work_update', { id: w.id, appendNote: 'Also add a test.', effort: 'low' });
        assert.deepStrictEqual(up.changed, ['appendNote', 'effort']);
        assert.match((await dispatch(null, 'fleet_work_get', { id: w.id })).brief, /Also add a test\.$/);
        await new Promise((r) => setTimeout(r, 50));
        assert.ok(yzSent.some((c) => c.method === 'POST' && /issues\/77\/comments/.test(c.url) && /Brief updated by Yozora/.test(c.body.body)), JSON.stringify(yzSent.map((c) => c.url)));
        const c = await dispatch(null, 'fleet_work_cancel', { ids: [w.id, 9999], reason: 'obsolete' });
        assert.deepStrictEqual(c.results.map((r) => r.ok), [true, false]);
        assert.strictEqual((await dispatch(null, 'fleet_work_get', { id: w.id })).state, 'Cancelled');
        const h = await dispatch(null, 'fleet_work_hold', { ids: [w.id] });
        assert.strictEqual(h.results[0].state, 'Waiting');
    });

    await test('Remote Control and several issues: claude_dispatch / fleet_work_update take remoteControl and issues; rows show them', async () => {
        require('../modules/fleetYozora')._setFetch(async () => ({ ok: true, status: 200, text: async () => '{}' }));
        const sup = require('../modules/agentSupervisor');
        const fm = require('../modules/claudeFleetMcp');
        const { dispatch } = fm._test;
        const tool = (n) => fm.TOOLS.find((t) => t.name === n);
        ['claude_dispatch', 'fleet_work_update'].forEach((n) => {
            const p = tool(n).inputSchema.properties;
            assert.strictEqual(p.remoteControl.type, 'boolean', `${n} remoteControl`);
            assert.deepStrictEqual([p.issues.type, p.issues.items.type], ['array', 'string'], `${n} issues`);
        });
        assert.ok(/WITHOUT Remote Control unless you pass remoteControl: true/.test(tool('claude_dispatch').description));
        assert.ok(!/It runs in Remote Control \(Yukimi sees it/.test(tool('claude_dispatch').description));
        const w = sup.enqueue({ title: 'Several', prompt: 'two issues' });
        const up = await dispatch(null, 'fleet_work_update', { id: w.id, remoteControl: true, issues: ['Org/Repo#1', 'Org/Repo#2'] });
        assert.deepStrictEqual(up.changed, ['remoteControl', 'issues']);
        assert.deepStrictEqual([up.item.remoteControl, up.item.issues], [true, ['Org/Repo#1', 'Org/Repo#2']]);
        assert.strictEqual((await dispatch(null, 'fleet_work_get', { id: w.id })).issue, 'Org/Repo#1', 'the first is the primary');
    });

    await test('pace and renewal math (claudePace.js) and the client copies agree', async () => {
        const pace = require('../modules/claudePace');
        const H = 3600000;
        const reset = Date.UTC(2026, 10, 25, 12);
        const wk = (percent) => ({ kind: 'weekly_all', percent, resetsAt: reset });
        // start of the window: nothing elapsed, no projection
        const start = pace.paceOf(wk(0), reset - 168 * H);
        assert.deepStrictEqual([start.elapsedPct, start.state, start.runOutAt], [0, 'ok', null]);
        // mid window: 50% used at 50% elapsed is on pace; 40% is behind; 60% is over but would last to the reset only if under
        const mid = reset - 84 * H;
        assert.deepStrictEqual([pace.paceOf(wk(50), mid).ahead, pace.paceOf(wk(50), mid).state], [0, 'ok']);
        assert.strictEqual(pace.paceOf(wk(40), mid).ahead, -10);
        // 55% at 50% elapsed: over pace, and it runs out before the reset (55/50 > 1): amber is only "over", red is "far"
        const over = pace.paceOf(wk(55), mid);
        assert.strictEqual(over.state, 'far');
        assert.strictEqual(over.runOutAt, Math.round(mid + 45 * (84 * H) / 55));
        assert.ok(over.runOutAt < reset);
        // 12 h from the end of a week at 43% is ahead of nothing: 43 vs 92.9 elapsed
        assert.strictEqual(pace.paceOf(wk(43), reset - 12 * H).state, 'ok');
        // under 5% of the window gone: never far, only over
        assert.strictEqual(pace.paceOf(wk(30), reset - 168 * H + 2 * H).state, 'over');
        // the session window is 5 hours; other kinds and past resets have no pace
        assert.strictEqual(pace.paceOf({ kind: 'session', percent: 10, resetsAt: reset }, reset - 2.5 * H).elapsedPct, 50);
        assert.strictEqual(pace.paceOf({ kind: 'extra', percent: 10, resetsAt: reset }, reset - H), null);
        assert.strictEqual(pace.paceOf(wk(10), reset + 1), null);
        // renewal day: this month if still ahead, else next; the 31st clamps to a short month's last day
        const L = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
        assert.strictEqual(pace.renewalAfter(8, L(2026, 11, 24)), L(2026, 12, 8, 0));
        assert.strictEqual(pace.renewalAfter(28, L(2026, 11, 24)), L(2026, 11, 28, 0));
        assert.strictEqual(pace.renewalAfter(24, L(2026, 11, 24)), L(2026, 11, 24, 0));
        assert.strictEqual(pace.renewalAfter(31, L(2026, 2, 3)), L(2026, 2, 28, 0));
        assert.strictEqual(pace.renewalAfter(31, L(2026, 11, 24)), L(2026, 11, 30, 0));
        assert.strictEqual(pace.renewalAfter(30, L(2028, 2, 3)), L(2028, 2, 29, 0));
        assert.strictEqual(pace.renewalAfter(5, L(2026, 12, 20)), L(2027, 1, 5, 0));
        assert.strictEqual(pace.renewalAfter(0, L(2026, 11, 24)), null);
        // the copies in the two clients give the same answers
        const load = (file) => {
            const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
            const a = src.indexOf('function paceOf'); const b = src.indexOf('function renewalAfter');
            const end = src.indexOf('\n    }\n', b) + 6;
            return new Function(`${src.slice(a, end)}; return { paceOf, renewalAfter };`)();
        };
        for (const f of ['apps/claudedesk/client/claudedesk.js', 'public/scripts/comp/wmClaudeAccounts.js']) {
            const c = load(f);
            for (const [pc, at] of [[0, reset - 168 * H], [55, mid], [43, reset - 12 * H], [30, reset - 166 * H]]) assert.deepStrictEqual(c.paceOf(wk(pc), at), pace.paceOf(wk(pc), at), f);
            for (const [d, at] of [[31, L(2026, 2, 3)], [8, L(2026, 11, 24)], [5, L(2026, 12, 20)]]) assert.strictEqual(c.renewalAfter(d, at), pace.renewalAfter(d, at), f);
        }
    });

    await test('login marks persist across a module reload; a proven start clears them; a restart keeps "needs signing in"', () => {
        const mod = '../modules/claudeFleetSettings';
        let fs8 = require(mod);
        fs8.markLoginFailed(31, 'Login expired', 'Douglas', { runtime: true, configDir: path.join(tmp, 'nowhere') });
        delete require.cache[require.resolve(mod)];
        fs8 = require(mod); // a restart: fresh module, same DB
        assert.ok(fs8.loginFailedOf(31), 'the mark was loaded back');
        assert.strictEqual(fs8.loginFailedOf(31).name, 'Douglas');
        assert.strictEqual(fs8.availability({ index: 31, limits: [] }, fs8.DEFAULTS).state, 'login');
        fs8.clearLoginFailed(31);
        delete require.cache[require.resolve(mod)];
        fs8 = require(mod);
        assert.strictEqual(fs8.loginFailedOf(31), null, 'a cleared mark stays cleared after a restart');
    });

    await test('credentials heuristic: past expiry (or none) and no refresh token -> login; a refresh token, a future expiry, a busy session or a proven start keep it ok; no token value is read into the result', () => {
        const fs8 = require('../modules/claudeFleetSettings');
        const rt = require('../modules/claudeAccountRuntime');
        const id = 'cccccccccccccccc';
        const dir = rt.configDir(id);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, '.credentials.json');
        const put = (o, mt) => { fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: o })); if (mt) fs.utimesSync(file, mt / 1000, mt / 1000); };
        const u = { id, index: 41, limits: [{ kind: 'session', label: 's', percent: 5, resetsAt: 1 }] };
        const SECRET = 'sk-ant-SECRET-TOKEN-VALUE';
        put({ accessToken: SECRET, refreshToken: '', expiresAt: Date.now() - 1000 });
        const a = fs8.availability(u, fs8.DEFAULTS);
        assert.deepStrictEqual([a.state, a.schedulable], ['login', false]);
        assert.match(a.message, /Claude Code login expired: sign in again/);
        assert.ok(!JSON.stringify(a).includes(SECRET), 'no token value in the answer');
        put({ accessToken: SECRET, expiresAt: 0 });
        assert.strictEqual(fs8.availability(u, fs8.DEFAULTS).state, 'login', 'no expiry and no refresh token');
        put({ accessToken: SECRET, refreshToken: 'r', expiresAt: Date.now() - 1000 });
        assert.strictEqual(fs8.availability(u, fs8.DEFAULTS).state, 'free', 'a refresh token renews it');
        put({ accessToken: SECRET, expiresAt: Date.now() + 3600e3 });
        assert.strictEqual(fs8.availability(u, fs8.DEFAULTS).state, 'free', 'still inside its access token');
        put({ accessToken: SECRET, expiresAt: 0 });
        // a live busy session on that config dir: it works
        store.upsertAgent({ id: 'busy-on-c', kind: 'claude', name: 'x', status: 'busy', pid: process.pid, configDir: dir });
        assert.strictEqual(fs8.availability(u, fs8.DEFAULTS).state, 'free', 'a busy session on the dir proves it works');
        store.setStatus('busy-on-c', 'gone');
        assert.strictEqual(fs8.availability(u, fs8.DEFAULTS).state, 'login');
        // a start that succeeded after the file was written
        put({ accessToken: SECRET, expiresAt: 0 }, Date.now() - 60000);
        fs8.clearLoginFailed(41);
        assert.strictEqual(fs8.availability(u, fs8.DEFAULTS).state, 'free', 'a proven start after the credentials were written');
        // a file with no oauth block (API-key setups) and a missing file are never judged
        fs.writeFileSync(file, '{}');
        assert.strictEqual(fs8.availability(Object.assign({}, u, { index: 42 }), fs8.DEFAULTS).state, 'free');
        fs.rmSync(file);
        assert.strictEqual(fs8.availability(Object.assign({}, u, { index: 43 }), fs8.DEFAULTS).state, 'free');
    });

    await test('renewalDay is a setting (1 to 31, blank clears it)', async () => {
        const fs8 = require('../modules/claudeFleetSettings');
        assert.strictEqual(fs8.DEFAULTS.renewalDay, null);
        assert.strictEqual(fs8.get({ getConfig: () => ({ fleet: { accounts: { a: { renewalDay: 8 } } } }) }, 'a').renewalDay, 8);
        assert.strictEqual(fs8.get({ getConfig: () => ({ fleet: { accounts: { a: { renewalDay: 40 } } } }) }, 'a').renewalDay, null);
    });

    await test('#1276 end to end: a new fleet issue is carded by the hook and claude_dispatch for it in the same breath leaves exactly one work item, holding the dispatch\'s brief; a plain new issue gets its one Waiting item', async () => {
        const REPO = 'DreamScape/StaticForge';
        const open = new Map(); // number -> { title, body }
        const sent = [];
        require('../modules/fleetYozora')._setFetch(async (url, opts) => {
            const method = (opts && opts.method) || 'GET';
            const u = String(url).replace(/^https?:\/\/[^/]+\/api\/v1/, '');
            sent.push({ method, url: u, body: opts && opts.body ? JSON.parse(opts.body) : null });
            const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
            let m;
            if (method === 'GET' && /\/labels\?/.test(u)) return ok([{ id: 1, name: 'fleet' }]);
            if (method === 'GET' && u.startsWith(`/repos/${REPO}/issues?state=open`) && /labels=fleet/.test(u)) return ok(/page=1$/.test(u) ? [...open.entries()].map(([n, v]) => ({ number: n, id: 7000 + n, title: v.title, body: v.body, labels: [{ name: 'fleet' }] })) : []);
            if (method === 'GET' && /\/issues\?state=open/.test(u)) return ok([]);
            if (method === 'GET' && (m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(u))) { const v = open.get(Number(m[1])) || {}; return ok({ number: Number(m[1]), id: 7000 + Number(m[1]), state: 'open', title: v.title || '', body: v.body || '', labels: [{ name: 'fleet' }] }); }
            return ok({});
        });
        const sup = require('../modules/agentSupervisor');
        const mcp = require('../modules/claudeFleetMcp')._test;
        const raw = store.open();
        // one account with room (the pick is not what this test is about): the fleet status and the usage read are stood in for
        const rf = require('../modules/claudeRemoteFleet');
        const us = require('../modules/claudeUsage');
        const kept = [rf.status, us.read];
        rf.status = async () => ({ accounts: [{ index: 0, id: ID_A, name: 'Main', active: true, moved: true, onHost: false, state: 'connected', hasLogin: true, settings: {}, availability: null, sessions: [] }] });
        us.read = async () => ({ accounts: [] });
        try {
        const rowsFor = (n) => raw.prepare("SELECT * FROM supervisor_work WHERE state != 'cancelled' AND ((issue_repo = ? AND issue_number = ?) OR issue_refs LIKE ?)").all(REPO, n, `%"number":${n}%`);
        // the issue is filed, the hook cards it ...
        open.set(4276, { title: 'Filed and dispatched', body: 'the write-up' });
        const pulled = await sup.pullIssues(null, { force: true });
        assert.ok(pulled.added >= 1, JSON.stringify(pulled));
        const carded = rowsFor(4276);
        assert.deepStrictEqual(carded.map((r) => [r.source, r.state]), [['yozora', 'held']]);
        // ... and the Director's claude_dispatch for it lands right after (the real tool path: account pick, enqueue, pump)
        const out = await mcp.dispatch(null, 'claude_dispatch', { title: 'Dispatched title', prompt: 'THE DISPATCH BRIEF for #4276', issues: [`${REPO}#4276`] });
        assert.deepStrictEqual([out.work, out.adopted, out.existing, out.state], [carded[0].id, true, undefined, 'held'], JSON.stringify(out));
        assert.match(out.note, /taken over with this brief: no second item was made/);
        const after = rowsFor(4276);
        assert.strictEqual(after.length, 1, 'exactly one work item for the issue');
        assert.deepStrictEqual([after[0].id, after[0].prompt, after[0].title, after[0].source], [carded[0].id, 'THE DISPATCH BRIEF for #4276', 'Dispatched title', 'director']);
        // the hook does not card it again, and the other order (dispatch first, the hook after) makes one item too
        assert.strictEqual((await sup.pullIssues(null, { force: true })).added, 0);
        const first = await mcp.dispatch(null, 'claude_dispatch', { prompt: 'dispatched before the hook saw it', issues: [`${REPO}#4277`] });
        open.set(4277, { title: 'Dispatch first', body: 'b' });
        assert.strictEqual((await sup.pullIssues(null, { force: true })).added, 0);
        assert.deepStrictEqual(rowsFor(4277).map((r) => [r.id, r.prompt]), [[first.work, 'dispatched before the hook saw it']]);
        assert.strictEqual(first.adopted, undefined);
        // a plain new issue still gets its one Waiting item with the hook's brief
        open.set(4278, { title: 'Plain new issue', body: 'plain body' });
        assert.strictEqual((await sup.pullIssues(null, { force: true })).added, 1);
        const plain = rowsFor(4278);
        assert.deepStrictEqual(plain.map((r) => [r.source, r.state]), [['yozora', 'held']]);
        assert.match(plain[0].prompt, /^Yozora issue DreamScape\/StaticForge#4278: Plain new issue\n/);
        raw.prepare("UPDATE supervisor_work SET state = 'cancelled' WHERE issue_number IN (4276, 4277, 4278)").run();
        } finally { [rf.status, us.read] = kept; }
    });

    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
