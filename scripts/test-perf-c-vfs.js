// Perf slice c-vfs (#620): old vs new equivalence + timings.
// Old modules are loaded from git (PERF_BASE, default f2ac8aa) next to the new ones.
// Real-data parts run when the copies exist (never the live DBs):
//   PERF_METADATA_DB  copy of metadata.db   (default ~/.cache/perfscan/c-vfs/metadata.db)
//   PERF_IMAGES_DIR   images folder, read only (default /home/kanmi/staticforge/images)
//   PERF_CACHE_DIR    .cache folder, read only (default /home/kanmi/staticforge/.cache)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.PERF_BASE || 'f2ac8aa';
const SCRATCH = process.env.PERF_SCRATCH || path.join(os.homedir(), '.cache', 'perfscan', 'c-vfs', 'scratch');
const METADATA_DB = process.env.PERF_METADATA_DB || path.join(os.homedir(), '.cache', 'perfscan', 'c-vfs', 'metadata.db');
const IMAGES_DIR = process.env.PERF_IMAGES_DIR || '/home/kanmi/staticforge/images';
const CACHE_DIR = process.env.PERF_CACHE_DIR || '/home/kanmi/staticforge/.cache';

function loadOld(rel) {
    const abs = path.join(ROOT, rel);
    const src = execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${rel}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const m = new Module(abs + '.old', module);
    m.filename = abs;
    m.paths = Module._nodeModulePaths(path.dirname(abs));
    m._compile(src, abs);
    return m.exports;
}

const vfsDatabase = require('../modules/vfsDatabase');
const { VfsManager } = require('../modules/vfsManager');
const { VfsSystemProvider } = require('../modules/vfsSystemProvider');
const { DirSizeCache, statNamesInDir, md5HexAsync, writeFileIfMissing } = require('../modules/vfsPerfHelpers');
const OldVfsManager = loadOld('modules/vfsManager.js').VfsManager;
const OldVfsSystemProvider = loadOld('modules/vfsSystemProvider.js').VfsSystemProvider;

// Event-loop lag sampler: the longest gap between 5 ms ticks while fn runs.
async function measure(fn) {
    let maxLag = 0;
    let last = process.hrtime.bigint();
    const timer = setInterval(() => {
        const now = process.hrtime.bigint();
        maxLag = Math.max(maxLag, Number(now - last) / 1e6 - 5);
        last = now;
    }, 5);
    const t0 = process.hrtime.bigint();
    const result = await fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    clearInterval(timer);
    const now = process.hrtime.bigint();
    maxLag = Math.max(maxLag, Number(now - last) / 1e6 - 5);
    return { result, ms: Math.round(ms), maxLagMs: Math.round(maxLag) };
}

function openRo(file) {
    const sqlite3 = require('sqlite3');
    const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY);
    const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows))));
    return { db, all, close: () => new Promise((r) => db.close(() => r())) };
}

async function testPicturesListing(scratchDb) {
    if (!fs.existsSync(METADATA_DB) || !fs.existsSync(IMAGES_DIR)) {
        console.log('  pictures: skipped (no metadata.db copy or images dir)');
        return;
    }
    const ro = openRo(METADATA_DB);
    const [top] = await ro.all(`SELECT workspace_id, COUNT(*) AS n FROM gallery_workspace_ownership
        WHERE bucket = 'files' GROUP BY workspace_id ORDER BY n DESC LIMIT 1`);
    const [topScraps] = await ro.all(`SELECT workspace_id, COUNT(*) AS n FROM gallery_workspace_ownership
        WHERE bucket = 'scraps' GROUP BY workspace_id ORDER BY n DESC LIMIT 1`);
    const lists = new Map();
    const listFor = async (workspaceId, bucket) => {
        const key = `${workspaceId}:${bucket}`;
        if (!lists.has(key)) {
            const rows = await ro.all(`SELECT filename FROM gallery_workspace_ownership WHERE workspace_id = ? AND bucket = ? ORDER BY filename`, [workspaceId, bucket]);
            lists.set(key, rows.map((r) => r.filename));
        }
        return lists.get(key);
    };
    const workspaces = { [top.workspace_id]: { name: 'Top', files: [], scraps: [] } };
    if (topScraps) workspaces[topScraps.workspace_id] = workspaces[topScraps.workspace_id] || { name: 'Scraps', files: [], scraps: [] };
    const gr = {
        getWorkspaceManager: () => ({
            getWorkspaces: () => workspaces,
            _readWorkspaceGalleryFilenames: (id, bucket) => listFor(id, bucket === 'pinned' ? 'pinned' : bucket),
            getDesktopShortcuts: () => ({ shortcuts: [] })
        }),
        getMetadataDatabase: () => ({
            listGalleryWorkspacePinFilenames: async () => [],
            searchFilesWithBlocks: async () => []
        }),
        getPath: (key) => (key === 'images' ? IMAGES_DIR : path.join(scratchDb, key)),
        getSystemInfoCache: () => null,
        getReferenceMetadataDatabase: () => ({ getFileCacheForReferences: () => ({}) }),
        getNotesDatabase: () => ({ getNotesByWorkspace: async () => [] })
    };
    const oldVfs = new OldVfsManager(gr);
    const newVfs = new VfsManager(gr);

    const cases = [
        [`/Workspaces/${top.workspace_id}/Pictures`, { offset: 0, limit: 300 }],
        [`/Workspaces/${top.workspace_id}/Pictures`, { offset: 600, limit: 300, sortField: 'date', sortDirection: 'desc' }],
        [`/Workspaces/${top.workspace_id}/Pictures`, { offset: 0, limit: 100, sortField: 'size', sortDirection: 'desc' }]
    ];
    if (topScraps) cases.push([`/Workspaces/${topScraps.workspace_id}/Scraps`, { offset: 0, limit: 300, sortField: 'date' }]);
    for (const [p, opts] of cases) {
        const a = await measure(() => oldVfs.listDirectory(p, opts));
        const b = await measure(() => newVfs.listDirectory(p, opts));
        assert.deepStrictEqual(b.result, a.result, `listing differs for ${p} ${JSON.stringify(opts)}`);
        console.log(`  list ${p.split('/').pop()} n=${a.result.totalCount} ${JSON.stringify(opts)}: old ${a.ms} ms (max loop block ${a.maxLagMs} ms) -> new ${b.ms} ms (max block ${b.maxLagMs} ms)`);
    }

    // FUSE name lookup: old findChild listed with search=name, new builds the one item.
    const files = await listFor(top.workspace_id, 'files');
    const pictures = `/Workspaces/${top.workspace_id}/Pictures`;
    const findOld = async (dirPath, name) => {
        const result = await oldVfs.listDirectory(dirPath, { offset: 0, limit: 100000, search: name.length >= 2 ? name : '' });
        const items = result.items || [];
        return items.find((i) => i.name === name)
            || items.find((i) => (i.name || '').toLowerCase() === name.toLowerCase())
            || null;
    };
    const picks = [files[0], files[Math.floor(files.length / 2)], files[files.length - 1], files[7].toUpperCase(), 'does-not-exist.png'];
    let oldMs = 0;
    let newMs = 0;
    for (const name of picks) {
        const a = await measure(() => findOld(pictures, name));
        const b = await measure(() => newVfs.findGalleryChildByName(pictures, name));
        assert.deepStrictEqual(b.result, a.result, `lookup differs for ${name}`);
        oldMs += a.ms;
        newMs += b.ms;
    }
    console.log(`  FUSE Pictures name lookup x${picks.length}: old ${oldMs} ms -> new ${newMs} ms`);
    assert.strictEqual(await newVfs.findGalleryChildByName(`/Workspaces/${top.workspace_id}`, 'Pictures'), undefined);
    await ro.close();
}

function writeTree(root, spec) {
    fs.mkdirSync(root, { recursive: true });
    for (const [name, value] of Object.entries(spec)) {
        const p = path.join(root, name);
        if (typeof value === 'number') fs.writeFileSync(p, Buffer.alloc(value, 1));
        else writeTree(p, value);
    }
}

async function testDirSizes(scratch) {
    const cacheRoot = path.join(scratch, 'cache');
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    writeTree(cacheRoot, {
        'a.json': 10,
        '.hidden': 99,
        'x.db-wal': 77,
        sessions: { 's.json': 1000 },
        big: { 'b1.bin': 300, deep: { 'd.bin': 40, '.dot': 5, more: { 'm.bin': 7 } } },
        empty: {}
    });
    fs.symlinkSync(path.join(cacheRoot, 'big'), path.join(cacheRoot, 'link-to-big'));
    const gr = { getPath: (key) => (key === 'cache' ? cacheRoot : path.join(scratch, key)) };
    const oldP = new OldVfsSystemProvider(gr);
    const newP = new VfsSystemProvider(gr);

    const oldList = await oldP.listDirectory(['Cache']);
    const coldList = await newP.listDirectory(['Cache']);
    assert.strictEqual(coldList.find((i) => i.name === 'big').size, 0, 'cold walk serves 0 until ready');
    await newP._dirSizes.getAsync(path.join(cacheRoot, 'big'), null, newP._cacheSizeSpec);
    await newP._dirSizes.getAsync(path.join(cacheRoot, 'empty'), null, newP._cacheSizeSpec);
    const warmList = await newP.listDirectory(['Cache']);
    assert.deepStrictEqual(warmList, oldList, 'warm Cache listing equals the old sync listing');
    assert.deepStrictEqual(newP.getPathStats(['Cache']), oldP.getPathStats(['Cache']));
    // Subfolders reached by the parent walk are cached too.
    assert.deepStrictEqual(await newP.listDirectory(['Cache', 'big']), await oldP.listDirectory(['Cache', 'big']));

    // In-flight walks are shared.
    const c = new DirSizeCache({ ttlMs: 60000 });
    const spec = { key: (p) => p, include: () => true };
    const [x, y] = await Promise.all([c.getAsync(cacheRoot, null, spec), c.getAsync(cacheRoot, null, spec)]);
    assert.strictEqual(x, y);

    // assertListable throws exactly what listDirectory throws.
    const probes = [
        [], ['Cache'], ['Cache', 'big'], ['Cache', 'nope'], ['Cache', 'a.json'], ['Cache', 'sessions'], ['Cache', '..'],
        ['Config'], ['Config', 'x'], ['Logs'], ['Logs', 'x'], ['Databases'], ['Databases', 'x'],
        ['Applications'], ['Applications', 'x'], ['Bogus'], ['Director', 'no-such-dir-zz']
    ];
    for (const segs of probes) {
        let oldErr = null;
        let newErr = null;
        try { await oldP.listDirectory(segs); } catch (e) { oldErr = e.message; }
        try { await newP.assertListable(segs); } catch (e) { newErr = e.message; }
        assert.strictEqual(newErr, oldErr, `assertListable(${segs.join('/')})`);
    }

    if (fs.existsSync(CACHE_DIR)) {
        const realGr = { getPath: (key) => (key === 'cache' ? CACHE_DIR : path.join(scratch, key)) };
        const a = await measure(() => new OldVfsSystemProvider(realGr).getPathStats(['Cache']));
        const fresh = new VfsSystemProvider(realGr);
        const b = await measure(() => fresh.getPathStats(['Cache']));
        const w = await measure(async () => {
            const abs = CACHE_DIR;
            for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
                if (ent.isDirectory() && fresh._isCacheEntryVisible(ent.name, true)) {
                    await fresh._dirSizes.getAsync(path.join(abs, ent.name), null, fresh._cacheSizeSpec);
                }
            }
        });
        const warm = fresh.getPathStats(['Cache']);
        const diff = Math.abs(warm.totalSizeBytes - a.result.totalSizeBytes);
        console.log(`  .cache stats: old sync ${a.ms} ms (max loop block ${a.maxLagMs} ms) -> new ${b.ms} ms request, background walk ${w.ms} ms (max block ${w.maxLagMs} ms); bytes old ${a.result.totalSizeBytes} new ${warm.totalSizeBytes} (live drift ${diff})`);
        assert.strictEqual(warm.itemCount, a.result.itemCount);
        assert.ok(diff / Math.max(1, a.result.totalSizeBytes) < 0.01, 'background walk total within live drift');
    }
}

async function insertRow(raw, table, row) {
    const cols = await raw.all(`PRAGMA table_info(${table})`);
    const c = cols.filter((x) => row[x.name] !== undefined || (x.notnull && x.dflt_value == null && !x.pk));
    const vals = c.map((x) => (row[x.name] !== undefined ? row[x.name] : (x.type.toUpperCase().includes('INT') ? 0 : '')));
    await raw.run(`INSERT INTO ${table} (${c.map((x) => x.name).join(',')}) VALUES (${c.map(() => '?').join(',')})`, vals);
}

async function testVfsDbBatching(scratch) {
    const dir = path.join(scratch, 'vfsdb');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    assert.strictEqual(await vfsDatabase.initializeVfsDatabase(dir), true);
    const { open } = require('sqlite');
    const sqlite3 = require('sqlite3');
    const raw = await open({ filename: path.join(dir, 'vfs.db'), driver: sqlite3.Database });

    // Tree: workspace w1 folders f0..f29 (random parents), root-scope r0..r9.
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const folders = [];
    for (let i = 0; i < 30; i++) {
        const parent = i && rnd(3) ? `f${rnd(i)}` : null;
        folders.push({ id: `f${i}`, scope: 'workspace', workspace_id: 'w1', parent_id: parent, name: `F${i}` });
    }
    for (let i = 0; i < 10; i++) {
        folders.push({ id: `r${i}`, scope: 'root', workspace_id: null, parent_id: i && rnd(2) ? `r${rnd(i)}` : null, name: `R${i}` });
    }
    for (const f of folders) await insertRow(raw, 'vfs_folders', f);
    let fileN = 0;
    for (const f of folders) {
        const k = rnd(6);
        if (k === 0) await insertRow(raw, 'user_files', { id: `u${fileN++}`, scope: f.scope, workspace_id: f.workspace_id, folder_id: f.id, original_name: 'a.txt', content_hash: 'h', mime_type: 'text/plain', size: 1 });
        if (k === 1) await insertRow(raw, 'user_files', { id: `u${fileN++}`, scope: f.scope, workspace_id: f.workspace_id, folder_id: f.id, original_name: 't.txt', content_hash: 'h', mime_type: 'text/plain', size: 1, trashed_at: 5 });
        if (k === 2) await insertRow(raw, 'user_files', { id: `u${fileN++}`, scope: 'workspace', workspace_id: 'other', folder_id: f.id, original_name: 'o.txt', content_hash: 'h', mime_type: 'text/plain', size: 1 });
        if (k === 3) await insertRow(raw, 'vfs_entries', { id: `e${fileN++}`, folder_id: f.id, target_kind: 'user-file', target_id: 'u0', display_name: 'link' });
        if (k === 4) await insertRow(raw, 'vfs_entries', { id: `e${fileN++}`, folder_id: f.id, target_kind: 'image', target_id: 'x.png' });
    }
    await insertRow(raw, 'vfs_entries', { id: 'e-missing', folder_id: 'f0', target_kind: 'user-file', target_id: 'u-missing', display_name: 'gone' });
    await raw.close();

    const gr = {
        getWorkspaceManager: () => ({ getWorkspaces: () => ({ w1: { name: 'W1' } }), getDesktopShortcuts: () => ({ shortcuts: [] }) }),
        getPath: (key) => path.join(scratch, key),
        getSystemInfoCache: () => null,
        getReferenceMetadataDatabase: () => ({ getFileCacheForReferences: () => ({}) }),
        getNotesDatabase: () => ({ getNotesByWorkspace: async () => [] })
    };
    const oldVfs = new OldVfsManager(gr);
    const newVfs = new VfsManager(gr);
    const ids = folders.map((f) => f.id).concat(['nope']);
    let checked = 0;
    for (const id of ids) {
        assert.strictEqual(await newVfs.folderTreeHasUserFiles([id]), await oldVfs.folderTreeHasUserFiles([id]), `tree ${id}`);
        checked++;
    }
    for (let i = 0; i < 20; i++) {
        const pick = [ids[rnd(ids.length)], ids[rnd(ids.length)], ids[rnd(ids.length)]];
        assert.strictEqual(await newVfs.folderTreeHasUserFiles(pick), await oldVfs.folderTreeHasUserFiles(pick), `trees ${pick}`);
    }
    for (const f of folders) {
        const p = f.scope === 'root' ? `/${f.id}` : `/Workspaces/w1/${f.id}`;
        const a = await oldVfs.listDirectory(p).catch((e) => ({ error: e.message }));
        const b = await newVfs.listDirectory(p).catch((e) => ({ error: e.message }));
        assert.deepStrictEqual(b, a, `user folder listing ${p}`);
    }
    console.log(`  folderTreeHasUserFiles: ${checked + 20} trees equal; user-folder listings with entries equal`);
}

async function testUploadHelpers(scratch) {
    const crypto = require('crypto');
    const buf = crypto.randomBytes(9 * 1024 * 1024 + 17);
    assert.strictEqual(await md5HexAsync(buf), crypto.createHash('md5').update(buf).digest('hex'));
    assert.strictEqual(await md5HexAsync(Buffer.from('abc')), crypto.createHash('md5').update('abc').digest('hex'));
    const p = path.join(scratch, 'blob-test');
    fs.rmSync(p, { force: true });
    assert.strictEqual(await writeFileIfMissing(p, Buffer.from('one')), true);
    assert.strictEqual(await writeFileIfMissing(p, Buffer.from('two')), false);
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'one');
    const m = await statNamesInDir(scratch, ['blob-test', 'missing-file']);
    assert.deepStrictEqual(m.get('missing-file'), { size: 0, mtime: null });
    assert.strictEqual(m.get('blob-test').size, 3);
    console.log('  md5HexAsync / writeFileIfMissing / statNamesInDir: OK');
}

async function main() {
    fs.mkdirSync(SCRATCH, { recursive: true });
    console.log('vfs db batching (finding 9):');
    await testVfsDbBatching(SCRATCH);
    console.log('vfs listings (findings 1, 5):');
    await testPicturesListing(SCRATCH);
    console.log('system folder sizes (finding 2):');
    await testDirSizes(SCRATCH);
    console.log('upload helpers (finding 6):');
    await testUploadHelpers(SCRATCH);
    console.log('test-perf-c-vfs: OK');
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
