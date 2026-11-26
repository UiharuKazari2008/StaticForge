'use strict';

/**
 * The lean child behind modules/spawnHelper.js (#1236 part A): runs commands on Dreamscape's behalf so a
 * spawn forks this tiny process instead of the 800 MB server (a Linux fork of the server blocks its event
 * loop 90-480 ms). No app requires: only child_process. Exits when its parent goes away (IPC disconnect).
 *
 * IPC in : { id, cmd, args, opts: { env, cwd, timeout, maxBuffer, encoding, input } }
 * IPC out: { id, code, signal, stdout, stderr, error: null | { message, code, killed } }
 *          code = the exit status (0) or the execFile error's code (a number, or a string such as ENOENT).
 */

const { execFile } = require('child_process');

const active = new Set();

function reply(msg) {
    try { process.send(msg); } catch (_) { process.exit(0); }
}

function finish(id, error, stdout, stderr) {
    reply({
        id,
        code: error ? (error.code == null ? null : error.code) : 0,
        signal: error && error.signal ? error.signal : null,
        stdout: stdout == null ? '' : String(stdout),
        stderr: stderr == null ? '' : String(stderr),
        error: error ? { message: String(error.message || error), code: error.code == null ? null : error.code, killed: !!error.killed } : null
    });
}

function run(m) {
    const o = m.opts || {};
    if (typeof m.cmd !== 'string' || !m.cmd || !Array.isArray(m.args)) return finish(m.id, { message: 'bad request', code: 'EINVAL' }, '', '');
    const eo = { encoding: o.encoding || 'utf8', maxBuffer: o.maxBuffer > 0 ? o.maxBuffer : 1024 * 1024, windowsHide: true };
    if (o.timeout > 0) eo.timeout = o.timeout;
    if (o.env) eo.env = o.env;
    if (o.cwd) eo.cwd = o.cwd;
    let child;
    try {
        child = execFile(m.cmd, m.args.map(String), eo, (error, stdout, stderr) => {
            active.delete(child);
            finish(m.id, error, stdout, stderr);
        });
    } catch (e) {
        return finish(m.id, e, '', '');
    }
    active.add(child);
    // a command that reads stdin gets what the caller gave, else end of input (execFile leaves the pipe open)
    try { child.stdin.on('error', () => { /* the command did not read it */ }); child.stdin.end(o.input == null ? undefined : String(o.input)); } catch (_) { /* no stdin */ }
}

process.on('message', (m) => {
    if (!m || typeof m !== 'object' || m.id == null) return;
    if (m.ping) { reply({ id: m.id, pong: true, pid: process.pid }); return; }
    run(m);
});
process.on('disconnect', () => {
    active.forEach((c) => { try { c.kill('SIGTERM'); } catch (_) { /* gone */ } });
    process.exit(0);
});
process.on('uncaughtException', (e) => { try { process.stderr.write(`[spawnHelper] ${e && e.stack || e}\n`); } catch (_) { /* nothing */ } });
