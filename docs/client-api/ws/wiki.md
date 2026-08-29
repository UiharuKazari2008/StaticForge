# WebSocket: Grimoire / Wiki

Server handler: `modules/ws/handlers/110-wikiHandler.js`

Application-key scopes: `wiki` or `autofill` (Ivory's ranking+Grimoire key uses `autofill`, not `search`). Loopback HTTP: `POST /agent/packet`.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `delete_fandom_wiki_import` | `delete_fandom_wiki_import_response` | admin/destructive | Handler: handleDeleteFandomWikiImport |
| `get_fandom_wiki_index` | `get_fandom_wiki_index_response` | session | Handler: handleGetFandomWikiIndex |
| `get_fandom_wiki_manager` | `get_fandom_wiki_manager_response` | session | Handler: handleGetFandomWikiManager |
| `get_static_wiki_page` | `get_static_wiki_page_response` | session | Handler: handleGetStaticWikiPage |
| `get_static_wiki_site_index` | `get_static_wiki_site_index_response` | session | Handler: handleGetStaticWikiSiteIndex |
| `get_tag_wiki_page` | `get_tag_wiki_page_response` | session | Handler: handleGetTagWikiPage |
| `get_wiki_home` | `get_wiki_home_response` | session | Handler: handleGetWikiHome |
| `import_fandom_wiki_page` | `import_fandom_wiki_page_response` | admin/destructive | Handler: handleImportFandomWikiPage (Fandom `*.fandom.com` or generic MediaWiki `/api.php`) |
| `import_static_wiki` | `import_static_wiki_response` | admin/destructive | Handler: handleImportStaticWiki (NovelAI docs/journal/blog) |
| `update_wiki_import` | `update_wiki_import_response` | admin/destructive | Handler: handleUpdateWikiImport (re-pull fandom import or cached site) |
| `refresh_tag_wiki_page` | `refresh_tag_wiki_page_response` | session | Handler: handleRefreshTagWikiPage |
| `resolve_grimoire_url` | `resolve_grimoire_url_response` | session | Handler: handleResolveGrimoireUrl |
| `search_tag_wiki` | `search_tag_wiki_response` | session | Handler: handleSearchTagWiki |

## Response envelope

Successful replies usually use:

```json
{
  "type": "<request_type>_response",
  "requestId": "<same as request>",
  "data": { "success": true, ... },
  "timestamp": "<ISO-8601>"
}
```

Errors use `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors).

## Read-only restrictions

Packets marked destructive in `modules/websocketHandlers.js` → `isDestructiveOperation()` return `READONLY_RESTRICTED` for `userType: "readonly"` sessions.

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

## Detailed packets

### `delete_fandom_wiki_import`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleDeleteFandomWikiImport`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `importId` | Optional |
| `removeChildren` | Optional |

**Success response:** `delete_fandom_wiki_import_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_fandom_wiki_index`

**Auth:** Session required

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleGetFandomWikiIndex`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `showAll` | Optional |

**Success response:** `get_fandom_wiki_index_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_fandom_wiki_manager`

**Auth:** Session required

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleGetFandomWikiManager`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_fandom_wiki_manager_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_static_wiki_page`

**Auth:** Session required

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleGetStaticWikiPage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `siteId` | Optional |
| `pageId` | Optional |

**Success response:** `get_static_wiki_page_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_static_wiki_site_index`

**Auth:** Session required

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleGetStaticWikiSiteIndex`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `siteId` | Optional |

**Success response:** `get_static_wiki_site_index_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_tag_wiki_page`

**Auth:** Session required

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleGetTagWikiPage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `tagName` | Optional |
| `source` | Optional |
| `format` | Optional |
| `force` | Optional |
| `forceRefresh` | Optional |

**Success response:** `get_tag_wiki_page_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_wiki_home`

**Auth:** Session required

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleGetWikiHome`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_wiki_home_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `import_fandom_wiki_page`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleImportFandomWikiPage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `url` | Fandom `*.fandom.com/wiki/…` **or** a MediaWiki article URL (Wikipedia, Miraheze, wiki.gg, independently hosted). Non-Fandom hosts are probed for `/api.php` (`/w/api.php`, `/wiki/api.php`, origin `/api.php`) via `action=query&meta=siteinfo`. Not MediaWiki → `type: "error"` with a clear message (no hang, no silent no-op). |
| `followLinks` | Optional boolean. Default off (this page only). Wikipedia-scale follows would explode. |
| `maxPages` | Optional cap. Fandom hard max 80; generic MediaWiki hard max **25** (also the follow default). |
| `group` | Optional index group label |
| `recordImport` | Optional; `false` skips creating a library import row (live click-through fetch). Generic MediaWiki follows the same rule. |
| `updateExisting` | Optional; reuse existing import row for the same wiki+root |
| `updateImportId` | Optional numeric import id to refresh |

**Success response:** `import_fandom_wiki_page_response`

`get_fandom_wiki_manager` also returns `sites[]` (all cached wikis: Fandom, NovelAI, MediaWiki `kind: "mediawiki"`, static) plus `imports[]`.

Generic MediaWiki imports store `kind: "mediawiki"`, `origin`, `articlepath`, `scriptpath`, and `apiBase` on the site row. Images are mirrored under `/private/wiki/<siteId>/assets/` (no hotlink). Article paths come from siteinfo (`articlepath` / `scriptpath`); `/wiki/` is not assumed.

Non-MediaWiki URLs fail immediately after the api.php probe (8s timeout per candidate, up to 4 candidates in parallel) with a client `error` packet whose `message` explains that only Fandom, NovelAI, and MediaWiki `/api.php` sites can be imported.

Additional response/push types from handler:
- `fandom_wiki_import_progress`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `import_static_wiki`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleImportStaticWiki`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `url` | docs.novelai.net / journal.novelai.net / NovelAI blog URL |
| `followLinks` | Optional |
| `maxPages` | Optional |
| `group` | Optional |
| `site` | Optional site id (default `novelai`) |
| `lang` | Optional docs language prefix (default `en`) |

**Success response:** `import_static_wiki_response`

Additional response/push types from handler:
- `fandom_wiki_import_progress`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `update_wiki_import`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleUpdateWikiImport`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `importId` | Fandom import row to re-pull |
| `siteId` | Cached wiki site to re-pull (pages with stored `sourceUrl`) |

**Success response:** `update_wiki_import_response`

Additional response/push types from handler:
- `fandom_wiki_import_progress`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `refresh_tag_wiki_page`

**Auth:** Session required

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleRefreshTagWikiPage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `tagName` | Optional |
| `source` | Optional |
| `format` | Optional |
| `force` | Optional |

**Success response:** `refresh_tag_wiki_page_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `resolve_grimoire_url`

**Auth:** Session required

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleResolveGrimoireUrl`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `url` | Optional |

**Success response:** `resolve_grimoire_url_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_tag_wiki`

**Auth:** Session required

**Handler:** modules/ws/handlers/110-wikiHandler.js → `handleSearchTagWiki`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `query` | Optional |
| `category` | Optional |
| `searchType` | Optional |
| `source` | Optional |
| `includeNonTag` | Optional |
| `limit` | Optional |
| `includeOnline` | Optional |

**Success response:** `search_tag_wiki_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

