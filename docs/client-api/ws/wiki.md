# WebSocket: Grimoire / Wiki

Server handler: `modules/ws/handlers/110-wikiHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `get_static_wiki_page` | `get_static_wiki_page_response` | session | Handler: handleGetStaticWikiPage |
| `get_static_wiki_site_index` | `get_static_wiki_site_index_response` | session | Handler: handleGetStaticWikiSiteIndex |
| `get_tag_wiki_page` | `get_tag_wiki_page_response` | session | Handler: handleGetTagWikiPage |
| `get_wiki_home` | `get_wiki_home_response` | session | Handler: handleGetWikiHome |
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

## Detailed packets

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

