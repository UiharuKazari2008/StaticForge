# Downloading and Loading Missing Wiki Pages

Missing wiki pages are downloaded and loaded by **one script**. It does **not** recreate `tag_wiki.db`. Re-run it to resume.

```bash
node scripts/download-missing-wikis.js
```

Load already-downloaded JSON without fetching:

```bash
node scripts/download-missing-wikis.js --load-only
```

Official bulk dumps (tags + all wiki pages, including post–July 2026 pages) stay separate:

```bash
node scripts/download-tag-dumps.js
node scripts/create-tag-database.js
```

Tag *suggestion* is gated by `created_at` (V4.5: through 2025-05-29; V5+: through end of July 2026). Wiki pages are always stored and stay browsable. Missing `n_count` values are filled from `.cache/tag_search.db` (NovelAI suggest-tags cache).

## Workflow

### Step 1: Generate Missing Wikis List

Run `create-tag-database.js` to generate `data/tags_missing_wikis.json` (this rebuilds the tag DB):

```bash
node scripts/create-tag-database.js
```

This creates a JSON file with all tags/wiki pages that need to be downloaded:
- `danbooru`: Array of tag/wiki page names
- `e621`: Array of tag/wiki page names

### Step 2: Download + load (resume-safe)

```bash
node scripts/download-missing-wikis.js
```

**What it does:**
- Reads `data/tags_missing_wikis.json`
- Skips titles already saved in JSON or already in `tag_wiki.db`
- Fetches remaining wiki pages from Danbooru / e621 (follows tag aliases)
- Flushes `data/danbooru_missing_wikis.json` and `data/e621_missing_wikis.json` every 20 downloads and on Ctrl+C
- Loads new pages into the **existing** database (normalizes bodies, links tags, extracts sections, updates FTS5)

`load-downloaded-wikis.js` still exists as the load-only module used by that script.

## Wiki images (Danbooru + e621)

There is no separate e621 image script. Both sources are in:

```bash
node scripts/download-danbooru-images.js
```

It reads `data/wiki_post_thumb_refs.json`, downloads `source=1` (Danbooru) and `source=2` (e621) into `.cache/wiki_files/`, and skips files that already exist.

## Notes

- Ctrl+C waits for in-flight requests, saves JSON, then loads what was downloaded. Re-run to continue.
- Titles that were “not found” are retried on the next run (alias lookups may succeed).
- The loader skips wikis that already exist in the database.
- All normalization matches `create-tag-database.js`.
