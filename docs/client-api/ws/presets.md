# WebSocket: Presets

Server handler: `modules/ws/handlers/80-presetHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `delete_preset` | `delete_preset_response` | admin/destructive | Handler: handleDeletePreset |
| `delete_preset_group` | `delete_preset_group_response` | admin/destructive | Handler: handleDeletePresetGroup |
| `generate_preset` | `generate_preset_response` | admin/destructive | Handler: handleGeneratePreset |
| `get_preset_groups` | `get_preset_groups_response` | session | Handler: handleGetPresetGroups |
| `get_presets` | `get_presets_response` | session | Handler: handleGetPresets |
| `load_preset` | `load_preset_response` | session | Handler: handleLoadPreset |
| `regenerate_preset_uuid` | `regenerate_preset_uuid_response` | admin/destructive | Handler: handleRegeneratePresetUuid |
| `save_preset` | `save_preset_response` | admin/destructive | Handler: handleSavePreset |
| `save_preset_group` | `save_preset_group_response` | admin/destructive | Handler: handleSavePresetGroup |
| `search_presets` | `search_presets_response` | session | Handler: handlePresetSearch |
| `update_preset` | `update_preset_response` | admin/destructive | Handler: handleUpdatePreset |

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

### `delete_preset`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/80-presetHandler.js → `handleDeletePreset`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `presetName` | Optional |

**Success response:** `delete_preset_response`

Additional response/push types from handler:
- `preset_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_preset_group`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/80-presetHandler.js → `handleDeletePresetGroup`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `groupName` | Optional |

**Success response:** `delete_preset_group_response`

Additional response/push types from handler:
- `preset_group_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `generate_preset`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/80-presetHandler.js → `handleGeneratePreset`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `presetName` | Optional |
| `allow_paid` | Optional |
| `workspace` | Optional |
| `enableStreaming` | Optional |
| `stepPreviewWidth` | Optional |
| `stepPreviewHeight` | Optional |

**Success response:** `generate_preset_response`

Additional response/push types from handler:
- `image_generation_intermediate`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_preset_groups`

**Auth:** Session required

**Handler:** modules/ws/handlers/80-presetHandler.js → `handleGetPresetGroups`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_preset_groups_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_presets`

**Auth:** Session required

**Handler:** modules/ws/handlers/80-presetHandler.js → `handleGetPresets`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `page` | Optional |
| `itemsPerPage` | Optional |
| `searchTerm` | Optional |

**Success response:** `get_presets_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `load_preset`

**Auth:** Session required

**Handler:** modules/ws/handlers/80-presetHandler.js → `handleLoadPreset`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `presetName` | Optional |
| `presetUuid` | Optional |

**Success response:** `load_preset_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `regenerate_preset_uuid`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/80-presetHandler.js → `handleRegeneratePresetUuid`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `presetName` | Optional |

**Success response:** `regenerate_preset_uuid_response`

Additional response/push types from handler:
- `preset_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `save_preset`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/80-presetHandler.js → `handleSavePreset`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `presetName` | Optional |
| `config` | Optional |

**Success response:** `save_preset_response`

Additional response/push types from handler:
- `preset_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `save_preset_group`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/80-presetHandler.js → `handleSavePresetGroup`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `groupName` | Optional |
| `groupData` | Optional |

**Success response:** `save_preset_group_response`

Additional response/push types from handler:
- `preset_group_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `search_presets`

**Auth:** Session required

**Handler:** modules/ws/handlers/80-presetHandler.js → `handlePresetSearch`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `query` | Optional |

**Success response:** `search_presets_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `update_preset`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/80-presetHandler.js → `handleUpdatePreset`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `presetName` | Optional |
| `name` | Optional |
| `target_workspace` | Optional |
| `resolution` | Optional |
| `request_upscale` | Optional |

**Success response:** `update_preset_response`

Additional response/push types from handler:
- `preset_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

