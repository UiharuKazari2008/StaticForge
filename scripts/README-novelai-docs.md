# NovelAI offline documentation import

Imports pages from [docs.novelai.net](https://docs.novelai.net) into `.cache/wiki/` for offline viewing in Grimoire (tag wiki modal).

## Prerequisites

```bash
pnpm add node-html-parser
```

## Usage

Import a single page:

```bash
node scripts/import-novelai-docs.js \
  --url https://docs.novelai.net/en/image/precisereference \
  --group "Image Generation"
```

Crawl linked docs pages (BFS, same host only):

```bash
node scripts/import-novelai-docs.js \
  --url https://docs.novelai.net/en/image/precisereference \
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
| `--follow-links` | BFS crawl internal `docs.novelai.net` links |
| `--site` | Site id (default: `novelai`) |
| `--lang` | Default language prefix (default: `en`) |

## Output layout

```
.cache/wiki/
  index.json                 # sites registry
  novelai/
    index.json               # pages: id, title, group, sourceUrl
    pages/{id}.html          # sanitized #content HTML
    assets/**                # mirrored images
```

## Serving

- Assets: `GET /private/wiki/novelai/assets/...` (authenticated)
- Indexes/pages: WebSocket `get_wiki_home`, `get_static_wiki_site_index`, `get_static_wiki_page`

## Rate limiting

~250 ms between requests, up to 3 retries per fetch.
