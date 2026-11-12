# WebSocket: Search & Tags

Server handler: `modules/ws/handlers/70-searchHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `fetch_autofill_wiki_previews` | `fetch_autofill_wiki_previews_response` | session | Handler: handleFetchAutofillWikiPreviews |
| `get_dataset_tags_for_path` | `get_dataset_tags_for_path_response` | session | Handler: handleGetDatasetTagsForPath |
| `get_prompt_index_status` | `get_prompt_index_status_response` | session | Handler: handleGetPromptIndexStatus |
| `lookup_city` | `lookup_city_response` | session | Handler: handleCityLookup |
| `omegasearch_query` | `omegasearch_query_response` | session | Handler: handleOmegasearchQuery |
| `prompt_index_cancel` | `prompt_index_cancel_response` | session | Handler: handlePromptIndexCancel |
| `prompt_index_pause` | `prompt_index_pause_response` | session | Handler: handlePromptIndexPause |
| `prompt_index_reconcile` | `prompt_index_reconcile_response` | session | Handler: handlePromptIndexReconcile |
| `prompt_index_resume` | `prompt_index_resume_response` | session | Handler: handlePromptIndexResume |
| `prompt_index_start` | `prompt_index_start_response` | session | Handler: handlePromptIndexStart |
| `search_characters` | `search_characters_response` | session | Handler: handleCharacterSearch |
| `search_dataset_tags` | `search_dataset_tags_response` | session | Handler: handleDatasetTagSearch |
| `search_files` | `search_files_response` | session | Handler: handleFileSearch |
| `search_index_clear_cache` | `search_index_clear_cache_response` | session | Drops the caller's own per-session search cache only; open to readonly |
| `search_index_prepare_cache` | `search_index_prepare_cache_response` | session | Handler: handlePrepareSearchCache |
| `search_index_rebuild_all` | `search_index_rebuild_all_response` | admin/destructive | Full index rebuild; blocked for readonly (Yozora #700) |
| `search_index_toggle_pause` | `search_index_toggle_pause_response` | admin/destructive | Host-wide pause/resume; blocked for readonly (Yozora #700) |
| `search_index_trigger` | `search_index_trigger_response` | admin/destructive | Starts an indexing sync; blocked for readonly (Yozora #700) |
| `search_tags` | `search_tags_response` | session | Handler: handleSearchTags |
| `spellcheck_add_word` | `spellcheck_add_word_response` | admin/destructive | Handler: handleAddWordToDictionary |
| `spell_check_text` | `spell_check_text_response` | session | Unknown words in a text with suggestions (Messaging / Text Messages, #757) |

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

`search_index_rebuild_all`, `search_index_trigger` and `search_index_toggle_pause` are on that list (and tagged `SEARCH_DESTRUCTIVE`). `search_index_clear_cache` is not: it only drops the caller's own per-session search cache.

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

### `get_prompt_index_status`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleGetPromptIndexStatus`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_prompt_index_status_response`

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

### `omegasearch_query`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleOmegasearchQuery`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `blocks` | Optional |
| `workspaceId` | Optional |
| `viewType` | Optional |
| `offset` | Optional |
| `limit` | Optional |
| `usageLimit` | Optional |
| `filters` | Optional |
| `promptSource` | Optional |
| `blockOptions` | Optional |
| `searchSessionId` | Optional |
| `forceRefresh` | Optional |

**Success response:** `omegasearch_query_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `prompt_index_cancel`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handlePromptIndexCancel`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `prompt_index_cancel_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `prompt_index_pause`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handlePromptIndexPause`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `prompt_index_pause_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `prompt_index_reconcile`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handlePromptIndexReconcile`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `prompt_index_reconcile_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `prompt_index_resume`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handlePromptIndexResume`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `prompt_index_resume_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `prompt_index_start`

**Auth:** Session required

**Handler:** modules/ws/handlers/70-searchHandler.js → `handlePromptIndexStart`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `prompt_index_start_response`

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
| `autofillSettings` | Optional. Includes `spellcheckSoundAlike` (default true): when false, spellcheck skips sound-alike suggestions (#693) |
| `modelMode` | Optional |
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
| `includeSuggestions` | Optional, `action: "search"` only. `false` skips the first-term `tagSuggestions` (a tag + fulltext LIKE / GROUP BY query, 0.3-7 s on a cold cache); the web client sends `false` because the result list never shows them and the dropdown requests suggestions itself (#649). Omitted: suggestions are included as before |

**Success response:** `search_files_response` — `data.status` `cache_ready` / `cache_cleared` / `suggestions` / `complete`. For `complete`, `data.results[]` is `{ filename, matchScore, metadata? }` where `metadata` holds only `width`, `height`, `upscaled`, `size`, `mtime` (`getImageDimensionsBatch`, no metadata JSON is loaded for a search, #649), plus `data.count` and `data.tagSuggestions` for the first term (`[]` when `includeSuggestions` was `false`).

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

**Auth:** Session required. Admin only (destructive — blocked for readonly)

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

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/70-searchHandler.js → `handleToggleIndexingPause`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `search_index_toggle_pause_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_index_trigger`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

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

**Client artist prefixes:** Web autofill may send `query` with the name remainder after stripping `artist:` / `art by ` (see `parseAutofillArtistSearchPrefix` in `autocompleteUtils.js`). Server still receives a plain tag query; prefix rewrite is client-side on insert.

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

### `spell_check_text`

**Auth:** Signed-in session (unauthenticated → `{ success: false, code: "NOT_SIGNED_IN" }`)

**Handler:** modules/ws/handlers/303-spellCheckHandler.js (spell engine `modules/spellChecker.js`, Yozora #757)

Spell check for text a person writes (Melaton Mobile Messaging and Text Messages): the words the engine does not know, in order, each with its place in the text.

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `text` | The text (top level or under `data`); cut at 20000 characters |

**Success response:** `spell_check_text_response` with `data: { success: true, words: [{ word, start, end, suggestions[≤5] }] }`

**Errors:** in the same response with `success: false`: `NOT_SIGNED_IN`, `UNAVAILABLE` (no spell engine), `ERROR`.
