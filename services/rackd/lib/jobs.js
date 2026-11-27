'use strict';
// Jobs: long work with a persisted log under DATA/jobs. cancel = kill the process group.
const fs = require('fs');
const path = require('path');
const { DATA, rid, RackError } = require('./util');
const events = require('./events');
const { run, ok } = require('./exec');

const DIR = path.join(DATA, 'jobs');
const KEEP_MS = 7 * 86400e3;
const live = new Map(); // id -> {job, ac, logFd, tail}

const metaFile = id => path.join(DIR, `${id}.json`);
const logFile = id => path.join(DIR, `${id}.log`);

function save(job) { try { fs.writeFileSync(metaFile(job.id), JSON.stringify(job)); } catch { /* disk full: keep going */ } }

function init() {
  fs.mkdirSync(DIR, { recursive: true });
  const now = Date.now();
  for (const f of fs.readdirSync(DIR)) {
    const p = path.join(DIR, f);
    try {
      if (now - fs.statSync(p).mtimeMs > KEEP_MS) { fs.unlinkSync(p); continue; }
      if (f.endsWith('.json')) {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j.state === 'running') { j.state = 'failed'; j.endedAt = new Date().toISOString(); j.exitCode = -1; fs.writeFileSync(p, JSON.stringify(j)); fs.appendFileSync(logFile(j.id), '[rackd restarted; job lost]\n'); }
      }
    } catch { /* skip */ }
  }
}

function view(job, tail) {
  let log = '';
  try {
    const lf = logFile(job.id); const st = fs.statSync(lf);
    const lines = fs.readFileSync(lf, 'utf8').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    log = lines.slice(-tail).join('\n'); void st;
  } catch { /* no log yet */ }
  return { ...job, log };
}

// start({role, title, run: async ctx => result}) -> job view. ctx: log(msg), exec(argv, opts) (throws), run(argv, opts), signal
function start({ role, title, run: fn }) {
  const job = { id: `j${Date.now().toString(36)}${rid(2)}`, role, title, state: 'running', startedAt: new Date().toISOString(), endedAt: null, exitCode: null };
  const ac = new AbortController();
  const fd = fs.openSync(logFile(job.id), 'a');
  let lastEmit = 0;
  const log = msg => {
    try { fs.writeSync(fd, `${String(msg).replace(/\n$/, '')}\n`); } catch { /* closed */ }
    const n = Date.now(); if (n - lastEmit > 1000) { lastEmit = n; events.emit(role, 'job', job.id, { id: job.id, state: job.state, progress: true }); }
  };
  const lineLogger = (which, l) => {
    const t = l.split('\r').filter(x => x.trim()).pop() || '';   // progress bars redraw with \r: keep the last state
    if (t) log(which === 'stderr' ? `! ${t.slice(0, 400)}` : t.slice(0, 400));
  };
  const ctx = {
    signal: ac.signal, log,
    run: (argv, o = {}) => run(argv, { timeoutMs: 3600e3, ...o, signal: ac.signal, onLine: lineLogger }),
    exec: async (argv, o = {}) => {
      log(`$ ${argv.join(' ')}`);
      const r = await ctx.run(argv, o);
      if (r.code !== 0) throw new Error(`${argv[0]} exited ${r.code}${r.timedOut ? ' (timeout)' : ''}`);
      return r;
    },
  };
  live.set(job.id, { job, ac });
  save(job);
  events.emit(role, 'job', job.id, { id: job.id, state: 'running', title });
  Promise.resolve().then(() => fn(ctx)).then(() => { job.exitCode = 0; if (job.state === 'running') job.state = 'done'; },
    e => { job.exitCode = job.exitCode ?? 1; if (job.state === 'running') job.state = 'failed'; log(`error: ${e.message}`); })
    .finally(() => {
      job.endedAt = new Date().toISOString(); try { fs.closeSync(fd); } catch { /* closed */ }
      live.delete(job.id); save(job);
      events.emit(role, 'job', job.id, { id: job.id, state: job.state, exitCode: job.exitCode, title });
    });
  return view(job, 20);
}

function list() {
  const out = [];
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.json')) { try { out.push(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))); } catch { /* skip */ } }
  out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  for (const j of out) { const l = live.get(j.id); if (l) Object.assign(j, l.job); }
  return out;
}
function get(id, tail = 200) {
  if (!/^j[a-z0-9]{3,20}$/.test(id)) throw new RackError('no such job', 'NOT_FOUND', 404);
  let job = live.get(id)?.job;
  if (!job) { try { job = JSON.parse(fs.readFileSync(metaFile(id), 'utf8')); } catch { throw new RackError('no such job', 'NOT_FOUND', 404); } }
  return view(job, Math.max(1, Math.min(5000, tail | 0)));
}
function cancel(id) {
  const l = live.get(id);
  if (!l) return get(id);
  l.job.state = 'cancelled'; l.ac.abort();
  return view(l.job, 50);
}
const runningCount = () => live.size;
module.exports = { runningCount, init, start, list, get, cancel, ok };
