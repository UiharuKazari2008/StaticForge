# WebSocket: Cache & Runtime Assets

Server handler: `modules/ws/handlers/180-cacheHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `broadcast_resource_update` | `broadcast_resource_update_response` | session | Handler: handleBroadcastResourceUpdate |
| `clear_search_cache` | `clear_search_cache_response` | admin/destructive | Handler: handleClearSearchCache |
| `get_cache_manifest` | `cache_manifest_response` | session | Handler: handleGetCacheManifest |
| `rebuild_metadata_cache` | `rebuild_metadata_cache_response` | admin/destructive | Handler: handleRebuildMetadataCache |
| `recompile_runtime_assets` | `recompile_runtime_assets_response` | admin/destructive | Handler: handleRecompileRuntimeAssets |
| `refresh_server_cache` | `refresh_server_cache_response` | critical | Handler: handleRefreshServerCache |
| `set_runtime_assets_auto_recompile` | `set_runtime_assets_auto_recompile_response` | admin/destructive | Handler: handleSetRuntimeAssetsAutoRecompile |

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

### `broadcast_resource_update`

**Auth:** Session required

**Handler:** modules/ws/handlers/180-cacheHandler.js → `handleBroadcastResourceUpdate`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `updateType` | Optional |
| `message` | Optional |
| `files` | Optional |

**Success response:** `broadcast_resource_update_response`

Additional response/push types from handler:
- `resource_update_available`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `clear_search_cache`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/180-cacheHandler.js → `handleClearSearchCache`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `clear_search_cache_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_cache_manifest`

**Auth:** Session required

**Handler:** modules/ws/handlers/180-cacheHandler.js → `handleGetCacheManifest`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `cache_manifest_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `rebuild_metadata_cache`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/180-cacheHandler.js → `handleRebuildMetadataCache`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `rebuild_metadata_cache_response`

Additional response/push types from handler:
- `rebuild_metadata_cache_progress`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `recompile_runtime_assets`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/180-cacheHandler.js → `handleRecompileRuntimeAssets`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `data.force` | Optional boolean. Force recompilation instead of relying on source-hash skip detection. |
| `data.silent` | Optional boolean. Suppress client update UI where supported. |

**Success response data:**

| Field | Notes |
|-------|-------|
| `success` | `true` when no compile errors were reported. |
| `compiled` | Number of source files recompiled in this run. |
| `failedCount` | Number of compile errors. |
| `errors` | Array of `{ file, error }` entries. |
| `stats` | Compile totals and byte-savings data. |

**Push side effects:** refreshes server service-worker hash data and broadcasts `service_worker_cache_update`, plus runtime compile progress/complete/error pushes documented in [websocket.md](../websocket.md#server-initiated-messages-no-requestid).

**Success response:** `recompile_runtime_assets_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

Operational runbook: [Runtime Assets and Service Worker](../../RUNTIME_ASSETS_AND_SERVICE_WORKER.md).

### `refresh_server_cache`

**Auth:** Critical (no session required)

**Handler:** modules/ws/handlers/180-cacheHandler.js → `handleRefreshServerCache`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `refresh_server_cache_response`

**Behavior:** despite the legacy name, this packet recompiles runtime assets, refreshes the service-worker manifest hash cache, and broadcasts updated cache data to clients. Use `recompile_runtime_assets` for the clearer admin-facing operation name when possible.

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `set_runtime_assets_auto_recompile`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/180-cacheHandler.js → `handleSetRuntimeAssetsAutoRecompile`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `data.enabled` | Required boolean value saved to `config.runtimeAssets.autoRecompile`. |

**Success response:** `set_runtime_assets_auto_recompile_response`

**Success response data:** `{ success: true, autoRecompile }`

When enabled, the server checks source hashes on runtime-managed `/css/` and `/scripts/` requests and recompiles stale files before serving them. Keep disabled for normal production use unless live source edits need immediate serving.

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

