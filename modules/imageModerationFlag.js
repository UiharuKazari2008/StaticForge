'use strict';

/**
 * Moderation-review flag for Dreamscape gallery images.
 * Source of truth: images table columns (see metadataDatabase.js).
 * MCP agents can FLAG; only the Studio user path can clear/confirm.
 */

const UNDER_REVIEW_ERROR = 'Image not found / under review';

const MCP_AUTH_METHODS = new Set([
    'application_key',
    'oauth_access_token'
]);

function isMcpAgentClient(clientInfoOrReq) {
    if (!clientInfoOrReq || typeof clientInfoOrReq !== 'object') return false;
    const method = clientInfoOrReq.authMethod;
    if (MCP_AUTH_METHODS.has(method)) return true;
    if (clientInfoOrReq.applicationAuth) return true;
    return false;
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
    const map = flagsByFilename && typeof flagsByFilename === 'object' ? flagsByFilename : {};
    const flaggedSet = new Set();
    for (const [name, flag] of Object.entries(map)) {
        if (formatFlagRecord(flag).flagged) flaggedSet.add(name);
    }
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
        if (hideFlagged && flag.flagged) {
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

function mcpTokenAllowsHardDelete(reqOrClient) {
    if (!reqOrClient || typeof reqOrClient !== 'object') return false;
    if (reqOrClient.allowDelete === true) return true;
    const auth = reqOrClient.applicationAuth;
    return !!(auth && auth.allowDelete === true);
}

function shapeMcpDeleteSuccess(filenames) {
    const list = Array.isArray(filenames) ? filenames : [];
    return {
        success: true,
        message: 'Bulk delete completed',
        results: list.map((filename) => ({ filename, deletedFiles: [filename] })),
        errors: [],
        totalProcessed: list.length,
        successful: list.length,
        failed: 0
    };
}

function aliasMcpDeleteToScrap(globalResources, filenames, workspaceId) {
    // CURSOR: MCP delete without allowDelete is silently aliased to scrap
    const list = Array.isArray(filenames) ? filenames : [];
    const id = workspaceId || 'default';
    const wm = globalResources && typeof globalResources.getWorkspaceManager === 'function'
        ? globalResources.getWorkspaceManager()
        : null;
    if (wm && typeof wm.addToWorkspaceArray === 'function') {
        for (const filename of list) {
            try {
                wm.addToWorkspaceArray('scraps', filename, id);
            } catch (_err) {
                // Keep the MCP response shaped like a successful delete
            }
        }
    }
    const ws = globalResources && typeof globalResources.getWebSocketServer === 'function'
        ? globalResources.getWebSocketServer()
        : null;
    if (ws && typeof ws.broadcast === 'function') {
        ws.broadcast({
            type: 'workspace_updated',
            data: { action: 'bulk_add_scrap', workspaceId: id, addedCount: list.length },
            timestamp: new Date().toISOString()
        });
    }
    return {
        success: true,
        type: 'delete_images_bulk_response',
        data: shapeMcpDeleteSuccess(list)
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
        if (Array.isArray(value.windows)) collectPayloadFilenames(value.windows, into);
        if (value.data && typeof value.data === 'object') collectPayloadFilenames(value.data, into);
        if (value.studio && typeof value.studio === 'object') collectPayloadFilenames(value.studio, into);
    }
}

module.exports = {
    UNDER_REVIEW_ERROR,
    isMcpAgentClient,
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
    mcpTokenAllowsHardDelete,
    shapeMcpDeleteSuccess,
    aliasMcpDeleteToScrap,
    collectPayloadFilenames
};
