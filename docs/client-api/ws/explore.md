# WebSocket: Agora (NovelAI Explore)

Server handler: `modules/ws/handlers/105-exploreHandler.js`

Hosted DSAP domain: `explore.novelai.net` (start menu: **Agora**). Search pages are cached server-side for 1 hour; thumbnails/blobs are proxied under `.cache/explore_files/` and served as `/cache/explore_files/...`.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `block_novelai_explore_creator` | `block_novelai_explore_creator_response` | session | Handler: handleBlockNovelaiExploreCreator |
| `check_novelai_explore_upload` | `check_novelai_explore_upload_response` | session | Handler: handleCheckNovelaiExploreUpload |
| `clear_novelai_explore_gallery_cache` | `clear_novelai_explore_gallery_cache_response` | session | Handler: handleClearNovelaiExploreGalleryCache |
| `downvote_novelai_explore_post` | `downvote_novelai_explore_post_response` | session | Handler: handleDownvoteNovelaiExplorePost |
| `ensure_novelai_explore_image` | `ensure_novelai_explore_image_response` | session | Handler: handleEnsureNovelaiExploreImage |
| `get_novelai_explore_gallery` | `get_novelai_explore_gallery_response` | session | Handler: handleGetNovelaiExploreGallery |
| `get_novelai_explore_post` | `get_novelai_explore_post_response` | session | Handler: handleGetNovelaiExplorePost |
| `get_novelai_explore_user` | `get_novelai_explore_user_response` | session | Handler: handleGetNovelaiExploreUser |
| `list_novelai_explore_blocked_creators` | `list_novelai_explore_blocked_creators_response` | session | Handler: handleListNovelaiExploreBlockedCreators |
| `set_novelai_explore_post_like` | `set_novelai_explore_post_like_response` | session | Handler: handleSetNovelaiExplorePostLike |
| `upload_novelai_explore_image` | `upload_novelai_explore_image_response` | admin/destructive | Handler: handleUploadNovelaiExploreImage |

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

## Detailed packets

### `block_novelai_explore_creator`

**Auth:** Session required

**Handler:** modules/ws/handlers/105-exploreHandler.js → `handleBlockNovelaiExploreCreator`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `undo` | Optional |
| `id` | Optional |
| `name` | Optional |

**Success response:** `block_novelai_explore_creator_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `check_novelai_explore_upload`

**Auth:** Session required

**Handler:** modules/ws/handlers/105-exploreHandler.js → `handleCheckNovelaiExploreUpload`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Optional |
| `forceRefresh` | Optional |

**Success response:** `check_novelai_explore_upload_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `clear_novelai_explore_gallery_cache`

**Auth:** Session required

**Handler:** modules/ws/handlers/105-exploreHandler.js → `handleClearNovelaiExploreGalleryCache`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `clearImages` | Optional |

**Success response:** `clear_novelai_explore_gallery_cache_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `downvote_novelai_explore_post`

**Auth:** Session required

**Handler:** modules/ws/handlers/105-exploreHandler.js → `handleDownvoteNovelaiExplorePost`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `undo` | Optional |
| `id` | Optional |

**Success response:** `downvote_novelai_explore_post_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `ensure_novelai_explore_image`

**Auth:** Session required

**Handler:** modules/ws/handlers/105-exploreHandler.js → `handleEnsureNovelaiExploreImage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `kind` | Optional |
| `id` | Optional |
| `naiMetadata` | Optional |
| `nai_metadata` | Optional |
| `forceRefresh` | Optional |

**Success response:** `ensure_novelai_explore_image_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_novelai_explore_gallery`

**Auth:** Session required

**Handler:** modules/ws/handlers/105-exploreHandler.js → `handleGetNovelaiExploreGallery`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `sort` | Optional |
| `period` | Optional |
| `search` | Optional |
| `creatorId` | Optional |
| `page` | Optional |
| `offset` | Optional |
| `limit` | Optional |
| `forceRefresh` | Optional |
| `likedBySelf` | Optional |
| `sortDirection` | Optional |

**Success response:** `get_novelai_explore_gallery_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_novelai_explore_post`

**Auth:** Session required

**Handler:** modules/ws/handlers/105-exploreHandler.js → `handleGetNovelaiExplorePost`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |

**Success response:** `get_novelai_explore_post_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_novelai_explore_user`

**Auth:** Session required

**Handler:** modules/ws/handlers/105-exploreHandler.js → `handleGetNovelaiExploreUser`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `forceRefresh` | Optional |

**Success response:** `get_novelai_explore_user_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `list_novelai_explore_blocked_creators`

**Auth:** Session required

**Handler:** modules/ws/handlers/105-exploreHandler.js → `handleListNovelaiExploreBlockedCreators`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `list_novelai_explore_blocked_creators_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `set_novelai_explore_post_like`

**Auth:** Session required

**Handler:** modules/ws/handlers/105-exploreHandler.js → `handleSetNovelaiExplorePostLike`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `like` | Optional |
| `id` | Optional |

**Success response:** `set_novelai_explore_post_like_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `upload_novelai_explore_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/105-exploreHandler.js → `handleUploadNovelaiExploreImage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Optional |
| `title` | Optional |

**Success response:** `upload_novelai_explore_image_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

