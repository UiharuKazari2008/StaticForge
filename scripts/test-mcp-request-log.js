const assert = require('assert');
const { EventEmitter } = require('events');
const mcpRequestLog = require('../modules/mcpRequestLog');

assert.strictEqual(mcpRequestLog.redactMcpPath('/abc-uuid-1234/mcp', 'abc-uuid-1234'), '/{mcp}/mcp');
assert.strictEqual(mcpRequestLog.redactMcpPath('/abc-uuid-1234', 'abc-uuid-1234'), '/{mcp}');
assert.strictEqual(mcpRequestLog.redactMcpPath('/other', 'abc-uuid-1234'), '/{mcp}');
assert.ok(mcpRequestLog.isMcpRpcPath('/abc-uuid-1234/mcp', 'abc-uuid-1234'));
assert.ok(mcpRequestLog.isMcpRpcPath('/abc-uuid-1234', 'abc-uuid-1234'));
assert.ok(!mcpRequestLog.isMcpRpcPath('/abc-uuid-1234/oauth/token', 'abc-uuid-1234'));
assert.ok(!mcpRequestLog.isMcpRpcPath('/abc-uuid-1234/artifacts/deadbeef', 'abc-uuid-1234'));

assert.strictEqual(mcpRequestLog.sanitizeMcpLogToken('tools/call'), 'tools/call');
assert.strictEqual(mcpRequestLog.sanitizeMcpLogToken('generate_image'), 'generate_image');
assert.strictEqual(
    mcpRequestLog.sanitizeMcpLogToken('tools/call\n📋 forged'),
    'tools/callforged'
);
assert.ok(!String(mcpRequestLog.sanitizeMcpLogToken('tools/call\nnext-line')).includes('\n'));
assert.strictEqual(mcpRequestLog.sanitizeMcpLogToken('a'.repeat(80)).length, mcpRequestLog.MCP_LOG_TOKEN_MAX);
assert.strictEqual(mcpRequestLog.sanitizeMcpLogToken('   '), null);

const peeked = mcpRequestLog.peekMcpRpc({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'generate_image', arguments: { prompt: 'SECRET_PROMPT', token: 'SECRET_TOKEN' } }
});
assert.strictEqual(peeked.rpcMethod, 'tools/call');
assert.strictEqual(peeked.tool, 'generate_image');
assert.strictEqual(peeked.batch, null);

const dirtyPeek = mcpRequestLog.peekMcpRpc({
    method: 'tools/call\n📋 [09/25 10:22:14] MCP forged',
    params: { name: 'generate_image\nSECRET' }
});
assert.strictEqual(dirtyPeek.rpcMethod, 'tools/call09/2510:22:14MCPforged');
assert.strictEqual(dirtyPeek.tool, null);
assert.ok(!dirtyPeek.rpcMethod.includes('\n'));

const dirtyTool = mcpRequestLog.peekMcpRpc({
    method: 'tools/call',
    params: { name: 'generate_image\nSECRET' }
});
assert.strictEqual(dirtyTool.rpcMethod, 'tools/call');
assert.strictEqual(dirtyTool.tool, 'generate_imageSECRET');
assert.ok(!dirtyTool.tool.includes('\n'));

const batch = mcpRequestLog.peekMcpRpc([
    { method: 'tools/call', params: { name: 'ping_tool' } },
    { method: 'ping' }
]);
assert.strictEqual(batch.rpcMethod, 'tools/call');
assert.strictEqual(batch.batch, 2);

assert.strictEqual(mcpRequestLog.inferMcpOutcome(200, { result: { isError: false } }), 'ok');
assert.strictEqual(mcpRequestLog.inferMcpOutcome(200, { result: { isError: true } }), 'error');
assert.strictEqual(mcpRequestLog.inferMcpOutcome(500, { error: { message: 'nope' } }), 'error');
assert.strictEqual(mcpRequestLog.inferMcpOutcome(401, null), 'error');

assert.strictEqual(
    mcpRequestLog.peekSseRpcOutcome('event: message\ndata: {"jsonrpc":"2.0","error":{"code":-32603}}\n\n'),
    'error'
);
assert.strictEqual(
    mcpRequestLog.peekSseRpcOutcome('event: message\ndata: {"jsonrpc":"2.0","result":{"isError":true}}\n\n'),
    'error'
);
assert.strictEqual(
    mcpRequestLog.peekSseRpcOutcome('event: message\ndata: {"jsonrpc":"2.0","result":{}}\n\n'),
    'ok'
);
assert.strictEqual(mcpRequestLog.peekSseRpcOutcome(Buffer.from('data: {"error":true}')), null);

const okLine = mcpRequestLog.formatMcpCallLine({
    timestamp: '09/25 10:22:14',
    ip: '203.0.113.10',
    httpMethod: 'POST',
    path: '/{mcp}/mcp',
    rpcMethod: 'tools/call',
    tool: 'generate_image',
    actor: 'guren/appkey:key-1',
    status: 200,
    outcome: 'ok',
    durationMs: 6123
});
assert.strictEqual(
    okLine,
    '📋 [09/25 10:22:14] MCP 203.0.113.10 POST /{mcp}/mcp tools/call generate_image actor=guren/appkey:key-1 status=200 ok 6123ms'
);

const forgedLine = mcpRequestLog.formatMcpCallLine({
    timestamp: '09/25 10:22:14',
    ip: '203.0.113.10',
    httpMethod: 'POST',
    path: '/{mcp}/mcp',
    rpcMethod: 'tools/call\n📋 [09/25 10:22:14] MCP 1.2.3.4 POST /{mcp}/mcp forged',
    tool: 'generate_image\nextra',
    status: 200,
    outcome: 'ok',
    durationMs: 1
});
assert.ok(!forgedLine.includes('\n'));
assert.strictEqual(forgedLine.split('\n').length, 1);
assert.ok(forgedLine.includes('tools/call'));

const errLine = mcpRequestLog.formatMcpCallLine({
    timestamp: '09/25 10:22:15',
    ip: '203.0.113.10',
    httpMethod: 'POST',
    path: '/{mcp}/mcp',
    rpcMethod: 'tools/call',
    tool: 'get_session_state',
    actor: 'guren/appkey:key-1',
    status: 200,
    outcome: 'error',
    durationMs: 45
});
assert.ok(errLine.includes('status=200 error 45ms'));
assert.ok(!errLine.includes('SECRET'));

const abortLine = mcpRequestLog.formatMcpCallLine({
    timestamp: '09/25 10:22:16',
    ip: '203.0.113.10',
    httpMethod: 'POST',
    path: '/{mcp}/mcp',
    rpcMethod: 'tools/call',
    tool: 'generate_image',
    actor: 'guren/appkey:key-1',
    status: 200,
    outcome: 'abort',
    durationMs: 180012
});
assert.ok(abortLine.includes('status=200 abort 180012ms'));

assert.strictEqual(
    mcpRequestLog.peekMcpActor({ applicationAuth: { applicationKeyId: 'key-1', appName: 'guren' } }),
    'guren/appkey:key-1'
);
assert.strictEqual(
    mcpRequestLog.peekMcpActor({ applicationAuth: { applicationKeyId: 'key-2' } }),
    'appkey:key-2'
);
assert.strictEqual(
    mcpRequestLog.peekMcpActor({ applicationAuth: { sessionId: 'browser-session-abc' }, sessionId: 'browser-session-abc' }),
    null
);
assert.strictEqual(
    mcpRequestLog.peekMcpActor({ authMethod: 'dev_login_key', sessionId: 'sess-1' }),
    null
);
assert.ok(!String(mcpRequestLog.peekMcpActor({
    applicationAuth: { applicationKeyId: 'key-1', appName: 'guren\nforged', sessionId: 'browser-session-abc' }
})).includes('browser-session'));
assert.ok(!String(mcpRequestLog.peekMcpActor({
    applicationAuth: { applicationKeyId: 'key-1', appName: 'guren\nforged' }
})).includes('\n'));

assert.strictEqual(mcpRequestLog.shouldSkipMcpCallLog({ method: 'GET', body: { method: 'tools/call' } }), true);
assert.strictEqual(mcpRequestLog.shouldSkipMcpCallLog({
    method: 'POST',
    body: { method: 'notifications/initialized' }
}), true);
assert.strictEqual(mcpRequestLog.shouldSkipMcpCallLog({
    method: 'POST',
    body: { method: 'tools/call', params: { name: 'ping' } }
}), false);
assert.ok(mcpRequestLog.LAG_SAMPLE_MS > 0);
assert.strictEqual(mcpRequestLog.sampleEventLoopLag(), null);

function mockRes() {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.json = function json(body) {
        res._json = body;
        return res;
    };
    res.write = function write(chunk) {
        res._chunks = (res._chunks || []).concat([chunk]);
        return true;
    };
    return res;
}

const captured = [];
const origLog = console.log;
console.log = (...args) => {
    captured.push(args.join(' '));
};

try {
    const req = {
        method: 'POST',
        path: '/abc-uuid-1234/mcp',
        body: {
            method: 'tools/call',
            params: { name: 'generate_image', arguments: { prompt: 'SECRET_PROMPT' } }
        },
        headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
        applicationAuth: { applicationKeyId: 'key-1', appName: 'guren' }
    };
    const res = mockRes();
    assert.strictEqual(mcpRequestLog.attachMcpRequestLog(req, res, { uuid: 'abc-uuid-1234' }), true);
    res.json({ jsonrpc: '2.0', result: { isError: false } });
    res.emit('finish');
    assert.strictEqual(captured.length, 1);
    assert.ok(captured[0].includes('tools/call generate_image'));
    assert.ok(captured[0].includes('actor=guren/appkey:key-1'));
    assert.ok(captured[0].includes('203.0.113.10'));
    assert.ok(captured[0].includes('status=200 ok'));
    assert.ok(!captured[0].includes('SECRET_PROMPT'));
    assert.ok(!captured[0].includes('abc-uuid-1234'));
    assert.ok(!captured[0].includes('event-loop lag'));

    const abortReq = {
        method: 'POST',
        path: '/abc-uuid-1234/mcp',
        body: { method: 'tools/call', params: { name: 'generate_image' } },
        headers: { 'x-real-ip': '198.51.100.9' },
        applicationAuth: { applicationKeyId: 'key-2', appName: 'ivory' }
    };
    const abortRes = mockRes();
    mcpRequestLog.attachMcpRequestLog(abortReq, abortRes, { uuid: 'abc-uuid-1234' });
    abortRes.emit('close');
    assert.strictEqual(captured.length, 2);
    assert.ok(captured[1].includes('abort'));
    assert.ok(captured[1].includes('198.51.100.9'));
    assert.ok(captured[1].includes('actor=ivory/appkey:key-2'));
    assert.ok(!captured[1].includes('abc-uuid-1234'));

    const sessionReq = {
        method: 'POST',
        path: '/abc-uuid-1234/mcp',
        body: { method: 'ping' },
        headers: { 'x-real-ip': '198.51.100.8' },
        applicationAuth: { sessionId: 'browser-session-abc' },
        sessionId: 'browser-session-abc'
    };
    const sessionRes = mockRes();
    mcpRequestLog.attachMcpRequestLog(sessionReq, sessionRes, { uuid: 'abc-uuid-1234' });
    sessionRes.json({ jsonrpc: '2.0', result: {} });
    sessionRes.emit('finish');
    assert.strictEqual(captured.length, 3);
    assert.ok(!captured[2].includes('browser-session'));
    assert.ok(!captured[2].includes('actor='));

    const getReq = {
        method: 'GET',
        path: '/abc-uuid-1234/mcp',
        headers: { 'x-real-ip': '203.0.113.9' }
    };
    const getRes = mockRes();
    getRes.statusCode = 405;
    assert.strictEqual(mcpRequestLog.attachMcpRequestLog(getReq, getRes, { uuid: 'abc-uuid-1234' }), false);
    getRes.emit('finish');
    assert.strictEqual(captured.length, 3);

    const notifyReq = {
        method: 'POST',
        path: '/abc-uuid-1234/mcp',
        body: { jsonrpc: '2.0', method: 'notifications/initialized' },
        headers: { 'x-real-ip': '203.0.113.8' },
        applicationAuth: { applicationKeyId: 'key-1', appName: 'guren' }
    };
    const notifyRes = mockRes();
    assert.strictEqual(mcpRequestLog.attachMcpRequestLog(notifyReq, notifyRes, { uuid: 'abc-uuid-1234' }), false);
    notifyRes.emit('finish');
    assert.strictEqual(captured.length, 3);

    const sseReq = {
        method: 'POST',
        path: '/abc-uuid-1234/mcp',
        body: { method: 'tools/call', params: { name: 'get_session_state' } },
        headers: { 'x-real-ip': '203.0.113.7', accept: 'text/event-stream' },
        applicationAuth: { applicationKeyId: 'key-1', appName: 'guren' }
    };
    const sseRes = mockRes();
    assert.strictEqual(mcpRequestLog.attachMcpRequestLog(sseReq, sseRes, { uuid: 'abc-uuid-1234' }), true);
    sseRes.write('event: message\ndata: {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error"}}\n\n');
    sseRes.emit('finish');
    assert.strictEqual(captured.length, 4);
    assert.ok(captured[3].includes('status=200 error'));
    assert.ok(captured[3].includes('get_session_state'));

    const prev = process.env.MCP_REQUEST_LOG;
    process.env.MCP_REQUEST_LOG = '0';
    assert.strictEqual(mcpRequestLog.isMcpRequestLogEnabled(), false);
    assert.strictEqual(mcpRequestLog.attachMcpRequestLog({ path: '/x' }, mockRes(), {}), false);
    if (prev == null) delete process.env.MCP_REQUEST_LOG;
    else process.env.MCP_REQUEST_LOG = prev;
    assert.strictEqual(mcpRequestLog.isMcpRequestLogEnabled(), true);
} finally {
    console.log = origLog;
}

console.log('test-mcp-request-log: ok');
