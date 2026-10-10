#!/usr/bin/env node
// Fake /proc tree test for scripts/director-idle-check.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkIdle } = require('./director-idle-check');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-check-'));
const proc = path.join(tmp, 'proc');
const runs = path.join(tmp, 'runs');
const images = path.join(tmp, 'images');
[proc, runs, images].forEach((d) => fs.mkdirSync(d, { recursive: true }));
const mk = (pid, comm, ppid) => {
    fs.mkdirSync(path.join(proc, String(pid)), { recursive: true });
    fs.writeFileSync(path.join(proc, String(pid), 'stat'), `${pid} (${comm}) S ${ppid} ${pid} ${pid} 0`);
};
const rm = (pid) => fs.rmSync(path.join(proc, String(pid)), { recursive: true, force: true });
const base = { procRoot: proc, xiRunsDir: runs, imagesDir: images, serverPid: 100, selfPid: 900 };

try {
    mk(1, 'systemd', 0); mk(100, 'node', 1);
    // checker chain: sshd -> bash -> node(self). Self is even named like an agent.
    mk(800, 'sshd', 1); mk(850, 'bash', 800); mk(900, 'bwrap', 850);
    let r = checkIdle(base);
    assert.strictEqual(r.idle, true, 'idle with only the checker chain running');

    // Self pid listed as an Xi run must still not count.
    fs.writeFileSync(path.join(runs, 'self.json'), JSON.stringify({ pid: 900, sessionId: 's' }));
    assert.strictEqual(checkIdle(base).idle, true, 'self pid in a run record is skipped');
    fs.rmSync(path.join(runs, 'self.json'));

    // Wren: bwrap child of the server is busy; bwrap elsewhere is not.
    mk(200, 'bwrap', 1);
    assert.strictEqual(checkIdle(base).idle, true, 'unrelated bwrap ignored');
    mk(201, 'bwrap', 100);
    r = checkIdle(base);
    assert.strictEqual(r.idle, false); assert.deepStrictEqual(r.wren.map((w) => w.pid), [201]);
    rm(201);

    // Xi: live run record busy; dead pid or reused pid (wrong comm) not.
    fs.writeFileSync(path.join(runs, 'a.json'), JSON.stringify({ pid: 300, sessionId: 'x1', name: 'Xi' }));
    assert.strictEqual(checkIdle(base).idle, true, 'dead Xi pid ignored');
    mk(300, 'sleep', 1);
    assert.strictEqual(checkIdle(base).idle, true, 'reused Xi pid ignored');
    rm(300); mk(300, 'cursor-agent', 1);
    r = checkIdle(base);
    assert.strictEqual(r.idle, false); assert.strictEqual(r.xi[0].sessionId, 'x1');
    rm(300);

    // Generation window.
    const img = path.join(images, 'g.png');
    fs.writeFileSync(img, 'x');
    assert.strictEqual(checkIdle(base).idle, false, 'fresh image is busy');
    const old = (Date.now() - 300000) / 1000; fs.utimesSync(img, old, old);
    assert.strictEqual(checkIdle(base).idle, true, 'old image ignored');

    // Server not running -> undecided, never idle.
    r = checkIdle({ ...base, serverPid: 555 });
    assert.strictEqual(r.idle, false); assert.strictEqual(r.decided, false);

    console.log('test-director-idle-check: ok');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
