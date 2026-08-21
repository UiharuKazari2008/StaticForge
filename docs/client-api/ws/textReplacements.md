# WebSocket: Text Replacements

Server handler: `modules/ws/handlers/140-textReplacementsHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `create_text_replacement` | `create_text_replacement_response` | admin/destructive | Handler: handleCreateTextReplacement |
| `delete_text_replacement` | `delete_text_replacement_response` | admin/destructive | Handler: handleDeleteTextReplacement |
| `get_text_replacement_options` | `get_text_replacement_options_response` | admin/destructive | Handler: handleGetTextReplacementOptions |
| `get_text_replacements` | `get_text_replacements_response` | session | Handler: handleGetTextReplacements |
| `save_text_replacements` | `save_text_replacements_response` | admin/destructive | Handler: handleSaveTextReplacements |
| `scan_text_replacements` | `scan_text_replacements_response` | admin/destructive | Handler: handleScanTextReplacements |

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

### `create_text_replacement`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/140-textReplacementsHandler.js → `handleCreateTextReplacement`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `key` | Optional |
| `value` | Optional |

**Success response:** `create_text_replacement_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_text_replacement`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/140-textReplacementsHandler.js → `handleDeleteTextReplacement`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `key` | Optional |

**Success response:** `delete_text_replacement_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_text_replacement_options`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/140-textReplacementsHandler.js → `handleGetTextReplacementOptions`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `pattern` | Optional |
| `presetName` | Optional |
| `model` | Optional |
| `periodKey` | Optional |

**Success response:** `get_text_replacement_options_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_text_replacements`

**Auth:** Session required

**Handler:** modules/ws/handlers/140-textReplacementsHandler.js → `handleGetTextReplacements`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `page` | Optional |
| `itemsPerPage` | Optional |
| `searchTerm` | Optional |

**Success response:** `get_text_replacements_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `save_text_replacements`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/140-textReplacementsHandler.js → `handleSaveTextReplacements`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `textReplacements` | Optional |

**Success response:** `save_text_replacements_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `scan_text_replacements`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/140-textReplacementsHandler.js → `handleScanTextReplacements`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `scan_text_replacements_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

