const fs = require('fs');
const path = require('path');

/**
 * Directory for SQLite checkpoint files: <parentOfDb>/checkpoints/<dbStem>/
 * Shares the same `.cache/checkpoints/` root as JSON config checkpoints (different subfolder per resource).
 *
 * @param {string} dbPath - Absolute path to the live .db file
 * @returns {string}
 */
function getDatabaseCheckpointDir(dbPath) {
    const parent = path.dirname(dbPath);
    const stem = path.basename(dbPath, path.extname(dbPath));
    return path.join(parent, 'checkpoints', stem);
}

/**
 * Move snapshots from legacy dirname(db)/.checkpoints/ into checkpoints/<dbStem>/ when the new folder
 * has no checkpoints yet but the old folder contains this database's files.
 *
 * @param {string} dbPath
 * @param {string} dbName - basename without extension
 * @param {string} dbExt - e.g. '.db'
 */
function migrateLegacyDatabaseCheckpoints(dbPath, dbName, dbExt) {
    const parent = path.dirname(dbPath);
    const newDir = path.join(parent, 'checkpoints', dbName);
    const oldDir = path.join(parent, '.checkpoints');
    const prefix = `${dbName}_checkpoint_`;

    if (!fs.existsSync(oldDir)) {
        return;
    }

    const hasCheckpointsInNewDir = () => {
        if (!fs.existsSync(newDir)) {
            return false;
        }
        return fs.readdirSync(newDir).some(
            (f) => f.startsWith(prefix) && f.endsWith(dbExt)
        );
    };

    if (hasCheckpointsInNewDir()) {
        return;
    }

    let oldFiles;
    try {
        oldFiles = fs.readdirSync(oldDir).filter(
            (f) => f.startsWith(prefix) && f.endsWith(dbExt)
        );
    } catch {
        return;
    }

    if (oldFiles.length === 0) {
        return;
    }

    fs.mkdirSync(newDir, { recursive: true });

    for (const f of oldFiles) {
        const fromBase = path.join(oldDir, f);
        const toBase = path.join(newDir, f);
        try {
            fs.renameSync(fromBase, toBase);
        } catch (err) {
            console.warn(`⚠️ Could not migrate checkpoint ${f}: ${err.message}`);
            continue;
        }
        for (const suffix of ['-wal', '-shm']) {
            const fromSide = fromBase + suffix;
            const toSide = toBase + suffix;
            if (fs.existsSync(fromSide)) {
                try {
                    fs.renameSync(fromSide, toSide);
                } catch (err) {
                    console.warn(`⚠️ Could not migrate ${f}${suffix}: ${err.message}`);
                }
            }
        }
    }

    console.log(
        `✓ Migrated ${oldFiles.length} database checkpoint(s) for ${dbName} from .checkpoints/ to checkpoints/${dbName}/`
    );
}

/**
 * Remove orphan -wal / -shm files in a checkpoint directory whose main file is missing.
 *
 * @param {string} checkpointDir
 */
function removeOrphanCheckpointSidecars(checkpointDir) {
    if (!fs.existsSync(checkpointDir)) {
        return;
    }
    let names;
    try {
        names = fs.readdirSync(checkpointDir);
    } catch {
        return;
    }
    for (const name of names) {
        if (!name.endsWith('-wal') && !name.endsWith('-shm')) {
            continue;
        }
        const baseName = name.slice(0, -4);
        const basePath = path.join(checkpointDir, baseName);
        if (!fs.existsSync(basePath)) {
            try {
                fs.unlinkSync(path.join(checkpointDir, name));
                console.log(`🗑️ Removed orphan checkpoint sidecar: ${name}`);
            } catch (err) {
                console.warn(`⚠️ Could not remove orphan ${name}: ${err.message}`);
            }
        }
    }
}

module.exports = {
    getDatabaseCheckpointDir,
    migrateLegacyDatabaseCheckpoints,
    removeOrphanCheckpointSidecars
};
