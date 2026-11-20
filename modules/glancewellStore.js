'use strict';

/**
 * Glancewell (Windows Photo Gallery) library data (Yozora #446): what the gallery itself keeps about a picture,
 * apart from the picture's own store.
 *
 *   tags        the user's tags (nested: a tag may sit under another, "Select top-level tag"), by id
 *   item_tags   which pictures carry which tag
 *   captions    a picture's caption
 *   taken       Change Time Taken: the picture's date taken, where the user moved it
 *   favorites   the Pictures root's Favorites (phone and host pictures; prints keep their pins, Yukimi Nov 20 2026)
 *   watched     the Folders root: the VFS folders added with Add Folder to Gallery
 *
 * A picture is (source, key): source is the root it lives in ('prints', 'refs', 'pictures', 'folders', or
 * 'device:<deviceId>' for an ActiveSync phone) and key its id there (print filename, reference hash, VFS file id,
 * the phone's own path). References keep their own tags and comment in reference_metadata.db; the client uses
 * those for the References root, so 'refs' rows here are only what that store has no place for (date taken).
 *
 * better-sqlite3 on its own file (never a node-sqlite3 database: two SQLite libraries in one process corrupt
 * each other's locks). Writes broadcast glancewell_changed to the household's clients (server push, no polling).
 */

const path = require('path');
const fs = require('fs');

const MAX_TAG = 64;
const MAX_CAPTION = 1024;
const MAX_KEY = 1024;
const MAX_BATCH = 5000;

let db = null;
let gr = null;

function init(globalResources) {
    if (db) return db;
    gr = globalResources || gr;
    const dir = gr && typeof gr.getPath === 'function' ? gr.getPath('databases') : path.resolve(__dirname, '..', '.cache');
    fs.mkdirSync(dir, { recursive: true });
    const Database = require('better-sqlite3');
    db = new Database(path.join(dir, 'glancewell.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags(IFNULL(parent_id, 0), name COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS item_tags (
            source TEXT NOT NULL,
            item_key TEXT NOT NULL,
            tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (source, item_key, tag_id)
        );
        CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);
        CREATE TABLE IF NOT EXISTS captions (
            source TEXT NOT NULL,
            item_key TEXT NOT NULL,
            caption TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (source, item_key)
        );
        CREATE TABLE IF NOT EXISTS taken (
            source TEXT NOT NULL,
            item_key TEXT NOT NULL,
            taken_at INTEGER NOT NULL,
            PRIMARY KEY (source, item_key)
        );
        CREATE TABLE IF NOT EXISTS favorites (
            source TEXT NOT NULL,
            item_key TEXT NOT NULL,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (source, item_key)
        );
        CREATE TABLE IF NOT EXISTS watched (
            folder TEXT PRIMARY KEY,
            name TEXT,
            added_at INTEGER NOT NULL
        );
    `);
    return db;
}

function need() {
    if (!db) init(gr);
    return db;
}

const now = () => Math.floor(Date.now() / 1000);

function cleanSource(s) {
    const v = String(s || '');
    return /^(prints|refs|pictures|folders|device:[A-Za-z0-9._:-]{1,128})$/.test(v) ? v : null;
}

function cleanItems(items) {
    const out = [];
    for (const it of Array.isArray(items) ? items.slice(0, MAX_BATCH) : []) {
        const source = cleanSource(it && it.source);
        const key = it && typeof it.key === 'string' ? it.key.slice(0, MAX_KEY) : '';
        if (source && key) out.push({ source, key });
    }
    return out;
}

/** "Your tag cannot include a forward slash or a semicolon." (WPG string 976) */
function cleanTagName(name) {
    const v = String(name == null ? '' : name).trim().slice(0, MAX_TAG);
    if (!v) return { error: 'empty' };
    if (/[/;]/.test(v)) return { error: 'Your tag cannot include a forward slash or a semicolon. Please use a different tag.' };
    return { name: v };
}

function rowTag(r) {
    return { id: r.id, name: r.name, parentId: r.parent_id || null, count: r.n || 0 };
}

/** Every tag with how many pictures carry it (the Tags tree), optionally counting one source only. */
function listTags(source) {
    const d = need();
    const src = source ? cleanSource(source) : null;
    const rows = src
        ? d.prepare(`SELECT t.id, t.name, t.parent_id, (SELECT COUNT(*) FROM item_tags i WHERE i.tag_id = t.id AND i.source = ?) n FROM tags t ORDER BY t.name COLLATE NOCASE`).all(src)
        : d.prepare(`SELECT t.id, t.name, t.parent_id, (SELECT COUNT(*) FROM item_tags i WHERE i.tag_id = t.id) n FROM tags t ORDER BY t.name COLLATE NOCASE`).all();
    return rows.map(rowTag);
}

function findTag(name, parentId) {
    return need().prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE AND IFNULL(parent_id, 0) = ?').get(name, parentId || 0) || null;
}

/** A tag by name (made when missing, as typing a new tag in Add Tags does). */
function ensureTag(name, parentId = null) {
    const c = cleanTagName(name);
    if (c.error) throw new Error(c.error);
    const hit = findTag(c.name, parentId);
    if (hit) return hit.id;
    return Number(need().prepare('INSERT INTO tags (name, parent_id, created_at) VALUES (?, ?, ?)').run(c.name, parentId || null, now()).lastInsertRowid);
}

function descendants(id) {
    const d = need();
    const out = [id];
    for (let i = 0; i < out.length; i += 1) {
        for (const r of d.prepare('SELECT id FROM tags WHERE parent_id = ?').all(out[i])) out.push(r.id);
    }
    return out;
}

/**
 * Tags tree edits: create {name, parentId}, rename {id, name}, delete {id} (WPG 2780: gone from every picture),
 * merge {id, into} (1808: the two tags and their sub-tags merge), move {id, parentId}.
 */
function editTag(op) {
    const d = need();
    const kind = String(op && op.op || '');
    const id = op && op.id != null ? Number(op.id) : null;
    if (kind === 'create') return { id: ensureTag(op.name, op.parentId ? Number(op.parentId) : null) };
    const tag = id ? d.prepare('SELECT * FROM tags WHERE id = ?').get(id) : null;
    if (!tag) throw new Error('No such tag');
    if (kind === 'rename') {
        const c = cleanTagName(op.name);
        if (c.error) throw new Error(c.error);
        const clash = findTag(c.name, tag.parent_id);
        if (clash && clash.id !== id) return { conflict: true, id: clash.id }; // the client offers the merge (1808)
        d.prepare('UPDATE tags SET name = ? WHERE id = ?').run(c.name, id);
        return { id };
    }
    if (kind === 'delete') {
        d.prepare('DELETE FROM tags WHERE id = ?').run(id);
        return { id };
    }
    if (kind === 'move') {
        const parentId = op.parentId ? Number(op.parentId) : null;
        if (parentId && descendants(id).includes(parentId)) throw new Error('A tag cannot go under its own sub-tag');
        d.prepare('UPDATE tags SET parent_id = ? WHERE id = ?').run(parentId, id);
        return { id };
    }
    if (kind === 'merge') {
        const into = Number(op.into);
        if (!into || into === id || !d.prepare('SELECT 1 FROM tags WHERE id = ?').get(into)) throw new Error('No tag to merge into');
        d.transaction(() => {
            d.prepare('INSERT OR IGNORE INTO item_tags (source, item_key, tag_id) SELECT source, item_key, ? FROM item_tags WHERE tag_id = ?').run(into, id);
            for (const child of d.prepare('SELECT id, name FROM tags WHERE parent_id = ?').all(id)) {
                const same = findTag(child.name, into);
                if (same) editTag({ op: 'merge', id: child.id, into: same.id });
                else d.prepare('UPDATE tags SET parent_id = ? WHERE id = ?').run(into, child.id);
            }
            d.prepare('DELETE FROM tags WHERE id = ?').run(id);
        })();
        return { id: into };
    }
    throw new Error(`Unknown tag operation ${kind}`);
}

/** Captions, tags, date taken and favourite for the pictures asked about (the Info pane, Tiles). */
function getMeta(items) {
    const d = need();
    const list = cleanItems(items);
    const cap = d.prepare('SELECT caption FROM captions WHERE source = ? AND item_key = ?');
    const tg = d.prepare('SELECT tag_id FROM item_tags WHERE source = ? AND item_key = ?');
    const tk = d.prepare('SELECT taken_at FROM taken WHERE source = ? AND item_key = ?');
    const fv = d.prepare('SELECT 1 FROM favorites WHERE source = ? AND item_key = ?');
    return list.map(({ source, key }) => ({
        source,
        key,
        caption: (cap.get(source, key) || {}).caption || '',
        tags: tg.all(source, key).map((r) => r.tag_id),
        taken: (tk.get(source, key) || {}).taken_at || null,
        favorite: !!fv.get(source, key)
    }));
}

/**
 * One edit over the selection (the Info pane works on every selected picture):
 *   caption (string; '' clears), addTags [name | id], removeTags [id], clearTags true (Remove All Tags),
 *   taken (unix seconds) or takenShiftHours (Change Time Taken: -24..+24, needs each picture's current date in
 *   items[i].taken), favorite true/false.
 */
function setMeta(items, change) {
    const d = need();
    const list = cleanItems(items);
    if (!list.length) return { items: [] };
    const c = change || {};
    const addIds = [];
    for (const t of Array.isArray(c.addTags) ? c.addTags : []) addIds.push(typeof t === 'number' ? t : ensureTag(t));
    const removeIds = (Array.isArray(c.removeTags) ? c.removeTags : []).map(Number).filter(Boolean);
    const shift = Number(c.takenShiftHours);
    if (c.takenShiftHours != null && (!Number.isInteger(shift) || shift < -24 || shift > 24)) throw new Error('Please enter a value between -24 and +24.');
    const rawItems = Array.isArray(items) ? items : [];
    d.transaction(() => {
        list.forEach(({ source, key }, i) => {
            if (typeof c.caption === 'string') {
                const v = c.caption.slice(0, MAX_CAPTION);
                if (v.trim()) d.prepare('INSERT INTO captions (source, item_key, caption, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(source, item_key) DO UPDATE SET caption = excluded.caption, updated_at = excluded.updated_at').run(source, key, v, now());
                else d.prepare('DELETE FROM captions WHERE source = ? AND item_key = ?').run(source, key);
            }
            if (c.clearTags) d.prepare('DELETE FROM item_tags WHERE source = ? AND item_key = ?').run(source, key);
            for (const id of addIds) d.prepare('INSERT OR IGNORE INTO item_tags (source, item_key, tag_id) VALUES (?, ?, ?)').run(source, key, id);
            for (const id of removeIds) d.prepare('DELETE FROM item_tags WHERE source = ? AND item_key = ? AND tag_id = ?').run(source, key, id);
            let takenAt = null;
            if (c.taken != null) takenAt = Math.floor(Number(c.taken));
            else if (c.takenShiftHours != null) {
                const base = Number((rawItems[i] && rawItems[i].taken) || (d.prepare('SELECT taken_at FROM taken WHERE source = ? AND item_key = ?').get(source, key) || {}).taken_at);
                if (Number.isFinite(base) && base > 0) takenAt = Math.floor(base + shift * 3600);
            }
            if (takenAt != null && Number.isFinite(takenAt)) d.prepare('INSERT INTO taken (source, item_key, taken_at) VALUES (?, ?, ?) ON CONFLICT(source, item_key) DO UPDATE SET taken_at = excluded.taken_at').run(source, key, takenAt);
            if (c.favorite === true) d.prepare('INSERT OR IGNORE INTO favorites (source, item_key, added_at) VALUES (?, ?, ?)').run(source, key, now());
            else if (c.favorite === false) d.prepare('DELETE FROM favorites WHERE source = ? AND item_key = ?').run(source, key);
        });
    })();
    return { items: getMeta(list) };
}

/** Pictures carrying the tags (and their sub-tags), for a Tags tree node; one source or all. */
function tagItems(tagIds, source) {
    const d = need();
    const ids = new Set();
    for (const t of Array.isArray(tagIds) ? tagIds : [tagIds]) if (Number(t)) descendants(Number(t)).forEach((x) => ids.add(x));
    if (!ids.size) return [];
    const src = source ? cleanSource(source) : null;
    const marks = [...ids].map(() => '?').join(',');
    const rows = src
        ? d.prepare(`SELECT DISTINCT source, item_key FROM item_tags WHERE tag_id IN (${marks}) AND source = ?`).all(...ids, src)
        : d.prepare(`SELECT DISTINCT source, item_key FROM item_tags WHERE tag_id IN (${marks})`).all(...ids);
    return rows.map((r) => ({ source: r.source, key: r.item_key }));
}

/** Every tagged / captioned / favourite picture of a source, so the client can tell Not Tagged and search captions. */
function sourceIndex(source) {
    const d = need();
    const src = cleanSource(source);
    if (!src) return { tagged: [], captions: [], favorites: [], taken: [] };
    return {
        tagged: d.prepare('SELECT item_key k, GROUP_CONCAT(tag_id) t FROM item_tags WHERE source = ? GROUP BY item_key').all(src).map((r) => ({ key: r.k, tags: String(r.t).split(',').map(Number) })),
        captions: d.prepare('SELECT item_key k, caption c FROM captions WHERE source = ?').all(src).map((r) => ({ key: r.k, caption: r.c })),
        favorites: d.prepare('SELECT item_key k FROM favorites WHERE source = ? ORDER BY added_at DESC').all(src).map((r) => r.k),
        taken: d.prepare('SELECT item_key k, taken_at t FROM taken WHERE source = ?').all(src).map((r) => ({ key: r.k, taken: r.t }))
    };
}

/** Pictures Favorites (the phone syncs these to its Pictures & Videos Favorites). */
function favorites(source) {
    const d = need();
    const src = source ? cleanSource(source) : null;
    const rows = src
        ? d.prepare('SELECT source, item_key, added_at FROM favorites WHERE source = ? ORDER BY added_at DESC').all(src)
        : d.prepare('SELECT source, item_key, added_at FROM favorites ORDER BY added_at DESC').all();
    return rows.map((r) => ({ source: r.source, key: r.item_key, added: r.added_at }));
}

/** Folders: the watched VFS folders (Add Folder to Gallery / Remove from Gallery). */
function watched() {
    return need().prepare('SELECT folder, name, added_at FROM watched ORDER BY name COLLATE NOCASE').all()
        .map((r) => ({ folder: r.folder, name: r.name || '', added: r.added_at }));
}

function setWatched({ add, remove } = {}) {
    const d = need();
    d.transaction(() => {
        for (const f of Array.isArray(add) ? add.slice(0, 500) : []) {
            const folder = String(f && f.folder || '').slice(0, MAX_KEY);
            if (folder) d.prepare('INSERT INTO watched (folder, name, added_at) VALUES (?, ?, ?) ON CONFLICT(folder) DO UPDATE SET name = excluded.name').run(folder, String(f.name || '').slice(0, 255), now());
        }
        for (const f of Array.isArray(remove) ? remove.slice(0, 500) : []) d.prepare('DELETE FROM watched WHERE folder = ?').run(String(f || ''));
    })();
    return watched();
}

/** A picture left its store (deleted for good): forget what the gallery kept about it. */
function forget(items) {
    const d = need();
    const list = cleanItems(items);
    d.transaction(() => {
        for (const { source, key } of list) {
            for (const t of ['item_tags', 'captions', 'taken', 'favorites']) d.prepare(`DELETE FROM ${t} WHERE source = ? AND item_key = ?`).run(source, key);
        }
    })();
    return list.length;
}

function close() {
    if (db) { try { db.close(); } catch (_) { /* closed */ } }
    db = null;
}

module.exports = {
    init,
    listTags,
    editTag,
    ensureTag,
    getMeta,
    setMeta,
    tagItems,
    sourceIndex,
    favorites,
    watched,
    setWatched,
    forget,
    close,
    _cleanTagName: cleanTagName
};
