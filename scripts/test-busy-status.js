#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const busy = require('../modules/busyStatus');
const mcp = require('../modules/mcpActivity');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'busy-status-'));
const snap = path.join(tmp, 'busy-status.json');

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
                catch (err) { reject(err); }
            });
        }).on('error', reject);
    });
}

async function main() {
    busy.resetForTests();
    mcp.resetActivityLog();

    const empty = busy.collect({
        director: [],
        xi: [],
        generation: { processing: false },
        localJobs: [],
        mcp: [],
        smtp: [],
        http: []
    });
    assert.strictEqual(empty.busy, false);
    assert.deepStrictEqual(empty.reasons, []);

    const named = busy.collect({
        director: [{ sessionId: 'dirc_3ab5f3c0bfcf3dfd' }],
        xi: [{ sessionId: 'xi_1' }],
        generation: { processing: true },
        localJobs: [{ kind: 'upscale', jobId: 'up-1' }, { kind: 'animate', jobId: 'an-1' }],
        mcp: [{ key: 'Dreamscape Director', tool: 'generate_image' }],
        smtp: [{ id: 1 }],
        http: [{ id: 1, path: '/agent' }]
    });
    assert.strictEqual(named.busy, true);
    assert.ok(named.reasons.includes('director:dirc_3ab5f3c0bfcf3dfd'));
    assert.ok(named.reasons.includes('xi:xi_1'));
    assert.ok(named.reasons.includes('generation-queue'));
    assert.ok(named.reasons.includes('upscale:up-1'));
    assert.ok(named.reasons.includes('animate:an-1'));
    assert.ok(named.reasons.includes('mcp:Dreamscape Director:generate_image'));
    assert.ok(named.reasons.includes('smtp:1'));
    assert.ok(named.reasons.includes('http:1'));

    const smtpId = busy.beginSmtp({ peer: '127.0.0.1' });
    assert.ok(busy.collect({ director: [], xi: [], generation: { processing: false }, localJobs: [], mcp: [], http: [] }).reasons.includes('smtp:1'));
    busy.endSmtp(smtpId);
    assert.strictEqual(busy.collect({ director: [], xi: [], generation: { processing: false }, localJobs: [], mcp: [], smtp: [], http: [] }).busy, false);

    const httpId = busy.beginHttp({ method: 'POST', url: '/agent?x=1' });
    const httpSnap = busy.collect({ director: [], xi: [], generation: { processing: false }, localJobs: [], mcp: [], smtp: [] });
    assert.ok(httpSnap.reasons.includes('http:1'));
    assert.strictEqual(httpSnap.http[0].path, '/agent');
    const gid = busy.beginHttp({ method: 'GET', url: '/03753117-cdcd-42f2-9e09-b1d59fc1323c/gallery/1792451773102_x.png' });
    const gpath = busy.collect().http.find((row) => row.id === gid).path;
    assert.ok(!/03753117|1792451773102/.test(gpath), 'instance UUID / filenames are not exposed on /busy: ' + gpath);
    busy.endHttp(gid);
    busy.endHttp(httpId);

    const jobId = busy.beginLocalJob('animate', 'job-9');
    assert.ok(busy.collect({ director: [], xi: [], generation: { processing: false }, mcp: [], smtp: [], http: [] }).reasons.includes('animate:job-9'));
    busy.endLocalJob(jobId);

    const callId = mcp.beginCall({ tool: 'get_studio_state', actorName: 'Guren', key: 'Guren' });
    assert.strictEqual(mcp.getInflight().length, 1);
    assert.strictEqual(mcp.getInflight()[0].tool, 'get_studio_state');
    const fromMcp = busy.collect({ director: [], xi: [], generation: { processing: false }, localJobs: [], smtp: [], http: [] });
    assert.ok(fromMcp.reasons.includes('mcp:Guren:get_studio_state'));
    mcp.endCall(callId);
    assert.strictEqual(mcp.getInflight().length, 0);

    const started = await busy.startLoopback({ file: snap });
    assert.ok(started.port > 0);
    busy.beginSmtp({ peer: '10.0.0.2' });
    const live = await getJson(`${started.url}/busy`);
    assert.strictEqual(live.status, 200);
    assert.strictEqual(live.body.busy, true);
    assert.ok(live.body.reasons.some((row) => row.startsWith('smtp:')));
    const disk = busy.readSnapshot(snap);
    assert.ok(disk && disk.status && disk.status.busy);
    assert.strictEqual(disk.pid, process.pid);

    const missing = await getJson(`${started.url}/nope`);
    assert.strictEqual(missing.status, 404);

    busy.resetForTests();
    mcp.resetActivityLog();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('test-busy-status: ok');
}

main().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    try { busy.resetForTests(); } catch (_err) { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_err) { /* */ }
    process.exit(1);
});
