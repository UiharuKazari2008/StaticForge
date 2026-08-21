# WebSocket: NAX Tags

Server handler: `modules/ws/handlers/100-naxHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `clear_nax_vibes_gallery_cache` | `clear_nax_vibes_gallery_cache_response` | session | Handler: handleClearNaxVibesGalleryCache |
| `delete_nax_custom_tag` | `delete_nax_custom_tag_response` | admin/destructive | Handler: handleDeleteNaxCustomTag |
| `generate_nax_custom_tag` | `generate_nax_custom_tag_response` | admin/destructive | Handler: handleGenerateNaxCustomTag |
| `get_nax_expander_presets` | `get_nax_expander_presets_response` | session | Handler: handleGetNaxExpanderPresets |
| `get_nax_galleries` | `get_nax_galleries_response` | session | Handler: handleGetNaxGalleries |
| `get_nax_marked_tags` | `get_nax_marked_tags_response` | session | Handler: handleGetNaxMarkedTags |
| `get_nax_tags` | `get_nax_tags_response` | session | Handler: handleGetNaxTags |
| `get_nax_vibes_gallery` | `get_nax_vibes_gallery_response` | session | Handler: handleGetNaxVibesGallery |
| `set_nax_favorite` | `set_nax_favorite_response` | session | Handler: handleSetNaxFavorite |
| `set_nax_hidden` | `set_nax_hidden_response` | session | Handler: handleSetNaxHidden |
| `set_nax_try` | `set_nax_try_response` | session | Handler: handleSetNaxTry |

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

### `clear_nax_vibes_gallery_cache`

**Auth:** Session required

**Handler:** modules/ws/handlers/100-naxHandler.js → `handleClearNaxVibesGalleryCache`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `clear_nax_vibes_gallery_cache_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_nax_custom_tag`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/100-naxHandler.js → `handleDeleteNaxCustomTag`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `gallerySlug` | Optional |
| `tag` | Optional |

**Success response:** `delete_nax_custom_tag_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `generate_nax_custom_tag`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/100-naxHandler.js → `handleGenerateNaxCustomTag`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `gallerySlug` | Optional |
| `tag` | Optional |

**Success response:** `generate_nax_custom_tag_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_nax_expander_presets`

**Auth:** Session required

**Handler:** modules/ws/handlers/100-naxHandler.js → `handleGetNaxExpanderPresets`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `model` | Optional |

**Success response:** `get_nax_expander_presets_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_nax_galleries`

**Auth:** Session required

**Handler:** modules/ws/handlers/100-naxHandler.js → `handleGetNaxGalleries`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_nax_galleries_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_nax_marked_tags`

**Auth:** Session required

**Handler:** modules/ws/handlers/100-naxHandler.js → `handleGetNaxMarkedTags`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `markFilter` | Optional |
| `gallerySlug` | Optional |
| `limit` | Optional |

**Success response:** `get_nax_marked_tags_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_nax_tags`

**Auth:** Session required

**Handler:** modules/ws/handlers/100-naxHandler.js → `handleGetNaxTags`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `gallerySlug` | Optional |
| `query` | Optional |
| `sort` | Optional |
| `invert` | Optional |
| `minUp` | Optional |
| `maxUp` | Optional |
| `minDown` | Optional |
| `maxDown` | Optional |
| `minScore` | Optional |
| `maxScore` | Optional |
| `minRatio` | Optional |
| `maxRatio` | Optional |
| `randomSeed` | Optional |
| `markFilter` | Optional |
| `offset` | Optional |
| `limit` | Optional |
| `elevatePins` | Optional |
| `elevateFavorites` | Optional |

**Success response:** `get_nax_tags_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_nax_vibes_gallery`

**Auth:** Session required

**Handler:** modules/ws/handlers/100-naxHandler.js → `handleGetNaxVibesGallery`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `preset` | Optional |
| `page` | Optional |
| `search` | Optional |
| `filter45Curated` | Optional |
| `filter45Full` | Optional |
| `filter4Curated` | Optional |
| `filter4Full` | Optional |
| `forceRefresh` | Optional |

**Success response:** `get_nax_vibes_gallery_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `set_nax_favorite`

**Auth:** Session required

**Handler:** modules/ws/handlers/100-naxHandler.js → `handleSetNaxFavorite`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `gallerySlug` | Optional |
| `tag` | Optional |
| `favorite` | Optional |

**Success response:** `set_nax_favorite_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `set_nax_hidden`

**Auth:** Session required

**Handler:** modules/ws/handlers/100-naxHandler.js → `handleSetNaxHidden`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `gallerySlug` | Optional |
| `tag` | Optional |
| `hidden` | Optional |

**Success response:** `set_nax_hidden_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `set_nax_try`

**Auth:** Session required

**Handler:** modules/ws/handlers/100-naxHandler.js → `handleSetNaxTry`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `gallerySlug` | Optional |
| `tag` | Optional |
| `tryMark` | Optional |

**Success response:** `set_nax_try_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

