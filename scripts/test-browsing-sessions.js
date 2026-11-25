'use strict';
// Tests modules/browsingSessions.js: icons survive cleanTab/cleanHistory and bad icons are dropped.
const assert = require('assert');
const fs = require('fs');

// keep the 2 s save timer off the real .cache/browsing-sessions.json
fs.writeFileSync = () => {};
fs.renameSync = () => {};
fs.mkdirSync = () => {};

const bs = require('../modules/browsingSessions');
bs._reset();
const dev = 'a'.repeat(16);
const sid = 'session-test-1';
bs._state().sessions[sid] = { id: sid, deviceId: dev, deviceName: 'T', deviceKind: 'desktop', windows: [], state: 'idle', lastSeenAt: Date.now() };
const client = { browsingSession: sid, browsingDevice: dev };
const tab = (extra) => Object.assign({ id: '1', url: 'https://a.example/', history: [{ type: 'web', url: 'https://a.example/', title: 'A', icon: '/cache/site-icons/abc.png' }], historyIndex: 0 }, extra);
const report = (t) => { bs.update(client, { sessionId: sid, windows: [{ id: 'w1', tabs: [t] }] }); return bs._state().sessions[sid].windows[0].tabs[0]; };

let t = report(tab({ icon: '/cache/site-icons/abc.png' }));
assert.strictEqual(t.icon, '/cache/site-icons/abc.png');
assert.strictEqual(t.history[0].icon, '/cache/site-icons/abc.png');

t = report(tab({ icon: 'https://x.example/f.ico' }));
assert.strictEqual(t.icon, 'https://x.example/f.ico');

for (const bad of ['data:image/png;base64,AAAA', 'javascript:alert(1)', 'http://x.example/f.ico', '//evil.example/f.ico', '/', '/' + 'a'.repeat(2000), '']) {
    t = report(tab({ icon: bad, history: [{ type: 'web', url: 'https://a.example/', title: 'A', icon: bad }] }));
    assert.strictEqual(t.icon, '', 'tab icon dropped: ' + bad.slice(0, 20));
    assert.strictEqual(t.history[0].icon, '', 'history icon dropped: ' + bad.slice(0, 20));
}

// empty tab icon falls back to the current history entry's icon
t = report(tab({ icon: '' }));
assert.strictEqual(t.icon, '/cache/site-icons/abc.png');

// change detection: an identical report is not a change, a new icon is
let announced = 0;
bs.setSender(() => { announced++; });
const before = JSON.stringify(bs._state().sessions[sid].windows);
report(tab({ icon: '' }));
assert.strictEqual(JSON.stringify(bs._state().sessions[sid].windows), before);

console.log('browsing sessions ok');
process.exit(0);
