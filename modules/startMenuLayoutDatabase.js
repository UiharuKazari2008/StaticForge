/**
 * Start menu organizer layout database.
 * One row per owner holding the saved Start menu tree (ordered items +
 * flat folders), so Yukimi's custom arrangement survives restarts. Mirrors
 * modules/dovecoteDatabase.js's single-purpose sqlite module shape.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let dbPath = null;
let db = null;

function initializeStartMenuLayoutDatabase(databasesPath) {
    try {
        if (db !== null) return true;
        dbPath = path.join(databasesPath, 'start_menu_layout.db');
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        createTables();
        return true;
    } catch (error) {
        console.error('Error initializing start menu layout database:', error.message);
        return false;
    }
}

function createTables() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS start_menu_layout (
            owner TEXT PRIMARY KEY,
            layout TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `);
}

function getDb() {
    if (!db) throw new Error('Start menu layout database not initialized');
    return db;
}

function resetForTests(databasesPath) {
    db = null;
    dbPath = null;
    return initializeStartMenuLayoutDatabase(databasesPath);
}

module.exports = {
    initializeStartMenuLayoutDatabase,
    getDb,
    resetForTests
};
