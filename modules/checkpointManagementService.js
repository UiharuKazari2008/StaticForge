/**
 * Unified checkpoint bundles — coordinates JSON config + SQLite snapshots for manual restore.
 * Reuses JSONCheckpointManager and DatabaseCheckpointManager via configManager / globalCheckpointManager.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const metadataDatabase = require('./metadataDatabase');
const directorDatabase = require('./directorDatabase');
const notesDatabase = require('./notesDatabase');
const vfsDatabase = require('./vfsDatabase');
const chatDatabase = require('./chatDatabase');
const applicationAuthDatabase = require('./applicationAuthDatabase');
const knowledgeMemoryDatabase = require('./knowledgeMemoryDatabase');
const tagSearchDatabase = require('./tagSearchDatabase');
const {
    getCheckpointSettings,
    applyBundleGrandfathering,
    resolveBundleManifestPath,
    resolveCheckpointFilePath,
    newCheckpointRelativePath,
    ensureTierDirs,
    parseFilenameTimestamp,
    TIERS
} = require('./checkpointGrandfathering');

const RESOURCE_LABELS = {
    config: 'config.json',
    secureConfig: 'secure.config.json',
    promptConfig: 'prompt.config.json',
    directorConfig: 'director.config.json',
    favorites: 'favorites.json',
    workspaces: 'workspaces.json',
    workspaceDesktop: 'workspace_desktop.json',
    naxGeneration: 'nax_generation_config.json'
};

class CheckpointManagementService {
    constructor(globalResources) {
        if (!globalResources) {
            throw new Error('CheckpointManagementService requires globalResources');
        }
        this.globalResources = globalResources;
    }

    get _bundlesDir() {
        return path.join(this.globalResources.getPath('cache'), 'checkpoints', 'bundles');
    }

    _ensureBundlesDir() {
        if (!fs.existsSync(this._bundlesDir)) {
            fs.mkdirSync(this._bundlesDir, { recursive: true });
        }
    }

    _readManifestFile(filePath) {
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    _loadAllManifests() {
        this._ensureBundlesDir();
        ensureTierDirs(this._bundlesDir);

        // Migrate legacy flat UUID manifests into hour/ before listing
        const hourDir = path.join(this._bundlesDir, 'hour');
        for (const name of fs.readdirSync(this._bundlesDir)) {
            if (!/^[a-f0-9-]{36}\.json$/i.test(name)) continue;
            const src = path.join(this._bundlesDir, name);
            if (!fs.statSync(src).isFile()) continue;
            const dest = path.join(hourDir, name);
            if (!fs.existsSync(dest)) {
                try {
                    fs.renameSync(src, dest);
                } catch {
                    // ignore migration failure — still attempt to read from src
                }
            }
        }

        const manifests = [];
        const seen = new Set();
        const uuidPattern = /^[a-f0-9-]{36}\.json$/i;

        const scanDir = (dir) => {
            if (!fs.existsSync(dir)) return;
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const ent of entries) {
                if (ent.isDirectory()) continue;
                if (!uuidPattern.test(ent.name)) continue;
                const full = path.join(dir, ent.name);
                if (!fs.statSync(full).isFile()) continue;
                if (seen.has(full)) continue;
                seen.add(full);
                const data = this._readManifestFile(full);
                if (data && data.id) {
                    manifests.push(data);
                }
            }
        };

        scanDir(this._bundlesDir);
        for (const tier of TIERS) {
            scanDir(path.join(this._bundlesDir, tier));
        }

        manifests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return manifests;
    }

    _encodeFileCheckpointId(resourceKey, filename) {
        return `file:${resourceKey}:${filename}`;
    }

    _decodeFileCheckpointId(id) {
        if (!id || typeof id !== 'string' || !id.startsWith('file:')) return null;
        const rest = id.slice(5);
        const sep = rest.indexOf(':');
        if (sep <= 0) return null;
        return {
            resourceKey: rest.slice(0, sep),
            filename: rest.slice(sep + 1)
        };
    }

    _listPerConfigFileCheckpoints() {
        const entries = [];
        for (const entry of this._jsonResourceEntries()) {
            const manager = entry.manager;
            if (!manager?.getCheckpointFiles) continue;
            const files = manager.getCheckpointFiles();
            for (const file of files) {
                const ts = parseFilenameTimestamp(file.basename || file.filename);
                const createdAt = ts && !Number.isNaN(ts.getTime())
                    ? ts.toISOString()
                    : (file.mtime ? file.mtime.toISOString() : new Date().toISOString());
                entries.push({
                    id: this._encodeFileCheckpointId(entry.key, file.filename),
                    kind: 'config-file',
                    createdAt,
                    label: `${entry.label} — ${path.basename(file.basename || file.filename, path.extname(file.basename || file.filename))}`,
                    reason: 'auto-save',
                    createdBy: null,
                    totalSizeBytes: file.size || 0,
                    configCount: 1,
                    databaseCount: 0,
                    databaseNames: [],
                    scopeSummary: `${entry.label} only`,
                    resourceKey: entry.key,
                    filename: file.filename
                });
            }
        }
        return entries;
    }

    _manifestPath(id) {
        const existing = resolveBundleManifestPath(this._bundlesDir, id);
        if (existing && fs.existsSync(existing)) {
            return existing;
        }
        return path.join(this._bundlesDir, 'hour', `${id}.json`);
    }

    _saveManifest(manifest) {
        this._ensureBundlesDir();
        ensureTierDirs(this._bundlesDir);
        const dest = path.join(this._bundlesDir, 'hour', `${manifest.id}.json`);
        fs.writeFileSync(dest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    }

    _getConfigManager() {
        return this.globalResources.configManager;
    }

    _getGlobalCheckpointManager() {
        return this.globalResources.globalCheckpointManager;
    }

    _jsonResourceEntries() {
        const cm = this._getConfigManager();
        if (!cm) return [];
        return cm.getConfigTypes().map((configType) => {
            const info = cm.getConfigInfo(configType);
            return {
                key: configType,
                type: 'json',
                label: RESOURCE_LABELS[configType] || configType,
                manager: cm.getCheckpointManager(configType),
                livePath: info?.path || null
            };
        }).filter((r) => r.manager);
    }

    _databaseResourceEntries() {
        const seenPaths = new Set();
        const entries = [];

        const addEntry = (key, manager) => {
            if (!manager?.dbPath) return;
            const normalized = path.resolve(manager.dbPath);
            if (seenPaths.has(normalized)) return;
            seenPaths.add(normalized);
            entries.push({
                key,
                type: 'database',
                label: `${key}.db`,
                manager,
                livePath: manager.dbPath
            });
        };

        const gcm = this._getGlobalCheckpointManager();
        if (gcm) {
            for (const [key, info] of gcm.getAllCheckpointManagers()) {
                if (info.type !== 'database') continue;
                addEntry(key, info.manager);
            }
        }

        const supplemental = [
            ['notes', () => notesDatabase.getCheckpointManager?.()],
            ['vfs', () => vfsDatabase.getCheckpointManager?.()],
            ['application_auth', () => applicationAuthDatabase.getCheckpointManager?.()],
            ['generation_quips', () => this.globalResources.getGenerationQuipsDatabase?.()?.getCheckpointManager?.()],
            ['knowledge_memory', () => knowledgeMemoryDatabase.getCheckpointManager?.()],
            ['reference_metadata', () => this.globalResources.referenceMetadataDatabase?.getCheckpointManager?.()],
            ['tag_wiki', () => this.globalResources.tagDatabase?.getCheckpointManager?.()],
            ['tag_search', () => tagSearchDatabase.getCheckpointManager?.()]
        ];
        for (const [key, getManager] of supplemental) {
            addEntry(key, getManager());
        }

        return entries;
    }

    _allResources() {
        return [...this._jsonResourceEntries(), ...this._databaseResourceEntries()];
    }

    _fileSize(filePath) {
        try {
            if (!fs.existsSync(filePath)) return 0;
            return fs.statSync(filePath).size;
        } catch {
            return 0;
        }
    }

    _checkpointFilePath(manager, filename, type) {
        if (!manager || !filename) return null;
        return resolveCheckpointFilePath(manager.checkpointDir, filename);
    }

    _summarizeManifest(manifest) {
        const jsonKeys = Object.keys(manifest.resources?.json || {});
        const dbKeys = Object.keys(manifest.resources?.database || {});
        return {
            id: manifest.id,
            createdAt: manifest.createdAt,
            label: manifest.label || null,
            reason: manifest.reason || 'manual',
            createdBy: manifest.createdBy || null,
            totalSizeBytes: manifest.totalSizeBytes || 0,
            configCount: jsonKeys.length,
            databaseCount: dbKeys.length,
            databaseNames: dbKeys,
            jsonConfigKeys: jsonKeys,
            scopeSummary: `${jsonKeys.length} config file${jsonKeys.length === 1 ? '' : 's'}, ${dbKeys.length} database${dbKeys.length === 1 ? '' : 's'}`
        };
    }

    listCheckpoints(configId = null) {
        const settings = getCheckpointSettings(this.globalResources);
        const bundleEntries = this._loadAllManifests().map((m) => ({
            ...this._summarizeManifest(m),
            kind: 'bundle'
        }));
        const fileEntries = this._listPerConfigFileCheckpoints();
        let checkpoints = [...bundleEntries, ...fileEntries]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (configId) {
            checkpoints = checkpoints.filter((cp) => {
                if (cp.kind === 'config-file') {
                    return cp.resourceKey === configId;
                }
                if (cp.kind === 'bundle' && Array.isArray(cp.jsonConfigKeys)) {
                    return cp.jsonConfigKeys.includes(configId);
                }
                return false;
            });
        }
        return {
            checkpoints,
            retention: settings.grandfathering,
            checkpointsEnabled: settings.enabled,
            includedResourceTypes: {
                json: this._jsonResourceEntries().map((r) => ({ key: r.key, label: r.label })),
                database: this._databaseResourceEntries().map((r) => ({ key: r.key, label: r.label }))
            },
            excludedNotes: [
                'nax_tags.db — reference/import data, not checkpointed',
                'Per-config auto-save checkpoints appear below bundle snapshots'
            ]
        };
    }

    getCheckpointDetail(id) {
        const fileRef = this._decodeFileCheckpointId(id);
        if (fileRef) {
            const entry = this._jsonResourceEntries().find((r) => r.key === fileRef.resourceKey);
            const filePath = entry?.manager
                ? resolveCheckpointFilePath(entry.manager.checkpointDir, fileRef.filename)
                : null;
            const label = RESOURCE_LABELS[fileRef.resourceKey] || fileRef.resourceKey;
            const ts = parseFilenameTimestamp(path.basename(fileRef.filename));
            return {
                id,
                kind: 'config-file',
                createdAt: ts && !Number.isNaN(ts.getTime()) ? ts.toISOString() : new Date().toISOString(),
                label: `${label} — ${path.basename(fileRef.filename)}`,
                reason: 'auto-save',
                totalSizeBytes: this._fileSize(filePath),
                configCount: 1,
                databaseCount: 0,
                scopeSummary: `${label} only`,
                resources: {
                    json: {
                        [fileRef.resourceKey]: {
                            label,
                            filename: fileRef.filename,
                            sizeBytes: this._fileSize(filePath),
                            exists: filePath ? fs.existsSync(filePath) : false
                        }
                    },
                    database: {}
                }
            };
        }

        const manifest = this._loadManifestById(id);
        if (!manifest) {
            throw new Error(`Checkpoint not found: ${id}`);
        }

        const jsonDetail = {};
        for (const [key, ref] of Object.entries(manifest.resources?.json || {})) {
            const entry = this._jsonResourceEntries().find((r) => r.key === key);
            const filePath = entry?.manager ? this._checkpointFilePath(entry.manager, ref.filename, 'json') : null;
            jsonDetail[key] = {
                label: RESOURCE_LABELS[key] || key,
                filename: ref.filename,
                sizeBytes: ref.sizeBytes ?? this._fileSize(filePath),
                exists: filePath ? fs.existsSync(filePath) : false
            };
        }

        const dbDetail = {};
        for (const [key, ref] of Object.entries(manifest.resources?.database || {})) {
            const entry = this._databaseResourceEntries().find((r) => r.key === key);
            const filePath = entry?.manager ? this._checkpointFilePath(entry.manager, ref.filename, 'database') : null;
            dbDetail[key] = {
                label: `${key}.db`,
                filename: ref.filename,
                sizeBytes: ref.sizeBytes ?? this._fileSize(filePath),
                exists: filePath ? fs.existsSync(filePath) : false
            };
        }

        return {
            ...this._summarizeManifest(manifest),
            resources: { json: jsonDetail, database: dbDetail }
        };
    }

    _loadManifestById(id) {
        if (!id || typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) {
            return null;
        }
        const filePath = resolveBundleManifestPath(this._bundlesDir, id);
        if (!filePath || !fs.existsSync(filePath)) return null;
        return this._readManifestFile(filePath);
    }

    async _snapshotJsonResource(entry) {
        const { manager, key, livePath } = entry;
        if (!livePath || !fs.existsSync(livePath)) {
            return null;
        }
        manager.markDirty();
        manager.createCheckpoint({ force: true });
        const latest = manager.getCheckpointFiles()[0];
        if (!latest) return null;
        const filePath = latest.filePath;
        return {
            filename: latest.filename,
            sizeBytes: latest.size,
            filePath
        };
    }

    async _snapshotDatabaseResource(entry) {
        const { manager, key } = entry;
        const gcm = this._getGlobalCheckpointManager();
        if (!manager.dbPath || !fs.existsSync(manager.dbPath)) {
            return null;
        }

        let created = false;
        if (gcm) {
            created = await gcm.createCheckpoint(key, true);
        }
        if (!created && manager.createCheckpointWithBackup) {
            created = await manager.createCheckpointWithBackup(true);
        } else if (!created) {
            created = manager.createCheckpoint();
        }

        const latest = manager.getCheckpointFiles()[0];
        if (!latest) return null;
        return {
            filename: latest.filename,
            sizeBytes: latest.size,
            filePath: latest.filePath
        };
    }

    async createCheckpoint(options = {}) {
        const { label = '', reason = 'manual', createdBy = null } = options;

        await this.globalResources.flushAllPendingConfigSaves?.();

        const resources = { json: {}, database: {} };
        let totalSizeBytes = 0;

        for (const entry of this._jsonResourceEntries()) {
            const snap = await this._snapshotJsonResource(entry);
            if (snap) {
                resources.json[entry.key] = {
                    filename: snap.filename,
                    sizeBytes: snap.sizeBytes
                };
                totalSizeBytes += snap.sizeBytes;
            }
        }

        for (const entry of this._databaseResourceEntries()) {
            const snap = await this._snapshotDatabaseResource(entry);
            if (snap) {
                resources.database[entry.key] = {
                    filename: snap.filename,
                    sizeBytes: snap.sizeBytes
                };
                totalSizeBytes += snap.sizeBytes;
            }
        }

        const manifest = {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            label: String(label || '').trim() || null,
            reason,
            createdBy,
            resources,
            totalSizeBytes
        };

        this._saveManifest(manifest);
        this._cleanupOldBundles();

        return this.getCheckpointDetail(manifest.id);
    }

    _cleanupOldBundles() {
        applyBundleGrandfathering(this._bundlesDir, this.globalResources);
    }

    _validateManifestIntegrity(manifest) {
        const errors = [];

        for (const [key, ref] of Object.entries(manifest.resources?.json || {})) {
            const entry = this._jsonResourceEntries().find((r) => r.key === key);
            if (!entry?.manager) {
                errors.push(`Unknown config resource: ${key}`);
                continue;
            }
            const cpPath = this._checkpointFilePath(entry.manager, ref.filename, 'json');
            if (!cpPath || !fs.existsSync(cpPath)) {
                errors.push(`Missing config checkpoint: ${key}/${ref.filename}`);
                continue;
            }
            const validation = entry.manager.validateCheckpoint(cpPath, entry.manager.validationCallback);
            if (!validation.valid) {
                errors.push(`Invalid config checkpoint ${key}: ${validation.error}`);
            }
        }

        for (const [key, ref] of Object.entries(manifest.resources?.database || {})) {
            const entry = this._databaseResourceEntries().find((r) => r.key === key);
            if (!entry?.manager) {
                errors.push(`Unknown database resource: ${key}`);
                continue;
            }
            const cpPath = this._checkpointFilePath(entry.manager, ref.filename, 'database');
            if (!cpPath || !fs.existsSync(cpPath)) {
                errors.push(`Missing database checkpoint: ${key}/${ref.filename}`);
                continue;
            }
            if (!entry.manager.verifyDatabaseIntegrity(cpPath)) {
                errors.push(`Database integrity check failed: ${key}/${ref.filename}`);
            }
        }

        if (errors.length) {
            throw new Error(`Checkpoint integrity validation failed:\n${errors.join('\n')}`);
        }
    }

    async _closeDatabaseByKey(key, manager) {
        const dbPath = manager?.dbPath;
        if (!dbPath) return;

        if (key === 'metadata' && metadataDatabase.closeDatabase) {
            await metadataDatabase.closeDatabase();
            return;
        }
        if (key === 'director' && directorDatabase.closeDirectorDatabase) {
            await directorDatabase.closeDirectorDatabase();
            return;
        }
        if (key === 'notes' && notesDatabase.closeNotesDatabase) {
            await notesDatabase.closeNotesDatabase();
            return;
        }
        if (key === 'vfs' && vfsDatabase.closeVfsDatabase) {
            await vfsDatabase.closeVfsDatabase();
            return;
        }
        if (key === 'chat' && chatDatabase.closeChatDatabase) {
            await chatDatabase.closeChatDatabase();
            return;
        }
        if (key === 'application_auth' && applicationAuthDatabase.getDb) {
            const wrapper = applicationAuthDatabase.getDb();
            if (wrapper?.close) await wrapper.close();
            return;
        }
        if (key === 'generation_quips' && this.globalResources.getGenerationQuipsDatabase) {
            const gq = this.globalResources.getGenerationQuipsDatabase();
            if (gq?.close) gq.close();
            return;
        }
        if (key === 'reference_metadata' && this.globalResources.referenceMetadataDatabase?.close) {
            this.globalResources.referenceMetadataDatabase.close();
            return;
        }
        if (key === 'tag_wiki' && this.globalResources.tagDatabase?.db?.close) {
            await this.globalResources.tagDatabase.db.close();
            return;
        }
        if (key === 'knowledge_memory' && knowledgeMemoryDatabase.closeKnowledgeMemoryDatabase) {
            knowledgeMemoryDatabase.closeKnowledgeMemoryDatabase();
            return;
        }
        if (key === 'tag_search' && tagSearchDatabase.closeTagSearchDatabase) {
            tagSearchDatabase.closeTagSearchDatabase();
            return;
        }

        const asyncMgr = this.globalResources.asyncSQLiteManager;
        if (asyncMgr) {
            const normalized = path.resolve(dbPath);
            for (const [p, wrapper] of asyncMgr.getAllDatabases()) {
                if (path.resolve(p) === normalized && wrapper.isOpenState?.()) {
                    await wrapper.close();
                }
            }
        }
    }

    _clearWalShmIfMissingFromCheckpoint(manager, checkpointFilename) {
        const checkpointPath = path.join(manager.checkpointDir, checkpointFilename);
        const walCp = checkpointPath + '-wal';
        const shmCp = checkpointPath + '-shm';
        const walLive = manager.dbPath + '-wal';
        const shmLive = manager.dbPath + '-shm';

        if (!fs.existsSync(walCp) && fs.existsSync(walLive)) {
            fs.unlinkSync(walLive);
        }
        if (!fs.existsSync(shmCp) && fs.existsSync(shmLive)) {
            fs.unlinkSync(shmLive);
        }
    }

    async restoreCheckpoint(id, options = {}) {
        const { createSafetyCheckpoint = true, createdBy = null } = options;
        const fileRef = this._decodeFileCheckpointId(id);
        if (fileRef) {
            const entry = this._jsonResourceEntries().find((r) => r.key === fileRef.resourceKey);
            if (!entry?.manager) {
                throw new Error(`Checkpoint not found: ${id}`);
            }
            const cpPath = resolveCheckpointFilePath(entry.manager.checkpointDir, fileRef.filename);
            if (!cpPath || !fs.existsSync(cpPath)) {
                throw new Error(`Missing config checkpoint file: ${fileRef.filename}`);
            }

            await this.globalResources.flushAllPendingConfigSaves?.();
            entry.manager.restoreFromCheckpoint(fileRef.filename, {
                saveCurrentAsBranch: true,
                skipSavingCurrent: false
            });
            this._getConfigManager()?.refreshConfig(fileRef.resourceKey);

            const wsServer = this.globalResources.getWebSocketServer?.();
            if (wsServer) {
                wsServer.broadcast({
                    type: 'config_checkpoint_restored',
                    data: {
                        checkpointId: id,
                        safetyCheckpointId: null,
                        restored: { json: [fileRef.resourceKey], database: [] },
                        timestamp: Date.now()
                    },
                    timestamp: new Date().toISOString()
                });
            }

            return {
                success: true,
                checkpointId: id,
                safetyCheckpointId: null,
                restored: { json: [fileRef.resourceKey], database: [] }
            };
        }

        const manifest = this._loadManifestById(id);
        if (!manifest) {
            throw new Error(`Checkpoint not found: ${id}`);
        }

        this._validateManifestIntegrity(manifest);

        let safetyCheckpointId = null;
        if (createSafetyCheckpoint) {
            const safety = await this.createCheckpoint({
                label: `Pre-restore backup (${manifest.label || id.slice(0, 8)})`,
                reason: 'pre-restore',
                createdBy
            });
            safetyCheckpointId = safety.id;
        }

        await this.globalResources.flushAllPendingConfigSaves?.();

        const restored = { json: [], database: [] };

        for (const [key, ref] of Object.entries(manifest.resources?.json || {})) {
            const entry = this._jsonResourceEntries().find((r) => r.key === key);
            if (!entry?.manager) continue;
            entry.manager.restoreFromCheckpoint(ref.filename, {
                saveCurrentAsBranch: true,
                skipSavingCurrent: false
            });
            this._getConfigManager()?.refreshConfig(key);
            restored.json.push(key);
        }

        for (const [key, ref] of Object.entries(manifest.resources?.database || {})) {
            const entry = this._databaseResourceEntries().find((r) => r.key === key);
            if (!entry?.manager) continue;
            await this._closeDatabaseByKey(key, entry.manager);
            entry.manager.restoreFromCheckpoint(ref.filename);
            this._clearWalShmIfMissingFromCheckpoint(entry.manager, ref.filename);
            restored.database.push(key);
        }

        this._getConfigManager()?.refreshAllConfigs?.();

        const wsServer = this.globalResources.getWebSocketServer?.();
        if (wsServer) {
            wsServer.broadcast({
                type: 'config_checkpoint_restored',
                data: {
                    checkpointId: id,
                    safetyCheckpointId,
                    restored,
                    timestamp: Date.now()
                },
                timestamp: new Date().toISOString()
            });
        }

        return {
            success: true,
            checkpointId: id,
            safetyCheckpointId,
            restored
        };
    }

    _countFilenameReferences(filename, type, resourceKey, excludeId = null) {
        let count = 0;
        for (const m of this._loadAllManifests()) {
            if (excludeId && m.id === excludeId) continue;
            const bucket = m.resources?.[type]?.[resourceKey];
            if (bucket?.filename === filename) count++;
        }
        return count;
    }

    deleteCheckpoint(id, options = {}) {
        const fileRef = this._decodeFileCheckpointId(id);
        if (fileRef) {
            const entry = this._jsonResourceEntries().find((r) => r.key === fileRef.resourceKey);
            if (!entry?.manager) {
                throw new Error(`Checkpoint not found: ${id}`);
            }
            entry.manager.deleteCheckpoint(fileRef.filename);
            return { success: true, id };
        }

        const manifest = this._loadManifestById(id);
        if (!manifest) {
            throw new Error(`Checkpoint not found: ${id}`);
        }

        for (const [key, ref] of Object.entries(manifest.resources?.json || {})) {
            const refs = this._countFilenameReferences(ref.filename, 'json', key, id);
            if (refs === 0) {
                const entry = this._jsonResourceEntries().find((r) => r.key === key);
                if (entry?.manager) {
                    try {
                        entry.manager.deleteCheckpoint(ref.filename);
                    } catch (err) {
                        console.warn(`⚠️ Could not delete config checkpoint ${ref.filename}:`, err.message);
                    }
                }
            }
        }

        for (const [key, ref] of Object.entries(manifest.resources?.database || {})) {
            const refs = this._countFilenameReferences(ref.filename, 'database', key, id);
            if (refs === 0) {
                const entry = this._databaseResourceEntries().find((r) => r.key === key);
                if (entry?.manager) {
                    try {
                        entry.manager.deleteCheckpoint(ref.filename);
                    } catch (err) {
                        console.warn(`⚠️ Could not delete database checkpoint ${ref.filename}:`, err.message);
                    }
                }
            }
        }

        const manifestPath = this._manifestPath(id);
        if (fs.existsSync(manifestPath)) {
            fs.unlinkSync(manifestPath);
        }

        return { success: true, id };
    }
}

module.exports = CheckpointManagementService;
