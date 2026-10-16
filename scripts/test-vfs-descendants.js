const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

async function main() {
    const dbPath = path.join(os.tmpdir(), `vfs-test-${Date.now()}.db`);

    // Using raw sqlite wrapper to avoid importing heavy app dependencies
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE vfs_folders (
            id TEXT PRIMARY KEY,
            parent_id TEXT
        )
    `);

    // Insert dummy folders
    const insert = await db.prepare("INSERT INTO vfs_folders (id, parent_id) VALUES (?, ?)");
    const rootId = 'root-1';
    await insert.run([rootId, null]);

    for (let i = 1; i <= 5; i++) {
        await insert.run([`child-${i}`, rootId]);
        for (let j = 1; j <= 5; j++) {
            await insert.run([`grandchild-${i}-${j}`, `child-${i}`]);
        }
    }

    // Sibling branch not under root
    await insert.run(['sibling-1', null]);
    await insert.run(['sibling-child-1', 'sibling-1']);
    await insert.finalize();

    // Original implementation (BFS queue)
    async function getChildFolderIds(parentId) {
        const rows = await db.all('SELECT id FROM vfs_folders WHERE parent_id = ?', [parentId]);
        return rows.map(r => r.id);
    }
    async function oldCollectDescendantFolderIds(rId) {
        const result = [];
        const queue = await getChildFolderIds(rId);
        while (queue.length) {
            const id = queue.shift();
            result.push(id);
            queue.push(...await getChildFolderIds(id));
        }
        return result;
    }

    // New implementation (Recursive CTE)
    async function newCollectDescendantFolderIds(rId) {
        const query = `
            WITH RECURSIVE d(id, depth) AS (
                SELECT id, 1 FROM vfs_folders WHERE parent_id = ?
                UNION
                SELECT f.id, d.depth + 1 FROM vfs_folders f
                INNER JOIN d ON f.parent_id = d.id
                WHERE d.depth < 100
            )
            SELECT id FROM d ORDER BY depth ASC
        `;
        const rows = await db.all(query, [rId]);
        return rows.map(r => r.id);
    }

    const oldResult = await oldCollectDescendantFolderIds(rootId);
    const newResult = await newCollectDescendantFolderIds(rootId);

    assert.strictEqual(oldResult.length, 30, 'Should find 30 descendants');
    assert.strictEqual(newResult.length, 30, 'Should find 30 descendants via CTE');

    // Since original did strict BFS, they should be in similar order (or at least strictly equal when sorted)
    assert.deepStrictEqual(oldResult.sort(), newResult.sort(), 'Outputs must be identical');

    console.log("Successfully tested vfs descendant query: CTE matches original queue implementation exactly.");

    await db.close();
    fs.unlinkSync(dbPath);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
