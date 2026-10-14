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
            // WAL checkpoint + backup run on the worker lane, not this connection.
            Promise.resolve(instance.checkpointManager.createCheckpointWithBackup(true)).catch((err) => {
                console.warn(`⚠️ Legacy DB checkpoint failed (${dbPath}):`, err.message);
            });
        }, 3000);
    };

    return manager;
}

module.exports = {
    attachLegacyDatabaseCheckpoint
};
