#!/usr/bin/env node
'use strict';

// TokenRouter engine (#409): catalog, Anthropic <-> OpenAI translation, and the
// loopback bridge against a mock OpenAI upstream. No network, no Dreamscape.
//   node scripts/test-tokenrouter-bridge.js

const assert = require('assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenrouter-test-'));
// The Claude CLI stays findable after HOME moves to the scratch dir (Rentan default file).
process.env.PATH = [path.join(os.homedir(), '.npm-global', 'bin'), process.env.PATH].join(path.delimiter);
process.env.HOME = scratch;

const bridge = require('../modules/tokenRouterBridge');
// Mock upstreams: lift the account's 8-a-minute gate (modules/tokenRouterGate.js).
require('../modules/tokenRouterGate').configure({ limit: 1000 });
const t = bridge._test;

const PRICING = {
    group_ratio: { default: 1 },
    vendors: [{ id: 6, name: 'Moonshot' }, { id: 5, name: '智谱' }, { id: 4, name: 'Anthropic' }, { id: 9, name: '<b>bad</b>' }],
    data: [
        { model_name: 'z-ai/glm-5.3', vendor_id: 5, tags: 'Text', quota_type: 0, model_ratio: 0.28, completion_ratio: 3, supported_endpoint_types: ['openai'] },
        { model_name: 'moonshotai/kimi-k3', vendor_id: 6, tags: 'Text', quota_type: 0, model_ratio: 0.9, completion_ratio: 5, supported_endpoint_types: ['openai'] },
        { model_name: 'z-ai/glm-5.3-fast', vendor_id: 5, tags: 'Text', quota_type: 0, model_ratio: 0.7, completion_ratio: 3, supported_endpoint_types: ['openai', 'openai-response'] },
        { model_name: 'anthropic/claude-opus-5.5', vendor_id: 4, tags: 'Text', quota_type: 0, model_ratio: 2, completion_ratio: 5, supported_endpoint_types: ['anthropic'] },
        { model_name: 'google/gemini-3-pro-image-preview', vendor_id: 3, tags: 'Image', quota_type: 0, model_ratio: 1, completion_ratio: 1, supported_endpoint_types: ['image-generation'] },
        { model_name: 'evil/<script>', vendor_id: 6, tags: 'Text', quota_type: 0, model_ratio: 1, completion_ratio: 1, supported_endpoint_types: ['openai'] },
        { model_name: 'odd/vendor-model', vendor_id: 9, tags: 'Text', quota_type: 0, model_ratio: 1, completion_ratio: 1, supported_endpoint_types: ['openai'] },
        { model_name: 'per-call/model', vendor_id: 6, tags: 'Text', quota_type: 1, model_ratio: 0, completion_ratio: 1, supported_endpoint_types: ['openai'] }
    ]
};

function testCatalog() {
    const families = t.catalogFromPricing(PRICING);
    const ids = families.map((f) => f.id);
    assert.deepStrictEqual(ids, ['z-ai/glm-5.3', 'moonshotai/kimi-k3', 'odd/vendor-model']);
    const kimi = families.find((f) => f.id === 'moonshotai/kimi-k3');
    assert.strictEqual(kimi.name, 'Kimi K3');
    assert.strictEqual(kimi.provider, 'Moonshot');
    assert.strictEqual(kimi.input, 1.8);
    assert.strictEqual(kimi.output, 9);
    assert.strictEqual(kimi.fastId, null);
    const glm = families.find((f) => f.id === 'z-ai/glm-5.3');
    assert.strictEqual(glm.name, 'GLM 5.3');
    assert.strictEqual(glm.provider, 'Z.ai');
    assert.strictEqual(glm.fastId, 'z-ai/glm-5.3-fast');
    assert.strictEqual(families.find((f) => f.id === 'odd/vendor-model').provider, 'Other');

    const run = bridge.resolveRun(families, { model: 'z-ai/glm-5.3', effort: 'high', fast: true });
    assert.deepStrictEqual(run, { family: 'z-ai/glm-5.3', model: 'z-ai/glm-5.3-fast', effort: 'high', fast: true });
    assert.deepStrictEqual(bridge.resolveRun(families, { model: 'moonshotai/kimi-k3', fast: true, effort: 'xhigh' }),
        { family: 'moonshotai/kimi-k3', model: 'moonshotai/kimi-k3', effort: 'medium', fast: false });
    // default is DeepSeek V4.1 Flash; with it missing from the catalog the first family is used
    assert.strictEqual(bridge.resolveRun(families, { model: 'nope/unknown' }).model, families[0].id);
    assert.strictEqual(bridge.resolveRun([...families, { id: 'deepseek/deepseek-v4.1-flash', efforts: [] }], { model: '' }).family, 'deepseek/deepseek-v4.1-flash');
    assert.strictEqual(bridge.resolveRun([], { model: '' }).model, 'deepseek/deepseek-v4.1-flash');
    console.log('ok catalog + resolveRun');
}

function testRequest() {
    const body = {
        model: 'moonshotai/kimi-k3',
        max_tokens: 32000,
        system: [{ type: 'text', text: 'You are Wren.', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'Be brief.' }],
        tools: [
            { name: 'mcp__dreamscape__get_session_state', description: 'state', input_schema: { $schema: 'x', type: 'object', properties: { view: { type: 'string' } } } },
            { name: 'Read', description: 'read', input_schema: { type: 'object', properties: { file_path: { type: 'string' } } } },
            { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }
        ],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages: [
            { role: 'user', content: 'Look at the print.' },
            {
                role: 'assistant',
                content: [
                    { type: 'thinking', thinking: 'I should read it.', signature: bridge.THINKING_SIGNATURE },
                    { type: 'thinking', thinking: 'foreign', signature: 'anthropic-sig' },
                    { type: 'text', text: 'Reading.' },
                    { type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: '/workspace/a.png' } }
                ]
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'call_1',
                        content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]
                    },
                    { type: 'text', text: 'Well?' }
                ]
            }
        ]
    };
    const { request } = t.toOpenAIRequest(body, { model: 'moonshotai/kimi-k3', effort: 'high', stream: true });
    assert.strictEqual(request.model, 'moonshotai/kimi-k3');
    assert.strictEqual(request.reasoning_effort, 'high');
    assert.strictEqual(request.max_tokens, 32000);
    assert.deepStrictEqual(request.stream_options, { include_usage: true });
    assert.strictEqual(request.parallel_tool_calls, false);
    assert.strictEqual(request.tool_choice, 'auto');
    assert.strictEqual(request.tools.length, 2, 'server tools are dropped');
    assert.strictEqual(request.tools[0].function.name, 'mcp__dreamscape__get_session_state');
    assert.strictEqual(request.tools[0].function.parameters.$schema, undefined);
    const [system, user, assistant, tool, followUp] = request.messages;
    assert.deepStrictEqual(system, { role: 'system', content: 'You are Wren.\n\nBe brief.' });
    assert.deepStrictEqual(user, { role: 'user', content: 'Look at the print.' });
    assert.strictEqual(assistant.content, 'Reading.');
    assert.strictEqual(assistant.reasoning_content, 'I should read it.', 'only bridge thinking goes back');
    assert.deepStrictEqual(assistant.tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/workspace/a.png"}' } }]);
    assert.deepStrictEqual(tool, { role: 'tool', tool_call_id: 'call_1', content: '(image below)' });
    assert.strictEqual(followUp.role, 'user');
    assert.ok(Array.isArray(followUp.content));
    assert.deepStrictEqual(followUp.content.map((p) => p.type), ['text', 'text', 'image_url']);
    assert.strictEqual(followUp.content[2].image_url.url, 'data:image/png;base64,AAAA');
    assert.strictEqual(request.messages.length, 5);

    const relaxed = t.toOpenAIRequest(body, { noEffort: true, noImages: true, noReasoningContent: true, noMaxTokens: true }).request;
    assert.strictEqual(relaxed.reasoning_effort, undefined);
    assert.strictEqual(relaxed.max_tokens, undefined);
    assert.strictEqual(relaxed.messages[2].reasoning_content, undefined);
    assert.strictEqual(typeof relaxed.messages[4].content, 'string', 'no images leaves a text message');

    const long = 'mcp__dreamscape__' + 'x'.repeat(80);
    assert.ok(t.safeToolName(long).length <= 64);
    assert.strictEqual(t.safeToolName(long), t.safeToolName(long));
    console.log('ok request translation');
}

function testStream() {
    const names = { down: (n) => n };
    const tr = new t.StreamTranslator('moonshotai/kimi-k3', names);
    const events = [];
    const push = (list) => list.forEach(([name, data]) => events.push({ name, data }));
    push(tr.start());
    push(tr.chunk({ choices: [{ delta: { role: 'assistant', reasoning_content: 'Hmm, ' } }] }));
    push(tr.chunk({ choices: [{ delta: { reasoning_content: 'look first.' } }] }));
    push(tr.chunk({ choices: [{ delta: { content: 'Checking.' } }] }));
    push(tr.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'Read', arguments: '{"file_' } }] } }] }));
    push(tr.chunk({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_10', type: 'function', function: { name: 'Bash', arguments: '{}' } }] } }] }));
    push(tr.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'path":"/a"}' } }] } }] }));
    push(tr.chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
    push(tr.chunk({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1000 } } }));
    push(tr.finish());

    const names_ = events.map((e) => e.name);
    assert.strictEqual(names_[0], 'message_start');
    assert.strictEqual(names_[names_.length - 1], 'message_stop');
    const starts = events.filter((e) => e.name === 'content_block_start').map((e) => [e.data.index, e.data.content_block.type]);
    assert.deepStrictEqual(starts, [[0, 'thinking'], [1, 'text'], [2, 'tool_use'], [3, 'tool_use']]);
    const sig = events.find((e) => e.data.delta && e.data.delta.type === 'signature_delta');
    assert.strictEqual(sig.data.index, 0);
    assert.strictEqual(sig.data.delta.signature, bridge.THINKING_SIGNATURE);
    const json = events.filter((e) => e.data.delta && e.data.delta.type === 'input_json_delta').map((e) => JSON.parse(e.data.delta.partial_json));
    assert.deepStrictEqual(json, [{ file_path: '/a' }, {}]);
    const tools = events.filter((e) => e.name === 'content_block_start' && e.data.content_block.type === 'tool_use').map((e) => e.data.content_block);
    assert.deepStrictEqual(tools.map((b) => [b.id, b.name]), [['call_9', 'Read'], ['call_10', 'Bash']]);
    const delta = events.find((e) => e.name === 'message_delta').data;
    assert.strictEqual(delta.delta.stop_reason, 'tool_use');
    assert.deepStrictEqual(delta.usage, { input_tokens: 200, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 80 });
    // Every block that starts also stops, in order.
    const stops = events.filter((e) => e.name === 'content_block_stop').map((e) => e.data.index);
    assert.deepStrictEqual(stops, [0, 1, 2, 3]);

    const plain = new t.StreamTranslator('m', names);
    plain.chunk({ choices: [{ delta: { content: 'hi' }, finish_reason: 'length' }] });
    const end = plain.finish();
    assert.strictEqual(end.find(([n]) => n === 'message_delta')[1].delta.stop_reason, 'max_tokens');

    const message = t.toAnthropicMessage({
        choices: [{ message: { content: 'done', reasoning_content: 'why', tool_calls: [{ id: 'c', function: { name: 'Read', arguments: '{"a":1}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 }
    }, 'm', names);
    assert.deepStrictEqual(message.content.map((b) => b.type), ['thinking', 'text', 'tool_use']);
    assert.deepStrictEqual(message.content[2].input, { a: 1 });
    assert.strictEqual(message.stop_reason, 'tool_use');

    // MiniMax (TokenRouter) streams argument pieces, then repeats the full JSON.
    // Concatenating that last copy used to yield `{...}{...}` → `_unparsed_arguments`,
    // which the CLI fed back and nested.
    assert.deepStrictEqual(t.parseToolArguments('{"workspace":"lab"}'), { workspace: 'lab' });
    assert.deepStrictEqual(t.parseToolArguments('{"workspace":"lab"}{"workspace":"lab"}'), { workspace: 'lab' });
    assert.deepStrictEqual(t.parseToolArguments('{"a":1}{"a":2}'), { a: 2 }, 'final complete object wins');
    assert.deepStrictEqual(t.parseToolArguments('{"a":1}{broken'), { a: 1 }, 'first complete object if the tail is junk');
    assert.deepStrictEqual(t.parseToolArguments('not-json'), {}, 'never _unparsed_arguments');
    assert.ok(!('_unparsed_arguments' in t.parseToolArguments('{')), 'incomplete JSON is empty');
    const nested = { _unparsed_arguments: JSON.stringify({ _unparsed_arguments: '{"file_path":"/a"}{"file_path":"/a"}' }) };
    assert.deepStrictEqual(t.unwrapToolInput(nested), { file_path: '/a' });

    const minimax = new t.StreamTranslator('minimax/minimax-m3.1-flash', names);
    const miniEvents = [];
    const miniPush = (list) => list.forEach(([name, data]) => miniEvents.push({ name, data }));
    miniPush(minimax.start());
    miniPush(minimax.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_mm', type: 'function', function: { name: 'Read', arguments: '{"file_' } }] } }] }));
    miniPush(minimax.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'path":"/workspace/a.png"}' } }] } }] }));
    miniPush(minimax.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"file_path":"/workspace/a.png"}' } }] } }] }));
    miniPush(minimax.chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
    miniPush(minimax.finish());
    const miniJson = miniEvents.filter((e) => e.data.delta && e.data.delta.type === 'input_json_delta').map((e) => JSON.parse(e.data.delta.partial_json));
    assert.deepStrictEqual(miniJson, [{ file_path: '/workspace/a.png' }]);
    assert.ok(!JSON.stringify(miniJson).includes('_unparsed_arguments'));

    const frag = new t.StreamTranslator('minimax/minimax-m3.1-flash', names);
    const fragEvents = [];
    const fragPush = (list) => list.forEach(([name, data]) => fragEvents.push({ name, data }));
    fragPush(frag.start());
    fragPush(frag.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_f', type: 'function', function: { name: 'Read', arguments: '{"limit":' } }] } }] }));
    fragPush(frag.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '5' } }] } }] }));
    fragPush(frag.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ',"q":' } }] } }] }));
    fragPush(frag.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"abc"' } }] } }] }));
    fragPush(frag.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] } }] }));
    fragPush(frag.chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
    fragPush(frag.finish());
    const fragJson = fragEvents.filter((e) => e.data.delta && e.data.delta.type === 'input_json_delta').map((e) => JSON.parse(e.data.delta.partial_json));
    assert.deepStrictEqual(fragJson, [{ limit: 5, q: 'abc' }], 'scalar fragments that parse alone must not replace the buffer');

    const replayed = t.toOpenAIRequest({
        model: 'minimax/minimax-m3.1-flash',
        messages: [{
            role: 'assistant',
            content: [{
                type: 'tool_use',
                id: 'call_old',
                name: 'Read',
                input: { _unparsed_arguments: '{"file_path":"/a"}{"file_path":"/a"}' }
            }]
        }]
    }, { model: 'minimax/minimax-m3.1-flash' }).request;
    assert.deepStrictEqual(JSON.parse(replayed.messages[0].tool_calls[0].function.arguments), { file_path: '/a' });
    console.log('ok stream translation');
}

// ---- End to end: bridge <-> mock OpenAI upstream ----

function startUpstream(handler) {
    return new Promise((resolve) => {
        const seen = [];
        const server = http.createServer((req, res) => {
            let raw = '';
            req.on('data', (b) => { raw += b; });
            req.on('end', () => {
                const body = raw ? JSON.parse(raw) : null;
                seen.push({ url: req.url, auth: req.headers.authorization, body });
                handler(req, res, body, seen.length);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` }));
    });
}

function sse(res, chunks) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    chunks.forEach((c) => res.write(`data: ${JSON.stringify(c)}\n\n`));
    res.write('data: [DONE]\n\n');
    res.end();
}

function post(url, headers, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
            let raw = '';
            res.on('data', (b) => { raw += b; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw }));
        });
        req.on('error', reject);
        req.end(JSON.stringify(body));
    });
}

function parseSse(raw) {
    return raw.split('\n\n').filter(Boolean).map((block) => {
        const name = (block.match(/^event: (.+)$/m) || [])[1];
        const data = (block.match(/^data: (.+)$/m) || [])[1];
        return { name, data: data ? JSON.parse(data) : null };
    });
}

async function testBridge() {
    const upstream = await startUpstream((req, res, body, n) => {
        if (req.url !== '/v1/chat/completions') {
            res.writeHead(404);
            res.end();
            return;
        }
        if (body.model === 'refuses/effort' && body.reasoning_effort) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Unsupported parameter: reasoning_effort' } }));
            return;
        }
        if (body.model === 'broke/model') {
            // The gate (#418) waits Retry-After and tries again three times before passing the 429 on.
            res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
            res.end(JSON.stringify({ error: { message: 'slow down' } }));
            return;
        }
        if (!body.stream) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
            return;
        }
        sse(res, [
            { choices: [{ delta: { reasoning_content: 'thinking' } }] },
            { choices: [{ delta: { content: 'po' } }] },
            { choices: [{ delta: { content: 'ng' }, finish_reason: 'stop' }] },
            { choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } }
        ]);
    });
    process.env.TOKENROUTER_BASE_URL = upstream.url;
    process.env.TOKENROUTER_API_KEY = 'sk-test-upstream';
    const link = await bridge.ensureBridge();
    assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(link.url));
    assert.strictEqual(await bridge.ensureBridge(), await bridge.ensureBridge(), 'one bridge per process');

    const denied = await post(`${link.url}/v1/messages`, { authorization: 'Bearer wrong' }, { model: 'x', messages: [] });
    assert.strictEqual(denied.status, 401);
    assert.strictEqual(upstream.seen.length, 0, 'a bad secret never reaches TokenRouter');

    const auth = { authorization: `Bearer ${link.secret}`, 'x-dreamscape-effort': 'high' };
    const streamed = await post(`${link.url}/v1/messages`, auth, {
        model: 'moonshotai/kimi-k3', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'ping' }]
    });
    assert.strictEqual(streamed.status, 200);
    assert.ok(/text\/event-stream/.test(streamed.headers['content-type']));
    const events = parseSse(streamed.raw).filter((e) => e.name !== 'ping');
    const text = events.filter((e) => e.data && e.data.delta && e.data.delta.type === 'text_delta').map((e) => e.data.delta.text).join('');
    assert.strictEqual(text, 'pong');
    assert.strictEqual(events.find((e) => e.name === 'message_delta').data.delta.stop_reason, 'end_turn');
    assert.strictEqual(events[events.length - 1].name, 'message_stop');
    const sent = upstream.seen[upstream.seen.length - 1];
    assert.strictEqual(sent.auth, 'Bearer sk-test-upstream', 'the bridge adds the real key');
    assert.strictEqual(sent.body.reasoning_effort, 'high', 'effort header becomes reasoning_effort');

    const single = await post(`${link.url}/v1/messages`, { 'x-api-key': link.secret }, {
        model: 'moonshotai/kimi-k3', max_tokens: 10, messages: [{ role: 'user', content: 'ping' }]
    });
    assert.strictEqual(single.status, 200);
    const msg = JSON.parse(single.raw);
    assert.strictEqual(msg.content[0].text, 'pong');
    assert.strictEqual(msg.usage.input_tokens, 3);

    const before = upstream.seen.length;
    const relaxed = await post(`${link.url}/v1/messages`, auth, {
        model: 'refuses/effort', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'ping' }]
    });
    assert.strictEqual(relaxed.status, 200);
    assert.strictEqual(upstream.seen.length - before, 2, 'one refusal, one retry');
    assert.strictEqual(upstream.seen[upstream.seen.length - 1].body.reasoning_effort, undefined);
    const again = upstream.seen.length;
    await post(`${link.url}/v1/messages`, auth, { model: 'refuses/effort', stream: true, messages: [{ role: 'user', content: 'x' }] });
    assert.strictEqual(upstream.seen.length - again, 1, 'the refusal is remembered for that model');

    const beforeLimited = upstream.seen.length;
    const limited = await post(`${link.url}/v1/messages`, auth, { model: 'broke/model', stream: true, messages: [{ role: 'user', content: 'x' }] });
    assert.strictEqual(limited.status, 429);
    assert.strictEqual(upstream.seen.length - beforeLimited, 4, 'the gate retried the 429 three times first');
    const err = JSON.parse(limited.raw);
    assert.strictEqual(err.type, 'error');
    assert.strictEqual(err.error.type, 'rate_limit_error');
    assert.ok(/^TokenRouter 429: rate limit reached.*\(slow down\)$/.test(err.error.message), err.error.message);

    const counted = await post(`${link.url}/v1/messages/count_tokens`, auth, { messages: [{ role: 'user', content: 'x'.repeat(400) }] });
    assert.strictEqual(counted.status, 200);
    assert.ok(JSON.parse(counted.raw).input_tokens > 90);

    delete process.env.TOKENROUTER_API_KEY;
    const nokey = await post(`${link.url}/v1/messages`, auth, { model: 'moonshotai/kimi-k3', stream: true, messages: [{ role: 'user', content: 'x' }] });
    assert.strictEqual(nokey.status, 401);
    assert.ok(/Security Center/.test(JSON.parse(nokey.raw).error.message));

    bridge.closeBridge();
    upstream.server.close();
    console.log('ok bridge end to end');
}

async function testWallet() {
    let calls = 0;
    let reply = { success: true, message: '', data: { topUpBalance: 120.5, voucherEfficientAmount: 30.004, toppedUpSpent: 80.25, voucherSpent: 10 } };
    const upstream = await startUpstream((req, res) => {
        calls += 1;
        const ok = req.url === '/api/management/self/wallet' && req.headers.authorization === 'Bearer mgmt-test';
        res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
        res.end(JSON.stringify(ok ? reply : { success: false, message: 'management key is invalid' }));
    });
    process.env.TOKENROUTER_BASE_URL = upstream.url;
    delete process.env.TOKENROUTER_MANAGEMENT_KEY;
    t.resetWallet();
    assert.deepStrictEqual(await bridge.wallet(), { configured: false });
    assert.strictEqual(calls, 0, 'no management key, no call');

    process.env.TOKENROUTER_MANAGEMENT_KEY = 'mgmt-test';
    const first = await bridge.wallet();
    assert.strictEqual(first.remaining, 150.5, 'top-up plus vouchers is one value');
    assert.strictEqual(first.topUp, 120.5);
    assert.strictEqual(first.vouchers, 30.004);
    reply = { success: true, data: { topUpBalance: 1, voucherEfficientAmount: 1 } };
    assert.strictEqual((await bridge.wallet()).remaining, 150.5, 'cached for a minute');
    assert.strictEqual(calls, 1);

    process.env.TOKENROUTER_MANAGEMENT_KEY = 'wrong-key';
    const bad = await bridge.wallet();
    assert.ok(/management key is invalid/.test(bad.error));
    await bridge.wallet();
    assert.strictEqual(calls, 2, 'a failure is cached too (rate limit 10 a minute)');

    const director = require('../modules/cursorDirector');
    process.env.TOKENROUTER_MANAGEMENT_KEY = 'mgmt-test';
    t.resetWallet();
    reply = { success: true, data: { topUpBalance: 2.5, voucherEfficientAmount: 7.256 } };
    const summary = await director.tokenRouterUsageSummary(null);
    assert.strictEqual(summary.engine, 'tokenrouter');
    assert.strictEqual(summary.balanceText, '$9.76');
    assert.strictEqual(summary.limited, false);
    assert.strictEqual(summary.autoPercent, null);
    assert.ok(/TokenRouter balance: \$9\.76\nTop-up \$2\.50 \+ vouchers \$7\.26/.test(summary.title), summary.title);
    t.resetWallet();
    reply = { success: true, data: { topUpBalance: -0.4, voucherEfficientAmount: 0 } };
    const empty = await director.tokenRouterUsageSummary(null);
    assert.strictEqual(empty.balanceText, '-$0.40');
    assert.strictEqual(empty.limited, true);
    delete process.env.TOKENROUTER_MANAGEMENT_KEY;
    t.resetWallet();
    assert.ok(/add the management key to the TokenRouter key/.test((await director.tokenRouterUsageSummary(null)).title));
    upstream.server.close();
    console.log('ok wallet balance');
}

async function testDirectorWiring() {
    const director = require('../modules/cursorDirector');
    const d = director._test;
    assert.strictEqual(d.sanitizeEngine('tokenrouter'), 'tokenrouter');
    assert.strictEqual(d.usesClaudeCli('tokenrouter'), true);
    assert.strictEqual(d.usesClaudeCli('cursor'), false);
    const cliEnv = d.tokenRouterCliEnv(
        { url: 'http://127.0.0.1:4090', secret: 'bridge-secret' },
        { model: 'deepseek/deepseek-v4.1-flash', effort: 'low', lane: 'interactive' }
    );
    assert.strictEqual(cliEnv.ANTHROPIC_BASE_URL, 'http://127.0.0.1:4090');
    assert.strictEqual(cliEnv.ANTHROPIC_AUTH_TOKEN, 'bridge-secret');
    assert.strictEqual(cliEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek/deepseek-v4.1-flash');
    assert.strictEqual(cliEnv.ANTHROPIC_CUSTOM_HEADERS, 'x-dreamscape-lane: interactive\nx-dreamscape-effort: low');

    const catalog = d.publicTokenRouterCatalog(t.catalogFromPricing(PRICING));
    assert.deepStrictEqual(catalog.map((m) => m.provider), ['Moonshot', 'Z.ai', 'Other']);
    const kimi = catalog[0];
    assert.strictEqual(bridge.DEFAULT_MODEL, 'deepseek/deepseek-v4.1-flash');
    assert.strictEqual(kimi.default, false, 'Kimi is no longer the default');
    assert.strictEqual(kimi.cost, 2);
    assert.strictEqual(kimi.price, '$1.8 in, $9 out per million tokens');
    assert.deepStrictEqual(kimi.efforts.map((e) => [e.id, e.fast]), [['none', false], ['low', false], ['medium', false], ['high', false]]);
    assert.ok(catalog[1].efforts.every((e) => e.fast === true), 'GLM 5.3 has a fast sibling');

    assert.strictEqual(d.sanitizeRentanAgent({ engine: 'nope' }), null);
    assert.deepStrictEqual(d.sanitizeRentanAgent({ engine: 'tokenrouter', model: 'moonshotai/kimi-k3', effort: 'HIGH', fast: 'yes' }),
        { engine: 'tokenrouter', model: 'moonshotai/kimi-k3', effort: 'high', fast: false });
    assert.deepStrictEqual(d.rentanAgentFor({}), { engine: 'cursor', model: null, effort: 'medium', fast: false }, 'no default: Cursor at medium');
    d.saveRentanAgentDefault({ engine: 'claude', model: 'claude-opus-5-5', effort: 'low', fast: true });
    assert.ok(d.rentanAgentPath().startsWith(scratch));
    assert.strictEqual(d.rentanAgentFor({}).engine, 'claude', 'saved default applies');
    assert.strictEqual(d.rentanAgentFor({ agent: { engine: 'tokenrouter', model: 'moonshotai/kimi-k3' } }).engine, 'tokenrouter', 'Studio choice wins');
    assert.strictEqual(director.readRentanAgentDefault().model, 'claude-opus-5-5');
    assert.throws(() => d.saveRentanAgentDefault({ engine: '' }), /Pick an engine/);

    if (director.findClaude()) {
        // Same order as buildJail: --chdir, then --clearenv. --setenv before the clear is wiped.
        const jail = { bin: '/usr/bin/bwrap', args: ['--unshare-all', '--chdir', '/workspace', '--clearenv', '--setenv', 'PATH', '/usr/bin'], agent: '/opt/cursor-agent/x', root: '/' };
        const cjail = await d.tokenRouterJail(jail, { model: 'moonshotai/kimi-k3', effort: 'high' });
        const env = {};
        for (let i = 0; i < cjail.args.length; i++) {
            if (cjail.args[i] === '--setenv') env[cjail.args[i + 1]] = cjail.args[i + 2];
        }
        assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(env.ANTHROPIC_BASE_URL));
        assert.ok(env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_AUTH_TOKEN !== process.env.TOKENROUTER_API_KEY);
        assert.strictEqual(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'moonshotai/kimi-k3');
        assert.strictEqual(env.ANTHROPIC_CUSTOM_HEADERS, 'x-dreamscape-lane: interactive\nx-dreamscape-effort: high');
        const rentan = await d.tokenRouterJail(jail, { model: 'moonshotai/kimi-k3', effort: null, lane: 'normal' });
        const rentanHeaders = rentan.args[rentan.args.indexOf('ANTHROPIC_CUSTOM_HEADERS') + 1];
        assert.strictEqual(rentanHeaders, 'x-dreamscape-lane: normal', 'Rentan rides the normal lane');
        assert.strictEqual(cjail.oauth, false);
        assert.ok(!cjail.args.includes('/opt/claude-auth/token'), 'no OAuth token in a TokenRouter jail');
        const clearAt = cjail.args.indexOf('--clearenv');
        const baseAt = cjail.args.indexOf('ANTHROPIC_BASE_URL');
        assert.ok(clearAt >= 0 && baseAt > clearAt, 'bridge env is set after --clearenv');
        assert.ok(cjail.args.indexOf('--ro-bind') < cjail.args.indexOf('--chdir'));
        bridge.closeBridge();
        console.log('ok director wiring (with jail env)');
    } else {
        console.log('ok director wiring (claude CLI not installed, jail env skipped)');
    }
}

(async () => {
    try {
        testCatalog();
        testRequest();
        testStream();
        await testBridge();
        await testWallet();
        await testDirectorWiring();
        console.log('All TokenRouter bridge tests passed');
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
