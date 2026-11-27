'use strict';
// Interactive pty without native modules: a tiny python3 helper owns the pty master.
// stdin/stdout of the helper = pty data, fd 3 = "cols rows" resize lines.
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { SBIN, RACK_HOME } = require('./exec');

const HELPER = `
import os, pty, sys, select, fcntl, termios, struct, signal
cols, rows = int(sys.argv[1]), int(sys.argv[2]); cmd = sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
def setsz(c, r): fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
setsz(cols, rows)
ctl = b''; fds = [0, fd, 3]
while True:
    try: r, _, _ = select.select(fds, [], [])
    except InterruptedError: continue
    if 0 in r:
        d = os.read(0, 65536)
        if not d: os.kill(pid, signal.SIGHUP); fds.remove(0)
        else: os.write(fd, d)
    if fd in r:
        try: d = os.read(fd, 65536)
        except OSError: d = b''
        if not d: break
        os.write(1, d)
    if 3 in r:
        d = os.read(3, 4096)
        if not d: fds.remove(3)
        else:
            ctl += d
            while b'\\n' in ctl:
                line, ctl = ctl.split(b'\\n', 1)
                try: c, rr = line.split(); setsz(int(c), int(rr))
                except Exception: pass
try: _, st = os.waitpid(pid, 0)
except ChildProcessError: st = 0
sys.exit(os.waitstatus_to_exitcode(st))
`;

const ptys = new Map(); let seq = 0;

function open({ cols = 80, rows = 24, argv, onData, onExit }) {
  const c = Math.max(1, Math.min(500, cols | 0)), r = Math.max(1, Math.min(300, rows | 0));
  const child = spawn('python3', ['-I', '-c', HELPER, String(c), String(r), ...argv], {
    detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    env: { PATH: SBIN, LANG: 'C.UTF-8', TERM: 'xterm-256color', HOME: RACK_HOME },
  });
  const id = `pty${++seq}`;
  const dec = new StringDecoder('utf8');
  ptys.set(id, { id, pid: child.pid, startedAt: new Date().toISOString(), child });
  child.stdout.on('data', d => { const s = dec.write(d); if (s) onData(s); });
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => {}); child.stdio[3].on('error', () => {});
  child.on('close', code => { ptys.delete(id); onExit(code); });
  return {
    id, pid: child.pid,
    write: s => { try { child.stdin.write(s); } catch { /* closed */ } },
    resize: (cc, rr) => { try { child.stdio[3].write(`${Math.max(1, cc | 0)} ${Math.max(1, rr | 0)}\n`); } catch { /* closed */ } },
    kill: () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } },
  };
}
const list = () => [...ptys.values()].map(p => ({ id: p.id, pid: p.pid, startedAt: p.startedAt }));
const kill = id => { const p = ptys.get(id); if (!p) return false; try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } return true; };
module.exports = { open, list, kill };
