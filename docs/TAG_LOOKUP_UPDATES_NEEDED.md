# Tag Lookup Module Updates Needed

## Critical Schema Updates Required

### 1. **Outdated Queries - Still Reference `wiki_bodies` Table**

The following queries need to be updated to use the new `wikis` + `tag_wikis` schema:

#### Lines 91-96: `searchBodyByKeyword`
**Current:**
```sql
SELECT DISTINCT t.*
FROM wiki_bodies wb
JOIN tags t ON t.id = wb.tag_id
WHERE LOWER(wb.body) LIKE ? ESCAPE '\\'
```

**Should be:**
```sql
SELECT DISTINCT t.*
FROM tag_wikis tw
JOIN wikis w ON w.id = tw.wiki_id
JOIN tags t ON t.id = tw.tag_id
WHERE LOWER(w.body) LIKE ? ESCAPE '\\'
```

#### Lines 98-105: `searchWikiPageBodies`
**Current:**
```sql
SELECT DISTINCT wp.title
FROM wiki_pages wp
JOIN wiki_bodies wb ON wb.id IN (wp.danbooru_wiki_id, wp.e621_wiki_id)
WHERE wb.tag_id IS NULL AND LOWER(wb.body) LIKE ? ESCAPE '\\'
```

**Should be:**
```sql
SELECT DISTINCT wp.title
FROM wiki_pages wp
LEFT JOIN wikis w_d ON w_d.id = wp.danbooru_wiki_id
LEFT JOIN wikis w_e ON w_e.id = wp.e621_wiki_id
WHERE (LOWER(COALESCE(w_d.body, w_e.body, '')) LIKE ? ESCAPE '\\')
  AND NOT EXISTS (SELECT 1 FROM tag_wikis tw WHERE tw.wiki_id IN (wp.danbooru_wiki_id, wp.e621_wiki_id))
```

#### Lines 107-108: `getBodiesByTag` and `getBodyBySource`
**Current:**
```sql
SELECT source, body FROM wiki_bodies WHERE tag_id = ?
SELECT body FROM wiki_bodies WHERE tag_id = ? AND source = ?
```

**Should be:**
```sql
SELECT w.source, w.body 
FROM tag_wikis tw
JOIN wikis w ON w.id = tw.wiki_id
WHERE tw.tag_id = ?

SELECT w.body 
FROM tag_wikis tw
JOIN wikis w ON w.id = tw.wiki_id
WHERE tw.tag_id = ? AND w.source = ?
```

#### Lines 193-194, 208-209: `searchGroupPagesByTitle` and `searchGroupPagesByBody`
**Current:**
```sql
LEFT JOIN wiki_bodies wb_d ON wb_d.id = wp.danbooru_wiki_id
LEFT JOIN wiki_bodies wb_e ON wb_e.id = wp.e621_wiki_id
```

**Should be:**
```sql
LEFT JOIN wikis w_d ON w_d.id = wp.danbooru_wiki_id
LEFT JOIN wikis w_e ON w_e.id = wp.e621_wiki_id
```

#### Line 233: `getWikiBodyById`
**Current:**
```sql
SELECT id, body, source FROM wiki_bodies WHERE id = ?
```

**Should be:**
```sql
SELECT id, body, source FROM wikis WHERE id = ?
```

#### Line 234-236: `insertWikiBodyForTag`
**Current:**
```sql
INSERT INTO wiki_bodies (tag_id, body, source, created_at, updated_at)
VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
```

**Should be:**
```sql
-- First insert into wikis, then link via tag_wikis
INSERT INTO wikis (title, body, source, created_at, updated_at)
VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
-- Then: INSERT INTO tag_wikis (tag_id, wiki_id) VALUES (?, last_insert_rowid())
```

### 2. **Missing Queries for New Schema**

#### Query Wiki Sections from Database
Instead of parsing body text, query `wiki_sections` table:
```sql
SELECT section_index, level, title, anchor, start_offset, end_offset, 
       line_index, section_type, parent_section_id
FROM wiki_sections
WHERE wiki_id = ?
ORDER BY section_index
```

#### Query Section Hierarchy
```sql
-- Get section with children
SELECT s.*, 
       (SELECT COUNT(*) FROM wiki_sections cs WHERE cs.parent_section_id = s.id) as child_count
FROM wiki_sections s
WHERE s.wiki_id = ? AND s.id = ?
```

#### Query Wiki Links
```sql
-- Get wikis linked from a wiki
SELECT w.*
FROM wiki_links wl
JOIN wikis w ON w.id = wl.to_wiki_id
WHERE wl.from_wiki_id = ?

-- Get wikis linking to a wiki
SELECT w.*
FROM wiki_links wl
JOIN wikis w ON w.id = wl.from_wiki_id
WHERE wl.to_wiki_id = ?
```

### 3. **Function Updates Needed**

#### `buildBodiesForTag()` (Line 327)
- Update to use `tag_wikis` join instead of `wiki_bodies`

#### `fetchTagWikiMentions()` (Line 457)
- Update `searchBodyByKeyword` and `searchWikiPageBodies` calls

#### `attachWikiToTag()` (Line 685)
- Update to use new `wikis` + `tag_wikis` schema

#### `extractWikiSections()` (Line 1970)
- **Should query database instead of parsing!**
- Use `wiki_sections` table for fast lookup
- Only fall back to parsing if sections not in DB

#### `handleGetBodyChunk()` (Line 2546)
- Update `getWikiBodyById` call
- Use `wiki_sections` table instead of calling `extractWikiSections()`
- Use `[ENDSECTION:anchor]` markers for fast section extraction

## Missing Indexes for Performance

### 1. **Wikis Table**
```sql
-- For case-insensitive title searches
CREATE INDEX IF NOT EXISTS idx_wikis_title_lower ON wikis(LOWER(title));

-- For body text searches (consider FTS5 virtual table instead)
-- Note: LIKE searches on body are very slow, FTS5 would be better
```

### 2. **Wiki Pages Table**
```sql
-- For joins with wikis table
CREATE INDEX IF NOT EXISTS idx_wiki_pages_danbooru_wiki ON wiki_pages(danbooru_wiki_id);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_e621_wiki ON wiki_pages(e621_wiki_id);

-- For case-insensitive title searches
CREATE INDEX IF NOT EXISTS idx_wiki_pages_title_lower ON wiki_pages(LOWER(title));
```

### 3. **Tag Wikis Table**
```sql
-- Composite index for common lookup pattern
CREATE INDEX IF NOT EXISTS idx_tag_wikis_tag_wiki ON tag_wikis(tag_id, wiki_id);
```

### 4. **Tag Wiki Links Table**
```sql
-- Composite index for filtering by wiki and relationship
CREATE INDEX IF NOT EXISTS idx_tag_wiki_links_wiki_relationship ON tag_wiki_links(wiki_id, relationship);
```

### 5. **Wiki Sections Table**
```sql
-- For hierarchy queries (get children of a section)
CREATE INDEX IF NOT EXISTS idx_wiki_sections_wiki_parent ON wiki_sections(wiki_id, parent_section_id);

-- For section type filtering
CREATE INDEX IF NOT EXISTS idx_wiki_sections_type ON wiki_sections(section_type);

-- For anchor lookups (already exists, but verify)
-- idx_wiki_sections_anchor already exists
```

## Performance Optimizations

### 1. **Full-Text Search (FTS5) for Body Text**
Instead of `LIKE '%keyword%'` searches on `wikis.body` (very slow), create an FTS5 virtual table:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS wikis_fts USING fts5(
    body,
    title,
    content='wikis',
    content_rowid='id'
);

-- Create triggers to keep FTS5 in sync
CREATE TRIGGER IF NOT EXISTS wikis_fts_insert AFTER INSERT ON wikis BEGIN
    INSERT INTO wikis_fts(rowid, body, title) VALUES (new.id, new.body, new.title);
END;

CREATE TRIGGER IF NOT EXISTS wikis_fts_update AFTER UPDATE ON wikis BEGIN
    UPDATE wikis_fts SET body = new.body, title = new.title WHERE rowid = new.id;
END;

CREATE TRIGGER IF NOT EXISTS wikis_fts_delete AFTER DELETE ON wikis BEGIN
    DELETE FROM wikis_fts WHERE rowid = old.id;
END;
```

Then update `searchBodyByKeyword`:
```sql
SELECT DISTINCT t.*
FROM wikis_fts w_fts
JOIN wikis w ON w.id = w_fts.rowid
JOIN tag_wikis tw ON tw.wiki_id = w.id
JOIN tags t ON t.id = tw.tag_id
WHERE wikis_fts MATCH ?
```

### 2. **Use Indexed Sections Instead of Parsing**
Replace `extractWikiSections(bodyText)` calls with database queries:
```sql
SELECT * FROM wiki_sections WHERE wiki_id = ? ORDER BY section_index
```

### 3. **Section Extraction Using End Markers**
When extracting a section by anchor, use `[ENDSECTION:anchor]` markers:
```sql
-- Get section boundaries
SELECT start_offset, end_offset 
FROM wiki_sections 
WHERE wiki_id = ? AND anchor = ?

-- Then extract: body.substring(start_offset, end_offset)
-- Or use: body.substring(start_offset, body.indexOf('[ENDSECTION:anchor]'))
```

## Summary of Required Changes

1. **Update all `wiki_bodies` references** → `wikis` + `tag_wikis` joins
2. **Add missing indexes** for performance (especially `wiki_pages` foreign keys)
3. **Replace `extractWikiSections()` parsing** → Query `wiki_sections` table
4. **Add FTS5 virtual table** for fast body text searches
5. **Add queries for `wiki_links`** table
6. **Add queries for section hierarchy** using `parent_section_id`
7. **Update `handleGetBodyChunk()`** to use indexed sections and end markers

## Priority Order

1. **HIGH**: Fix schema queries (lines 91-108, 193-209, 233-236) - these will break
2. **HIGH**: Add missing indexes for `wiki_pages` foreign keys
3. **MEDIUM**: Replace `extractWikiSections()` with database queries
4. **MEDIUM**: Add FTS5 for body searches
5. **LOW**: Add `wiki_links` queries
6. **LOW**: Add section hierarchy queries

