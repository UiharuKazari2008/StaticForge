#!/usr/bin/env node
'use strict';

/**
 * Test for scripts/reload-server-module.js and the --reload mode of scripts/restart-gate.js (#1293 / #1292).
 *
 *   node scripts/test-reload-server-module.js
 *
 * Part 1 starts a child node process that serves modules/hotReload.js on its own socket (HOT_RELOAD_SOCKET), loads
 * throw-away modules from modules/__hot_reload_test_tmp/ (deleted at the end, also on failure) and answers their values on a
 * second tiny socket; the real script is run against it with RELOAD_GATE_SKIP=1 (test only, see the script) so the live agents
 * do not decide the result. Part 2 tests the light gate on its own against a scratch agent-coord database and a fake live
 * Claude session (DREAMSCAPE_CLAUDE_HOME), so it does not depend on the real sessions either. The live server's socket and
 * database are never touched: every path below is in a scratch folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP_REL = 'modules/__hot_reload_test_tmp';
const TMP_ABS = path.join(ROOT, TMP_REL);
// a unix socket path is limited to ~104 bytes: a short folder under the system temp dir
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rlt-'));
const SOCK = path.join(DIR, 'h.sock');
const PROBE = path.join(DIR, 'p.sock');
const DB = path.join(DIR, 'coord.db');
const SCRIPT = path.join(ROOT, 'scripts', 'reload-server-module.js');
const GATE = path.join(ROOT, 'scripts', 'restart-gate.js');

let failures = 0;
function check(name, ok, detail) {
    if (!ok) failures += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `\n       ${String(detail).replace(/\n/g, '\n       ')}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runScript(args, env) {
    const r = spawnSync(process.execPath, [SCRIPT].concat(args), {
        cwd: ROOT, encoding: 'utf8', timeout: 90000,
        env: Object.assign({}, process.env, { HOT_RELOAD_SOCKET: SOCK, AGENT_COORD_DB: DB, RELOAD_GATE_SKIP: '1' }, env || {})
    });
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function socketOp(req) {
    return new Promise((resolve, reject) => {
        let buf = '';
        const s = net.connect(SOCK);
        s.setEncoding('utf8');
        s.on('connect', () => s.write(`${JSON.stringify(req)}\n`));
        s.on('data', (c) => { buf += c; });
        s.on('error', reject);
        s.on('close', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
}

function probe() {
    return new Promise((resolve, reject) => {
        let buf = '';
        const s = net.connect(PROBE);
        s.setEncoding('utf8');
        s.on('data', (c) => { buf += c; });
        s.on('error', reject);
        s.on('close', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
}

const goodSrc = (v) => `'use strict';
module.exports = { value: () => '${v}' };
require('../hotReload').mark(module, { dispose() { global.__rlDisposes = (global.__rlDisposes || 0) + 1; return { n: 1 }; }, accept() {} });
`;
const throwerSrc = (v, boom) => `'use strict';
module.exports = { value: () => '${v}' };
require('../hotReload').mark(module, { dispose() { return { n: 1 }; }, accept(s, ctx) { ${boom ? "if (!ctx.rollback) throw new Error('accept boom');" : ''} } });
`;
const unmarkedSrc = (v) => `'use strict';\nmodule.exports = { value: () => '${v}' };\n`;

const CHILD = `
const path = require('path'); const net = require('net');
const ROOT = ${JSON.stringify(ROOT)}; const T = ${JSON.stringify(TMP_ABS)};
const hot = require(path.join(ROOT, 'modules/hotReload.js'));
hot.serve();
const good = require(path.join(T, 'good.js'));
const thrower = require(path.join(T, 'thrower.js'));
const unmarked = require(path.join(T, 'unmarked.js'));
net.createServer((s) => { s.end(JSON.stringify({ good: good.value(), thrower: thrower.value(), unmarked: unmarked.value(), disposes: global.__rlDisposes || 0 }) + '\\n'); })
    .listen(${JSON.stringify(PROBE)}, () => console.log('ready'));
`;

async function part1() {
    console.log('--- part 1: the script against a child server with its own reload socket');
    fs.mkdirSync(TMP_ABS, { recursive: true });
    const f = (n) => path.join(TMP_ABS, n);
    fs.writeFileSync(f('good.js'), goodSrc('v1'));
    fs.writeFileSync(f('thrower.js'), throwerSrc('t1', false));
    fs.writeFileSync(f('unmarked.js'), unmarkedSrc('u1'));
    fs.writeFileSync(f('notloaded.js'), goodSrc('n1'));
    const childFile = path.join(DIR, 'child.js');
    fs.writeFileSync(childFile, CHILD);
    const child = spawn(process.execPath, [childFile], { cwd: ROOT, env: Object.assign({}, process.env, { HOT_RELOAD_SOCKET: SOCK, AGENT_COORD_DB: DB }), stdio: ['ignore', 'pipe', 'pipe'] });
    let childErr = '';
    child.stderr.on('data', (c) => { childErr += c; });
    try {
        for (let i = 0; i < 100 && !(fs.existsSync(SOCK) && fs.existsSync(PROBE)); i += 1) await sleep(50);
        check('child server is up (reload socket and probe socket)', fs.existsSync(SOCK) && fs.existsSync(PROBE), childErr);
        let p = await probe();
        check('child starts on v1 / t1 / u1', p.good === 'v1' && p.thrower === 't1' && p.unmarked === 'u1', JSON.stringify(p));

        const G = `${TMP_REL}/good.js`; const T = `${TMP_REL}/thrower.js`; const U = `${TMP_REL}/unmarked.js`;

        let r = runScript([G]);
        check('missing --why -> exit 2 with a usage line', r.code === 2 && /usage:/.test(r.out), `${r.code} ${r.out}`);
        r = runScript(['--why', 'x']);
        check('no file -> exit 2', r.code === 2, `${r.code} ${r.out}`);
        r = runScript([G, '--why', 'x', '--bogus']);
        check('unknown option -> exit 2', r.code === 2, `${r.code} ${r.out}`);

        r = runScript(['web_server.js', '--why', 'x']);
        check('a file outside modules/ (web_server.js) -> exit 50 "needs a restart"', r.code === 50 && /needs a restart: web_server\.js is not a server module under modules\/ \(use scripts\/restart-dreamscape\.sh\)/.test(r.out), `${r.code} ${r.out}`);
        r = runScript(['routes/anything.js', '--why', 'x']);
        check('routes/ file -> exit 50', r.code === 50, `${r.code} ${r.out}`);
        r = runScript(['public/scripts/x.js', '--why', 'x']);
        check('a client file -> exit 50 naming scripts/client-update.sh', r.code === 50 && /client file/.test(r.out) && /client-update\.sh/.test(r.out), `${r.code} ${r.out}`);
        r = runScript(['modules/x.json', '--why', 'x']);
        check('modules/x.json (not .js) -> exit 50', r.code === 50, `${r.code} ${r.out}`);

        fs.writeFileSync(f('good.js'), goodSrc('v2'));
        r = runScript([G, '--why', 'test good change']);
        p = await probe();
        check('a good change reloads: exit 0, "reloaded <file>", the child answers v2', r.code === 0 && new RegExp(`reloaded ${G}$`, 'm').test(r.out) && /reloaded in \d+ ms/.test(r.out) && p.good === 'v2', `${r.code} ${r.out} ${JSON.stringify(p)}`);
        check('dispose() of the old version ran once', p.disposes === 1, JSON.stringify(p));

        fs.writeFileSync(f('good.js'), goodSrc('v3'));
        r = runScript([G, '--why', 'json', '--json']);
        let j = null;
        try { j = JSON.parse(r.stdout); } catch (_) { /* below */ }
        p = await probe();
        check('--json prints one object (ok, code 0, reloaded list) and the child answers v3', r.code === 0 && j && j.ok === true && j.code === 0 && Array.isArray(j.reloaded) && j.reloaded[0] === G && p.good === 'v3', `${r.code} ${r.out}`);

        fs.writeFileSync(f('good.js'), goodSrc('v3b'));
        r = runScript([G, '--why', 'by', '--json', '--by', 'Some Agent (claude-0a1b2c3d)']);
        let one = null;
        try { one = JSON.parse(r.stdout); } catch (_) { /* below */ }
        const hist = await socketOp({ op: 'history', limit: 1 });
        check('--by is the reload\'s `by` on the server; --json stdout is exactly one JSON object (progress on stderr)', r.code === 0 && one && one.ok === true && /reloaded in/.test(r.stderr) && hist.result[0].by === 'Some Agent (claude-0a1b2c3d)' && hist.result[0].why === 'by', `${r.code} stdout=${r.stdout} stderr=${r.stderr} ${JSON.stringify(hist)}`);
        r = runScript([G, '--json']);
        try { one = JSON.parse(r.stdout); } catch (_) { one = null; }
        check('--json with a usage error: exit 2 and one JSON object on stdout', r.code === 2 && one && one.ok === false && one.code === 2, `${r.code} ${r.stdout}`);
        r = runScript(['web_server.js', '--why', 'x', '--json']);
        try { one = JSON.parse(r.stdout); } catch (_) { one = null; }
        check('--json with exit 50: one JSON object on stdout, code 50', r.code === 50 && one && one.ok === false && one.code === 50, `${r.code} ${r.stdout}`);
        fs.writeFileSync(f('good.js'), goodSrc('v3'));
        runScript([G, '--why', 'back to v3']);

        fs.writeFileSync(f('good.js'), goodSrc('v4'));
        r = runScript([G, '--why', 'dry', '--dry-run']);
        p = await probe();
        check('--dry-run prints the plan, reloads nothing: exit 0, child still v3', r.code === 0 && /plan: /.test(r.out) && /dry run/.test(r.out) && p.good === 'v3', `${r.code} ${r.out} ${JSON.stringify(p)}`);

        fs.writeFileSync(f('good.js'), `'use strict';\nmodule.exports = { value: () => 'v5' ===== };\n`);
        r = runScript([G, '--why', 'syntax']);
        p = await probe();
        check('a syntax error -> exit 30 "fails node --check"; the child still runs the old value (v3)', r.code === 30 && /denied for .*good\.js fails node --check/.test(r.out) && p.good === 'v3', `${r.code} ${r.out} ${JSON.stringify(p)}`);

        fs.writeFileSync(f('good.js'), goodSrc('v3')); // back to what runs
        fs.writeFileSync(f('thrower.js'), throwerSrc('t2', true));
        r = runScript([T, '--why', 'throwing accept']);
        p = await probe();
        check('a throwing accept() -> exit 51 "NOT reloaded", rolled back, the child still runs t1', r.code === 51 && /NOT reloaded: .*accept boom/.test(r.out) && /rolled back/.test(r.out) && p.thrower === 't1', `${r.code} ${r.out} ${JSON.stringify(p)}`);

        fs.writeFileSync(f('good.js'), goodSrc('v6'));
        r = runScript([G, T, '--why', 'batch']);
        p = await probe();
        check('a batch whose second file throws rolls the first back too: exit 51, child still v3 / t1', r.code === 51 && p.good === 'v3' && p.thrower === 't1' && /rolled back with the batch/.test(r.out), `${r.code} ${r.out} ${JSON.stringify(p)}`);
        fs.writeFileSync(f('thrower.js'), throwerSrc('t1', false));
        const before = p.disposes;
        r = runScript([G, '--why', 'after rollbacks']);
        p = await probe();
        check('after the rollbacks a good change still reloads (v6), no state left over', r.code === 0 && p.good === 'v6' && p.disposes > before, `${r.code} ${r.out} ${JSON.stringify(p)}`);

        fs.writeFileSync(f('unmarked.js'), unmarkedSrc('u2'));
        r = runScript([U, '--why', 'unmarked']);
        p = await probe();
        check('an unmarked loaded module -> exit 50 naming it; the child still runs u1', r.code === 50 && r.out.includes(`needs a restart: ${U} (not marked reloadable)`) && /restart-dreamscape\.sh/.test(r.out) && p.unmarked === 'u1', `${r.code} ${r.out} ${JSON.stringify(p)}`);
        r = runScript([G, U, '--why', 'mixed']);
        p = await probe();
        check('a batch with one unmarked file reloads nothing: exit 50, good stays v6', r.code === 50 && p.good === 'v6', `${r.code} ${r.out} ${JSON.stringify(p)}`);

        r = runScript([`${TMP_REL}/notloaded.js`, '--why', 'not loaded']);
        check('a file the server has not loaded -> exit 0 "nothing to reload" (its next require loads it)', r.code === 0 && /nothing to reload/.test(r.out), `${r.code} ${r.out}`);
        r = runScript([`${TMP_REL}/nope.js`, '--why', 'missing']);
        check('a missing file -> exit 51 (plan blocker)', r.code === 51 && /no such file/.test(r.out), `${r.code} ${r.out}`);

        r = runScript([G, '--why', 'no socket'], { HOT_RELOAD_SOCKET: path.join(DIR, 'absent.sock') });
        check('no socket -> exit 52 "has no reload socket ... one restart through scripts/restart-dreamscape.sh"', r.code === 52 && /has no reload socket/.test(r.out) && /restart-dreamscape\.sh/.test(r.out), `${r.code} ${r.out}`);
        fs.writeFileSync(path.join(DIR, 'stale.sock'), '');
        r = runScript([G, '--why', 'stale socket file'], { HOT_RELOAD_SOCKET: path.join(DIR, 'stale.sock') });
        check('a stale socket file (nobody listening) -> exit 52 too', r.code === 52, `${r.code} ${r.out}`);

        // the gate step itself (no RELOAD_GATE_SKIP): a syntax-free file passes node --check in the script, the gate then decides; with
        // the scratch database and a fake home the verdict does not depend on the real agents (part 2 covers the verdicts)
        r = runScript([G, '--why', 'real gate, dry', '--dry-run'], { RELOAD_GATE_SKIP: '', DREAMSCAPE_CLAUDE_HOME: path.join(DIR, 'nohome') });
        check('the real gate runs inside the script (--dry-run): exit 0 and a gate line', r.code === 0 && !/skipped/.test(r.out) && /dry run/.test(r.out), `${r.code} ${r.out}`);
    } finally {
        try { child.kill('SIGKILL'); } catch (_) { /* gone */ }
    }
}

// ---------------------------------------------------------------- part 2: the light gate

function gate(files, extra, env) {
    const r = spawnSync(process.execPath, [GATE, '--reload', files, '--why', 'gate test'].concat(extra || []), {
        cwd: ROOT, encoding: 'utf8', timeout: 90000,
        env: Object.assign({}, process.env, { AGENT_COORD_DB: DB, DREAMSCAPE_CLAUDE_HOME: path.join(DIR, 'home') }, env || {})
    });
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

async function part2() {
    console.log('--- part 2: restart-gate.js --reload against a scratch database and a fake live session');
    process.env.AGENT_COORD_DB = DB;
    const store = require('../modules/agentCoord/store');
    const G = `${TMP_REL}/good.js`;
    fs.mkdirSync(TMP_ABS, { recursive: true });
    fs.writeFileSync(path.join(TMP_ABS, 'good.js'), goodSrc('g'));
    fs.writeFileSync(path.join(TMP_ABS, 'bad.js'), "module.exports = { a: ===== };\n");
    // a fake live Claude session: a record in <home>/.claude/sessions/<pid>.json for a live pid that is not an ancestor of the gate
    const sleeper = spawn('sleep', ['300'], { stdio: 'ignore' });
    const sid = 'aaaaaaaa-1111-4222-8333-444444444444';
    const agentId = `claude-${sid.slice(0, 8)}`;
    fs.mkdirSync(path.join(DIR, 'home', '.claude', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(DIR, 'home', '.claude', 'sessions', `${sleeper.pid}.json`), JSON.stringify({ sessionId: sid, pid: sleeper.pid, cwd: ROOT, name: 'Fake editor', status: 'idle', startedAt: Date.now(), updatedAt: Date.now() }));
    const repo = store.repoOf(ROOT).name || 'staticforge';
    store.upsertAgent({ id: agentId, kind: 'claude', name: 'Fake editor', sessionId: sid, cwd: ROOT, repo, pid: sleeper.pid });
    store.upsertAgent({ id: 'other-agent', kind: 'claude', name: 'Other builder', cwd: ROOT, repo, pid: sleeper.pid });
    const setBuild = (target, running) => {
        const b = store.buildRequest('other-agent', { target, repo, note: 'test' });
        const id = b.build ? b.build.id : b.id;
        if (running) store.open().prepare("UPDATE builds SET state = 'running', started_at = ? WHERE id = ?").run(Date.now(), id);
        return id;
    };
    const endBuild = (id) => store.open().prepare("UPDATE builds SET state = 'done', ended_at = ? WHERE id = ?").run(Date.now(), id);
    try {
        let r = gate(G);
        check('nothing held, nobody editing: approved (exit 0)', r.code === 0 && /^approved/.test(r.out), `${r.code} ${r.out}`);
        r = gate(`${TMP_REL}/bad.js`, ['--json']);
        const j = JSON.parse(r.out);
        check('a listed file that fails node --check (uncommitted) -> denied, exit 30', r.code === 30 && j.verdict === 'denied' && /bad\.js fails node --check/.test(j.line), `${r.code} ${r.out}`);
        r = gate('modules/claudeSessions.js,modules/hotReload.js');
        check('committed listed files are validated and approved: exit 0', r.code === 0, `${r.code} ${r.out}`);

        let id = setBuild('hold-restart');
        r = gate(G);
        check('an open hold-restart does NOT hold a reload: exit 0', r.code === 0, `${r.code} ${r.out}`);
        endBuild(id);
        id = setBuild('hold-client-update');
        r = gate(G);
        check('an open hold-client-update does NOT hold a reload: exit 0', r.code === 0, `${r.code} ${r.out}`);
        endBuild(id);
        id = setBuild('apk-install', true);
        r = gate(G);
        check('some other running build (apk-install) does not hold a reload: exit 0', r.code === 0, `${r.code} ${r.out}`);
        endBuild(id);

        id = setBuild('hold-reload');
        r = gate(G);
        check('an open hold-reload holds the reload: exit 20 "wait for Other builder: hold-reload"', r.code === 20 && /wait for Other builder: hold-reload/.test(r.out), `${r.code} ${r.out}`);
        endBuild(id);
        id = setBuild('dreamscape-restart', true);
        r = gate(G);
        check('a running dreamscape-restart build (anyone) holds it: exit 20', r.code === 20 && /wait for the restart \(build \d+\) by Other builder/.test(r.out), `${r.code} ${r.out}`);
        endBuild(id);
        id = setBuild('module-reload', true);
        r = gate(G);
        check('a running module-reload build by someone else holds it: exit 20', r.code === 20 && /wait for the module reload \(build \d+\) by Other builder/.test(r.out), `${r.code} ${r.out}`);
        endBuild(id);
        r = gate(G);
        check('everything ended: approved again', r.code === 0, `${r.code} ${r.out}`);

        // asks: only a live session whose claim covers a listed file that is uncommitted
        store.claim(agentId, repo, ['modules/claudeSessions.js'], { note: 'test' });
        r = gate('modules/claudeSessions.js');
        check('a claim on a listed file that is committed asks nobody: exit 0', r.code === 0, `${r.code} ${r.out}`);
        store.claim(agentId, repo, ['modules/fleetKill.js'], { note: 'test' });
        r = gate(G);
        check('a claim on some other (dirty) file asks nobody about the listed one: exit 0', r.code === 0, `${r.code} ${r.out}`);
        store.claim(agentId, repo, [G], { note: 'test' });
        r = gate(G);
        check('a claim covering a listed uncommitted file asks that session: exit 10 "ask Fake editor"', r.code === 10 && /^ask Fake editor/.test(r.out), `${r.code} ${r.out}`);
        const gateAsks = store.open().prepare("SELECT name FROM sqlite_master WHERE name = 'gate_asks'").get();
        const rows = store.open().prepare('SELECT agent_id, files, why FROM reload_gate_asks').all();
        check('its ask is kept in reload_gate_asks (not gate_asks)', rows.length === 1 && rows[0].agent_id === agentId && rows[0].why === 'gate test' && (!gateAsks || store.open().prepare('SELECT COUNT(*) n FROM gate_asks').get().n === 0), JSON.stringify({ rows, gateAsks }));
        r = gate(G, ['--by', 'Fake editor (claude-aaaaaaaa)']);
        check('--by: the asker is not asked about its own claim: exit 0', r.code === 0, `${r.code} ${r.out}`);
        r = gate(G, ['--notify']);
        const msgs = store.inbox(agentId, { limit: 20, all: true });
        const m = (Array.isArray(msgs) ? msgs : (msgs && msgs.messages) || []).find((x) => /module reload/.test(x.body || ''));
        check('--notify posts a module-reload question from the "Reload gate" agent naming the file and hold-reload', r.code === 10 && m && /not a server restart/.test(m.body) && m.body.includes(G) && /reload-gate/.test(m.body) && /hold-reload/.test(m.body) && !/restart-gate/.test(m.body), `${r.code} ${r.out} ${JSON.stringify(m)}`);
        const sender = store.getAgent('reload-gate');
        check("the sender is the agent 'reload-gate' (name 'Reload gate', task 'Dreamscape module reloads')", sender && sender.name === 'Reload gate' && sender.task === 'Dreamscape module reloads', JSON.stringify(sender));
        r = gate('modules/claudeSessions.js');
        check('the ask row goes when nobody is asked any more', store.open().prepare('SELECT COUNT(*) n FROM reload_gate_asks').get().n === 0, `${r.code} ${r.out}`);
        r = spawnSync(process.execPath, [GATE, '--reload'], { cwd: ROOT, encoding: 'utf8' });
        check('--reload without files -> exit 2', r.status === 2, `${r.status} ${r.stderr}`);
        r = spawnSync(process.execPath, [GATE, '--reload', G, '--client'], { cwd: ROOT, encoding: 'utf8' });
        check('--reload with --client -> exit 2', r.status === 2, `${r.status} ${r.stderr}`);
    } finally {
        try { sleeper.kill('SIGKILL'); } catch (_) { /* gone */ }
        try { store.close(); } catch (_) { /* closed */ }
    }
}

(async () => {
    try {
        await part1();
        await part2();
    } catch (e) {
        failures += 1;
        console.log(`FAIL test crashed: ${e && e.stack ? e.stack : e}`);
    } finally {
        try { fs.rmSync(TMP_ABS, { recursive: true, force: true }); } catch (_) { /* gone */ }
        try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) { /* gone */ }
        console.log(fs.existsSync(TMP_ABS) ? 'FAIL the temp module folder is still there' : 'temp module folder removed');
        console.log(failures ? `${failures} FAILED` : 'all passed');
        process.exit(failures ? 1 : 0);
    }
})();
