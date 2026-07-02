const fs = require('fs');
const path = require('path');

const SYSTEM_ROOT_FOLDERS = [
    { id: '@sys-cache', name: 'Library', icon: 'fas fa-database', segment: 'Cache' },
    { id: '@sys-config', name: 'AppData', icon: 'fas fa-sliders', segment: 'Config' },
    { id: '@sys-logs', name: 'Logs', icon: 'fas fa-scroll', segment: 'Logs' },
    { id: '@sys-databases', name: 'Databases', icon: 'fas fa-table', segment: 'Databases' },
    { id: '@sys-apps', name: 'Applications', icon: 'fas fa-grid-2', segment: 'Applications' }
];

const CONFIG_EDITOR_ENTRIES = [
    { id: 'config', name: 'Application Config', icon: 'fas fa-gears', openTarget: 'editor' },
    { id: 'secureConfig', name: 'Secure Config', icon: 'fas fa-lock', openTarget: 'editor' },
    { id: 'promptConfig', name: 'Prompt Config', icon: 'fas fa-book-spells', openTarget: 'editor' },
    { id: 'directorConfig', name: 'Director Config', icon: 'fas fa-clapperboard', openTarget: 'editor' },
    { id: 'favorites', name: 'Favorites', icon: 'fas fa-star', openTarget: 'editor' },
    { id: 'workspaces', name: 'Workspaces', icon: 'fas fa-planet-ringed', openTarget: 'editor' },
    { id: 'workspaceDesktop', name: 'Desktop Layout', icon: 'fas fa-desktop', openTarget: 'editor' },
    { id: 'naxGeneration', name: 'NAX Generation', icon: 'fas fa-flask', openTarget: 'editor' }
];

const ROOT_JSON_ENTRIES = [
    { pathKey: 'characters', name: 'characters.json', icon: 'fas fa-users' },
    { pathKey: 'datasetTagGroups', name: 'dataset_tag_groups.json', icon: 'fas fa-tags' },
    { pathKey: 'datasetTags', name: 'dataset_tags.json', icon: 'fas fa-tag' },
    { pathKey: 'datasetTagsFurry', name: 'dataset_tags_furry.json', icon: 'fas fa-paw' },
    { pathKey: 'naxGenerationConfig', name: 'nax_generation_config.json', icon: 'fas fa-flask' }
];

const APPLICATION_ENTRIES = [
    { id: 'naxt', name: 'Atelier', icon: 'fas fa-flask', openTarget: 'applet', appletId: 'naxt' },
    { id: 'chat', name: 'Chat', icon: 'fas fa-messages', openTarget: 'applet', appletId: 'chat' },
    { id: 'chat-persona', name: 'LinkXi', icon: 'fas fa-user-doctor-message', openTarget: 'applet', appletId: 'chat-persona' },
    { id: 'config-editor', name: 'Runes', icon: 'fas fa-binary', openTarget: 'applet', appletId: 'config-editor' },
    { id: 'dynamic-quips', name: 'Dynamic Quips', icon: 'fas fa-comment-heart', openTarget: 'applet', appletId: 'dynamic-quips' },
    { id: 'event-viewer', name: 'Periscope', icon: 'fas fa-wave-square', openTarget: 'applet', appletId: 'event-viewer', adminOnly: true },
    { id: 'expanders', name: 'Expanders', icon: 'fas fa-book-font', openTarget: 'applet', appletId: 'expanders' },
    { id: 'favorites', name: 'Favorites', icon: 'fas fa-star', openTarget: 'applet', appletId: 'favorites' },
    { id: 'explorer', name: 'Cartograph', icon: 'fas fa-folder-open', openTarget: 'applet', appletId: 'explorer' },
    { id: 'encyclopedia', name: 'Grimoire', icon: 'fas fa-book', openTarget: 'applet', appletId: 'encyclopedia' },
    { id: 'import', name: 'Import', icon: 'nai-import', openTarget: 'applet', appletId: 'import' },
    { id: 'keychain', name: 'Keychain', icon: 'fas fa-key-skeleton-left-right', openTarget: 'dsap', dsapUrl: 'dsap://security.dreamscape.jp/auth', adminOnly: true },
    { id: 'memories', name: 'Memories', icon: 'fas fa-box-open-full', openTarget: 'applet', appletId: 'memories' },
    { id: 'nax-vibes', name: 'NAX Vibes', icon: 'fas fa-globe', openTarget: 'dsap', dsapUrl: 'dsap://vibes.novelai.net' },
    { id: 'novels', name: 'Novels', icon: 'fas fa-book-open', openTarget: 'applet', appletId: 'novels' },
    { id: 'notebook', name: 'Notion', icon: 'fas fa-notebook', openTarget: 'applet', appletId: 'notebook' },
    { id: 'bracket-generation', name: 'Phasewalker', icon: 'fas fa-layer-group', openTarget: 'applet', appletId: 'bracket-generation' },
    { id: 'reference', name: 'Reference', icon: 'fas fa-swatchbook', openTarget: 'applet', appletId: 'reference' },
    { id: 'run', name: 'Run', icon: 'fas fa-magnifying-glass', openTarget: 'applet', appletId: 'run' },
    { id: 'security-center', name: 'Security Center', icon: 'fas fa-shield-halved', openTarget: 'applet', appletId: 'security-center', adminOnly: true },
    { id: 'data-management', name: 'Data Management', icon: 'fas fa-database', openTarget: 'applet', appletId: 'data-management' },
    { id: 'presets', name: 'Spellbook', icon: 'fas fa-book-spells', openTarget: 'applet', appletId: 'presets' },
    { id: 'spellbook', name: 'Spellcaster', icon: 'fas fa-hat-wizard', openTarget: 'applet', appletId: 'spellbook' },
    { id: 'studio', name: 'Studio', icon: 'fas fa-compass-drafting', openTarget: 'applet', appletId: 'studio' },
    { id: 'workspace', name: 'Workspace', icon: 'fas fa-film-canister', openTarget: 'applet', appletId: 'workspace' }
];

const LOG_SOURCE_FILES = {
    console: 'console.log',
    server: 'server.log',
    error: 'error.log',
    generation: 'generation-detailed.log',
    'runtime-minify': 'runtime-minify.log'
};

const CACHE_BLOCKED_DIRS = new Set(['sessions']);
const CACHE_SKIP_SUFFIXES = ['.db-shm', '.db-wal'];
const TEXT_READ_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_READ_MAX_BYTES = 8 * 1024 * 1024;
const BINARY_DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024;

const MIME_BY_EXT = {
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.md': 'text/markdown',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.db': 'application/x-sqlite3'
};

class VfsSystemProvider {
    constructor(globalResources) {
        this.globalResources = globalResources;
        this._cacheDirSizeCache = new Map();
        this._cacheDirSizeCacheTtlMs = 60000;
    }

    normalizeSegments(segments) {
        if (!segments || !segments.length) return [];
        return segments.map(s => (s || '').trim()).filter(Boolean);
    }

    systemNavPath(segments) {
        const parts = ['System', ...this.normalizeSegments(segments)];
        return '/' + parts.join('/');
    }

    makeFolder(name, folderId, navPath, icon = 'fas fa-folder') {
        return {
            id: folderId,
            name,
            kind: 'folder',
            targetKind: 'system-folder',
            targetId: folderId,
            navPath,
            icon,
            system: true,
            protected: true,
            importable: false,
            size: 0,
            modifiedAt: null
        };
    }

    makeFile(entry) {
        return {
            id: entry.id,
            name: entry.name,
            kind: 'file',
            targetKind: 'system-file',
            targetId: entry.id,
            mimeType: entry.mimeType || 'application/octet-stream',
            icon: entry.icon || 'fas fa-file',
            system: true,
            protected: true,
            importable: false,
            size: entry.size || 0,
            modifiedAt: entry.modifiedAt || null,
            openTarget: entry.openTarget || 'text',
            systemFileKey: entry.systemFileKey || entry.id,
            configId: entry.configId || null,
            logSource: entry.logSource || null,
            appletId: entry.appletId || null,
            dsapUrl: entry.dsapUrl || null,
            syntax: entry.syntax || null,
            adminOnly: !!entry.adminOnly,
            readOnly: entry.readOnly !== false
        };
    }

    async listDirectory(segmentsInput) {
        const segments = this.normalizeSegments(segmentsInput);
        if (!segments.length) {
            return SYSTEM_ROOT_FOLDERS.map(f => this.makeFolder(
                f.name,
                f.id,
                this.systemNavPath([f.segment]),
                f.icon
            ));
        }

        const [root, ...rest] = segments;
        switch (root) {
            case 'Cache':
                return this._listCache(rest);
            case 'Config':
                return this._listConfig(rest);
            case 'Logs':
                return this._listLogs(rest);
            case 'Databases':
                return this._listDatabases(rest);
            case 'Applications':
                return this._listApplications(rest);
            default:
                throw new Error(`Unknown system folder: ${root}`);
        }
    }

    _listConfig(segments) {
        if (segments.length > 0) {
            throw new Error('Cannot navigate into config entries');
        }
        const items = [];
        for (const cfg of CONFIG_EDITOR_ENTRIES) {
            items.push(this.makeFile({
                id: `sys-config-${cfg.id}`,
                name: cfg.name,
                icon: cfg.icon,
                openTarget: cfg.openTarget,
                configId: cfg.id,
                systemFileKey: `config:${cfg.id}`,
                syntax: 'json',
                size: 0,
                modifiedAt: null
            }));
        }
        for (const entry of ROOT_JSON_ENTRIES) {
            const fp = this._safePathKey(entry.pathKey);
            let size = 0;
            let mtime = null;
            if (fp && fs.existsSync(fp)) {
                const st = fs.statSync(fp);
                size = st.size;
                mtime = Math.floor(st.mtimeMs / 1000);
            }
            items.push(this.makeFile({
                id: `sys-json-${entry.pathKey}`,
                name: entry.name,
                icon: entry.icon,
                openTarget: 'text',
                systemFileKey: `rootjson:${entry.pathKey}`,
                syntax: 'json',
                mimeType: 'application/json',
                size,
                modifiedAt: mtime
            }));
        }
        return items;
    }

    _listApplications(segments) {
        if (segments.length > 0) {
            throw new Error('Cannot navigate into application shortcuts');
        }
        return APPLICATION_ENTRIES.map(app => this.makeFile({
            id: `sys-app-${app.id}`,
            name: app.name,
            icon: app.icon,
            openTarget: app.openTarget,
            appletId: app.appletId || null,
            dsapUrl: app.dsapUrl || null,
            systemFileKey: `app:${app.id}`,
            adminOnly: !!app.adminOnly,
            size: 0,
            modifiedAt: null
        }));
    }

    _listDatabases(segments) {
        if (segments.length > 0) {
            throw new Error('Cannot navigate into database files');
        }
        const cacheDir = this.globalResources.getPath('cache');
        let names = [];
        try {
            names = fs.readdirSync(cacheDir)
                .filter(n => n.endsWith('.db') && !n.endsWith('.db-shm') && !n.endsWith('.db-wal'))
                .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        } catch (_) { /* empty */ }

        return names.map(name => {
            let size = 0;
            let mtime = null;
            try {
                const st = fs.statSync(path.join(cacheDir, name));
                size = st.size;
                mtime = Math.floor(st.mtimeMs / 1000);
            } catch (_) { /* skip */ }
            return this.makeFile({
                id: `sys-db-${name}`,
                name,
                icon: 'fas fa-database',
                openTarget: 'info',
                systemFileKey: `db:${name}`,
                mimeType: 'application/x-sqlite3',
                syntax: 'sqlite',
                size,
                modifiedAt: mtime
            });
        });
    }

    _listLogs(segments) {
        if (segments.length > 0) {
            throw new Error('Cannot navigate into log file contents');
        }
        const logsDir = this.globalResources.getPath('logs');
        let names = [];
        try {
            names = fs.readdirSync(logsDir)
                .filter(n => fs.statSync(path.join(logsDir, n)).isFile())
                .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        } catch (_) { /* empty */ }

        return names.map(name => {
            const fp = path.join(logsDir, name);
            let size = 0;
            let mtime = null;
            try {
                const st = fs.statSync(fp);
                size = st.size;
                mtime = Math.floor(st.mtimeMs / 1000);
            } catch (_) { /* skip */ }

            const logMeta = this._resolveLogSource(name);
            return this.makeFile({
                id: `sys-log-${name}`,
                name,
                icon: 'fas fa-file-lines',
                openTarget: logMeta.openTarget,
                logSource: logMeta.logSource || null,
                systemFileKey: `log:${name}`,
                mimeType: 'text/plain',
                syntax: 'log',
                size,
                modifiedAt: mtime
            });
        });
    }

    _resolveLogSource(filename) {
        for (const [sourceId, mappedFile] of Object.entries(LOG_SOURCE_FILES)) {
            if (mappedFile === filename) {
                return { openTarget: 'applet', logSource: sourceId };
            }
        }
        const archivePrefix = 'generation-detailed-';
        const archiveSuffix = '.log';
        if (filename.startsWith(archivePrefix) && filename.endsWith(archiveSuffix)) {
            const key = filename.slice(archivePrefix.length, -archiveSuffix.length);
            return { openTarget: 'applet', logSource: `generation:${key}` };
        }
        return { openTarget: 'text', logSource: null };
    }

    _isCacheEntryVisible(name, isDirectory) {
        if (name.startsWith('.')) return false;
        if (CACHE_SKIP_SUFFIXES.some(s => name.endsWith(s))) return false;
        if (isDirectory && CACHE_BLOCKED_DIRS.has(name)) return false;
        return true;
    }

    _getCachedDirSizeBytes(absPath) {
        const cached = this._cacheDirSizeCache.get(absPath);
        if (cached && Date.now() - cached.at < this._cacheDirSizeCacheTtlMs) {
            return cached.bytes;
        }
        const bytes = this._sumDirSizeBytes(absPath);
        this._cacheDirSizeCache.set(absPath, { bytes, at: Date.now() });
        return bytes;
    }

    _sumDirSizeBytes(absPath) {
        let total = 0;
        let entries = [];
        try {
            entries = fs.readdirSync(absPath, { withFileTypes: true });
        } catch (_) {
            return 0;
        }
        for (const ent of entries) {
            const fp = path.join(absPath, ent.name);
            if (ent.isDirectory()) {
                if (!this._isCacheEntryVisible(ent.name, true)) continue;
                total += this._getCachedDirSizeBytes(fp);
            } else if (ent.isFile()) {
                if (!this._isCacheEntryVisible(ent.name, false)) continue;
                try {
                    total += fs.statSync(fp).size;
                } catch (_) { /* skip */ }
            }
        }
        return total;
    }

    _countVisibleCacheEntries(abs) {
        let itemCount = 0;
        let totalSizeBytes = 0;
        let entries = [];
        try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch (_) {
            return { itemCount: 0, totalSizeBytes: 0 };
        }

        for (const ent of entries) {
            if (!this._isCacheEntryVisible(ent.name, ent.isDirectory())) continue;
            itemCount++;
            const fp = path.join(abs, ent.name);
            if (ent.isFile()) {
                try {
                    totalSizeBytes += fs.statSync(fp).size;
                } catch (_) { /* skip */ }
            } else if (ent.isDirectory()) {
                totalSizeBytes += this._getCachedDirSizeBytes(fp);
            }
        }
        return { itemCount, totalSizeBytes };
    }

    getPathStats(segmentsInput) {
        const segments = this.normalizeSegments(segmentsInput);
        if (!segments.length) {
            return {
                itemCount: SYSTEM_ROOT_FOLDERS.length,
                totalSizeBytes: this._sumSystemRootSizeBytes()
            };
        }

        const [root, ...rest] = segments;
        switch (root) {
            case 'Cache':
                return this._getCachePathStats(rest);
            case 'Config':
                return this._getConfigPathStats(rest);
            case 'Logs':
                return this._getLogsPathStats(rest);
            case 'Databases':
                return this._getDatabasesPathStats(rest);
            case 'Applications':
                return this._getApplicationsPathStats(rest);
            default:
                return { itemCount: 0, totalSizeBytes: 0 };
        }
    }

    _getCachePathStats(relativeSegments) {
        const rel = relativeSegments.join('/');
        const abs = this._resolveCachePath(rel);
        if (!abs) return { itemCount: 0, totalSizeBytes: 0 };
        return this._countVisibleCacheEntries(abs);
    }

    _getConfigPathStats(segments) {
        if (segments.length > 0) return { itemCount: 0, totalSizeBytes: 0 };
        let totalSizeBytes = 0;
        for (const entry of ROOT_JSON_ENTRIES) {
            const fp = this._safePathKey(entry.pathKey);
            if (fp && fs.existsSync(fp)) {
                try {
                    totalSizeBytes += fs.statSync(fp).size;
                } catch (_) { /* skip */ }
            }
        }
        return {
            itemCount: CONFIG_EDITOR_ENTRIES.length + ROOT_JSON_ENTRIES.length,
            totalSizeBytes
        };
    }

    _getApplicationsPathStats(segments) {
        if (segments.length > 0) return { itemCount: 0, totalSizeBytes: 0 };
        return { itemCount: APPLICATION_ENTRIES.length, totalSizeBytes: 0 };
    }

    _getDatabasesPathStats(segments) {
        if (segments.length > 0) return { itemCount: 0, totalSizeBytes: 0 };
        const cacheDir = this.globalResources.getPath('cache');
        let itemCount = 0;
        let totalSizeBytes = 0;
        try {
            const names = fs.readdirSync(cacheDir)
                .filter(n => n.endsWith('.db') && !n.endsWith('.db-shm') && !n.endsWith('.db-wal'));
            itemCount = names.length;
            for (const name of names) {
                try {
                    totalSizeBytes += fs.statSync(path.join(cacheDir, name)).size;
                } catch (_) { /* skip */ }
            }
        } catch (_) { /* empty */ }
        return { itemCount, totalSizeBytes };
    }

    _getLogsPathStats(segments) {
        if (segments.length > 0) return { itemCount: 0, totalSizeBytes: 0 };
        const logsDir = this.globalResources.getPath('logs');
        let itemCount = 0;
        let totalSizeBytes = 0;
        try {
            const names = fs.readdirSync(logsDir);
            for (const name of names) {
                const fp = path.join(logsDir, name);
                try {
                    const st = fs.statSync(fp);
                    if (!st.isFile()) continue;
                    itemCount++;
                    totalSizeBytes += st.size;
                } catch (_) { /* skip */ }
            }
        } catch (_) { /* empty */ }
        return { itemCount, totalSizeBytes };
    }

    _sumSystemRootSizeBytes() {
        return this._getConfigPathStats([]).totalSizeBytes
            + this._getLogsPathStats([]).totalSizeBytes
            + this._getDatabasesPathStats([]).totalSizeBytes
            + this._getCachePathStats([]).totalSizeBytes;
    }

    _listCache(relativeSegments) {
        const cacheDir = this.globalResources.getPath('cache');
        const rel = relativeSegments.join('/');
        const abs = this._resolveCachePath(rel);
        if (!abs) {
            throw new Error('Access denied');
        }

        let entries = [];
        try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch (err) {
            throw new Error(`Cache path not found: ${rel || '/'}`);
        }

        const items = [];
        for (const ent of entries) {
            const name = ent.name;
            if (!this._isCacheEntryVisible(name, ent.isDirectory())) continue;

            const childRel = rel ? `${rel}/${name}` : name;
            const childNav = this.systemNavPath(['Cache', ...relativeSegments, name]);

            if (ent.isDirectory()) {
                const dirSize = this._getCachedDirSizeBytes(path.join(abs, name));
                items.push({
                    ...this.makeFolder(name, `sys-cache-dir-${childRel}`, childNav, 'fas fa-folder'),
                    size: dirSize,
                    sizeBytes: dirSize,
                    typeLabel: 'System Folder'
                });
                continue;
            }

            if (!ent.isFile()) continue;
            const fp = path.join(abs, name);
            let size = 0;
            let mtime = null;
            try {
                const st = fs.statSync(fp);
                size = st.size;
                mtime = Math.floor(st.mtimeMs / 1000);
            } catch (_) { /* skip */ }

            const ext = path.extname(name).toLowerCase();
            const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
            const isImage = mimeType.startsWith('image/');
            const isText = mimeType.startsWith('text/') || ext === '.json' || ext === '.log';

            items.push({
                ...this.makeFile({
                id: `sys-cache-file-${childRel}`,
                name,
                icon: isImage ? 'fas fa-file-image' : (ext === '.json' ? 'fas fa-file-code' : 'fas fa-file'),
                openTarget: isImage ? 'viewer' : (isText ? 'text' : 'download'),
                systemFileKey: `cache:${childRel}`,
                mimeType,
                syntax: ext === '.json' ? 'json' : (ext === '.log' ? 'log' : (isText ? 'text' : null)),
                size,
                modifiedAt: mtime
            }),
                sizeBytes: size,
                typeLabel: 'System File'
            });
        }

        return items;
    }

    _resolveCachePath(relativePath) {
        const cacheDir = path.resolve(this.globalResources.getPath('cache'));
        const normalized = (relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (normalized.split('/').some(part => part === '..' || part === '.')) {
            return null;
        }
        if (normalized.split('/').some(part => CACHE_BLOCKED_DIRS.has(part))) {
            return null;
        }
        const abs = normalized ? path.resolve(cacheDir, normalized) : cacheDir;
        if (!abs.startsWith(cacheDir + path.sep) && abs !== cacheDir) {
            return null;
        }
        return abs;
    }

    _safePathKey(key) {
        try {
            return this.globalResources.getPath(key);
        } catch (_) {
            return null;
        }
    }

    encodeSystemFileKey(systemFileKey) {
        return Buffer.from(String(systemFileKey), 'utf8').toString('base64url');
    }

    decodeSystemFileKey(encoded) {
        if (!encoded || typeof encoded !== 'string') return null;
        try {
            return Buffer.from(encoded, 'base64url').toString('utf8');
        } catch (_) {
            return null;
        }
    }

    resolveDownloadableFile(systemFileKey) {
        const parsed = this._parseSystemFileKey(systemFileKey);
        if (!parsed || parsed.kind !== 'cache') {
            throw new Error('Only cache files can be downloaded');
        }

        const abs = this._resolveCachePath(parsed.relativePath);
        if (!abs || !fs.existsSync(abs)) {
            throw new Error('File not found');
        }

        const st = fs.statSync(abs);
        if (!st.isFile()) {
            throw new Error('Not a file');
        }
        if (st.size > BINARY_DOWNLOAD_MAX_BYTES) {
            throw new Error(
                `File too large to download (${this._formatBytes(st.size)}). Maximum is ${this._formatBytes(BINARY_DOWNLOAD_MAX_BYTES)}.`
            );
        }

        const ext = path.extname(abs).toLowerCase();
        const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
        const isImage = mimeType.startsWith('image/');
        const isText = mimeType.startsWith('text/') || ext === '.json' || ext === '.log';
        if (isImage || isText) {
            throw new Error('Text and image cache files should be opened in preview');
        }

        return {
            absPath: abs,
            name: path.basename(abs),
            mimeType,
            size: st.size,
            readOnly: true
        };
    }

    async readFile(systemFileKey, options = {}) {
        const { clientInfo } = options;
        const parsed = this._parseSystemFileKey(systemFileKey);
        if (!parsed) {
            throw new Error('Invalid system file key');
        }

        switch (parsed.kind) {
            case 'config':
                throw new Error('Config entries open in Runes');
            case 'app':
                throw new Error('Application shortcuts are not readable files');
            case 'db':
                return this._readDatabaseInfo(parsed.name);
            case 'log':
                return this._readLogFile(parsed.name, clientInfo);
            case 'rootjson':
                return this._readRootJson(parsed.pathKey);
            case 'cache':
                return this._readCacheFile(parsed.relativePath);
            default:
                throw new Error('Unsupported system file key');
        }
    }

    _parseSystemFileKey(key) {
        if (!key || typeof key !== 'string') return null;
        const idx = key.indexOf(':');
        if (idx <= 0) return null;
        const kind = key.slice(0, idx);
        const rest = key.slice(idx + 1);
        if (!rest) return null;
        switch (kind) {
            case 'config':
                return { kind, configId: rest };
            case 'app':
                return { kind, appId: rest };
            case 'db':
                return { kind, name: rest };
            case 'log':
                return { kind, name: rest };
            case 'rootjson':
                return { kind, pathKey: rest };
            case 'cache':
                return { kind, relativePath: rest };
            default:
                return null;
        }
    }

    _readRootJson(pathKey) {
        const fp = this._safePathKey(pathKey);
        if (!fp || !fs.existsSync(fp)) {
            throw new Error('File not found');
        }
        const st = fs.statSync(fp);
        if (st.size > TEXT_READ_MAX_BYTES) {
            throw new Error(`File too large to preview (${this._formatBytes(st.size)})`);
        }
        const text = fs.readFileSync(fp, 'utf8');
        return {
            kind: 'text',
            name: path.basename(fp),
            mimeType: 'application/json',
            syntax: 'json',
            content: text,
            size: st.size,
            readOnly: true
        };
    }

    _readLogFile(filename, clientInfo) {
        const logsDir = this.globalResources.getPath('logs');
        const abs = path.resolve(logsDir, filename);
        if (!abs.startsWith(path.resolve(logsDir) + path.sep)) {
            throw new Error('Access denied');
        }
        if (!fs.existsSync(abs)) {
            throw new Error('Log file not found');
        }
        const st = fs.statSync(abs);
        if (st.size > TEXT_READ_MAX_BYTES) {
            throw new Error(`Log too large to preview (${this._formatBytes(st.size)}). Open in Periscope.`);
        }
        const text = fs.readFileSync(abs, 'utf8');
        return {
            kind: 'text',
            name: filename,
            mimeType: 'text/plain',
            syntax: 'log',
            content: text,
            size: st.size,
            readOnly: true
        };
    }

    _readCacheFile(relativePath) {
        const abs = this._resolveCachePath(relativePath);
        if (!abs || !fs.existsSync(abs)) {
            throw new Error('File not found');
        }
        const st = fs.statSync(abs);
        const ext = path.extname(abs).toLowerCase();
        const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';

        if (mimeType.startsWith('image/')) {
            if (st.size > IMAGE_READ_MAX_BYTES) {
                throw new Error(`Image too large to preview (${this._formatBytes(st.size)})`);
            }
            const buffer = fs.readFileSync(abs);
            return {
                kind: 'image',
                name: path.basename(abs),
                mimeType,
                base64: buffer.toString('base64'),
                size: st.size,
                readOnly: true
            };
        }

        const isText = mimeType.startsWith('text/') || ext === '.json' || ext === '.log';
        if (!isText) {
            throw new Error('Binary cache files cannot be previewed');
        }
        if (st.size > TEXT_READ_MAX_BYTES) {
            throw new Error(`File too large to preview (${this._formatBytes(st.size)})`);
        }
        const text = fs.readFileSync(abs, 'utf8');
        return {
            kind: 'text',
            name: path.basename(abs),
            mimeType,
            syntax: ext === '.json' ? 'json' : (ext === '.log' ? 'log' : 'text'),
            content: text,
            size: st.size,
            readOnly: true
        };
    }

    _readDatabaseInfo(name) {
        if (!name.endsWith('.db') || name.includes('/') || name.includes('..')) {
            throw new Error('Invalid database name');
        }
        const fp = path.join(this.globalResources.getPath('cache'), name);
        if (!fs.existsSync(fp)) {
            throw new Error('Database not found');
        }
        const st = fs.statSync(fp);
        return {
            kind: 'info',
            name,
            mimeType: 'application/x-sqlite3',
            size: st.size,
            modifiedAt: Math.floor(st.mtimeMs / 1000),
            message: `${name} is a SQLite database (${this._formatBytes(st.size)}). Direct editing is not available from Cartograph.`,
            readOnly: true
        };
    }

    _formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
}

function getSystemSegmentDisplayLabel(segment) {
    const root = SYSTEM_ROOT_FOLDERS.find(f => f.segment === segment);
    return root ? root.name : segment;
}

function resolveSystemSegmentInput(label) {
    const needle = (label || '').trim();
    if (!needle) return null;
    const root = SYSTEM_ROOT_FOLDERS.find(f =>
        f.segment.toLowerCase() === needle.toLowerCase()
        || f.name.toLowerCase() === needle.toLowerCase()
    );
    return root ? root.segment : needle;
}

module.exports = {
    VfsSystemProvider,
    SYSTEM_ROOT_FOLDERS,
    getSystemSegmentDisplayLabel,
    resolveSystemSegmentInput,
    BINARY_DOWNLOAD_MAX_BYTES
};
