#!/usr/bin/env node
'use strict';

// Yozora #833: automatic error capture (store surfaces/kinds/events/spool, server capture,
// client capture in fatalErrorBootstrap.js) and the fault auto-fix runner (filters, prompt,
// result parsing, the run lifecycle with a fake launcher). No real Claude run is started.
//
//   node scripts/test-error-capture.js            all of it
//   node scripts/test-error-capture.js --no-browser   skip the Chromium client part

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const reports = require('../modules/programFaultReports');
const capture = require('../modules/serverFaultCapture');
const autofix = require('../modules/faultAutoFix');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'error-capture-test-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function clientBody(extra = {}) {
    return Object.assign({
        surface: 'mobile',
        kind: 'uncaught',
        program: { key: 'shell:mobile', name: 'Melaton Mobile', core: true },
        errorName: 'TypeError',
        message: 'Cannot read properties of null (reading \'x\')',
        stack: 'TypeError: Cannot read properties of null\n    at go (http://h/scripts/comp/wmNotes.js?sha=1:2:300)\n    at run (http://h/scripts/comp/wmShell.js?sha=1:2:900)',
        client: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/131 Mobile Safari/537.36', shell: 'mobile' }
    }, extra);
}

async function testStore() {
    const dir = path.join(tmp, 'store');
    const store = reports.createStore({ dir });
    const events = [];
    store.events.on('change', (e) => events.push(e));

    const a = await store.upsert(clientBody({ occurrenceId: 'o1' }));
    assert.strictEqual(a.created, true);
    assert.strictEqual(a.report.surface, 'mobile');
    assert.strictEqual(a.report.kind, 'uncaught');
    assert.strictEqual(events.length, 1, 'a new fault emits change');

    await store.upsert(clientBody({ occurrenceId: 'o1', repeats: 4 }));
    assert.strictEqual(events.length, 1, 'an update of the same occurrence emits nothing');

    const b = await store.upsert(clientBody({ occurrenceId: 'o2', kind: 'logged' }));
    assert.strictEqual(b.id, a.id, 'kind is not part of the signature');
    assert.strictEqual(b.report.kind, 'uncaught', 'a less serious kind does not replace the report kind');
    const c = await store.upsert(clientBody({ occurrenceId: 'o3', kind: 'crash' }));
    assert.strictEqual(c.report.kind, 'crash', 'a more serious kind does');
    assert.strictEqual(events.length, 3);

    await store.patch(a.id, (r) => { r.status = 'fixed'; r.fix = { state: 'fixed' }; });
    const back = await store.read(a.id);
    assert.strictEqual(back.fix.state, 'fixed');
    const d = await store.upsert(clientBody({ occurrenceId: 'o4' }));
    assert.strictEqual(d.regressed, true, 'a fixed fault coming back is a regression');
    assert.strictEqual(events[events.length - 1].regressed, true);
    const list = await store.list();
    assert.strictEqual(list[0].surface, 'mobile');
    assert.strictEqual(list[0].fix.state, 'fixed');

    // bad surface/kind fall back
    const e = await store.upsert(clientBody({ occurrenceId: 'o5', surface: 'toaster', kind: 'nope', message: 'other' }));
    assert.strictEqual(e.report.surface, 'desktop');
    assert.strictEqual(e.report.kind, 'dialog');

    // spool: written synchronously, folded in by the next store's load()
    const spoolDir = path.join(tmp, 'spool');
    assert.ok(reports.spoolSync(clientBody({ surface: 'server', kind: 'crash', program: { key: 'server:modules/x.js', name: 'Dreamscape server (modules/x.js)', core: true }, message: 'boom' }), spoolDir));
    const s2 = reports.createStore({ dir: spoolDir });
    const seen = [];
    s2.events.on('change', (x) => seen.push(x));
    await s2.load();
    const after = await s2.list();
    assert.strictEqual(after.length, 1, 'the spooled crash became a report');
    assert.strictEqual(after[0].kind, 'crash');
    assert.ok(!fs.existsSync(path.join(spoolDir, '.spool.ndjson')), 'the spool is consumed');
    assert.strictEqual(seen.length, 1);
    console.log('  store: ok');
}

async function testServerCapture() {
    const dir = path.join(tmp, 'server');
    const store = reports.createStore({ dir });
    capture._reset();
    capture.install({ store });

    const top = capture.topOwnFrame(`Error: x\n    at f (${path.join(__dirname, '..', 'node_modules', 'ws', 'a.js')}:1:1)\n    at g (${path.join(__dirname, '..', 'modules', 'xiDirector.js')}:120:5)`);
    assert.deepStrictEqual(top, { file: 'modules/xiDirector.js', line: 120 }, 'node_modules frames are skipped');

    const err = new Error('route blew up 42');
    assert.ok(capture.captureRoute(err, { method: 'GET', originalUrl: '/api/thing?x=1' }));
    assert.ok(capture.captureRoute(new Error('route blew up 43'), { method: 'GET', originalUrl: '/api/thing' }), 'repeat inside the window is counted');
    await wait(50);
    let list = await store.list();
    assert.strictEqual(list.length, 1);
    const rep = await store.read(list[0].id);
    assert.strictEqual(rep.surface, 'server');
    assert.strictEqual(rep.kind, 'route');
    assert.strictEqual(rep.latest.request.path, '/api/thing');
    assert.strictEqual(rep.count, 1, 'the throttled repeat is not written yet');
    assert.ok(/^server:scripts\/test-error-capture\.js$/.test(rep.program.key), rep.program.key);

    // logged: only with a frame of ours
    const foreign = new Error('outside');
    foreign.stack = 'Error: outside\n    at x (/usr/lib/node_modules/thing/index.js:1:1)';
    assert.strictEqual(capture.capture(foreign, 'logged'), false);
    capture.hookLogger(null);
    const origErr = console.error;
    console.error('quiet test line', new Error('logged one'));
    assert.strictEqual(console.error, origErr, 'hooked once');
    await wait(50);
    list = await store.list();
    assert.ok(list.some((r) => r.kind === 'logged' && /logged one/.test(r.message)), 'console.error with our Error is captured');

    // rejection with a non-Error reason
    capture.capture('plain string reason', 'rejection');
    await wait(50);
    list = await store.list();
    assert.ok(list.some((r) => r.kind === 'rejection'));

    // crash goes to the spool synchronously
    assert.ok(capture.crash(new Error('fatal one')));
    assert.ok(fs.readFileSync(path.join(dir, '.spool.ndjson'), 'utf8').includes('fatal one'));

    // the throttled repeat is flushed to the spool on shutdown
    capture.flushPendingSync();
    const spool = fs.readFileSync(path.join(dir, '.spool.ndjson'), 'utf8');
    assert.ok(/route blew up/.test(spool) && /"repeats":1/.test(spool), 'pending repeats spooled');
    capture._reset();
    console.log('  server capture: ok');
}

async function testAutoFix() {
    const c = autofix.cfg(() => ({ faultAutoFix: { settleMs: 0 } }));
    const base = {
        id: 'fault_aaaaaaaaaaaa', surface: 'desktop', kind: 'uncaught', errorName: 'TypeError', message: 'x is null',
        latest: { stack: 'TypeError: x\n    at a (http://h/scripts/comp/foo.js?sha=1:2:3)', client: { userAgent: 'Chrome/131' } }
    };
    assert.strictEqual(autofix.ineligible(base, c), null);
    assert.strictEqual(autofix.ineligible(Object.assign({}, base, { message: 'Failed to fetch' }), c), 'noise');
    assert.strictEqual(autofix.ineligible(Object.assign({}, base, { kind: 'logged' }), c), 'kind logged is off');
    assert.strictEqual(autofix.ineligible(Object.assign({}, base, { latest: { stack: base.latest.stack, client: { userAgent: 'HeadlessChrome/131' } } }), c), 'headless test tab');
    assert.strictEqual(autofix.ineligible(Object.assign({}, base, { latest: { stack: 'at x (chrome-extension://abc/x.js:1:1)' } }), c), 'extension frame');
    assert.strictEqual(autofix.ineligible(Object.assign({}, base, { fix: { attempts: 2 } }), c), 'out of attempts');
    assert.strictEqual(autofix.ineligible(Object.assign({}, base, { fix: { state: 'proposed' } }), c), 'a fix is waiting to be landed');
    assert.strictEqual(autofix.ineligible(Object.assign({}, base, { fix: { state: 'proposed' } }), c, true), null, 'by hand ignores the filters');
    assert.strictEqual(autofix.ineligible(Object.assign({}, base, { surface: 'server', latest: { stack: 'Error\n    at f (/home/kanmi/staticforge/modules/a.js:1:1)' } }), c), null);

    const ok = autofix.parseResult([
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }),
        JSON.stringify({ type: 'result', is_error: false, result: 'Done.\nFAULT_FIX_RESULT {"status": "fixed", "issue": 900, "commit": "abc123", "branch": "autofix/x", "summary": "null check"}' })
    ].join('\n'));
    assert.deepStrictEqual(ok, { status: 'fixed', issue: 900, commit: 'abc123', branch: 'autofix/x', summary: 'null check' });
    assert.strictEqual(autofix.parseResult('garbage').status, 'failed');
    assert.strictEqual(autofix.parseResult(JSON.stringify({ type: 'result', result: 'FAULT_FIX_RESULT {"status":"weird"}' })).status, 'failed');

    // minified context reads the compiled copy
    const root = path.join(tmp, 'root');
    fs.mkdirSync(path.join(root, '.cache', 'runtime-assets', 'scripts', 'comp'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cache', 'runtime-assets', 'scripts', 'comp', 'foo.js'), '/*hdr*/\nfunction a(){return x.y.z}');
    const ctx = autofix.minifiedContext('at a (http://h/scripts/comp/foo.js?sha=1:2:20)', root);
    assert.strictEqual(ctx.length, 1);
    assert.ok(ctx[0].includes('<<HERE>>'), ctx[0]);

    // lifecycle with a fake launcher, live mode
    const dir = path.join(tmp, 'fix');
    const store = reports.createStore({ dir });
    const launches = [];
    const order = [];
    const comments = [];
    let yozoraDown = false;
    const yozora = {
        ensureIssue: async (rep) => { order.push('issue'); if (yozoraDown) throw new Error('Yozora down'); return 900 + Number(rep.message.length % 50); },
        comment: async (n, text) => { comments.push({ n, text }); }
    };
    let config = { faultAutoFix: { mode: 'live', settleMs: 0, maxRunsPerDay: 1 } };
    const fixer = autofix.createFixer({
        store,
        getConfig: () => config,
        yozora,
        snapshot: (id, issue) => { order.push('snapshot'); return issue ? 'snap1234' : null; },
        launch: (o) => { order.push('launch'); launches.push(o); return { pid: 0 }; } // pid 0: "not alive" on the next check
    });
    fixer.start();
    const r = await store.upsert(clientBody({ surface: 'desktop', client: { userAgent: 'Chrome/131' } }));
    await wait(30);
    let rep = await store.read(r.id);
    assert.strictEqual(rep.fix.state, 'queued', 'a new fault is queued');
    await fixer.tick();
    assert.strictEqual(launches.length, 1, 'one run started');
    assert.ok(launches[0].prompt.includes(r.id) && launches[0].prompt.includes('FAULT_FIX_RESULT'));
    assert.ok(launches[0].prompt.includes('Mode: live'));
    assert.deepStrictEqual(order, ['issue', 'snapshot', 'launch'], 'issue first, then the snapshot commit, then the run');
    assert.ok(/issue is #\d+/.test(launches[0].prompt) && launches[0].prompt.includes('snap1234'), 'the prompt names the issue and the snapshot');
    rep = await store.read(r.id);
    assert.strictEqual(rep.fix.state, 'running');
    assert.strictEqual(rep.fix.attempts, 1);
    const run = fixer._state().active;
    fs.writeFileSync(run.log, JSON.stringify({ type: 'result', result: 'FAULT_FIX_RESULT {"status":"fixed","issue":901,"commit":"deadbeef","branch":null,"summary":"guarded"}' }) + '\n');
    await fixer.tick();
    rep = await store.read(r.id);
    assert.strictEqual(rep.fix.state, 'fixed');
    assert.strictEqual(rep.status, 'fixed');
    assert.strictEqual(rep.fix.issue, 901);
    assert.strictEqual(fixer._state().active, null);
    assert.strictEqual(comments.length, 1, 'the result is commented on the issue');
    assert.ok(/ended: \*\*fixed\*\*/.test(comments[0].text) && comments[0].text.includes('snap1234'));

    // daily cap: a second fault waits (manual still goes)
    const r2 = await store.upsert(clientBody({ surface: 'desktop', message: 'second fault', client: { userAgent: 'Chrome/131' } }));
    await wait(30);
    await fixer.tick();
    assert.strictEqual(launches.length, 1, 'over the daily cap nothing starts');
    assert.strictEqual(fixer.status().queue.length, 1);
    const again = await fixer.enqueue(r2.id, { manual: true });
    assert.strictEqual(again.queued, false, 'already queued');

    // no issue, no run: Yozora down puts the fault back in the queue
    yozoraDown = true;
    config = { faultAutoFix: { mode: 'live', settleMs: 0, maxRunsPerDay: 5 } };
    order.length = 0;
    await fixer.tick();
    assert.deepStrictEqual(order, ['issue'], 'nothing is committed or launched without an issue');
    assert.strictEqual(launches.length, 1);
    const q = fixer._state().queue;
    assert.strictEqual(q.length, 1);
    assert.strictEqual(q[0].prepFailures, 1);
    assert.ok(q[0].readyAt > Date.now() + 60000, 'retried later');
    yozoraDown = false;

    // the real snapshot commits a dirty tree and does nothing on a clean one
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    const { execFileSync } = require('child_process');
    const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'a.js'), '1'); g('add', '-A'); g('commit', '-qm', 'init');
    assert.strictEqual(autofix.snapshotLiveTree('fault_x', 5, repo), null, 'clean tree: no commit');
    fs.writeFileSync(path.join(repo, 'a.js'), '2'); fs.writeFileSync(path.join(repo, 'b.js'), 'new');
    const snap = autofix.snapshotLiveTree('fault_x', 5, repo);
    assert.ok(/^[0-9a-f]{12}$/.test(snap));
    assert.strictEqual(g('status', '--porcelain').trim(), '', 'everything committed, untracked files too');
    assert.ok(g('log', '-1', '--format=%s').includes('#5'));

    // worktree mode: a "fixed" result is only "proposed"
    config = { faultAutoFix: { mode: 'worktree', settleMs: 0, maxRunsPerDay: 5 } };
    const wfixer = autofix.createFixer({ store: reports.createStore({ dir: path.join(tmp, 'wt') }), getConfig: () => config, launch: () => ({ pid: 0 }) });
    void wfixer; // prepareWorktree runs git; covered by buildPrompt below instead
    const prompt = autofix.buildPrompt(rep, autofix.cfg(() => config), { id: 'run_x', cwd: '/w', branch: 'autofix/fault_x', issue: 777, snapshot: null });
    assert.ok(prompt.includes('Mode: worktree') && prompt.includes('autofix/fault_x') && prompt.includes('do not push'));

    // settings from the Control Panel / phone: only checked keys, saved over config.json
    assert.deepStrictEqual(autofix.cleanSettings({ enabled: 'yes', mode: 'rm -rf', maxRunsPerDay: 999, ignore: ['x'] }), {}, 'bad values and other keys are dropped');
    assert.deepStrictEqual(autofix.cleanSettings({ enabled: false, mode: 'live', maxRunsPerDay: 0 }), { enabled: false, mode: 'live', maxRunsPerDay: 0 });
    const sdir = path.join(tmp, 'settings');
    const sstore = reports.createStore({ dir: sdir });
    const slaunches = [];
    const sfixer = autofix.createFixer({
        store: sstore,
        getConfig: () => ({ faultAutoFix: { mode: 'worktree', settleMs: 0, maxRunsPerDay: 8 } }),
        yozora: { ensureIssue: async () => 1, comment: async () => {} },
        snapshot: () => null,
        launch: (o) => { slaunches.push(o); return { pid: 0 }; }
    });
    sfixer.start();
    assert.strictEqual(sfixer.status().settings.maxRunsPerDay, 8, 'config.json until something is saved');
    const saved = sfixer.saveSettings({ maxRunsPerDay: 0, mode: 'live' });
    assert.strictEqual(saved.settings.maxRunsPerDay, 0);
    assert.strictEqual(saved.settings.mode, 'live');
    assert.ok(fs.existsSync(path.join(sdir, '.autofix-settings.json')));
    await sstore.upsert(clientBody({ surface: 'desktop', message: 'limited fault', client: { userAgent: 'Chrome/131' } }));
    await wait(30);
    await sfixer.tick();
    assert.strictEqual(slaunches.length, 0, 'a limit of 0 starts no automatic run');
    sfixer.saveSettings({ maxRunsPerDay: 3 });
    await sfixer.tick();
    assert.strictEqual(slaunches.length, 1, 'raising the limit lets the waiting fault start');
    assert.ok(slaunches[0].prompt.includes('Mode: live'), 'the saved mode wins over config.json');
    const reread = autofix.createFixer({ store: reports.createStore({ dir: sdir }), getConfig: () => ({}), launch: () => ({ pid: 0 }) });
    assert.strictEqual(reread.status().settings.maxRunsPerDay, 3, 'saved settings survive a restart');

    // disabled: nothing is queued automatically
    config = { faultAutoFix: { enabled: false } };
    const r3 = await store.upsert(clientBody({ surface: 'desktop', message: 'third fault', client: { userAgent: 'Chrome/131' } }));
    await wait(30);
    rep = await store.read(r3.id);
    assert.ok(!rep.fix, 'auto-fix off queues nothing');
    console.log('  auto-fix: ok');
}

/** playwright when installed, else puppeteer-core (PUPPETEER_CORE or ~/sf-ui-check) with /usr/bin/chromium. */
async function launchBrowser() {
    try {
        const { chromium } = require('playwright');
        return await chromium.launch();
    } catch (_) { /* try puppeteer-core */ }
    const candidates = [process.env.PUPPETEER_CORE, path.join(os.homedir(), 'sf-ui-check', 'node_modules', 'puppeteer-core')].filter(Boolean);
    for (const c of candidates) {
        try {
            const puppeteer = require(c);
            return await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
        } catch (_) { /* next */ }
    }
    return null;
}

async function testClient() {
    const http = require('http');
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'comp', 'fatalErrorBootstrap.js'), 'utf8');
    const browser = await launchBrowser();
    if (!browser) { console.log('  client: skipped (no playwright / puppeteer-core)'); return; }
    const posts = [];
    const pages = {
        '/desktop': '<!doctype html><html><head><script src="/scripts/comp/fatalErrorBootstrap.js"></script><script src="/scripts/comp/thrower.js"></script></head><body></body></html>',
        '/mobile': '<!doctype html><html class="ui-mobile"><head><script src="/scripts/comp/fatalErrorBootstrap.js"></script><script src="/scripts/comp/thrower.js"></script></head><body></body></html>'
    };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        if (url.pathname === '/api/fault-reports' && req.method === 'POST') {
            let data = '';
            req.on('data', (c) => { data += c; });
            req.on('end', () => {
                try { posts.push(JSON.parse(data)); } catch (_) { /* ignore */ }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{"ok":true,"id":"fault_000000000000"}');
            });
            return;
        }
        if (url.pathname === '/scripts/comp/fatalErrorBootstrap.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(src); }
        if (url.pathname === '/scripts/comp/thrower.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.boom = function () { null.x; };\nwindow.rejectIt = function () { Promise.reject(new Error(\'async nope\')); };\nwindow.logIt = function () { console.error(\'caught it\', new Error(\'logged nope\')); };'); }
        if (pages[url.pathname]) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(pages[url.pathname]); }
        res.writeHead(404);
        res.end('no');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const pause = (p, ms) => p.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);
    try {
        const p = await browser.newPage();
        await p.goto(base + '/desktop');
        await p.evaluate(() => {
            setTimeout(() => window.boom(), 0);
            setTimeout(() => window.boom(), 5);
            window.rejectIt();
            window.logIt();
            const s = document.createElement('script');
            s.src = '/scripts/comp/missing.js';
            document.head.appendChild(s);
        });
        await pause(p, 2500);
        const kinds = posts.map((b) => b.kind).sort();
        assert.deepStrictEqual(kinds, ['logged', 'rejection', 'resource', 'uncaught'], JSON.stringify(posts.map((b) => [b.kind, b.message])));
        const unc = posts.find((b) => b.kind === 'uncaught');
        assert.strictEqual(unc.surface, 'desktop');
        assert.strictEqual(unc.program.key, 'shell:desktop');
        assert.strictEqual(unc.repeats, 2, 'both throws inside the first-post delay are in the first post');
        assert.ok(/thrower\.js/.test(unc.stack));
        assert.ok(posts.find((b) => b.kind === 'resource').message.includes('/scripts/comp/missing.js'));
        // the counted repeat goes out on pagehide with the same occurrenceId
        const before = posts.length;
        await p.evaluate(() => { setTimeout(() => window.boom(), 0); setTimeout(() => window.dispatchEvent(new Event('pagehide')), 50); });
        await pause(p, 400);
        const rep = posts.slice(before).find((b) => b.occurrenceId === unc.occurrenceId);
        assert.ok(rep && rep.repeats === 3, 'a later repeat is flushed on pagehide with the same occurrenceId');

        // phone shell
        posts.length = 0;
        const p2 = await browser.newPage();
        await p2.goto(base + '/mobile');
        await p2.evaluate(() => setTimeout(() => window.boom(), 0));
        await pause(p2, 2200);
        assert.strictEqual(posts.length, 1, JSON.stringify(posts.map((b) => [b.kind, b.message])));
        assert.strictEqual(posts[0].surface, 'mobile');
        assert.strictEqual(posts[0].program.key, 'shell:mobile');
        console.log('  client: ok');
    } finally {
        await browser.close();
        server.close();
    }
}

(async () => {
    try {
        await testStore();
        await testServerCapture();
        await testAutoFix();
        if (!process.argv.includes('--no-browser')) await testClient();
        console.log('test-error-capture: ok');
    } catch (err) {
        console.error('test-error-capture: FAILED');
        console.error(err && err.stack || err);
        process.exitCode = 1;
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
})();
