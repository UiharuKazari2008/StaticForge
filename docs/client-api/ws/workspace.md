# WebSocket: Workspaces

Server handler: `modules/ws/handlers/90-workspaceHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `workspace_activate` | `workspace_activate_response` | session | Handler: handleWorkspaceActivate |
| `workspace_add_images_to_group` | `workspace_add_images_to_group_response` | admin/destructive | Handler: handleWorkspaceAddImagesToGroup |
| `workspace_add_pinned` | `workspace_add_pinned_response` | admin/destructive | Handler: handleWorkspaceAddPinned |
| `workspace_add_scrap` | `workspace_add_scrap_response` | admin/destructive | Handler: handleWorkspaceAddScrap |
| `workspace_bulk_add_pinned` | `workspace_bulk_add_pinned_response` | admin/destructive | Handler: handleWorkspaceBulkAddPinned |
| `workspace_bulk_add_scrap` | `workspace_bulk_add_scrap_response` | admin/destructive | Handler: handleWorkspaceBulkAddScrap |
| `workspace_bulk_pinned` | `workspace_bulk_pinned_response` | admin/destructive | Handler: handleWorkspaceBulkPinned |
| `workspace_bulk_remove_pinned` | `workspace_bulk_remove_pinned_response` | admin/destructive | Handler: handleWorkspaceBulkRemovePinned |
| `workspace_create` | `workspace_create_response` | admin/destructive | Handler: handleWorkspaceCreate |
| `workspace_create_group` | `workspace_create_group_response` | admin/destructive | Handler: handleWorkspaceCreateGroup |
| `workspace_delete` | `workspace_delete_response` | admin/destructive | Handler: handleWorkspaceDelete |
| `workspace_delete_group` | `workspace_delete_group_response` | admin/destructive | Handler: handleWorkspaceDeleteGroup |
| `workspace_dump` | `workspace_dump_response` | session | Handler: handleWorkspaceDump |
| `workspace_get` | `workspace_get_response` | session | Handler: handleWorkspaceGet |
| `workspace_get_files` | `workspace_get_files_response` | session | Handler: handleWorkspaceGetFiles |
| `workspace_get_group` | `workspace_get_group_response` | session | Handler: handleWorkspaceGetGroup |
| `workspace_get_groups` | `workspace_get_groups_response` | session | Handler: handleWorkspaceGetGroups |
| `workspace_get_image_groups` | `workspace_get_image_groups_response` | session | Handler: handleWorkspaceGetImageGroups |
| `workspace_get_pinned` | `workspace_get_pinned_response` | session | Handler: handleWorkspaceGetPinned |
| `workspace_get_scraps` | `workspace_get_scraps_response` | session | Handler: handleWorkspaceGetScraps |
| `workspace_list` | `workspace_list_response` | session | Handler: handleWorkspaceList |
| `workspace_move_files` | `workspace_move_files_response` | admin/destructive | Handler: handleWorkspaceMoveFiles |
| `workspace_remove_images_from_group` | `workspace_remove_images_from_group_response` | admin/destructive | Handler: handleWorkspaceRemoveImagesFromGroup |
| `workspace_remove_pinned` | `workspace_remove_pinned_response` | admin/destructive | Handler: handleWorkspaceRemovePinned |
| `workspace_remove_scrap` | `workspace_remove_scrap_response` | admin/destructive | Handler: handleWorkspaceRemoveScrap |
| `workspace_rename` | `workspace_rename_response` | admin/destructive | Handler: handleWorkspaceRename |
| `workspace_rename_group` | `workspace_rename_group_response` | admin/destructive | Handler: handleWorkspaceRenameGroup |
| `workspace_reorder` | `workspace_reorder_response` | admin/destructive | Handler: handleWorkspaceReorder |
| `workspace_update_background_color` | `workspace_update_background_color_response` | admin/destructive | Handler: handleWorkspaceUpdateBackgroundColor |
| `workspace_update_color` | `workspace_update_color_response` | admin/destructive | Handler: handleWorkspaceUpdateColor |
| `workspace_update_primary_font` | `workspace_update_primary_font_response` | admin/destructive | Handler: handleWorkspaceUpdatePrimaryFont |
| `workspace_update_settings` | `workspace_update_settings_response` | admin/destructive | Handler: handleWorkspaceUpdateSettings |
| `workspace_update_textarea_font` | `workspace_update_textarea_font_response` | admin/destructive | Handler: handleWorkspaceUpdateTextareaFont |
| `workspace_update_window_positions` | `workspace_update_window_positions_response` | session | Handler: handleWorkspaceUpdateWindowPositions |

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

## Bulk pin: `workspace_bulk_pinned` vs `workspace_bulk_add_pinned`

Both add filenames to a workspace's pinned list and broadcast `workspace_updated`. Prefer **`workspace_bulk_add_pinned`** for new clients.

| | `workspace_bulk_add_pinned` | `workspace_bulk_pinned` |
|---|---|---|
| **Requires `id` (workspace)** | Yes — errors if missing | No — uses implicit/default workspace context |
| **Per-file error handling** | Yes — counts `addedCount` per successful add | No — increments all entries in loop |
| **Response `data`** | `{ success, addedCount }` | `{ success, message, addedCount }` |
| **Push `action`** | `bulk_add_pinned` | `bulk_pinned_added` |
| **Client usage** | `WebSocketClient.sendMessage('workspace_bulk_add_pinned', { id, filenames })` | Legacy label in UI maps only; same client helper uses `workspace_bulk_add_pinned` |

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

### `workspace_activate`

**Auth:** Session required

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceActivate`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |

**Success response:** `workspace_activate_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_add_images_to_group`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceAddImagesToGroup`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `groupId` | Optional |
| `filenames` | Required |

**Validation errors:**
- Filenames array is required

**Success response:** `workspace_add_images_to_group_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_add_pinned`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceAddPinned`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Required |
| `filename` | Required |

**Validation errors:**
- Workspace ID is required
- Filename is required

**Success response:** `workspace_add_pinned_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_add_scrap`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceAddScrap`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Required |
| `filename` | Required |

**Validation errors:**
- Workspace ID is required
- Filename is required

**Success response:** `workspace_add_scrap_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_bulk_add_pinned`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceBulkAddPinned`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Required |
| `filenames` | Required |

**Validation errors:**
- Workspace ID is required
- Filenames array is required

**Success response:** `workspace_bulk_add_pinned_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_bulk_add_scrap`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceBulkAddScrap`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Required |
| `filenames` | Required |

**Validation errors:**
- Workspace ID is required
- Filenames array is required

**Success response:** `workspace_bulk_add_scrap_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_bulk_pinned`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceBulkPinned`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `filenames` | Required |

**Validation errors:**
- Filenames array is required

**Success response:** `workspace_bulk_pinned_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_bulk_remove_pinned`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceBulkRemovePinned`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Required |
| `filenames` | Required |

**Validation errors:**
- Workspace ID is required
- Filenames array is required

**Success response:** `workspace_bulk_remove_pinned_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_create`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceCreate`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `name` | Required |
| `color` | Optional |

**Validation errors:**
- Workspace name is required

**Success response:** `workspace_create_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_create_group`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceCreateGroup`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `name` | Required |

**Validation errors:**
- Group name is required

**Success response:** `workspace_create_group_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_delete`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceDelete`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |

**Success response:** `workspace_delete_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_delete_group`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceDeleteGroup`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `groupId` | Optional |

**Success response:** `workspace_delete_group_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_dump`

**Auth:** Session required

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceDump`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `sourceId` | Optional |
| `targetId` | Optional |

**Validation errors:**
- Target workspace ID is required

**Success response:** `workspace_dump_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_get`

**Auth:** Session required

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceGet`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `workspace_get_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_get_files`

**Auth:** Session required

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceGetFiles`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |

**Success response:** `workspace_get_files_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_get_group`

**Auth:** Session required

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceGetGroup`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `groupId` | Optional |

**Success response:** `workspace_get_group_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_get_groups`

**Auth:** Session required

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceGetGroups`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |

**Success response:** `workspace_get_groups_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_get_image_groups`

**Auth:** Session required

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceGetImageGroups`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `filename` | Optional |

**Success response:** `workspace_get_image_groups_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_get_pinned`

**Auth:** Session required

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceGetPinned`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |

**Success response:** `workspace_get_pinned_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_get_scraps`

**Auth:** Session required

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceGetScraps`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |

**Success response:** `workspace_get_scraps_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_list`

**Auth:** Session required

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceList`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `workspace_list_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_move_files`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceMoveFiles`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Required |
| `filenames` | Required |
| `sourceWorkspaceId` | Optional |
| `moveType` | Optional |

**Validation errors:**
- Workspace ID is required
- Filenames array is required

**Success response:** `workspace_move_files_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_remove_images_from_group`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceRemoveImagesFromGroup`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `groupId` | Optional |
| `filenames` | Required |

**Validation errors:**
- Filenames array is required

**Success response:** `workspace_remove_images_from_group_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_remove_pinned`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceRemovePinned`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Required |
| `filename` | Required |

**Validation errors:**
- Workspace ID is required
- Filename is required

**Success response:** `workspace_remove_pinned_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_remove_scrap`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceRemoveScrap`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Required |
| `filename` | Required |

**Validation errors:**
- Workspace ID is required
- Filename is required

**Success response:** `workspace_remove_scrap_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_rename`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceRename`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `name` | Required |

**Validation errors:**
- New name is required

**Success response:** `workspace_rename_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_rename_group`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceRenameGroup`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `groupId` | Optional |
| `name` | Required |

**Validation errors:**
- New group name is required

**Success response:** `workspace_rename_group_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_reorder`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceReorder`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `workspaceIds` | Optional |

**Validation errors:**
- Workspace IDs array is required for reordering

**Success response:** `workspace_reorder_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_update_background_color`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceUpdateBackgroundColor`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `backgroundColor` | Optional |

**Success response:** `workspace_update_background_color_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_update_color`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceUpdateColor`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `color` | Required |

**Validation errors:**
- Color is required

**Success response:** `workspace_update_color_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_update_primary_font`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceUpdatePrimaryFont`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `primaryFont` | Optional |

**Success response:** `workspace_update_primary_font_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_update_settings`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceUpdateSettings`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Required |
| `settings` | Required |

**Validation errors:**
- Workspace ID and settings object are required

**Success response:** `workspace_update_settings_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_update_textarea_font`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceUpdateTextareaFont`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `textareaFont` | Optional |

**Success response:** `workspace_update_textarea_font_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `workspace_update_window_positions`

**Auth:** Session required

**Handler:** modules/ws/handlers/90-workspaceHandler.js → `handleWorkspaceUpdateWindowPositions`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `id` | Optional |
| `windowPositions` | Optional |

**Success response:** `workspace_update_window_positions_response`

Additional response/push types from handler:
- `workspace_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

