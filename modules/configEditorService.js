/**
 * Config Editor — lazy JSON tree + sparse map overlays (WebSocket only).
 * Maps live in config-maps/; they type/label paths, not define full config shape.
 */

const fs = require('fs');
const path = require('path');
const NaxTagGenerationService = require('./naxTagGeneration');
const SECRET_MASK = '••••••••';

const CONFIG_GETTERS = {
    config: (gr) => gr.getConfig({ clone: true }),
    secureConfig: (gr) => gr.getSecureConfig({ clone: true }),
    promptConfig: (gr) => gr.getPromptConfig({ clone: true }),
    directorConfig: (gr) => gr.getDirectorConfig({ clone: true }),
    favorites: (gr) => gr.getFavorites({ clone: true }),
    workspaces: (gr) => gr.getWorkspacesConfig({ clone: true }),
    workspaceDesktop: (gr) => gr.getWorkspaceDesktopConfig({ clone: true })
};

class ConfigEditorService {
    constructor(globalResources) {
        if (!globalResources) {
            throw new Error('ConfigEditorService requires globalResources');
        }
        this.globalResources = globalResources;
        this._mapsDir = globalResources.getPath('configMaps');
        this._indexCache = null;
        this._mapCache = new Map();
    }

    get mapsDir() {
        return this._mapsDir;
    }

    listConfigs() {
        const index = this._loadIndex();
        return index.configs.map((entry) => ({
            id: entry.id,
            label: entry.label,
            configType: entry.configType
        }));
    }

    getNode(configId, pathInput = []) {
        const path = this._normalizePath(pathInput);
        const entry = this._getIndexEntry(configId);
        const data = this._loadConfigData(configId);
        const map = this._loadMap(configId);
        const value = this._getAtPath(data, path);

        if (value === undefined && path.length > 0) {
            throw new Error(`Path not found: ${path.join('.')}`);
        }

        const nodeRule = this.resolveMapRule(configId, path);
        const nodeMeta = this._nodeMeta(value, nodeRule, map?.label || entry.label);

        const children = [];
        if (nodeMeta.expandable && value !== null && value !== undefined) {
            const childKeys = this._childKeys(value);
            for (const key of childKeys) {
                const childPath = [...path, key];
                const childVal = value[key];
                const childRule = this.resolveMapRule(configId, childPath);
                const childMeta = this._nodeMeta(childVal, childRule, key);
                const isSecret = this._isSecretPath(childPath, childRule);
                const stub = {
                    key: String(key),
                    path: childPath,
                    type: childMeta.type,
                    label: childMeta.label,
                    expandable: childMeta.expandable,
                    restartRequired: !!childRule?.restartRequired,
                    secret: isSecret,
                    mapped: !!childRule
                };
                if (!childMeta.expandable) {
                    stub.value = this._formatValueForClient(childVal, childRule, isSecret);
                }
                children.push(stub);
            }
        }

        return {
            configId,
            path,
            node: nodeMeta,
            children
        };
    }

    applyPatches(patchesByConfig) {
        const errors = [];
        let needsRestart = false;

        for (const [configId, patches] of Object.entries(patchesByConfig || {})) {
            if (!Array.isArray(patches) || !patches.length) continue;

            try {
                const entry = this._getIndexEntry(configId);
                const data = this._loadConfigData(configId);

                for (const patch of patches) {
                    const p = this._normalizePath(patch.path);
                    if (!p.length) {
                        errors.push({ configId, path: [], message: 'Cannot patch config root' });
                        continue;
                    }

                    const rule = this.resolveMapRule(configId, p);
                    if (rule?.restartRequired) needsRestart = true;

                    if (patch.deleted) {
                        this._deleteAtPath(data, p);
                    } else {
                        let val = patch.value;
                        if (rule?.secret || this._isSecretPath(p, rule)) {
                            if (val === SECRET_MASK) continue;
                        }
                        if (rule) {
                            val = this._coerceValue(val, rule);
                        }
                        this._setAtPath(data, p, val);
                    }
                }

                this._saveConfigData(entry.configType, configId, data);
            } catch (err) {
                errors.push({
                    configId,
                    message: err.message || String(err)
                });
            }
        }

        if (errors.length) {
            return { success: false, errors, needsRestart: false, restarting: false };
        }

        this.globalResources.flushAllPendingConfigSaves();

        if (needsRestart) {
            setImmediate(() => {
                try {
                    process.kill(process.pid, 'SIGTERM');
                } catch (e) {
                    console.error('Config editor restart signal failed:', e);
                }
            });
        }

        return {
            success: true,
            errors: [],
            needsRestart,
            restarting: needsRestart
        };
    }

    resolveMapRule(configId, pathInput) {
        const path = this._normalizePath(pathInput);
        const map = this._loadMap(configId);
        if (!map?.rules?.length) return null;

        let best = null;
        let bestScore = -1;

        for (const rule of map.rules) {
            const score = this._matchRuleScore(rule.path, path);
            if (score > bestScore) {
                bestScore = score;
                best = rule;
            }
        }

        return bestScore >= 0 ? best : null;
    }

    _matchRuleScore(rulePath, actualPath) {
        if (!rulePath?.length || rulePath.length !== actualPath.length) return -1;
        let score = 0;
        for (let i = 0; i < rulePath.length; i++) {
            const r = rulePath[i];
            const a = actualPath[i];
            if (r === '*') {
                score += 1;
            } else if (r === a) {
                score += 2;
            } else {
                return -1;
            }
        }
        return score;
    }

    _nodeMeta(value, rule, fallbackLabel) {
        const inferred = this._inferType(value);
        let type = rule?.type && rule.type !== 'auto' ? rule.type : inferred;
        if (rule?.type === 'auto') type = inferred;

        const expandable = type === 'object' || type === 'array';
        const isEmptyContainer = expandable
            && ((Array.isArray(value) && value.length === 0)
                || (value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length));

        return {
            type,
            label: rule?.label || fallbackLabel || '(root)',
            expandable,
            restartRequired: !!rule?.restartRequired,
            secret: !!rule?.secret,
            enum: rule?.enum || null,
            description: rule?.description || null,
            isEmpty: !!isEmptyContainer
        };
    }

    _inferType(value) {
        if (value === null || value === undefined) return 'string';
        if (Array.isArray(value)) return 'array';
        if (typeof value === 'object') return 'object';
        if (typeof value === 'boolean') return 'boolean';
        if (typeof value === 'number') return 'number';
        return 'string';
    }

    _isSecretPath(path, rule) {
        if (rule?.secret) return true;
        const key = path?.length ? path[path.length - 1] : '';
        if (!key) return false;
        return /^(apiKey|api_key|password|secret|token|sessionSecret|loginKey|loginPin|devLoginKey|readOnlyPin)$/i.test(String(key));
    }

    _formatValueForClient(value, rule, isSecret) {
        const secret = isSecret ?? this._isSecretPath([], rule);
        if (secret && typeof value === 'string' && value.length) {
            return SECRET_MASK;
        }
        return value;
    }

    _coerceValue(value, rule) {
        if (rule.enum?.length && !rule.enum.includes(value)) {
            throw new Error(`Value must be one of: ${rule.enum.join(', ')}`);
        }
        switch (rule.type) {
            case 'number': {
                const n = Number(value);
                if (Number.isNaN(n)) throw new Error('Expected number');
                return n;
            }
            case 'boolean':
                if (typeof value === 'boolean') return value;
                if (value === 'true' || value === true || value === 1 || value === '1') return true;
                if (value === 'false' || value === false || value === 0 || value === '0') return false;
                throw new Error('Expected boolean');
            case 'string':
                return value == null ? '' : String(value);
            default:
                return value;
        }
    }

    _childKeys(value) {
        if (Array.isArray(value)) {
            return value.map((_, i) => String(i));
        }
        if (value && typeof value === 'object') {
            return Object.keys(value).sort();
        }
        return [];
    }

    _loadConfigData(configId) {
        const entry = this._getIndexEntry(configId);
        if (entry.configType === 'naxGeneration') {
            const svc = this.globalResources.getNaxTagGeneration?.();
            if (svc) {
                svc.configCache = null;
                return JSON.parse(JSON.stringify(svc.loadConfig()));
            }
            const configPath = this.globalResources.getPath('naxGenerationConfig');
            if (!fs.existsSync(configPath)) {
                return { galleries: {} };
            }
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
        const getter = CONFIG_GETTERS[entry.configType];
        if (!getter) {
            throw new Error(`No loader for config type: ${entry.configType}`);
        }
        return getter(this.globalResources);
    }

    _saveConfigData(configType, configId, data) {
        if (configType === 'naxGeneration') {
            if (!data.galleries || typeof data.galleries !== 'object') {
                throw new Error('nax_generation_config.json: missing galleries object');
            }
            fs.writeFileSync(
                this.globalResources.getPath('naxGenerationConfig'),
                JSON.stringify(data, null, 2) + '\n',
                'utf8'
            );
            const svc = this.globalResources.getNaxTagGeneration?.();
            if (svc) svc.configCache = null;
            return;
        }
        const cm = this.globalResources.configManager;
        if (!cm) throw new Error('ConfigManager not available');
        cm.saveConfig(configType, data, { skipCheckpoint: false });
    }

    _loadIndex() {
        if (this._indexCache) return this._indexCache;
        const indexPath = path.join(this._mapsDir, 'index.json');
        this._indexCache = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        return this._indexCache;
    }

    _getIndexEntry(configId) {
        const index = this._loadIndex();
        const entry = index.configs.find((c) => c.id === configId);
        if (!entry) throw new Error(`Unknown config id: ${configId}`);
        return entry;
    }

    _loadMap(configId) {
        if (this._mapCache.has(configId)) return this._mapCache.get(configId);
        const entry = this._getIndexEntry(configId);
        const mapPath = path.join(this._mapsDir, entry.mapFile);
        if (!fs.existsSync(mapPath)) {
            this._mapCache.set(configId, { configId, label: entry.label, rules: [] });
            return this._mapCache.get(configId);
        }
        const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        this._mapCache.set(configId, map);
        return map;
    }

    _normalizePath(pathInput) {
        if (!pathInput) return [];
        if (Array.isArray(pathInput)) return pathInput.map((s) => String(s));
        if (typeof pathInput === 'string') return pathInput.split('.').filter(Boolean);
        return [];
    }

    _getAtPath(obj, path) {
        if (!path.length) return obj;
        let cur = obj;
        for (const key of path) {
            if (cur == null) return undefined;
            cur = cur[key];
        }
        return cur;
    }

    _setAtPath(obj, path, value) {
        const cm = this.globalResources.configManager;
        if (cm?._setValueByPath) {
            cm._setValueByPath(obj, path, value);
            return;
        }
        let cur = obj;
        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (!(key in cur) || typeof cur[key] !== 'object' || cur[key] === null) {
                cur[key] = {};
            }
            cur = cur[key];
        }
        cur[path[path.length - 1]] = value;
    }

    _deleteAtPath(obj, path) {
        if (!path.length) return;
        let cur = obj;
        for (let i = 0; i < path.length - 1; i++) {
            if (cur == null) return;
            cur = cur[path[i]];
        }
        if (cur && typeof cur === 'object') {
            delete cur[path[path.length - 1]];
        }
    }
}

ConfigEditorService.SECRET_MASK = SECRET_MASK;

module.exports = ConfigEditorService;
