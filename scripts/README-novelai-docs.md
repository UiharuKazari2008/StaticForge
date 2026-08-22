# NovelAI offline documentation import

Imports pages from NovelAI docs, journal, and blog into `.cache/wiki/` for offline viewing in Grimoire (`rdf://docs.novelai.jp/`).

## Supported sources

| Host | Example | Page id prefix |
|------|---------|----------------|
| `docs.novelai.net` | `/en/image/precisereference` | `en/image/...` |
| `journal.novelai.net` | `/image-generation-novelai-diffusion-v5-is-here-c2df7c6b8d2d/` | `journal/...` |
| `blog.novelai.net` | `/subscription-updates-usage-limits-2025-88a208d5d9c5` | `blog/...` |

Blog posts fall back to the `@novelai` Medium RSS feed when direct HTML fetch is blocked.

## Prerequisites

```bash
pnpm add node-html-parser
```

## Usage

Import a single docs page:

```bash
node scripts/import-novelai-docs.js \
  --url https://docs.novelai.net/en/image/precisereference \
  --group "Image Generation"
```

Import a journal announcement:

```bash
node scripts/import-novelai-docs.js \
  --url https://journal.novelai.net/image-generation-novelai-diffusion-v5-is-here-c2df7c6b8d2d/ \
  --group "Announcements"
```

Import a blog post (usage limits, etc.):

```bash
node scripts/import-novelai-docs.js \
  --url https://blog.novelai.net/subscription-updates-usage-limits-2025-88a208d5d9c5 \
  --group "Announcements"
```

Crawl linked docs pages (BFS, supported hosts only):

```bash
node scripts/import-novelai-docs.js \
  --url https://docs.novelai.net/en/image/basics \
  --group "Image Generation" \
  --follow-links
```

Full image-docs recrawl (all `/en/image/*` pages linked from basics):

```bash
node scripts/import-novelai-docs.js \
  --url https://docs.novelai.net/en/image/basics \
  --group "Image Generation" \
  --follow-links
```

Import URLs from a file (one URL per line, `#` comments allowed):

```bash
node scripts/import-novelai-docs.js \
  --urls-file scripts/novelai-urls.txt \
  --group "Image Generation"
```

## Options

| Option | Description |
|--------|-------------|
| `--url` | Page URL (repeatable) |
| `--urls-file` | File with one URL per line |
| `--group` | **Required** — group label in the site index |
| `--follow-links` | BFS crawl internal supported-host links |
| `--site` | Site id (default: `novelai`) |
| `--lang` | Default language prefix for docs ids (default: `en`) |

## Output layout

```
.cache/wiki/
  index.json                 # sites registry
  novelai/
    index.json               # pages: id, title, group, sourceUrl
    pages/{id}.html          # sanitized content HTML
    assets/**                # mirrored images
```

Page ids map to Grimoire addresses:

- `en/image/seed` → `rdf://docs.novelai.jp/en/image/seed`
- `journal/...` → `rdf://docs.novelai.jp/journal/...`
- `blog/...` → `rdf://docs.novelai.jp/blog/...`

## Serving

- Assets: `GET /private/wiki/novelai/assets/...` (authenticated)
- Indexes/pages: WebSocket `get_wiki_home`, `get_static_wiki_site_index`, `get_static_wiki_page`

## Rate limiting

~250 ms between requests, up to 3 retries per fetch.
