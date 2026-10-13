#!/usr/bin/env node
'use strict';

// TokenRouter engine (#409): the real Claude Code CLI through the loopback bridge
// against a scripted OpenAI upstream. One tool round trip (Read), then the answer.
// Throwaway HOME, no network, no Dreamscape. Skips when the CLI is not installed.
//   node scripts/test-tokenrouter-claude-cli.js

const assert = require('assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const realHome = os.homedir();
const claudeBin = [path.join(realHome, '.npm-global', 'bin', 'claude'), path.join(realHome, '.local', 'bin', 'claude'), '/usr/local/bin/claude']
    .find((file) => fs.existsSync(file));
if (!claudeBin) {
    console.log('skip: Claude Code CLI not installed');
    process.exit(0);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenrouter-cli-'));
const home = path.join(scratch, 'home');
const workspace = path.join(scratch, 'workspace');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
const notePath = path.join(workspace, 'note.txt');
fs.writeFileSync(notePath, 'the-secret-word\n');

const bridge = require('../modules/tokenRouterBridge');
// Mock upstreams: lift the account's 8-a-minute gate (modules/tokenRouterGate.js).
require('../modules/tokenRouterGate').configure({ limit: 1000 });

function sse(res, chunks) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    chunks.forEach((c) => res.write(`data: ${JSON.stringify(c)}\n\n`));
    res.write('data: [DONE]\n\n');
    res.end();
}

function startUpstream() {
    const seen = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (b) => { raw += b; });
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : {};
            seen.push(body);
            const messages = body.messages || [];
            const toolMsg = messages.find((m) => m.role === 'tool');
            const hasReadTool = (body.tools || []).some((tool) => tool.function && tool.function.name === 'Read');
            const reply = (chunks) => (body.stream ? sse(res, chunks) : (() => {
                res.writeHead(200, { 'content-type': 'application/json' });
                const text = chunks.map((c) => (c.choices && c.choices[0] && c.choices[0].delta && c.choices[0].delta.content) || '').join('');
                res.end(JSON.stringify({ choices: [{ message: { content: text || 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1 } }));
            })());
            if (!hasReadTool) {
                reply([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
            } else if (!toolMsg) {
                reply([
                    { choices: [{ delta: { reasoning_content: 'I should read the note first.' } }] },
                    { choices: [{ delta: { content: 'Let me read it.' } }] },
                    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_read_1', type: 'function', function: { name: 'Read', arguments: '' } }] } }] },
                    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: notePath }) } }] } }] },
                    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
                    { choices: [], usage: { prompt_tokens: 900, completion_tokens: 30 } }
                ]);
            } else {
                reply([
                    { choices: [{ delta: { content: 'The note says ' } }] },
                    { choices: [{ delta: { content: 'the-secret-word.' }, finish_reason: 'stop' }] },
                    { choices: [], usage: { prompt_tokens: 950, completion_tokens: 8 } }
                ]);
            }
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

function runCli(link, model) {
    return new Promise((resolve, reject) => {
        const args = [
            '-p',
            '--output-format', 'stream-json',
            '--verbose',
            '--permission-mode', 'bypassPermissions',
            '--strict-mcp-config',
            '--mcp-config', JSON.stringify({ mcpServers: {} }),
            '--model', model,
            '--session-id', crypto.randomUUID(),
            '--', 'Read note.txt and tell me what it says.'
        ];
        const child = spawn(claudeBin, args, {
            cwd: workspace,
            env: {
                PATH: process.env.PATH,
                HOME: home,
                ANTHROPIC_BASE_URL: link.url,
                ANTHROPIC_AUTH_TOKEN: link.secret,
                ANTHROPIC_DEFAULT_OPUS_MODEL: model,
                ANTHROPIC_DEFAULT_SONNET_MODEL: model,
                ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
                ANTHROPIC_SMALL_FAST_MODEL: model,
                CLAUDE_CODE_SUBAGENT_MODEL: model,
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
                // Same shape as tokenRouterJail: lane first, effort second (newline-separated).
                ANTHROPIC_CUSTOM_HEADERS: 'x-dreamscape-lane: normal\nx-dreamscape-effort: high'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let out = '';
        let err = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
        child.stdout.on('data', (b) => { out += b; });
        child.stderr.on('data', (b) => { err += b; });
        child.on('error', reject);
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code, out, err });
        });
    });
}

(async () => {
    const upstream = await startUpstream();
    process.env.TOKENROUTER_BASE_URL = upstream.url;
    process.env.TOKENROUTER_API_KEY = 'sk-test-upstream';
    const link = await bridge.ensureBridge();
    const model = 'moonshotai/kimi-k3';
    const result = await runCli(link, model);
    const events = result.out.split('\n').filter((line) => line.trim()).map((line) => {
        try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
    const final = events.find((evt) => evt.type === 'result');
    if (!final || final.is_error) {
        console.error('stderr:', result.err.slice(-2000));
        console.error('stdout tail:', result.out.slice(-3000));
    }
    assert.ok(final, 'the CLI printed a result');
    assert.strictEqual(final.is_error, false, `the turn failed: ${final && final.result}`);
    assert.ok(/the-secret-word/.test(final.result), `answer: ${final.result}`);

    const toolUses = events.filter((evt) => evt.type === 'assistant')
        .flatMap((evt) => (evt.message && evt.message.content) || [])
        .filter((block) => block.type === 'tool_use');
    assert.ok(toolUses.some((block) => block.name === 'Read'), 'the CLI ran Read');
    const toolResults = events.filter((evt) => evt.type === 'user')
        .flatMap((evt) => (evt.message && evt.message.content) || [])
        .filter((block) => block.type === 'tool_result');
    assert.ok(toolResults.length >= 1, 'the tool result came back to the CLI');

    const main = upstream.seen.filter((body) => (body.tools || []).length);
    assert.ok(main.length >= 2, `two model calls with tools, saw ${main.length}`);
    main.forEach((body) => assert.strictEqual(body.model, model, 'every call stays on the picked model'));
    assert.ok(main.every((body) => body.reasoning_effort === 'high'), 'effort header reached TokenRouter as reasoning_effort');
    const second = main[main.length - 1];
    const toolMsg = second.messages.find((m) => m.role === 'tool');
    assert.ok(toolMsg && /the-secret-word/.test(toolMsg.content), 'the file text went back as a tool message');
    const assistantTurn = second.messages.find((m) => m.role === 'assistant' && m.tool_calls);
    assert.ok(assistantTurn, 'the tool call went back on the assistant message');
    assert.strictEqual(assistantTurn.reasoning_content, 'I should read the note first.', 'thinking went back as reasoning_content');
    const others = upstream.seen.filter((body) => body.model !== model);
    assert.strictEqual(others.length, 0, `no call left the picked model: ${others.map((b) => b.model).join(', ')}`);

    console.log(`ok Claude CLI ${path.basename(claudeBin)} ran a Read round trip through the bridge (${upstream.seen.length} upstream calls)`);
    bridge.closeBridge();
    upstream.server.close();
    fs.rmSync(scratch, { recursive: true, force: true });
    process.exit(0);
})().catch((error) => {
    console.error(error);
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (_) { /* gone */ }
    process.exit(1);
});
