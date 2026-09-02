# WebSocket: Gallery

Server handler: `modules/ws/handlers/120-galleryHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `delete_images_bulk` | `delete_images_bulk_response` | admin/destructive | Handler: handleDeleteImagesBulk |
| `delete_unupscaled_original` | `delete_unupscaled_original_response` | admin/destructive | Handler: handleDeleteUnupscaledOriginal |
| `find_image_index` | `find_image_index_response` | session | Handler: handleFindImageIndexRequest |
| `gallery_position_hint` | `gallery_position_hint_response` | session | Handler: handleGalleryPositionHint |
| `request_gallery` | `request_gallery_response` | session | Handler: handleGalleryRequest |
| `request_image_by_index` | `request_image_by_index_response` | session | Handler: handleImageByIndexRequest |
| `request_image_metadata` | `request_image_metadata_response` | session | Handler: handleImageMetadataRequest |
| `request_url_upload_metadata` | `request_url_upload_metadata_response` | session | Handler: handleUrlUploadMetadataRequest |
| `send_to_sequenzia_bulk` | `send_to_sequenzia_bulk_response` | session | Handler: handleSendToSequenziaBulk |
| `set_gallery_show_shared` | `set_gallery_show_shared_response` | session | Handler: handleSetGalleryShowShared |
| `update_image_preset_bulk` | `update_image_preset_bulk_response` | admin/destructive | Handler: handleUpdateImagePresetBulk |

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

`delete_images_bulk` and `update_image_preset_bulk` are destructive (admin only). Other gallery packets are readable by readonly users.

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

### `delete_images_bulk`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/120-galleryHandler.js → `handleDeleteImagesBulk`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filenames` | Required |

**Validation errors:**
- Filenames array is required

**Success response:** `delete_images_bulk_response`

Additional response/push types from handler:
- `original`
- `dynGenPreview`
- `upscaled`
- `preview`
- `gallery_updated`

**Push side effects:**
- `gallery_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_unupscaled_original`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/120-galleryHandler.js → `handleDeleteUnupscaledOriginal`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Required |

**Validation errors:**
- Filename is required

**Success response:** `delete_unupscaled_original_response`

Additional response/push types from handler:
- `original`
- `dynGenPreview`
- `gallery_updated`

**Push side effects:**
- `gallery_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `find_image_index`

**Auth:** Session required

**Handler:** modules/ws/handlers/120-galleryHandler.js → `handleFindImageIndexRequest`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Optional |
| `viewType` | Optional |

**Success response:** `find_image_index_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `gallery_position_hint`

**Auth:** Session required

**Handler:** modules/ws/handlers/120-galleryHandler.js → `handleGalleryPositionHint`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `index` | Optional |
| `viewType` | Optional |
| `workspaceId` | Optional |
| `anchorFilename` | Optional |

**Success response:** `gallery_position_hint_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `request_gallery`

**Auth:** Session required

**Handler:** modules/ws/handlers/120-galleryHandler.js → `handleGalleryRequest`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `viewType` | Optional |
| `includePinnedStatus` | Optional |
| `offset` | Optional |
| `workspaceId` | Optional |
| `light` | Optional |
| `limit` | Optional |
| `galleryBlockFetch` | Optional |
| `afterCursor` | Optional |

**Success response:** `request_gallery_response`

Probe (`limit: 0`) and pages also include `lastGalleryUpdatedAt` (gallery index `updated_at`, ms) and, on offset 0 pages, `latestFilename`. On connect the server also pushes `gallery_hint` with the same fields so a reconnecting client can append without a full reload.

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `request_image_by_index`

**Auth:** Session required

**Handler:** modules/ws/handlers/120-galleryHandler.js → `handleImageByIndexRequest`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `index` | Optional |
| `viewType` | Optional |

**Success response:** `request_image_by_index_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `request_image_metadata`

**Auth:** Session required

**Handler:** modules/ws/handlers/120-galleryHandler.js → `handleImageMetadataRequest`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Optional |

**Success response:** `request_image_metadata_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `request_url_upload_metadata`

**Auth:** Session required

**Handler:** modules/ws/handlers/120-galleryHandler.js → `handleUrlUploadMetadataRequest`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Optional |

**Success response:** `request_url_upload_metadata_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `send_to_sequenzia_bulk`

**Auth:** Session required

**Handler:** modules/ws/handlers/120-galleryHandler.js → `handleSendToSequenziaBulk`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filenames` | Required |

**Validation errors:**
- Filenames array is required

**Success response:** `send_to_sequenzia_bulk_response`

Additional response/push types from handler:
- `original`
- `upscaled`
- `gallery_updated`

**Push side effects:**
- `gallery_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `set_gallery_show_shared`

**Auth:** Session required

**Handler:** modules/ws/handlers/120-galleryHandler.js → `handleSetGalleryShowShared`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `enabled` | Optional |

**Success response:** `set_gallery_show_shared_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `update_image_preset_bulk`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/120-galleryHandler.js → `handleUpdateImagePresetBulk`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filenames` | Required |
| `presetName` | Optional |

**Validation errors:**
- Filenames array is required

**Success response:** `update_image_preset_bulk_response`

Additional response/push types from handler:
- `gallery_updated`

**Push side effects:**
- `gallery_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

