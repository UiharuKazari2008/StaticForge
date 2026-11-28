#!/usr/bin/env node
'use strict';

// headersHelper for a Fleet session's Dreamscape MCP server (#1199): Claude Code runs
//   node fleet-mcp-headers.js <keyFile> <sessionId>
// per connection and uses the JSON object on stdout as the request headers. Nothing else goes to stdout; on any
// error nothing does, a short reason goes to stderr (never the key) and the exit code is 1. Only fs.

const fs = require('fs');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(msg) {
    process.stderr.write(`fleet-mcp-headers: ${msg}\n`);
    process.exit(1);
}

const keyFile = process.argv[2];
const sessionId = process.argv[3];
if (!keyFile || !sessionId) fail('usage: fleet-mcp-headers.js <keyFile> <sessionId>');
if (!UUID_RE.test(sessionId)) fail('the session id is not a UUID');
let key = '';
try { key = fs.readFileSync(keyFile, 'utf8').trim(); } catch (e) { fail(`cannot read the key file (${e.code || 'error'})`); }
if (!key || /[\s"\\]/.test(key)) fail('the key file is empty or malformed');
process.stdout.write(`${JSON.stringify({ Authorization: `Bearer ${key}`, 'X-Fleet-Session': sessionId })}\n`);
