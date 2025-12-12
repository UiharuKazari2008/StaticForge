#!/usr/bin/env node

/**
 * Script to delete all knowledge memories with category 'tag_wiki'
 */

const path = require('path');
const Database = require('better-sqlite3');

// Database file path
const dbPath = path.join(__dirname, '..', '.cache', 'knowledge_memory.db');

console.log('🗑️  Deleting all tag_wiki memories...\n');

try {
    // Open database
    const db = new Database(dbPath);
    
    // First, get all memories with tag_wiki category
    const selectStmt = db.prepare(`
        SELECT id, name FROM knowledge_memories WHERE category = 'tag_wiki'
    `);
    const memories = selectStmt.all();
    
    if (memories.length === 0) {
        console.log('✅ No tag_wiki memories found. Nothing to delete.');
        db.close();
        process.exit(0);
    }
    
    console.log(`Found ${memories.length} tag_wiki memor${memories.length === 1 ? 'y' : 'ies'}:`);
    memories.forEach((mem, index) => {
        console.log(`  ${index + 1}. ${mem.name}`);
    });
    console.log('');
    
    // Delete all memories with tag_wiki category
    // CASCADE will automatically delete related entities, relations, and observations
    const deleteStmt = db.prepare(`
        DELETE FROM knowledge_memories WHERE category = 'tag_wiki'
    `);
    
    const result = deleteStmt.run();
    
    console.log(`✅ Successfully deleted ${result.changes} tag_wiki memor${result.changes === 1 ? 'y' : 'ies'}.`);
    console.log('   (Related entities, relations, and observations were also deleted via CASCADE)');
    
    db.close();
    process.exit(0);
} catch (error) {
    console.error('❌ Error deleting tag_wiki memories:', error.message);
    process.exit(1);
}

