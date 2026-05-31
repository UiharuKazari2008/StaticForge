#!/usr/bin/env node

/**
 * Metadata Migration Script
 * 
 * This script migrates the existing JSON-based metadata system to SQLite.
 * It will:
 * 1. Initialize the SQLite database
 * 2. Migrate existing metadata from JSON files
 * 3. Verify the migration was successful
 * 4. Provide statistics
 */

const path = require('path');
const fs = require('fs');

// Import the new SQLite metadata system
const { 
    initializeDatabase, 
    migrateFromJSON, 
    getDatabaseStats,
    closeDatabase 
} = require('./modules/metadataDatabase');

// Import the old JSON system for comparison
const { loadMetadataCache, getAllMetadata } = require('./modules/metadataCache');

async function runMigration() {
    console.log('🚀 Starting metadata migration from JSON to SQLite...\n');
    
    try {
        // Step 1: Initialize SQLite database
        console.log('📊 Step 1: Initializing SQLite database...');
        if (!initializeDatabase()) {
            throw new Error('Failed to initialize SQLite database');
        }
        console.log('✅ SQLite database initialized successfully\n');
        
        // Step 2: Load old JSON metadata for comparison
        console.log('📄 Step 2: Loading existing JSON metadata...');
        loadMetadataCache();
        const oldMetadata = getAllMetadata();
        const oldImageCount = Object.keys(oldMetadata).length;
        console.log(`✅ Loaded ${oldImageCount} images from JSON metadata\n`);
        
        // Step 3: Migrate data to SQLite
        console.log('🔄 Step 3: Migrating data to SQLite...');
        const jsonFilePath = path.join(__dirname, '.cache', 'metadata.json');
        const migrationSuccess = await migrateFromJSON(jsonFilePath);
        
        if (!migrationSuccess) {
            throw new Error('Migration failed');
        }
        console.log('✅ Data migration completed successfully\n');
        
        // Step 4: Verify migration
        console.log('🔍 Step 4: Verifying migration...');
        const newStats = getDatabaseStats();
        
        if (!newStats) {
            throw new Error('Failed to get database statistics');
        }
        
        console.log('📊 Migration Results:');
        console.log(`   Images migrated: ${newStats.images}`);
        console.log(`   Receipts migrated: ${newStats.receipts}`);
        console.log(`   Unattributed receipts: ${newStats.unattributed_receipts}`);
        console.log(`   Database size: ${(newStats.database_size / 1024).toFixed(2)} KB`);
        
        // Verify image count matches
        if (newStats.images === oldImageCount) {
            console.log('✅ Image count verification: PASSED');
        } else {
            console.warn(`⚠️ Image count verification: FAILED (Expected: ${oldImageCount}, Got: ${newStats.images})`);
        }
        
        console.log('\n🎉 Migration completed successfully!');
        console.log('\n📝 Next steps:');
        console.log('1. Update your imports to use the new SQLite system');
        console.log('2. Test the system to ensure everything works correctly');
        console.log('3. Remove the old metadataCache.js import once verified');
        console.log('4. The old JSON file has been backed up with .backup extension');
        
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error('\n🔧 Troubleshooting:');
        console.error('1. Check that better-sqlite3 is installed: npm install better-sqlite3');
        console.error('2. Ensure you have write permissions to the .cache directory');
        console.error('3. Check the console for detailed error messages');
        process.exit(1);
    } finally {
        // Clean up
        closeDatabase();
    }
}

// Run migration if this script is executed directly
if (require.main === module) {
    runMigration();
}

module.exports = { runMigration };
