# DText Conversion Testing Checklist

## Overview
After rerunning the database update script (`create-tag-database.js`), test that:
1. Raw DText is stored correctly in the database
2. Sections are pre-indexed and retrieved from database (not parsed)
3. Markdown conversion works for root responses
4. HTML conversion works for modal display
5. All DText features are handled correctly

## Pre-Testing Setup

1. **Backup current database** (if needed)
2. **Run database update script**:
   ```bash
   node scripts/create-tag-database.js
   ```
3. **Verify database contains raw DText**:
   - Check `wikis.body` column contains DText format (h1., [b], [section=], etc.)
   - Check `wiki_sections` table is populated with section data

## Test Cases

### 1. Section Extraction from Database
**Test**: Verify sections are retrieved from database, not parsed

**Steps**:
1. Open tag wiki modal for a tag with multiple sections
2. Check browser console for any parsing warnings
3. Verify sections appear correctly in modal

**Expected**:
- No console warnings about "falling back to parsing"
- Sections load quickly (database query, not parsing)
- All sections appear with correct titles and anchors

### 2. Markdown Conversion (Root Responses)
**Test**: Verify raw DText converts to markdown correctly

**Steps**:
1. Use `getBodyChunk` tool with a tag that has DText formatting
2. Check the returned markdown format

**Expected**:
- Headers: `h1. Title` → `# Title`
- Bold: `[b]text[/b]` → `**text**`
- Italic: `[i]text[/i]` → `*text*`
- Links: `[[tag]]` → `[tag](tag)`
- Tables: Converted to markdown table format
- Sections: `[section=title]` → `### title\n\ncontent`
- Expand blocks: `[expand=title]` → `<details><summary>title</summary>...`
- Code blocks: `[code]...[/code]` → ``` code blocks
- Spoilers: `[spoiler]...[/spoiler]` → `<span class="spoiler">...</span>`
- Colors: `[color=red]...[/color]` → `<span style="color:red;">...</span>`
- Superscript/Subscript: Preserved as HTML
- Post references: `post #12345` → `post #12345` (plain text)
- External links: `"text":url` → `[text](url)`
- Tag search: `{{tag}}` → `tag` (plain text)
- Username mentions: `@user` → `@user` (plain text)

### 3. HTML Conversion (Modal Display)
**Test**: Verify raw DText converts to HTML correctly

**Steps**:
1. Open tag wiki modal for a tag with various DText features
2. Inspect the rendered HTML

**Expected**:
- Headers: `h1. Title` → `<h1>Title</h1>`
- Headers with IDs: `h1#id. Title` → `<h1 id="id">Title</h1>`
- All header levels (h1-h6) work with and without IDs
- Bold: `[b]text[/b]` → `<strong>text</strong>`
- Italic: `[i]text[/i]` → `<em>text</em>`
- Underline: `[u]text[/u]` → `<u>text</u>`
- Strikethrough: `[s]text[/s]` → `<s>text</s>`
- Superscript: `[sup]text[/sup]` → `<sup>text</sup>`
- Subscript: `[sub]text[/sub]` → `<sub>text</sub>`
- Spoilers: `[spoiler]text[/spoiler]` → `<span class="spoiler">text</span>`
- Colors: `[color=red]text[/color]` → `<span style="color:red;">text</span>`
- Tables: `[table]...[/table]` → Proper HTML table structure
- Sections: `[section=title]...[/section]` → Collapsible sections
- Expand blocks: `[expand=title]...[/expand]` → Collapsible expand sections
- Code blocks: `[code]...[/code]` → `<pre><code>...</code></pre>`
- Inline code: `[tt]...[/tt]` → `<code>...</code>`
- Backticks: `` `code` `` → `<code>code</code>`
- Quotes: `[quote]...[/quote]` → `<blockquote>...</blockquote>`
- Wiki links: `[[tag]]` → `<a href="#" class="tag-wiki-link" data-tag-name="tag">tag</a>`
- Wiki links with display: `[[display|tag]]` → Link with display text
- External links: `"text":url` → `<a href="url" target="_blank">text</a>`
- Tag search: `{{tag}}` → `<a href="#" class="tag-wiki-link" data-tag-name="tag">tag</a>`
- Username mentions: `@user` → `<a href="#" class="tag-wiki-link" data-username="user">@user</a>`
- Post references: `post #12345` → `<a href="#" class="tag-wiki-link" data-post-id="12345">post #12345</a>`
- Horizontal rules: `[hr]` → `<hr>`
- Nested lists: `* item`, `** nested` → Proper nested `<ul>` structure
- Ordered lists: `1. item` → `<ol><li>item</li></ol>`
- Nodtext blocks: `[nodtext]...[/nodtext]` → Preserved as-is (escaped)

### 4. Section Navigation
**Test**: Verify section extraction and navigation works

**Steps**:
1. Use `getBodyChunk` with `section` parameter
2. Try different section identifiers (anchor, index, title)

**Expected**:
- Sections can be accessed by anchor: `section: "section-anchor"`
- Sections can be accessed by index: `section: 1` (1-based)
- Sections can be accessed by partial title match
- Section content is extracted correctly using database offsets
- No `[ENDSECTION:anchor]` markers in extracted content (raw DText)

### 5. Edge Cases
**Test**: Verify edge cases are handled

**Steps**:
1. Test tags with no sections
2. Test tags with only collapsible sections `[section=]`
3. Test tags with only headers (h1., h2., etc.)
4. Test tags with mixed formatting
5. Test tags with nested formatting
6. Test tags with malformed DText (missing closing tags)

**Expected**:
- No errors or crashes
- Graceful handling of missing sections
- Nested formatting works correctly
- Malformed DText doesn't break conversion

### 6. Performance
**Test**: Verify database sections improve performance

**Steps**:
1. Open tag wiki modal for tags with many sections
2. Check response times

**Expected**:
- Fast section loading (database query, not parsing)
- No noticeable delay when opening modals
- Smooth scrolling and section navigation

## Known Issues / TODOs

1. **Spoiler styling**: CSS needs to be updated for proper hover-to-reveal
2. **Wiki links**: Should handle locally stored files/images (future enhancement)
3. **Anchor links**: Should navigate to actual page anchors (future enhancement)

## Verification Queries

### Check raw DText storage:
```sql
SELECT id, title, body FROM wikis LIMIT 5;
-- Should see DText format: h1., [b], [section=], etc.
```

### Check section indexing:
```sql
SELECT wiki_id, section_index, level, title, anchor, start_offset, end_offset 
FROM wiki_sections 
ORDER BY wiki_id, section_index 
LIMIT 10;
-- Should see pre-indexed sections with offsets
```

### Check wiki_id in body info:
```sql
SELECT tw.tag_id, w.id AS wiki_id, w.source, w.body 
FROM tag_wikis tw
INNER JOIN wikis w ON w.id = tw.wiki_id
LIMIT 5;
-- Should see wiki_id available for section lookup
```

## Success Criteria

✅ All DText features convert correctly to both markdown and HTML  
✅ Sections are retrieved from database (no parsing fallback)  
✅ No console errors or warnings  
✅ Performance is acceptable (fast section loading)  
✅ Edge cases are handled gracefully  
✅ Database contains raw DText (not markdown)  

## Notes

- The database should store **raw DText** format
- Conversion happens at retrieval time:
  - Root responses: Raw DText → Markdown
  - Modal display: Raw DText → HTML
- Sections are pre-indexed during database creation
- Section extraction uses database offsets, not parsing

