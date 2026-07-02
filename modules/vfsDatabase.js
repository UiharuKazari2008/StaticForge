const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');
const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');

let dbPath = null;
let db = null;

function getCheckpointManager() {
    return db ? db.getCheckpointManager() : null;
}

async function initializeVfsDatabase(databasesPath) {
    try {
        dbPath = path.join(databasesPath, 'vfs.db');
        const cacheDir = path.dirname(dbPath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        db = new SQLiteAsyncWrapper(dbPath, 'vfs', 30);
        await db.initialize();
        await createVfsTables();
        logger.bootSubStep('VFS database ready');
        return true;
    } catch (error) {
        logger.error('Error initializing VFS database:', error);
        console.error('Full error stack:', error.stack);
        return false;
    }
}

async function createVfsTables() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS vfs_folders (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            workspace_id TEXT,
            parent_id TEXT,
            name TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS vfs_entries (
            id TEXT PRIMARY KEY,
            folder_id TEXT NOT NULL,
            target_kind TEXT NOT NULL,
            target_id TEXT NOT NULL,
            display_name TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS user_files (
            id TEXT PRIMARY KEY,
            content_hash TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            scope TEXT NOT NULL,
            workspace_id TEXT,
            folder_id TEXT,
            preview_path TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_vfs_folders_scope ON vfs_folders (scope, workspace_id, parent_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_vfs_entries_folder ON vfs_entries (folder_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_user_files_scope ON user_files (scope, workspace_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_user_files_folder ON user_files (folder_id)`);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS vfs_trash_items (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            item_kind TEXT NOT NULL,
            target_id TEXT NOT NULL,
            display_name TEXT,
            original_path TEXT,
            payload_json TEXT,
            deleted_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_vfs_trash_workspace ON vfs_trash_items (workspace_id, deleted_at)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_vfs_trash_target ON vfs_trash_items (workspace_id, item_kind, target_id)`);
    const entryCols = await db.all(`PRAGMA table_info(vfs_entries)`);
    if (!entryCols.some(c => c.name === 'entry_meta')) {
        await db.exec(`ALTER TABLE vfs_entries ADD COLUMN entry_meta TEXT`);
    }
    const folderCols = await db.all(`PRAGMA table_info(vfs_folders)`);
    if (!folderCols.some(c => c.name === 'trashed_at')) {
        await db.exec(`ALTER TABLE vfs_folders ADD COLUMN trashed_at INTEGER`);
    }
    const fileCols = await db.all(`PRAGMA table_info(user_files)`);
    if (!fileCols.some(c => c.name === 'trashed_at')) {
        await db.exec(`ALTER TABLE user_files ADD COLUMN trashed_at INTEGER`);
    }
}

async function closeVfsDatabase() {
    if (db) {
        await db.close();
        db = null;
    }
}

function generateId() {
    return crypto.randomUUID();
}

async function createFolder({ scope, workspaceId = null, parentId = null, name }) {
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);
    await db.run(
        `INSERT INTO vfs_folders (id, scope, workspace_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, scope, workspaceId, parentId, name, now, now]
    );
    return getFolderById(id);
}

async function getFolderById(id) {
    return db.get('SELECT * FROM vfs_folders WHERE id = ?', [id]);
}

async function getFoldersByParent(scope, workspaceId, parentId) {
    if (scope === 'root') {
        return db.all(
            `SELECT * FROM vfs_folders WHERE scope = 'root' AND trashed_at IS NULL AND parent_id ${parentId ? '= ?' : 'IS NULL'}`,
            parentId ? [parentId] : []
        );
    }
    return db.all(
        `SELECT * FROM vfs_folders WHERE scope = 'workspace' AND workspace_id = ? AND trashed_at IS NULL AND parent_id ${parentId ? '= ?' : 'IS NULL'}`,
        parentId ? [workspaceId, parentId] : [workspaceId]
    );
}

async function renameFolder(id, name) {
    const now = Math.floor(Date.now() / 1000);
    await db.run('UPDATE vfs_folders SET name = ?, updated_at = ? WHERE id = ?', [name, now, id]);
    return getFolderById(id);
}

async function deleteFolder(id) {
    const childFolders = await db.all('SELECT id FROM vfs_folders WHERE parent_id = ?', [id]);
    if (childFolders.length > 0) {
        throw new Error('Folder is not empty');
    }
    const entries = await db.all('SELECT id FROM vfs_entries WHERE folder_id = ?', [id]);
    if (entries.length > 0) {
        throw new Error('Folder is not empty');
    }
    const files = await db.all('SELECT id FROM user_files WHERE folder_id = ?', [id]);
    if (files.length > 0) {
        throw new Error('Folder is not empty');
    }
    return deleteFolderRow(id);
}

async function deleteFolderRow(id) {
    await db.run('DELETE FROM vfs_folders WHERE id = ?', [id]);
    return { success: true };
}

async function getChildFolderIds(parentId) {
    const rows = await db.all('SELECT id FROM vfs_folders WHERE parent_id = ?', [parentId]);
    return rows.map(r => r.id);
}

async function collectDescendantFolderIds(rootId) {
    const result = [];
    const queue = await getChildFolderIds(rootId);
    while (queue.length) {
        const id = queue.shift();
        result.push(id);
        queue.push(...await getChildFolderIds(id));
    }
    return result;
}

async function updateFolder(id, updates) {
    const fields = [];
    const values = [];
    if (updates.parent_id !== undefined) {
        fields.push('parent_id = ?');
        values.push(updates.parent_id);
    }
    if (updates.scope !== undefined) {
        fields.push('scope = ?');
        values.push(updates.scope);
    }
    if (updates.workspace_id !== undefined) {
        fields.push('workspace_id = ?');
        values.push(updates.workspace_id);
    }
    if (updates.name !== undefined) {
        fields.push('name = ?');
        values.push(updates.name);
    }
    if (fields.length === 0) return getFolderById(id);
    fields.push('updated_at = ?');
    values.push(Math.floor(Date.now() / 1000));
    values.push(id);
    await db.run(`UPDATE vfs_folders SET ${fields.join(', ')} WHERE id = ?`, values);
    return getFolderById(id);
}

async function updateUserFilesInFolders(folderIds, scope, workspaceId) {
    if (!folderIds.length) return;
    const placeholders = folderIds.map(() => '?').join(',');
    const now = Math.floor(Date.now() / 1000);
    await db.run(
        `UPDATE user_files SET scope = ?, workspace_id = ?, updated_at = ? WHERE folder_id IN (${placeholders})`,
        [scope, workspaceId, now, ...folderIds]
    );
}

async function createEntry({ folderId, targetKind, targetId, displayName = null, entryMeta = null }) {
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);
    await db.run(
        `INSERT INTO vfs_entries (id, folder_id, target_kind, target_id, display_name, entry_meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, folderId, targetKind, targetId, displayName, entryMeta, now]
    );
    return getEntryById(id);
}

async function getEntryById(id) {
    return db.get('SELECT * FROM vfs_entries WHERE id = ?', [id]);
}

async function getEntriesByFolder(folderId) {
    return db.all('SELECT * FROM vfs_entries WHERE folder_id = ?', [folderId]);
}

async function updateEntry(id, updates) {
    const fields = [];
    const values = [];
    if (updates.display_name !== undefined) {
        fields.push('display_name = ?');
        values.push(updates.display_name);
    }
    if (updates.entry_meta !== undefined) {
        fields.push('entry_meta = ?');
        values.push(updates.entry_meta);
    }
    if (updates.folder_id !== undefined) {
        fields.push('folder_id = ?');
        values.push(updates.folder_id);
    }
    if (fields.length === 0) return getEntryById(id);
    values.push(id);
    await db.run(`UPDATE vfs_entries SET ${fields.join(', ')} WHERE id = ?`, values);
    return getEntryById(id);
}

async function deleteEntry(id) {
    await db.run('DELETE FROM vfs_entries WHERE id = ?', [id]);
    return { success: true };
}

async function moveEntry(id, newFolderId) {
    await db.run('UPDATE vfs_entries SET folder_id = ? WHERE id = ?', [newFolderId, id]);
    return db.get('SELECT * FROM vfs_entries WHERE id = ?', [id]);
}

async function createUserFile({ contentHash, originalName, mimeType, size, scope, workspaceId = null, folderId = null, previewPath = null }) {
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);
    await db.run(
        `INSERT INTO user_files (id, content_hash, original_name, mime_type, size, scope, workspace_id, folder_id, preview_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, contentHash, originalName, mimeType, size, scope, workspaceId, folderId, previewPath, now, now]
    );
    return getUserFileById(id);
}

async function getUserFileById(id) {
    return db.get('SELECT * FROM user_files WHERE id = ?', [id]);
}

async function getUserFilesByLocation(scope, workspaceId, folderId) {
    if (scope === 'root') {
        return db.all(
            `SELECT * FROM user_files WHERE scope = 'root' AND trashed_at IS NULL AND folder_id ${folderId ? '= ?' : 'IS NULL'}`,
            folderId ? [folderId] : []
        );
    }
    return db.all(
        `SELECT * FROM user_files WHERE scope = 'workspace' AND workspace_id = ? AND trashed_at IS NULL AND folder_id ${folderId ? '= ?' : 'IS NULL'}`,
        folderId ? [workspaceId, folderId] : [workspaceId]
    );
}

async function updateUserFile(id, updates) {
    const fields = [];
    const values = [];
    if (updates.original_name !== undefined) {
        fields.push('original_name = ?');
        values.push(updates.original_name);
    }
    if (updates.content_hash !== undefined) {
        fields.push('content_hash = ?');
        values.push(updates.content_hash);
    }
    if (updates.mime_type !== undefined) {
        fields.push('mime_type = ?');
        values.push(updates.mime_type);
    }
    if (updates.size !== undefined) {
        fields.push('size = ?');
        values.push(updates.size);
    }
    if (updates.preview_path !== undefined) {
        fields.push('preview_path = ?');
        values.push(updates.preview_path);
    }
    if (updates.folder_id !== undefined) {
        fields.push('folder_id = ?');
        values.push(updates.folder_id);
    }
    if (updates.scope !== undefined) {
        fields.push('scope = ?');
        values.push(updates.scope);
    }
    if (updates.workspace_id !== undefined) {
        fields.push('workspace_id = ?');
        values.push(updates.workspace_id);
    }
    if (fields.length === 0) return getUserFileById(id);
    fields.push('updated_at = ?');
    values.push(Math.floor(Date.now() / 1000));
    values.push(id);
    await db.run(`UPDATE user_files SET ${fields.join(', ')} WHERE id = ?`, values);
    return getUserFileById(id);
}

async function countUserFilesByContentHash(contentHash, excludeFileId = null) {
    if (!contentHash) return 0;
    if (excludeFileId) {
        const row = await db.get(
            'SELECT COUNT(*) AS count FROM user_files WHERE content_hash = ? AND id != ?',
            [contentHash, excludeFileId]
        );
        return row?.count || 0;
    }
    const row = await db.get(
        'SELECT COUNT(*) AS count FROM user_files WHERE content_hash = ?',
        [contentHash]
    );
    return row?.count || 0;
}

/** Count vfs_entries (shortcuts/aliases) pointing at a user_files row. */
async function countVfsEntriesForUserFile(fileId) {
    if (!fileId) return 0;
    const row = await db.get(
        `SELECT COUNT(*) AS count FROM vfs_entries WHERE target_kind = 'user-file' AND target_id = ?`,
        [fileId]
    );
    return row?.count || 0;
}

/** Count vfs_entries pointing at a virtual-surface target (e.g. note). */
async function countEntriesByTarget(targetKind, targetId, excludeEntryId = null) {
    if (!targetKind || !targetId) return 0;
    const row = excludeEntryId
        ? await db.get(
            `SELECT COUNT(*) AS count FROM vfs_entries WHERE target_kind = ? AND target_id = ? AND id != ?`,
            [targetKind, targetId, excludeEntryId]
        )
        : await db.get(
            `SELECT COUNT(*) AS count FROM vfs_entries WHERE target_kind = ? AND target_id = ?`,
            [targetKind, targetId]
        );
    return row?.count || 0;
}

/**
 * Whether an authenticated session may download/serve a user_files row.
 * @param {{ userType?: string, applicationScopes?: string[] }} session
 * @param {object|null} fileRow user_files row
 * @param {{ workspaceExists?: (id: string) => boolean }} [ctx]
 */
function canSessionAccessVfsFile(session, fileRow, ctx = {}) {
    if (!session || !fileRow) return false;

    const scopes = session.applicationScopes;
    if (Array.isArray(scopes) && scopes.length > 0) {
        if (!scopes.includes('universal') && !scopes.includes('vfs')) {
            return false;
        }
    }

    if (fileRow.scope === 'root') {
        return true;
    }

    if (fileRow.scope === 'workspace') {
        const workspaceId = fileRow.workspace_id;
        if (!workspaceId) return false;
        if (typeof ctx.workspaceExists === 'function') {
            return ctx.workspaceExists(workspaceId);
        }
        return true;
    }

    return false;
}

async function deleteUserFile(id) {
    const file = await getUserFileById(id);
    if (!file) return { success: false, deleted: null };
    await db.run('DELETE FROM user_files WHERE id = ?', [id]);
    return { success: true, deleted: file };
}

async function getUserFileStats(scope, workspaceId, folderId) {
    let row;
    if (scope === 'root') {
        row = await db.get(
            `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM user_files WHERE scope = 'root' AND trashed_at IS NULL AND folder_id ${folderId ? '= ?' : 'IS NULL'}`,
            folderId ? [folderId] : []
        );
    } else {
        row = await db.get(
            `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM user_files WHERE scope = 'workspace' AND workspace_id = ? AND trashed_at IS NULL AND folder_id ${folderId ? '= ?' : 'IS NULL'}`,
            folderId ? [workspaceId, folderId] : [workspaceId]
        );
    }
    return { count: row?.count || 0, totalSize: row?.totalSize || 0 };
}

async function getFolderCountByParent(scope, workspaceId, parentId, options = {}) {
    const { excludeIds = [], excludeHiddenSurface = false } = options;
    const conditions = [];
    const params = [];

    if (scope === 'root') {
        conditions.push("scope = 'root'");
        conditions.push(`parent_id ${parentId ? '= ?' : 'IS NULL'}`);
        if (parentId) params.push(parentId);
    } else {
        conditions.push("scope = 'workspace'");
        conditions.push('workspace_id = ?');
        params.push(workspaceId);
        conditions.push(`parent_id ${parentId ? '= ?' : 'IS NULL'}`);
        if (parentId) params.push(parentId);
    }

    if (excludeHiddenSurface) {
        conditions.push("name != 'Shortcuts'");
    }
    conditions.push('trashed_at IS NULL');
    if (excludeIds.length > 0) {
        conditions.push(`id NOT IN (${excludeIds.map(() => '?').join(',')})`);
        params.push(...excludeIds);
    }

    const row = await db.get(
        `SELECT COUNT(*) as count FROM vfs_folders WHERE ${conditions.join(' AND ')}`,
        params
    );
    return row?.count || 0;
}

async function getEntryCountByFolder(folderId) {
    const row = await db.get(
        'SELECT COUNT(*) as count FROM vfs_entries WHERE folder_id = ?',
        [folderId]
    );
    return row?.count || 0;
}

async function getLinkedUserFileStatsByFolder(folderId) {
    const row = await db.get(
        `SELECT COUNT(*) as count, COALESCE(SUM(uf.size), 0) as totalSize
         FROM vfs_entries e
         INNER JOIN user_files uf ON uf.id = e.target_id
         WHERE e.folder_id = ? AND e.target_kind = 'user-file' AND uf.trashed_at IS NULL`,
        [folderId]
    );
    return { count: row?.count || 0, totalSize: row?.totalSize || 0 };
}

async function createTrashItem({ workspaceId, itemKind, targetId, displayName = null, originalPath = null, payloadJson = null }) {
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);
    await db.run(
        `INSERT INTO vfs_trash_items (id, workspace_id, item_kind, target_id, display_name, original_path, payload_json, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, workspaceId, itemKind, targetId, displayName, originalPath, payloadJson, now]
    );
    return getTrashItemById(id);
}

async function getTrashItemById(id) {
    return db.get('SELECT * FROM vfs_trash_items WHERE id = ?', [id]);
}

async function getTrashItemsByWorkspace(workspaceId) {
    return db.all(
        'SELECT * FROM vfs_trash_items WHERE workspace_id = ? ORDER BY deleted_at DESC',
        [workspaceId]
    );
}

async function deleteTrashItem(id) {
    await db.run('DELETE FROM vfs_trash_items WHERE id = ?', [id]);
    return { success: true };
}

async function deleteTrashItemsByWorkspace(workspaceId) {
    await db.run('DELETE FROM vfs_trash_items WHERE workspace_id = ?', [workspaceId]);
    return { success: true };
}

async function getTrashedTargetIdSet(workspaceId, itemKinds = null) {
    let sql = 'SELECT item_kind, target_id FROM vfs_trash_items WHERE workspace_id = ?';
    const params = [workspaceId];
    if (itemKinds?.length) {
        sql += ` AND item_kind IN (${itemKinds.map(() => '?').join(',')})`;
        params.push(...itemKinds);
    }
    const rows = await db.all(sql, params);
    const set = new Set();
    for (const row of rows) set.add(`${row.item_kind}:${row.target_id}`);
    return set;
}

async function isTargetInTrash(workspaceId, itemKind, targetId) {
    const row = await db.get(
        'SELECT id FROM vfs_trash_items WHERE workspace_id = ? AND item_kind = ? AND target_id = ?',
        [workspaceId, itemKind, targetId]
    );
    return !!row;
}

async function markFolderTrashed(folderId, trashedAt) {
    await db.run('UPDATE vfs_folders SET trashed_at = ?, updated_at = ? WHERE id = ?', [trashedAt, trashedAt, folderId]);
}

async function markFoldersTrashed(folderIds, trashedAt) {
    if (!folderIds.length) return;
    const placeholders = folderIds.map(() => '?').join(',');
    await db.run(
        `UPDATE vfs_folders SET trashed_at = ?, updated_at = ? WHERE id IN (${placeholders})`,
        [trashedAt, trashedAt, ...folderIds]
    );
}

async function clearFolderTrashed(folderIds) {
    if (!folderIds.length) return;
    const now = Math.floor(Date.now() / 1000);
    const placeholders = folderIds.map(() => '?').join(',');
    await db.run(
        `UPDATE vfs_folders SET trashed_at = NULL, updated_at = ? WHERE id IN (${placeholders})`,
        [now, ...folderIds]
    );
}

async function markUserFileTrashed(fileId, trashedAt) {
    await db.run('UPDATE user_files SET trashed_at = ?, updated_at = ? WHERE id = ?', [trashedAt, trashedAt, fileId]);
}

async function markUserFilesTrashedInFolders(folderIds, trashedAt) {
    if (!folderIds.length) return;
    const placeholders = folderIds.map(() => '?').join(',');
    await db.run(
        `UPDATE user_files SET trashed_at = ?, updated_at = ? WHERE folder_id IN (${placeholders})`,
        [trashedAt, trashedAt, ...folderIds]
    );
}

async function clearUserFilesTrashedInFolders(folderIds) {
    if (!folderIds.length) return;
    const now = Math.floor(Date.now() / 1000);
    const placeholders = folderIds.map(() => '?').join(',');
    await db.run(
        `UPDATE user_files SET trashed_at = NULL, updated_at = ? WHERE folder_id IN (${placeholders})`,
        [now, ...folderIds]
    );
}

async function clearUserFileTrashed(fileId) {
    const now = Math.floor(Date.now() / 1000);
    await db.run('UPDATE user_files SET trashed_at = NULL, updated_at = ? WHERE id = ?', [now, fileId]);
}

async function getUserFilesInFoldersIncludingTrashed(folderIds) {
    if (!folderIds.length) return [];
    const placeholders = folderIds.map(() => '?').join(',');
    return db.all(`SELECT * FROM user_files WHERE folder_id IN (${placeholders})`, folderIds);
}

module.exports = {
    initializeVfsDatabase,
    closeVfsDatabase,
    getCheckpointManager,
    generateId,
    createFolder,
    getFolderById,
    getFoldersByParent,
    renameFolder,
    deleteFolder,
    deleteFolderRow,
    getChildFolderIds,
    collectDescendantFolderIds,
    updateFolder,
    updateUserFilesInFolders,
    createEntry,
    getEntryById,
    getEntriesByFolder,
    updateEntry,
    deleteEntry,
    moveEntry,
    createUserFile,
    getUserFileById,
    getUserFilesByLocation,
    updateUserFile,
    deleteUserFile,
    getUserFileStats,
    getFolderCountByParent,
    getEntryCountByFolder,
    getLinkedUserFileStatsByFolder,
    countUserFilesByContentHash,
    countVfsEntriesForUserFile,
    countEntriesByTarget,
    canSessionAccessVfsFile,
    createTrashItem,
    getTrashItemById,
    getTrashItemsByWorkspace,
    deleteTrashItem,
    deleteTrashItemsByWorkspace,
    getTrashedTargetIdSet,
    isTargetInTrash,
    markFolderTrashed,
    markFoldersTrashed,
    clearFolderTrashed,
    markUserFileTrashed,
    markUserFilesTrashedInFolders,
    clearUserFilesTrashedInFolders,
    clearUserFileTrashed,
    getUserFilesInFoldersIncludingTrashed
};
