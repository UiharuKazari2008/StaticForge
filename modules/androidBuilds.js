'use strict';

/**
 * Android app builds from the server (StaticForge #821): one build job that turns DSApp-Kotlin's origin/main plus every
 * unmerged branch into a versioned, release-signed APK, keeps the APKs and the release list, and tells the rest of the
 * server (the ActiveSync delivery, part 2) when a new release exists.
 *
 *   POST /api/android-builds             admin: { note?, agentId? } -> { id, state: 'running' }; 409 BUSY while a build
 *                                        runs (names its id), 409 GATE_OPEN while another agent's build gate for
 *                                        DSApp-Kotlin is open or running (the caller's own gate, agentId, does not block)
 *   GET  /api/android-builds             admin: { builds: [Release], jobs: [Job], current, workers, latest }
 *   GET  /api/android-builds/:id         admin: the job (state, step, error, log tail ?lines=n up to 400) and its release
 *   GET  /api/android-builds/:id/apk     admin: the APK (410 once it is one of the old ones that were pruned)
 *
 * The job (one at a time):
 *   1. worker    the first configured worker that is ready (ssh host reachable in 5 s; local needs javaHome, androidHome,
 *                keystore). None ready: the build fails at once ("Ruiko unreachable").
 *   2. source    the module's own clone data/android-builds/repo (never a session's checkout): scripts/android/
 *                dsapp-merge-latest.sh fetches, makes build/latest from origin/main, merges every unmerged branch (known
 *                conflicts resolved the way the manual joint build does), then versionCode = max(last release + 1,
 *                highest phone-reported + 1, minutes since 2020-01-01 UTC), versionName 1.0.<versionCode>, written to
 *                gradle.properties in a "build N" commit, and build/latest is force-pushed with the push token file.
 *   3. build     ssh worker: git archive zip -> scripts/android/dsapp-remote-build.sh under flock on the manual joint
 *                build's lock; local worker: gradlew assembleRelease + apksigner. The APK is hashed, stored as
 *                apk/<versionCode>-<sha7>.apk (last 10 kept), the Release is published and 'release' is emitted.
 *   While it runs the server holds its own agent-coord gate (target dsapp-apk, repo DSApp-Kotlin) so agents see it.
 *
 * Config (secure.config.json, key androidBuilds): { workers: [{ id, kind: 'ssh', host, dir, folder, script } |
 *   { id, kind: 'local', javaHome, androidHome, keystore, alias?, storePassword? }], pushTokenFile, repoUrl?, skipBranches? }.
 *   Default worker: ruiko over ssh, C:/Users/ykaza/claude-build, folder dsapp-latest, build-latest.ps1.
 *
 * Phones: part 2 calls recordDeviceVersion at every hello (the next versionCode stays above any phone's),
 * recordDelivery / deliveryOf for the push state, and listens to 'release' (no polling, server-push-not-polling).
 * Agents: the dsapp_build MCP tool (modules/agentCoord/mcpServer.js) talks to this module over a unix socket next to
 * the agent-coord database (android-builds.sock, 0600, like the Supervisor's).
 *
 * Release = { id, versionCode, versionName, sha, branches: [{ name, sha }], commits: [{ sha, subject }], apkFile,
 *   sha256, size, worker, createdAt }. Data: data/android-builds/ (builds.json, apk/, repo/, work/).
 */

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { isAdminUser } = require('./auth');

const ROOT = path.join(__dirname, '..', 'data', 'android-builds');
const SCRIPTS = path.join(__dirname, '..', 'scripts', 'android');
const REPO_URL = 'https://yozora.bluesteel.737.jp.net/DreamScape/DSApp-Kotlin.git';
const PUSH_USER = 'director.yozora';
const DEFAULT_PUSH_TOKEN_FILE = '/home/kanmi/.secrets/yozora-yozora.token';
const JOINT_LOCK = path.join(os.homedir(), '.cache', 'claude-run', 'dsapp-joint-build.lock');
const COORD_REPO = 'DSApp-Kotlin';
const GATE_TARGET = 'dsapp-apk';
const GATE_AGENT = 'dreamscape-android-builds';
const GATE_NAME = 'Dreamscape Android builds';
const EPOCH_MS = Date.UTC(2020, 0, 1);
const LOG_LINES = 400;
const KEEP_APKS = 10;
const KEEP_RELEASES = 50;
const KEEP_JOBS = 20;
const MAX_COMMITS = 200;
const GIT_ID = ['-c', 'user.name=Dreamscape Android builds', '-c', 'user.email=android-builds@yozora.bluesteel.737.jp.net'];
const LOCAL_NEEDS = 'not configured: needs javaHome, androidHome and keystore (debug key 5c7b3ecc)';

const DEFAULT_WORKER = { id: 'ruiko', kind: 'ssh', host: 'ruiko', dir: 'C:/Users/ykaza/claude-build', folder: 'dsapp-latest', script: 'build-latest.ps1' };

const events = new EventEmitter();
const T = { root: null, exec: null, coord: null, config: null, socket: null }; // test hooks
let gResources = null;
let index = { nextId: 1, releases: [], jobs: [], devices: {}, deliveries: {} };
let job = null; // the running job (one at a time)
let saving = Promise.resolve();
let saveTimer = null;
let sockServer = null;

function root() { return T.root || ROOT; }
function indexFile() { return path.join(root(), 'builds.json'); }
function apkDir() { return path.join(root(), 'apk'); }
function repoDir() { return path.join(root(), 'repo'); }
function workDir() { return path.join(root(), 'work'); }

// ---------------------------------------------------------------- store (builds.json)

function loadIndex() { // startup (and tests): a small file, read once
    let doc = null;
    try { doc = JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch (_) { doc = null; }
    doc = doc && typeof doc === 'object' ? doc : {};
    index = {
        nextId: Number.isInteger(doc.nextId) && doc.nextId > 0 ? doc.nextId : 1,
        releases: Array.isArray(doc.releases) ? doc.releases : [],
        jobs: Array.isArray(doc.jobs) ? doc.jobs : [],
        devices: doc.devices && typeof doc.devices === 'object' ? doc.devices : {},
        deliveries: doc.deliveries && typeof doc.deliveries === 'object' ? doc.deliveries : {}
    };
    const top = Math.max(0, ...index.releases.map((r) => r.id || 0), ...index.jobs.map((j) => j.id || 0));
    if (index.nextId <= top) index.nextId = top + 1;
}

async function writeAtomic(file, data) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, file);
}

/** Writes builds.json after the writes queued before it (never two at once). */
function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const file = indexFile();
    const body = JSON.stringify(index);
    saving = saving.then(() => writeAtomic(file, body)).catch((e) => { console.warn(`[androidBuilds] save failed: ${e.message}`); });
    return saving;
}

/** Device versions and deliveries change at every phone hello: one write a second at most. */
function saveSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveNow(); }, 1000);
    if (saveTimer.unref) saveTimer.unref();
}

function flush() { return saveTimer ? saveNow() : saving; }

function latestRelease() {
    return index.releases.length ? index.releases[index.releases.length - 1] : null;
}

function releaseById(id) { return index.releases.find((r) => r.id === id) || null; }

function releaseApkPath(release) {
    return path.join(apkDir(), String(release && release.apkFile || ''));
}

function recordDeviceVersion(deviceId, info) {
    const id = String(deviceId || '');
    const vc = Number(info && info.versionCode);
    if (!id || !Number.isInteger(vc) || vc <= 0) return;
    const cur = index.devices[id];
    const name = String((info && info.name) || (cur && cur.name) || '').slice(0, 80);
    const versionName = String((info && info.versionName) || '').slice(0, 40);
    if (cur && cur.versionCode === vc && cur.versionName === versionName && cur.name === name) return;
    index.devices[id] = { versionCode: vc, versionName, name, at: new Date().toISOString() };
    saveSoon();
}

/** The version a phone's background service reported at its last hello ({ versionCode, versionName } | null). */
function deviceVersionOf(deviceId) {
    const d = index.devices[String(deviceId || '')];
    return d && d.versionCode > 0 ? { versionCode: d.versionCode, versionName: d.versionName || '' } : null;
}

function maxReportedVersionCode() {
    let max = 0;
    for (const d of Object.values(index.devices)) if (d && d.versionCode > max) max = d.versionCode;
    return max;
}

// 'waiting': the app has the update staged and waits for a silent install route (Shizuku / 5555), #1309; detail { attempts, why }
const DELIVERY_STATES = ['sending', 'staged', 'waiting', 'failed', 'installed'];
function recordDelivery(deviceId, versionCode, state, detail) {
    const id = String(deviceId || '');
    if (!id || !DELIVERY_STATES.includes(state)) return;
    index.deliveries[id] = { versionCode: Number(versionCode) || 0, state, at: new Date().toISOString(), detail: detail === undefined || detail === null ? '' : String(detail).slice(0, 300) };
    saveSoon();
}

function deliveryOf(deviceId) {
    return index.deliveries[String(deviceId || '')] || null;
}

// ---------------------------------------------------------------- config

function normWorker(w) {
    if (!w || typeof w !== 'object' || !/^[a-z0-9_-]{1,32}$/.test(String(w.id || ''))) return null;
    const kind = w.kind === 'local' ? 'local' : 'ssh';
    const cap = String(w.name || w.id).replace(/^./, (c) => c.toUpperCase());
    if (kind === 'local') return { id: w.id, kind, name: cap, javaHome: w.javaHome || '', androidHome: w.androidHome || '', keystore: w.keystore || '', alias: w.alias || 'androiddebugkey', storePassword: w.storePassword || 'android' };
    return { id: w.id, kind, name: cap, host: String(w.host || ''), dir: String(w.dir || ''), folder: String(w.folder || 'dsapp-latest'), script: String(w.script || 'build-latest.ps1') };
}

function config() {
    let raw;
    if (T.config) raw = T.config;
    else {
        try { raw = gResources && typeof gResources.getSecureConfig === 'function' ? gResources.getSecureConfig({ path: 'androidBuilds' }) : undefined; } catch (_) { raw = undefined; }
    }
    raw = raw && typeof raw === 'object' ? raw : {};
    let workers = (Array.isArray(raw.workers) ? raw.workers : []).map(normWorker).filter(Boolean);
    if (!workers.length) workers = [normWorker(DEFAULT_WORKER)];
    return {
        workers,
        pushTokenFile: String(raw.pushTokenFile || DEFAULT_PUSH_TOKEN_FILE),
        repoUrl: String(raw.repoUrl || REPO_URL),
        skipBranches: Array.isArray(raw.skipBranches) ? raw.skipBranches.map(String).filter(Boolean) : []
    };
}

/** Why a worker's configuration can never build, or '' (reachability is checked at the start of a job). */
function workerProblem(w) {
    if (w.kind === 'local') {
        if (!w.javaHome || !w.androidHome || !w.keystore) return LOCAL_NEEDS;
        return '';
    }
    if (!/^[A-Za-z0-9._@-]+$/.test(w.host)) return 'bad host in config';
    if (!/^[A-Za-z0-9._:/-]+$/.test(w.dir)) return 'bad dir in config';
    if (!/^[A-Za-z0-9._-]+$/.test(w.folder) || !/^[A-Za-z0-9._-]+$/.test(w.script)) return 'bad folder or script in config';
    return '';
}

// ---------------------------------------------------------------- exec layer (the one thing tests replace)

/**
 * Runs a program (never a shell string): resolves { code, out } once it ends; lines are handed to onLine as they come.
 * opts: cwd, env (added to the process env), timeoutMs. A timeout kills the process group (code -1).
 */
function defaultExec(file, args, opts = {}) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(file, args, { cwd: opts.cwd, env: Object.assign({}, process.env, opts.env || {}), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
        } catch (e) { resolve({ code: -1, out: e.message }); return; }
        let out = '';
        let pend = '';
        const eat = (chunk) => {
            const s = chunk.toString('utf8');
            if (out.length < 2 * 1024 * 1024) out += s;
            if (!opts.onLine) return;
            pend += s;
            const parts = pend.split(/\r?\n/);
            pend = parts.pop();
            parts.forEach((l) => opts.onLine(l));
        };
        child.stdout.on('data', eat);
        child.stderr.on('data', eat);
        const timer = opts.timeoutMs ? setTimeout(() => {
            out += '\n[timed out]';
            try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { try { child.kill('SIGKILL'); } catch (__) { /* gone */ } }
        }, opts.timeoutMs) : null;
        child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ code: -1, out: `${out}${e.message}` }); });
        child.on('close', (code, sig) => {
            if (timer) clearTimeout(timer);
            if (pend && opts.onLine) opts.onLine(pend);
            resolve({ code: code === null ? (sig ? -1 : 0) : code, out });
        });
    });
}

function exec(file, args, opts) { return (T.exec || defaultExec)(file, args, opts || {}); }

/** git credentials for every git call: the push token is read from its file when git asks, never put on a command line. */
function gitEnv(cfg) {
    return {
        GIT_TERMINAL_PROMPT: '0',
        DSAPP_PUSH_TOKEN_FILE: cfg.pushTokenFile,
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'credential.helper',
        GIT_CONFIG_VALUE_0: '',
        GIT_CONFIG_KEY_1: 'credential.helper',
        GIT_CONFIG_VALUE_1: `!f(){ echo username=${PUSH_USER}; echo "password=$(tr -d "[:space:]" < "$DSAPP_PUSH_TOKEN_FILE")"; }; f`
    };
}

// ---------------------------------------------------------------- the agent-coord gate

function coord() {
    if (T.coord) return T.coord;
    return require('./agentCoord/store');
}

/** Gates in DSApp-Kotlin held by someone else (open or running). A store failure never blocks or crashes. */
function foreignGates(agentId) {
    let list = [];
    try { list = coord().builds({ repo: COORD_REPO }) || []; } catch (e) { return { gates: [], error: e.message }; }
    const gates = list.map((b) => b.build).filter((b) => b && (b.state === 'open' || b.state === 'running') && b.requestedBy !== GATE_AGENT);
    const mine = gates.filter((b) => agentId && b.requestedBy === agentId);
    return { gates: gates.filter((b) => !(agentId && b.requestedBy === agentId)), own: mine, error: '' };
}

function gateUpdate(j, task, status) {
    try { coord().upsertAgent({ id: GATE_AGENT, kind: 'other', name: GATE_NAME, task, status: status || 'active' }); } catch (_) { /* heartbeat only */ }
}

function gateStart(j, note) {
    try {
        const c = coord();
        const f = foreignGates(j.agentId);
        if (f.own && f.own.length) { j.log(`covered by ${j.agentId}'s own build gate ${f.own[0].id}; the server holds none`); return; }
        gateUpdate(j, `Android build ${j.id}`);
        const r = c.buildRequest(GATE_AGENT, { target: GATE_TARGET, repo: COORD_REPO, note: `server build ${j.id}${note ? `: ${note}` : ''}`.slice(0, 280) });
        let b = c.buildBegin(GATE_AGENT, r.build.id, {});
        if (!b.began) {
            // the build runs from the pushed branches in the server's own clone: nobody's working files are in it
            b = c.buildBegin(GATE_AGENT, r.build.id, { force: true, reason: 'the server builds from origin in its own clone; uncommitted files are not in it' });
        }
        j.gateId = r.build.id;
        j.log(`build gate ${j.gateId} held (${GATE_TARGET} in ${COORD_REPO})`);
    } catch (e) { j.gateId = 0; j.log(`agent-coord gate unavailable: ${e.message}`); }
}

function gateEnd(j, result) {
    if (!j.gateId) return;
    try { coord().buildEnd(GATE_AGENT, j.gateId, result); } catch (_) { /* lapses by itself */ }
    gateUpdate(j, '', 'idle');
}

// ---------------------------------------------------------------- the job

function newJob(note, agentId) {
    const j = {
        id: index.nextId++, state: 'running', step: 'starting', note: String(note || '').slice(0, 300), agentId: String(agentId || ''),
        startedAt: new Date().toISOString(), endedAt: null, error: '', worker: '', releaseId: 0, gateId: 0, lines: [],
        log(line) {
            String(line).split(/\r?\n/).forEach((l) => {
                if (!l) return;
                j.lines.push(l.length > 400 ? `${l.slice(0, 400)}...` : l);
                if (j.lines.length > LOG_LINES) j.lines.splice(0, j.lines.length - LOG_LINES);
            });
        }
    };
    return j;
}

function jobView(j, lines) {
    const n = Math.max(0, Math.min(LOG_LINES, Number(lines) || 60));
    return {
        id: j.id, state: j.state, step: j.step, note: j.note, agentId: j.agentId, startedAt: j.startedAt, endedAt: j.endedAt, error: j.error,
        worker: j.worker, releaseId: j.releaseId || 0, log: j.lines.slice(-n)
    };
}

class Fail extends Error {}

async function git(j, cfg, args, opts = {}) {
    const r = await exec('git', GIT_ID.concat(args), { cwd: opts.cwd || repoDir(), env: gitEnv(cfg), timeoutMs: opts.timeoutMs || 180000, onLine: opts.quiet ? null : (l) => j.log(l) });
    if (r.code !== 0 && !opts.soft) throw new Fail(`git ${args[0]} failed (${r.code}): ${r.out.trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`);
    return r;
}

async function exists(file) { try { await fsp.access(file); return true; } catch (_) { return false; } }

/** First configured worker that is ready; throws with every reason when none is. */
async function pickWorker(j, cfg) {
    const why = [];
    for (const w of cfg.workers) {
        const bad = workerProblem(w);
        if (bad) { why.push(`${w.name}: ${bad}`); continue; }
        if (w.kind === 'ssh') {
            const r = await exec('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', w.host, 'exit'], { timeoutMs: 15000 });
            if (r.code !== 0) { why.push(`${w.name} unreachable`); continue; }
        }
        return w;
    }
    throw new Fail(why.join('; ') || 'no build worker is configured');
}

function parseMerged(out) {
    const names = [];
    for (const l of String(out).split(/\r?\n/)) {
        const m = /^(?:ok|resolved) (origin\/\S+)$/.exec(l.trim());
        if (m) names.push(m[1]);
    }
    return names;
}

function nextVersionCode(prev) {
    const minutes = Math.floor((Date.now() - EPOCH_MS) / 60000);
    return Math.max((prev ? prev.versionCode : 0) + 1, maxReportedVersionCode() + 1, minutes);
}

async function prepareSource(j, cfg) {
    await fsp.mkdir(root(), { recursive: true });
    if (!(await exists(path.join(repoDir(), '.git')))) {
        j.log('cloning DSApp-Kotlin (first build)');
        await git(j, cfg, ['clone', '-q', cfg.repoUrl, repoDir()], { cwd: root(), timeoutMs: 600000 });
    }
    j.log('merging origin/main and every unmerged branch');
    const merge = await exec('bash', [path.join(SCRIPTS, 'dsapp-merge-latest.sh'), repoDir()], {
        env: Object.assign(gitEnv(cfg), { DSAPP_MERGE_SKIP: cfg.skipBranches.length ? cfg.skipBranches.map((b) => `^${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).join('|') : '' }),
        timeoutMs: 600000, onLine: (l) => j.log(l)
    });
    const bad = /^UNEXPECTED conflict .*$/m.exec(merge.out);
    if (bad) throw new Fail(bad[0]);
    if (merge.code !== 0) throw new Fail(`the merge script failed (${merge.code})`);
    const names = parseMerged(merge.out);
    const prev = latestRelease();
    const versionCode = nextVersionCode(prev);
    const versionName = `1.0.${versionCode}`;
    const props = path.join(repoDir(), 'gradle.properties');
    let cur = '';
    try { cur = await fsp.readFile(props, 'utf8'); } catch (_) { cur = ''; }
    await fsp.writeFile(props, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}versionCode=${versionCode}\nversionName=${versionName}\n`);
    await git(j, cfg, ['add', 'gradle.properties'], { quiet: true });
    await git(j, cfg, ['commit', '-q', '-m', `build ${j.id}: versionCode=${versionCode} versionName=${versionName}`], { quiet: true });
    const sha = (await git(j, cfg, ['rev-parse', 'HEAD'], { quiet: true })).out.trim().split(/\s+/)[0];
    const branches = [];
    for (const n of names) {
        const r = await git(j, cfg, ['rev-parse', n], { quiet: true, soft: true });
        branches.push({ name: n.replace(/^origin\//, ''), sha: r.code === 0 ? r.out.trim().split(/\s+/)[0] : '' });
    }
    // commits since the previous release (its commit may be gone from a fresh clone: then since origin/main)
    let base = 'origin/main';
    if (prev && prev.sha) {
        const have = await git(j, cfg, ['cat-file', '-e', `${prev.sha}^{commit}`], { quiet: true, soft: true });
        if (have.code === 0) base = prev.sha;
    }
    const lg = await git(j, cfg, ['log', '--no-merges', '--format=%H%x09%s', '-n', '400', `${base}..${sha}`], { quiet: true, soft: true });
    const commits = lg.out.split('\n').map((l) => { const i = l.indexOf('\t'); return i > 0 ? { sha: l.slice(0, i), subject: l.slice(i + 1).trim() } : null; })
        .filter((c) => c && c.sha.length === 40 && !/^build \d+: versionCode=/.test(c.subject)).slice(0, MAX_COMMITS);
    if (!(await exists(cfg.pushTokenFile))) throw new Fail(`the push token file is not readable (androidBuilds.pushTokenFile): ${cfg.pushTokenFile}`);
    j.log(`pushing build/latest (${sha.slice(0, 7)}, ${branches.length} branches merged)`);
    await git(j, cfg, ['push', '-q', '-f', 'origin', 'HEAD:refs/heads/build/latest'], { timeoutMs: 180000 });
    return { sha, versionCode, versionName, branches, commits };
}

async function buildSsh(j, cfg, w, src, dir) {
    const zip = path.join(dir, 'source.zip');
    const apk = path.join(dir, 'dsapp.apk');
    await git(j, cfg, ['archive', '--format=zip', '-o', zip, src.sha], { quiet: true });
    await fsp.mkdir(path.dirname(JOINT_LOCK), { recursive: true });
    j.log(`waiting for the joint build lock, then building on ${w.name}`);
    const r = await exec('flock', ['-w', '1800', JOINT_LOCK, 'bash', path.join(SCRIPTS, 'dsapp-remote-build.sh'), w.host, w.dir, w.folder, w.script, zip, apk], { timeoutMs: 80 * 60000, onLine: (l) => j.log(l) });
    if (r.code !== 0) {
        const hit = /e: .*|NO APK|BUILD HOST: .*/.exec(r.out);
        throw new Fail(`the build on ${w.name} failed (${r.code}): ${hit ? hit[0].slice(0, 200) : 'see the log'}`);
    }
    return apk;
}

async function buildLocal(j, cfg, w, src, dir) {
    const tar = path.join(dir, 'source.tar');
    const tree = path.join(dir, 'tree');
    await fsp.mkdir(tree, { recursive: true });
    await git(j, cfg, ['archive', '--format=tar', '-o', tar, src.sha], { quiet: true });
    const x = await exec('tar', ['-xf', tar, '-C', tree], { timeoutMs: 120000 });
    if (x.code !== 0) throw new Fail('unpacking the source failed');
    const env = { JAVA_HOME: w.javaHome, ANDROID_HOME: w.androidHome, ANDROID_SDK_ROOT: w.androidHome, DSAPP_KS_PASS: w.storePassword };
    j.log('gradlew assembleRelease');
    const g = await exec('./gradlew', ['--no-daemon', '-q', 'assembleRelease'], { cwd: tree, env, timeoutMs: 60 * 60000, onLine: (l) => j.log(l) });
    if (g.code !== 0) throw new Fail(`gradle failed (${g.code})`);
    const outDir = path.join(tree, 'app', 'build', 'outputs', 'apk', 'release');
    const built = (await fsp.readdir(outDir).catch(() => [])).filter((f) => f.endsWith('.apk')).sort()[0];
    if (!built) throw new Fail('gradle made no release APK (NO APK)');
    const tools = path.join(w.androidHome, 'build-tools');
    const ver = (await fsp.readdir(tools).catch(() => [])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
    if (!ver) throw new Fail(`no build-tools in ${tools}`);
    const apk = path.join(dir, 'dsapp.apk');
    const s = await exec(path.join(tools, ver, 'apksigner'), ['sign', '--ks', w.keystore, '--ks-key-alias', w.alias, '--ks-pass', 'env:DSAPP_KS_PASS', '--key-pass', 'env:DSAPP_KS_PASS', '--out', apk, path.join(outDir, built)], { env, timeoutMs: 120000, onLine: (l) => j.log(l) });
    if (s.code !== 0) throw new Fail(`apksigner failed (${s.code})`);
    return apk;
}

async function sha256File(file) {
    const h = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
        const s = fs.createReadStream(file);
        s.on('data', (c) => h.update(c));
        s.on('error', reject);
        s.on('end', resolve);
    });
    return h.digest('hex');
}

async function publish(j, w, src, apk) {
    const st = await fsp.stat(apk).catch(() => null);
    if (!st || st.size < 1024) throw new Fail('the build host returned no usable APK (NO APK)');
    const sha256 = await sha256File(apk);
    const apkFile = `${src.versionCode}-${src.sha.slice(0, 7)}.apk`;
    await fsp.mkdir(apkDir(), { recursive: true });
    await fsp.rename(apk, path.join(apkDir(), apkFile)).catch(async () => { await fsp.copyFile(apk, path.join(apkDir(), apkFile)); });
    const release = {
        id: j.id, versionCode: src.versionCode, versionName: src.versionName, sha: src.sha, branches: src.branches, commits: src.commits,
        apkFile, sha256, size: st.size, worker: w.id, createdAt: new Date().toISOString()
    };
    index.releases.push(release);
    if (index.releases.length > KEEP_RELEASES) index.releases.splice(0, index.releases.length - KEEP_RELEASES);
    const keep = new Set(index.releases.slice(-KEEP_APKS).map((r) => r.apkFile));
    for (const f of await fsp.readdir(apkDir()).catch(() => [])) if (f.endsWith('.apk') && !keep.has(f)) await fsp.unlink(path.join(apkDir(), f)).catch(() => {});
    return release;
}

function setStep(j, step) {
    j.step = step;
    gateUpdate(j, `Android build ${j.id}: ${step}`); // the heartbeat that keeps the server's gate alive
}

async function runJob(j) {
    let cfg;
    try {
        cfg = config();
        gateStart(j, j.note);
        setStep(j, 'worker');
        const w = await pickWorker(j, cfg);
        j.worker = w.id;
        j.log(`worker ${w.name} (${w.kind})`);
        setStep(j, 'source');
        const src = await prepareSource(j, cfg);
        setStep(j, 'build');
        const dir = path.join(workDir(), String(j.id));
        await fsp.mkdir(dir, { recursive: true });
        const apk = w.kind === 'local' ? await buildLocal(j, cfg, w, src, dir) : await buildSsh(j, cfg, w, src, dir);
        setStep(j, 'publish');
        const release = await publish(j, w, src, apk);
        j.releaseId = release.id;
        j.state = 'done';
        j.step = 'done';
        j.log(`release ${release.id}: ${release.versionName} (${release.versionCode}) ${release.sha.slice(0, 7)} ${release.size} bytes sha256 ${release.sha256.slice(0, 12)}`);
        fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
        finishJob(j);
        gateEnd(j, `ok: ${release.versionName}`);
        try { events.emit('release', release); } catch (e) { console.warn(`[androidBuilds] release listener: ${e.message}`); }
    } catch (e) {
        j.state = 'failed';
        j.error = e instanceof Fail ? e.message : `${e.message || e}`.slice(0, 300);
        j.log(`FAILED: ${j.error}`);
        fsp.rm(path.join(workDir(), String(j.id)), { recursive: true, force: true }).catch(() => {});
        finishJob(j);
        gateEnd(j, `failed: ${j.error}`.slice(0, 280));
    }
}

function finishJob(j) {
    j.endedAt = new Date().toISOString();
    index.jobs.push({ id: j.id, state: j.state, step: j.step, note: j.note, agentId: j.agentId, startedAt: j.startedAt, endedAt: j.endedAt, error: j.error, worker: j.worker, releaseId: j.releaseId || 0, lines: j.lines.slice(-LOG_LINES) });
    if (index.jobs.length > KEEP_JOBS) index.jobs.splice(0, index.jobs.length - KEEP_JOBS);
    job = null;
    saveNow();
}

// ---------------------------------------------------------------- requests (HTTP routes and the agent socket share these)

/** Starts a build: { status: 200, id, state } or a refusal { status: 409, code, error, ... }. */
function requestBuild(o = {}) {
    if (job) return { status: 409, code: 'BUSY', error: `Build ${job.id} is running (${job.step}).`, running: job.id };
    const agentId = String(o.agentId || '').slice(0, 120);
    const f = foreignGates(agentId);
    if (f.gates.length) {
        const g = f.gates[0];
        return { status: 409, code: 'GATE_OPEN', error: `${g.requestedBy} has a build gate (${g.id}, ${g.target}, ${g.state}) open in ${COORD_REPO}; the server builds when it is over.`, gates: f.gates.map((x) => ({ id: x.id, target: x.target, state: x.state, requestedBy: x.requestedBy })) };
    }
    const j = newJob(o.note, agentId);
    job = j; // set before any await: a second request in the same tick is refused above
    runJob(j).catch((e) => { console.warn(`[androidBuilds] job crashed: ${e.message}`); if (job === j) { j.state = 'failed'; j.error = e.message; finishJob(j); } });
    return { status: 200, id: j.id, state: j.state };
}

function releaseSummary(r) {
    return { id: r.id, versionCode: r.versionCode, versionName: r.versionName, sha: r.sha, branches: r.branches, commitCount: r.commits.length, size: r.size, sha256: r.sha256, worker: r.worker, createdAt: r.createdAt };
}

function listView() {
    const cfg = config();
    const last = latestRelease();
    return {
        builds: index.releases.slice().reverse().map(releaseSummary),
        jobs: index.jobs.slice().reverse().map((j) => ({ id: j.id, state: j.state, step: j.step, note: j.note, startedAt: j.startedAt, endedAt: j.endedAt, error: j.error, worker: j.worker, releaseId: j.releaseId })),
        current: job ? jobView(job, 10) : null,
        workers: cfg.workers.map((w) => ({ id: w.id, kind: w.kind, host: w.host || '', problem: workerProblem(w) })),
        latest: last ? last.id : null,
        maxReportedVersionCode: maxReportedVersionCode(),
        // what each phone reported at its last hello and where its delivery stands (staged, failed, installed)
        devices: index.devices,
        deliveries: index.deliveries
    };
}

/** One build: the running job, or a finished one from the list; { status: 404 } when unknown. */
function buildStatus(id, lines) {
    const n = Number(id);
    if (!Number.isInteger(n)) return { status: 404, code: 'NOT_FOUND', error: 'No such build.' };
    const j = job && job.id === n ? job : index.jobs.find((x) => x.id === n);
    const rel = releaseById(n);
    if (!j && !rel) return { status: 404, code: 'NOT_FOUND', error: 'No such build.' };
    const view = j ? jobView(j, lines) : { id: n, state: 'done', step: 'done', log: [] };
    return { status: 200, job: view, release: rel };
}

// ---------------------------------------------------------------- HTTP

function fail(res, code, err, msg, extra) {
    res.status(code).json(Object.assign({ success: false, code: err, error: msg }, extra || {}));
}

function mount(app, authMiddleware, globalResources) {
    gResources = globalResources || gResources;
    const auth = authMiddleware || ((req, res, next) => next());
    const json = require('express').json({ limit: 8192 });
    const admin = (req, res) => { if (isAdminUser(req)) return true; fail(res, 403, 'FORBIDDEN', 'Only an administrator can use Android builds.'); return false; };

    app.post('/api/android-builds', auth, json, (req, res) => {
        if (!admin(req, res)) return;
        const body = req.body || {};
        const r = requestBuild({ note: body.note, agentId: body.agentId });
        if (r.status !== 200) { const { status, code, error, ...rest } = r; return fail(res, status, code, error, rest); }
        return res.json({ success: true, id: r.id, state: r.state });
    });

    app.get('/api/android-builds', auth, (req, res) => {
        if (!admin(req, res)) return;
        res.json(Object.assign({ success: true }, listView()));
    });

    app.get('/api/android-builds/:id', auth, (req, res) => {
        if (!admin(req, res)) return;
        const r = buildStatus(req.params.id, req.query && req.query.lines);
        if (r.status !== 200) return fail(res, r.status, r.code, r.error);
        res.json({ success: true, job: r.job, release: r.release });
    });

    app.get('/api/android-builds/:id/apk', auth, async (req, res) => {
        if (!admin(req, res)) return;
        const rel = releaseById(Number(req.params.id));
        if (!rel) return fail(res, 404, 'NOT_FOUND', 'No such release.');
        const file = releaseApkPath(rel);
        if (!(await exists(file))) return fail(res, 410, 'PRUNED', 'That APK was removed (the last 10 are kept).');
        res.set('X-APK-SHA256', rel.sha256);
        res.sendFile(file, { headers: { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': `attachment; filename="dsapp-${rel.versionName}.apk"` } }, (err) => {
            if (err && !res.headersSent) fail(res, 500, 'READ_FAILED', 'The APK could not be read.');
        });
    });

    serveSocket();
}

// ---------------------------------------------------------------- the agents' socket (dsapp_build MCP tool)

function socketPath() {
    if (T.socket) return T.socket;
    if (process.env.AGENT_ANDROID_BUILDS_SOCKET) return process.env.AGENT_ANDROID_BUILDS_SOCKET;
    return path.join(path.dirname(coord().dbPath()), 'android-builds.sock');
}

function serveSocket() {
    if (process.env.ANDROID_BUILDS_SOCKET_DISABLED === '1') return;
    let file;
    try { file = socketPath(); } catch (e) { console.warn(`[androidBuilds] no agent socket: ${e.message}`); return; }
    try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.unlinkSync(file); } catch (_) { /* none */ }
    sockServer = net.createServer((sock) => {
        let buf = '';
        sock.setEncoding('utf8');
        sock.setTimeout(15000, () => sock.destroy());
        sock.on('data', (chunk) => {
            buf += chunk;
            const i = buf.indexOf('\n');
            if (i < 0) { if (buf.length > 4096) sock.destroy(); return; }
            let req = null;
            try { req = JSON.parse(buf.slice(0, i)); } catch (_) { req = null; }
            let out;
            if (!req || (req.op !== 'request' && req.op !== 'status')) out = { ok: false, error: 'op must be request or status' };
            else if (req.op === 'request') {
                const r = requestBuild({ note: req.note, agentId: req.agentId });
                out = r.status === 200 ? { ok: true, result: { id: r.id, state: r.state } } : { ok: true, result: { refused: true, code: r.code, error: r.error, running: r.running, gates: r.gates } };
            } else if (req.id !== undefined && req.id !== null && req.id !== '') {
                const r = buildStatus(req.id, req.lines || 40);
                out = r.status === 200 ? { ok: true, result: { job: r.job, release: r.release } } : { ok: false, error: r.error };
            } else out = { ok: true, result: listView() };
            try { sock.end(`${JSON.stringify(out)}\n`); } catch (_) { /* gone */ }
        });
        sock.on('error', () => {});
    });
    sockServer.on('error', (e) => console.warn(`[androidBuilds] socket: ${e.message}`));
    sockServer.listen(file, () => { try { fs.chmodSync(file, 0o600); } catch (_) { /* kept */ } });
    if (sockServer.unref) sockServer.unref();
}

function closeSocket() {
    return new Promise((resolve) => { if (!sockServer) return resolve(); const s = sockServer; sockServer = null; s.close(() => resolve()); });
}

loadIndex();

module.exports = {
    mount, events, latestRelease, releaseApkPath, recordDeviceVersion, recordDelivery, deliveryOf, deviceVersionOf, maxReportedVersionCode,
    _test: {
        setRoot(dir) { T.root = dir; loadIndex(); },
        setExec(fn) { T.exec = fn; },
        setCoord(c) { T.coord = c; },
        setConfig(c) { T.config = c; },
        setSocket(p) { T.socket = p; },
        requestBuild, buildStatus, listView, workerProblem, pickWorker, config, flush, loadIndex, closeSocket, serveSocket,
        currentJob: () => job, newJob, nextVersionCode, parseMerged, LOCAL_NEEDS
    }
};
