#!/usr/bin/env node
'use strict';
// modules/profileRevision.js (#910): the user's profile revision moves on with every profile write and is pushed to
// desktop pages only; other packets leave it alone.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-rev-'));
const pr = require('../modules/profileRevision');
const file = path.join(tmp, 'rev.json');

(async () => {
    pr._reset(file);
    const a = pr.current(file);
    assert.ok(/^\d+-\d+$/.test(a), 'a revision from the start');
    const b = pr.bump(file);
    const c = pr.bump(file);
    assert.notStrictEqual(a, b);
    assert.notStrictEqual(b, c, 'two writes in one millisecond still differ');
    assert.strictEqual(pr.current(file), c);

    const sent = [];
    const fakeServer = { broadcast: (msg, filter) => sent.push({ msg, filter }) };
    assert.strictEqual(pr.afterPacketOn('desktop_get_shortcuts', fakeServer), null, 'a read moves nothing');
    assert.strictEqual(sent.length, 0);
    const d = pr.afterPacketOn('desktop_update_positions', fakeServer);
    assert.ok(d && d !== c, 'a profile write moves it on');
    assert.strictEqual(sent[0].msg.type, 'profile_changed');
    assert.deepStrictEqual(sent[0].msg.data, { revision: d, type: 'desktop_update_positions' });
    const f = sent[0].filter;
    assert.strictEqual(f({ userType: 'admin' }), true, 'desktops get it');
    assert.strictEqual(f({ userType: 'admin', phone: { shell: 'mobile' } }), false, 'phone pages do not');
    assert.strictEqual(f({ userType: 'readonly' }), false, 'read-only sessions do not');
    assert.strictEqual(f(null), false);

    // kept across a restart (written behind)
    await new Promise((r) => setTimeout(r, 50));
    pr._reset(file);
    assert.strictEqual(pr.current(file), d, 'the saved revision comes back after a restart');

    // the handler answers with the current revision
    const handler = require('../modules/ws/handlers/201-profileRevisionHandler');
    const out = [];
    await handler.handleProfileRevision({ sendToClient: (ws, m) => out.push(m) }, null, { requestId: 'r1' });
    assert.strictEqual(out[0].type, 'profile_revision_response');
    assert.strictEqual(out[0].requestId, 'r1');
    assert.ok(out[0].data.revision);
    console.log('test-profile-revision: ok');
})().catch((e) => { console.error(e); process.exit(1); });
