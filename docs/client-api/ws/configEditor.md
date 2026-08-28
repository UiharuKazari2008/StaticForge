# WebSocket: Runes (config editor)

Server handler: `modules/ws/handlers/20-configEditorHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Maps in `config-maps/` overlay live JSON with sparse type/label rules. **Generation quips text content** is stored in SQLite (`generationQuipsDatabase`), not in `config.json` — only `config.generationQuips` scheduler/session settings are editable here.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `config_editor_checkpoints_create` | `config_editor_checkpoints_create_response` | admin/destructive | Handler: handleConfigEditorCheckpointsCreate |
| `config_editor_checkpoints_delete` | `config_editor_checkpoints_delete_response` | admin/destructive | Handler: handleConfigEditorCheckpointsDelete |
| `config_editor_checkpoints_get` | `config_editor_checkpoints_get_response` | session | Handler: handleConfigEditorCheckpointsGet |
| `config_editor_checkpoints_list` | `config_editor_checkpoints_list_response` | session | Handler: handleConfigEditorCheckpointsList |
| `config_editor_checkpoints_restore` | `config_editor_checkpoints_restore_response` | admin/destructive | Handler: handleConfigEditorCheckpointsRestore |
| `config_editor_get_node` | `config_editor_get_node_response` | session | Handler: handleConfigEditorGetNode |
| `config_editor_list` | `config_editor_list_response` | session | Handler: handleConfigEditorList |
| `config_editor_reveal_secret` | `config_editor_reveal_secret_response` | session | Handler: handleConfigEditorRevealSecret |
| `config_editor_save` | `config_editor_save_response` | admin/destructive | Handler: handleConfigEditorSave |
| `config_editor_search` | `config_editor_search_response` | session | Handler: handleConfigEditorSearch |

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

## Detailed packets

### `config_editor_checkpoints_create`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorCheckpointsCreate`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `label` | Optional |

**Success response:** `config_editor_checkpoints_create_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `config_editor_checkpoints_delete`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorCheckpointsDelete`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `checkpointId` | Optional |

**Success response:** `config_editor_checkpoints_delete_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `config_editor_checkpoints_get`

**Auth:** Session required

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorCheckpointsGet`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `checkpointId` | Optional |

**Success response:** `config_editor_checkpoints_get_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `config_editor_checkpoints_list`

**Auth:** Session required

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorCheckpointsList`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `configId` | Optional |

**Success response:** `config_editor_checkpoints_list_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `config_editor_checkpoints_restore`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorCheckpointsRestore`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `checkpointId` | Optional |
| `createSafetyCheckpoint` | Optional |

**Success response:** `config_editor_checkpoints_restore_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `config_editor_get_node`

**Auth:** Session required

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorGetNode`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `configId` | Optional |
| `path` | Optional |

**Success response:** `config_editor_get_node_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `config_editor_list`

**Auth:** Session required

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorList`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `config_editor_list_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `config_editor_reveal_secret`

**Auth:** Session required

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorRevealSecret`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `configId` | Optional |
| `path` | Optional |

**Success response:** `config_editor_reveal_secret_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `config_editor_save`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorSave`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `patches` | Optional |
| `createCheckpoint` | Optional |
| `partialScope` | Optional |

**Success response:** `config_editor_save_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `config_editor_search`

**Auth:** Session required

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorSearch`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `configId` | Optional |
| `query` | Optional |
| `maxResults` | Optional |

**Success response:** `config_editor_search_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

