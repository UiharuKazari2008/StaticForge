# WebSocket: VFS & Desktop

Server handler: `modules/vfsWebSocketHandlers.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `desktop_add_shortcut` | `desktop_add_shortcut_response` | admin/destructive | Handler: (inline) |
| `desktop_create_empty_folder` | `desktop_create_empty_folder_response` | admin/destructive | Handler: (inline) |
| `desktop_create_folder_from_selection` | `desktop_create_folder_from_selection_response` | admin/destructive | Handler: (inline) |
| `desktop_get_settings` | `desktop_get_settings_response` | session | Handler: (inline) |
| `desktop_get_shortcuts` | `desktop_get_shortcuts_response` | session | Handler: (inline) |
| `desktop_remove_shortcut` | `desktop_remove_shortcut_response` | admin/destructive | Handler: (inline) |
| `desktop_update_positions` | `desktop_update_positions_response` | admin/destructive | Handler: (inline) |
| `desktop_update_shortcut` | `desktop_update_shortcut_response` | admin/destructive | Handler: (inline) |
| `desktop_update_shortcut_folders` | `desktop_update_shortcut_folders_response` | admin/destructive | Handler: (inline) |
| `vfs_convert_file_to_reference` | `vfs_convert_file_to_reference_response` | admin/destructive | Handler: (inline) |
| `vfs_convert_reference_to_file` | `vfs_convert_reference_to_file_response` | admin/destructive | Handler: (inline) |
| `vfs_copy_items` | `vfs_copy_items_response` | admin/destructive | Handler: (inline) |
| `vfs_create_folder` | `vfs_create_folder_response` | admin/destructive | Handler: (inline) |
| `vfs_delete_entry` | `vfs_delete_entry_response` | admin/destructive | Handler: (inline) |
| `vfs_delete_file` | `vfs_delete_file_response` | admin/destructive | Handler: (inline) |
| `vfs_delete_folder` | `vfs_delete_folder_response` | admin/destructive | Handler: (inline) |
| `vfs_download_file` | `vfs_download_file_response` | session | Handler: (inline) |
| `vfs_download_system_file` | `vfs_download_system_file_response` | session | Handler: (inline) |
| `vfs_empty_trash` | `vfs_empty_trash_response` | admin/destructive | Handler: (inline) |
| `vfs_folder_has_user_files` | `vfs_folder_has_user_files_response` | session | Handler: (inline) |
| `vfs_get_path_stats` | `vfs_get_path_stats_response` | session | Handler: (inline) |
| `vfs_list_directory` | `vfs_list_directory_response` | session | Handler: (inline) |
| `vfs_move_items` | `vfs_move_items_response` | admin/destructive | Handler: (inline) |
| `vfs_move_to_trash` | `vfs_move_to_trash_response` | admin/destructive | Handler: (inline) |
| `vfs_permanently_delete` | `vfs_permanently_delete_response` | admin/destructive | Handler: (inline) |
| `vfs_read_system_file` | `vfs_read_system_file_response` | session | Handler: (inline) |
| `vfs_rename_entry` | `vfs_rename_entry_response` | admin/destructive | Handler: (inline) |
| `vfs_rename_file` | `vfs_rename_file_response` | admin/destructive | Handler: (inline) |
| `vfs_rename_folder` | `vfs_rename_folder_response` | admin/destructive | Handler: (inline) |
| `vfs_rename_shortcut_entry` | `vfs_rename_shortcut_entry_response` | admin/destructive | Handler: (inline) |
| `vfs_replace_file` | `vfs_replace_file_response` | admin/destructive | Handler: (inline) |
| `vfs_resolve_path` | `vfs_resolve_path_response` | session | Handler: (inline) |
| `vfs_restore_from_trash` | `vfs_restore_from_trash_response` | admin/destructive | Handler: (inline) |
| `vfs_upload_file` | `vfs_upload_file_response` | admin/destructive | Handler: (inline) |

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

---

## Detailed packets

### `desktop_add_shortcut`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `desktop_add_shortcut_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `desktop_create_empty_folder`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `desktop_create_empty_folder_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `desktop_create_folder_from_selection`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `desktop_create_folder_from_selection_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `desktop_get_settings`

**Auth:** Session required

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `desktop_get_settings_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `desktop_get_shortcuts`

**Auth:** Session required

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `desktop_get_shortcuts_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `desktop_remove_shortcut`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `desktop_remove_shortcut_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `desktop_update_positions`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `desktop_update_positions_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `desktop_update_shortcut`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `desktop_update_shortcut_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `desktop_update_shortcut_folders`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `desktop_update_shortcut_folders_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_convert_file_to_reference`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_convert_file_to_reference_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_convert_reference_to_file`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_convert_reference_to_file_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_copy_items`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_copy_items_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_create_folder`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_create_folder_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_delete_entry`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_delete_entry_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_delete_file`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_delete_file_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_delete_folder`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_delete_folder_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_download_file`

**Auth:** Session required

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_download_file_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_download_system_file`

**Auth:** Session required

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_download_system_file_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_empty_trash`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_empty_trash_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_folder_has_user_files`

**Auth:** Session required

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_folder_has_user_files_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_get_path_stats`

**Auth:** Session required

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_get_path_stats_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_list_directory`

**Auth:** Session required

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_list_directory_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_move_items`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_move_items_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_move_to_trash`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_move_to_trash_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_permanently_delete`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_permanently_delete_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_read_system_file`

**Auth:** Session required

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_read_system_file_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_rename_entry`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_rename_entry_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_rename_file`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_rename_file_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_rename_folder`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_rename_folder_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_rename_shortcut_entry`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_rename_shortcut_entry_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_replace_file`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_replace_file_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_resolve_path`

**Auth:** Session required

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_resolve_path_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_restore_from_trash`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_restore_from_trash_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `vfs_upload_file`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/vfsWebSocketHandlers.js

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `vfs_upload_file_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

