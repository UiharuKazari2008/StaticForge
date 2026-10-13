const assert = require('assert');
const fs = require('fs');
const path = require('path');
const notesDatabase = require('../modules/notesDatabase');

async function runTest() {
    const tempDbPath = path.join(__dirname, '..', '.test-notes-db2');
    if (!fs.existsSync(tempDbPath)) {
        fs.mkdirSync(tempDbPath, { recursive: true });
    }

    // Clean up if it already exists
    if (fs.existsSync(path.join(tempDbPath, 'notes.db'))) {
        fs.unlinkSync(path.join(tempDbPath, 'notes.db'));
    }

    try {
        await notesDatabase.initializeNotesDatabase(tempDbPath);

        // Wait a small amount for the db.initialize to truly finish if there is any async weirdness
        await new Promise(r => setTimeout(r, 200));

        // Seed some data
        const w1 = 'workspace1';
        const w2 = 'workspace2';
        const w3 = 'workspace3';

        await notesDatabase.createNote({ id: 'n1', name: 'Title 1', content: 'Content 1', workspaceId: w1, notebookName: 'nb1', customPositionIndex: 0 });
        await notesDatabase.createNote({ id: 'n2', name: 'Title 2', content: 'Content 2', workspaceId: w1, notebookName: 'nb1', customPositionIndex: 1 });
        await notesDatabase.createNote({ id: 'n3', name: 'Title 3', content: 'Content 3', workspaceId: w2, notebookName: 'nb1', customPositionIndex: 0 });
        // w3 has no notes

        const workspaceIds = [w1, w2, w3];

        // 1. Old way (simulated N+1 loop)
        let oldWayCounts = {};
        for (const id of workspaceIds) {
            const notes = await notesDatabase.getNotesByWorkspace(id);
            oldWayCounts[id] = notes ? notes.length : 0;
        }

        // 2. New way (batched query)
        let newWayCounts = await notesDatabase.getWorkspaceNoteCounts(workspaceIds);

        console.log('Old way counts:', oldWayCounts);
        console.log('New way counts:', newWayCounts);

        assert.deepStrictEqual(oldWayCounts, newWayCounts, 'Counts should match between old N+1 and new batched query');
        console.log('Test passed!');

        // Explicitly exit so the node process doesn't hang on sqlite wrapper timeouts
        process.exit(0);

    } catch (err) {
        console.error('Test failed:', err);
        process.exit(1);
    }
}

runTest();
