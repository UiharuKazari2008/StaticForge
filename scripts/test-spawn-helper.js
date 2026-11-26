#!/usr/bin/env node
'use strict';

/**
 * #1236 part A: modules/spawnHelper.js (one small helper process runs the server's child commands so a spawn
 * does not fork the 800 MB Dreamscape process). Checks: same results as the old execFile runners, helper death
 * then respawn, no orphan and no kept-alive parent, and the number that matters: how long a spawn blocks a
 * parent whose heap has grown (direct child_process.execFile vs spawnHelper.run).
 *
 *   node scripts/test-spawn-helper.js            (SPAWN_TEST_HEAP_MB=600 by default for the timing part)
 */

const path = require('path');
const assert = require('assert');
const { execFile, spawn } = require('child_process');
const spawnHelper = require('../modules/spawnHelper');

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// the old defaultRunner of claudeAccountHost / claudeSessionLauncher / claudeRemoteFleet, as the reference
function oldRunner(cmd, args, opts) {
    return new Promise((resolve) => {
        execFile(cmd, args, { env: opts.env, timeout: opts.timeout || 15000, maxBuffer: opts.maxBuffer || 256 * 1024 }, (error, stdout, stderr) => {
            resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

async function same(name, cmd, args, opts) {
    await test(`same as the old runner: ${name}`, async () => {
        const a = await oldRunner(cmd, args, opts || {});
        const b = await spawnHelper.run(cmd, args, opts || {});
        assert.deepStrictEqual(b, a);
    });
}

(async () => {
    // ---- (a) correctness
    await same('stdout', 'sh', ['-c', 'printf hello']);
    await same('stderr + exit 0', 'sh', ['-c', 'printf err >&2']);
    await same('exit code 3 with output', 'sh', ['-c', 'printf out; printf err >&2; exit 3']);
    await same('nonexistent command', 'definitely-not-a-command-1236', []);
    await same('timeout kills the command (code 1)', 'sh', ['-c', 'sleep 5'], { timeout: 300 });
    await same('maxBuffer exceeded (code 1, partial stdout)', 'sh', ['-c', 'head -c 5000 /dev/zero | tr "\\0" x'], { maxBuffer: 1000 });
    await test('stdin is closed (cat ends at once; the old runner left the pipe open until its timeout)', async () => {
        const t = Date.now();
        const r = await spawnHelper.run('cat', [], { timeout: 5000 });
        assert.deepStrictEqual(r, { code: 0, stdout: '', stderr: '' });
        assert.ok(Date.now() - t < 2000);
    });
    await same('env given by the caller', 'sh', ['-c', 'printf "$SPAWN_T"'], { env: { PATH: process.env.PATH, SPAWN_T: 'v1' } });

    await test('no env given: the command gets the helper\'s (the parent\'s at helper start: PATH, HOME)', async () => {
        const r = await spawnHelper.run('sh', ['-c', 'printf "$HOME"']);
        assert.strictEqual(r.stdout, process.env.HOME || '');
    });
    await test('execFileText resolves stdout, rejects on non-zero with stderr', async () => {
        assert.strictEqual(await spawnHelper.execFileText('sh', ['-c', 'printf ab']), 'ab');
        await assert.rejects(() => spawnHelper.execFileText('sh', ['-c', 'printf bad >&2; exit 2']), (e) => e.code === 2 && e.stderr === 'bad');
        await assert.rejects(() => spawnHelper.execFileText('definitely-not-a-command-1236', []), (e) => e.code === 'ENOENT');
    });
    await test('concurrent requests answer each its own', async () => {
        const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => spawnHelper.run('sh', ['-c', `sleep 0.${7 - n}; printf ${n}`])));
        assert.deepStrictEqual(rs.map((r) => r.stdout), ['1', '2', '3', '4', '5', '6']);
    });
    await test('nothing pending once all are answered', async () => {
        assert.strictEqual(spawnHelper._state().pending, 0);
    });

    // ---- (b) helper death mid-request, then respawn
    await test('helper killed mid-request: that request errors, the next call works (direct while backing off), then the helper respawns', async () => {
        spawnHelper._config({ respawnMs: 400 });
        await spawnHelper.run('true', []);
        const pid1 = spawnHelper._state().pid;
        assert.ok(pid1);
        const slow = spawnHelper.run('sh', ['-c', 'sleep 3; printf late']);
        await sleep(150);
        spawnHelper._kill('SIGKILL');
        const r = await slow;
        assert.strictEqual(r.code, 1);
        assert.strictEqual(r.stdout, '');
        const during = await spawnHelper.run('sh', ['-c', 'printf direct']); // inside the back-off: direct execFile
        assert.strictEqual(during.stdout, 'direct');
        await sleep(450);
        const after = await spawnHelper.run('sh', ['-c', 'printf again']);
        assert.strictEqual(after.stdout, 'again');
        const pid2 = spawnHelper._state().pid;
        assert.ok(pid2 && pid2 !== pid1, 'a new helper');
        assert.ok(!alive(pid1), 'the old helper is gone');
    });
    await test('3 deaths in a minute: direct execFile for 5 minutes, one warning, never a respawn loop', async () => {
        spawnHelper._reset();
        spawnHelper._config({ respawnMs: 0 });
        const warns = [];
        const w = console.warn;
        console.warn = (m) => warns.push(String(m));
        try {
            for (let i = 0; i < 3; i += 1) {
                await spawnHelper.run('true', []);
                spawnHelper._kill('SIGKILL');
                await sleep(150);
            }
            const spawned = spawnHelper._state().spawned;
            const r = await spawnHelper.run('sh', ['-c', 'printf direct']);
            assert.strictEqual(r.stdout, 'direct');
            await spawnHelper.run('true', []);
            assert.strictEqual(spawnHelper._state().spawned, spawned, 'no further respawn');
            assert.ok(spawnHelper._state().directUntil > Date.now() + 4 * 60 * 1000);
            assert.strictEqual(warns.filter((x) => /spawnHelper/.test(x)).length, 1);
        } finally { console.warn = w; }
        spawnHelper._reset();
        spawnHelper._config({ respawnMs: 5000 });
    });

    // ---- (c) the parent exits by itself; no orphan even when the parent is killed
    const lib = path.join(__dirname, '..', 'modules', 'spawnHelper.js');
    await test('a parent that is done exits at once and takes the helper with it', async () => {
        const code = `const h=require(${JSON.stringify(lib)});h.run('true',[]).then(()=>{console.log('PID '+h._state().pid);});`;
        const t0 = Date.now();
        const out = await new Promise((resolve) => { let s = ''; const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] }); c.stdout.on('data', (d) => { s += d; }); c.on('exit', () => resolve(s)); });
        const took = Date.now() - t0;
        const pid = Number(/PID (\d+)/.exec(out)[1]);
        assert.ok(took < 3000, `exited after ${took} ms`);
        for (let i = 0; i < 20 && alive(pid); i += 1) await sleep(100);
        assert.ok(!alive(pid), 'the helper is gone after the parent exited');
        console.log(`     (parent exit after ${took} ms, helper ${pid} gone)`);
    });
    await test('a parent that is SIGKILLed leaves no orphan helper', async () => {
        const code = `const h=require(${JSON.stringify(lib)});h.run('true',[]).then(()=>{console.log('PID '+h._state().pid);setInterval(()=>{},1000);});`;
        const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
        const pid = await new Promise((resolve) => { let s = ''; c.stdout.on('data', (d) => { s += d; const m = /PID (\d+)/.exec(s); if (m) resolve(Number(m[1])); }); });
        assert.ok(alive(pid));
        c.kill('SIGKILL');
        for (let i = 0; i < 30 && alive(pid); i += 1) await sleep(100);
        assert.ok(!alive(pid), 'helper still running after its parent was killed');
    });

    // ---- storeV2: git status in the Dreamscape server is async, stale-while-revalidate
    await test('agent-coord storeV2: async mode (the server) answers from a cache the helper fills; sync mode answers at once', async () => {
        const fs = require('fs');
        const os = require('os');
        const { execFileSync } = require('child_process');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-helper-'));
        process.env.AGENT_COORD_DB = path.join(tmp, 'coord.db');
        const repo = path.join(tmp, 'repo');
        fs.mkdirSync(repo);
        execFileSync('git', ['init', '-q', repo]);
        fs.writeFileSync(path.join(repo, 'a.js'), '1');
        const store = require('../modules/agentCoord/store');
        process.env.DREAMSCAPE_COORD_ASYNC_GIT = '0';
        assert.strictEqual(store.gitDirty(repo).count, 1, 'sync mode: fresh answer on the first call');
        process.env.DREAMSCAPE_COORD_ASYNC_GIT = '1';
        assert.strictEqual(store.gitDirty(repo), null, 'async mode, nothing known yet: unknown (null), no git run on this loop');
        for (let i = 0; i < 40 && !store.gitDirty(repo); i += 1) await sleep(50);
        const got = store.gitDirty(repo);
        assert.ok(got && got.count === 1 && got.paths.has('a.js'), 'filled by the helper');
        fs.writeFileSync(path.join(repo, 'b.js'), '2');
        assert.strictEqual(store.gitDirty(repo).count, 1, 'stale answer while inside the TTL');
        fs.rmSync(tmp, { recursive: true, force: true });
        delete process.env.DREAMSCAPE_COORD_ASYNC_GIT;
    });

    // ---- (d) the key number: a spawn from a parent with a grown heap
    await test('blocked time of one spawn in a parent with a big heap: direct execFile vs spawnHelper.run', async () => {
        const mb = Number(process.env.SPAWN_TEST_HEAP_MB) || 600;
        const hold = [];
        for (let i = 0; i < mb; i += 1) hold.push(Buffer.alloc(1024 * 1024, i & 255));      // touched pages: the fork copies their page tables
        const objs = []; for (let i = 0; i < 40; i += 1) objs.push(new Array(250000).fill(i));  // and ~80 MB of JS arrays
        const N = 12;
        const measure = async (fn) => {
            const syncMs = []; let maxLag = 0; let stop = false;
            let last = process.hrtime.bigint();
            const probe = () => { const n = process.hrtime.bigint(); maxLag = Math.max(maxLag, Number(n - last) / 1e6); last = n; if (!stop) setImmediate(probe); };
            setImmediate(probe);
            for (let i = 0; i < N; i += 1) {
                const t = process.hrtime.bigint();
                const p = fn();
                syncMs.push(Number(process.hrtime.bigint() - t) / 1e6);
                await p;
                await sleep(30);
            }
            stop = true;
            await sleep(5);
            return { syncMs, maxLag };
        };
        const stat = (a) => { const s = a.slice().sort((x, y) => x - y); return `median ${s[s.length >> 1].toFixed(1)} ms, max ${s[s.length - 1].toFixed(1)} ms`; };
        const direct = await measure(() => new Promise((r) => execFile('true', [], () => r())));
        spawnHelper._reset();
        const t0 = process.hrtime.bigint();
        const first = spawnHelper.run('true', []);   // cold: starts the helper (one fork of the big parent, paid once)
        const coldSync = Number(process.hrtime.bigint() - t0) / 1e6;
        await first;
        const helper = await measure(() => spawnHelper.run('true', []));
        console.log(`     parent heap held: ${mb} MB buffers + ~80 MB arrays (rss ${(process.memoryUsage().rss / 1048576) | 0} MB)`);
        console.log(`     direct child_process.execFile('true'): sync part ${stat(direct.syncMs)}; worst setImmediate lag ${direct.maxLag.toFixed(1)} ms`);
        console.log(`     spawnHelper.run('true'):               sync part ${stat(helper.syncMs)}; worst setImmediate lag ${helper.maxLag.toFixed(1)} ms`);
        console.log(`     spawnHelper first call (starts the helper, one fork, paid once): sync part ${coldSync.toFixed(1)} ms`);
        assert.ok(hold.length === mb && objs.length === 40);
        const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
        assert.ok(med(helper.syncMs) < med(direct.syncMs), 'the helper must block less than a direct spawn');
    });

    spawnHelper._reset();
    console.log(failed ? `\n${failed} FAILED` : '\nall ok');
    process.exit(failed ? 1 : 0);
})();
