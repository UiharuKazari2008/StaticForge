const GenerationQuipsDatabase = require('../modules/generationQuipsDatabase');
const db = new GenerationQuipsDatabase({
    getPath: () => ':memory:',
    getDatabase: () => null
});

const workspaces = ['ws1', 'ws2', 'ws3', 'empty_ws'];

// Create some test data
try {
    // Drop tables if they exist so we can run multiple times cleanly
    db.db.exec(`
        DROP TABLE IF EXISTS dynamic_quips;
        DROP TABLE IF EXISTS extracted_terms;
        CREATE TABLE dynamic_quips (
            id INTEGER PRIMARY KEY,
            workspace_id TEXT,
            match_term TEXT,
            phrases TEXT,
            generated_at INTEGER
        );
        CREATE TABLE extracted_terms (
            id INTEGER PRIMARY KEY,
            workspace_id TEXT,
            term TEXT
        );
    `);

    // WS1
    db.db.prepare('INSERT INTO dynamic_quips (workspace_id, match_term, phrases, generated_at) VALUES (?, ?, ?, ?)').run('ws1', 'term1', '["a", "b"]', 100);
    db.db.prepare('INSERT INTO dynamic_quips (workspace_id, match_term, phrases, generated_at) VALUES (?, ?, ?, ?)').run('ws1', 'term2', '["c"]', 105);
    db.db.prepare('INSERT INTO extracted_terms (workspace_id, term) VALUES (?, ?)').run('ws1', 'term1');
    db.db.prepare('INSERT INTO extracted_terms (workspace_id, term) VALUES (?, ?)').run('ws1', 'term2');

    // WS2
    db.db.prepare('INSERT INTO dynamic_quips (workspace_id, match_term, phrases, generated_at) VALUES (?, ?, ?, ?)').run('ws2', 'term3', '["d", "e", "f"]', 200);

    // WS3 (No extracted terms)
    db.db.prepare('INSERT INTO dynamic_quips (workspace_id, match_term, phrases, generated_at) VALUES (?, ?, ?, ?)').run('ws3', 'term4', '["g", "h"]', 300);

    const singleResults = {};
    for (const ws of workspaces) {
        singleResults[ws] = db.getWorkspaceQuipStats(ws);
    }

    const batchResults = db.getWorkspaceQuipStatsBatch(workspaces);

    // Sort keys and stringify to compare
    const singleStr = JSON.stringify(singleResults, null, 2);
    const batchStr = JSON.stringify(batchResults, null, 2);

    if (singleStr === batchStr) {
        console.log("SUCCESS: Byte-for-byte identical output!");
    } else {
        console.error("FAIL: Outputs differ!");
        console.error("Single:", singleStr);
        console.error("Batch:", batchStr);
        process.exit(1);
    }
} catch (e) {
    console.error(e);
}
