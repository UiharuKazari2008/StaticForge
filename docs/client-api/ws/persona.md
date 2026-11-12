# WebSocket: Persona Settings

Server handler: `modules/ws/handlers/210-personaHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `get_persona_settings` | `get_persona_settings_response` | session | Handler: handleGetPersonaSettings |
| `save_persona_settings` | `save_persona_settings_response` | admin/destructive | Handler: handleSavePersonaSettings |
| `get_chat_engine_settings` | `get_chat_engine_settings_response` | session | Handler: handleGetChatEngineSettings |
| `save_chat_engine_settings` | `save_chat_engine_settings_response` | admin/destructive | Handler: handleSaveChatEngineSettings |

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

### `get_persona_settings`

**Auth:** Session required

**Handler:** modules/ws/handlers/210-personaHandler.js → `handleGetPersonaSettings`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_persona_settings_response` — `data.settings`: `{ id, user_name, profile_photo_base64, backstory, default_verbosity (1-5), chat_provider, chat_model, chat_effort, created_at, updated_at }`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `save_persona_settings`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/210-personaHandler.js → `handleSavePersonaSettings`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `settings` | Any of `user_name`, `profile_photo_base64` (raw base64, `''` clears), `backstory`, `default_verbosity`. **Merges**: keys left out keep their stored value (the chat engine columns too, Yozora #763). |

**Success response:** `save_persona_settings_response` — `data: { success, message }`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_chat_engine_settings`

**Auth:** Session required

**Handler:** modules/ws/handlers/210-personaHandler.js → `handleGetChatEngineSettings`

The chat personas' engine (Yozora #763), shared by the desktop Control Panel "Chat" page and the phone's Messaging Options. Stored on the `persona_settings` row (`chat_provider`, `chat_model`, `chat_effort`); the chat service (modules/aiServices/deepInfraChatService.js) reads a cached copy.

**Success response:** `get_chat_engine_settings_response`

```json
{
  "success": true,
  "settings": { "provider": "", "model": "", "effort": "default" },
  "effective": { "provider": "deepinfra", "providerName": "DeepInfra", "model": "deepseek-ai/DeepSeek-V4.1-Flash", "effort": "default" },
  "serverDefault": { "provider": "deepinfra", "providerName": "DeepInfra" },
  "providers": [{ "id": "deepinfra", "name": "DeepInfra", "kind": "deepinfra", "logo": "", "hasKey": true, "defaultModel": "deepseek-ai/DeepSeek-V4.1-Flash" }],
  "efforts": ["default", "none", "low", "medium", "high"]
}
```

`settings.provider` `''` means config `chatProvider`; `settings.model` `''` means config `chatModel` (for that provider) or the provider row's default. Model catalogs come from `director_get_models` with `engine: "custom:<provider id>"`.

### `save_chat_engine_settings`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/210-personaHandler.js → `handleSaveChatEngineSettings`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `settings.provider` | Custom model provider id with a key, or `''` for the server default. Omit to keep. |
| `settings.model` | Model id, or `''` for the provider's default. Omit to keep. |
| `settings.effort` | `default` (no `reasoning_effort` sent), `none`, `low`, `medium`, `high`. Omit to keep. |

**Success response:** `save_chat_engine_settings_response` — same `data` as `get_chat_engine_settings`.

**Errors:** unknown provider, provider without a key, bad model id or effort → `type: "error"` (`CHAT_ENGINE_SAVE_FAILED`).

Existing chats: a chat whose stored provider is the chosen engine keeps its own model; a chat started on another provider follows the chosen engine and model from its next message. A 400 from the provider that names reasoning is retried once without `reasoning_effort`.
