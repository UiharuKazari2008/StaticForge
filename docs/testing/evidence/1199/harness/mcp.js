'use strict';
// usage: node mcp.js <fleet|item|compare|fleet-noheader> <method> [toolName] [argsJson]
// An MCP HTTP call to the replica as Claude Code makes it. fleet / item: the session's config from sessions.json,
// its headersHelper run, the JSON it prints used as request headers, against the config's url. compare: the
// comparison key, no X-Fleet-Session. fleet-noheader: the Fleet key, no header. Prints the HTTP status and the
// body cut to $MAX characters (default 600). Never prints a request header.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const ACC = __dirname;
const UA = 'claude-code/2.1.332 (sdk-cli)';

function loadSessions() { return JSON.parse(fs.readFileSync(path.join(ACC, 'sessions.json'), 'utf8')); }

function target(kind) {
    const s = loadSessions();
    if (kind === 'fleet' || kind === 'item') {
        const cfg = JSON.parse(fs.readFileSync(s[kind].config, 'utf8')).mcpServers.dreamscape;
        // what Claude Code does: run headersHelper, use its stdout JSON as the request headers
        const out = execSync(cfg.headersHelper, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
        return { url: cfg.url, headers: JSON.parse(out) };
    }
    const cfg = JSON.parse(fs.readFileSync(s.fleet.config, 'utf8')).mcpServers.dreamscape; // only for the url
    if (kind === 'compare') {
        const key = fs.readFileSync(path.join(ACC, 'state', 'compare', 'claude-code.key'), 'utf8').trim();
        return { url: cfg.url, headers: { Authorization: `Bearer ${key}` } };
    }
    if (kind === 'fleet-noheader') {
        const key = fs.readFileSync(path.join(ACC, 'state', 'fleet-mcp', 'fleet.key'), 'utf8').trim();
        return { url: cfg.url, headers: { Authorization: `Bearer ${key}` } };
    }
    throw new Error('kind is fleet, item, compare or fleet-noheader');
}

function post(url, headers, payload) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const body = JSON.stringify(payload);
        const h = Object.assign({
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'user-agent': UA,
            'content-length': Buffer.byteLength(body)
        }, headers);
        const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: h }, (res) => {
            let d = '';
            res.on('data', (c) => { d += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: d, ctype: res.headers['content-type'] || '' }));
        });
        req.on('error', reject);
        req.setTimeout(60000, () => req.destroy(new Error('timeout')));
        req.end(body);
    });
}

// the JSON-RPC message in a plain or event-stream body
function rpcOf(res) {
    const text = res.body || '';
    try { return JSON.parse(text); } catch (_) { /* event stream? */ }
    for (const line of text.split('\n')) {
        if (line.startsWith('data:')) { try { return JSON.parse(line.slice(5).trim()); } catch (_) { /* next */ } }
    }
    return null;
}

/** One call: initialize first (as a client does), then the method. Answers { status, body, rpc }. */
async function call(kind, method, tool, args) {
    const t = target(kind);
    const init = await post(t.url, t.headers, {
        jsonrpc: '2.0', id: 0, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.332' } }
    });
    if (init.status >= 400) return Object.assign({}, init, { rpc: rpcOf(init), stage: 'initialize' });
    if (method === 'initialize') return Object.assign({}, init, { rpc: rpcOf(init) });
    await post(t.url, t.headers, { jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => null);
    const params = method === 'tools/call' ? { name: tool, arguments: args || {} } : {};
    const res = await post(t.url, t.headers, { jsonrpc: '2.0', id: 1, method, params });
    return Object.assign({}, res, { rpc: rpcOf(res) });
}

module.exports = { call, rpcOf, target };

if (require.main === module) {
    const [kind, method, tool, argsJson] = process.argv.slice(2);
    if (!kind || !method) { console.error('usage: node mcp.js <fleet|item|compare|fleet-noheader> <method> [toolName] [argsJson]'); process.exit(2); }
    call(kind, method, tool, argsJson ? JSON.parse(argsJson) : {}).then((r) => {
        console.log('status', r.status);
        console.log(String(r.body).slice(0, Number(process.env.MAX) || 600));
    }).catch((e) => { console.log('error', e.message); process.exit(1); });
}
