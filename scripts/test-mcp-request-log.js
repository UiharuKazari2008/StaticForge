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

const peeked = mcpRequestLog.peekMcpRpc({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'generate_image', arguments: { prompt: 'SECRET_PROMPT', token: 'SECRET_TOKEN' } }
});
assert.strictEqual(peeked.rpcMethod, 'tools/call');
assert.strictEqual(peeked.tool, 'generate_image');
assert.strictEqual(peeked.batch, null);

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

const errLine = mcpRequestLog.formatMcpCallLine({
    timestamp: '09/25 10:22:15',
    ip: '203.0.113.10',
    httpMethod: 'POST',
    path: '/{mcp}/mcp',
    rpcMethod: 'tools/call',
    tool: 'get_session_state',
    actor: 'appkey:key-1',
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
    actor: 'appkey:key-1',
    status: 200,
    outcome: 'abort',
    durationMs: 180012
});
assert.ok(abortLine.includes('status=200 abort 180012ms'));

function mockRes() {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.json = function json(body) {
        res._json = body;
        return res;
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

    const abortReq = {
        method: 'POST',
        path: '/abc-uuid-1234/mcp',
        body: { method: 'tools/call', params: { name: 'generate_image' } },
        headers: { 'x-real-ip': '198.51.100.9' },
        applicationAuth: { applicationKeyId: 'key-2' }
    };
    const abortRes = mockRes();
    mcpRequestLog.attachMcpRequestLog(abortReq, abortRes, { uuid: 'abc-uuid-1234' });
    abortRes.emit('close');
    assert.strictEqual(captured.length, 2);
    assert.ok(captured[1].includes('abort'));
    assert.ok(captured[1].includes('198.51.100.9'));
    assert.ok(!captured[1].includes('abc-uuid-1234'));

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
