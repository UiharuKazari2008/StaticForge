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
    if (!cols.some((c) => c.name === 'hidden_mark')) {
        d.exec('ALTER TABLE nax_tags ADD COLUMN hidden_mark INTEGER NOT NULL DEFAULT 0');
    }
}

const NAX_ANY_RESOLVE_TAG_LIMIT = 100;
const NAX_HIDDEN_WHERE = '(hidden_mark = 0 OR hidden_mark IS NULL)';

/** Pin-to-top mode for Atelier sort: 0 none, 1 favorites, 2 try, 3 both */
const NAX_ELEVATE_NONE = 0;
const NAX_ELEVATE_FAVORITES = 1;
const NAX_ELEVATE_TRY = 2;
const NAX_ELEVATE_BOTH = 3;

function normalizeElevatePins(value) {
    if (value === true || value === 'true') return NAX_ELEVATE_FAVORITES;
    const n = Number(value);
    if (n === NAX_ELEVATE_FAVORITES || n === NAX_ELEVATE_TRY || n === NAX_ELEVATE_BOTH) return n;
    return NAX_ELEVATE_NONE;
}

function naxPinMatchSql(elevatePins) {
    const mode = normalizeElevatePins(elevatePins);
    if (mode === NAX_ELEVATE_NONE) return null;
    const parts = [];
    if (mode === NAX_ELEVATE_FAVORITES || mode === NAX_ELEVATE_BOTH) parts.push('favorite = 1');
    if (mode === NAX_ELEVATE_TRY || mode === NAX_ELEVATE_BOTH) parts.push('try_mark = 1');
    return parts.length ? parts.join(' OR ') : null;
}

function naxPinnedFirstExpr(elevatePins) {
    const match = naxPinMatchSql(elevatePins);
    if (!match) return '1';
    return `(CASE WHEN ${match} THEN 0 ELSE 1 END)`;
}

function naxPinnedBoostExpr(elevatePins, boostValue, elseExpr) {
    const match = naxPinMatchSql(elevatePins);
    if (!match) return elseExpr;
    return `(CASE WHEN ${match} THEN ${boostValue} ELSE ${elseExpr} END)`;
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
        hidden: !!(r.hiddenMark != null ? r.hiddenMark : r.hidden_mark),
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
               favorite, try_mark AS tryMark, hidden_mark AS hiddenMark, export_index AS exportIndex, is_custom AS isCustom
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
        elevatePins = 0,
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
    if (mark === 'hidden') {
        where.push('hidden_mark = 1');
    } else {
        where.push(NAX_HIDDEN_WHERE);
        if (mark === 'favorites') {
            where.push('favorite = 1');
        } else if (mark === 'try') {
            where.push('try_mark = 1');
        } else if (mark === 'unmarked') {
            where.push('favorite = 0 AND try_mark = 0');
        } else if (mark === 'custom') {
            where.push('is_custom = 1');
        }
    }

    const whereSql = where.join(' AND ');
    const pinMode = normalizeElevatePins(elevatePins);

    const totalRow = d.prepare(`SELECT COUNT(*) AS c FROM nax_tags WHERE ${whereSql}`).get(...params);
    const total = totalRow ? totalRow.c : 0;

    const ratioOrderExpr = 'COALESCE(1.0 * upvotes / NULLIF(upvotes + downvotes, 0), -1)';
    const pinnedFirstExpr = naxPinnedFirstExpr(pinMode);

    const orderExtraParams = [];
    let orderBy;
    if (sort === 'name') {
        orderBy = invert ? 'tag COLLATE NOCASE DESC' : 'tag COLLATE NOCASE ASC';
    } else if (sort === 'date') {
        const dateDir = invert ? 'DESC' : 'ASC';
        orderBy = `${pinnedFirstExpr} ASC, export_index ${dateDir}, tag COLLATE NOCASE ASC`;
    } else if (sort === 'ratio') {
        const ratioDir = invert ? 'ASC' : 'DESC';
        orderBy = `${naxPinnedBoostExpr(pinMode, '2.0', ratioOrderExpr)} ${ratioDir}, tag COLLATE NOCASE ASC`;
    } else if (sort === 'random') {
        const seed = Number.isFinite(Number(randomSeed)) ? Math.floor(Number(randomSeed)) : 0;
        orderBy = `${pinnedFirstExpr} ASC, ((id * 1103515245) + ?) & 2147483647, id`;
        orderExtraParams.push(seed);
    } else {
        const scoreDir = invert ? 'ASC' : 'DESC';
        orderBy = `${naxPinnedBoostExpr(pinMode, '100000', 'score')} ${scoreDir}, tag COLLATE NOCASE ASC`;
    }

    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const off = Math.max(Number(offset) || 0, 0);

    const rows = d.prepare(`
        SELECT id, gallery_slug AS gallerySlug, tag, filename, upvotes, downvotes, score,
               favorite, try_mark AS tryMark, hidden_mark AS hiddenMark, export_index AS exportIndex, is_custom AS isCustom
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

function setHiddenMark(gallerySlug, tag, hidden) {
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

    const mark = hidden ? 1 : 0;
    d.prepare(
        'UPDATE nax_tags SET hidden_mark = ? WHERE gallery_slug = ? AND tag = ?'
    ).run(mark, gallerySlug, tag);

    return { hidden: mark === 1 };
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

/** Friendly internal expander presets (!NAX_FAV_CHARA, !NAX_TRY_ARTIST, …). Resolved server-side only. */
const NAX_EXPANDER_PRESETS = [
    {
        id: 'CHARA',
        label: 'Character',
        description: 'Random marked character tag (v4 / v4.5 follows model)',
        resolveSlugs(model) {
            const v45 = isNaxModelV45(model);
            const primary = v45 ? 'danbooru-character-tags-v4.5' : 'danbooru-character-tags-v4';
            return existingGallerySlugs([
                primary,
                'danbooru-character-tags-v4.5',
                'danbooru-character-tags-v4'
            ]);
        }
    },
    {
        id: 'ARTIST',
        label: 'Artist',
        description: 'Random marked artist tag (v4 / v4.5 follows model; v4.5 pools constrained and loose)',
        resolveSlugs(model) {
            return artistGallerySlugsForModel(model);
        }
    },
    {
        id: 'CURATED',
        label: 'Curated Artist',
        description: 'Random marked curated artist (v4.5, plain tag prompt)',
        resolveSlugs(model) {
            return curatedArtistGallerySlugsForModel(model);
        }
    },
    {
        id: 'FACE',
        label: 'Face',
        description: 'Random marked face tag (v4 / v4.5 follows model)',
        resolveSlugs(model) {
            const v45 = isNaxModelV45(model);
            const primary = v45 ? 'danbooru-face-tags-v4.5' : 'danbooru-face-tags-v4';
            return existingGallerySlugs([primary, 'danbooru-face-tags-v4.5', 'danbooru-face-tags-v4']);
        }
    },
    {
        id: 'COPYRIGHT',
        label: 'Copyright',
        description: 'Random marked copyright tag (v4.5)',
        resolveSlugs(model) {
            if (!isNaxModelV45(model)) return [];
            return existingGallerySlugs(['danbooru-copyright-tags-v4.5']);
        }
    },
    {
        id: 'HAIR',
        label: 'Hair',
        description: 'Random marked hair tag (v4.5)',
        resolveSlugs(model) {
            if (!isNaxModelV45(model)) return [];
            return existingGallerySlugs(['danbooru-hair-tags-v4.5']);
        }
    }
];

function isNaxModelV45(model) {
    if (!model) return true;
    const m = String(model).toLowerCase();
    return m.includes('4-5') || m.includes('4_5') || m.includes('4.5');
}

/** Version-locked danbooru artist-tag galleries (constrained + loose on v4.5). */
function artistGallerySlugsForModel(model) {
    if (isNaxModelV45(model)) {
        return existingGallerySlugs([
            'danbooru-artist-tags-v4.5',
            'danbooru-artist-tags-2-v4.5'
        ]);
    }
    return existingGallerySlugs(['danbooru-artist-tags-v4']);
}

/** Curated artist list — separate prompt style, v4.5 only. */
function curatedArtistGallerySlugsForModel(model) {
    if (!isNaxModelV45(model)) return [];
    return existingGallerySlugs(['artists-v4.5']);
}

function isNaxCuratedArtistGallery(gallerySlug) {
    const sl = String(gallerySlug || '').toLowerCase();
    return /^artists-v[\d.]+$/i.test(sl) || sl === 'artists-v4.5';
}

function existingGallerySlugs(candidates) {
    const known = new Set(getGalleries().map((g) => g.slug));
    const out = [];
    for (const slug of candidates) {
        if (slug && known.has(slug) && !out.includes(slug)) {
            out.push(slug);
        }
    }
    return out;
}

function getNaxExpanderPreset(presetId) {
    const id = String(presetId || '').trim().toUpperCase();
    if (!id) return null;
    return NAX_EXPANDER_PRESETS.find((p) => p.id === id) || null;
}

function formatTagForPrompt(tag, gallerySlug) {
    const name = String(tag || '').trim();
    if (!name) return '';
    if (isNaxCuratedArtistGallery(gallerySlug)) {
        return name;
    }
    const sl = String(gallerySlug || '').toLowerCase();
    if (sl.includes('artist')) {
        return /\s/.test(name) ? `art by ${name}` : `artist:${name}`;
    }
    return name;
}

/**
 * @param {string} gallerySlug
 * @param {'favorites'|'try'} markFilter
 * @returns {string|null} tag name
 */
function pickRandomMarkedTag(gallerySlug, markFilter) {
    const row = pickRandomMarkedTagFromSlugs([gallerySlug], markFilter);
    return row ? row.tag : null;
}

/**
 * @param {string[]} gallerySlugs
 * @param {'favorites'|'try'} markFilter
 * @returns {number}
 */
function countMarkedTagsInSlugs(gallerySlugs, markFilter) {
    const d = getDb();
    if (!d) return 0;
    const slugs = (gallerySlugs || []).filter((s) => isValidSlug(s));
    if (!slugs.length) return 0;
    const markCol = markFilter === 'try' ? 'try_mark = 1' : 'favorite = 1';
    const placeholders = slugs.map(() => '?').join(', ');
    const row = d.prepare(`
        SELECT COUNT(*) AS c FROM nax_tags
        WHERE gallery_slug IN (${placeholders}) AND ${markCol} AND ${NAX_HIDDEN_WHERE}
    `).get(...slugs);
    return row && row.c != null ? row.c : 0;
}

/**
 * @param {string[]} gallerySlugs
 * @param {'favorites'|'try'} markFilter
 * @returns {{ tag: string, gallerySlug: string } | null}
 */
function pickRandomMarkedTagFromSlugs(gallerySlugs, markFilter) {
    const d = getDb();
    if (!d) return null;
    const slugs = (gallerySlugs || []).filter((s) => isValidSlug(s));
    if (!slugs.length) return null;
    const markCol = markFilter === 'try' ? 'try_mark = 1' : 'favorite = 1';
    const placeholders = slugs.map(() => '?').join(', ');
    const row = d.prepare(`
        SELECT tag, gallery_slug AS gallerySlug FROM nax_tags
        WHERE gallery_slug IN (${placeholders}) AND ${markCol} AND ${NAX_HIDDEN_WHERE}
        ORDER BY RANDOM() LIMIT 1
    `).get(...slugs);
    return row && row.tag ? { tag: row.tag, gallerySlug: row.gallerySlug } : null;
}

/**
 * Visible tag count for !NAX_ANY_* (excludes hidden_mark).
 * @param {string[]} gallerySlugs
 * @returns {number}
 */
function countTagsInSlugs(gallerySlugs) {
    const d = getDb();
    if (!d) return 0;
    const slugs = (gallerySlugs || []).filter((s) => isValidSlug(s));
    if (!slugs.length) return 0;
    const placeholders = slugs.map(() => '?').join(', ');
    const row = d.prepare(`
        SELECT COUNT(*) AS c FROM nax_tags
        WHERE gallery_slug IN (${placeholders}) AND ${NAX_HIDDEN_WHERE}
    `).get(...slugs);
    return row && row.c != null ? row.c : 0;
}

/**
 * Random visible tag for !NAX_ANY_* resolution (excludes hidden_mark).
 * @param {string[]} gallerySlugs
 * @returns {{ tag: string, gallerySlug: string } | null}
 */
function pickRandomTagFromSlugs(gallerySlugs) {
    const d = getDb();
    if (!d) return null;
    const slugs = (gallerySlugs || []).filter((s) => isValidSlug(s));
    if (!slugs.length) return null;
    const placeholders = slugs.map(() => '?').join(', ');
    const row = d.prepare(`
        SELECT tag, gallery_slug AS gallerySlug FROM nax_tags
        WHERE gallery_slug IN (${placeholders}) AND ${NAX_HIDDEN_WHERE}
        ORDER BY RANDOM() LIMIT 1
    `).get(...slugs);
    return row && row.tag ? { tag: row.tag, gallerySlug: row.gallerySlug } : null;
}

/**
 * Lock-picker list for !NAX_ANY_* (excludes hidden_mark).
 * @param {string[]} gallerySlugs
 * @param {number} [limit]
 * @returns {{ tag: string, gallerySlug: string }[]}
 */
function listAllTagsFromSlugs(gallerySlugs, limit = NAX_ANY_RESOLVE_TAG_LIMIT) {
    const d = getDb();
    if (!d) return [];
    const slugs = (gallerySlugs || []).filter((s) => isValidSlug(s));
    if (!slugs.length) return [];
    const placeholders = slugs.map(() => '?').join(', ');
    const lim = Math.min(Math.max(Number(limit) || NAX_ANY_RESOLVE_TAG_LIMIT, 1), NAX_ANY_RESOLVE_TAG_LIMIT);
    return d.prepare(`
        SELECT tag, gallery_slug AS gallerySlug FROM nax_tags
        WHERE gallery_slug IN (${placeholders}) AND ${NAX_HIDDEN_WHERE}
        ORDER BY gallery_slug COLLATE NOCASE, tag COLLATE NOCASE
        LIMIT ?
    `).all(...slugs, lim);
}

/**
 * @param {string[]} gallerySlugs
 * @param {'favorites'|'try'} markFilter
 * @param {number} [limit]
 * @returns {{ tag: string, gallerySlug: string }[]}
 */
function listMarkedTagsFromSlugs(gallerySlugs, markFilter, limit = 2000) {
    const d = getDb();
    if (!d) return [];
    const slugs = (gallerySlugs || []).filter((s) => isValidSlug(s));
    if (!slugs.length) return [];
    const markCol = markFilter === 'try' ? 'try_mark = 1' : 'favorite = 1';
    const placeholders = slugs.map(() => '?').join(', ');
    const lim = Math.min(Math.max(Number(limit) || 2000, 1), 2000);
    return d.prepare(`
        SELECT tag, gallery_slug AS gallerySlug FROM nax_tags
        WHERE gallery_slug IN (${placeholders}) AND ${markCol} AND ${NAX_HIDDEN_WHERE}
        ORDER BY gallery_slug COLLATE NOCASE, tag COLLATE NOCASE
        LIMIT ?
    `).all(...slugs, lim);
}

/**
 * Rebuild prompt fragment from a locked Atelier expander seed.
 * @param {object} entry
 * @returns {string|null}
 */
function formatLockedNaxExpander(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.value && typeof entry.value === 'string') return entry.value;
    if (entry.nax_tag && entry.nax_gallery_slug) {
        return formatTagForPrompt(entry.nax_tag, entry.nax_gallery_slug);
    }
    return null;
}

/**
 * Manual lock picker: all marked tags for !NAX_FAV_* / !NAX_TRY_*.
 * @returns {{ value: string, key: string, index: number, nax_tag: string, nax_gallery_slug: string, nax_preset_id: string, nax_kind: string }[]}
 */
function getNaxInternalExpanderOptions(presetId, kind, model) {
    const preset = getNaxExpanderPreset(presetId);
    if (!preset) return [];
    const slugs = preset.resolveSlugs(model);
    const lockKey = `NAX_${kind}_${preset.id}`;
    let rows;
    if (kind === 'ANY') {
        if (countTagsInSlugs(slugs) > NAX_ANY_RESOLVE_TAG_LIMIT) return [];
        rows = listAllTagsFromSlugs(slugs, NAX_ANY_RESOLVE_TAG_LIMIT);
    } else {
        const markFilter = kind === 'TRY' ? 'try' : 'favorites';
        rows = listMarkedTagsFromSlugs(slugs, markFilter);
    }
    return rows.map((row, index) => ({
        value: formatTagForPrompt(row.tag, row.gallerySlug),
        key: lockKey,
        index,
        nax_tag: row.tag,
        nax_gallery_slug: row.gallerySlug,
        nax_preset_id: preset.id,
        nax_kind: kind
    }));
}

/**
 * Resolve !NAX_FAV_CHARA / !NAX_TRY_ARTIST at generation time.
 * @returns {{ tag: string, gallerySlug: string, formatted: string, presetId: string } | null}
 */
function resolveNaxInternalExpander(presetId, kind, model) {
    const preset = getNaxExpanderPreset(presetId);
    if (!preset) return null;
    const slugs = preset.resolveSlugs(model, getGalleries());
    let row;
    if (kind === 'ANY') {
        row = pickRandomTagFromSlugs(slugs);
    } else {
        const markFilter = kind === 'TRY' ? 'try' : 'favorites';
        row = pickRandomMarkedTagFromSlugs(slugs, markFilter);
    }
    if (!row) return null;
    return {
        tag: row.tag,
        gallerySlug: row.gallerySlug,
        formatted: formatTagForPrompt(row.tag, row.gallerySlug),
        presetId: preset.id
    };
}

function canResolveNaxInternalExpander(presetId, kind, model) {
    if (kind !== 'ANY') return true;
    const preset = getNaxExpanderPreset(presetId);
    if (!preset) return false;
    return countTagsInSlugs(preset.resolveSlugs(model)) <= NAX_ANY_RESOLVE_TAG_LIMIT;
}

/**
 * @param {object} opts
 * @returns {object[]}
 */
function queryMarkedTags(opts = {}) {
    const d = getDb();
    if (!d) return [];

    const {
        markFilter = 'favorites',
        gallerySlug = null,
        limit = 500
    } = opts;

    const where = [];
    const params = [];
    if (markFilter === 'favorites') {
        where.push('favorite = 1');
    } else if (markFilter === 'try') {
        where.push('try_mark = 1');
    } else {
        return [];
    }
    where.push(NAX_HIDDEN_WHERE);

    if (gallerySlug && isValidSlug(gallerySlug)) {
        where.push('gallery_slug = ?');
        params.push(gallerySlug);
    }

    const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);
    return d.prepare(`
        SELECT gallery_slug AS gallerySlug, tag, filename,
               favorite, try_mark AS tryMark
        FROM nax_tags
        WHERE ${where.join(' AND ')}
        ORDER BY gallery_slug COLLATE NOCASE, tag COLLATE NOCASE
        LIMIT ?
    `).all(...params, lim);
}

/** Virtual !NAX_FAV_* / !NAX_TRY_* expanders for autocomplete (friendly preset ids). */
function getInternalNaxTextReplacements() {
    const out = [];
    for (const preset of NAX_EXPANDER_PRESETS) {
        out.push({
            type: 'FAV',
            key: `NAX_FAV_${preset.id}`,
            presetId: preset.id,
            label: preset.label,
            description: preset.description
        });
        out.push({
            type: 'TRY',
            key: `NAX_TRY_${preset.id}`,
            presetId: preset.id,
            label: preset.label,
            description: preset.description
        });
        out.push({
            type: 'ANY',
            key: `NAX_ANY_${preset.id}`,
            presetId: preset.id,
            label: preset.label,
            description: `${preset.description} (any non-hidden tag in dataset)`
        });
    }
    return out;
}

/** Client context menu / docs: friendly expander list from server. */
function getNaxExpanderPresetsForClient(model) {
    return NAX_EXPANDER_PRESETS.map((preset) => {
        const slugs = preset.resolveSlugs(model);
        const anyCount = countTagsInSlugs(slugs);
        return {
            id: preset.id,
            label: preset.label,
            description: preset.description,
            favPattern: `!NAX_FAV_${preset.id}`,
            tryPattern: `!NAX_TRY_${preset.id}`,
            anyPattern: `!NAX_ANY_${preset.id}`,
            favCount: countMarkedTagsInSlugs(slugs, 'favorites'),
            tryCount: countMarkedTagsInSlugs(slugs, 'try'),
            anyCount,
            canResolveAny: anyCount <= NAX_ANY_RESOLVE_TAG_LIMIT
        };
    });
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
    NAX_EXPANDER_PRESETS,
    isNaxModelV45,
    artistGallerySlugsForModel,
    curatedArtistGallerySlugsForModel,
    isNaxCuratedArtistGallery,
    formatTagForPrompt,
    pickRandomMarkedTag,
    countMarkedTagsInSlugs,
    countTagsInSlugs,
    pickRandomTagFromSlugs,
    listAllTagsFromSlugs,
    pickRandomMarkedTagFromSlugs,
    listMarkedTagsFromSlugs,
    formatLockedNaxExpander,
    getNaxInternalExpanderOptions,
    resolveNaxInternalExpander,
    canResolveNaxInternalExpander,
    getNaxExpanderPreset,
    NAX_ANY_RESOLVE_TAG_LIMIT,
    NAX_ELEVATE_NONE,
    NAX_ELEVATE_FAVORITES,
    NAX_ELEVATE_TRY,
    NAX_ELEVATE_BOTH,
    normalizeElevatePins,
    queryMarkedTags,
    getInternalNaxTextReplacements,
    getNaxExpanderPresetsForClient,
    queryTags,
    setFavorite,
    setTryMark,
    setHiddenMark,
    insertCustomTag,
    deleteCustomTag,
    isValidSlug,
    closeDb
};
