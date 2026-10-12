#!/usr/bin/env node
// Boot status stream (Yozora #431): modules/statusStream.js over a real HTTP server with a fresh
// modules/serverStartupStatus.js, and modules/earlyHttpServer.js binding a port from config.json.
//   - booting: a "status" line at once, one per change, then "done" and the end of the response
//   - already up: one "done" line and the end
//   - the early server binds the configured port and lets an app attach later
// Run: node scripts/test-status-stream.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const status = require('../modules/serverStartupStatus');
const { handleStatusStream } = require('../modules/statusStream');
const { bindEarly, readConfiguredPort } = require('../modules/earlyHttpServer');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readStream(port) {
    return new Promise((resolve, reject) => {
        const lines = [];
        const req = http.get({ host: '127.0.0.1', port, path: '/status/stream' }, (res) => {
            assert.strictEqual(res.headers['content-type'], 'application/x-ndjson; charset=utf-8');
            assert.strictEqual(res.headers['x-accel-buffering'], 'no');
            let buffer = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                buffer += chunk;
                let at;
                while ((at = buffer.indexOf('\n')) >= 0) {
                    lines.push(JSON.parse(buffer.slice(0, at)));
                    buffer = buffer.slice(at + 1);
                    if (typeof readStream.onLine === 'function') readStream.onLine(lines[lines.length - 1]);
                }
            });
            res.on('end', () => resolve(lines));
        });
        req.on('error', reject);
    });
}

(async () => {
    status.resetForTests();
    const server = http.createServer((req, res) => handleStatusStream(req, res, () => ({ extra: 'yes' })));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    // Booting: status lines, then done
    const seen = [];
    readStream.onLine = (line) => seen.push(line.type);
    const streamed = readStream(port);
    await sleep(50);
    assert.deepStrictEqual(seen, ['status'], 'a status line as soon as the stream opens');
    status.updateStage('runtime_compile');
    await sleep(200);
    status.setStageProgress(0.5, 'Compiling client files… (1/2)');
    await sleep(200);
    status.updateStage('ready', { isReady: true });
    const lines = await streamed;
    const types = lines.map((l) => l.type);
    assert.strictEqual(types[types.length - 1], 'done', 'ends with done');
    assert.ok(types.filter((t) => t === 'status').length >= 3, `status per change (${types.join(',')})`);
    assert.ok(lines.some((l) => l.stage === 'runtime_compile' && l.stageMessage === 'Compiling client files… (1/2)'));
    assert.strictEqual(lines[lines.length - 1].isReady, true);
    assert.strictEqual(lines[0].extra, 'yes', 'the caller\'s extras ride along');
    assert.ok(typeof lines[0].timestamp === 'number' && typeof lines[0].uptime === 'number');

    // Already up: one done line, closed
    readStream.onLine = null;
    const again = await readStream(port);
    assert.deepStrictEqual(again.map((l) => l.type), ['done']);

    // Bursts are throttled (one line per MIN_INTERVAL_MS at most, the last state always sent)
    status.resetForTests();
    const burst = readStream(port);
    await sleep(30);
    for (let i = 1; i <= 20; i++) status.setStageProgress(i / 20);
    await sleep(400);
    status.updateStage('ready', { isReady: true });
    const burstLines = await burst;
    assert.ok(burstLines.length < 10, `burst throttled (${burstLines.length} lines)`);
    assert.strictEqual(burstLines[burstLines.length - 1].type, 'done');
    server.close();

    // Early bind: port from config.json, app attached later
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'early-http-'));
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const freePort = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: freePort }));
    assert.strictEqual(readConfiguredPort(dir), freePort);
    assert.strictEqual(readConfiguredPort(path.join(dir, 'missing')), null);
    const early = bindEarly(dir);
    assert.strictEqual(await early.earlyListen, true, 'bound');
    assert.ok(early.listening);
    early.removeAllListeners('request');
    early.on('request', (req, res) => res.end('app'));
    const body = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: freePort, path: '/' }, (res) => {
            let text = '';
            res.on('data', (c) => { text += c; });
            res.on('end', () => resolve(text));
        }).on('error', reject);
    });
    assert.strictEqual(body, 'app', 'the attached app answers');
    await new Promise((resolve) => early.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });

    console.log('✅ test-status-stream: all assertions passed');
    process.exit(0);
})().catch((error) => {
    console.error('❌ test-status-stream failed:', error);
    process.exit(1);
});
