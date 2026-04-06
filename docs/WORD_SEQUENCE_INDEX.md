# Word Sequence Index for Predictive Tag Matching

## Overview

The `tag_word_sequences` table provides a pre-computed index of all contiguous word sequences from tags, enabling O(1) lookup for predictive text matching. This dramatically speeds up greedy tag matching in `promptLogitAnalyzer.js` and enables fast client-side autocomplete in `autocompleteUtils.js`.

## How It Works

### Example: Tag "rapi (red hood) (nikke)"

For a tag with words `["rapi", "red", "hood", "nikke"]`, the index stores:

**1-word sequences:**
- `"rapi"` → tag_id (position 0)
- `"red"` → tag_id (position 1)
- `"hood"` → tag_id (position 2)
- `"nikke"` → tag_id (position 3)

**2-word sequences:**
- `"rapi red"` → tag_id (position 0)
- `"red hood"` → tag_id (position 1)
- `"hood nikke"` → tag_id (position 2)

**3-word sequences:**
- `"rapi red hood"` → tag_id (position 0)
- `"red hood nikke"` → tag_id (position 1)

**4-word sequence:**
- `"rapi red hood nikke"` → tag_id (position 0)

### Query Pattern

Instead of making API calls or scanning all tags, queries become simple index lookups:

```sql
-- Find all tags containing "red hood"
SELECT DISTINCT tag_id FROM tag_word_sequences 
WHERE sequence = 'red hood' 
ORDER BY sequence_length DESC;
```

## Performance Benefits

### 1. **promptLogitAnalyzer.js** - Greedy Search

**Before:**
- For each word combination (1-word, 2-word, 3-word, etc.), make API call via `getsuggestions()`
- Each API call: ~50-200ms
- For "rapi red hood nikke": 4+ API calls = 200-800ms

**After:**
- Single database query: `SELECT tag_id FROM tag_word_sequences WHERE sequence = ?`
- Query time: <1ms (indexed lookup)
- For "rapi red hood nikke": 1 query = <1ms

**Speed Improvement: 200-800x faster**

### 2. **autocompleteUtils.js** - Client-Side Autocomplete

**Before:**
- All tag searches require WebSocket API calls
- Network latency: 50-200ms per search
- No offline capability

**After:**
- Can query local database (if synced)
- Query time: <1ms
- Works offline
- Can pre-load common sequences

**Speed Improvement: 50-200x faster (plus offline capability)**

## Index Size Estimation

### Storage Calculation

For a tag with N words, we generate:
- Total sequences = N × (N + 1) / 2 (triangular number)

**Examples:**
- 1-word tag: 1 sequence
- 2-word tag: 3 sequences
- 3-word tag: 6 sequences
- 4-word tag: 10 sequences
- 5-word tag: 15 sequences

### Real-World Estimates

Assuming:
- 100,000 tags
- Average 2.5 words per tag
- Average sequence length: 15 characters

**Storage per sequence:**
- `tag_id` (INTEGER): 4 bytes
- `sequence` (TEXT): ~15 bytes average
- `sequence_length` (INTEGER): 4 bytes
- `start_position` (INTEGER): 4 bytes
- Row overhead: ~10 bytes
- **Total per row: ~37 bytes**

**Total sequences:**
- Average sequences per tag: 2.5 × 3.5 / 2 ≈ 4.4 sequences
- Total sequences: 100,000 × 4.4 ≈ 440,000 sequences
- **Total storage: 440,000 × 37 bytes ≈ 16 MB**

**With indexes:**
- Index on `sequence`: ~8 MB
- Index on `(sequence, sequence_length)`: ~12 MB
- Index on `(tag_id, sequence_length)`: ~8 MB
- **Total with indexes: ~44 MB**

### Performance Impact

**Insertion Time:**
- Since tags are rarely added (only when API returns new tags), insertion cost is negligible
- Per tag: ~0.1ms to generate and insert sequences
- Bulk insertion: ~1000 sequences/second

**Query Time:**
- Index lookup: <1ms
- Returns tag IDs instantly
- No API calls needed

**Memory:**
- Index fits in SQLite page cache
- No significant memory overhead

## Usage Examples

### 1. Find Tags by Word Sequence

```sql
-- Find all tags containing "red hood"
SELECT t.id, t.title, t.n_count, t.e_count
FROM tags t
INNER JOIN tag_word_sequences tws ON t.id = tws.tag_id
WHERE tws.sequence = 'red hood'
ORDER BY tws.sequence_length DESC, t.n_count DESC;
```

### 2. Greedy Matching (Longest Match First)

```sql
-- Find longest matching sequence starting with "red"
SELECT DISTINCT t.id, t.title, tws.sequence, tws.sequence_length
FROM tags t
INNER JOIN tag_word_sequences tws ON t.id = tws.tag_id
WHERE tws.sequence LIKE 'red%'
ORDER BY tws.sequence_length DESC, tws.sequence
LIMIT 10;
```

### 3. Prefix Matching for Autocomplete

```sql
-- Find tags matching "rapi red" prefix
SELECT DISTINCT t.id, t.title, tws.sequence
FROM tags t
INNER JOIN tag_word_sequences tws ON t.id = tws.tag_id
WHERE tws.sequence LIKE 'rapi red%'
ORDER BY tws.sequence_length ASC, t.n_count DESC
LIMIT 20;
```

## Integration Points

### promptLogitAnalyzer.js

Replace API calls with database queries:

```javascript
// Instead of: await getsuggestions(phrase)
// Use:
const matchingTags = db.prepare(`
    SELECT DISTINCT t.id, t.title, t.n_count, t.e_count, t.category
    FROM tags t
    INNER JOIN tag_word_sequences tws ON t.id = tws.tag_id
    WHERE tws.sequence = ?
    ORDER BY tws.sequence_length DESC
`).all(phrase.toLowerCase());
```

### autocompleteUtils.js

Enable client-side tag matching:

```javascript
// Query local database for instant results
const localResults = tagDatabase.query(`
    SELECT tag_id, sequence, sequence_length
    FROM tag_word_sequences
    WHERE sequence LIKE ? || '%'
    ORDER BY sequence_length ASC, tag_id
    LIMIT 50
`, [query.toLowerCase()]);
```

## Maintenance

### Adding New Tags

When a new tag is added:
1. Generate all word sequences (automatic during insertion)
2. Insert sequences in single transaction
3. Indexes update automatically

**Cost:** ~0.1ms per tag (negligible)

### Updating Tags

If tag words change:
1. Delete old sequences: `DELETE FROM tag_word_sequences WHERE tag_id = ?`
2. Generate and insert new sequences

**Cost:** ~0.2ms per tag update

## Conclusion

The word sequence index provides:
- **200-800x speed improvement** for greedy tag matching
- **50-200x speed improvement** for autocomplete (plus offline capability)
- **Minimal storage overhead** (~44 MB for 100k tags)
- **Negligible insertion cost** (~0.1ms per tag)
- **Instant queries** (<1ms lookup time)

Since tags are rarely added, the one-time index creation cost is amortized over millions of queries, making this a highly efficient optimization.

