# Unified Tag Search Migration Review

## Executive Summary

Both `animeTagSearch.js` and `furryTagSearch.js` load large JSON files into memory and build complex in-memory search indexes. They will be **merged into a single unified search** that uses SQLite database queries via the existing `tagWordSearch.js` module. 

### Key Changes:
- ✅ **Unified Search:** Single search function instead of two separate searches
- ✅ **Source Array:** Tags return a `source` array (e.g., `['anime']`, `['furry']`, `['anime', 'furry']`) instead of a single source string
- ✅ **No Duplicates:** Tags that exist in both anime and furry datasets appear once with all sources in the array
- ✅ **Database Backend:** Uses SQLite instead of JSON files and in-memory indexes
- ✅ **Backward Compatibility:** Can maintain separate classes as thin wrappers if needed

## Current Architecture

### AnimeTagSearch (`modules/animeTagSearch.js`)

**Data Source:**
- `dataset_tags.json` - Loaded on construction
- Caches indexes in `.cache/` directory:
  - `anime_search_index.json` - Full tag name index
  - `anime_word_index.json` - Word-based index
  - `anime_prefix_index.json` - Prefix matching index
  - `anime_suffix_index.json` - Suffix matching index
  - `anime_words_index.json` - Words array index (from tag.words property)

**Key Methods:**
1. `searchTags(query, limit = 10)` - Main search method
2. `getTagInfo(tagName)` - Get single tag by name
3. `getCategories()` - Get all categories

**Search Strategy (Priority Order):**
1. **Exact matches** (100% confidence) - Full tag name match
2. **Series matches** (95% confidence) - Character tags with series in parentheses
3. **Words array matches** (95% confidence) - Matches in `tag.words` array
4. **Word-based matches** (90% confidence) - Individual word matching with fuzzy search
5. **Prefix matches** (85% confidence) - Tags starting with search term
6. **Suffix matches** (80% confidence) - Tags ending with search term

**Result Format:**
```javascript
{
    tag: "tag_name",
    tag_name: "tag_name",
    d_id: 123,
    d_category: 4, // 0=General, 1=Artist, 3=Copyright, 4=Character, 5=Meta, 6=Species
    d_count: 1000,
    n_count: 500,
    n_rand: false,
    words: ["word1", "word2"],
    z_category: [{id: 1, name: "category"}],
    confidence: 100,
    similarity: 100,
    source: 'anime-local' // OLD: single string
}
```

### FurryTagSearch (`modules/furryTagSearch.js`)

**Data Source:**
- `dataset_tags_furry.json` - Loaded on construction
- Caches indexes in `.cache/` directory:
  - `furry_search_index.json` - Full tag name index
  - `furry_word_index.json` - Word-based index
  - `furry_prefix_index.json` - Prefix matching index
  - `furry_suffix_index.json` - Suffix matching index

**Key Methods:**
1. `searchTags(query, limit = 10)` - Main search method
2. `getTagInfo(tagName)` - Get single tag by name
3. `getCategories()` - Get all categories

**Search Strategy (Priority Order):**
1. **Exact matches** (100% confidence) - Full tag name match
2. **Series matches** (95% confidence) - Character tags with series in parentheses
3. **Word-based matches** (90% confidence) - **DISABLED** (commented out with `if (false)`)
4. **Prefix matches** (90% confidence) - Tags starting with search term
5. **Suffix matches** (85% confidence) - Tags ending with search term

**Result Format:**
```javascript
{
    tag: "tag_name",
    tag_name: "tag_name",
    e_name: "tag_name",
    e_category: "character", // String category
    e_count: 1000,
    n_count: 500,
    e_group: "group/path",
    confidence: 100,
    similarity: 100
    // OLD: no source field
}
```

**Note:** FurryTagSearch does NOT have a `words` array index (unlike AnimeTagSearch), and word-based matching is disabled.

## Unified Search Architecture (NEW)

### UnifiedTagSearch (Proposed)

**Data Source:**
- SQLite database (`data/tags.db`) - Single source of truth
- No JSON files needed
- No separate indexes needed

**Key Methods:**
1. `searchTags(query, limit = 10, options = {})` - Unified search method
2. `getTagInfo(tagName)` - Get single tag by name
3. `getCategories()` - Get all categories

**Search Strategy (Combined Priority Order):**
1. **Exact matches** (100% confidence) - Full tag name match
2. **Series matches** (95% confidence) - Character tags with series in parentheses
3. **Words array matches** (95% confidence) - Matches in `tag.words` array
4. **Word-based matches** (90% confidence) - Individual word matching with fuzzy search
5. **Prefix matches** (85% confidence) - Tags starting with search term
6. **Suffix matches** (80% confidence) - Tags ending with search term

**Unified Result Format:**
```javascript
{
    tag: "tag_name",           // Tag title
    tag_name: "tag_name",       // Alias for tag (backward compatibility)
    id: 123,                    // Tag ID
    category: 4,                // Numeric category (0=General, 1=Artist, 3=Copyright, 4=Character, 5=Meta, 6=Species)
    d_count: 1000,              // Danbooru/anime usage count
    e_count: 500,               // E621/furry usage count
    n_count: 200,               // NovelAI usage count
    n_rand: false,              // NovelAI random flag
    words: ["word1", "word2"],   // Words array
    z_category: [{id: 1, name: "category"}], // Z-categories
    d_group: [{id: 1, path: "g/path"}],      // D-groups
    confidence: 100,            // Match confidence score
    similarity: 100,            // Similarity score
    source: ['anime', 'furry']  // NEW: Array of sources where tag exists
}
```

**Source Determination Logic:**
```javascript
const source = [];
if (tag.d_count > 0) source.push('anime');
if (tag.e_count > 0) source.push('furry');
if (tag.n_count > 0) source.push('novelai');
// Result: ['anime'], ['furry'], ['anime', 'furry'], ['anime', 'furry', 'novelai'], etc.
```

**Benefits of Unified Approach:**
- ✅ Single search instead of two separate searches
- ✅ Tags can exist in multiple sources (shown in source array)
- ✅ No duplicate results (same tag appears once with all sources)
- ✅ Simpler API (one search method instead of two)
- ✅ Better performance (one query instead of two)
- ✅ Unified result format

## Current Usage Throughout Codebase

### 1. `modules/globalResources.js`
- Initializes both services at startup
- Provides lazy-loading access via `getAnimeTagSearch()` and `getFurryTagSearch()`
- Used by `FastTagSearch` constructor

### 2. `modules/textReplacements.js` (SearchService)
- Uses both services for tag search
- Lazy-loads when needed
- Methods: `searchTags()`, `findLocalTagMatches()`

### 3. `modules/tag-lookup.js`
- Uses `furryTagSearch` for furry tag matching
- Function: `ensureFurryTagSearchLoaded()` - Lazy loading wrapper

### 4. `modules/fastTagSearch.js`
- Takes both services as constructor parameters
- Uses them for tag lookup: `findTagsContaining()`, `findTagByWord()`

### 5. `modules/localPromptOptimizer.js`
- Uses both services for tag optimization
- Methods: `optimizeTags()`, `findBestTag()`

### 6. `modules/promptLogitAnalyzer.js`
- Uses both services for tag analysis

## Database Schema Mapping

### Property Mapping

| JSON Property | SQLite Column | Notes |
|--------------|---------------|-------|
| `tag.tag_name` | `tags.title` | ✅ Direct mapping |
| `tag.d_id` | `tags.id` | ✅ Direct mapping (not needed, use id) |
| `tag.d_category` | `tags.category` | ✅ Direct mapping (0=General, 1=Artist, 3=Copyright, 4=Character, 5=Meta, 6=Species) |
| `tag.e_category` | `tags.category` | ✅ Direct mapping (same as d_category) |
| `tag.d_count` | `tags.d_count` | ✅ Direct mapping |
| `tag.e_count` | `tags.e_count` | ✅ Direct mapping |
| `tag.n_count` | `tags.n_count` | ✅ Direct mapping |
| `tag.n_rand` | `tags.n_rand` | ✅ Direct mapping |
| `tag.words` | `tag_words.word` | ✅ Via `getTagComplete()` |
| `tag.z_category` | `tag_z_categories` + `z_categories` | ✅ Via `getTagComplete()` |
| `tag.d_group` | `tag_d_groups` + `d_groups` | ✅ Via `getTagComplete()` |
| `tag.e_group` | `tag_d_groups` + `d_groups` | ✅ Same as d_group |

### Category Differences

**AnimeTagSearch:**
- Uses numeric categories: `0=General, 1=Artist, 3=Copyright, 4=Character, 5=Meta, 6=Species`
- Stored in `tag.d_category`

**FurryTagSearch:**
- Uses string categories: `"character"`, `"species"`, `"copyright"`, etc.
- Stored in `tag.e_category`

**Database:**
- Uses numeric categories (same as anime): `tags.category`
- Both anime and furry tags use the same category system in the database

## Available Database Functions

### From `tagWordSearch.js`:

✅ **Already Available:**
- `searchTagsByWords(query, options)` - Word-based search with multiple strategies
- `getTagByTitle(title, includeComplete)` - Get tag by title (checks other_names automatically)
- `getTagComplete(tagId, fields)` - Get complete tag with all related data
- `getTagsComplete(tagIds)` - Batch fetch multiple tags
- `getTagsByCategory(category, limit)` - Get tags by category
- `getTagGroups()` - Get all tag groups
- `getTagGroup(groupName, includeComplete)` - Get specific tag group

### Search Capabilities Comparison

| Feature | AnimeTagSearch | FurryTagSearch | tagWordSearch |
|---------|---------------|----------------|---------------|
| Exact match | ✅ | ✅ | ✅ (via getTagByTitle) |
| Series match | ✅ | ✅ | ❌ (needs implementation) |
| Words array match | ✅ | ❌ | ✅ (via searchTagsByWords) |
| Word-based match | ✅ | ❌ (disabled) | ✅ |
| Prefix match | ✅ | ✅ | ✅ (via searchTagsByWords) |
| Suffix match | ✅ | ✅ | ❌ (needs implementation) |
| Fuzzy match (Levenshtein) | ✅ | ✅ | ❌ (needs implementation) |

## Migration Requirements

### 1. Search Functionality Gaps

**Missing Features in `tagWordSearch.js`:**

1. **Series Name Matching** (High Priority)
   - Both modules extract series name from character tags like "character (series)"
   - Need SQL query to match series name in parentheses
   - Example: Search "naruto" should find "sasuke (naruto)"

2. **Suffix Matching** (Medium Priority)
   - Both modules support suffix matching
   - `tagWordSearch` only supports prefix matching
   - Need SQL query: `WHERE LOWER(tw.word) LIKE '%' || LOWER(?)`

3. **Fuzzy Matching (Levenshtein Distance)** (Medium Priority)
   - Both modules use Levenshtein distance for fuzzy matching
   - SQLite doesn't have built-in Levenshtein, but can be done in JavaScript
   - May need to fetch candidates first, then filter in JavaScript

4. **Exact Tag Name Matching** (Low Priority - Can use getTagByTitle)
   - Both modules prioritize exact matches
   - `getTagByTitle()` already handles this

### 2. Unified Result Format Mapping

**Old Format (AnimeTagSearch) → Unified Format:**
```javascript
// OLD: AnimeTagSearch format
{
    tag: "tag_name",
    tag_name: "tag_name",
    d_id: 123,
    d_category: 4,
    d_count: 1000,
    n_count: 500,
    n_rand: false,
    words: ["word1", "word2"],
    z_category: [{id: 1, name: "category"}],
    confidence: 100,
    similarity: 100,
    source: 'anime-local' // Single string
}

// NEW: Unified format
{
    tag: "tag_name",           // From title
    tag_name: "tag_name",       // Alias (backward compatibility)
    id: 123,                    // From id
    category: 4,                // From category (numeric)
    d_count: 1000,              // From d_count
    e_count: 0,                 // From e_count
    n_count: 500,               // From n_count
    n_rand: false,              // From n_rand
    words: ["word1", "word2"],   // From words array
    z_category: [{id: 1, name: "category"}], // From z_category
    d_group: [{id: 1, path: "g/path"}],      // From d_group
    confidence: 100,            // From matchScore
    similarity: 100,            // From matchScore
    source: ['anime']           // NEW: Array - determined from counts
}
```

**Old Format (FurryTagSearch) → Unified Format:**
```javascript
// OLD: FurryTagSearch format
{
    tag: "tag_name",
    tag_name: "tag_name",
    e_name: "tag_name",
    e_category: "character",    // String category
    e_count: 1000,
    n_count: 500,
    e_group: "group/path",
    confidence: 100,
    similarity: 100
    // No source field
}

// NEW: Unified format
{
    tag: "tag_name",           // From title
    tag_name: "tag_name",       // Alias (backward compatibility)
    id: 123,                    // From id
    category: 4,                // From category (converted from string to number)
    d_count: 0,                 // From d_count
    e_count: 1000,              // From e_count
    n_count: 500,               // From n_count
    n_rand: false,              // From n_rand
    words: ["word1", "word2"],   // From words array (if available)
    z_category: [],              // From z_category
    d_group: [{id: 1, path: "group/path"}], // From d_group
    confidence: 100,            // From matchScore
    similarity: 100,            // From matchScore
    source: ['furry']           // NEW: Array - determined from counts
}
```

**Unified Format for Tags in Multiple Sources:**
```javascript
// Tag exists in both anime and furry datasets
{
    tag: "tag_name",
    tag_name: "tag_name",
    id: 123,
    category: 4,
    d_count: 1000,              // Has anime data
    e_count: 500,               // Has furry data
    n_count: 200,               // Has NovelAI data
    n_rand: false,
    words: ["word1", "word2"],
    z_category: [{id: 1, name: "category"}],
    d_group: [{id: 1, path: "g/path"}],
    confidence: 100,
    similarity: 100,
    source: ['anime', 'furry', 'novelai']  // NEW: Multiple sources
}
```

**Source Determination Function:**
```javascript
function determineSource(tag) {
    const sources = [];
    if (tag.d_count > 0) sources.push('anime');
    if (tag.e_count > 0) sources.push('furry');
    if (tag.n_count > 0) sources.push('novelai');
    return sources; // Returns: [], ['anime'], ['furry'], ['anime', 'furry'], etc.
}
```

**Property Mapping:**
- `tag` → `title` (from database)
- `tag_name` → `title` (alias for backward compatibility)
- `d_id` → `id` (or remove, use `id` directly)
- `d_category` / `e_category` → `category` (numeric, convert string categories)
- `e_name` → `title` (or remove, same as title)
- `e_group` → `d_group[0].path` (or use full `d_group` array)
- `confidence` → `matchScore` (from search results)
- `similarity` → `matchScore` (from search results)
- `source` → Array determined from counts: `['anime']`, `['furry']`, `['anime', 'furry']`, etc.

### 3. Category Conversion

**FurryTagSearch uses string categories, database uses numeric:**

```javascript
// Conversion needed:
"character" → 4
"species" → 6
"copyright" → 3
"general" → 0
"artist" → 1
"meta" → 5
```

### 4. Dataset Filtering (UNIFIED APPROACH)

**Unified Search:**
- Returns ALL tags regardless of source
- Source array indicates where tag exists: `['anime']`, `['furry']`, `['anime', 'furry']`, etc.
- No filtering needed - tags with `d_count > 0` will have `'anime'` in source array
- No filtering needed - tags with `e_count > 0` will have `'furry'` in source array

**Optional Filtering (if needed):**
- Filter by source: `results.filter(tag => tag.source.includes('anime'))`
- Filter by source: `results.filter(tag => tag.source.includes('furry'))`
- Filter by minimum count: `results.filter(tag => tag.d_count > 0 || tag.e_count > 0)`

## Migration Strategy

### Phase 1: Extend `tagWordSearch.js`

1. **Add Series Name Matching:**
   ```javascript
   function searchTagsBySeriesName(seriesName, limit = 10) {
       // Find character tags with series in parentheses
       // WHERE category = 4 AND title LIKE '%(%)%'
       // Extract series name from parentheses and match
   }
   ```

2. **Add Suffix Matching:**
   ```javascript
   // Add to searchStatements:
   suffixWord: db.prepare(`
       SELECT DISTINCT t.*
       FROM tags t
       INNER JOIN tag_words tw ON t.id = tw.tag_id
       WHERE LOWER(tw.word) LIKE '%' || LOWER(?)
       ORDER BY ...
   `)
   ```

3. **Add Fuzzy Matching Support:**
   - Option 1: Fetch candidates, then filter in JavaScript using Levenshtein
   - Option 2: Use SQLite extension (if available)
   - Option 3: Pre-compute similarity scores in SQL (limited)

### Phase 2: Create Unified Search Function

Create a unified search function in `tagWordSearch.js` that combines both anime and furry search:

```javascript
function searchUnifiedTags(query, limit = 10, options = {}) {
    // 1. Try exact match (getTagByTitle)
    // 2. Try series match (new function)
    // 3. Try words array match (searchTagsByWords with words field)
    // 4. Try word-based match (searchTagsByWords)
    // 5. Try prefix match (searchTagsByWords)
    // 6. Try suffix match (new function)
    // 
    // For each result:
    // - Determine source array from counts: ['anime'], ['furry'], ['anime', 'furry'], etc.
    // - Format: Map to unified result format
    // - Remove duplicates (same tag ID appears once with all sources)
    // 
    // Options:
    // - filterSource: ['anime'] | ['furry'] | ['anime', 'furry'] - Filter by source
    // - minCount: number - Minimum count threshold
    // - includeComplete: boolean - Include full tag data
}
```

**Key Features:**
- Single search function instead of two separate ones
- Returns unified format with source array
- No duplicate results (same tag appears once)
- Optional filtering by source if needed

### Phase 3: Create Unified Tag Search Class

**Option A: Replace Both Classes with Unified Class (Recommended)**

1. **Create `unifiedTagSearch.js`:**
   - Single class: `UnifiedTagSearch`
   - Uses `tagWordSearch.searchUnifiedTags()` internally
   - Maintains backward-compatible API:
     - `searchTags(query, limit)` - Returns unified format with source array
     - `getTagInfo(tagName)` - Returns unified format
     - `getCategories()` - Returns all categories

2. **Update `animeTagSearch.js` and `furryTagSearch.js`:**
   - **Option 1:** Remove both classes, replace with `UnifiedTagSearch`
   - **Option 2:** Keep as thin wrappers that call `UnifiedTagSearch`:
     ```javascript
     class AnimeTagSearch {
         constructor() {
             this.unified = new UnifiedTagSearch();
         }
         searchTags(query, limit) {
             const results = this.unified.searchTags(query, limit);
             // Filter to only anime tags (source includes 'anime')
             return results.filter(tag => tag.source.includes('anime'));
         }
     }
     ```

**Option B: Keep Separate Classes but Use Unified Backend**

1. **Update `animeTagSearch.js`:**
   - Replace `loadTagData()` - Remove JSON loading
   - Replace `buildSearchIndex()` - Remove index building
   - Update `searchTags()` - Use `tagWordSearch.searchUnifiedTags()` with `filterSource: ['anime']`
   - Update `getTagInfo()` - Use `tagWordSearch.getTagByTitle()` and format result
   - Update `getCategories()` - Use `tagWordSearch.getTagsByCategory()`

2. **Update `furryTagSearch.js`:**
   - Same as animeTagSearch but use `filterSource: ['furry']`

3. **Update `globalResources.js`:**
   - Remove JSON file loading
   - Keep class instantiation (for backward compatibility)
   - Classes now use unified database search with source filtering

### Phase 4: Testing

- [ ] Exact matches work correctly
- [ ] Series matches work correctly
- [ ] Words array matches work correctly
- [ ] Word-based matches work correctly
- [ ] Prefix matches work correctly
- [ ] Suffix matches work correctly
- [ ] Fuzzy matches work correctly
- [ ] Result format matches original format
- [ ] Source array correctly identifies where tags exist (anime, furry, novelai)
- [ ] Tags in multiple sources appear once with correct source array
- [ ] Optional source filtering works correctly
- [ ] Performance is acceptable (no significant slowdown)
- [ ] Memory usage is reduced (no large JSON objects)

## Performance Considerations

### Current (JSON-based):
- **Memory:** ~380MB+ for both datasets loaded in memory
- **Startup Time:** ~5-10 seconds to load and index
- **Search Speed:** Very fast (in-memory hash lookups)
- **Index Building:** ~30-60 seconds on first run

### Proposed (SQLite-based):
- **Memory:** Minimal (only database connection)
- **Startup Time:** Instant (database already exists)
- **Search Speed:** Fast (indexed SQL queries)
- **Index Building:** Not needed (database already indexed)

### Potential Issues:
1. **SQLite Query Performance:**
   - Multiple queries per search (exact, series, words, prefix, suffix)
   - May need to combine into single query with UNION
   - Use prepared statements for performance

2. **Fuzzy Matching Performance:**
   - Levenshtein in JavaScript may be slow for large result sets
   - Consider limiting candidate set before fuzzy matching

3. **Result Formatting:**
   - Mapping database results to original format adds overhead
   - Consider caching formatted results

## Backward Compatibility

### API Compatibility Options:

**Option 1: Unified Class (Recommended)**
- Create new `UnifiedTagSearch` class
- Keep `AnimeTagSearch` and `FurryTagSearch` as thin wrappers:
  ```javascript
  class AnimeTagSearch {
      searchTags(query, limit) {
          return unified.searchTags(query, limit)
              .filter(tag => tag.source.includes('anime'));
      }
  }
  ```
- Result format: Unified format with `source` array
- Breaking change: `source` is now an array instead of string

**Option 2: Keep Separate Classes**
- Keep `AnimeTagSearch` and `FurryTagSearch` classes
- Both use unified backend but filter results
- Result format: Map to original format (source as string for backward compatibility)
- No breaking changes

### Result Format Compatibility:

**For Backward Compatibility (if needed):**
```javascript
// Map unified format to old format
function mapToAnimeFormat(tag) {
    return {
        tag: tag.title,
        tag_name: tag.title,
        d_id: tag.id,
        d_category: tag.category,
        d_count: tag.d_count,
        n_count: tag.n_count,
        n_rand: tag.n_rand,
        words: tag.words || [],
        z_category: tag.z_category || [],
        confidence: tag.matchScore || 100,
        similarity: tag.matchScore || 100,
        source: tag.source.includes('anime') ? 'anime-local' : 'furry-local'
    };
}
```

### File Removal:
- Can remove `dataset_tags.json` after migration
- Can remove `dataset_tags_furry.json` after migration
- Can remove `.cache/` index files after migration
- Keep classes for backward compatibility (or replace with unified class)

## Recommendations

1. **Implement unified search function** in `tagWordSearch.js` with source array support
2. **Implement missing search features** (series matching, suffix matching, fuzzy matching)
3. **Create unified result format** with source as array: `['anime']`, `['furry']`, `['anime', 'furry']`
4. **Decide on backward compatibility approach:**
   - Option A: Unified class with wrapper classes (recommended)
   - Option B: Keep separate classes with unified backend
5. **Test thoroughly** with real search queries
   - Test tags that exist in both anime and furry datasets
   - Verify source array is correct
   - Verify no duplicate results
6. **Update all usage locations** to use unified search or filtered results
7. **Monitor performance** after migration
8. **Remove JSON files** only after successful migration and testing

## Next Steps

1. ✅ Review this document with team
2. **Decide on unified approach:**
   - Unified class vs separate classes with unified backend
   - Source array format (breaking change vs backward compatibility)
3. **Decide on fuzzy matching approach** (JavaScript vs SQLite extension)
4. **Implement missing search features** in `tagWordSearch.js`:
   - Series name matching
   - Suffix matching
   - Fuzzy matching (Levenshtein)
5. **Create unified search function** `searchUnifiedTags()` with source array support
6. **Create/update tag search classes:**
   - Option A: Create `UnifiedTagSearch` class
   - Option B: Update `AnimeTagSearch` and `FurryTagSearch` to use unified backend
7. **Update all usage locations** throughout codebase
8. **Test and benchmark:**
   - Test unified search
   - Test source array correctness
   - Test backward compatibility (if applicable)
   - Performance benchmarks
9. **Deploy and monitor**
10. **Remove JSON files** after successful migration

