# WebSocket: Chat

Server handler: `modules/ws/handlers/50-chatHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `create_chat_session` | `create_chat_session_response` | admin/destructive | Handler: handleCreateChatSession |
| `delete_chat_message` | `delete_chat_message_response` | admin/destructive | Handler: handleDeleteChatMessage |
| `delete_chat_session` | `delete_chat_session_response` | admin/destructive | Handler: handleDeleteChatSession |
| `get_chat_messages` | `get_chat_messages_response` | session | Handler: handleGetChatMessages |
| `get_chat_session` | `get_chat_session_response` | session | Handler: handleGetChatSession |
| `get_chat_sessions` | `get_chat_sessions_response` | session | Handler: handleGetChatSessions |
| `restart_chat_session` | `restart_chat_session_response` | admin/destructive | Handler: handleRestartChatSession |
| `send_chat_message` | `send_chat_message_response` | admin/destructive | Handler: handleSendChatMessage |
| `update_chat_context` | `update_chat_context_response` | admin/destructive | Handler: handleUpdateChatContext |

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

### `create_chat_session`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/50-chatHandler.js → `handleCreateChatSession`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `create_chat_session_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_chat_message`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/50-chatHandler.js → `handleDeleteChatMessage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `delete_chat_message_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_chat_session`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/50-chatHandler.js → `handleDeleteChatSession`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `delete_chat_session_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_chat_messages`

**Auth:** Session required

**Handler:** modules/ws/handlers/50-chatHandler.js → `handleGetChatMessages`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_chat_messages_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_chat_session`

**Auth:** Session required

**Handler:** modules/ws/handlers/50-chatHandler.js → `handleGetChatSession`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_chat_session_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_chat_sessions`

**Auth:** Session required

**Handler:** modules/ws/handlers/50-chatHandler.js → `handleGetChatSessions`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_chat_sessions_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `restart_chat_session`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/50-chatHandler.js → `handleRestartChatSession`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `restart_chat_session_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `send_chat_message`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/50-chatHandler.js → `handleSendChatMessage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `send_chat_message_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `update_chat_context`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/50-chatHandler.js → `handleUpdateChatContext`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `update_chat_context_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

