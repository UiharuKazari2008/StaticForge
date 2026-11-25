'use strict';

// scripts/claude-ask-hook.js against a fake Supervisor socket, and claudeAccountRuntime.ensureAskHook's merge.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ask-hook-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* gone */ } });
const HOOK = path.join(__dirname, 'claude-ask-hook.js');
const input = { session_id: 's1', cwd: '/x', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which?', header: 'H', options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }], multiSelect: false }] } };

function runHook(sock, extra) {
    return new Promise((resolve) => {
        const p = spawn('node', [HOOK], { env: Object.assign({}, process.env, { AGENT_SUPERVISOR_SOCKET: sock }, extra || {}) });
        let out = '';
        p.stdout.on('data', (c) => { out += c; });
        p.on('close', (code) => resolve({ code, out }));
        p.stdin.end(JSON.stringify(input));
    });
}
function fake(file, reply) {
    return new Promise((resolve) => {
        const srv = net.createServer((s) => {
            let b = '';
            s.on('data', (c) => { b += c; if (b.includes('\n')) { srv.got = JSON.parse(b); if (reply) s.end(`${JSON.stringify(reply)}\n`); } });
        });
        srv.listen(file, () => resolve(srv));
    });
}

(async () => {
    // answer -> the PreToolUse result with the answers filled in
    let sock = path.join(tmp, 'a.sock');
    let srv = await fake(sock, { ok: true, answers: { 'Which?': 'B' } });
    let r = await runHook(sock);
    assert.strictEqual(r.code, 0);
    const o = JSON.parse(r.out);
    assert.strictEqual(o.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.strictEqual(o.hookSpecificOutput.permissionDecision, 'allow');
    assert.deepStrictEqual(o.hookSpecificOutput.updatedInput.answers, { 'Which?': 'B' });
    assert.deepStrictEqual(o.hookSpecificOutput.updatedInput.questions, input.tool_input.questions);
    assert.strictEqual(srv.got.op, 'ask_user');
    assert.strictEqual(srv.got.sessionId, 's1');
    srv.close();

    // server says timeout -> no output, exit 0
    sock = path.join(tmp, 'b.sock');
    srv = await fake(sock, { ok: true, timeout: true });
    r = await runHook(sock);
    assert.deepStrictEqual([r.code, r.out], [0, '']);
    srv.close();

    // nobody answers within the hook's wait -> no output, exit 0
    sock = path.join(tmp, 'c.sock');
    srv = await fake(sock, null);
    r = await runHook(sock, { DREAMSCAPE_ASK_HOOK_WAIT_MS: '300' });
    assert.deepStrictEqual([r.code, r.out], [0, '']);
    srv.close();

    // server down -> no output, exit 0
    r = await runHook(path.join(tmp, 'none.sock'));
    assert.deepStrictEqual([r.code, r.out], [0, '']);

    // not AskUserQuestion -> nothing
    const p = spawnSync('node', [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: {} }), env: Object.assign({}, process.env, { AGENT_SUPERVISOR_SOCKET: path.join(tmp, 'none.sock') }) });
    assert.deepStrictEqual([p.status, String(p.stdout)], [0, '']);

    // ensureAskHook: merges, keeps the rest, idempotent
    const rt = require('../modules/claudeAccountRuntime');
    const dir = path.join(tmp, 'cfg');
    fs.mkdirSync(dir);
    const file = path.join(dir, 'settings.json');
    const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] };
    fs.writeFileSync(file, JSON.stringify({ env: { A: '1' }, permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [other], Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] } }, null, 2));
    assert.strictEqual(await rt.ensureAskHook(dir), true);
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepStrictEqual(st.env, { A: '1' });
    assert.deepStrictEqual(st.permissions, { allow: ['Bash(ls)'] });
    assert.ok(st.hooks.Stop);
    assert.deepStrictEqual(st.hooks.PreToolUse[0], other);
    assert.strictEqual(st.hooks.PreToolUse.length, 2);
    assert.strictEqual(st.hooks.PreToolUse[1].matcher, 'AskUserQuestion');
    assert.strictEqual(st.hooks.PreToolUse[1].hooks[0].command, `node ${HOOK}`);
    assert.strictEqual(st.hooks.PreToolUse[1].hooks[0].timeout, 660);
    const text = fs.readFileSync(file, 'utf8');
    const mt = fs.statSync(file).mtimeMs;
    await new Promise((res) => setTimeout(res, 20));
    await rt.ensureAskHook(dir);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), text);
    assert.strictEqual(fs.statSync(file).mtimeMs, mt);
    // the switch
    process.env.DREAMSCAPE_CLAUDE_ASK_HOOK = '0';
    const dir2 = path.join(tmp, 'cfg2');
    assert.strictEqual(await rt.ensureAskHook(dir2), false);
    assert.ok(!fs.existsSync(dir2));
    console.log('claude ask hook: ok');
})().catch((e) => { console.error(e); process.exit(1); });
