/**
 * Incremental NAX tag sync. Downloads tags.zip, skips unchanged payloads
 * (ETag / Last-Modified / sha256), and applies added, updated, and removed
 * official tags in one transaction. Favorites, try marks, hidden marks, and
 * custom tags stay. Does not drop the database, restart Dreamscape, or
 * notify the service worker.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');

const DEFAULT_URL = 'https://nax.moe/downloads/tags.zip';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nax_galleries (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT,
    tag_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS nax_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gallery_slug TEXT NOT NULL,
    tag TEXT NOT NULL,
    filename TEXT NOT NULL,
    upvotes INTEGER NOT NULL,
    downvotes INTEGER NOT NULL,
    score INTEGER NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    try_mark INTEGER NOT NULL DEFAULT 0,
    hidden_mark INTEGER NOT NULL DEFAULT 0,
    export_index INTEGER NOT NULL DEFAULT 0,
    is_custom INTEGER NOT NULL DEFAULT 0,
    UNIQUE(gallery_slug, tag),
    FOREIGN KEY (gallery_slug) REFERENCES nax_galleries(slug)
);
CREATE INDEX IF NOT EXISTS idx_nax_tags_gallery ON nax_tags(gallery_slug);
CREATE INDEX IF NOT EXISTS idx_nax_tags_gallery_export ON nax_tags(gallery_slug, export_index);
`;

function downloadError(message) {
    const err = new Error(message);
    err.code = 'NAX_DOWNLOAD';
    return err;
}

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function statePath(stateDir) {
    return path.join(stateDir, 'state.json');
}

function readState(stateDir) {
    try {
        const raw = fs.readFileSync(statePath(stateDir), 'utf8');
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : {};
    } catch (_err) {
        return {};
    }
}

function writeState(stateDir, rec) {
    fs.mkdirSync(stateDir, { recursive: true });
    const next = {
        etag: rec.etag || null,
        lastModified: rec.lastModified || null,
        sha256: rec.sha256 || null,
        savedAt: new Date().toISOString()
    };
    const tmp = path.join(stateDir, `state.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, statePath(stateDir));
    return next;
}

function sameValidators(state, next) {
    return !!state
        && state.etag === next.etag
        && state.lastModified === next.lastModified
        && state.sha256 === next.sha256;
}

function headerValue(res, name) {
    if (!res || !res.headers || typeof res.headers.get !== 'function') return null;
    const value = res.headers.get(name);
    return value ? String(value) : null;
}

async function fetchTagsZip({ url, state, fetchImpl }) {
    const fetchFn = fetchImpl || globalThis.fetch;
    if (typeof fetchFn !== 'function') {
        throw downloadError('fetch is not available');
    }
    const headers = { 'user-agent': 'dreamscape-nax-tag-sync' };
    if (state && state.etag) headers['If-None-Match'] = state.etag;
    if (state && state.lastModified) headers['If-Modified-Since'] = state.lastModified;
    const res = await fetchFn(url || DEFAULT_URL, { headers });
    const etag = headerValue(res, 'etag') || (state && state.etag) || null;
    const lastModified = headerValue(res, 'last-modified') || (state && state.lastModified) || null;
    if (res.status === 304) {
        return {
            unchanged: true,
            reason: 'not-modified',
            etag,
            lastModified,
            sha256: state && state.sha256 ? state.sha256 : null
        };
    }
    if (!res.ok) throw downloadError(`tags.zip download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw downloadError('tags.zip download was empty');
    const digest = sha256(buf);
    if (state && state.sha256 && state.sha256 === digest) {
        return { unchanged: true, reason: 'sha256', etag, lastModified, sha256: digest };
    }
    return { unchanged: false, body: buf, sha256: digest, etag, lastModified };
}

function tagsFromExport(data) {
    const rows = [];
    const galleries = [];
    for (const [slug, gallery] of Object.entries(data.galleries)) {
        if (!gallery || typeof gallery !== 'object' || !Array.isArray(gallery.tags)) {
            throw downloadError(`gallery ${slug} has no tags array`);
        }
        galleries.push({
            slug,
            title: gallery.title || slug,
            version: gallery.version || '',
            description: gallery.description || ''
        });
        gallery.tags.forEach((tag, index) => {
            const votes = tag && tag.votes && typeof tag.votes === 'object' ? tag.votes : {};
            const name = tag && tag.tag != null ? String(tag.tag) : '';
            if (!name) throw downloadError(`gallery ${slug} has a tag with no name`);
            rows.push({
                gallery_slug: slug,
                tag: name,
                filename: tag.filename != null ? String(tag.filename) : '',
                upvotes: Number(votes.up) || 0,
                downvotes: Number(votes.down) || 0,
                score: Number(votes.score) || 0,
                export_index: index
            });
        });
    }
    return { rows, galleries };
}

function parseTagsZip(buf) {
    if (!buf || !buf.length) throw downloadError('tags.zip download was empty');
    let zip;
    try {
        zip = new AdmZip(buf);
    } catch (_err) {
        throw downloadError('tags.zip is not a valid zip');
    }
    const entry = zip.getEntry('tags.json');
    if (!entry) throw downloadError('tags.zip has no tags.json');
    let data;
    try {
        data = JSON.parse(entry.getData().toString('utf8'));
    } catch (_err) {
        throw downloadError('tags.json is not valid JSON');
    }
    if (!data || typeof data.galleries !== 'object' || Array.isArray(data.galleries)) {
        throw downloadError('tags export is empty or invalid');
    }
    if (!Object.keys(data.galleries).length) throw downloadError('tags export is empty or invalid');
    const parsed = tagsFromExport(data);
    if (!parsed.rows.length) throw downloadError('tags export contains no tags');
    return parsed;
}

function openDb(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 10000');
    return db;
}

function ensureSchema(db) {
    db.exec(SCHEMA);
    const cols = db.prepare('PRAGMA table_info(nax_tags)').all();
    if (!cols.some((col) => col.name === 'is_custom')) {
        db.exec('ALTER TABLE nax_tags ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0');
    }
    if (!cols.some((col) => col.name === 'try_mark')) {
        db.exec('ALTER TABLE nax_tags ADD COLUMN try_mark INTEGER NOT NULL DEFAULT 0');
    }
    if (!cols.some((col) => col.name === 'hidden_mark')) {
        db.exec('ALTER TABLE nax_tags ADD COLUMN hidden_mark INTEGER NOT NULL DEFAULT 0');
    }
}

function tagKey(row) {
    return `${row.gallery_slug}\0${row.tag}`;
}

function applyIncremental(db, parsed) {
    ensureSchema(db);
    const existing = db.prepare(`
        SELECT gallery_slug, tag, filename, upvotes, downvotes, score, export_index, is_custom
        FROM nax_tags
    `).all();
    const byKey = new Map(existing.map((row) => [tagKey(row), row]));
    const seen = new Set();
    const added = [];
    const updated = [];
    for (const row of parsed.rows) {
        const key = tagKey(row);
        seen.add(key);
        const prev = byKey.get(key);
        if (!prev) {
            added.push(row);
            continue;
        }
        const changed = prev.is_custom
            || prev.filename !== row.filename
            || Number(prev.upvotes) !== row.upvotes
            || Number(prev.downvotes) !== row.downvotes
            || Number(prev.score) !== row.score
            || Number(prev.export_index) !== row.export_index;
        if (changed) updated.push(row);
    }
    const removed = existing.filter((row) => !row.is_custom && !seen.has(tagKey(row)));

    const insert = db.prepare(`
        INSERT INTO nax_tags (
            gallery_slug, tag, filename, upvotes, downvotes, score,
            favorite, try_mark, hidden_mark, export_index, is_custom
        ) VALUES (
            @gallery_slug, @tag, @filename, @upvotes, @downvotes, @score,
            0, 0, 0, @export_index, 0
        )
    `);
    const update = db.prepare(`
        UPDATE nax_tags
        SET filename = @filename, upvotes = @upvotes, downvotes = @downvotes,
            score = @score, export_index = @export_index, is_custom = 0
        WHERE gallery_slug = @gallery_slug AND tag = @tag
    `);
    const del = db.prepare('DELETE FROM nax_tags WHERE gallery_slug = ? AND tag = ? AND is_custom = 0');
    const upsertGallery = db.prepare(`
        INSERT INTO nax_galleries (slug, title, version, description, tag_count)
        VALUES (@slug, @title, @version, @description, 0)
        ON CONFLICT(slug) DO UPDATE SET
            title = excluded.title,
            version = excluded.version,
            description = excluded.description
    `);
    const countTags = db.prepare('SELECT COUNT(*) AS n FROM nax_tags WHERE gallery_slug = ?');
    const setCount = db.prepare('UPDATE nax_galleries SET tag_count = ? WHERE slug = ?');
    const deleteGallery = db.prepare('DELETE FROM nax_galleries WHERE slug = ?');
    const previousSlugs = db.prepare('SELECT slug FROM nax_galleries').all().map((row) => row.slug);
    const exportSlugs = new Set(parsed.galleries.map((gallery) => gallery.slug));

    const tx = db.transaction(() => {
        let addedN = 0;
        let updatedN = 0;
        let removedN = 0;
        for (const gallery of parsed.galleries) upsertGallery.run(gallery);
        for (const row of added) addedN += insert.run(row).changes;
        for (const row of updated) updatedN += update.run(row).changes;
        for (const row of removed) removedN += del.run(row.gallery_slug, row.tag).changes;
        const slugs = new Set([...previousSlugs, ...exportSlugs]);
        for (const slug of slugs) {
            const left = countTags.get(slug).n;
            if (!exportSlugs.has(slug) && !left) deleteGallery.run(slug);
            else setCount.run(left, slug);
        }
        const { propagateFavoritesInMergeGroups, propagateTryMarksInMergeGroups } = require('./naxTagsDatabase');
        propagateFavoritesInMergeGroups(db);
        propagateTryMarksInMergeGroups(db);
        return { added: addedN, updated: updatedN, removed: removedN };
    });
    return tx();
}

function snapshotTags(dbPath) {
    if (!fs.existsSync(dbPath)) return null;
    const db = new Database(dbPath, { readonly: true });
    try {
        return db.prepare(`
            SELECT gallery_slug, tag, filename, upvotes, downvotes, score, favorite, try_mark, hidden_mark, is_custom, export_index
            FROM nax_tags ORDER BY gallery_slug, tag
        `).all();
    } finally {
        db.close();
    }
}

async function syncNaxTags(options) {
    const opts = options || {};
    const stateDir = opts.stateDir;
    const dbPath = opts.dbPath;
    if (!stateDir || !dbPath) throw new Error('stateDir and dbPath are required');
    fs.mkdirSync(stateDir, { recursive: true });
    const state = readState(stateDir);
    const fetched = await fetchTagsZip({
        url: opts.url || DEFAULT_URL,
        state,
        fetchImpl: opts.fetchImpl
    });
    if (fetched.unchanged) {
        const next = {
            etag: fetched.etag,
            lastModified: fetched.lastModified,
            sha256: fetched.sha256
        };
        if (!sameValidators(state, next)) writeState(stateDir, next);
        return { unchanged: true, reason: fetched.reason, added: 0, updated: 0, removed: 0 };
    }
    const parsed = parseTagsZip(fetched.body);
    const db = openDb(dbPath);
    let counts;
    try {
        counts = applyIncremental(db, parsed);
    } finally {
        db.close();
    }
    const zipPath = path.join(stateDir, 'tags.zip');
    const tmpZip = path.join(stateDir, `tags.zip.${process.pid}.tmp`);
    fs.writeFileSync(tmpZip, fetched.body);
    fs.renameSync(tmpZip, zipPath);
    writeState(stateDir, {
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        sha256: fetched.sha256
    });
    return { unchanged: false, sha256: fetched.sha256, ...counts };
}

module.exports = {
    DEFAULT_URL,
    sha256,
    readState,
    parseTagsZip,
    fetchTagsZip,
    applyIncremental,
    snapshotTags,
    syncNaxTags
};
