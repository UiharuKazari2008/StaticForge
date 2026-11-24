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
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-fleet-'));
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

    await test('auto pick: the preferred account while free, skipping capped / exhausted ones', () => {
        const { pickAccount } = require('../modules/claudeFleetMcp')._test;
        const acc = (index, name, worst, extra) => Object.assign({ index, name, canRun: true, sessions: [], remoteControl: { message: '' }, usage: { worstPercent: worst }, availability: { state: 'free', schedulable: true } }, extra || {});
        const snap = { accounts: [acc(0, 'Main', 40, { preferred: true }), acc(1, 'Ops', 10), acc(2, 'Capped', 5, { availability: { state: 'capped', schedulable: false, message: 'past max' } })] };
        assert.strictEqual(pickAccount(snap, 'auto').name, 'Main');
        snap.accounts[0].availability = { state: 'near', schedulable: true };
        assert.strictEqual(pickAccount(snap, 'auto').name, 'Ops');
        assert.throws(() => pickAccount(snap, 'Capped'), /past max/);
    });

    await test('MCP tools: agent-coord lists the v2 tools; the fleet module is Xi-only', () => {
        const names = require('../modules/agentCoord/mcpServer').TOOLS.map((t) => t.name);
        ['coord_inspect', 'coord_editors', 'coord_locks', 'coord_build_request', 'coord_build_ready', 'coord_build_begin', 'coord_build_end', 'coord_builds'].forEach((n) => assert.ok(names.includes(n), n));
        const f = require('../modules/claudeFleetMcp');
        assert.ok(f.isFleetOwner('Xi') && !f.isFleetOwner('Wren'));
        assert.ok(!f.scopesHaveFleet(['universal']) && f.scopesHaveFleet(['sfapp_claude_fleet']));
    });

    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
