/**
 * Runes — lazy JSON tree + sparse map overlays (WebSocket only).
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
        this._mapSearchIndex = new Map();
    }

    get mapsDir() {
        return this._mapsDir;
    }

    listConfigs() {
        const index = this._loadIndex();
        return index.configs.map((entry) => ({
            id: entry.id,
            label: entry.label,
            configType: entry.configType,
            icon: entry.icon || null
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
        const nodeMeta = this._nodeMeta(value, nodeRule, map?.label || entry.label, path);
        const childItemRule = this._findWildcardChildRule(configId, path);
        if (childItemRule) {
            nodeMeta.childDisplay = this._childDisplayMeta(childItemRule);
        }
        nodeMeta.addMeta = this._getAddMeta(configId, path, nodeRule, value, childItemRule);

        const children = [];
        if (nodeMeta.expandable && value !== null && value !== undefined) {
            const childKeys = this._childKeys(value);
            for (const key of childKeys) {
                const childPath = [...path, key];
                const childVal = value[key];
                const childRule = this.resolveMapRule(configId, childPath);
                const childMeta = this._nodeMeta(childVal, childRule, key, childPath);
                const displayLabel = this._resolveChildLabel(childVal, childRule, childItemRule, key);
                const icon = (childRule?.iconField || childItemRule?.iconField) && childVal && typeof childVal === 'object'
                    ? (childVal[(childRule?.iconField || childItemRule?.iconField)] || null)
                    : null;
                const isSecret = this._isSecretPath(childPath, childRule);
                const isReadOnly = this._resolveReadOnly(childRule, childPath);
                const isRequired = this._resolveRequired(childRule, childPath);
                const stub = {
                    key: String(key),
                    path: childPath,
                    type: childMeta.type,
                    label: displayLabel,
                    icon,
                    types: childMeta.types,
                    expandable: childMeta.expandable,
                    hasExpandableChildren: childMeta.expandable
                        ? this._hasExpandableChildren(childVal, configId, childPath)
                        : false,
                    restartRequired: !!childRule?.restartRequired,
                    secret: isSecret,
                    mapped: !!childRule,
                    description: childRule?.description || childMeta.description || null,
                    required: isRequired,
                    readOnly: isReadOnly,
                    editorType: childRule?.editorType || null
                };
                const resolvedEditMode = this._resolveEditMode(childRule, childMeta, isSecret, isReadOnly);
                if (resolvedEditMode) stub.editMode = resolvedEditMode;
                if (childRule?.enum?.length) {
                    stub.enum = childRule.enum.slice();
                    if (childRule.enumAllowCustom) stub.enumAllowCustom = true;
                }
                if (childMeta.types) stub.types = childMeta.types;
                if (!childMeta.expandable) {
                    stub.value = this._formatValueForClient(childVal, childRule, isSecret);
                }
                children.push(stub);
            }
        }

        if (nodeMeta.expandable && value !== null && value !== undefined) {
            nodeMeta.hasExpandableChildren = this._hasExpandableChildren(value, configId, path);
        } else {
            nodeMeta.hasExpandableChildren = false;
        }

        const nodeIsSecret = path.length > 0 && this._isSecretPath(path, nodeRule);
        let nodeValue;
        if (value !== undefined) {
            nodeValue = nodeIsSecret ? SECRET_MASK : JSON.parse(JSON.stringify(value));
        }

        return {
            configId,
            path,
            node: nodeMeta,
            children,
            nodeValue
        };
    }

    revealSecretValue(configId, pathInput = []) {
        const path = this._normalizePath(pathInput);
        if (!path.length) {
            throw new Error('Path required');
        }
        const data = this._loadConfigData(configId);
        const value = this._getAtPath(data, path);
        if (value === undefined) {
            throw new Error(`Path not found: ${path.join('.')}`);
        }
        const rule = this.resolveMapRule(configId, path);
        if (!this._isSecretPath(path, rule)) {
            throw new Error('Path is not a secret value');
        }
        if (typeof value !== 'string') {
            return { value: value == null ? '' : String(value) };
        }
        return { value };
    }

    applyPatches(patchesByConfig, options = {}) {
        const errors = [];
        let needsRestart = false;
        const checkpointByConfig = options.createCheckpoint && typeof options.createCheckpoint === 'object'
            ? options.createCheckpoint
            : {};
        const partialScope = options.partialScope && typeof options.partialScope === 'object'
            ? options.partialScope
            : null;

        for (const [configId, patches] of Object.entries(patchesByConfig || {})) {
            if (!Array.isArray(patches) || !patches.length) continue;

            if (partialScope?.configId === configId && Array.isArray(partialScope.path)) {
                for (const patch of patches) {
                    if (!this._pathUnderScope(patch.path, partialScope.path)) {
                        errors.push({
                            configId,
                            path: patch.path || [],
                            message: `Patch outside partial scope: ${(patch.path || []).join('.')}`
                        });
                    }
                }
            }

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
                        if (!this._canDeletePath(configId, p)) {
                            errors.push({
                                configId,
                                path: p,
                                message: this._deleteDeniedReason(this.resolveMapRule(configId, p), p)
                            });
                            continue;
                        }
                        this._deleteAtPath(data, p);
                    } else {
                        if (this._resolveReadOnly(rule, p)) {
                            errors.push({
                                configId,
                                path: p,
                                message: rule?.readOnlyReason || 'Read-only entry cannot be modified'
                            });
                            continue;
                        }
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

                this._saveConfigData(entry.configType, configId, data, {
                    skipCheckpoint: checkpointByConfig[configId] === false
                });
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

    search(queryInput, options = {}) {
        const query = String(queryInput || '').trim();
        const maxResults = Math.min(Math.max(1, Number(options.maxResults) || 50), 200);
        if (!query) {
            return { query: '', results: [], truncated: false };
        }

        const configId = options.configId || null;
        if (configId) {
            const one = this._searchConfig(configId, query, maxResults);
            return {
                query,
                results: one.results,
                truncated: one.truncated
            };
        }

        const merged = [];
        let truncated = false;
        for (const cfg of this.listConfigs()) {
            const part = this._searchConfig(cfg.id, query, maxResults);
            merged.push(...part.results);
            if (part.truncated) truncated = true;
        }
        merged.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
        const results = merged.slice(0, maxResults);
        return {
            query,
            results,
            truncated: truncated || merged.length > maxResults
        };
    }

    _buildMapSearchIndex(configId) {
        if (this._mapSearchIndex.has(configId)) {
            return this._mapSearchIndex.get(configId);
        }
        const map = this._loadMap(configId);
        const byPathKey = new Map();
        for (const rule of map?.rules || []) {
            if (!rule.path?.length) continue;
            byPathKey.set(rule.path.join('\0'), {
                label: rule.label || null,
                description: rule.description || null,
                enum: rule.enum?.length ? rule.enum.slice() : null,
                type: rule.type || null
            });
        }
        const index = { byPathKey, rules: map?.rules || [] };
        this._mapSearchIndex.set(configId, index);
        return index;
    }

    _searchConfig(configId, query, maxResults) {
        this._getIndexEntry(configId);
        this._buildMapSearchIndex(configId);
        const data = this._loadConfigData(configId);
        const qLower = query.toLowerCase();
        const minValueQueryLen = 3;
        const collectLimit = maxResults * 4;
        const results = [];
        const breadcrumbCache = new Map();
        const entry = this._getIndexEntry(configId);

        const getBreadcrumb = (path) => {
            const cacheKey = path.join('\0');
            if (breadcrumbCache.has(cacheKey)) return breadcrumbCache.get(cacheKey);
            const crumbs = [entry.label];
            let cur = data;
            for (let i = 0; i < path.length; i++) {
                const partial = path.slice(0, i + 1);
                const seg = path[i];
                const rule = this.resolveMapRule(configId, partial);
                const parentPath = path.slice(0, i);
                const childRule = i > 0 ? this._findWildcardChildRule(configId, parentPath) : null;
                const labelRule = rule?.displayTemplate ? rule : childRule;
                let label = seg;
                if (labelRule?.displayTemplate && cur && typeof cur === 'object') {
                    const childVal = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
                    label = this._formatDisplayLabel(childVal, labelRule, seg);
                } else if (rule?.label && !childRule) {
                    label = rule.label;
                }
                crumbs.push(String(label));
                if (cur != null && typeof cur === 'object') {
                    cur = cur[seg];
                }
            }
            breadcrumbCache.set(cacheKey, crumbs);
            return crumbs;
        };

        const scoreText = (text, exactScore, containsScore) => {
            if (text == null || text === '') return null;
            const t = String(text).toLowerCase();
            if (t === qLower) return { score: exactScore, exact: true };
            if (t.includes(qLower)) return { score: containsScore, exact: false };
            return null;
        };

        const considerNode = (path, value, keyLabel) => {
            if (results.length >= collectLimit) return;

            const rule = path.length ? this.resolveMapRule(configId, path) : null;
            const parentPath = path.length > 1 ? path.slice(0, -1) : [];
            const wildChildRule = parentPath.length
                ? this._findWildcardChildRule(configId, parentPath)
                : null;
            const meta = this._nodeMeta(
                value,
                rule,
                keyLabel || (path.length ? path[path.length - 1] : entry.label),
                path
            );
            const displayLabel = wildChildRule && !wildChildRule.displayTemplate && !rule?.displayTemplate
                ? String(path[path.length - 1])
                : meta.label;
            const isSecret = this._isSecretPath(path, rule);
            let bestScore = 0;
            let matchReason = null;
            let valuePreview = null;

            const applyMatch = (text, exactScore, containsScore, reason) => {
                const hit = scoreText(text, exactScore, containsScore);
                if (!hit || hit.score <= bestScore) return;
                bestScore = hit.score;
                matchReason = reason;
            };

            applyMatch(displayLabel, 100, 80, 'label');
            if (rule?.description) applyMatch(rule.description, 70, 60, 'description');
            if (rule?.enum?.length) {
                for (const ev of rule.enum) {
                    const hit = scoreText(ev, 55, 50, 'enum');
                    if (hit && hit.score > bestScore) {
                        bestScore = hit.score;
                        matchReason = 'enum';
                    }
                }
            }
            if (path.length) {
                applyMatch(String(path[path.length - 1]), 45, 40, 'path');
            }
            for (const seg of path) {
                const hit = scoreText(seg, 40, 35, 'path');
                if (hit && hit.score > bestScore) {
                    bestScore = hit.score;
                    matchReason = 'path';
                }
            }

            if (!isSecret && !meta.expandable && qLower.length >= minValueQueryLen) {
                const isTextReplacementValue = path.length === 2 && path[0] === 'text_replacements';
                if (!isTextReplacementValue) {
                    if (typeof value === 'string' && value.length <= 500) {
                        const hit = scoreText(value, 30, 20, 'value');
                        if (hit && hit.score > bestScore) {
                            bestScore = hit.score;
                            matchReason = 'value';
                            if (value.length <= 120) valuePreview = value;
                        }
                    } else if (typeof value === 'number' || typeof value === 'boolean') {
                        const hit = scoreText(String(value), 30, 25, 'value');
                        if (hit && hit.score > bestScore) {
                            bestScore = hit.score;
                            matchReason = 'value';
                            valuePreview = String(value);
                        }
                    }
                }
            }

            if (bestScore <= 0) return;

            results.push({
                configId,
                path: path.slice(),
                label: displayLabel,
                description: rule?.description || meta.description || null,
                type: meta.type,
                breadcrumb: getBreadcrumb(path),
                score: bestScore,
                matchReason,
                valuePreview: isSecret ? null : valuePreview,
                secret: isSecret
            });
        };

        const stack = [{ path: [], value: data, keyLabel: entry.label }];
        while (stack.length && results.length < collectLimit) {
            const { path, value, keyLabel } = stack.pop();
            considerNode(path, value, keyLabel);

            if (value !== null && value !== undefined && typeof value === 'object') {
                const keys = this._childKeys(value);
                for (let i = keys.length - 1; i >= 0; i--) {
                    const key = keys[i];
                    stack.push({
                        path: [...path, key],
                        value: value[key],
                        keyLabel: key
                    });
                }
            }
        }

        results.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
        return {
            results: results.slice(0, maxResults),
            truncated: results.length > maxResults
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

    _resolveReadOnly(rule, path) {
        if (rule?.readOnly === true || rule?.skip === true) return true;
        const key = path?.length ? path[path.length - 1] : '';
        return String(key).startsWith('//');
    }

    _resolveRequired(rule, path) {
        if (this._resolveReadOnly(rule, path)) return true;
        return rule?.required === true;
    }

    _canDeletePath(configId, path) {
        if (!path?.length) return false;
        const rule = this.resolveMapRule(configId, path);
        return !this._resolveRequired(rule, path);
    }

    _deleteDeniedReason(rule, path) {
        if (this._resolveReadOnly(rule, path)) {
            return rule?.readOnlyReason || 'Read-only entry cannot be deleted';
        }
        return rule?.requiredReason || 'Required entry cannot be deleted';
    }

    _resolveEditMode(rule, meta, isSecret, isReadOnly) {
        if (isReadOnly) return 'readonly';
        if (rule?.editMode) return rule.editMode;
        if (isSecret || rule?.secret) return 'secret';
        if (meta.expandable) return 'modal';
        if (meta.type === 'boolean' && !meta.types?.length) return 'inline';
        if (rule?.enum?.length) return 'inline';
        if (meta.type === 'number' && !meta.types?.length) return 'inline';
        if (meta.type === 'string' && !meta.types?.length) return undefined;
        return 'modal';
    }

    _nodeMeta(value, rule, fallbackLabel, pathInput = []) {
        const inferred = this._inferType(value);
        let type = inferred;
        if (rule?.type && rule.type !== 'auto') {
            const ruleType = rule.type;
            // Leaf values: prefer inferred type over a container rule (e.g. text_replacements.* → object)
            if ((ruleType === 'object' && inferred !== 'object')
                || (ruleType === 'array' && inferred !== 'array')) {
                type = inferred;
            } else {
                type = ruleType;
            }
        }

        const expandable = type === 'object' || type === 'array';
        const isEmptyContainer = expandable
            && ((Array.isArray(value) && value.length === 0)
                || (value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length));

        const path = this._normalizePath(pathInput);
        const readOnly = this._resolveReadOnly(rule, path);
        return {
            type,
            label: rule?.label || fallbackLabel || '(root)',
            expandable,
            restartRequired: !!rule?.restartRequired,
            secret: !!rule?.secret,
            enum: rule?.enum || null,
            types: rule?.types?.length ? rule.types.slice() : null,
            description: rule?.description || null,
            isEmpty: !!isEmptyContainer,
            required: this._resolveRequired(rule, path),
            readOnly,
            editorType: rule?.editorType || null
        };
    }

    _findWildcardChildRule(configId, path) {
        const map = this._loadMap(configId);
        if (!map?.rules?.length) return null;
        const wantLen = path.length + 1;
        let best = null;
        let bestScore = -1;
        for (const rule of map.rules) {
            if (!rule.path?.length || rule.path.length !== wantLen) continue;
            if (rule.path[rule.path.length - 1] !== '*') continue;
            const score = this._matchRuleScore(rule.path, [...path, '*']);
            if (score > bestScore) {
                bestScore = score;
                best = rule;
            }
        }
        return bestScore >= 0 ? best : null;
    }

    _resolveChildLabel(value, childRule, childItemRule, key) {
        const labelRule = childRule?.displayTemplate ? childRule : childItemRule;
        if (labelRule?.displayTemplate) {
            return this._formatDisplayLabel(value, labelRule, key);
        }
        return String(key);
    }

    _childDisplayMeta(rule) {
        if (!rule) return null;
        return {
            displayTemplate: rule.displayTemplate || null,
            displayFields: rule.displayFields || null,
            iconField: rule.iconField || null
        };
    }

    _formatDisplayLabel(value, rule, key) {
        const template = rule?.displayTemplate;
        if (!template) return String(key);
        const fields = rule.displayFields || ['name', 'display', 'id', 'text', 'select_text'];
        let nameVal = String(key);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const f of fields) {
                if (value[f] != null && String(value[f]).trim() !== '') {
                    nameVal = String(value[f]);
                    break;
                }
            }
        }
        let typeVal = '';
        if (value && typeof value === 'object' && !Array.isArray(value) && value.type != null) {
            const raw = String(value.type);
            typeVal = raw.charAt(0).toUpperCase() + raw.slice(1);
        }
        return template
            .replace(/\{index\}/g, String(key))
            .replace(/\{name\}/g, nameVal)
            .replace(/\{type\}/g, typeVal);
    }

    _resolveAllowAdd(rule, childItemRule, isArrayContainer) {
        if (rule?.allowAdd === false) {
            return {
                allowed: false,
                reason: rule.addDeniedReason || 'Adding entries is not allowed here'
            };
        }
        if (rule?.closed) {
            return {
                allowed: false,
                reason: rule.addDeniedReason || 'Fixed schema — only known keys are permitted'
            };
        }
        if (rule?.allowAdd === true) {
            return { allowed: true, reason: null };
        }

        if (isArrayContainer) {
            if (rule?.itemsType || childItemRule) {
                return { allowed: true, reason: null };
            }
            if (rule?.type === 'auto' && rule?.types?.length) {
                return { allowed: true, reason: null };
            }
            return {
                allowed: false,
                reason: 'Array has no defined item type'
            };
        }

        if (childItemRule || rule?.valueType) {
            return { allowed: true, reason: null };
        }

        return {
            allowed: false,
            reason: 'Fixed schema — only known keys are permitted'
        };
    }

    _getAddMeta(configId, path, rule, value, childItemRule) {
        const isArrayContainer = rule?.type === 'array' || Array.isArray(value);
        const allow = this._resolveAllowAdd(rule, childItemRule, isArrayContainer);

        if (!allow.allowed) {
            return {
                allowed: false,
                reason: allow.reason,
                defaultSkeleton: null,
                defaultType: null,
                allowedTypes: []
            };
        }

        const skeleton = rule?.defaultSkeleton || childItemRule?.defaultSkeleton || null;
        const meta = {
            allowed: true,
            reason: null,
            defaultSkeleton: skeleton ? JSON.parse(JSON.stringify(skeleton)) : null
        };

        if (isArrayContainer) {
            if (rule?.itemsType) {
                meta.defaultType = rule.itemsType;
                meta.allowedTypes = [rule.itemsType];
            } else if (childItemRule?.itemsType) {
                meta.defaultType = childItemRule.itemsType;
                meta.allowedTypes = [childItemRule.itemsType];
            } else if (rule?.type === 'auto' && rule?.types?.includes('string')) {
                meta.defaultType = 'string';
                meta.allowedTypes = ['string'];
            } else if (childItemRule?.type === 'object') {
                meta.defaultType = 'object';
                meta.allowedTypes = ['object'];
                if (!meta.defaultSkeleton && childItemRule.defaultSkeleton) {
                    meta.defaultSkeleton = JSON.parse(JSON.stringify(childItemRule.defaultSkeleton));
                }
            } else {
                meta.defaultType = 'string';
                meta.allowedTypes = ['object', 'string', 'number', 'boolean', 'array'];
            }
            return meta;
        }

        if (rule?.type === 'object') {
            if (rule.valueType) {
                meta.defaultType = rule.valueType;
                meta.allowedTypes = [rule.valueType];
                return meta;
            }
            if (rule.types?.length) {
                meta.defaultType = rule.types[0];
                meta.allowedTypes = rule.types.length > 1 ? rule.types.slice() : [rule.types[0]];
                return meta;
            }
            if (childItemRule?.types?.length) {
                meta.defaultType = childItemRule.types[0];
                meta.allowedTypes = childItemRule.types.length > 1
                    ? childItemRule.types.slice()
                    : [childItemRule.types[0]];
                return meta;
            }
            if (childItemRule?.type === 'object') {
                meta.defaultType = 'object';
                meta.allowedTypes = ['object'];
                if (!meta.defaultSkeleton && childItemRule.defaultSkeleton) {
                    meta.defaultSkeleton = JSON.parse(JSON.stringify(childItemRule.defaultSkeleton));
                }
                return meta;
            }
        }

        meta.defaultType = 'string';
        meta.allowedTypes = ['object', 'string', 'number', 'boolean', 'array'];
        return meta;
    }

    getDefaultSkeleton(configId, containerPath, entryKey, valueType) {
        const path = this._normalizePath(containerPath);
        const rule = this.resolveMapRule(configId, path);
        const childRule = this._findWildcardChildRule(configId, path);
        const addMeta = this._getAddMeta(configId, path, rule, null, childRule);
        if (addMeta.allowed === false) {
            throw new Error(addMeta.reason || 'Adding entries is not allowed here');
        }
        let skeleton = addMeta.defaultSkeleton;

        if (valueType === 'object' && skeleton && typeof skeleton === 'object') {
            skeleton = JSON.parse(JSON.stringify(skeleton));
            if (entryKey != null && entryKey !== '') {
                const k = String(entryKey);
                if (skeleton.name === '' || skeleton.name == null) skeleton.name = k;
                if (skeleton.preset === '' || skeleton.preset == null) skeleton.preset = k;
            }
            if (skeleton.id === '' || skeleton.id == null) {
                const prefix = path.includes('rules') ? 'rule' : 'feedback';
                skeleton.id = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
            }
            if (skeleton.created === '' || skeleton.created == null) {
                skeleton.created = new Date().toISOString();
            }
            if (skeleton.timestamp === '' || skeleton.timestamp == null) {
                skeleton.timestamp = new Date().toISOString();
            }
        }

        return skeleton;
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
        if (rule.enum?.length) {
            const allowCustom = rule.enumAllowCustom === true;
            const normalized = value === 'null' ? null : value;
            const inEnum = rule.enum.some((ev) => {
                if (ev === null) return normalized === null;
                return ev === normalized || String(ev) === String(normalized);
            });
            if (!allowCustom && !inEnum) {
                throw new Error(`Value must be one of: ${rule.enum.map((v) => v === null ? 'null' : String(v)).join(', ')}`);
            }
        }
        if (rule.types?.length) {
            const inferred = Array.isArray(value) ? 'array' : typeof value === 'object' && value !== null
                ? 'object'
                : typeof value;
            const normalized = inferred === 'object' ? 'object' : inferred;
            if (!rule.types.includes(normalized)) {
                throw new Error(`Value must be one of types: ${rule.types.join(', ')}`);
            }
            return value;
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
            return Object.keys(value).filter((k) => !String(k).startsWith('//')).sort();
        }
        return [];
    }

    _hasExpandableChildren(value, configId, path) {
        if (value == null || typeof value !== 'object') return false;
        for (const key of this._childKeys(value)) {
            const childPath = [...path, key];
            const childVal = value[key];
            const childRule = this.resolveMapRule(configId, childPath);
            const childMeta = this._nodeMeta(childVal, childRule, key, childPath);
            if (childMeta.expandable) return true;
        }
        return false;
    }

    _loadConfigData(configId) {
        const entry = this._getIndexEntry(configId);
        if (entry.configType === 'naxGeneration') {
            const cm = this.globalResources.configManager;
            if (cm?.getConfigTypes?.().includes('naxGeneration')) {
                return cm._getReactiveConfig('naxGeneration', null, true);
            }
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

    _saveConfigData(configType, configId, data, options = {}) {
        if (configType === 'naxGeneration') {
            if (!data.galleries || typeof data.galleries !== 'object') {
                throw new Error('nax_generation_config.json: missing galleries object');
            }
        }
        const cm = this.globalResources.configManager;
        if (!cm) throw new Error('ConfigManager not available');
        if (!cm.getConfigTypes().includes(configType)) {
            throw new Error(`Unknown config type for save: ${configType}`);
        }
        cm.saveConfig(configType, data, {
            skipCheckpoint: options.skipCheckpoint === true,
            force: true
        });
        if (configType === 'naxGeneration') {
            const svc = this.globalResources.getNaxTagGeneration?.();
            if (svc) svc.configCache = null;
        }
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

    _pathUnderScope(patchPath, scopePath) {
        const p = this._normalizePath(patchPath);
        const s = this._normalizePath(scopePath);
        if (!s.length) return true;
        if (p.length <= s.length) {
            return p.every((seg, i) => String(seg) === String(s[i]));
        }
        return s.every((seg, i) => String(seg) === String(p[i]));
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
