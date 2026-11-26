#!/usr/bin/env node
'use strict';
/** #1256: steer / interrupt never type into a pane with no running claude; claude_session_send says so.  node scripts/test-claude-steer-gone.js */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'steer-gone-'));
process.env.HOME = SANDBOX;
process.env.DREAMSCAPE_CLAUDE_HOME = path.join(SANDBOX, 'claude-home');
process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR = path.join(SANDBOX, 'store');
process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET = 'steer-gone-test';
process.env.DREAMSCAPE_CLAUDE_DESK_STATE = path.join(SANDBOX, 'state');
process.env.DREAMSCAPE_CLAUDE_CLI = '/opt/test/claude';

const launcher = require('../modules/claudeSessionLauncher');
const claudeSessions = require('../modules/claudeSessions');
const fleetMcp = require('../modules/claudeFleetMcp');

const SID = '11111111-2222-3333-4444-555555555555';
let failed = 0;
async function test(name, fn) { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); } }

(async () => {
    // a stand-in "claude" process (named claude) and one that is the wrapper's sleep
    const claudeBin = path.join(SANDBOX, 'claude');
    fs.copyFileSync('/bin/sleep', claudeBin);
    const claudeProc = spawn(claudeBin, ['60'], { stdio: 'ignore' });
    const sleepProc = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 200));
    const startOf = (pid) => { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19]; };

    let pane = { pid: claudeProc.pid, cmd: 'claude' };
    const typed = [];
    launcher._setRunner(async (cmd, args) => {
        if (args.includes('list-panes')) return { code: 0, stdout: `%1 ${pane.pid}\n`, stderr: '' };
        if (args.includes('display-message')) return { code: 0, stdout: `${pane.cmd}\n`, stderr: '' };
        if (args.includes('send-keys') || args.includes('set-buffer') || args.includes('paste-buffer')) typed.push(args.join(' '));
        return { code: 0, stdout: '', stderr: '' };
    });
    let rec = { id: SID, pid: claudeProc.pid, procStart: startOf(claudeProc.pid), status: 'idle', cwd: SANDBOX, origin: 'fleet' };
    claudeSessions.liveSessions = () => [rec];

    await test('pane holds the running claude: keys are sent', async () => {
        typed.length = 0;
        const r = await launcher.steer(SID, 'hello');
        assert.strictEqual(r.sent, true);
        assert.ok(typed.some((t) => t.includes('send-keys') && t.includes('hello')));
    });
    await test('pane on sleep (claude exited): NOT_RUNNING, nothing typed', async () => {
        typed.length = 0; pane = { pid: claudeProc.pid, cmd: 'sleep' };
        await assert.rejects(launcher.steer(SID, 'hello'), (e) => e.code === 'NOT_RUNNING' && /It is not running: resume it first/.test(e.message));
        await assert.rejects(launcher.interrupt(SID), (e) => e.code === 'NOT_RUNNING');
        assert.deepStrictEqual(typed, []);
        pane = { pid: claudeProc.pid, cmd: 'claude' };
    });
    await test('record pid is now a sleep process (reused / wrapper): NOT_RUNNING, nothing typed', async () => {
        typed.length = 0;
        rec = Object.assign({}, rec, { pid: sleepProc.pid, procStart: '' });
        await assert.rejects(launcher.steer(SID, 'hello'), (e) => e.code === 'NOT_RUNNING');
        assert.deepStrictEqual(typed, []);
    });
    await test('record pid reused by another process (procStart differs): NOT_RUNNING, nothing typed', async () => {
        typed.length = 0;
        rec = Object.assign({}, rec, { pid: claudeProc.pid, procStart: '1' });
        await assert.rejects(launcher.steer(SID, 'hello'), (e) => e.code === 'NOT_RUNNING');
        assert.deepStrictEqual(typed, []);
    });
    await test('record pid gone: NOT_RUNNING', async () => {
        rec = Object.assign({}, rec, { pid: 2 ** 22 - 3, procStart: '' });
        await assert.rejects(launcher.steer(SID, 'hello'), (e) => e.code === 'NOT_RUNNING');
    });

    await test('claude_session_send: not running, no resume -> says so; nothing typed, never sent: true', async () => {
        typed.length = 0; pane = { pid: claudeProc.pid, cmd: 'sleep' };
        rec = { id: SID, pid: claudeProc.pid, procStart: startOf(claudeProc.pid), status: 'idle', cwd: SANDBOX, origin: 'fleet' };
        await assert.rejects(fleetMcp._test.dispatch({}, 'claude_session_send', { session: SID, text: 'hi' }), (e) => e.code === 'NOT_RUNNING' && /pass resume: true/.test(e.message));
        assert.deepStrictEqual(typed, []);
    });
    await test('claude_session_send: with resume -> resume called, then the text is sent', async () => {
        typed.length = 0; pane = { pid: claudeProc.pid, cmd: 'sleep' };
        const order = [];
        const rf = require('../modules/claudeRemoteFleet'); const us = require('../modules/claudeUsage');
        const realStatus = rf.status; const realRead = us.read;
        rf.status = async () => ({ accounts: [{ index: 1, id: 'acc1', name: 'A', active: true, moved: true, onHost: false, hasLogin: true, state: 'running', statusLine: '', message: '', settings: {}, sessions: [] }] });
        us.read = async () => ({ accounts: [] });
        const realResume = launcher.resume; const realSteer = launcher.steer;
        launcher.resume = async () => { order.push('resume'); pane = { pid: claudeProc.pid, cmd: 'claude' }; return { state: 'ready' }; };
        launcher.steer = async (id, text) => { order.push('steer'); return realSteer(id, text); };
        try {
            const r = await fleetMcp._test.dispatch({}, 'claude_session_send', { session: SID, text: 'hi', resume: true, account: 1 });
            assert.strictEqual(r.sent, true);
        } finally { launcher.resume = realResume; launcher.steer = realSteer; rf.status = realStatus; us.read = realRead; }
        assert.deepStrictEqual(order, ['steer', 'resume', 'steer']);
        assert.ok(typed.some((t) => t.includes('send-keys') && t.includes('hi')));
    });

    claudeProc.kill(); sleepProc.kill();
    console.log(failed ? `${failed} FAILED` : 'all passed');
    process.exit(failed ? 1 : 0);
})();
