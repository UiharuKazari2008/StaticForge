# WebSocket: Notes / Notepad

Server handler: `modules/ws/handlers/30-notesHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `notes_create` | `notes_create_response` | admin/destructive | Handler: handleNotesCreate |
| `notes_delete` | `notes_delete_response` | admin/destructive | Handler: handleNotesDelete |
| `notes_get` | `notes_get_response` | session | Handler: handleNotesGet |
| `notes_get_all` | `notes_get_all_response` | session | Handler: handleNotesGetAll |
| `notes_get_all_metadata` | `notes_get_all_metadata_response` | session | Handler: handleNotesGetAllMetadata |
| `notes_get_by_workspace` | `notes_get_by_workspace_response` | session | Handler: handleNotesGetByWorkspace |
| `notes_save_content` | `notes_save_content_response` | admin/destructive | Handler: handleNotesSaveContent |
| `notes_update` | `notes_update_response` | admin/destructive | Handler: handleNotesUpdate |
| `novel_generate` | `novel_generate_response` | admin/destructive | Handler: handleNovelGenerate |
| `novel_get` | `novel_get_response` | session | Handler: handleNovelGet |
| `novel_list` | `novel_list_response` | session | Handler: handleNovelList |
| `novel_resolve_image` | `novel_resolve_image_response` | session | Handler: handleNovelResolveImage |
| `novel_undo` | `novel_undo_response` | admin/destructive | Handler: handleNovelUndo |
| `novel_update` | `novel_update_response` | admin/destructive | Handler: handleNovelUpdate |

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

### `notes_create`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/30-notesHandler.js → `handleNotesCreate`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `directive` | Optional |
| `generatedImageName` | Optional |

**Validation errors:**
- Note ID and workspace ID are required
- Note name is required

**Success response:** `notes_create_response`

Additional response/push types from handler:
- `note_created`

**Push side effects:**
- `note_created`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `notes_delete`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/30-notesHandler.js → `handleNotesDelete`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `noteId` | Optional |

**Validation errors:**
- Note ID is required

**Success response:** `notes_delete_response`

Additional response/push types from handler:
- `note_deleted`

**Push side effects:**
- `note_deleted`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `notes_get`

**Auth:** Session required

**Handler:** modules/ws/handlers/30-notesHandler.js → `handleNotesGet`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `noteId` | Optional |

**Validation errors:**
- Note ID is required

**Success response:** `notes_get_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `notes_get_all`

**Auth:** Session required

**Handler:** modules/ws/handlers/30-notesHandler.js → `handleNotesGetAll`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `notes_get_all_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `notes_get_all_metadata`

**Auth:** Session required

**Handler:** modules/ws/handlers/30-notesHandler.js → `handleNotesGetAllMetadata`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `notes_get_all_metadata_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `notes_get_by_workspace`

**Auth:** Session required

**Handler:** modules/ws/handlers/30-notesHandler.js → `handleNotesGetByWorkspace`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `workspaceId` | Optional |

**Validation errors:**
- Workspace ID is required

**Success response:** `notes_get_by_workspace_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `notes_save_content`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/30-notesHandler.js → `handleNotesSaveContent`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `noteId` | Optional |
| `content` | Required |

**Validation errors:**
- Note ID and content are required

**Success response:** `notes_save_content_response`

Additional response/push types from handler:
- `note_content_updated`

**Push side effects:**
- `note_content_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `notes_update`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/30-notesHandler.js → `handleNotesUpdate`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `noteId` | Optional |
| `updates` | Required |

**Validation errors:**
- Note ID and updates are required

**Success response:** `notes_update_response`

Additional response/push types from handler:
- `note_updated`

**Push side effects:**
- `note_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `novel_generate`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/websocketHandlers.js → `handleNovelGenerate`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `noteId` | Optional |

**Validation errors:**
- Note ID is required

**Success response:** `novel_generate_response`

Additional response/push types from handler:
- `novel_generate_complete`
- `novel_updated`

**Push side effects:**
- `novel_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `novel_get`

**Auth:** Session required

**Handler:** modules/websocketHandlers.js → `handleNovelGet`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `noteId` | Optional |

**Validation errors:**
- Note ID is required

**Success response:** `novel_get_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `novel_list`

**Auth:** Session required

**Handler:** modules/websocketHandlers.js → `handleNovelList`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `workspaceId` | Optional |

**Success response:** `novel_list_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `novel_resolve_image`

**Auth:** Session required

**Handler:** modules/websocketHandlers.js → `handleNovelResolveImage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `noteId` | Optional |
| `filename` | Optional |

**Validation errors:**
- Note ID is required

**Success response:** `novel_resolve_image_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `novel_undo`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/websocketHandlers.js → `handleNovelUndo`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `noteId` | Optional |

**Validation errors:**
- Note ID is required

**Success response:** `novel_undo_response`

Additional response/push types from handler:
- `novel_updated`

**Push side effects:**
- `novel_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `novel_update`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/websocketHandlers.js → `handleNovelUpdate`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `noteId` | Optional |
| `updates` | Required |

**Validation errors:**
- Note ID and updates are required

**Success response:** `novel_update_response`

Additional response/push types from handler:
- `note_updated`

**Push side effects:**
- `note_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

