# WebSocket: User Global Settings

Server handler: `modules/ws/handlers/200-userSettingsHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `get_user_global_settings` | `get_user_global_settings_response` | session | Handler: handleGetUserGlobalSettings |
| `update_user_global_settings` | `update_user_global_settings_response` | admin/destructive | Handler: handleUpdateUserGlobalSettings |

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

### `get_user_global_settings`

**Auth:** Session required

**Handler:** modules/ws/handlers/200-userSettingsHandler.js → `handleGetUserGlobalSettings`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_user_global_settings_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `update_user_global_settings`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/200-userSettingsHandler.js → `handleUpdateUserGlobalSettings`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `settings` | Optional |

**Success response:** `update_user_global_settings_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

