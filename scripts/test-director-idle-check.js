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
const busyFile = path.join(tmp, 'busy-status.json');
[proc, runs, images].forEach((d) => fs.mkdirSync(d, { recursive: true }));
const mk = (pid, comm, ppid) => {
    fs.mkdirSync(path.join(proc, String(pid)), { recursive: true });
    fs.writeFileSync(path.join(proc, String(pid), 'stat'), `${pid} (${comm}) S ${ppid} ${pid} ${pid} 0`);
};
const rm = (pid) => fs.rmSync(path.join(proc, String(pid)), { recursive: true, force: true });
const base = { procRoot: proc, xiRunsDir: runs, imagesDir: images, serverPid: 100, selfPid: 900, busyFile };

try {
    mk(1, 'systemd', 0); mk(100, 'node', 1);
    // checker chain: sshd -> bash -> node(self). Self is even named like an agent.
    mk(800, 'sshd', 1); mk(850, 'bash', 800); mk(900, 'bwrap', 850);
    let r = checkIdle(base);
    assert.strictEqual(r.idle, true, 'idle with only the checker chain running');
    assert.deepStrictEqual(r.reasons, []);
    assert.deepStrictEqual(r.warnings, []);

    // Self pid listed as an Xi run must still not count.
    fs.writeFileSync(path.join(runs, 'self.json'), JSON.stringify({ pid: 900, sessionId: 's' }));
    assert.strictEqual(checkIdle(base).idle, true, 'self pid in a run record is skipped');
    fs.rmSync(path.join(runs, 'self.json'));

    // Wren: bwrap child of the server is busy; bwrap elsewhere is not.
    mk(200, 'bwrap', 1);
    assert.strictEqual(checkIdle(base).idle, true, 'unrelated bwrap ignored');
    mk(201, 'bwrap', 100);
    r = checkIdle(base);
    assert.strictEqual(r.idle, false);
    assert.deepStrictEqual(r.wren.map((w) => w.pid), [201]);
    assert.ok(r.reasons.includes('sandbox:201'));
    rm(201);

    // Nested sandbox under a Dreamscape child (not a direct child).
    mk(150, 'node', 100);
    mk(202, 'bwrap', 150);
    r = checkIdle(base);
    assert.strictEqual(r.idle, false, 'nested bwrap under Dreamscape is busy');
    assert.ok(r.wren.some((w) => w.pid === 202));
    assert.ok(r.reasons.includes('sandbox:202'));
    rm(202);
    rm(150);

    // Xi: live run record busy; dead pid or reused pid (wrong comm) not.
    fs.writeFileSync(path.join(runs, 'a.json'), JSON.stringify({ pid: 300, sessionId: 'x1', name: 'Xi' }));
    assert.strictEqual(checkIdle(base).idle, true, 'dead Xi pid ignored');
    mk(300, 'sleep', 1);
    assert.strictEqual(checkIdle(base).idle, true, 'reused Xi pid ignored');
    rm(300); mk(300, 'cursor-agent', 1);
    r = checkIdle(base);
    assert.strictEqual(r.idle, false); assert.strictEqual(r.xi[0].sessionId, 'x1');
    assert.ok(r.reasons.includes('xi:x1'));
    rm(300);
    fs.rmSync(path.join(runs, 'a.json'));

    // Claude comm on a live Xi run is busy (Yozora #565).
    fs.writeFileSync(path.join(runs, 'c.json'), JSON.stringify({ pid: 310, sessionId: 'c1', name: 'Xi' }));
    mk(310, 'claude', 1);
    r = checkIdle(base);
    assert.strictEqual(r.idle, false, 'claude agent comm is a live Xi run');
    assert.strictEqual(r.xi[0].sessionId, 'c1');
    assert.ok(r.reasons.includes('xi:c1'));
    rm(310);
    fs.rmSync(path.join(runs, 'c.json'));

    // Generation window: recent live-tree edits warn and do not block idle.
    const img = path.join(images, 'g.png');
    fs.writeFileSync(img, 'x');
    r = checkIdle(base);
    assert.strictEqual(r.idle, true, 'fresh image warns but is not busy');
    assert.ok(r.warnings.some((w) => w.startsWith('recent-images')));
    assert.ok(r.recentImages.length > 0);
    const old = (Date.now() - 300000) / 1000; fs.utimesSync(img, old, old);
    r = checkIdle(base);
    assert.strictEqual(r.idle, true, 'old image ignored');
    assert.deepStrictEqual(r.warnings, []);

    // In-process snapshot names the exact busy work.
    fs.writeFileSync(busyFile, JSON.stringify({
        pid: 100,
        port: 1,
        at: Date.now(),
        status: {
            busy: true,
            reasons: ['director:dirc_test', 'mcp:Dreamscape Director:generate_image']
        }
    }));
    r = checkIdle(base);
    assert.strictEqual(r.idle, false, 'in-process director run is busy');
    assert.ok(r.reasons.includes('director:dirc_test'));
    assert.ok(r.reasons.includes('mcp:Dreamscape Director:generate_image'));
    fs.rmSync(busyFile);

    // Snapshot from another pid is ignored.
    fs.writeFileSync(busyFile, JSON.stringify({
        pid: 999,
        at: Date.now(),
        status: { busy: true, reasons: ['director:stale'] }
    }));
    assert.strictEqual(checkIdle(base).idle, true, 'snapshot from another pid ignored');
    fs.rmSync(busyFile);

    // Old snapshot from the live server pid: refresh loop wedged -> busy.
    fs.writeFileSync(busyFile, JSON.stringify({
        pid: 100,
        at: Date.now() - 60000,
        status: { busy: false, reasons: [] }
    }));
    r = checkIdle(base);
    assert.strictEqual(r.idle, false, 'stale snapshot from live server is not idle');
    assert.ok(r.reasons.includes('busy-snapshot-stale'));
    fs.rmSync(busyFile);

    // Server not running -> undecided, never idle.
    r = checkIdle({ ...base, serverPid: 555 });
    assert.strictEqual(r.idle, false); assert.strictEqual(r.decided, false);

    // The server's pid comes from PM2's pid files whatever PM2's id for the app is (-1 after PM2 registered them again).
    const pm2Home = path.join(tmp, 'pm2');
    fs.mkdirSync(path.join(pm2Home, 'pids'), { recursive: true });
    const pidFile = (name, pid, at) => { const f = path.join(pm2Home, 'pids', name); fs.writeFileSync(f, `${pid}\n`); fs.utimesSync(f, at, at); };
    const fromFiles = () => { const o = { ...base, pm2Home }; delete o.serverPid; return checkIdle(o); };
    assert.strictEqual(fromFiles().decided, false, 'no pid file: undecided');
    pidFile('Dreamscape-1.pid', 100, 2000);
    pidFile('other-app-2.pid', 555, 3000);
    r = fromFiles();
    assert.deepStrictEqual([r.serverPid, r.serverAlive, r.idle], [100, true, true], 'Dreamscape-1.pid is found');
    pidFile('Dreamscape-0.pid', 555, 4000);
    assert.strictEqual(fromFiles().serverPid, 100, 'a newer file of a dead process does not win over the live one');
    fs.rmSync(path.join(pm2Home, 'pids', 'Dreamscape-1.pid'));
    r = fromFiles();
    assert.deepStrictEqual([r.serverPid, r.idle, r.decided], [555, false, false], 'only a dead one: never idle');

    console.log('test-director-idle-check: ok');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(0);
