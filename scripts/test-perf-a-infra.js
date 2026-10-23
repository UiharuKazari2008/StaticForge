#!/usr/bin/env node
'use strict';

// Yozora #620 slice a-infra: old vs new equivalence + timings for tracing, the request
// body logger, busy snapshot, served-file hashes, cover site resolver, Apocrypha caches,
// cache dir expiry and the compile log prune.
//   node scripts/test-perf-a-infra.js            fixtures only
//   PERF_REAL_TRACES=/path/.cache/traces node scripts/test-perf-a-infra.js   + read-only bench

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(process.env.PERF_SCRATCH || os.tmpdir(), '.perf-a-infra-'));

function ms(t0) {
    return Number(process.hrtime.bigint() - t0) / 1e6;
}

function now() {
    return process.hrtime.bigint();
}

// Load modules/tracing.js with its tracesDir pointed somewhere else.
function loadTracingAt(dir) {
    const file = path.join(root, 'modules', 'tracing.js');
    const src = fs.readFileSync(file, 'utf8').replace(
        "const tracesDir = path.join(cacheDir, 'traces');",
        `const tracesDir = ${JSON.stringify(dir)};`
    );
    assert.ok(src.includes(JSON.stringify(dir)), 'tracesDir line not found');
    const m = new Module(file, module);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(src, file);
    return m.exports;
}

// The listTraces body before #620 (sync read + parse of every file), for equivalence.
function oldListTraces(tracesDir) {
    const files = fs.readdirSync(tracesDir).filter(f => f.endsWith('.json'));
    return files.map(f => {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(tracesDir, f), 'utf8'));
            if (!data.id || !data.startedAt) return null;
            return {
                id: data.id,
                startedAt: data.startedAt,
                endedAt: data.endedAt || null,
                status: data.status || 'unknown',
                summary: data.meta?.summary || null
            };
        } catch (e) {
            return null;
        }
    }).filter(Boolean).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

async function testTracing() {
    const dir = path.join(scratch, 'traces');
    fs.mkdirSync(dir, { recursive: true });
    // Pre-existing files, one invalid.
    for (let i = 0; i < 30; i++) {
        fs.writeFileSync(path.join(dir, `old-${i}.json`), JSON.stringify({
            id: `old-${i}`, startedAt: 1000 + i, status: i % 2 ? 'completed' : 'failed',
            endedAt: i % 3 ? 2000 + i : undefined, meta: i % 4 ? { summary: `s${i}` } : {}, events: [], attachments: []
        }, null, 2));
    }
    fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
    fs.writeFileSync(path.join(dir, 'noid.json'), JSON.stringify({ startedAt: 5 }));

    const tracing = loadTracingAt(dir);
    const quiet = console.log;
    const qerr = console.error;
    const qwarn = console.warn;
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    try {
        const first = await tracing.listTraces();
        assert.deepStrictEqual(first, oldListTraces(dir), 'listTraces matches the old reader on disk');

        const b64 = 'iVBORw0KGgo' + 'A'.repeat(200000) + '==';
        const id = tracing.startTrace('req-1', { type: 'single_generation' });
        tracing.addEvent(id, { type: 'request_body', body: { prompt: 'a cat', image: b64, mask: `data:image/png;base64,${b64}`, n: 1 } });
        for (let i = 0; i < 50; i++) tracing.addEvent(id, { type: 'step', i });
        tracing.addImageAttachment(id, 'final', Buffer.from('png-bytes'), 'png', { seed: 7 });
        // In memory while open: loadTrace returns the live trace.
        assert.strictEqual(tracing.loadTrace(id).events.length, 52);
        const midList = await tracing.listTraces();
        assert.ok(midList.find(t => t.id === id && t.status === 'running'), 'open trace listed');
        tracing.finalizeTrace(id, 'completed', { summary: 'done' });
        // Late event after finalize (pending write) is not lost.
        tracing.addEvent(id, { type: 'late' });
        await tracing.flushTraces();

        const text = fs.readFileSync(path.join(dir, `${id}.json`), 'utf8');
        assert.ok(!text.includes('\n'), 'compact JSON');
        assert.ok(!text.includes('AAAAAAAAAAAAAAAA'), 'base64 stripped');
        const onDisk = JSON.parse(text);
        assert.strictEqual(onDisk.status, 'completed');
        assert.strictEqual(onDisk.meta.summary, 'done');
        assert.strictEqual(onDisk.events.length, 53);
        assert.strictEqual(onDisk.events[0].body.prompt, 'a cat');
        assert.strictEqual(onDisk.events[0].body.image, `[base64 omitted: ${b64.length} chars]`);
        assert.strictEqual(onDisk.events[0].body.mask, `[base64 omitted: ${b64.length + 22} chars, data:image/png;base64,]`);
        assert.strictEqual(onDisk.events[onDisk.events.length - 1].type, 'late');
        assert.strictEqual(fs.readFileSync(path.join(dir, onDisk.attachments[0].path), 'utf8'), 'png-bytes');
        assert.deepStrictEqual(tracing.loadTrace(id), onDisk, 'loadTrace reads the written file');

        // External deletion (cache expiry) drops the row; listTraces equals the old reader.
        fs.unlinkSync(path.join(dir, 'old-3.json'));
        const after = await tracing.listTraces();
        assert.deepStrictEqual(after, oldListTraces(dir));
        assert.ok(!after.find(t => t.id === 'old-3'));

        // Sanitizer leaves ordinary values alone.
        const plain = { a: 'x'.repeat(5000) + ' y', b: [1, null, { c: true }], d: new Date(0) };
        assert.deepStrictEqual(tracing.sanitizeTraceValue(plain), JSON.parse(JSON.stringify(plain)));

        // Write cost: old = pretty stringify + writeFileSync per event.
        const big = { id: 'bench', events: [{ type: 'request_body', body: { image: b64 } }], attachments: [] };
        let t0 = now();
        for (let i = 0; i < 50; i++) {
            big.events.push({ type: 'step', i });
            fs.writeFileSync(path.join(dir, 'bench-old.json.tmp'), JSON.stringify(big, null, 2));
        }
        const oldWrite = ms(t0);
        t0 = now();
        const bid = tracing.startTrace('bench-new');
        tracing.addEvent(bid, { type: 'request_body', body: { image: b64 } });
        for (let i = 0; i < 50; i++) tracing.addEvent(bid, { type: 'step', i });
        const newSync = ms(t0);
        tracing.finalizeTrace(bid);
        await tracing.flushTraces();
        console.log = quiet;
        console.log(`tracing: 51 events, old sync writes ${oldWrite.toFixed(1)} ms, new sync path ${newSync.toFixed(1)} ms (+1 coalesced write)`);

        const realDir = process.env.PERF_REAL_TRACES;
        if (realDir && fs.existsSync(realDir)) {
            console.log = () => {};
            const real = loadTracingAt(realDir);
            t0 = now();
            const oldRows = oldListTraces(realDir);
            const oldMs = ms(t0);
            t0 = now();
            const firstRows = await real.listTraces();
            const firstMs = ms(t0);
            t0 = now();
            const againRows = await real.listTraces();
            const againMs = ms(t0);
            console.log = quiet;
            assert.deepStrictEqual(firstRows, oldRows, 'real dir: same rows');
            assert.deepStrictEqual(againRows, oldRows, 'real dir: same rows from index');
            console.log(`listTraces real (${oldRows.length} rows): old ${oldMs.toFixed(0)} ms sync, new first ${firstMs.toFixed(0)} ms async, new cached ${againMs.toFixed(1)} ms`);
        }
    } finally {
        console.log = quiet;
        console.error = qerr;
        console.warn = qwarn;
    }
}

// formatLoggedBody is a web_server.js local; evaluate its source block.
function loadBodyLogger() {
    const src = fs.readFileSync(path.join(root, 'web_server.js'), 'utf8');
    const start = src.indexOf('const LOGGED_SECRET_KEY_RE');
    const end = src.indexOf('// Logger // NOTE');
    assert.ok(start > 0 && end > start);
    // eslint-disable-next-line no-new-func
    return new Function(`${src.slice(start, end)}; return { formatLoggedBody, redactLoggedSecret };`)();
}

function testBodyLogger() {
    const { formatLoggedBody, redactLoggedSecret } = loadBodyLogger();
    const samples = [
        { a: 1, b: 'two', c: [1, 2, { d: null }], e: true },
        { password: 'hunter2', nested: { apiKey: 'k', pin: '1234', ok: 'fine' }, url: 'rdp://bob:secret@host/x' },
        { list: [], obj: {}, skip: undefined, fn() {}, n: -0.5, s: 'quote " and \\ and \n' },
        { when: new Date(0), arr: [undefined, 'x'] },
        { secret: { deep: 'x' }, login_key: '', pass: null }
    ];
    for (const body of samples) {
        assert.strictEqual(formatLoggedBody(body, 0), JSON.stringify(body, redactLoggedSecret), JSON.stringify(body));
    }
    const huge = { prompt: 'a cat', image: 'A'.repeat(50 * 1024 * 1024), rows: Array.from({ length: 10000 }, (_, i) => ({ i })) };
    let t0 = now();
    JSON.stringify(huge, redactLoggedSecret);
    const oldMs = ms(t0);
    t0 = now();
    const line = formatLoggedBody(huge, 52 * 1024 * 1024);
    const newMs = ms(t0);
    assert.ok(line.length < 2600, `bounded (${line.length})`);
    assert.ok(line.startsWith('{"prompt":"a cat","image":"AAAA'));
    assert.ok(line.includes('...(52428800 chars)'));
    assert.ok(line.includes('truncated, ~53248 KB, keys: prompt, image, rows'));
    const long = formatLoggedBody({ password: 'p'.repeat(1000), u: `https://me:${'x'.repeat(400)}@h/` }, 0);
    assert.ok(!long.includes('ppp') && !long.includes('xxx'), long);
    console.log(`body logger: 50 MB body, old ${oldMs.toFixed(0)} ms, new ${newMs.toFixed(2)} ms, ${line.length} chars`);
}

async function testBusySnapshot() {
    const busy = require('../modules/busyStatus');
    busy.resetForTests();
    const file = path.join(scratch, 'busy', 'busy-status.json');
    await busy.startLoopback({
        file,
        collect: { director: [], xi: [], generation: { processing: false }, localJobs: [], mcp: [], smtp: [] }
    });
    const fixed = { busy: false, reasons: [] };
    await busy.writeSnapshot(fixed, { force: true });
    const first = busy.readSnapshot(file);
    assert.deepStrictEqual(first.status, fixed);
    assert.strictEqual(first.pid, process.pid);
    assert.deepStrictEqual(Object.keys(first), ['pid', 'port', 'at', 'status']);
    await busy.writeSnapshot(fixed);
    assert.strictEqual(busy.readSnapshot(file).at, first.at, 'unchanged status skipped');
    await busy.writeSnapshot({ busy: true, reasons: ['x'] });
    assert.deepStrictEqual(busy.readSnapshot(file).status.reasons, ['x'], 'changed status written');
    // Many writes while one is in flight collapse to the newest.
    const writes = [];
    for (let i = 0; i < 20; i++) writes.push(busy.writeSnapshot({ busy: true, reasons: [`r${i}`] }));
    await Promise.all(writes);
    assert.deepStrictEqual(busy.readSnapshot(file).status.reasons, ['r19']);
    busy.resetForTests();
    console.log('busy snapshot: skip-unchanged + coalesced writes ok');
}

function testHashServedFile() {
    const ras = require('../modules/runtimeAssetService');
    const crypto = require('crypto');
    const file = path.join(scratch, 'served.js');
    fs.writeFileSync(file, 'x'.repeat(300000));
    const want = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    assert.strictEqual(ras.hashServedFile(file), want(file));
    let t0 = now();
    for (let i = 0; i < 200; i++) crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const oldMs = ms(t0);
    t0 = now();
    for (let i = 0; i < 200; i++) ras.hashServedFile(file);
    const newMs = ms(t0);
    fs.writeFileSync(file, 'y'.repeat(300001));
    assert.strictEqual(ras.hashServedFile(file), want(file), 'size change re-hashes');
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(file, 'z'.repeat(300001));
    fs.utimesSync(file, later, later);
    assert.strictEqual(ras.hashServedFile(file), want(file), 'mtime change re-hashes');
    assert.throws(() => ras.hashServedFile(path.join(scratch, 'missing.js')));
    console.log(`hashServedFile: 200 x 300 KB, old ${oldMs.toFixed(1)} ms, new ${newMs.toFixed(1)} ms`);
}

function testInstallManifestBench() {
    // What the memo saves per OPTIONS /: one stat per manifest row.
    const filter = require('../modules/installManifestFilter');
    const entries = [];
    const walk = (dir, web) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.name.startsWith('.')) continue;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) walk(full, `${web}/${ent.name}`);
            else entries.push({ url: `${web}/${encodeURIComponent(ent.name)}` });
        }
    };
    walk(path.join(root, 'public'), '');
    const t0 = now();
    const kept = filter.filterExistingManifestEntries(root, entries);
    const elapsed = ms(t0);
    assert.ok(kept.length > 0);
    console.log(`install manifest filter: ${entries.length} rows, ${elapsed.toFixed(1)} ms per uncached build (memoised now)`);
}

async function testCoverSite() {
    const storage = require('../modules/siteHomepageStorage');
    const sitesRoot = storage.coverSitesRoot(root);
    const slugs = storage.listAvailableSlugs(root);
    assert.ok(slugs.length > 0, 'cover sites present');
    const urls = ['/', '/index.html', '/nope', '/../x', '/manifest.json', '/door.json', '', '/a/b', '/404.html'];
    for (const slug of slugs) {
        const dir = path.join(sitesRoot, slug);
        for (const name of fs.readdirSync(dir)) urls.push(`/${name}`);
        for (const u of urls) {
            assert.deepStrictEqual(await storage.resolveSiteFileAsync(dir, u), storage.resolveSiteFile(dir, u), `${slug} ${u}`);
        }
        const meta = storage.readDoorMeta(dir);
        meta.postPath = 'mutated';
        assert.notStrictEqual(storage.readDoorMeta(dir).postPath, 'mutated', 'door meta copy');
    }
    console.log(`cover site: async resolver matches sync on ${slugs.length} sites`);
}

function testApocrypha() {
    const dataDir = path.join(scratch, 'apocrypha');
    fs.mkdirSync(path.join(dataDir, 'archive'), { recursive: true });
    process.env.APOCRYPHA_DATA_DIR = dataDir;
    const site = require('../modules/apocryphaSite');
    const archive = path.join(dataDir, 'archive');
    for (let i = 0; i < 12; i++) {
        fs.writeFileSync(path.join(archive, `issue-${i}.json`), JSON.stringify({ issueLabel: `Issue ${i}`, kicker: `2026-09-${10 + i}` }));
    }
    fs.writeFileSync(path.join(archive, 'bad.json'), '{');
    const oldList = () => {
        const rows = [];
        for (const name of fs.readdirSync(archive)) {
            if (!name.endsWith('.json')) continue;
            const slug = name.slice(0, -5);
            let data = null;
            try { data = JSON.parse(fs.readFileSync(path.join(archive, name), 'utf8')); } catch (_) { data = null; }
            if (!data) continue;
            rows.push({ slug, issueLabel: data.issueLabel || slug, kicker: data.kicker || null });
        }
        rows.sort((a, b) => String(b.kicker || b.slug).localeCompare(String(a.kicker || a.slug)));
        return rows;
    };
    const qerr = console.error;
    console.error = () => {};
    try {
        assert.deepStrictEqual(site.listArchivedIssues(), oldList());
        const later = new Date(Date.now() + 5000);
        fs.writeFileSync(path.join(archive, 'issue-3.json'), JSON.stringify({ issueLabel: 'Edited', kicker: '2026-09-13' }));
        fs.utimesSync(path.join(archive, 'issue-3.json'), later, later);
        fs.unlinkSync(path.join(archive, 'issue-4.json'));
        fs.writeFileSync(path.join(archive, 'issue-99.json'), JSON.stringify({ issueLabel: 'New' }));
        assert.deepStrictEqual(site.listArchivedIssues(), oldList(), 'edits, deletes, adds seen');
        const rows = site.listArchivedIssues();
        rows[0].issueLabel = 'mutated';
        assert.notStrictEqual(site.listArchivedIssues()[0].issueLabel, 'mutated');
        let t0 = now();
        for (let i = 0; i < 200; i++) oldList();
        const oldMs = ms(t0);
        t0 = now();
        for (let i = 0; i < 200; i++) site.listArchivedIssues();
        const newMs = ms(t0);

        assert.strictEqual(site.getApocryphaData(), null);
        assert.ok(site.publishApocrypha({ issueLabel: 'Live', sections: [{ id: 'a', title: 't', body: 'b' }] }).success);
        const live = site.getApocryphaData();
        assert.strictEqual(live.issueLabel, 'Live');
        assert.deepStrictEqual(live.sections.map(sec => sec.id), ['a']);
        live.sections.push({ id: 'b' });
        assert.strictEqual(site.getApocryphaData().sections.length, 1, 'callers get a copy');
        assert.ok(site.publishApocrypha({ id: 'c', title: 't', body: 'b' }).success);
        assert.deepStrictEqual(site.getApocryphaData().sections.map(sec => sec.id), ['a', 'c'], 'writer invalidates');
        assert.ok(site.revokeApocryphaSection({ id: 'a' }).success);
        assert.deepStrictEqual(site.getApocryphaData().sections.map(sec => sec.id), ['c'], 'revoke invalidates');
        const later2 = new Date(Date.now() + 9000);
        fs.writeFileSync(path.join(dataDir, 'current.json'), JSON.stringify({ issueLabel: 'Hand edit' }));
        fs.utimesSync(path.join(dataDir, 'current.json'), later2, later2);
        assert.strictEqual(site.getApocryphaData().issueLabel, 'Hand edit', 'external edit seen');
        console.log(`apocrypha archive list: 200 views, old ${oldMs.toFixed(1)} ms, new ${newMs.toFixed(1)} ms`);
    } finally {
        console.error = qerr;
    }
}

async function testCacheDirExpiry() {
    const expiry = require('../modules/cacheDirExpiry');
    const dir = path.join(scratch, 'expiry', 'traces');
    fs.mkdirSync(dir, { recursive: true });
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const mk = (name, isDir, aged) => {
        const p = path.join(dir, name);
        if (isDir) { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'a.png'), 'x'); }
        else fs.writeFileSync(p, '{}');
        if (aged) fs.utimesSync(p, old, old);
    };
    mk('a.json', false, true); mk('a', true, false);
    mk('b.json', false, false); mk('b', true, true);
    mk('c', true, true);
    mk('d.json', false, true);
    const res = await expiry.expireTracesDir(dir, 14 * 24 * 3600 * 1000);
    assert.deepStrictEqual(res, { jsonRemoved: 2, dirsRemoved: 2 });
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['b', 'b.json']);
    assert.deepStrictEqual(await expiry.expireTracesDir(path.join(scratch, 'none'), 1), { jsonRemoved: 0, dirsRemoved: 0 });
    const dyn = path.join(scratch, 'expiry', 'dyn');
    fs.mkdirSync(dyn, { recursive: true });
    fs.writeFileSync(path.join(dyn, 'x.png'), 'x');
    fs.utimesSync(path.join(dyn, 'x.png'), old, old);
    fs.writeFileSync(path.join(dyn, 'y.png'), 'y');
    assert.strictEqual(await expiry.expireDynGenPreviewDir(dyn, 7 * 24 * 3600 * 1000), 1);
    assert.strictEqual(await expiry.expireDynGenPreviewDir(path.join(scratch, 'none'), 1), 0);
    console.log('cache dir expiry: async results match');
}

function testCompileLog() {
    const store = require('../modules/runtimeCompileLogStore');
    const logs = path.join(scratch, 'logs');
    store.init({ logsDir: logs });
    const file = store.getLogPath();
    let rewrites = 0;
    let lastSize = 0;
    const entry = (i) => ({ runId: 'rc_x', file: `/f${i}.js`, tool: 'terser', type: 'warning', message: 'm'.repeat(300) });
    for (let i = 0; i < 4000; i++) {
        store.appendEntries([entry(i)], { broadcast: false });
        const size = fs.statSync(file).size;
        if (size < lastSize) rewrites++;
        lastSize = size;
    }
    const size = fs.statSync(file).size;
    assert.ok(size < 512 * 1024, `under threshold (${size})`);
    // ~1.4 MB written in total: old code rewrote the file on every append past 512 KB.
    assert.ok(rewrites > 0 && rewrites < 10, `few rewrites (${rewrites})`);
    const recent = store.getRecentEntries(5);
    assert.strictEqual(recent.length, 5);
    assert.ok(recent[4].includes('/f3999.js'), 'newest line kept');
    console.log(`compile log: 4000 appends, ${rewrites} prune rewrites, final ${(size / 1024).toFixed(0)} KB`);
}

async function main() {
    try {
        await testTracing();
        testBodyLogger();
        await testBusySnapshot();
        testHashServedFile();
        testInstallManifestBench();
        await testCoverSite();
        testApocrypha();
        await testCacheDirExpiry();
        testCompileLog();
        console.log('test-perf-a-infra: ok');
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

main().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
});
