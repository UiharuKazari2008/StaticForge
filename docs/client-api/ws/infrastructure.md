# WebSocket: Infrastructure

Server handler: `modules/ws/handlers/170-infrastructureHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `check_updates` | `check_updates_response` | critical | Handler: handleCheckUpdates |
| `get_system_info` | `get_system_info_response` | session | Handler: handleGetSystemInfo |
| `ping` | `ping_response` | critical | Handler: handlePing |
| `server_status` | `server_status_response` | critical | Handler: handleServerStatus |
| `version_check` | `version_check_response` | critical | Handler: handleVersionCheck |

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

## Ping server push fields

The periodic server-initiated `ping.data` includes `balance`, `opusUsage`, `accountHealth`, `queue_status`, `image_count`, and `server_time`. `opusUsage` is either `null` or `{ percent, isNegative, timeUntilNextPercent }`.

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

## Detailed packets

### `check_updates`

**Auth:** Critical (no session required)

**Handler:** modules/ws/handlers/170-infrastructureHandler.js → `handleCheckUpdates`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `check_updates_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_system_info`

**Auth:** Session required

**Handler:** modules/ws/handlers/170-infrastructureHandler.js → `handleGetSystemInfo`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_system_info_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `ping`

**Auth:** Critical (no session required)

**Handler:** modules/ws/handlers/170-infrastructureHandler.js → `handlePing`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `clientRttMs` | Optional |

**Success response:** `ping_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `server_status`

**Auth:** Critical (no session required)

**Handler:** modules/ws/handlers/170-infrastructureHandler.js → `handleServerStatus`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `server_status_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `version_check`

**Auth:** Critical (no session required)

**Handler:** modules/ws/handlers/170-infrastructureHandler.js → `handleVersionCheck`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `version_check_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

