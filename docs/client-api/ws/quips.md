# WebSocket: Generation Quips

Server handler: `modules/ws/handlers/160-quipsHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `generation_quips_clear` | `generation_quips_clear_response` | admin/destructive | Handler: quips |
| `generation_quips_run` | `generation_quips_run_response` | admin/destructive | Handler: quips |
| `get_app_options` | `get_app_options_response` | session | Handler: app |
| `get_generation_quips` | `get_generation_quips_response` | session | Handler: quips |
| `get_generation_quips_status` | `get_generation_quips_status_response` | session | Handler: quips |
| `get_generation_quips_wiki` | `get_generation_quips_wiki_response` | session | Handler: quips |

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

## Detailed packets

### `generation_quips_clear`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/160-quipsHandler.js → `quips`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `generation_quips_clear_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `generation_quips_run`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/160-quipsHandler.js → `quips`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `generation_quips_run_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_app_options`

**Auth:** Session required

**Handler:** modules/ws/handlers/160-quipsHandler.js → `app`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_app_options_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_generation_quips`

**Auth:** Session required

**Handler:** modules/ws/handlers/160-quipsHandler.js → `quips`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_generation_quips_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_generation_quips_status`

**Auth:** Session required

**Handler:** modules/ws/handlers/160-quipsHandler.js → `quips`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_generation_quips_status_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_generation_quips_wiki`

**Auth:** Session required

**Handler:** modules/ws/handlers/160-quipsHandler.js → `quips`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_generation_quips_wiki_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

