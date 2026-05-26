/**
 * SQLite access for NAXT (NAX tag galleries). Used by WebSocket handlers and image proxy.
 * DB built by scripts/import-nax-tags.js → .cache/nax_tags.db
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

let DB_PATH = null;

/** Artist style pairs share favorites by tag name. */
const NAX_FAVORITE_MERGE_GROUPS = [
    ['danbooru-artist-tags-v4.5', 'danbooru-artist-tags-2-v4.5']
];

let db = null;

function ensureCacheDir() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function getDb() {
    if (!fs.existsSync(DB_PATH)) {
        return null;
    }
    if (!db) {
        try {
            db = new Database(DB_PATH, { readonly: false });
            db.pragma('journal_mode = WAL');
            db.pragma('foreign_keys = ON');
            migrateSchema(db);
            propagateFavoritesInMergeGroups(db);
            propagateTryMarksInMergeGroups(db);
        } catch {
            db = null;
        }
    }
    return db;
}

function migrateSchema(d) {
    const cols = d.prepare('PRAGMA table_info(nax_tags)').all();
    if (!cols.some((c) => c.name === 'is_custom')) {
        d.exec('ALTER TABLE nax_tags ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0');
    }
    if (!cols.some((c) => c.name === 'try_mark')) {
        d.exec('ALTER TABLE nax_tags ADD COLUMN try_mark INTEGER NOT NULL DEFAULT 0');
    }
}

function getSlugsInMergeGroupFor(slug, d) {
    const database = d || getDb();
    if (!database) return [slug];
    for (const group of NAX_FAVORITE_MERGE_GROUPS) {
        if (group.includes(slug)) {
            return group.filter((s) => {
                const row = database.prepare('SELECT 1 AS ok FROM nax_galleries WHERE slug = ?').get(s);
                return !!row;
            });
        }
    }
    return [slug];
}

function propagateFavoritesInMergeGroups(d) {
    for (const group of NAX_FAVORITE_MERGE_GROUPS) {
        const existingSlugs = group.filter((s) => {
            const row = d.prepare('SELECT 1 AS ok FROM nax_galleries WHERE slug = ?').get(s);
            return !!row;
        });
        if (existingSlugs.length < 2) continue;

        const placeholders = existingSlugs.map(() => '?').join(', ');
        const favTags = d.prepare(`
            SELECT DISTINCT tag FROM nax_tags
            WHERE gallery_slug IN (${placeholders}) AND favorite = 1
        `).all(...existingSlugs);

        const sync = d.prepare(`
            UPDATE nax_tags SET favorite = 1
            WHERE tag = ? AND gallery_slug IN (${placeholders})
        `);
        const tx = d.transaction((tags) => {
            for (const { tag } of tags) {
                sync.run(tag, ...existingSlugs);
            }
        });
        tx(favTags);
    }
}

function propagateTryMarksInMergeGroups(d) {
    for (const group of NAX_FAVORITE_MERGE_GROUPS) {
        const existingSlugs = group.filter((s) => {
            const row = d.prepare('SELECT 1 AS ok FROM nax_galleries WHERE slug = ?').get(s);
            return !!row;
        });
        if (existingSlugs.length < 2) continue;

        const placeholders = existingSlugs.map(() => '?').join(', ');
        const tryTags = d.prepare(`
            SELECT DISTINCT tag FROM nax_tags
            WHERE gallery_slug IN (${placeholders}) AND try_mark = 1
        `).all(...existingSlugs);

        const sync = d.prepare(`
            UPDATE nax_tags SET try_mark = 1
            WHERE tag = ? AND gallery_slug IN (${placeholders})
        `);
        const tx = d.transaction((tags) => {
            for (const { tag } of tags) {
                sync.run(tag, ...existingSlugs);
            }
        });
        tx(tryTags);
    }
}

/**
 * Called from globalResources during server startup. Opens DB when import has created the file.
 * @returns {boolean}
 */
function initializeNaxTagsDatabase(naxTagsDbPath) {
    DB_PATH = naxTagsDbPath;
    ensureCacheDir();
    if (!fs.existsSync(DB_PATH)) {
        console.log('   - NAX tags database not found (optional); run scripts/import-nax-tags.js to enable NAXT');
        return true;
    }
    try {
        const probe = new Database(DB_PATH, { readonly: true });
        probe.prepare('SELECT 1').get();
        probe.close();
    } catch (e) {
        console.warn('   ⚠️ NAX tags database is not readable SQLite; NAXT data features offline:', e.message);
        return true;
    }
    const d = getDb();
    if (!d) {
        console.error('   ❌ NAX tags database failed to open after integrity check');
        return false;
    }
    return true;
}

/** Gallery keys from NAX export can include dots (e.g. artists-v4.5); still block path metacharacters. */
function isValidSlug(slug) {
    if (typeof slug !== 'string' || !slug.length) return false;
    if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) return false;
    return /^[a-z0-9._-]+$/i.test(slug);
}

function mapTagRow(r) {
    return {
        id: r.id,
        gallerySlug: r.gallerySlug,
        tag: r.tag,
        filename: r.filename,
        upvotes: r.upvotes,
        downvotes: r.downvotes,
        score: r.score,
        favorite: !!r.favorite,
        tryMark: !!(r.tryMark != null ? r.tryMark : r.try_mark),
        exportIndex: r.exportIndex,
        isCustom: !!r.isCustom
    };
}

function getGalleries() {
    const d = getDb();
    if (!d) return [];
    return d.prepare(`
        SELECT slug, title, version, description, tag_count
        FROM nax_galleries
        ORDER BY
            CASE WHEN version LIKE '%4.5%' THEN 0 ELSE 1 END,
            title COLLATE NOCASE
    `).all();
}

function slugExists(slug) {
    if (!isValidSlug(slug)) return false;
    const d = getDb();
    if (!d) return false;
    const row = d.prepare('SELECT 1 AS ok FROM nax_galleries WHERE slug = ?').get(slug);
    return !!row;
}

function tagExists(gallerySlug, tag) {
    const d = getDb();
    if (!d) return false;
    const row = d.prepare(
        'SELECT 1 AS ok FROM nax_tags WHERE gallery_slug = ? AND tag = ?'
    ).get(gallerySlug, tag);
    return !!row;
}

function getTagRow(gallerySlug, tag) {
    const d = getDb();
    if (!d) return null;
    const row = d.prepare(`
        SELECT id, gallery_slug AS gallerySlug, tag, filename, upvotes, downvotes, score,
               favorite, try_mark AS tryMark, export_index AS exportIndex, is_custom AS isCustom
        FROM nax_tags WHERE gallery_slug = ? AND tag = ?
    `).get(gallerySlug, tag);
    return row ? mapTagRow(row) : null;
}

function getTagFilename(slug, tag) {
    const d = getDb();
    if (!d) return null;
    const row = d.prepare(
        'SELECT filename FROM nax_tags WHERE gallery_slug = ? AND tag = ?'
    ).get(slug, tag);
    return row ? row.filename : null;
}

/**
 * @param {object} opts
 * @returns {{ items: object[], total: number, hasMore: boolean }}
 */
function queryTags(opts) {
    const d = getDb();
    if (!d) {
        return { items: [], total: 0, hasMore: false };
    }

    const {
        gallerySlug,
        query = '',
        sort = 'score',
        invert = false,
        minUp = null,
        maxUp = null,
        minDown = null,
        maxDown = null,
        minScore = null,
        maxScore = null,
        minRatio = null,
        maxRatio = null,
        randomSeed = null,
        markFilter = 'all',
        offset = 0,
        limit = 50
    } = opts;

    if (!isValidSlug(gallerySlug)) {
        return { items: [], total: 0, hasMore: false };
    }

    const where = ['gallery_slug = ?'];
    const params = [gallerySlug];

    if (query && String(query).trim()) {
        where.push('instr(lower(tag), lower(?)) > 0');
        params.push(String(query).trim());
    }

    const addNum = (col, minV, maxV) => {
        if (minV !== null && minV !== undefined && minV !== '' && !Number.isNaN(Number(minV))) {
            where.push(`${col} >= ?`);
            params.push(Number(minV));
        }
        if (maxV !== null && maxV !== undefined && maxV !== '' && !Number.isNaN(Number(maxV))) {
            where.push(`${col} <= ?`);
            params.push(Number(maxV));
        }
    };

    addNum('upvotes', minUp, maxUp);
    addNum('downvotes', minDown, maxDown);
    addNum('score', minScore, maxScore);

    const addRatio = (minR, maxR) => {
        const ratioExpr = '(1.0 * upvotes / (upvotes + downvotes))';
        if (minR !== null && minR !== undefined && minR !== '' && !Number.isNaN(Number(minR))) {
            where.push(`(upvotes + downvotes) > 0 AND ${ratioExpr} >= ?`);
            params.push(Number(minR));
        }
        if (maxR !== null && maxR !== undefined && maxR !== '' && !Number.isNaN(Number(maxR))) {
            where.push(`(upvotes + downvotes) > 0 AND ${ratioExpr} <= ?`);
            params.push(Number(maxR));
        }
    };
    addRatio(minRatio, maxRatio);

    const mark = String(markFilter || 'all').toLowerCase();
    if (mark === 'favorites') {
        where.push('favorite = 1');
    } else if (mark === 'try') {
        where.push('try_mark = 1');
    } else if (mark === 'unmarked') {
        where.push('favorite = 0 AND try_mark = 0');
    }

    const whereSql = where.join(' AND ');

    const totalRow = d.prepare(`SELECT COUNT(*) AS c FROM nax_tags WHERE ${whereSql}`).get(...params);
    const total = totalRow ? totalRow.c : 0;

    const ratioOrderExpr = 'COALESCE(1.0 * upvotes / NULLIF(upvotes + downvotes, 0), -1)';
    const pinnedFirstExpr = '(CASE WHEN favorite = 1 OR is_custom = 1 OR try_mark = 1 THEN 0 ELSE 1 END)';

    const orderExtraParams = [];
    let orderBy;
    if (sort === 'name') {
        orderBy = invert ? 'tag COLLATE NOCASE DESC' : 'tag COLLATE NOCASE ASC';
    } else if (sort === 'date') {
        const dateDir = invert ? 'DESC' : 'ASC';
        orderBy = `${pinnedFirstExpr} ASC, export_index ${dateDir}, tag COLLATE NOCASE ASC`;
    } else if (sort === 'ratio') {
        const ratioDir = invert ? 'ASC' : 'DESC';
        orderBy = `(CASE WHEN favorite = 1 OR is_custom = 1 OR try_mark = 1 THEN 2.0 ELSE ${ratioOrderExpr} END) ${ratioDir}, tag COLLATE NOCASE ASC`;
    } else if (sort === 'random') {
        const seed = Number.isFinite(Number(randomSeed)) ? Math.floor(Number(randomSeed)) : 0;
        orderBy = `${pinnedFirstExpr} ASC, ((id * 1103515245) + ?) & 2147483647, id`;
        orderExtraParams.push(seed);
    } else {
        const scoreDir = invert ? 'ASC' : 'DESC';
        orderBy = `(CASE WHEN favorite = 1 OR is_custom = 1 OR try_mark = 1 THEN 100000 ELSE score END) ${scoreDir}, tag COLLATE NOCASE ASC`;
    }

    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const off = Math.max(Number(offset) || 0, 0);

    const rows = d.prepare(`
        SELECT id, gallery_slug AS gallerySlug, tag, filename, upvotes, downvotes, score,
               favorite, try_mark AS tryMark, export_index AS exportIndex, is_custom AS isCustom
        FROM nax_tags
        WHERE ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
    `).all(...params, ...orderExtraParams, lim, off);

    const items = rows.map(mapTagRow);

    return {
        items,
        total,
        hasMore: off + items.length < total
    };
}

function setFavorite(gallerySlug, tag, favorite) {
    const d = getDb();
    if (!d) {
        throw new Error('NAX database not found; run scripts/import-nax-tags.js');
    }
    if (!isValidSlug(gallerySlug) || !tag) {
        throw new Error('Invalid gallery or tag');
    }
    const exists = d.prepare(
        'SELECT 1 AS ok FROM nax_tags WHERE gallery_slug = ? AND tag = ?'
    ).get(gallerySlug, tag);
    if (!exists) {
        throw new Error('Tag not found');
    }

    const slugs = getSlugsInMergeGroupFor(gallerySlug, d);
    const fav = favorite ? 1 : 0;

    const update = d.prepare(
        'UPDATE nax_tags SET favorite = ? WHERE gallery_slug = ? AND tag = ?'
    );
    const tx = d.transaction(() => {
        for (const slug of slugs) {
            update.run(fav, slug, tag);
        }
    });
    tx();

    return { favorite: fav === 1 };
}

function setTryMark(gallerySlug, tag, tryMark) {
    const d = getDb();
    if (!d) {
        throw new Error('NAX database not found; run scripts/import-nax-tags.js');
    }
    if (!isValidSlug(gallerySlug) || !tag) {
        throw new Error('Invalid gallery or tag');
    }
    const exists = d.prepare(
        'SELECT 1 AS ok FROM nax_tags WHERE gallery_slug = ? AND tag = ?'
    ).get(gallerySlug, tag);
    if (!exists) {
        throw new Error('Tag not found');
    }

    const slugs = getSlugsInMergeGroupFor(gallerySlug, d);
    const mark = tryMark ? 1 : 0;

    const update = d.prepare(
        'UPDATE nax_tags SET try_mark = ? WHERE gallery_slug = ? AND tag = ?'
    );
    const tx = d.transaction(() => {
        for (const slug of slugs) {
            update.run(mark, slug, tag);
        }
    });
    tx();

    return { tryMark: mark === 1 };
}

function insertCustomTag(gallerySlug, tag, filename) {
    const d = getDb();
    if (!d) {
        throw new Error('NAX database not found; run scripts/import-nax-tags.js');
    }
    if (!isValidSlug(gallerySlug) || !tag || !filename) {
        throw new Error('Invalid gallery, tag, or filename');
    }
    if (!slugExists(gallerySlug)) {
        throw new Error('Unknown gallery');
    }
    if (tagExists(gallerySlug, tag)) {
        throw new Error('Tag already exists in this gallery');
    }

    const maxRow = d.prepare(
        'SELECT COALESCE(MAX(export_index), -1) AS m FROM nax_tags WHERE gallery_slug = ?'
    ).get(gallerySlug);
    const exportIndex = (maxRow ? maxRow.m : -1) + 1;

    const tx = d.transaction(() => {
        d.prepare(`
            INSERT INTO nax_tags (gallery_slug, tag, filename, upvotes, downvotes, score, favorite, export_index, is_custom)
            VALUES (?, ?, ?, 0, 0, 0, 0, ?, 1)
        `).run(gallerySlug, tag, filename, exportIndex);
        d.prepare('UPDATE nax_galleries SET tag_count = tag_count + 1 WHERE slug = ?').run(gallerySlug);
    });
    tx();

    return getTagRow(gallerySlug, tag);
}

function deleteCustomTag(gallerySlug, tag) {
    const d = getDb();
    if (!d) {
        throw new Error('NAX database not found; run scripts/import-nax-tags.js');
    }
    if (!isValidSlug(gallerySlug) || !tag) {
        throw new Error('Invalid gallery or tag');
    }

    const row = d.prepare(
        'SELECT filename, is_custom AS isCustom FROM nax_tags WHERE gallery_slug = ? AND tag = ?'
    ).get(gallerySlug, tag);
    if (!row) {
        throw new Error('Tag not found');
    }
    if (!row.isCustom) {
        throw new Error('Only custom tags can be deleted');
    }

    const info = d.prepare(
        'DELETE FROM nax_tags WHERE gallery_slug = ? AND tag = ? AND is_custom = 1'
    ).run(gallerySlug, tag);
    if (info.changes === 0) {
        throw new Error('Tag not found');
    }

    d.prepare(`
        UPDATE nax_galleries
        SET tag_count = CASE WHEN tag_count > 0 THEN tag_count - 1 ELSE 0 END
        WHERE slug = ?
    `).run(gallerySlug);

    const imagePath = path.join(__dirname, '..', '.cache', 'nax_images', gallerySlug, row.filename);
    try {
        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
    } catch {
        /* */
    }

    return { deleted: true, gallerySlug, tag };
}

function closeDb() {
    if (db) {
        try {
            db.close();
        } catch {
            /* */
        }
        db = null;
    }
}

function shutdownNaxTagsDatabase() {
    closeDb();
}

/**
 * NAX JSON stores literal %-encoding in filenames (e.g. "suda%20ayaka.jpg"). Express may decode
 * the URL segment once or twice; try several candidates so the DB row always matches.
 * @param {string} rawFromUrl
 * @returns {string[]}
 */
function collectNaxFilenameLookupCandidates(rawFromUrl) {
    const out = [];
    const seen = new Set();
    const add = (s) => {
        if (typeof s !== 'string' || !s.length) return;
        if (seen.has(s)) return;
        seen.add(s);
        out.push(s);
    };
    add(String(rawFromUrl).trim());
    let cur = String(rawFromUrl).trim();
    for (let i = 0; i < 8; i++) {
        try {
            const next = decodeURIComponent(cur);
            if (next === cur) break;
            add(next);
            cur = next;
        } catch {
            break;
        }
    }
    for (const s of [...out]) {
        if (/\s/.test(s) && !/%[0-9a-fA-F]{2}/.test(s)) {
            add(s.replace(/\s+/g, '%20'));
        }
    }
    return out;
}

/**
 * Resolve a tag row by gallery slug and filename from the request path (image proxy).
 * @returns {{ filename: string } | null}
 */
function findTagByGalleryFilename(slug, filename) {
    const d = getDb();
    if (!d) return null;
    const stmt = d.prepare(
        'SELECT filename FROM nax_tags WHERE gallery_slug = ? AND filename = ? LIMIT 1'
    );
    for (const cand of collectNaxFilenameLookupCandidates(filename)) {
        const row = stmt.get(slug, cand);
        if (row) return row;
    }
    return null;
}

module.exports = {
    DB_PATH,
    NAX_FAVORITE_MERGE_GROUPS,
    initializeNaxTagsDatabase,
    shutdownNaxTagsDatabase,
    getDb,
    migrateSchema,
    propagateFavoritesInMergeGroups,
    propagateTryMarksInMergeGroups,
    getGalleries,
    slugExists,
    tagExists,
    getTagRow,
    getTagFilename,
    findTagByGalleryFilename,
    queryTags,
    setFavorite,
    setTryMark,
    insertCustomTag,
    deleteCustomTag,
    isValidSlug,
    closeDb
};
