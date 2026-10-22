'use strict';

/**
 * Perf slice e-config (#620): reactive config stat throttle, window position merge cap,
 * Studio settings catalog without the prompt.config clone, checkpoint save fast path.
 * Run: node scripts/test-perf-e-config.js
 * Uses copies of the live configs when present (read only), synthetic data otherwise.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LIVE_ROOT = '/home/kanmi/staticforge';
const { ConfigManager, mergeWindowPositionsWithImageViewerCap, IMAGE_VIEWER_POSITION_CAP } = require('../modules/configManager');
const { JSONCheckpointManager } = require('../modules/jsonCheckpoint');
const { buildStudioSettingsCatalog } = require('../modules/studioSettingsCatalog');

const workBase = process.env.PERF_WORK_DIR || path.join(os.homedir(), '.cache', 'perfscan', 'e-config');
fs.mkdirSync(workBase, { recursive: true });
const workDir = fs.mkdtempSync(path.join(workBase, 'test-'));
process.on('exit', () => fs.rmSync(workDir, { recursive: true, force: true }));

function ms(fn, n = 1) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) fn();
    return Number(process.hrtime.bigint() - t0) / 1e6;
}

function readJsonIfExists(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_err) {
        return null;
    }
}

function fakeGlobalResources(extra = {}) {
    return Object.assign({
        getPath: () => workDir,
        getConfig: () => ({}),
        getWebSocketServer: () => null
    }, extra);
}

// ---------------------------------------------------------------------------
// 1. _getReactiveConfig: stat at most once per ~1 s, same values and clone semantics
// ---------------------------------------------------------------------------
(function testReactiveConfig() {
    const file = path.join(workDir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ a: { b: [1, 2] }, c: 'x' }, null, 2));
    const cm = new ConfigManager(fakeGlobalResources(), { config: { name: 'config', path: file } });

    const realStat = fs.statSync;
    let stats = 0;
    fs.statSync = function countingStat(...args) {
        stats++;
        return realStat.apply(fs, args);
    };
    try {
        const first = cm._getReactiveConfig('config');
        assert.deepStrictEqual(first, { a: { b: [1, 2] }, c: 'x' });
        assert.strictEqual(stats, 1, 'first get stats once');
        for (let i = 0; i < 1000; i++) cm._getReactiveConfig('config');
        assert.strictEqual(stats, 1, 'reads inside the interval do not stat');

        // Clone semantics unchanged
        assert.strictEqual(cm._getReactiveConfig('config'), first, 'no clone returns the cache');
        const cloned = cm._getReactiveConfig('config', null, true);
        assert.notStrictEqual(cloned, first);
        assert.deepStrictEqual(cloned, first);
        assert.strictEqual(cm._getReactiveConfig('config', 'a.b'), first.a.b);
        const sub = cm._getReactiveConfig('config', 'a.b', true);
        assert.notStrictEqual(sub, first.a.b);
        assert.deepStrictEqual(sub, [1, 2]);
        assert.strictEqual(cm._getReactiveConfig('config', 'missing.path', true), undefined);

        // External edit is picked up once the interval passes
        fs.writeFileSync(file, JSON.stringify({ a: { b: [3] }, c: 'y' }, null, 2));
        const future = new Date(Date.now() + 5000);
        fs.utimesSync(file, future, future);
        assert.strictEqual(cm._getReactiveConfig('config').c, 'x', 'inside the interval: cached');
        cm._configs.config.lastStatAt -= 1001;
        assert.strictEqual(cm._getReactiveConfig('config').c, 'y', 'after the interval: reloaded');

        // Missing file keeps serving the cache (old existsSync path)
        fs.renameSync(file, `${file}.gone`);
        cm._configs.config.lastStatAt = 0;
        assert.strictEqual(cm._getReactiveConfig('config').c, 'y');
        fs.renameSync(`${file}.gone`, file);
    } finally {
        fs.statSync = realStat;
    }

    // In-process saves are visible immediately (cache + lastSaved updated on write)
    const desktopFile = path.join(workDir, 'workspace-desktop.json');
    fs.writeFileSync(desktopFile, JSON.stringify({ default: { shortcuts: [] }, windowPositions: {} }));
    const cm2 = new ConfigManager(fakeGlobalResources(), { workspaceDesktop: { name: 'workspaceDesktop', path: desktopFile } });
    cm2.initializeCheckpointManagers();
    cm2._getReactiveConfig('workspaceDesktop');
    const next = { default: { shortcuts: [] }, windowPositions: { galleryWindow: { topLeft: { index: 1, x: 0.1, y: 0.1 } } } };
    cm2.saveConfig('workspaceDesktop', next, { force: true });
    assert.strictEqual(cm2._getReactiveConfig('workspaceDesktop'), next, 'save visible at once');
    cm2._configs.workspaceDesktop.lastStatAt = 0;
    assert.strictEqual(cm2._getReactiveConfig('workspaceDesktop'), next, 'own write does not trigger a reload');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(desktopFile, 'utf8')), next);

    // Timing: old per-get existsSync+statSync vs throttled
    const N = 20000;
    const oldMs = ms(() => {
        if (fs.existsSync(file)) fs.statSync(file).mtime.getTime();
    }, N);
    const newMs = ms(() => cm._getReactiveConfig('config'), N);
    console.log(`  reactive get x${N}: old stat path ${oldMs.toFixed(1)} ms, new ${newMs.toFixed(1)} ms`);
    console.log('ok 1 reactive config throttle');
})();

// ---------------------------------------------------------------------------
// 4. window positions: shallow merge, imageViewer cap, same as spread otherwise
// ---------------------------------------------------------------------------
(function testWindowPositions() {
    const pos = (x) => ({ topLeft: { index: 1, x, y: 0.5 }, bottomRight: { index: 4, x: 0.9, y: 0.9 } });

    // Non-imageViewer keys: identical to the old spread merge
    const existing = { galleryWindow: pos(0.1), notebookModal: pos(0.2) };
    const incoming = { notebookModal: pos(0.3), wikiWindow: pos(0.4) };
    assert.deepStrictEqual(
        mergeWindowPositionsWithImageViewerCap(existing, incoming, new Map()),
        { ...existing, ...incoming }
    );
    assert.deepStrictEqual(existing, { galleryWindow: pos(0.1), notebookModal: pos(0.2) }, 'input untouched');

    // Under the cap: same content as the spread
    const small = {};
    for (let i = 0; i < 50; i++) small[`imageViewer:${i}.png`] = pos(i / 100);
    const smallIn = { ...small, 'imageViewer:new.png': pos(0.5), 'imageViewer:3.png': pos(0.99) };
    assert.deepStrictEqual(
        mergeWindowPositionsWithImageViewerCap(small, smallIn, new Map()),
        { ...small, ...smallIn }
    );

    // Cap: oldest by update order go; a changed entry becomes newest; others untouched
    const tomb = new Map();
    const big = { galleryWindow: pos(0.1) };
    for (let i = 0; i < 150; i++) big[`imageViewer:${i}.png`] = pos(0.01);
    const clientMap = { ...big, 'imageViewer:0.png': pos(0.02) };
    let merged = mergeWindowPositionsWithImageViewerCap(big, clientMap, tomb);
    let viewers = Object.keys(merged).filter((k) => k.startsWith('imageViewer:'));
    assert.strictEqual(viewers.length, IMAGE_VIEWER_POSITION_CAP);
    assert.ok(merged['imageViewer:0.png'], 'changed entry kept as newest');
    assert.strictEqual(viewers[viewers.length - 1], 'imageViewer:0.png');
    assert.ok(!merged['imageViewer:1.png'] && merged['imageViewer:149.png']);
    assert.deepStrictEqual(merged.galleryWindow, pos(0.1));

    // The client re-sends its full (uncapped) map: evicted unchanged entries stay out
    const again = mergeWindowPositionsWithImageViewerCap(merged, { ...clientMap, 'imageViewer:fresh.png': pos(0.3) }, tomb);
    viewers = Object.keys(again).filter((k) => k.startsWith('imageViewer:'));
    assert.strictEqual(viewers.length, IMAGE_VIEWER_POSITION_CAP);
    assert.strictEqual(viewers[viewers.length - 1], 'imageViewer:fresh.png');
    assert.ok(again['imageViewer:0.png'], 'recent entry survives the stale re-send');
    // Evicted entry moved again (changed value) comes back as newest
    const moved = mergeWindowPositionsWithImageViewerCap(again, { 'imageViewer:1.png': pos(0.7) }, tomb);
    assert.deepStrictEqual(moved['imageViewer:1.png'], pos(0.7));

    // Stale batch after a restart (no tombstones): stored recent entries are kept
    const stale = mergeWindowPositionsWithImageViewerCap(again, clientMap, new Map());
    assert.deepStrictEqual(
        Object.keys(stale).filter((k) => k.startsWith('imageViewer:')),
        viewers,
        'stale batch does not displace stored entries'
    );

    // Live data (copy): old deep clone + spread vs new
    const live = readJsonIfExists(path.join(LIVE_ROOT, '.cache', 'workspace-desktop.json'));
    if (live && live.windowPositions) {
        const liveIn = { ...live.windowPositions };
        const oldMs = ms(() => {
            const cfg = JSON.parse(JSON.stringify(live));
            cfg.windowPositions = { ...(cfg.windowPositions || {}), ...liveIn };
        }, 10) / 10;
        let out;
        const newMs = ms(() => {
            const cfg = { ...live };
            cfg.windowPositions = mergeWindowPositionsWithImageViewerCap(live.windowPositions, liveIn, new Map());
            out = cfg;
        }, 10) / 10;
        const before = Object.keys(live.windowPositions).length;
        const after = Object.keys(out.windowPositions).length;
        const nonViewer = Object.keys(live.windowPositions).filter((k) => !k.startsWith('imageViewer:'));
        nonViewer.forEach((k) => assert.deepStrictEqual(out.windowPositions[k], live.windowPositions[k]));
        console.log(`  live window positions update: old ${oldMs.toFixed(2)} ms, new ${newMs.toFixed(2)} ms; keys ${before} -> ${after}; broadcast ${JSON.stringify(live.windowPositions).length} -> ${JSON.stringify(out.windowPositions).length} bytes`);
    }

    // queueWorkspaceDesktopWindowPositions keeps the rest of the config shared, not cloned
    const desktopFile = path.join(workDir, 'workspace-desktop-q.json');
    const base = { default: { shortcuts: [{ id: 's1' }] }, windowPositions: { galleryWindow: pos(0.1) } };
    fs.writeFileSync(desktopFile, JSON.stringify(base));
    const cm = new ConfigManager(fakeGlobalResources(), { workspaceDesktop: { name: 'workspaceDesktop', path: desktopFile } });
    cm.initializeCheckpointManagers();
    const cached = cm._getReactiveConfig('workspaceDesktop');
    cm.queueWorkspaceDesktopWindowPositions({ notebookModal: pos(0.2) });
    const after = cm._getReactiveConfig('workspaceDesktop');
    assert.notStrictEqual(after, cached);
    assert.strictEqual(after.default, cached.default, 'top level shallow copy');
    assert.deepStrictEqual(after.windowPositions, { galleryWindow: pos(0.1), notebookModal: pos(0.2) });
    assert.deepStrictEqual(cached.windowPositions, { galleryWindow: pos(0.1) }, 'old map not mutated');
    assert.strictEqual(cm._configs.workspaceDesktop.pendingSaveData, after);
    cm._resetPendingSaveState(cm._configs.workspaceDesktop);
    console.log('ok 4 window positions merge + cap');
})();

// ---------------------------------------------------------------------------
// 2. Studio settings catalog: same output without cloning prompt.config, no aliasing
// ---------------------------------------------------------------------------
(function testCatalog() {
    let promptConfig = readJsonIfExists(path.join(LIVE_ROOT, 'prompt.config.json'));
    if (!promptConfig) {
        promptConfig = {
            quality_presets: { v4_5: [{ id: 1, name: 'Q', value: 'best', match: ['a'] }] },
            uc_presets: { v4_5: ['bad'] },
            nsfw_presets: { 1: { add: { base: 'x' }, remove: ['y'] }, 2: { add: {}, remove: { base: ['z'] } } },
            datasets: [{ value: '__quality__', sub_toggles: [{ id: 'no_text', name: 'No text', value: 'no text', models: ['v4_5'] }] }]
        };
    }
    const snapshot = JSON.stringify(promptConfig);
    let clones = 0;
    const gr = {
        getPromptConfig: (opts = {}) => {
            if (opts.clone) clones++;
            return opts.clone ? JSON.parse(JSON.stringify(promptConfig)) : promptConfig;
        }
    };
    // Old behaviour: build from a deep clone
    const grOld = { getPromptConfig: () => JSON.parse(JSON.stringify(promptConfig)) };
    const expected = buildStudioSettingsCatalog(grOld, 'v4_5');
    const actual = buildStudioSettingsCatalog(gr, 'v4_5');
    assert.strictEqual(clones, 0, 'no prompt.config clone');
    assert.deepStrictEqual(actual, expected);

    // No object in the catalog is shared with prompt.config
    const configObjects = new Set();
    (function collect(v) {
        if (!v || typeof v !== 'object' || configObjects.has(v)) return;
        configObjects.add(v);
        Object.values(v).forEach(collect);
    })(promptConfig);
    (function check(v, where) {
        if (!v || typeof v !== 'object') return;
        assert.ok(!configObjects.has(v), `catalog aliases prompt.config at ${where}`);
        Object.entries(v).forEach(([k, child]) => check(child, `${where}.${k}`));
    })(actual, 'catalog');
    JSON.parse(JSON.stringify(actual));
    assert.strictEqual(JSON.stringify(promptConfig), snapshot, 'prompt.config not mutated');

    const oldMs = ms(() => buildStudioSettingsCatalog(grOld), 10) / 10;
    const newMs = ms(() => buildStudioSettingsCatalog(gr), 10) / 10;
    console.log(`  catalog build (${(snapshot.length / 1e6).toFixed(2)} MB prompt.config): old ${oldMs.toFixed(2)} ms, new ${newMs.toFixed(2)} ms`);
    console.log('ok 2 studio settings catalog');
})();

// ---------------------------------------------------------------------------
// 3. saveWithCheckpoint: gate before validation, no verify re-read, same checkpoints
// ---------------------------------------------------------------------------
function loadOldCheckpointModule() {
    try {
        const src = execFileSync('git', ['-C', ROOT, 'show', 'f2ac8aa:modules/jsonCheckpoint.js'], { encoding: 'utf8' });
        const oldDir = path.join(workDir, 'old');
        fs.mkdirSync(oldDir, { recursive: true });
        const oldFile = path.join(oldDir, 'jsonCheckpoint.js');
        fs.writeFileSync(oldFile, src.replace("require('./checkpointGrandfathering')", `require(${JSON.stringify(path.join(ROOT, 'modules', 'checkpointGrandfathering'))})`));
        return require(oldFile).JSONCheckpointManager;
    } catch (_err) {
        return null;
    }
}

(function testCheckpointSave() {
    const data = readJsonIfExists(path.join(LIVE_ROOT, 'prompt.config.json')) || {
        presets: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`p${i}`, { prompt: 'x'.repeat(500), i }]))
    };
    let validations = 0;
    const validator = (d) => {
        validations++;
        return d && typeof d === 'object' ? true : { valid: false, error: 'bad' };
    };

    function run(Manager, label) {
        const dir = path.join(workDir, label);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'prompt.config.json');
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        const gr = { getPath: () => dir, getConfig: () => ({ enabled: false }) };
        const mgr = new Manager(gr, 'promptConfig', file, 4, validator, { minCheckpointAgeMs: 5 * 60 * 1000 });
        validations = 0;
        const times = [];
        const readsBefore = [];
        const realRead = fs.readFileSync;
        let reads = 0;
        fs.readFileSync = function countingRead(p, ...rest) {
            if (p === file) reads++;
            return realRead.call(fs, p, ...rest);
        };
        try {
            for (let i = 0; i < 6; i++) {
                const next = { ...data, __perfTick: i };
                reads = 0;
                times.push(ms(() => mgr.saveWithCheckpoint(next, { createCheckpoint: true, validateData: true })));
                readsBefore.push(reads);
            }
        } finally {
            fs.readFileSync = realRead;
        }
        const written = JSON.parse(fs.readFileSync(file, 'utf8'));
        const cps = mgr.getCheckpointFiles().filter((f) => !f.filename.startsWith('branch_'));
        return { times, reads: readsBefore, written, checkpoints: cps.length, validations };
    }

    const now = run(JSONCheckpointManager, 'new');
    assert.strictEqual(now.written.__perfTick, 5);
    assert.strictEqual(now.checkpoints, 1, 'first save checkpoints, later ones are inside the min age');
    assert.ok(now.reads.slice(1).every((n) => n === 0), `no re-reads of the file on later saves (${now.reads})`);
    // 6 in-memory validations + 1 of the pre-existing file before the first checkpoint
    assert.strictEqual(now.validations, 7, 'no re-validation of files this manager wrote');

    // Unchanged content: no write, no checkpoint
    const dir = path.join(workDir, 'same');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'x.json');
    const gr = { getPath: () => dir, getConfig: () => ({ enabled: false }) };
    const mgr = new JSONCheckpointManager(gr, 'x', file, 4, validator, { minCheckpointAgeMs: 0 });
    mgr.saveWithCheckpoint({ a: 1 });
    const mtime = fs.statSync(file).mtimeMs;
    assert.strictEqual(mgr.saveWithCheckpoint({ a: 1 }), true);
    assert.strictEqual(fs.statSync(file).mtimeMs, mtime);
    // minCheckpointAgeMs 0: each changed save checkpoints the previous content
    mgr.saveWithCheckpoint({ a: 2 });
    mgr.saveWithCheckpoint({ a: 3 });
    const cps = mgr.getCheckpointFiles().map((f) => JSON.parse(fs.readFileSync(f.filePath, 'utf8')).a).sort();
    assert.deepStrictEqual(cps, [1, 2]);
    // External edit to an invalid file is still validated before checkpointing
    fs.writeFileSync(file, '{ not json');
    const skipped = mgr.createCheckpoint({ skipIfInvalid: true, force: false });
    mgr.markDirty();
    assert.strictEqual(mgr.createCheckpoint({ skipIfInvalid: true }), false, 'invalid external file not checkpointed');
    assert.strictEqual(skipped, false);

    const Old = loadOldCheckpointModule();
    if (Old) {
        const old = run(Old, 'old');
        assert.deepStrictEqual(old.written, now.written);
        assert.strictEqual(old.checkpoints, now.checkpoints);
        const avg = (a) => a.slice(1).reduce((s, v) => s + v, 0) / (a.length - 1);
        console.log(`  saveWithCheckpoint (${(JSON.stringify(data).length / 1e6).toFixed(2)} MB, inside min age): old ${avg(old.times).toFixed(1)} ms (file reads ${old.reads.slice(1)}), new ${avg(now.times).toFixed(1)} ms (file reads ${now.reads.slice(1)})`);
    }
    console.log('ok 3 checkpoint save');
})();

console.log('test-perf-e-config: all passed');
