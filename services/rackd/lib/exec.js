'use strict';
// spawn helper: argv arrays only, timeouts, output caps, process-group kill.
const { spawn } = require('child_process');

const SBIN = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const RACK_HOME = '/var/lib/rack';

function killGroup(child, sig) { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } } }

// run(argv, {user, cwd, env, input, timeoutMs, maxBytes, binary, onLine, signal}) -> {code, stdout, stderr, ms, timedOut, truncated}
function run(argv, o = {}) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let cmd = argv.slice();
    const env = { PATH: SBIN, LANG: 'C.UTF-8', HOME: '/root', ...(o.env || {}) };
    let spawnEnv = env;
    if (o.user && o.user !== 'root') {
      const extra = Object.entries(o.env || {}).map(([k, v]) => `${k}=${v}`);
      cmd = ['runuser', '-u', o.user, '--', 'env', `HOME=${RACK_HOME}`, `PATH=${SBIN}`, 'LANG=C.UTF-8', ...extra, ...argv];
      spawnEnv = { PATH: SBIN, LANG: 'C.UTF-8', HOME: '/root' };
    }
    const max = o.maxBytes || 1048576;
    let child;
    try {
      child = spawn(cmd[0], cmd.slice(1), { cwd: o.cwd, env: spawnEnv, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ code: 127, stdout: '', stderr: String(e.message), ms: 0 }); }
    const out = []; const err = []; let on = 0, en = 0, truncated = false, timedOut = false, done = false;
    const lineBuf = { stdout: '', stderr: '' };
    const feed = (which, chunk) => {
      if (!o.onLine) return;
      lineBuf[which] += chunk.toString('utf8');
      let i;
      while ((i = lineBuf[which].indexOf('\n')) >= 0) { o.onLine(which, lineBuf[which].slice(0, i)); lineBuf[which] = lineBuf[which].slice(i + 1); }
    };
    child.stdout.on('data', d => { feed('stdout', d); if (on < max) { out.push(d); on += d.length; } else truncated = true; });
    child.stderr.on('data', d => { feed('stderr', d); if (en < max) { err.push(d); en += d.length; } else truncated = true; });
    child.stdin.on('error', () => {});
    if (o.input !== undefined) child.stdin.end(o.input); else child.stdin.end();
    const timer = setTimeout(() => { timedOut = true; killGroup(child, 'SIGTERM'); setTimeout(() => killGroup(child, 'SIGKILL'), 3000).unref(); }, o.timeoutMs || 60000);
    const onAbort = () => { killGroup(child, 'SIGTERM'); setTimeout(() => killGroup(child, 'SIGKILL'), 3000).unref(); };
    if (o.signal) { if (o.signal.aborted) onAbort(); else o.signal.addEventListener('abort', onAbort, { once: true }); }
    if (o.onChild) o.onChild(child);
    const finish = (code, extraErr) => {
      if (done) return; done = true; clearTimeout(timer);
      if (o.onLine) { for (const w of ['stdout', 'stderr']) if (lineBuf[w]) o.onLine(w, lineBuf[w]); }
      const so = Buffer.concat(out);
      resolve({ code: code === null ? -1 : code, stdout: o.binary ? so : so.toString('utf8'), stderr: Buffer.concat(err).toString('utf8') + (extraErr || ''), ms: Date.now() - t0, timedOut, truncated });
    };
    child.on('error', e => finish(127, String(e.message)));
    child.on('close', code => finish(code));
  });
}

// ok(argv, opts): run and throw with stderr on non-zero.
async function ok(argv, o) {
  const r = await run(argv, o);
  if (r.code !== 0) { const e = new Error(`${argv[0]} failed (${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 600)}`); e.result = r; e.code = 'CMD_FAILED'; e.status = 500; throw e; }
  return r;
}

module.exports = { run, ok, killGroup, SBIN, RACK_HOME };
