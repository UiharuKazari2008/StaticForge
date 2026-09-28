'use strict';

/**
 * Moderation-review flag for Dreamscape gallery images.
 * Source of truth: images table columns (see metadataDatabase.js).
 * MCP agents can FLAG; only the Studio user path can clear/confirm.
 */

const fs = require('fs');
const path = require('path');

const UNDER_REVIEW_ERROR = 'Image not found / under review';

const MCP_AUTH_METHODS = new Set([
    'application_key',
    'oauth_access_token',
    'temp_token',
    'dev_login_key',
    'dev_admin_session'
]);

function isMcpAgentClient(clientInfoOrReq) {
    if (!clientInfoOrReq || typeof clientInfoOrReq !== 'object') return false;
    const method = clientInfoOrReq.authMethod;
    if (MCP_AUTH_METHODS.has(method)) return true;
    if (clientInfoOrReq.applicationAuth) return true;
    if (clientInfoOrReq.userType === 'dev_admin') return true;
    return false;
}

function isAdminUserSession(clientInfo) {
    if (!clientInfo || typeof clientInfo !== 'object') return false;
    if (isMcpAgentClient(clientInfo)) return false;
    return clientInfo.userType === 'admin';
}

function emptyFlagRecord() {
    return {
        flagged: false,
        flaggedBy: null,
        reason: null,
        flaggedAt: null,
        confirmed: false,
        confirmedAt: null
    };
}

function coerceFlagTimestamp(value) {
    const n = Number(value);
    if (!n) return null;
    return n < 1e12 ? n * 1000 : n;
}

function formatFlagRecord(row) {
    if (!row) return emptyFlagRecord();
    const flagged = row.flagged === true
        || row.flagged === 1
        || row.flagged === '1'
        || row.flagged === 'true';
    if (!flagged) return emptyFlagRecord();
    return {
        flagged: true,
        flaggedBy: row.flagged_by != null ? String(row.flagged_by) : (row.flaggedBy != null ? String(row.flaggedBy) : null),
        reason: row.flag_reason != null ? String(row.flag_reason) : (row.reason != null ? String(row.reason) : null),
        flaggedAt: coerceFlagTimestamp(row.flagged_at != null ? row.flagged_at : row.flaggedAt),
        confirmed: row.flag_confirmed === true
            || row.flag_confirmed === 1
            || row.flag_confirmed === '1'
            || row.confirmed === true
            || row.confirmed === 1,
        confirmedAt: coerceFlagTimestamp(row.flag_confirmed_at != null ? row.flag_confirmed_at : row.confirmedAt)
    };
}

function galleryNamesFromRow(row) {
    if (!row) return [];
    if (typeof row === 'string') return [row];
    const names = [];
    for (const key of ['filename', 'original', 'upscaled', 'base']) {
        const value = row[key];
        if (typeof value === 'string' && value && !names.includes(value)) {
            names.push(value);
        }
    }
    return names;
}

function rowHasFlaggedName(row, flaggedSet) {
    if (!flaggedSet || !flaggedSet.size) return false;
    return galleryNamesFromRow(row).some((name) => flaggedSet.has(name));
}

function attachFlagFields(row, flag) {
    if (!row || typeof row !== 'object') return row;
    const record = formatFlagRecord(flag);
    row.flagged = record.flagged;
    row.flaggedBy = record.flaggedBy;
    row.flagReason = record.reason;
    row.flaggedAt = record.flaggedAt;
    row.flagConfirmed = record.confirmed;
    row.flagConfirmedAt = record.confirmedAt;
    return row;
}

function decorateGalleryRowsForClient(rows, flagsByFilename, options) {
    const hideFlagged = !!(options && options.hideFlagged);
    const hideNames = options && options.hideNames instanceof Set ? options.hideNames : null;
    const map = flagsByFilename && typeof flagsByFilename === 'object' ? flagsByFilename : {};
    const list = Array.isArray(rows) ? rows : [];
    const out = [];
    for (const row of list) {
        const names = galleryNamesFromRow(row);
        let flag = emptyFlagRecord();
        for (const name of names) {
            const next = formatFlagRecord(map[name]);
            if (next.flagged) {
                flag = next;
                break;
            }
        }
        const hiddenName = !!(hideNames && names.some((name) => hideNames.has(name)));
        if (hideFlagged && (flag.flagged || hiddenName)) {
            // CURSOR: MCP gallery/search list — omit flagged images
            continue;
        }
        if (row && typeof row === 'object') {
            attachFlagFields(row, flag);
        }
        out.push(row);
    }
    return out;
}

function filterFlaggedFilenames(filenames, flaggedSet) {
    if (!Array.isArray(filenames) || !filenames.length) return [];
    if (!flaggedSet || !flaggedSet.size) return filenames.slice();
    return filenames.filter((name) => !flaggedSet.has(name));
}

function mcpUnderReviewPayload(extra) {
    return {
        success: false,
        error: UNDER_REVIEW_ERROR,
        underReview: true,
        ...(extra && typeof extra === 'object' ? extra : {})
    };
}

function rejectMcpFlagMutation() {
    const err = new Error('Clear/confirm is only available from the Studio gallery');
    err.status = 403;
    err.code = 'USER_ONLY';
    return err;
}

function rejectMcpTokenConfigMutation() {
    const err = new Error('Allow delete can only be changed from the Authentication tab');
    err.status = 403;
    err.code = 'USER_ONLY';
    return err;
}

function redactAllowDeleteFromValue(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(redactAllowDeleteFromValue);
    const next = { ...value };
    delete next.allowDelete;
    if (next.summary && typeof next.summary === 'object') {
        next.summary = redactAllowDeleteFromValue(next.summary);
    }
    if (Array.isArray(next.keys)) {
        next.keys = redactAllowDeleteFromValue(next.keys);
    }
    return next;
}

function authPayloadForClient(data, clientInfo) {
    if (!isMcpAgentClient(clientInfo)) return data;
    // CURSOR: MCP tokens must not read allowDelete from key summaries
    return redactAllowDeleteFromValue(data);
}

function mcpTokenAllowsHardDelete(reqOrClient) {
    if (!reqOrClient || typeof reqOrClient !== 'object') return false;
    if (reqOrClient.allowDelete === true) return true;
    const auth = reqOrClient.applicationAuth;
    return !!(auth && auth.allowDelete === true);
}

async function resolveLiveAllowDelete(globalResources, clientInfo) {
    if (!isMcpAgentClient(clientInfo)) return true;
    const keyId = clientInfo.applicationKeyId
        || (clientInfo.applicationAuth && clientInfo.applicationAuth.applicationKeyId);
    try {
        const manager = globalResources && typeof globalResources.getApplicationAuthManager === 'function'
            ? globalResources.getApplicationAuthManager()
            : null;
        if (keyId && manager && typeof manager.getApplicationKeyAllowDelete === 'function') {
            return await manager.getApplicationKeyAllowDelete(keyId);
        }
    } catch (_err) {
        // fall through to the request snapshot
    }
    return mcpTokenAllowsHardDelete(clientInfo);
}

function relatedDeleteFilenames(filename) {
    if (!filename || typeof filename !== 'string') return [];
    const names = [filename];
    if (filename.includes('_upscaled')) {
        const original = filename.replace('_upscaled.png', '.png');
        if (original && !names.includes(original)) names.push(original);
    } else if (/\.png$/i.test(filename)) {
        const upscaled = filename.replace(/\.png$/i, '_upscaled.png');
        if (!names.includes(upscaled)) names.push(upscaled);
    }
    return names;
}

function resolveDeleteWorkspaceId(globalResources, workspaceId) {
    const requested = workspaceId || 'default';
    try {
        const wm = globalResources && typeof globalResources.getWorkspaceManager === 'function'
            ? globalResources.getWorkspaceManager()
            : null;
        if (wm && typeof wm.getWorkspace === 'function' && wm.getWorkspace(requested)) {
            return requested;
        }
        const all = wm && typeof wm.getWorkspaces === 'function' ? wm.getWorkspaces() : {};
        if (all && all[requested]) return requested;
    } catch (_err) { /* fall back to default */ }
    return 'default';
}

function collectFakeDeletedFilenames(globalResources) {
    const set = new Set();
    try {
        const wm = globalResources && typeof globalResources.getWorkspaceManager === 'function'
            ? globalResources.getWorkspaceManager()
            : null;
        if (wm && typeof wm.listHiddenByFakeDelete === 'function') {
            for (const name of wm.listHiddenByFakeDelete() || []) {
                if (name) set.add(name);
            }
            return set;
        }
        const all = wm && typeof wm.getWorkspaces === 'function' ? wm.getWorkspaces() : {};
        for (const rec of Object.values(all || {})) {
            if (!rec || !Array.isArray(rec.hiddenByFakeDelete)) continue;
            for (const name of rec.hiddenByFakeDelete) {
                if (name) set.add(name);
            }
        }
    } catch (_err) { /* fake-delete lookup is best-effort */ }
    return set;
}

function clearHiddenByFakeDelete(globalResources, filenames) {
    const list = Array.isArray(filenames) ? filenames : [filenames];
    const names = list.filter(Boolean);
    if (!names.length) return 0;
    const wm = globalResources && typeof globalResources.getWorkspaceManager === 'function'
        ? globalResources.getWorkspaceManager()
        : null;
    if (wm && typeof wm.clearHiddenByFakeDelete === 'function') {
        return wm.clearHiddenByFakeDelete(names);
    }
    const all = wm && typeof wm.getWorkspaces === 'function' ? wm.getWorkspaces() : null;
    if (!all) return 0;
    const drop = new Set(names);
    let cleared = 0;
    for (const rec of Object.values(all)) {
        if (!rec || !Array.isArray(rec.hiddenByFakeDelete)) continue;
        const next = rec.hiddenByFakeDelete.filter((name) => {
            if (!drop.has(name)) return true;
            cleared += 1;
            return false;
        });
        rec.hiddenByFakeDelete = next;
    }
    return cleared;
}

function markHiddenByFakeDelete(globalResources, filenames, workspaceId) {
    const list = Array.isArray(filenames) ? filenames : [];
    if (!list.length) return 'default';
    const id = resolveDeleteWorkspaceId(globalResources, workspaceId);
    const wm = globalResources && typeof globalResources.getWorkspaceManager === 'function'
        ? globalResources.getWorkspaceManager()
        : null;
    if (wm && typeof wm.markHiddenByFakeDelete === 'function') {
        return wm.markHiddenByFakeDelete(list, id);
    }
    const all = wm && typeof wm.getWorkspaces === 'function' ? wm.getWorkspaces() : null;
    const rec = all && (all[id] || all.default);
    if (!rec) return id;
    if (!Array.isArray(rec.hiddenByFakeDelete)) rec.hiddenByFakeDelete = [];
    for (const name of list) {
        if (name && !rec.hiddenByFakeDelete.includes(name)) rec.hiddenByFakeDelete.push(name);
    }
    return id;
}

async function filenameIsModerationFlagged(globalResources, filename) {
    if (!filename) return false;
    try {
        const db = globalResources && typeof globalResources.getMetadataDatabase === 'function'
            ? globalResources.getMetadataDatabase()
            : null;
        if (db && typeof db.isImageOrPairFlagged === 'function') {
            return await db.isImageOrPairFlagged(filename);
        }
        if (db && typeof db.isImageFlagged === 'function') {
            return await db.isImageFlagged(filename);
        }
    } catch (_err) { /* flag check is best-effort */ }
    return false;
}

async function filterFilenamesVisibleToClient(globalResources, filenames, clientInfo) {
    const list = Array.isArray(filenames) ? filenames : [];
    if (!isMcpAgentClient(clientInfo)) return list.slice();
    const out = [];
    for (const name of list) {
        if (!name || await agentCannotSeeFilename(globalResources, name)) continue;
        out.push(name);
    }
    return out;
}

async function filterGroupsVisibleToClient(globalResources, groups, clientInfo) {
    const list = Array.isArray(groups) ? groups : [];
    if (!isMcpAgentClient(clientInfo)) return groups;
    const out = [];
    for (const group of list) {
        if (!group || typeof group !== 'object') {
            out.push(group);
            continue;
        }
        out.push({
            ...group,
            images: await filterFilenamesVisibleToClient(globalResources, group.images || [], clientInfo)
        });
    }
    return out;
}

async function filterGroupVisibleToClient(globalResources, group, clientInfo) {
    if (!group || typeof group !== 'object' || !isMcpAgentClient(clientInfo)) return group;
    return {
        ...group,
        images: await filterFilenamesVisibleToClient(globalResources, group.images || [], clientInfo)
    };
}

async function payloadHiddenFromAgent(globalResources, value) {
    const names = [];
    collectPayloadFilenames(value, names);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const key of ['previewImageFilename', 'targetId']) {
            if (typeof value[key] === 'string' && value[key] && !names.includes(value[key])) {
                names.push(value[key]);
            }
        }
        if ((value.targetKind === 'image' || value.targetKind === 'scrap')
            && typeof value.name === 'string' && value.name && !names.includes(value.name)) {
            names.push(value.name);
        }
    }
    for (const name of names) {
        if (await agentCannotSeeFilename(globalResources, name)) return true;
    }
    return false;
}

async function filterVfsListItemsVisibleToClient(globalResources, items, clientInfo) {
    const list = Array.isArray(items) ? items : [];
    if (!isMcpAgentClient(clientInfo)) return items;
    const out = [];
    for (const item of list) {
        if (await payloadHiddenFromAgent(globalResources, item)) continue;
        out.push(item);
    }
    return out;
}

async function filterDesktopShortcutsVisibleToClient(globalResources, desktopData, clientInfo) {
    if (!desktopData || !isMcpAgentClient(clientInfo)) return desktopData;
    const shortcuts = Array.isArray(desktopData.shortcuts) ? desktopData.shortcuts : [];
    const kept = [];
    for (const shortcut of shortcuts) {
        if (await payloadHiddenFromAgent(globalResources, shortcut)) continue;
        kept.push(shortcut);
    }
    return { ...desktopData, shortcuts: kept };
}

function filenameHiddenByFakeDelete(globalResources, filename) {
    if (!filename) return false;
    return collectFakeDeletedFilenames(globalResources).has(filename);
}

async function agentCannotSeeFilename(globalResources, filename) {
    if (!filename) return false;
    // CURSOR: agents hide flagged images and fake-deleted names only — ordinary scraps stay visible
    if (filenameHiddenByFakeDelete(globalResources, filename)) return true;
    return filenameIsModerationFlagged(globalResources, filename);
}

function galleryPairBaseName(filename) {
    return String(filename || '').replace(/\.(png|jpg|jpeg)$/i, '').replace(/_upscaled$/i, '');
}

function countPairedGalleryFilenames(filenames) {
    const bases = new Set();
    for (const name of Array.isArray(filenames) ? filenames : []) {
        if (!name) continue;
        bases.add(galleryPairBaseName(name));
    }
    return bases.size;
}

function galleryFilenameExistsOnDisk(globalResources, filename) {
    if (!filename || !globalResources || typeof globalResources.getPath !== 'function') return false;
    try {
        return fs.existsSync(path.join(globalResources.getPath('images'), filename));
    } catch (_err) {
        return false;
    }
}

async function agentShouldNoopGalleryName(globalResources, filename) {
    if (!filename) return true;
    // CURSOR: missing gallery file and hidden/flagged names are the same silent no-op
    if (await agentCannotSeeFilename(globalResources, filename)) return true;
    return !galleryFilenameExistsOnDisk(globalResources, filename);
}

async function rejectAgentHiddenHttpFile(req, res, globalResources, filename, errorText) {
    if (!isMcpAgentClient(req)) return false;
    if (!(await agentCannotSeeFilename(globalResources, filename))) return false;
    // CURSOR: HTTP /images /previews — agent clients get the same not-found as a deleted file
    res.status(404).json({ success: false, error: errorText || 'Image not found' });
    return true;
}

async function collectAgentHiddenDeleteErrors(globalResources, filenames) {
    const extraErrors = [];
    const visible = [];
    for (const filename of Array.isArray(filenames) ? filenames : []) {
        if (await agentCannotSeeFilename(globalResources, filename)) {
            extraErrors.push({ filename, error: 'File not found' });
        } else {
            visible.push(filename);
        }
    }
    return { visible, extraErrors };
}

function mergeBulkDeleteExtraErrors(data, originalFilenames, extraErrors) {
    const extras = Array.isArray(extraErrors) ? extraErrors.filter((row) => row && row.filename) : [];
    if (!extras.length) {
        return data;
    }
    const list = Array.isArray(originalFilenames) ? originalFilenames : [];
    const extraQ = extras.slice();
    const resultQ = ((data && data.results) || []).slice();
    const errorQ = ((data && data.errors) || []).slice();
    const results = [];
    const errors = [];
    for (const filename of list) {
        if (extraQ.length && extraQ[0].filename === filename) {
            errors.push(extraQ.shift());
            continue;
        }
        if (resultQ.length && resultQ[0].filename === filename) {
            results.push(resultQ.shift());
            continue;
        }
        if (errorQ.length && errorQ[0].filename === filename) {
            errors.push(errorQ.shift());
            continue;
        }
        const extraIdx = extraQ.findIndex((row) => row.filename === filename);
        if (extraIdx !== -1) {
            errors.push(extraQ.splice(extraIdx, 1)[0]);
            continue;
        }
        const resultIdx = resultQ.findIndex((row) => row.filename === filename);
        if (resultIdx !== -1) {
            results.push(resultQ.splice(resultIdx, 1)[0]);
            continue;
        }
        const errorIdx = errorQ.findIndex((row) => row.filename === filename);
        if (errorIdx !== -1) {
            errors.push(errorQ.splice(errorIdx, 1)[0]);
        }
    }
    return {
        success: true,
        message: 'Bulk delete completed',
        results,
        errors,
        totalProcessed: list.length,
        successful: results.length,
        failed: errors.length
    };
}

function executeRealBulkDelete(globalResources, filenames) {
    const list = Array.isArray(filenames) ? filenames : [];
    const plan = planBulkDelete(globalResources, list, { unlink: true });
    return {
        plan,
        data: shapeBulkDeleteData(list, plan)
    };
}

function inspectUnupscaledOriginal(globalResources, filename) {
    if (!filename || typeof filename !== 'string') {
        return { error: 'Filename is required' };
    }
    if (filename.includes('_upscaled')) {
        return { error: 'Filename is not an original (un-upscaled) file' };
    }
    const getPath = globalResources && typeof globalResources.getPath === 'function'
        ? globalResources.getPath.bind(globalResources)
        : null;
    if (!getPath) return { error: 'Original file not found' };
    const originalPath = path.join(getPath('images'), filename);
    const upscaledFilename = filename.replace(/\.png$/i, '_upscaled.png');
    const upscaledPath = path.join(getPath('images'), upscaledFilename);
    if (!fs.existsSync(originalPath)) return { error: 'Original file not found' };
    if (!fs.existsSync(upscaledPath)) {
        return { error: 'No upscaled version exists; use Incinerate to delete the image' };
    }
    return { filename, originalPath, upscaledFilename, upscaledPath };
}

function aliasMcpDeleteUnupscaledOriginal(globalResources, filename, workspaceId) {
    const info = inspectUnupscaledOriginal(globalResources, filename);
    if (info.error) {
        return { success: false, error: info.error };
    }
    const id = resolveDeleteWorkspaceId(globalResources, workspaceId);
    const wm = globalResources && typeof globalResources.getWorkspaceManager === 'function'
        ? globalResources.getWorkspaceManager()
        : null;
    if (wm && typeof wm.addToWorkspaceArray === 'function') {
        wm.addToWorkspaceArray('scraps', filename, id);
    }
    markHiddenByFakeDelete(globalResources, [filename], id);
    const data = {
        success: true,
        originalFilename: filename,
        upscaledFilename: info.upscaledFilename
    };
    const ws = globalResources && typeof globalResources.getWebSocketServer === 'function'
        ? globalResources.getWebSocketServer()
        : null;
    if (ws && typeof ws.broadcast === 'function') {
        ws.broadcast({
            type: 'gallery_updated',
            data: {
                action: 'unupscaled_removed',
                originalFilename: filename,
                upscaledFilename: info.upscaledFilename,
                viewType: 'images'
            },
            timestamp: new Date().toISOString()
        });
    }
    return {
        success: true,
        type: 'delete_unupscaled_original_response',
        data
    };
}

async function filterSimilarGroupsForClient(globalResources, payload, clientInfo) {
    if (!payload || !isMcpAgentClient(clientInfo)) return payload;
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    const nextGroups = [];
    for (const group of groups) {
        const items = [];
        for (const item of group.items || []) {
            if (item && item.filename && await agentCannotSeeFilename(globalResources, item.filename)) continue;
            items.push(item);
        }
        if (!items.length) continue;
        nextGroups.push({
            ...group,
            items,
            count: items.length,
            truncated: false
        });
    }
    return { ...payload, groups: nextGroups };
}

function galleryNameFromPreviewFile(previewFile) {
    if (!previewFile || typeof previewFile !== 'string') return null;
    const base = path.basename(previewFile);
    return base
        .replace(/@2x\.webp$/i, '.png')
        .replace(/@lq\.webp$/i, '.png')
        .replace(/@blur\.webp$/i, '.png')
        .replace(/\.webp$/i, '.png')
        .replace(/_preview\.png$/i, '.png');
}

function planBulkDelete(globalResources, filenames, options) {
    const list = Array.isArray(filenames) ? filenames : [];
    const unlink = !!(options && options.unlink);
    const results = [];
    const errors = [];
    const relatedFilenames = [];
    const filesToDelete = [];
    const claimedImagePaths = new Set();
    const getPath = globalResources && typeof globalResources.getPath === 'function'
        ? globalResources.getPath.bind(globalResources)
        : null;
    if (!getPath) {
        for (const filename of list) {
            errors.push({ filename, error: 'File not found' });
        }
        return { results, errors, relatedFilenames, filesToDelete };
    }
    const imagesDir = getPath('images');
    const previewsDir = getPath('previews');
    const getBaseName = (filename) => filename.replace(/\.(png|jpg|jpeg)$/i, '').replace(/_upscaled$/, '');
    const getPreviewFilename = (baseName) => `${baseName}_preview.png`;

    for (const filename of list) {
        try {
            const filePath = path.join(imagesDir, filename);
            if (claimedImagePaths.has(filePath) || !fs.existsSync(filePath)) {
                errors.push({ filename, error: 'File not found' });
                continue;
            }
            const baseName = getBaseName(filename);
            const previewFiles = [
                path.join(previewsDir, `${baseName}.webp`),
                path.join(previewsDir, `${baseName}@2x.webp`),
                path.join(previewsDir, `${baseName}@lq.webp`),
                path.join(previewsDir, `${baseName}@blur.webp`),
                path.join(previewsDir, getPreviewFilename(baseName))
            ];
            let originalFilename;
            let upscaledFilename;
            if (filename.includes('_upscaled')) {
                upscaledFilename = filename;
                originalFilename = filename.replace('_upscaled.png', '.png');
            } else {
                originalFilename = filename;
                upscaledFilename = filename.replace('.png', '_upscaled.png');
            }
            const entryFiles = [];
            const namesToScrap = [];
            const originalPath = path.join(imagesDir, originalFilename);
            if (fs.existsSync(originalPath)) {
                entryFiles.push({ path: originalPath, type: 'original' });
                namesToScrap.push(originalFilename);
                try {
                    const pngMeta = globalResources.getPngMetadata && globalResources.getPngMetadata();
                    if (pngMeta && typeof pngMeta.readMetadata === 'function') {
                        const imageBuffer = fs.readFileSync(originalPath);
                        const metadata = pngMeta.readMetadata(imageBuffer);
                        if (metadata && metadata.tEXt && metadata.tEXt.Comment) {
                            const commentData = JSON.parse(metadata.tEXt.Comment);
                            const previewHash = commentData
                                && commentData.forge_data
                                && commentData.forge_data.dynamic_generation
                                && commentData.forge_data.dynamic_generation.compiled_prompt
                                && commentData.forge_data.dynamic_generation.compiled_prompt.preview_image_hash;
                            if (previewHash) {
                                const dynGenPreviewPath = path.join(getPath('cache'), 'dynGenPreview', `${previewHash}.png`);
                                if (fs.existsSync(dynGenPreviewPath)) {
                                    entryFiles.push({ path: dynGenPreviewPath, type: 'dynGenPreview' });
                                    if (unlink) {
                                        console.log(`🗑️ Will delete dynGenPreview: ${previewHash.substring(0, 8)}...`);
                                    }
                                }
                            }
                        }
                    }
                } catch (_metaErr) { /* same silent skip as the real handler */ }
            }
            const upscaledPath = path.join(imagesDir, upscaledFilename);
            if (fs.existsSync(upscaledPath)) {
                entryFiles.push({ path: upscaledPath, type: 'upscaled' });
                namesToScrap.push(upscaledFilename);
            }
            for (const previewFilePath of previewFiles) {
                if (fs.existsSync(previewFilePath)) {
                    entryFiles.push({ path: previewFilePath, type: 'preview' });
                }
            }
            claimedImagePaths.add(originalPath);
            claimedImagePaths.add(upscaledPath);
            const deletedFiles = [];
            for (const file of entryFiles) {
                if (unlink) {
                    try {
                        fs.unlinkSync(file.path);
                        deletedFiles.push(file.type);
                    } catch (error) {
                        console.error(`Failed to delete ${file.type}: ${path.basename(file.path)}`, error.message);
                    }
                } else {
                    deletedFiles.push(file.type);
                }
            }
            results.push({ filename, deletedFiles });
            filesToDelete.push(...entryFiles);
            for (const name of namesToScrap) {
                if (!relatedFilenames.includes(name)) relatedFilenames.push(name);
            }
            console.log(`🗑️ Bulk deleted: ${filename} (${deletedFiles.join(', ')})`);
        } catch (error) {
            errors.push({ filename, error: error.message });
        }
    }
    console.log(`✅ Bulk delete completed: ${results.length} successful, ${errors.length} failed`);
    return { results, errors, relatedFilenames, filesToDelete };
}

function shapeBulkDeleteData(filenames, plan) {
    const list = Array.isArray(filenames) ? filenames : [];
    const results = plan && Array.isArray(plan.results) ? plan.results : [];
    const errors = plan && Array.isArray(plan.errors) ? plan.errors : [];
    return {
        success: true,
        message: 'Bulk delete completed',
        results,
        errors,
        totalProcessed: list.length,
        successful: results.length,
        failed: errors.length
    };
}

function aliasMcpDeleteToScrap(globalResources, filenames, workspaceId) {
    // CURSOR: MCP delete without allowDelete is silently aliased to scrap
    const list = Array.isArray(filenames) ? filenames : [];
    const plan = planBulkDelete(globalResources, list);
    const id = resolveDeleteWorkspaceId(globalResources, workspaceId);
    const wm = globalResources && typeof globalResources.getWorkspaceManager === 'function'
        ? globalResources.getWorkspaceManager()
        : null;
    if (wm && typeof wm.addToWorkspaceArray === 'function') {
        for (const filename of plan.relatedFilenames) {
            wm.addToWorkspaceArray('scraps', filename, id);
        }
    }
    markHiddenByFakeDelete(globalResources, plan.relatedFilenames, id);
    const data = shapeBulkDeleteData(list, plan);
    const ws = globalResources && typeof globalResources.getWebSocketServer === 'function'
        ? globalResources.getWebSocketServer()
        : null;
    if (ws && typeof ws.broadcast === 'function') {
        ws.broadcast({
            type: 'gallery_updated',
            data: {
                action: 'bulk_delete',
                deletedFilenames: plan.results.map((row) => row.filename),
                deletedCount: plan.results.length,
                viewType: 'images'
            },
            timestamp: new Date().toISOString()
        });
    }
    return {
        success: true,
        type: 'delete_images_bulk_response',
        data
    };
}

function collectPayloadFilenames(value, into) {
    if (!value) return;
    if (typeof value === 'string') {
        if (value && !into.includes(value)) into.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectPayloadFilenames(item, into);
        return;
    }
    if (typeof value === 'object') {
        for (const key of ['filename', 'original', 'upscaled', 'focusedFilename', 'latestFilename', 'lastGenerated', 'filenameBefore']) {
            if (typeof value[key] === 'string' && value[key] && !into.includes(value[key])) {
                into.push(value[key]);
            }
        }
        if (Array.isArray(value.filenames)) collectPayloadFilenames(value.filenames, into);
        if (Array.isArray(value.selected)) collectPayloadFilenames(value.selected, into);
        if (Array.isArray(value.results)) collectPayloadFilenames(value.results, into);
        if (Array.isArray(value.gallery)) collectPayloadFilenames(value.gallery, into);
        if (Array.isArray(value.shortcuts)) {
            for (const item of value.shortcuts) {
                collectPayloadFilenames(item, into);
                if (item && typeof item === 'object' && typeof item.name === 'string' && item.name && !into.includes(item.name)) {
                    into.push(item.name);
                }
            }
        }
        if (Array.isArray(value.windows)) collectPayloadFilenames(value.windows, into);
        if (value.data && typeof value.data === 'object') collectPayloadFilenames(value.data, into);
        if (value.studio && typeof value.studio === 'object') collectPayloadFilenames(value.studio, into);
    }
}

module.exports = {
    UNDER_REVIEW_ERROR,
    isMcpAgentClient,
    isAdminUserSession,
    emptyFlagRecord,
    formatFlagRecord,
    galleryNamesFromRow,
    rowHasFlaggedName,
    attachFlagFields,
    decorateGalleryRowsForClient,
    filterFlaggedFilenames,
    mcpUnderReviewPayload,
    rejectMcpFlagMutation,
    rejectMcpTokenConfigMutation,
    redactAllowDeleteFromValue,
    authPayloadForClient,
    mcpTokenAllowsHardDelete,
    resolveLiveAllowDelete,
    relatedDeleteFilenames,
    resolveDeleteWorkspaceId,
    collectFakeDeletedFilenames,
    markHiddenByFakeDelete,
    clearHiddenByFakeDelete,
    filenameHiddenByFakeDelete,
    filenameIsModerationFlagged,
    filterFilenamesVisibleToClient,
    filterGroupsVisibleToClient,
    filterGroupVisibleToClient,
    filterVfsListItemsVisibleToClient,
    filterDesktopShortcutsVisibleToClient,
    agentCannotSeeFilename,
    galleryPairBaseName,
    countPairedGalleryFilenames,
    galleryFilenameExistsOnDisk,
    agentShouldNoopGalleryName,
    rejectAgentHiddenHttpFile,
    collectAgentHiddenDeleteErrors,
    mergeBulkDeleteExtraErrors,
    executeRealBulkDelete,
    inspectUnupscaledOriginal,
    aliasMcpDeleteUnupscaledOriginal,
    filterSimilarGroupsForClient,
    galleryNameFromPreviewFile,
    planBulkDelete,
    shapeBulkDeleteData,
    aliasMcpDeleteToScrap,
    collectPayloadFilenames
};
