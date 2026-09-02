# WebSocket: Director (AI learning)

Server handler: `modules/ws/handlers/40-directorHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `director_create_session` | `director_create_session_response` | admin/destructive | Handler: handleDirectorCreateSession |
| `director_delete_feedback` | `director_delete_feedback_response` | admin/destructive | Handler: handleDirectorDeleteFeedback |
| `director_delete_session` | `director_delete_session_response` | admin/destructive | Handler: handleDirectorDeleteSession |
| `director_get_messages` | `director_get_messages_response` | session | Handler: handleDirectorGetMessages |
| `director_get_session` | `director_get_session_response` | session | Handler: handleDirectorGetSession |
| `director_get_sessions` | `director_get_sessions_response` | session | Handler: handleDirectorGetSessions |
| `director_load_feedback` | `director_load_feedback_response` | session | Handler: handleDirectorLoadFeedback |
| `director_load_rules` | `director_load_rules_response` | session | Handler: handleDirectorLoadRules |
| `director_rollback_message` | `director_rollback_message_response` | admin/destructive | Handler: handleDirectorRollbackMessage |
| `director_save_feedback` | `director_save_feedback_response` | admin/destructive | Handler: handleDirectorSaveFeedback |
| `director_save_rules` | `director_save_rules_response` | admin/destructive | Handler: handleDirectorSaveRules |
| `director_send_message` | `director_send_message_response` | admin/destructive | Handler: handleDirectorSendMessage |

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

### `director_create_session`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorCreateSession`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_create_session_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_delete_feedback`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorDeleteFeedback`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_delete_feedback_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_delete_session`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorDeleteSession`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_delete_session_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_get_messages`

**Auth:** Session required

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorGetMessages`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_get_messages_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_get_session`

**Auth:** Session required

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorGetSession`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_get_session_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_get_sessions`

**Auth:** Session required

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorGetSessions`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_get_sessions_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_load_feedback`

**Auth:** Session required

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorLoadFeedback`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_load_feedback_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_load_rules`

**Auth:** Session required

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorLoadRules`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_load_rules_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_rollback_message`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorRollbackMessage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_rollback_message_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_save_feedback`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorSaveFeedback`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_save_feedback_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_save_rules`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorSaveRules`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_save_rules_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_send_message`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorSendMessage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_send_message_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

