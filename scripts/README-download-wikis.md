# Downloading and Loading Missing Wiki Pages

This guide explains how to download missing wiki pages and load them into the database.

## Overview

There are two scripts that work together:

1. **`download-missing-wikis.js`** - Downloads wiki pages from Danbooru/e621 APIs
2. **`load-downloaded-wikis.js`** - Loads downloaded wikis into the database

## Workflow

### Step 1: Generate Missing Wikis List

First, run `create-tag-database.js` to generate `data/tags_missing_wikis.json`:

```bash
node scripts/create-tag-database.js
```

This creates a JSON file with all tags/wiki pages that need to be downloaded:
- `danbooru`: Array of tag/wiki page names
- `e621`: Array of tag/wiki page names

### Step 2: Download Wiki Pages

Run the download script to fetch wiki pages from the APIs:

```bash
node scripts/download-missing-wikis.js
```

**What it does:**
- Reads `data/tags_missing_wikis.json`
- Fetches each wiki page from Danbooru or e621 API
- Downloads raw DText body content
- Saves to:
  - `data/danbooru_missing_wikis.json`
  - `data/e621_missing_wikis.json`

**Features:**
- Rate limiting (250ms between requests)
- Automatic retry on failures
- Progress logging
- Skips pages that don't exist
- Handles both tags and unlinked wiki pages

### Step 3: Load into Database

Run the loader script to insert downloaded wikis into the database:

```bash
node scripts/load-downloaded-wikis.js
```

**What it does:**
- Reads downloaded wiki JSON files
- Normalizes wiki bodies (same as create-tag-database.js)
- Inserts into `wikis` table
- Links wikis to tags if tag exists
- Extracts sections, content links, etc.
- Updates FTS5 index

**Features:**
- Automatically links wikis to existing tags
- Creates unlinked wiki pages for tag groups
- Extracts all sections and links
- Updates search indexes

## API Endpoints Used

### Danbooru
- Wiki pages: `GET /wiki_pages.json?search[title]={title}`
- Tags: `GET /tags.json?search[name]={name}`

### e621
- Wiki pages: `GET /wiki_pages.json?search[title]={title}`
- Tags: `GET /tags.json?search[name]={name}`

## Output Format

### Downloaded Wikis JSON

```json
{
  "_metadata": {
    "generated_at": "2025-01-XX...",
    "source": "danbooru",
    "total_wikis": 123
  },
  "wikis": [
    {
      "title": "tag name",
      "body": "raw DText content...",
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-01-02T00:00:00Z",
      "is_locked": 0
    }
  ]
}
```

## Notes

- Both scripts handle rate limiting and errors gracefully
- The download script stops after 10 consecutive failures (to avoid wasting time)
- The loader script skips wikis that already exist in the database
- All normalization matches the format used in `create-tag-database.js`

## Troubleshooting

**Download script fails with 429 (Rate Limited):**
- The script automatically retries with exponential backoff
- If it keeps failing, you may need to wait longer between requests
- Edit `RATE_LIMIT_DELAY` in the script (default: 250ms)

**Loader script says wiki already exists:**
- This is normal if you've already loaded the wiki
- The script uses `INSERT OR IGNORE` to skip duplicates

**API returns 404 for some wikis:**
- Some tags/wiki pages don't exist on the source site
- These are skipped and logged as "not found"
- This is expected behavior

