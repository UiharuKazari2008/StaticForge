# WebSocket: Chat

Server handler: `modules/ws/handlers/50-chatHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `chat_persona_contacts_backfill` | `chat_persona_contacts_backfill_response` | admin/destructive | One-off: a Contacts card for every chat without one (#763) |
| `create_chat_session` | `create_chat_session_response` | admin/destructive | Handler: handleCreateChatSession |
| `delete_chat_message` | `delete_chat_message_response` | admin/destructive | Handler: handleDeleteChatMessage |
| `delete_chat_session` | `delete_chat_session_response` | admin/destructive | Handler: handleDeleteChatSession |
| `get_chat_messages` | `get_chat_messages_response` | session | Handler: handleGetChatMessages |
| `get_chat_persona_state` | `get_chat_persona_state_response` | session | The persona's state for its contact card (#763) |
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

## AI provider and streaming

Chat personas run on DeepInfra (`modules/aiServices/deepInfraChatService.js`, Yozora #736; Grok is no longer used). The provider row and key are the DeepInfra entry of `customModelProviders` (config.json row, secure.config.json `customModelProviders.keys[]`). Model: config `chatModel`, else that row's `defaultModel` (`deepseek-ai/DeepSeek-V4.1-Flash` today); provider id: config `chatProvider` (default `deepinfra`). `chatSendImages: true` sends the character picture and viewer avatar (needs a vision model); off by default, the persona prompt carries the image's generation tags instead. Each turn resends the history from chat.db (no server-side conversation state). Sessions stored with the old `grok` provider switch to DeepInfra on first use. A `create_chat_session` `model` is honoured only when it is a DeepInfra-style id (`org/model`, not `grok*`). App options send the chat model as `chatModel`; clients send `provider: 'deepinfra'` and that model (or null for the server default). `defaultGrokModel` is no longer sent (Yozora #738).

With `chat_streaming_enabled`, persona setup and each send push `chat_streaming_start`, then `chat_streaming_update` (`events`: complete event objects as they arrive, `fullResponse`), then `chat_streaming_complete` (`finalResponse`, `usage`). On every failure the server sends `chat_message_response` with `data.success: false`, `data.error`, then `chat_streaming_complete` with `error` and no `requestId`, so no client is left waiting on typing dots. A failed persona setup also stores an `Error: ...` assistant row; the chat stays and the first send sets the persona up again.

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

### `chat_persona_contacts_backfill`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/52-chatPersonaContactsHandler.js → `handleBackfill` (modules/chatPersonaContacts.js `backfill`, Yozora #763)

One-off: makes a contact card for every chat session that has none, all in that workspace's Contacts folder.

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `workspaceId` | Required; unknown workspace → error |
| `dryRun` | Optional boolean; `true` reports what would be made without writing |

**Success response:** `chat_persona_contacts_backfill_response` `{ success: true, ...result }`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED`.

### `get_chat_persona_state`

**Auth:** Session required

**Handler:** modules/ws/handlers/52-chatPersonaContactsHandler.js → `handleGetChatPersonaState` (modules/chatPersonaContacts.js `getPersonaState`, Yozora #763)

The persona's state for its contact card (Contacts' Persona page, the phone's contact card), read from chat.db.

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `chatId` | Required positive integer |

**Success response:** `get_chat_persona_state_response` `{ success: true, state }`; `state` is `{ exists: false, chatId }` for an unknown chat.

**Errors:** `type: "error"` via `sendError()` (`Chat ID is required`, `Failed to get the persona state`).
