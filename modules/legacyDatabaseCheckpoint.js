/**
 * Checkpoint helpers for better-sqlite3 databases (not on SQLiteAsyncWrapper).
 */

const { createDatabaseCheckpointManager } = require('./databaseCheckpoint');

function attachLegacyDatabaseCheckpoint(instance, dbPath, getDbFn, globalResources) {
    const manager = createDatabaseCheckpointManager(dbPath, 5, globalResources);
    instance.checkpointManager = manager;

    instance.getCheckpointManager = function getCheckpointManager() {
        return instance.checkpointManager;
    };

    instance._scheduleLegacyDbCheckpoint = function _scheduleLegacyDbCheckpoint() {
        if (!instance.checkpointManager) return;
        if (instance._legacyCheckpointTimer) {
            clearTimeout(instance._legacyCheckpointTimer);
        }
        instance._legacyCheckpointTimer = setTimeout(() => {
            instance._legacyCheckpointTimer = null;
            try {
                const db = getDbFn();
                if (db) {
                    try {
                        db.pragma('wal_checkpoint(TRUNCATE)');
                    } catch {
                        // ignore checkpoint errors
                    }
                }
                instance.checkpointManager.createCheckpoint();
            } catch (err) {
                console.warn(`⚠️ Legacy DB checkpoint failed (${dbPath}):`, err.message);
            }
        }, 3000);
    };

    return manager;
}

module.exports = {
    attachLegacyDatabaseCheckpoint
};
