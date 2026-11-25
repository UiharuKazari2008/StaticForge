#!/usr/bin/env node
'use strict';
// #821: server Android builds - the job with a stubbed exec layer (no git, ssh or gradle runs): versionCode rises across
// builds and stays above a phone-reported one, a Release is published ('release' emitted), 409 while a build runs and
// while another agent's coord gate for DSApp-Kotlin is open (a real temp coord db), the server holds its own gate while
// it builds, the local worker refuses unconfigured, an unreachable worker fails at once, the push token never reaches a
// command line, the routes are admin only, and the agent socket (dsapp_build) answers.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'android-builds-test-'));
process.env.AGENT_COORD_DB = path.join(tmp, 'coord.db');
const sockFile = path.join(tmp, 'ab.sock');
process.env.AGENT_ANDROID_BUILDS_SOCKET = sockFile;

const ab = require('../modules/androidBuilds');
const store = require('../modules/agentCoord/store');
ab._test.setRoot(path.join(tmp, 'data'));
const TOKEN = 'tok-' + crypto.randomBytes(8).toString('hex');
const tokenFile = path.join(tmp, 'push.token');
fs.writeFileSync(tokenFile, `${TOKEN}\n`);
const ruiko = { id: 'ruiko', kind: 'ssh', host: 'ruiko', dir: 'C:/Users/ykaza/claude-build', folder: 'dsapp-latest', script: 'build-latest.ps1' };
ab._test.setConfig({ workers: [ruiko], pushTokenFile: tokenFile });

// ---- the stub exec layer
const calls = [];
let sshUp = true;
let hold = null; // a promise the remote build waits for (to keep a build running)
let counter = 0;
const sha = (n) => crypto.createHash('sha1').update(`c${n}`).digest('hex');
ab._test.setExec(async (file, args, opts) => {
    calls.push({ file, args: args.slice(), env: opts.env || {} });
    const line = (l) => { if (opts.onLine) opts.onLine(l); };
    if (file === 'ssh') return { code: sshUp ? 0 : 255, out: '' };
    if (file === 'bash') {
        line('ok origin/claude/ble-probe-1193'); line('resolved origin/feat/camera-approach-tones');
        return { code: 0, out: 'ok origin/claude/ble-probe-1193\nresolved origin/feat/camera-approach-tones\n' };
    }
    if (file === 'flock') {
        if (hold) await hold;
        fs.writeFileSync(args[args.length - 1], crypto.randomBytes(4096));
        line('APK received');
        return { code: 0, out: 'APK received' };
    }
    assert.strictEqual(file, 'git');
    const a = args.slice(4); // after the -c user.name / -c user.email pair
    const dir = opts.cwd;
    switch (a[0]) {
    case 'clone': fs.mkdirSync(path.join(a[a.length - 1], '.git'), { recursive: true }); fs.writeFileSync(path.join(a[a.length - 1], 'gradle.properties'), 'org.gradle.jvmargs=-Xmx2g'); return { code: 0, out: '' };
    case 'add': case 'commit': return { code: 0, out: '' };
    case 'rev-parse': counter += 1; return { code: 0, out: `${a[1] === 'HEAD' ? sha(counter) : sha(`b${a[1]}`)}\n` };
    case 'cat-file': return { code: 0, out: '' };
    case 'log': return { code: 0, out: `${sha('x1')}\tfix(a): one\n${sha('x2')}\tfeat(b): two\n${sha('bump')}\tbuild 1: versionCode=1 versionName=1.0.1\n` };
    case 'archive': fs.writeFileSync(a[a.indexOf('-o') + 1], 'zip'); return { code: 0, out: '' };
    case 'push': return { code: 0, out: '' };
    default: assert.fail(`unexpected git ${a[0]} in ${dir}`);
    }
    return { code: 0, out: '' };
});

async function waitDone(id) {
    for (let i = 0; i < 400; i += 1) {
        const r = ab._test.buildStatus(id, 400);
        if (r.status === 200 && r.job.state !== 'running') return r;
        await new Promise((res) => setTimeout(res, 10));
    }
    throw new Error(`build ${id} did not finish`);
}
const props = () => fs.readFileSync(path.join(tmp, 'data', 'repo', 'gradle.properties'), 'utf8');

(async () => {
    const released = [];
    ab.events.on('release', (r) => released.push(r));

    // ---- build 1: no phone reported yet, versionCode from the clock
    let r = ab._test.requestBuild({ note: 'first' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(ab._test.requestBuild({}).status, 409, 'a second request while one runs');
    const busy = ab._test.requestBuild({});
    assert.strictEqual(busy.code, 'BUSY'); assert.strictEqual(busy.running, r.id);
    let d = await waitDone(r.id);
    assert.strictEqual(d.job.state, 'done', d.job.error + d.job.log.join('\n'));
    const rel1 = ab.latestRelease();
    const minutes = Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 60000);
    assert.ok(rel1.versionCode >= minutes - 1 && rel1.versionCode <= minutes + 2, `clock versionCode ${rel1.versionCode} vs ${minutes}`);
    assert.strictEqual(rel1.versionName, `1.0.${rel1.versionCode}`);
    assert.strictEqual(rel1.sha.length, 40);
    assert.deepStrictEqual(rel1.branches.map((b) => b.name), ['claude/ble-probe-1193', 'feat/camera-approach-tones']);
    assert.strictEqual(rel1.commits.length, 2, 'the version commit is not listed');
    assert.ok(/versionCode=\d+\nversionName=1\.0\.\d+\n$/.test(props()), props());
    assert.strictEqual(rel1.worker, 'ruiko');
    const stored = ab.releaseApkPath(rel1);
    assert.strictEqual(path.basename(stored), `${rel1.versionCode}-${rel1.sha.slice(0, 7)}.apk`);
    assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(stored)).digest('hex'), rel1.sha256);
    assert.strictEqual(fs.statSync(stored).size, rel1.size);
    assert.strictEqual(released.length, 1);
    console.log(`build ${rel1.id}: ${rel1.versionName} (clock minutes ${minutes}) sha ${rel1.sha.slice(0, 7)} apk ${rel1.size} bytes`);

    // ---- a phone reports a higher versionCode: the next builds stay above it, and rise
    ab.recordDeviceVersion('dev1', { versionCode: 9000000, versionName: '1.0.9000000', name: 'Fold' });
    assert.strictEqual(ab.maxReportedVersionCode(), 9000000);
    r = ab._test.requestBuild({ note: 'second' });
    d = await waitDone(r.id);
    const rel2 = ab.latestRelease();
    assert.strictEqual(rel2.versionCode, 9000001);
    r = ab._test.requestBuild({});
    d = await waitDone(r.id);
    const rel3 = ab.latestRelease();
    assert.strictEqual(rel3.versionCode, 9000002);
    assert.ok(rel1.versionCode < rel2.versionCode && rel2.versionCode < rel3.versionCode);
    assert.strictEqual(released.length, 3);
    console.log(`versionCodes ${rel1.versionCode} -> ${rel2.versionCode} -> ${rel3.versionCode} (reported 9000000)`);

    // delivery bookkeeping
    ab.recordDelivery('dev1', rel3.versionCode, 'sending', 'x');
    assert.strictEqual(ab.deliveryOf('dev1').state, 'sending');
    ab.recordDelivery('dev1', rel3.versionCode, 'bogus');
    assert.strictEqual(ab.deliveryOf('dev1').state, 'sending', 'unknown states are ignored');
    assert.strictEqual(ab.deliveryOf('nobody'), null);
    await ab._test.flush();
    ab._test.loadIndex();
    assert.strictEqual(ab.latestRelease().id, rel3.id, 'the index survives a reload');
    assert.strictEqual(ab.deliveryOf('dev1').versionCode, rel3.versionCode);

    // ---- the push token never reaches a command line or a log
    const everything = JSON.stringify(calls.map((c) => c.args)) + JSON.stringify(d.job.log);
    assert.ok(!everything.includes(TOKEN), 'token on a command line or in the log');
    const push = calls.filter((c) => c.file === 'git' && c.args[4] === 'push').pop();
    assert.deepStrictEqual(push.args.slice(4), ['push', '-q', '-f', 'origin', 'HEAD:refs/heads/build/latest']);
    assert.strictEqual(push.env.DSAPP_PUSH_TOKEN_FILE, tokenFile);
    assert.ok(!JSON.stringify(push.env).includes(TOKEN));
    assert.ok(/director\.yozora/.test(push.env.GIT_CONFIG_VALUE_1));
    const fl = calls.filter((c) => c.file === 'flock').pop();
    assert.strictEqual(fl.args[1], '1800'); assert.ok(fl.args[2].endsWith('dsapp-joint-build.lock'));
    assert.deepStrictEqual(fl.args.slice(5, 9), ['ruiko', 'C:/Users/ykaza/claude-build', 'dsapp-latest', 'build-latest.ps1']);
    console.log('the token is only in its file; push goes with credential helper env, flock holds the joint build lock');

    // ---- the server's own coord gate while it builds
    let gateSeen = null;
    let release;
    hold = new Promise((res) => { release = res; });
    r = ab._test.requestBuild({ note: 'gate' });
    await new Promise((res) => setTimeout(res, 100));
    gateSeen = store.builds({ repo: 'DSApp-Kotlin' }).map((b) => b.build).find((b) => b.requestedBy === 'dreamscape-android-builds');
    assert.ok(gateSeen && gateSeen.state === 'running' && gateSeen.target === 'dsapp-apk', `server gate: ${JSON.stringify(gateSeen)}`);
    assert.strictEqual(ab._test.requestBuild({}).code, 'BUSY');
    release(); hold = null;
    await waitDone(r.id);
    assert.ok(!store.builds({ repo: 'DSApp-Kotlin' }).some((b) => b.build.requestedBy === 'dreamscape-android-builds'), 'gate ended with the build');
    console.log(`server gate while building: ${gateSeen.state} ${gateSeen.target} in ${gateSeen.repo}, ended after`);

    // ---- another agent's open gate refuses (409), its own gate does not
    store.upsertAgent({ id: 'claude-aaaa', kind: 'claude', name: 'A', repo: 'DSApp-Kotlin' });
    const g = store.buildRequest('claude-aaaa', { repo: 'DSApp-Kotlin', target: 'dsapp-apk', note: 'my feature' });
    let q = ab._test.requestBuild({ agentId: 'claude-bbbb' });
    assert.strictEqual(q.status, 409); assert.strictEqual(q.code, 'GATE_OPEN');
    assert.ok(q.gates.some((x) => x.requestedBy === 'claude-aaaa'));
    q = ab._test.requestBuild({});
    assert.strictEqual(q.code, 'GATE_OPEN', 'no agentId: still refused');
    console.log(`refused: ${q.error}`);
    q = ab._test.requestBuild({ agentId: 'claude-aaaa' });
    assert.strictEqual(q.status, 200, 'the requester of the gate is not blocked');
    d = await waitDone(q.id);
    assert.strictEqual(d.job.state, 'done', d.job.error);
    assert.ok(d.job.log.some((l) => /covered by claude-aaaa/.test(l)));
    store.buildEnd('claude-aaaa', g.build.id, 'test over');
    assert.strictEqual(ab._test.requestBuild({ agentId: 'claude-bbbb' }).status, 200, 'refusal lifts when the gate ends');
    await waitDone(ab._test.currentJob().id);

    // a coord store failure never blocks or crashes
    ab._test.setCoord({ builds() { throw new Error('db gone'); }, upsertAgent() { throw new Error('db gone'); }, buildRequest() { throw new Error('db gone'); }, dbPath: () => path.join(tmp, 'coord.db') });
    q = ab._test.requestBuild({});
    assert.strictEqual(q.status, 200);
    d = await waitDone(q.id);
    assert.strictEqual(d.job.state, 'done');
    assert.ok(d.job.log.some((l) => /gate unavailable: db gone/.test(l)));
    ab._test.setCoord(null);

    // ---- workers: unreachable fails at once; local refuses unconfigured; the second worker takes over
    sshUp = false;
    r = ab._test.requestBuild({});
    d = await waitDone(r.id);
    assert.strictEqual(d.job.state, 'failed'); assert.strictEqual(d.job.error, 'Ruiko unreachable');
    assert.ok(!calls.slice(-3).some((c) => c.file === 'bash'), 'no merge ran after an unreachable worker');
    console.log(`unreachable: ${d.job.error}`);
    sshUp = true;
    ab._test.setConfig({ workers: [{ id: 'local', kind: 'local' }], pushTokenFile: tokenFile });
    assert.strictEqual(ab._test.workerProblem(ab._test.config().workers[0]), ab._test.LOCAL_NEEDS);
    r = ab._test.requestBuild({});
    d = await waitDone(r.id);
    assert.strictEqual(d.job.state, 'failed'); assert.ok(d.job.error.includes('not configured: needs javaHome, androidHome and keystore (debug key 5c7b3ecc)'), d.job.error);
    console.log(`local: ${d.job.error}`);
    ab._test.setConfig({ workers: [{ id: 'local', kind: 'local', javaHome: '/jdk' }, ruiko], pushTokenFile: tokenFile });
    r = ab._test.requestBuild({});
    d = await waitDone(r.id);
    assert.strictEqual(d.job.state, 'done'); assert.strictEqual(d.job.worker, 'ruiko');
    ab._test.setConfig({ workers: [ruiko], pushTokenFile: path.join(tmp, 'missing.token') });
    r = ab._test.requestBuild({});
    d = await waitDone(r.id);
    assert.ok(d.job.state === 'failed' && /push token file is not readable/.test(d.job.error), d.job.error);
    ab._test.setConfig({ workers: [{ id: 'x', kind: 'ssh', host: 'a;b', dir: 'C:/x', folder: 'f', script: 's' }], pushTokenFile: tokenFile });
    assert.strictEqual(ab._test.workerProblem(ab._test.config().workers[0]), 'bad host in config');
    ab._test.setConfig({ pushTokenFile: tokenFile });
    assert.strictEqual(ab._test.config().workers[0].id, 'ruiko', 'default worker');

    // ---- routes: admin only
    const handlers = {};
    const reg = (m) => (p, ...fns) => { handlers[`${m} ${p}`] = fns[fns.length - 1]; };
    ab.mount({ get: reg('GET'), post: reg('POST') }, null, null);
    const mk = () => {
        let resolve; const p = new Promise((x) => { resolve = x; });
        const res = { code: 200, body: null, headers: {}, headersSent: false, status(c) { res.code = c; return res; }, set(k, v) { res.headers[k] = v; return res; }, json(b) { res.body = b; res.headersSent = true; resolve(res); return res; }, sendFile(f) { res.body = f; res.headersSent = true; resolve(res); } };
        return [res, p];
    };
    let [res, p] = mk(); handlers['POST /api/android-builds']({ userType: 'user', body: {} }, res); assert.strictEqual((await p).code, 403);
    [res, p] = mk(); handlers['GET /api/android-builds']({ userType: 'user' }, res); assert.strictEqual((await p).code, 403);
    [res, p] = mk(); handlers['GET /api/android-builds']({ userType: 'admin' }, res); await p;
    assert.strictEqual(res.body.latest, ab.latestRelease().id); assert.ok(res.body.builds.length >= 3 && res.body.workers[0].id === 'ruiko');
    [res, p] = mk(); handlers['GET /api/android-builds/:id']({ userType: 'admin', params: { id: String(rel1.id) }, query: {} }, res); await p;
    assert.strictEqual(res.body.job.state, 'done'); assert.strictEqual(res.body.release.versionCode, rel1.versionCode);
    [res, p] = mk(); handlers['GET /api/android-builds/:id']({ userType: 'admin', params: { id: '99999' }, query: {} }, res); assert.strictEqual((await p).code, 404);
    [res, p] = mk(); handlers['GET /api/android-builds/:id/apk']({ userType: 'admin', params: { id: String(rel3.id) } }, res); await p;
    assert.strictEqual(res.body, ab.releaseApkPath(rel3)); assert.strictEqual(res.headers['X-APK-SHA256'], rel3.sha256);
    [res, p] = mk(); handlers['POST /api/android-builds']({ userType: 'admin', body: { note: 'http' } }, res); await p;
    assert.strictEqual(res.body.success, true); assert.strictEqual(res.body.state, 'running');
    const httpId = res.body.id;
    [res, p] = mk(); handlers['POST /api/android-builds']({ userType: 'admin', body: {} }, res); await p;
    assert.strictEqual(res.code, 409); assert.strictEqual(res.body.code, 'BUSY'); assert.strictEqual(res.body.running, httpId);
    await waitDone(httpId);

    // ---- the agent socket (dsapp_build)
    const ask = (req) => new Promise((resolve, reject) => {
        let buf = ''; const s = net.createConnection(sockFile, () => s.write(`${JSON.stringify(req)}\n`));
        s.setEncoding('utf8'); s.on('data', (c) => { buf += c; }); s.on('end', () => resolve(JSON.parse(buf))); s.on('error', reject);
    });
    await new Promise((res) => setTimeout(res, 100));
    const sr = await ask({ op: 'request', note: 'from an agent', agentId: 'claude-cccc' });
    assert.ok(sr.ok && sr.result.state === 'running', JSON.stringify(sr));
    assert.strictEqual((await ask({ op: 'request', agentId: 'claude-cccc' })).result.refused, true);
    await waitDone(sr.result.id);
    const ss = await ask({ op: 'status', id: sr.result.id });
    assert.ok(ss.ok && ss.result.job.state === 'done' && ss.result.release.versionCode > 0);
    const sl = await ask({ op: 'status' });
    assert.ok(sl.result.builds.length >= 3 && sl.result.latest === ss.result.release.id);
    assert.strictEqual((await ask({ op: 'status', id: 424242 })).ok, false);
    assert.strictEqual((await ask({ op: 'nope' })).ok, false);
    console.log(`agent socket: request -> build ${sr.result.id}, status -> ${ss.result.job.state}, list latest ${sl.result.latest}`);
    await ab._test.closeSocket();

    // keep the last 10 APKs
    for (let i = 0; i < 6; i += 1) { const x = ab._test.requestBuild({}); await waitDone(x.id); }
    const apks = fs.readdirSync(path.join(tmp, 'data', 'apk')).filter((f) => f.endsWith('.apk'));
    assert.strictEqual(apks.length, 10, `apks kept: ${apks.length}`);
    assert.ok(fs.existsSync(ab.releaseApkPath(ab.latestRelease())));

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('android builds: all checks passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
