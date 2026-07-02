# WebSocket: Runes (config editor)

Server handler: `modules/ws/handlers/20-configEditorHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Maps in `config-maps/` overlay live JSON with sparse type/label rules. **Generation quips text content** is stored in SQLite (`generationQuipsDatabase`), not in `config.json` — only `config.generationQuips` scheduler/session settings are editable here.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `config_editor_get_node` | `config_editor_get_node_response` | session | Handler: handleConfigEditorGetNode |
| `config_editor_reveal_secret` | `config_editor_reveal_secret_response` | admin | Handler: handleConfigEditorRevealSecret |
| `config_editor_list` | `config_editor_list_response` | session | Handler: handleConfigEditorList |
| `config_editor_search` | `config_editor_search_response` | session | Handler: handleConfigEditorSearch |
| `config_editor_save` | `config_editor_save_response` | admin/destructive | Handler: handleConfigEditorSave |
| `config_editor_checkpoints_list` | `config_editor_checkpoints_list_response` | session | Handler: handleConfigEditorCheckpointsList |
| `config_editor_checkpoints_get` | `config_editor_checkpoints_get_response` | session | Handler: handleConfigEditorCheckpointsGet |
| `config_editor_checkpoints_create` | `config_editor_checkpoints_create_response` | admin/destructive | Handler: handleConfigEditorCheckpointsCreate |
| `config_editor_checkpoints_restore` | `config_editor_checkpoints_restore_response` | admin/destructive | Handler: handleConfigEditorCheckpointsRestore |
| `config_editor_checkpoints_delete` | `config_editor_checkpoints_delete_response` | admin/destructive | Handler: handleConfigEditorCheckpointsDelete |

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

### `config_editor_reveal_secret`

**Auth:** Admin session required (`userType: "admin"`)

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorRevealSecret`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `configId` | Required — config domain id (e.g. `secureConfig`) |
| `path` | Required — leaf path array to the secret value |

**Success response:** `config_editor_reveal_secret_response`

```json
{
  "type": "config_editor_reveal_secret_response",
  "data": { "value": "<unmasked string>" }
}
```

**Errors:** `FORBIDDEN` for non-admin; `Path is not a secret value` if path is not marked secret.

### `config_editor_list`

**Auth:** Session required

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorList`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `config_editor_list_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `config_editor_search`

**Auth:** Session required

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorSearch`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `query` | Required search string (trimmed; empty returns no results) |
| `configId` | Optional — limit to one config; omit to search all registered configs |
| `maxResults` | Optional — default `50`, max `200` |

**Success response:** `config_editor_search_response`

```json
{
  "type": "config_editor_search_response",
  "requestId": "...",
  "data": {
    "query": "prompt",
    "truncated": false,
    "results": [
      {
        "configId": "promptConfig",
        "path": ["presets", "my_preset", "prompt"],
        "label": "Prompt",
        "description": null,
        "type": "string",
        "breadcrumb": ["Prompt Config", "Presets", "My Preset", "Prompt"],
        "score": 80,
        "matchReason": "label",
        "valuePreview": "1girl, ...",
        "secret": false
      }
    ]
  }
}
```

Match reasons: `label`, `description`, `path`, `enum`, `value`. Secret paths may match on label/path but never include secret values in `valuePreview`.

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors).

### `config_editor_save`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorSave`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `patches` | Object keyed by config id; each value is an array of `{ path, value?, deleted? }` |
| `createCheckpoint` | Optional object keyed by config id; `true` (default) creates a per-file checkpoint before applying that config's patches; `false` skips |
| `partialScope` | Optional `{ configId, path[] }` — partial commit scope; patches must be under or ancestor of `path` (required for uncommitted parent objects) |

**Success response:** `config_editor_save_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `config_editor_checkpoints_list`

**Auth:** Session required

**Handler:** modules/ws/handlers/20-configEditorHandler.js → `handleConfigEditorCheckpointsList`

**Request fields:** `configId` (optional) — when set, returns only per-config file checkpoints for that resource and bundle snapshots whose JSON manifest includes that config.

**Success response:** `config_editor_checkpoints_list_response` with `data.checkpoints[]` (id, createdAt, label, reason, scopeSummary, totalSizeBytes, configCount, databaseCount, optional `kind`: `bundle` | `config-file`, optional `jsonConfigKeys` on bundles), sorted newest first. Also `data.includedResourceTypes`, `data.excludedNotes`.

Per-config auto-save checkpoints use synthetic ids `file:<resourceKey>:<tier/filename>` and appear alongside bundle snapshots.

### `config_editor_checkpoints_get`

**Auth:** Session required

**Request fields:** `checkpointId` (UUID, required)

**Success response:** `config_editor_checkpoints_get_response` with per-resource file names, sizes, and existence flags.

### `config_editor_checkpoints_create`

**Auth:** Admin only (destructive — readonly blocked)

**Request fields:** `label` (optional string)

**Success response:** `config_editor_checkpoints_create_response` with `data.checkpoint` detail object.

Creates a **bundle** snapshot: forces checkpoints on all ConfigManager JSON files and all databases registered in `globalCheckpointManager`. Manifest stored under `.cache/checkpoints/bundles/<uuid>.json`.

### `config_editor_checkpoints_restore`

**Auth:** Admin only (destructive)

**Request fields:**

| Field | Notes |
|-------|-------|
| `checkpointId` | Required UUID |
| `createSafetyCheckpoint` | Optional, default `true` — auto-creates pre-restore bundle |

Validates checkpoint integrity (JSON parse + DB `integrity_check`) before apply. Closes open SQLite wrappers, restores files, reloads config cache, broadcasts `config_checkpoint_restored`.

### `config_editor_checkpoints_delete`

**Auth:** Admin only (destructive)

**Request fields:** `checkpointId` (required)

Removes bundle manifest; deletes underlying snapshot files when no other bundle references them.

