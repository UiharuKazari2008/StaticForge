'use strict';
// builds: tracked builds. A run = fresh container on a persistent checkout, caches kept apart, whole record kept.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { run, ok } = require('../lib/exec');
const { DATA, str, num, bool, RE, bad, readJson, writeJson, rid } = require('../lib/util');
const jobs = require('../lib/jobs');
const events = require('../lib/events');
const storage = require('./storage');
const containers = require('./containers');

const packages = ['git', 'rsync'];
const BUILDS = '/srv/rack/builds';
const ARTIFACTS = '/srv/rack/artifacts';
const PIPE_DIR = path.join(DATA, 'builds', 'pipelines');
const RUN_DIR = path.join(DATA, 'builds', 'runs');
const PRESET_DIR = path.join(__dirname, '..', 'pipelines');
const CREDS = '/etc/rackd/git-credentials';
const ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const GLOB = /^[A-Za-z0-9_.\/*?{},-]{1,200}$/;
const active = new Map(); // pipelineId -> runId
// project registry: repos that carry their own pipelines in .rack/pipelines/<id>.json (see docs/rack-manager/builds-projects.md)
const PROJ_DIR = path.join(DATA, 'builds', 'projects');
const PROJ_CLONES = path.join(BUILDS, '_projects');
const PID = /^[a-z0-9][a-z0-9_-]{0,40}(\/[a-z0-9][a-z0-9_-]{0,40})?$/;
const REF = /^[A-Za-z0-9._\/-]{1,200}$/;
const slug = id => id.replace('/', '--');

function presets() {
  const out = {};
  try { for (const f of fs.readdirSync(PRESET_DIR)) if (f.endsWith('.json')) { const p = readJson(path.join(PRESET_DIR, f)); if (p?.id) out[p.id] = { ...p, preset: true, source: { builtin: true } }; } } catch { /* none */ }
  return out;
}
function userPipes() {
  const out = {};
  try { for (const f of fs.readdirSync(PIPE_DIR)) if (f.endsWith('.json')) { const p = readJson(path.join(PIPE_DIR, f)); if (p?.id) out[p.id] = { ...p, source: { user: true } }; } } catch { /* none */ }
  return out;
}
const projectFile = n => path.join(PROJ_DIR, `${n}.json`);
function projects() {
  const out = {};
  try { for (const f of fs.readdirSync(PROJ_DIR)) if (f.endsWith('.json')) { const r = readJson(path.join(PROJ_DIR, f)); if (r?.name) out[r.name] = r; } } catch { /* none */ }
  return out;
}
function projectPipes() {
  const out = {};
  for (const r of Object.values(projects())) for (const [lid, d] of Object.entries(r.pipelines || {})) out[`${r.name}/${lid}`] = { ...d, id: `${r.name}/${lid}`, localId: lid, trusted: !!r.trusted };
  return out;
}
const allPipes = () => ({ ...projectPipes(), ...presets(), ...userPipes() });
// privileged / secret mounts / run input only for shipped presets and for projects an operator marked trusted
const isTrusted = p => !!(p.preset || p.trusted);
function pipeline(id) { const p = allPipes()[str(id, 'pipeline', PID)]; if (!p) throw bad('no such pipeline', 'NOT_FOUND'); return p; }
// run params may set only the env names a pipeline lists in envParams
function paramEnv(p, params) {
  const out = {}; const allowed = new Set(p.envParams || []);
  for (const [k, v] of Object.entries(params.env || {})) { if (!allowed.has(k)) throw bad(`env ${k} is not a parameter of ${p.id}`); if (typeof v !== 'string' || v.includes('\0') || v.length > 4096) throw bad(`env ${k} is not valid`); out[k] = v; }
  return out;
}
const runFile = id => path.join(RUN_DIR, `${id}.json`);
function runs(limit = 100) {
  try { return fs.readdirSync(RUN_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit).map(f => readJson(path.join(RUN_DIR, f))).filter(Boolean); } catch { return []; }
}
const saveRun = r => writeJson(runFile(r.id), r);

function dockerfileText(p) {
  if (p.dockerfileText) return p.dockerfileText;
  if (p.dockerfileFile) return fs.readFileSync(path.join(PRESET_DIR, path.basename(p.dockerfileFile)), 'utf8');
  if (p.dockerfile) return p.dockerfile.includes('\n') ? p.dockerfile : fs.readFileSync(p.dockerfile, 'utf8');
  return null;
}
// image to run: p.image as is, or rack-build-<id>:<hash of the Dockerfile> (built when missing)
async function ensureImage(ctx, p, force) {
  const text = dockerfileText(p);
  if (!text) return p.image;
  const tag = `rack-build-${slug(p.id)}:${crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)}`;
  const have = await run(['docker', 'image', 'inspect', tag]);
  if (have.code === 0 && !force) { ctx.log(`image ${tag} exists`); return tag; }
  ctx.log(`building image ${tag}`);
  await ctx.exec(['docker', 'build', '-t', tag, '-'], { input: text, timeoutMs: 7200e3 });
  return tag;
}
const GIT = ['git', '-c', 'safe.directory=*', '-c', `credential.helper=store --file=${CREDS}`];
const gitEnv = { GIT_TERMINAL_PROMPT: '0' };

async function syncSource(ctx, p, ref, src) {
  fs.mkdirSync(path.dirname(src), { recursive: true });
  if (!fs.existsSync(path.join(src, '.git'))) { await ctx.exec([...GIT, 'clone', '--no-checkout', p.repo, src], { env: gitEnv, timeoutMs: 3600e3 }); }
  await ctx.exec([...GIT, '-C', src, 'remote', 'set-url', 'origin', p.repo]);
  await ctx.exec([...GIT, '-C', src, 'fetch', '--prune', '--tags', '--force', 'origin', '+refs/heads/*:refs/remotes/origin/*'], { env: gitEnv, timeoutMs: 3600e3 });
  const target = (await run([...GIT, '-C', src, 'rev-parse', '--verify', '--quiet', `origin/${ref}^{commit}`])).code === 0 ? `origin/${ref}` : ref;
  await ctx.exec([...GIT, '-C', src, 'checkout', '-f', '--detach', target]);
  await ctx.exec([...GIT, '-C', src, 'clean', '-ffdx']);
  const sha = (await ok([...GIT, '-C', src, 'rev-parse', 'HEAD'])).stdout.trim();
  await ctx.exec(['chown', '-R', 'rack:rack', src]);
  return sha;
}
async function collect(ctx, p, src, outDir, record) {
  fs.mkdirSync(outDir, { recursive: true });
  const seen = new Set();
  const add = file => {
    let name = path.basename(file); while (seen.has(name)) name = `${rid(1)}-${name}`; seen.add(name);
    fs.copyFileSync(file, path.join(outDir, name));
    record.artifacts.push({ name, file: `artifacts/${record.id}__${name}`, sizeB: fs.statSync(path.join(outDir, name)).size });
  };
  for (const g of p.artifacts || []) {
    const r = await run(['bash', '-O', 'globstar', '-O', 'nullglob', '-O', 'extglob', '-c', 'cd "$1" && for f in $2; do [ -f "$f" ] && printf "%s\\n" "$f"; done', '_', src, g], { timeoutMs: 60000 });
    for (const rel of r.stdout.split('\n').filter(Boolean)) add(path.join(src, rel));
  }
  for (const f of fs.readdirSync(outDir)) if (!seen.has(f)) { seen.add(f); record.artifacts.push({ name: f, file: `artifacts/${record.id}__${f}`, sizeB: fs.statSync(path.join(outDir, f)).size }); }
  ctx.log(`artifacts: ${record.artifacts.map(a => `${a.name} (${a.sizeB} B)`).join(', ') || 'none'}`);
}

function startRun(p, ref, by, params = {}) {
  if (active.has(p.id)) throw bad(`pipeline ${p.id} is already running (${active.get(p.id)})`, 'BUSY');
  const base = path.join(BUILDS, slug(p.id)); const src = path.join(base, 'src'); let cache = path.join(base, 'cache');
  const record = { id: null, pipeline: p.id, name: p.name, ref, commit: null, state: 'running', startedAt: new Date().toISOString(), endedAt: null, exitCode: null, by: by || null, artifacts: [], image: null };
  const job = jobs.start({ role: 'builds', title: `build ${p.id} @ ${ref}`, run: async ctx => {
    const ct = `rackbuild-${record.id}`; let ram = null;
    const onAbort = () => run(['docker', 'kill', ct]);
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      for (const d of [BUILDS, ARTIFACTS]) if (!fs.existsSync(d)) throw new Error(`${d} is missing (install the builds role)`);
      fs.mkdirSync(cache, { recursive: true });
      record.image = await ensureImage(ctx, p);
      record.commit = await syncSource(ctx, p, ref, src); saveRun(record);
      ctx.log(`commit ${record.commit}`);
      if (p.cacheRamdisk) {
        try { ram = `build-${slug(p.id)}`; await storage.actions['ramdisk-create']({ name: ram, sizeGB: p.cacheRamdisk, owner: 'rack', backing: cache, persist: false }); cache = `/mnt/ram/${ram}`; ctx.log(`cache on RAM disk ${ram}`); }
        catch (e) { ctx.log(`no RAM disk for the cache (${e.message}); using the disk`); ram = null; }
      }
      const outDir = path.join(ARTIFACTS, record.id, 'out'); fs.mkdirSync(outDir, { recursive: true });
      const uid = (await ok(['id', '-u', 'rack'])).stdout.trim(), gid = (await ok(['id', '-g', 'rack'])).stdout.trim();
      await ok(['chown', '-R', `${uid}:${gid}`, outDir, cache]);
      // privileged pipelines (DreamOS: mkosi needs loop devices, repart, mounts) run as root with the host's /dev; shipped presets only
      const priv = !!(isTrusted(p) && p.privileged);
      // a container with a secret mount runs as root too (the secrets folder is root-only), still without --privileged
      const asRoot = priv || (isTrusted(p) && (p.secrets || []).length > 0);
      const args = ['run', '--rm', '--name', ct, '--user', asRoot ? '0:0' : `${uid}:${gid}`, '--label', `rack.run=${record.id}`, '--label', `rack.pipeline=${p.id}`,
        '-v', `${src}:/work/src`, '-v', `${outDir}:/out`, '-v', `${cache}:/cache`, '-w', '/work/src', '-e', 'HOME=/cache/home', '-e', 'RACK_OUT=/out', '-e', `RACK_COMMIT=${record.commit}`];
      if (priv) { args.push('--privileged'); if (p.devMount) args.push('-v', '/dev:/dev'); }
      // secrets: /etc/rackd/secrets/<name> mounted read-only at /secrets, only for a shipped preset that lists the name
      if (isTrusted(p)) for (const s of p.secrets || []) { if (!ID.test(s)) throw new Error('bad secret name'); args.push('-v', `/etc/rackd/secrets/${s}:/secrets:ro`); }
      // input: an earlier run's output, read-only at /in (a signing step reads the unsigned build)
      if (isTrusted(p) && p.acceptsInput && params.input) { const inDir = path.join(ARTIFACTS, params.input, 'out'); if (!fs.existsSync(inDir)) throw new Error(`no output of run ${params.input}`); args.push('-v', `${inDir}:/in:ro`); record.input = params.input; }
      if (p.cpus) args.push('--cpus', String(p.cpus));
      if (p.memGB) args.push('--memory', `${Math.round(p.memGB * 1024)}m`);
      for (const [k, v] of Object.entries({ ...(p.env || {}), ...paramEnv(p, params) })) args.push('-e', `${k}=${v}`);
      args.push(record.image, 'bash', '-eo', 'pipefail', '-c', `mkdir -p /cache/home\n${p.script}`);
      await ctx.exec(['docker', ...args], { timeoutMs: (p.timeoutMin || 120) * 60000 });
      await collect(ctx, p, src, outDir, record);
      record.state = 'done'; record.exitCode = 0;
    } catch (e) {
      record.state = ctx.signal.aborted ? 'cancelled' : 'failed'; record.exitCode = record.exitCode ?? 1;
      try { await collect(ctx, p, src, path.join(ARTIFACTS, record.id, 'out'), record); } catch { /* none */ }
      throw e;
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      await run(['docker', 'rm', '-f', ct]);
      if (ram) await storage.actions['ramdisk-delete']({ name: ram, sync: true }).catch(e => ctx.log(`ramdisk sync: ${e.message}`));
      record.endedAt = new Date().toISOString(); saveRun(record); active.delete(p.id);
      events.emit('builds', 'state', record.id, { id: record.id, pipeline: p.id, state: record.state });
    }
  } });
  record.id = job.id; active.set(p.id, job.id); saveRun(record);
  return job;
}

// ---- project registry ----
const locks = new Map();
const withLock = (name, fn) => { const prev = locks.get(name) || Promise.resolve(); const next = prev.catch(() => {}).then(fn); locks.set(name, next); next.finally(() => { if (locks.get(name) === next) locks.delete(name); }).catch(() => {}); return next; };
const cloneDir = name => path.join(PROJ_CLONES, name);
const projectBrief = r => ({ name: r.name, repo: r.repo, ref: r.ref, trusted: !!r.trusted, fetchedAt: r.fetchedAt || null, commit: r.commit || null, pipelines: Object.keys(r.pipelines || {}).map(i => `${r.name}/${i}`), errors: r.errors || [] });
async function fetchClone(name, repo) {
  const dir = cloneDir(name); fs.mkdirSync(PROJ_CLONES, { recursive: true });
  if (!fs.existsSync(path.join(dir, '.git'))) await ok([...GIT, 'clone', '--no-checkout', repo, dir], { env: gitEnv, timeoutMs: 600e3 });
  await ok([...GIT, '-C', dir, 'remote', 'set-url', 'origin', repo]);
  await ok([...GIT, '-C', dir, 'fetch', '--prune', '--tags', '--force', 'origin', '+refs/heads/*:refs/remotes/origin/*'], { env: gitEnv, timeoutMs: 600e3 });
  return dir;
}
async function resolveRef(dir, ref) {
  if (!ref) {
    const h = await run([...GIT, '-C', dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    if (h.code === 0 && h.stdout.trim()) ref = h.stdout.trim().replace(/^origin\//, '');
    else { const b = await ok([...GIT, '-C', dir, 'for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']); ref = (b.stdout.split('\n').map(x => x.trim().replace(/^origin\//, '')).find(x => x && x !== 'HEAD')) || 'main'; }
  }
  const target = (await run([...GIT, '-C', dir, 'rev-parse', '--verify', '--quiet', `origin/${ref}^{commit}`])).code === 0 ? `origin/${ref}` : ref;
  const commit = (await ok([...GIT, '-C', dir, 'rev-parse', '--verify', `${target}^{commit}`])).stdout.trim();
  return { ref, commit };
}
const DFPATH = /^[A-Za-z0-9_.\/-]{1,200}$/;
// one .rack/pipelines/*.json -> a clean pipeline definition (only known fields; the repo is always the project's)
function cleanDef(raw, reg, file, commit, dockerText) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a JSON object');
  const id = str(raw.id || path.basename(file, '.json'), 'id', ID);
  const d = { id, name: str(raw.name || id, 'name', null, 100), repo: reg.repo, ref: raw.ref ? str(raw.ref, 'ref', REF) : reg.ref, script: str(raw.script, 'script', null, 100000), artifacts: (Array.isArray(raw.artifacts) ? raw.artifacts : []).map(g => str(g, 'artifact glob', GLOB)).filter(g => !g.split('/').includes('..')), env: {}, source: { project: reg.name, repo: reg.repo, ref: reg.ref, path: file, commit } };
  if (raw.image) d.image = str(raw.image, 'image', /^[A-Za-z0-9][A-Za-z0-9._\/:@-]{0,255}$/);
  if (raw.dockerfile) { const f = str(raw.dockerfile, 'dockerfile', DFPATH); if (f.startsWith('/') || f.split('/').includes('..')) throw new Error('dockerfile must be a path inside the repo'); d.dockerfilePath = f; d.dockerfileText = dockerText(f); }
  if (!d.image && !d.dockerfileText) throw new Error('image or dockerfile is required');
  if (raw.cpus) d.cpus = num(raw.cpus, 'cpus', 1, 240); if (raw.memGB) d.memGB = num(raw.memGB, 'memGB', 1, 480);
  if (raw.cacheRamdisk) d.cacheRamdisk = num(raw.cacheRamdisk, 'cacheRamdisk', 1, 400);
  if (raw.timeoutMin) d.timeoutMin = num(raw.timeoutMin, 'timeoutMin', 1, 4320);
  for (const [k, v] of Object.entries(raw.env || {})) { if (!RE.envName.test(k) || typeof v !== 'string' || v.includes('\0')) throw new Error(`env ${k} is not valid`); d.env[k] = v; }
  d.envParams = (Array.isArray(raw.envParams) ? raw.envParams : []).map(k => { if (!RE.envName.test(k)) throw new Error(`envParams ${k} is not valid`); return k; });
  // honoured only while the operator marks the project trusted (isTrusted)
  if (raw.privileged) d.privileged = true; if (raw.devMount) d.devMount = true; if (raw.acceptsInput) d.acceptsInput = true;
  d.secrets = (Array.isArray(raw.secrets) ? raw.secrets : []).map(s => str(s, 'secret name', ID));
  return d;
}
// read every pipeline of the project at ref from the fetched clone: { ref, commit, pipelines, errors }
async function readProject(reg, ref) {
  const dir = cloneDir(reg.name); const { ref: rf, commit } = await resolveRef(dir, ref);
  const ls = await run([...GIT, '-C', dir, 'ls-tree', '--name-only', commit, '.rack/pipelines/']);
  const files = ls.code === 0 ? ls.stdout.split('\n').map(x => x.trim()).filter(x => x.endsWith('.json')) : [];
  const show = async f => (await ok([...GIT, '-C', dir, 'show', `${commit}:${f}`])).stdout;
  const pipelines = {}; const errors = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(await show(f)); const texts = {};
      if (raw && raw.dockerfile && DFPATH.test(String(raw.dockerfile)) && !String(raw.dockerfile).startsWith('/') && !String(raw.dockerfile).split('/').includes('..')) texts[raw.dockerfile] = await show(raw.dockerfile);
      const d = cleanDef(raw, { ...reg, ref: rf }, f, commit, p => { if (texts[p] === undefined) throw new Error(`dockerfile ${p} not found`); return texts[p]; });
      if (pipelines[d.id]) throw new Error(`duplicate id ${d.id}`);
      pipelines[d.id] = d;
    } catch (e) { errors.push(`${f}: ${String(e.message || e).slice(0, 300)}`); }
  }
  return { ref: rf, commit, pipelines, errors };
}
const refreshProject = (reg, ref) => withLock(reg.name, async () => {
  await fetchClone(reg.name, reg.repo);
  const r = await readProject(reg, ref || reg.ref);
  const next = { ...reg, ref: ref ? r.ref : reg.ref, fetchedAt: new Date().toISOString(), commit: r.commit, pipelines: r.pipelines, errors: r.errors };
  if (!ref || r.ref === reg.ref) { writeJson(projectFile(reg.name), next); events.emit('builds', 'project', reg.name, { name: reg.name }); }
  return { reg: next, read: r };
});
// before every run of a project pipeline: fetch and re-read its file at the run's ref
async function freshPipeline(pl, ref) {
  const reg = projects()[pl.source.project]; if (!reg) throw bad('the project of this pipeline is no longer registered', 'NOT_FOUND');
  const { read } = await refreshProject(reg, ref === reg.ref ? null : ref);
  const d = read.pipelines[pl.localId]; if (!d) throw bad(`pipeline ${pl.localId} is not in ${reg.name} at ${ref}${read.errors.length ? ` (${read.errors.join('; ')})` : ''}`, 'NOT_FOUND');
  return { ...d, id: pl.id, localId: pl.localId, trusted: !!reg.trusted };
}
const projectName = repo => path.basename(repo).replace(/\.git$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 40);

module.exports = {
  id: 'builds', packages,
  count: () => active.size,
  async busy() { return [...active].map(([p, r]) => ({ kind: 'build', id: r, why: `pipeline ${p} running` })); },
  async preInstall(ctx) {
    for (const [name, sizeGB, mount] of [['rackbuilds', 500, BUILDS], ['rackartifacts', 200, ARTIFACTS]]) {
      if (!fs.existsSync(mount) || !(await run(['findmnt', '-n', mount])).stdout.trim()) {
        ctx.log(`creating LV ${name} (${sizeGB} GB) in vmdata at ${mount}`);
        await storage.actions['lv-create']({ vg: 'vmdata', name, sizeGB, fs: 'ext4', mount });
      }
    }
    fs.mkdirSync(PIPE_DIR, { recursive: true }); fs.mkdirSync(RUN_DIR, { recursive: true });
  },
  async install(ctx) {
    // the containers role must be installed first
    if (!fs.existsSync('/var/run/docker.sock')) throw new Error('install the containers role first');
    ctx.log('builds role ready');
  },
  init() { fs.mkdirSync(PIPE_DIR, { recursive: true }); fs.mkdirSync(RUN_DIR, { recursive: true }); for (const r of runs(50)) if (r.state === 'running' && !jobsRunning(r.id)) { r.state = 'failed'; r.endedAt = new Date().toISOString(); saveRun(r); } },
  async detect() {
    const miss = []; for (const d of [BUILDS, ARTIFACTS]) if (!fs.existsSync(d) || !(await run(['findmnt', '-n', d])).stdout.trim()) miss.push(d);
    const dk = fs.existsSync('/var/run/docker.sock');
    return { installed: !miss.length && dk, ready: !miss.length && dk, summary: `${Object.keys(allPipes()).length} pipeline(s), ${active.size} running${miss.length ? ', LVs missing' : ''}`, missing: [...(dk ? [] : ['containers role']), ...miss] };
  },
  async get() {
    const rs = runs(100); const last = {}; for (const r of rs) if (!last[r.pipeline]) last[r.pipeline] = { id: r.id, state: r.state, ref: r.ref, endedAt: r.endedAt };
    return {
      pipelines: Object.values(allPipes()).map(p => ({ id: p.id, name: p.name, repo: p.repo, ref: p.ref, image: p.image || null, dockerfile: !!(p.dockerfile || p.dockerfileFile || p.dockerfileText), cpus: p.cpus || null, memGB: p.memGB || null, cacheRamdisk: p.cacheRamdisk || null, artifacts: p.artifacts || [], preset: !!p.preset, source: p.source || null, project: p.source?.project || null, trusted: isTrusted(p), lastRun: last[p.id] || null })),
      projects: Object.values(projects()).map(projectBrief),
      runs: rs.map(({ id, pipeline, ref, commit, state, startedAt, endedAt, exitCode, by, artifacts }) => ({ id, pipeline, ref, commit, state, startedAt, endedAt, exitCode, by, artifacts })),
    };
  },
  actions: {
    async 'pipeline-define'(p) {
      const id = str(p.id, 'id', ID);
      if (presets()[id]) throw bad('that id belongs to a shipped preset', 'EXISTS');
      if (!p.image && !p.dockerfile) throw bad('image or dockerfile is required');
      const def = { id, name: str(p.name, 'name', null, 100), repo: str(p.repo, 'repo', /^https:\/\/[^\s'"]+$/, 500), ref: str(p.ref || 'main', 'ref', /^[A-Za-z0-9._\/-]{1,200}$/), script: str(p.script, 'script', null, 100000), artifacts: (Array.isArray(p.artifacts) ? p.artifacts : []).map(g => str(g, 'artifact glob', GLOB)).filter(g => !g.split('/').includes('..')) };
      if (p.image) def.image = str(p.image, 'image', /^[A-Za-z0-9][A-Za-z0-9._\/:@-]{0,255}$/);
      if (p.dockerfile) def.dockerfile = str(p.dockerfile, 'dockerfile', null, 100000);
      if (p.cpus) def.cpus = num(p.cpus, 'cpus', 1, 240); if (p.memGB) def.memGB = num(p.memGB, 'memGB', 1, 480);
      if (p.cacheRamdisk) def.cacheRamdisk = num(p.cacheRamdisk, 'cacheRamdisk', 1, 400);
      if (p.timeoutMin) def.timeoutMin = num(p.timeoutMin, 'timeoutMin', 1, 4320);
      def.env = {}; for (const [k, v] of Object.entries(p.env || {})) { if (!RE.envName.test(k) || typeof v !== 'string' || v.includes('\0')) throw bad(`env ${k} is not valid`); def.env[k] = v; }
      writeJson(path.join(PIPE_DIR, `${id}.json`), def); events.emit('builds', 'added', id, { id });
      return { id };
    },
    async projects() { return { projects: Object.values(projects()).map(projectBrief) }; },
    async 'project-register'(p) {
      const repo = str(p.repo, 'repo', /^https:\/\/[^\s'"]+$/, 500);
      const name = str(p.name || projectName(repo), 'name', ID); if (name.includes('/')) throw bad('name is not valid');
      const have = projects()[name]; if (have && have.repo !== repo) throw bad(`project ${name} is registered with another repository`, 'EXISTS');
      const ref = p.ref ? str(p.ref, 'ref', REF) : null;
      const reg = have || { name, repo, ref: null, trusted: false, pipelines: {} };
      await withLock(name, () => fetchClone(name, repo));
      const r0 = await withLock(name, () => readProject(reg, ref || reg.ref));
      await refreshProject({ ...reg, ref: r0.ref });
      return projectBrief(projects()[name]);
    },
    async 'project-refresh'(p) {
      const all = projects(); const names = p.name ? [str(p.name, 'name', ID)] : Object.keys(all);
      for (const n of names) if (!all[n]) throw bad('no such project', 'NOT_FOUND');
      for (const n of names) await refreshProject(all[n]);
      const now = projects(); return { projects: names.map(n => projectBrief(now[n])) };
    },
    async 'project-unregister'(p) {
      const name = str(p.name, 'name', ID); if (!projects()[name]) throw bad('no such project', 'NOT_FOUND');
      for (const id of active.keys()) if (id.startsWith(`${name}/`)) throw bad(`pipeline ${id} is running`, 'BUSY');
      await withLock(name, async () => { try { fs.unlinkSync(projectFile(name)); } catch { /* gone */ } await run(['rm', '-rf', cloneDir(name)]); });
      events.emit('builds', 'project', name, { name }); return { ok: true };
    },
    // privileged containers, secret mounts and run input are honoured only for a trusted project
    async 'project-trust'(p) {
      const name = str(p.name, 'name', ID); const reg = projects()[name]; if (!reg) throw bad('no such project', 'NOT_FOUND');
      reg.trusted = bool(p.trusted, false); writeJson(projectFile(name), reg); events.emit('builds', 'project', name, { name }); return projectBrief(reg);
    },
    async 'pipeline-delete'(p) {
      if (typeof p.id === 'string' && p.id.includes('/')) throw bad('a project pipeline is removed from its repo; unregister the project to drop it', 'PROTECTED');
      const id = str(p.id, 'id', ID); if (presets()[id] && !userPipes()[id]) throw bad('shipped presets cannot be deleted', 'PROTECTED');
      try { fs.unlinkSync(path.join(PIPE_DIR, `${id}.json`)); } catch { throw bad('no such pipeline', 'NOT_FOUND'); }
      events.emit('builds', 'removed', id, { id }); return { ok: true };
    },
    // Builds (or rebuilds) the pipeline's image without running it.
    async 'image-build'(p) {
      const pl = pipeline(p.pipeline);
      return { job: jobs.start({ role: 'builds', title: `image for ${pl.id}`, run: async ctx => { const t = await ensureImage(ctx, pl, bool(p.force, false)); ctx.log(`image ${t}`); } }) };
    },
    async run(p) {
      let pl = pipeline(p.pipeline);
      const ref = str(p.ref || pl.ref || 'main', 'ref', REF);
      if (pl.source?.project) pl = await freshPipeline(pl, ref);
      const input = p.input ? str(p.input, 'input', /^j[a-z0-9]{3,20}$/) : null;
      return { job: startRun(pl, ref, p.by ? str(String(p.by), 'by', null, 100) : null, { input, env: p.env }) };
    },
    async cancel(p) {
      const id = str(p.run, 'run', /^j[a-z0-9]{3,20}$/); const j = jobs.cancel(id); return { job: j };
    },
    async 'run-get'(p) {
      const id = str(p.run, 'run', /^j[a-z0-9]{3,20}$/); const rec = readJson(runFile(id)); if (!rec) throw bad('no such run', 'NOT_FOUND');
      let log = ''; try { log = jobs.get(id, num(p.tail, 'tail', 1, 5000, 200)).log; } catch { /* log gone */ }
      return { ...rec, log };
    },
    async 'artifact-remove'(p) {
      const id = str(p.run, 'run', /^j[a-z0-9]{3,20}$/); const rec = readJson(runFile(id)); if (!rec) throw bad('no such run', 'NOT_FOUND');
      await run(['rm', '-rf', path.join(ARTIFACTS, id)]); rec.artifacts = []; saveRun(rec); return { ok: true };
    },
  },
};
function jobsRunning(id) { try { return jobs.get(id).state === 'running'; } catch { return false; } }
