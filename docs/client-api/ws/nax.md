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

## Runtime contract

NAX tag data is optional at boot. `modules/naxTagsDatabase.js` opens `.cache/nax_tags.db` when `scripts/import-nax-tags.js` has imported a `tags.zip` export; otherwise the server starts with NAX data features offline. Preview images are served by REST at `GET /naxCache/:gallerySlug/:filename` after resolving the filename against the DB row.

`get_nax_galleries` returns database galleries plus `generationEnabled`, which is true only when the gallery slug exists in `nax_generation_config.json`. Clients should use that flag before offering "Generate" for a missing linked mark.

### Gallery marks and linked rows

Favorites and try marks are shared across same-kind gallery groups when the tag row exists in sibling galleries:

| Group | Linked gallery slugs |
|-------|----------------------|
| Artists | `danbooru-artist-tags-v4`, `danbooru-artist-tags-v4.5`, `danbooru-artist-tags-2-v4.5`, `danbooru-artist-tags-v5`, `danbooru-artist-tags-2-v5`, `danbooru-artist-tags-male-2-v5` |
| Characters | `danbooru-character-tags-v4`, `danbooru-character-tags-v4.5`, `danbooru-character-tags-v5` |
| Faces | `danbooru-face-tags-v4`, `danbooru-face-tags-v4.5` |
| Hair | `danbooru-hair-tags-v4.5`, `danbooru-hair-tags-v5` |

`set_nax_favorite` and `set_nax_try` update all existing sibling rows in the group. Startup/import also propagates existing marks. Hidden marks are per-gallery and are not shared.

When a marked tag exists in a sibling gallery but not the requested gallery, `get_nax_tags` can return a virtual row with `missing: true`, empty `filename`, score/votes `0`, and inherited `favorite` / `tryMark`. `get_nax_marked_tags` returns global missing rows in `data.missing` when no `gallerySlug` is supplied.

### Tag query controls

`get_nax_tags` supports:

| Field | Values / behavior |
|-------|-------------------|
| `sort` | `score` (default), `name`, `date`, `ratio`, `random` |
| `invert` | Reverses the selected sort direction |
| `markFilter` | `all`, `favorites`, `try`, `unmarked`, `hidden`, `custom` |
| `missingMode` | `include` (default), `hide`, `only`; numeric bounds and ratio filters suppress virtual missing rows because those rows have zero votes/score |
| `elevatePins` | `0` none, `1` favorites, `2` try marks, `3` both; legacy `elevateFavorites: true` maps to `1` |
| `limit` / `offset` | `limit` is clamped to `1..100`; `offset` is zero-based |

Responses include `items`, `total`, `hasMore`, and `realCount`. Each item maps DB fields to client names: `gallerySlug`, `tag`, `filename`, `upvotes`, `downvotes`, `score`, `favorite`, `tryMark`, `hidden`, `exportIndex`, `isCustom`, and optional `missing`.

### Internal prompt expanders

`get_nax_expander_presets` exposes server-side placeholders for prompt text and the right-click prompt menu:

| Pattern | Meaning |
|---------|---------|
| `!NAX_FAV_<ID>` | Random favorite from that preset's resolved gallery slugs |
| `!NAX_TRY_<ID>` | Random try-marked tag from that preset's resolved gallery slugs |
| `!NAX_ANY_<ID>` | Random non-hidden tag from that preset's resolved gallery slugs |

Preset IDs are `CHARA`, `ARTIST`, `CURATED`, `FACE`, `COPYRIGHT`, and `HAIR`. The server resolves the current model when choosing slugs:

| Preset | V5 behavior | V4.5 / V4 behavior |
|--------|-------------|--------------------|
| `ARTIST` | `danbooru-artist-tags-v5`, `danbooru-artist-tags-2-v5`, `danbooru-artist-tags-male-2-v5` | V4.5 uses `danbooru-artist-tags-v4.5` + `danbooru-artist-tags-2-v4.5`; V4 uses `danbooru-artist-tags-v4` |
| `CHARA` | `danbooru-character-tags-v5`, then V4.5/V4 fallbacks when installed | V4.5/V4 primary first, with older fallbacks |
| `HAIR` | `danbooru-hair-tags-v5`, then V4.5 fallback | V4.5 only; unavailable for V4 |
| `FACE` | V4.5/V4 face galleries | V4.5/V4 face galleries |
| `COPYRIGHT` | `danbooru-copyright-tags-v4.5` | V4.5 only; unavailable for V4 |
| `CURATED` | `artists-v4.5` | V4.5 only; unavailable for V4 |

The response includes `favPattern`, `tryPattern`, `anyPattern`, mark counts, `anyCount`, and `canResolveAny`. The prompt-replacement path in `modules/textReplacements.js` records chosen lock metadata (`nax_tag`, `nax_gallery_slug`, `nax_preset_id`) so reruns can reuse the same resolved tag. `!NAX_ANY_*` is hidden from manual lock-picker options when more than 100 visible tags match, but generation-time random resolution can still pick from the full resolved slug set.

### Custom tag generation

`generate_nax_custom_tag` is admin/destructive. It validates a single trimmed tag (`1..120` chars, no comma, control characters, slash, backslash, or `..`), returns an existing DB row when the tag already exists, and otherwise calls `NaxTagGenerationService` with the gallery entry from `nax_generation_config.json`.

Generation config must place `<INPUT_VALUE>` in `promptTemplate` or `characterPrompt`. The output file is saved under `.cache/nax_images/<gallerySlug>/<encoded-tag>.png`, then inserted as an `isCustom` tag with score/votes `0`. If DB insertion fails after image generation, the generated file is removed.

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

