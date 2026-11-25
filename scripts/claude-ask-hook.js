#!/usr/bin/env node
'use strict';

/**
 * Claude Code PreToolUse hook for AskUserQuestion (registered per account by claudeAccountRuntime.ensureAskHook).
 * The question never reached Yukimi (she works from Fleet and the phone, not the terminal), so the session stalled:
 * the hook hands the questions to Dreamscape over the Supervisor's unix socket (op ask_user), which shows them as a
 * request form on every client; the answers come back as the tool's `answers`, so the tool runs without a prompt.
 * Server down, no answer within 10 minutes, or a cancelled form: no output and exit 0, the normal prompt takes over.
 * Overrides (tests): AGENT_SUPERVISOR_SOCKET, DREAMSCAPE_ASK_HOOK_WAIT_MS.
 */

const net = require('net');
const os = require('os');
const path = require('path');

const WAIT_MS = Number(process.env.DREAMSCAPE_ASK_HOOK_WAIT_MS) || 10 * 60 * 1000;

function socketPath() {
    if (process.env.AGENT_SUPERVISOR_SOCKET) return process.env.AGENT_SUPERVISOR_SOCKET;
    try {
        const store = require(path.join(__dirname, '..', 'modules', 'agentCoord', 'store'));
        return path.join(path.dirname(store.dbPath()), 'supervisor.sock');
    } catch (_) { return path.join(os.homedir(), '.agent-coord', 'supervisor.sock'); }
}

function ask(file, req, waitMs) {
    return new Promise((resolve) => {
        let done = false;
        let buf = '';
        const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (_) { /* gone */ } resolve(v); };
        const timer = setTimeout(() => finish(null), waitMs);
        const sock = net.createConnection(file, () => sock.write(`${JSON.stringify(req)}\n`));
        sock.setEncoding('utf8');
        sock.on('data', (c) => { buf += c; });
        sock.on('end', () => { try { finish(JSON.parse(buf.trim())); } catch (_) { finish(null); } });
        sock.on('error', () => finish(null));
    });
}

/** The hook's stdout for one hook input and the server's reply, or '' when the normal prompt should run. */
function resultFor(input, reply) {
    if (!reply || reply.ok !== true || !reply.answers || typeof reply.answers !== 'object') return '';
    const ti = input.tool_input || {};
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: Object.assign({}, ti, { questions: ti.questions, answers: reply.answers }) } });
}

async function main() {
    let raw = '';
    process.stdin.setEncoding('utf8');
    for await (const c of process.stdin) raw += c;
    let input = null;
    try { input = JSON.parse(raw); } catch (_) { return; }
    if (!input || input.tool_name !== 'AskUserQuestion' || !input.tool_input || !Array.isArray(input.tool_input.questions)) return;
    const reply = await ask(socketPath(), { op: 'ask_user', sessionId: input.session_id, cwd: input.cwd, configDir: process.env.CLAUDE_CONFIG_DIR || null, questions: input.tool_input.questions }, WAIT_MS);
    const out = resultFor(input, reply);
    if (out) process.stdout.write(`${out}\n`);
}

if (require.main === module) main().then(() => process.exit(0), () => process.exit(0));
module.exports = { ask, resultFor, socketPath };
