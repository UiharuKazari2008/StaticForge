/**
 * Start menu organizer business logic. Single human user (same model as
 * modules/dovecoteMail.js's HUMAN_OWNER) — Yukimi is the only account with a
 * Start menu to arrange. The saved layout is a flat list of nodes:
 *   { type: 'item', launchId }
 *   { type: 'folder', id, name, children: [ { type: 'item', launchId }, ... ] }
 * Folders are exactly one level deep (no folders-in-folders), matching the
 * Windows "Accessories" folder model this feature is based on. Apps not
 * referenced anywhere in the saved layout are not stored here at all — the
 * client appends them at render time, so newly added apps always show up.
 */

'use strict';

const crypto = require('crypto');
const { getDb } = require('./startMenuLayoutDatabase');

const HUMAN_OWNER = 'yukimi';

const MAX_TOTAL_ITEMS = 500;
const MAX_FOLDERS = 100;
const MAX_FOLDER_CHILDREN = 200;
const MAX_FOLDER_NAME_LENGTH = 60;
// launchId values come from the client-side app catalog (modalUtils.js); folder
// ids are crypto.randomUUID() or a client-minted id of the same shape.
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

class StartMenuLayoutError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code || 'START_MENU_LAYOUT_ERROR';
    }
}

function nowIso() {
    return new Date().toISOString();
}

function sanitizeFolderName(name) {
    // eslint-disable-next-line no-control-regex
    const trimmed = String(name || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!trimmed) {
        throw new StartMenuLayoutError('Folder name cannot be empty', 'INVALID_FOLDER_NAME');
    }
    return trimmed.slice(0, MAX_FOLDER_NAME_LENGTH);
}

function sanitizeId(id) {
    const value = String(id || '').trim();
    if (!ID_RE.test(value)) {
        throw new StartMenuLayoutError(`Invalid id: ${JSON.stringify(id)}`, 'INVALID_ID');
    }
    return value;
}

function normalizeItemNode(node) {
    return { type: 'item', launchId: sanitizeId(node.launchId) };
}

function normalizeFolderNode(node) {
    const id = sanitizeId(node.id || crypto.randomUUID());
    const name = sanitizeFolderName(node.name);
    if (!Array.isArray(node.children)) {
        throw new StartMenuLayoutError('Folder children must be an array', 'INVALID_FOLDER_CHILDREN');
    }
    if (node.children.length > MAX_FOLDER_CHILDREN) {
        throw new StartMenuLayoutError(`Folder "${name}" has too many items`, 'FOLDER_TOO_LARGE');
    }
    const children = node.children.map((child) => {
        if (!child || typeof child !== 'object' || child.type !== 'item') {
            throw new StartMenuLayoutError('Folders may only contain apps, not nested folders', 'NESTED_FOLDER_NOT_ALLOWED');
        }
        return normalizeItemNode(child);
    });
    return { type: 'folder', id, name, children };
}

/**
 * Validates and rebuilds a client-supplied layout into a clean, minimal
 * shape — every field is whitelisted and re-typed rather than stored
 * verbatim, and duplicate launchIds/folder ids are silently dropped (keeping
 * the first occurrence) rather than erroring, since a dedupe is always a
 * safe, lossless normalization.
 */
function normalizeLayout(layout) {
    if (!Array.isArray(layout)) {
        throw new StartMenuLayoutError('Layout must be an array', 'INVALID_LAYOUT');
    }
    if (layout.length > MAX_TOTAL_ITEMS) {
        throw new StartMenuLayoutError('Layout has too many entries', 'LAYOUT_TOO_LARGE');
    }
    const seenLaunchIds = new Set();
    const seenFolderIds = new Set();
    let folderCount = 0;
    const nodes = [];

    for (const raw of layout) {
        if (!raw || typeof raw !== 'object') {
            throw new StartMenuLayoutError('Invalid layout entry', 'INVALID_LAYOUT');
        }
        if (raw.type === 'folder') {
            folderCount += 1;
            if (folderCount > MAX_FOLDERS) {
                throw new StartMenuLayoutError('Too many folders', 'TOO_MANY_FOLDERS');
            }
            const folder = normalizeFolderNode(raw);
            if (seenFolderIds.has(folder.id)) continue;
            seenFolderIds.add(folder.id);
            const dedupedChildren = [];
            for (const child of folder.children) {
                if (seenLaunchIds.has(child.launchId)) continue;
                seenLaunchIds.add(child.launchId);
                dedupedChildren.push(child);
            }
            nodes.push({ ...folder, children: dedupedChildren });
        } else if (raw.type === 'item') {
            const item = normalizeItemNode(raw);
            if (seenLaunchIds.has(item.launchId)) continue;
            seenLaunchIds.add(item.launchId);
            nodes.push(item);
        } else {
            throw new StartMenuLayoutError('Layout entry type must be "item" or "folder"', 'INVALID_LAYOUT');
        }
    }
    return nodes;
}

/** Returns the saved layout array, or null if Yukimi has never customized it. */
function getLayout(owner) {
    const row = getDb().prepare('SELECT layout FROM start_menu_layout WHERE owner = ?').get(owner);
    if (!row) return null;
    try {
        const parsed = JSON.parse(row.layout);
        return Array.isArray(parsed) ? parsed : null;
    } catch (_err) {
        return null;
    }
}

function saveLayout(owner, layout) {
    const normalized = normalizeLayout(layout);
    getDb().prepare(`
        INSERT INTO start_menu_layout (owner, layout, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(owner) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at
    `).run(owner, JSON.stringify(normalized), nowIso());
    return normalized;
}

/** When the saved layout last changed (ISO), or null when none is saved: the revision a save must name (#910). */
function getUpdatedAt(owner) {
    const row = getDb().prepare('SELECT updated_at FROM start_menu_layout WHERE owner = ?').get(owner);
    return row ? row.updated_at : null;
}

/** Reset to default just means "no saved customization" — deleting the row. */
function resetLayout(owner) {
    getDb().prepare('DELETE FROM start_menu_layout WHERE owner = ?').run(owner);
}

module.exports = {
    HUMAN_OWNER,
    StartMenuLayoutError,
    normalizeLayout,
    getLayout,
    getUpdatedAt,
    saveLayout,
    resetLayout
};
