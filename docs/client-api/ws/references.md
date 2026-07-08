# WebSocket: References, Uploads & Vibes

Server handler: `modules/referencesWebSocketHandlers.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `bulk_delete_vibe_images` | `bulk_delete_vibe_images_response` | admin/destructive | Handler: handleBulkDeleteVibeImages |
| `bulk_move_vibe_images` | `bulk_move_vibe_images_response` | admin/destructive | Handler: handleBulkMoveVibeImages |
| `check_vibe_encoding` | `check_vibe_encoding_response` | session | Handler: handleCheckVibeEncoding |
| `delete_reference` | `delete_reference_response` | admin/destructive | Handler: handleDeleteReference |
| `delete_vibe_encodings` | `delete_vibe_encodings_response` | admin/destructive | Handler: handleDeleteVibeEncodings |
| `delete_vibe_image` | `delete_vibe_image_response` | admin/destructive | Handler: handleDeleteVibeImage |
| `download_url_file` | `download_url_file_response` | admin/destructive | Handler: handleDownloadUrlFile |
| `encode_vibe` | `encode_vibe_response` | admin/destructive | Handler: handleEncodeVibe |
| `fetch_url_info` | `fetch_url_info_response` | admin/destructive | Handler: handleFetchUrl |
| `get_references` | `get_references_response` | session | Handler: handleGetReferences |
| `get_references_by_ids` | `get_references_by_ids_response` | session | Handler: handleGetReferencesByIds |
| `get_vibe_image` | `get_vibe_image_response` | session | Handler: handleGetVibeImage |
| `get_workspace_references` | `get_workspace_references_response` | session | Handler: handleGetWorkspaceReferences |
| `import_vibe_bundle` | `import_vibe_bundle_response` | admin/destructive | Handler: handleImportVibeBundle |
| `import_vibe_from_url` | `import_vibe_from_url_response` | admin/destructive | Handler: handleImportVibeFromUrl |
| `move_references` | `move_references_response` | admin/destructive | Handler: handleMoveReferences |
| `move_vibe_image` | `move_vibe_image_response` | admin/destructive | Handler: handleMoveVibeImage |
| `replace_reference` | `replace_reference_response` | admin/destructive | Handler: handleReplaceReference |
| `update_reference_metadata` | `update_reference_metadata_response` | admin/destructive | Handler: handleUpdateReferenceMetadata |
| `upload_reference` | `upload_reference_response` | admin/destructive | Handler: handleUploadReference |
| `upload_wallpaper` | `upload_wallpaper_response` | admin/destructive | Handler: handleUploadWallpaper |
| `upload_workspace_image` | `upload_workspace_image_response` | admin/destructive | Handler: handleUploadWorkspaceImage |

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

## Detailed packets

### `bulk_delete_vibe_images`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleBulkDeleteVibeImages`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `vibesToDelete` | Optional |
| `encodingsToDelete` | Optional |
| `workspaceId` | Optional |

**Success response:** `bulk_delete_vibe_images_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `bulk_move_vibe_images`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleBulkMoveVibeImages`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `imageIds` | Optional |
| `targetWorkspaceId` | Optional |
| `sourceWorkspaceId` | Optional |

**Success response:** `bulk_move_vibe_images_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `check_vibe_encoding`

**Auth:** Session required

**Handler:** modules/referencesWebSocketHandlers.js → `handleCheckVibeEncoding`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `vibeId` | Optional |
| `workspaceId` | Optional |

**Success response:** `check_vibe_encoding_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_reference`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleDeleteReference`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `hash` | Optional |
| `workspaceId` | Optional |

**Success response:** `delete_reference_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_vibe_encodings`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleDeleteVibeEncodings`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `vibeId` | Optional |
| `encodings` | Optional |
| `workspaceId` | Optional |

**Success response:** `delete_vibe_encodings_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_vibe_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleDeleteVibeImage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `vibeId` | Optional |
| `workspaceId` | Optional |

**Success response:** `delete_vibe_image_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `download_url_file`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleDownloadUrlFile`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `url` | Optional |
| `previewUrl` | Optional |

**Success response:** `download_url_file_response`

Additional response/push types from handler:
- `image`
- `json`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `encode_vibe`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleEncodeVibe`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `image` | Optional |
| `informationExtraction` | Optional |
| `model` | Optional |
| `workspace` | Optional |
| `cacheFile` | Optional |
| `tempFile` | Optional |
| `id` | Optional |
| `comment` | Optional |

**Success response:** `encode_vibe_response`

Additional response/push types from handler:
- `base64`
- `cache`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `fetch_url_info`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleFetchUrl`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `fetch_url_info_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_references`

**Auth:** Session required

**Handler:** modules/referencesWebSocketHandlers.js → `handleGetReferences`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_references_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_references_by_ids`

**Auth:** Session required

**Handler:** modules/referencesWebSocketHandlers.js → `handleGetReferencesByIds`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `references` | Optional |

**Success response:** `get_references_by_ids_response`

Additional response/push types from handler:
- `vibe`
- `cache`
- `file`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_vibe_image`

**Auth:** Session required

**Handler:** modules/referencesWebSocketHandlers.js → `handleGetVibeImage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Optional |

**Success response:** `get_vibe_image_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_workspace_references`

**Auth:** Session required

**Handler:** modules/referencesWebSocketHandlers.js → `handleGetWorkspaceReferences`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `workspaceId` | Optional |

**Success response:** `get_workspace_references_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `import_vibe_bundle`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleImportVibeBundle`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `bundleData` | Optional |
| `workspaceId` | Optional |
| `comment` | Optional |
| `tempFile` | Optional |
| `previewUrl` | Optional |
| `forcePreviewOverride` | Optional |
| `naxBrowserMeta` | Optional |

**Success response:** `import_vibe_bundle_response`

Additional response/push types from handler:
- `base64`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `import_vibe_from_url`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleImportVibeFromUrl`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `downloadUrl` | Optional |
| `previewUrl` | Optional |
| `workspaceId` | Optional |
| `comment` | Optional |
| `naxBrowserMeta` | Optional |

**Success response:** `import_vibe_from_url_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `move_references`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleMoveReferences`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `hashes` | Optional |
| `targetWorkspaceId` | Optional |
| `sourceWorkspaceId` | Optional |

**Success response:** `move_references_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `move_vibe_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleMoveVibeImage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `vibeId` | Optional |
| `targetWorkspaceId` | Optional |
| `sourceWorkspaceId` | Optional |

**Success response:** `move_vibe_image_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `replace_reference`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleReplaceReference`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `hash` | Optional |
| `imageData` | Optional |
| `workspaceId` | Optional |
| `tempFile` | Optional |
| `filename` | Optional |

**Success response:** `replace_reference_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `update_reference_metadata`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleUpdateReferenceMetadata`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `hash` | Required |
| `metadata` | Required |

**Validation errors:**
- Hash is required
- Metadata is required

**Success response:** `update_reference_metadata_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `upload_reference`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleUploadReference`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `imageData` | Optional |
| `workspaceId` | Optional |
| `tempFile` | Optional |
| `tags` | Optional |

**Success response:** `upload_reference_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `upload_wallpaper`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleUploadWallpaper`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `imageData` | Optional |
| `workspaceId` | Optional |

**Success response:** `upload_wallpaper_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `upload_workspace_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/referencesWebSocketHandlers.js → `handleUploadWorkspaceImage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `imageData` | Optional |
| `workspaceId` | Optional |
| `originalFilename` | Optional |
| `batchInfo` | Optional |
| `tempFile` | Optional |

**Success response:** `upload_workspace_image_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

