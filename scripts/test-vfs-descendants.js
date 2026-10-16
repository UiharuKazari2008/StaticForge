// Tests vfsDatabase.collectDescendantFolderIds (recursive CTE, GH #326) against the
// real sqlite3/sqlite driver via SQLiteAsyncWrapper. No mocks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const vfs = require('../modules/vfsDatabase');

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-desc-'));
    try {
        assert.strictEqual(await vfs.initializeVfsDatabase(dir), true, 'initializeVfsDatabase failed');
        const { open } = require('sqlite');
        const sqlite3 = require('sqlite3');
        const raw = await open({ filename: path.join(dir, 'vfs.db'), driver: sqlite3.Database });
        const cols = (await raw.all('PRAGMA table_info(vfs_folders)'));
        const ins = async (id, parent) => {
            const row = { id, parent_id: parent, scope: 'user', name: id };
            const c = cols.filter(x => row[x.name] !== undefined || (x.notnull && x.dflt_value == null && !x.pk));
            const vals = c.map(x => row[x.name] !== undefined ? row[x.name] : (x.type.toUpperCase().includes('INT') ? 0 : ''));
            await raw.run(`INSERT INTO vfs_folders (${c.map(x => x.name).join(',')}) VALUES (${c.map(() => '?').join(',')})`, vals);
        };
        await ins('root', null);
        for (let i = 1; i <= 4; i++) {
            await ins(`c${i}`, 'root');
            for (let j = 1; j <= 3; j++) {
                await ins(`g${i}${j}`, `c${i}`);
                await ins(`gg${i}${j}`, `g${i}${j}`);
            }
        }
        await ins('sib', null); await ins('sibkid', 'sib');
        // corrupt cycle: cyA <-> cyB, entered from root
        await ins('cyA', 'root'); await ins('cyB', 'cyA');
        await raw.run("UPDATE vfs_folders SET parent_id = 'cyB' WHERE id = 'cyA'");
        await raw.run("UPDATE vfs_folders SET parent_id = 'root' WHERE id = 'cyA'");
        await raw.close();

        // reference: old BFS (acyclic tree)
        const tree = {};
        const db2 = await open({ filename: path.join(dir, 'vfs.db'), driver: sqlite3.Database });
        for (const r of await db2.all('SELECT id, parent_id FROM vfs_folders')) (tree[r.parent_id] ||= []).push(r.id);
        await db2.close();
        const bfs = (rid) => { const out = [], q = [...(tree[rid] || [])]; while (q.length) { const id = q.shift(); out.push(id); q.push(...(tree[id] || [])); } return out; };
        const depthOf = (rid) => { const m = {}; let lvl = [rid], d = 0; while (lvl.length) { d++; const nx = []; for (const p of lvl) for (const k of tree[p] || []) { m[k] = d; nx.push(k); } lvl = nx; } return m; };

        for (const rid of ['c2', 'g31', 'gg11', 'sib']) {
            const got = await vfs.collectDescendantFolderIds(rid);
            const exp = bfs(rid);
            assert.deepStrictEqual([...got].sort(), [...exp].sort(), `set mismatch for ${rid}`);
            const dm = depthOf(rid);
            for (let i = 1; i < got.length; i++) assert.ok(dm[got[i - 1]] <= dm[got[i]], `not depth-ordered for ${rid}`);
            assert.ok(!got.includes(rid), 'root must be excluded');
        }
        const all = await vfs.collectDescendantFolderIds('root');
        assert.strictEqual(all.length, 4 + 12 + 12 + 2, 'root descendants count');
        assert.strictEqual(new Set(all).size, all.length, 'no duplicates');
        assert.ok(!all.includes('root') && !all.includes('sib') && !all.includes('sibkid'));

        // true cycle through the root itself must terminate, dedupe, exclude root
        const r2 = await open({ filename: path.join(dir, 'vfs.db'), driver: sqlite3.Database });
        await r2.run("UPDATE vfs_folders SET parent_id = 'cyB' WHERE id = 'cyA'"); // cyA<->cyB
        await r2.close();
        const cyc = await vfs.collectDescendantFolderIds('cyA');
        assert.deepStrictEqual(cyc, ['cyB'], `cycle result ${JSON.stringify(cyc)}`);
        console.log('test-vfs-descendants: OK (real sqlite3 driver; CTE matches BFS sets, depth order, cycle-safe)');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
