# WebSocket: Search & Tags

Server handler: `modules/ws/handlers/70-searchHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `fetch_autofill_wiki_previews` | `fetch_autofill_wiki_previews_response` | session | Handler: handleFetchAutofillWikiPreviews |
| `get_dataset_tags_for_path` | `get_dataset_tags_for_path_response` | session | Handler: handleGetDatasetTagsForPath |
| `lookup_city` | `lookup_city_response` | session | Handler: handleCityLookup |
| `search_characters` | `search_characters_response` | session | Handler: handleCharacterSearch |
| `search_dataset_tags` | `search_dataset_tags_response` | session | Handler: handleDatasetTagSearch |
| `search_files` | `search_files_response` | session | Handler: handleFileSearch |
| `search_index_clear_cache` | `search_index_clear_cache_response` | session | Handler: handleClearSearchIndexCache |
| `search_index_prepare_cache` | `search_index_prepare_cache_response` | session | Handler: handlePrepareSearchCache |
| `search_index_rebuild_all` | `search_index_rebuild_all_response` | session | Handler: handleRebuildAllIndexes |
| `search_index_toggle_pause` | `search_index_toggle_pause_response` | session | Handler: handleToggleIndexingPause |
| `search_index_trigger` | `search_index_trigger_response` | session | Handler: handleTriggerIndexing |
| `search_tags` | `search_tags_response` | session | Handler: handleSearchTags |
| `spellcheck_add_word` | `spellcheck_add_word_response` | admin/destructive | Handler: handleAddWordToDictionary |

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

## Detailed packets

### `fetch_autofill_wiki_previews`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleFetchAutofillWikiPreviews`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `tagIds` | Optional |
| `autofillSessionId` | Optional |
| `model` | Optional |

**Success response:** `fetch_autofill_wiki_previews_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_dataset_tags_for_path`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleGetDatasetTagsForPath`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `path` | Optional |

**Success response:** `get_dataset_tags_for_path_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `lookup_city`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleCityLookup`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `cityName` | Optional |

**Success response:** `lookup_city_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_characters`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleCharacterSearch`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `query` | Optional |
| `model` | Optional |
| `autofillSessionId` | Optional |
| `spellCheckText` | Optional |
| `isContinuation` | Optional |
| `autofillSettings` | Optional |
| `includes` | Optional |

**Success response:** `search_characters_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_dataset_tags`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleDatasetTagSearch`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `query` | Optional |
| `path` | Optional |

**Success response:** `search_dataset_tags_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_files`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleFileSearch`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `query` | Optional |
| `viewType` | Optional |
| `action` | Optional |
| `contextTags` | Optional |

**Success response:** `search_files_response`

Additional response/push types from handler:
- `search_indexing_status`

**Push side effects:**
- `search_indexing_status`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_index_clear_cache`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleClearSearchIndexCache`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `search_index_clear_cache_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_index_prepare_cache`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handlePrepareSearchCache`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `viewType` | Optional |

**Success response:** `search_index_prepare_cache_response`

Additional response/push types from handler:
- `search_indexing_status`

**Push side effects:**
- `search_indexing_status`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_index_rebuild_all`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleRebuildAllIndexes`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `search_index_rebuild_all_response`

Additional response/push types from handler:
- `search_indexing_status`

**Push side effects:**
- `search_indexing_status`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_index_toggle_pause`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleToggleIndexingPause`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `search_index_toggle_pause_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_index_trigger`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleTriggerIndexing`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `search_index_trigger_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_tags`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleSearchTags`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `query` | Optional |
| `single_match` | Optional |

**Success response:** `search_tags_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `spellcheck_add_word`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleAddWordToDictionary`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `word` | Optional |

**Success response:** `spellcheck_add_word_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

