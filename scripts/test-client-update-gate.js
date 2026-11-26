#!/usr/bin/env node
'use strict';

// The client update gate (scripts/restart-gate.js --client, scripts/client-update.sh): which files are client files,
// and a real run that answers a verdict without the server-only checks (PM2, the Director idle check).

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { SERVER_PATH_RE, CLIENT_PATH_RE } = require('./restart-gate');

const client = ['public/scripts/comp/modalUtils.js', 'public/css/vista.css', 'apps/claudedesk/client/claudedesk.js', 'apps/claudedesk/assets/claudedesk.css', 'apps/claudedesk/manifest.json'];
const server = ['modules/claudeSessions.js', 'server.js', 'routes/api.js', 'config.json', 'apps/claudedesk/server/index.js', 'scripts/restart-gate.js', 'docs/fleet/work-items.md'];
client.forEach((f) => assert.ok(CLIENT_PATH_RE.test(f), `${f} is a client file`));
server.forEach((f) => assert.ok(!CLIENT_PATH_RE.test(f), `${f} is not a client file`));
assert.ok(SERVER_PATH_RE.test('modules/claudeSessions.js') && !SERVER_PATH_RE.test('public/scripts/comp/modalUtils.js'), 'the server gate keeps its own files');
console.log('ok 1 client files');

const r = spawnSync(process.execPath, [path.join(__dirname, 'restart-gate.js'), '--client', '--json', '--why', 'test run'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
let o = null;
try { o = JSON.parse(r.stdout); } catch (_) { o = null; }
assert.ok(o, `JSON verdict (${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)})`);
assert.ok(['approved', 'ask', 'wait', 'denied'].includes(o.verdict), o.verdict);
assert.strictEqual(r.status, { approved: 0, ask: 10, wait: 20, denied: 30 }[o.verdict], 'exit code follows the verdict');
const texts = o.findings.map((f) => f.text).join('\n');
assert.ok(!/PM2 guard|Director idle check|Director turn|Yozora's turn|image generation/.test(texts), `no server-only checks in a client gate:\n${texts}`);
assert.ok(!/hold-restart/.test(texts), 'a hold-restart does not hold a client update');
o.findings.filter((f) => f.level === 'note' && /^uncommitted /.test(f.text)).forEach((f) => assert.ok(/ships as it is/.test(f.text), f.text));
console.log(`ok 2 client gate run (${o.verdict})`);
console.log('all client update gate tests passed');
