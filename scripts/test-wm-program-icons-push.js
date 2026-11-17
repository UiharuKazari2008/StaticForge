#!/usr/bin/env node
/**
 * Program Icons job pushes (#890 P15, modules/wmProgramIcons.js): every job change goes to the sessions
 * that made or asked about the job as wm_program_icons_job { success, job } (the GET /jobs/:job
 * answer), one push per turn of the event loop, none to sessions that never asked, and none after the
 * batch is closed.
 *   node scripts/test-wm-program-icons-push.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const icons = require('../modules/wmProgramIcons');

const t = icons._test;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-icons-push-'));
fs.mkdirSync(path.join(root, '.cache', 'wm-program-icons', 'jobs'), { recursive: true });
t.setRoot(root);
const pushed = [];
t.setGr({ getWebSocketServer: () => ({ sendToUser: (sid, msg) => pushed.push({ sid, msg }) }) });
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
    const job = { id: 'jtest1', createdAt: Date.now(), updatedAt: Date.now(), state: 'working', items: [{ key: 'abcdefabcdef', id: 'com.a/.Main', package: 'com.a', label: 'A', state: 'queued', attempt: 0 }] };
    t.jobs.set(job.id, job);

    // nobody asked: no push
    t.saveJob(job);
    await tick();
    assert.strictEqual(pushed.length, 0);

    t.watchJob(job, { sessionID: 'sess-phone' });
    t.watchJob(job, { session: { id: 'sess-desk' } });
    job.items[0].state = 'working';
    t.saveJob(job);
    job.items[0].state = 'ready';
    t.saveJob(job);
    await tick();
    assert.strictEqual(pushed.length, 2, 'one push per session for two changes in one turn');
    assert.deepStrictEqual(pushed.map((p) => p.sid).sort(), ['sess-desk', 'sess-phone']);
    const m = pushed[0].msg;
    assert.strictEqual(m.type, 'wm_program_icons_job');
    assert.deepStrictEqual(m.data, { success: true, job: t.publicJob(job) }, 'the GET /jobs/:job shape');
    assert.strictEqual(m.data.job.items[0].state, 'ready', 'the newest state');
    assert.strictEqual(m.data.job.state, 'ready');

    // closed: the last state goes, then nothing more
    pushed.length = 0;
    job.state = 'done';
    t.saveJob(job);
    await tick();
    assert.strictEqual(pushed.length, 2);
    assert.strictEqual(pushed[0].msg.data.job.state, 'done');
    pushed.length = 0;
    t.saveJob(job);
    await tick();
    assert.strictEqual(pushed.length, 0, 'no pushes after the batch closed');
    assert.ok(fs.existsSync(path.join(root, '.cache', 'wm-program-icons', 'jobs', 'jtest1.json')), 'still saved');

    fs.rmSync(root, { recursive: true, force: true });
    console.log('wm program icons push: ok');
})().catch((e) => { console.error(e); process.exit(1); });
