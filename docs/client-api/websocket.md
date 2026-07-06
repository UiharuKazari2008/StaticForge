# WebSocket Protocol

Primary real-time API for StaticForge. Default URL:

```
ws://<host>:9220/
wss://<host>:9220/   (when TLS terminates on the app)
```

WebSocket shares the HTTP server port (9220). No separate path.

## Connection lifecycle

1. Complete HTTP login (session cookie) — see [authentication.md](./authentication.md)
2. Open WebSocket with cookie on handshake
3. Server sends **`connection`** (server push)
4. If authenticated: may receive `workspace_restored`, `workspace_data`, `gallery_scroll_state`, `search_indexing_status`
5. Client sends `{ type, requestId, … }` messages
6. Server replies with typed responses or `error` / `auth_error`

On disconnect, server cancels active generations for that client and cleans session workspace cache.

## Message envelope

### Client → server (request)

```json
{
  "type": "request_gallery",
  "requestId": "req_1719491234567_abc123def",
  "viewType": "images",
  "offset": 0,
  "limit": 100
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Registered packet name (see [ws/](./ws/)) |
| `requestId` | Strongly recommended | Correlates responses; client generates unique IDs |
| `…` | Varies | Request payload fields merged at top level (not nested under `data` on send) |

Web client pattern (`public/scripts/websocket.js`):

```javascript
// sendMessageWithRequestId builds: { type, requestId, ...data }
requestId format: `req_${Date.now()}_${random9chars}`
```

### Server → client (success response)

Typical shape:

```json
{
  "type": "request_gallery_response",
  "requestId": "req_1719491234567_abc123def",
  "data": { },
  "timestamp": "2025-06-27T12:00:00.000Z"
}
```

Some handlers use `operation_response` pattern for workspaces (`success`, `message` inside `data`).

### Server → client (errors)

**Generic error** (`sendError`):

```json
{
  "type": "error",
  "message": "Human-readable message",
  "details": "optional string or operation id",
  "requestId": "req_...",
  "timestamp": "..."
}
```

**Auth error:**

```json
{
  "type": "auth_error",
  "message": "Authentication required",
  "code": "AUTH_REQUIRED",
  "timestamp": "..."
}
```

**Read-only restriction:**

```json
{
  "type": "error",
  "message": "Non-Administrator Login: This operation is not allowed for read-only users",
  "code": "READONLY_RESTRICTED",
  "timestamp": "..."
}
```

**Internal handler failure:**

```json
{
  "type": "error",
  "message": "<error.message>",
  "details": "<message.type>",
  "requestId": "...",
  "code": "INTERNAL_ERROR",
  "timestamp": "..."
}
```

**Unknown type:**

```json
{
  "type": "error",
  "message": "Unknown message type",
  "details": "<requested type>"
}
```

## Welcome message

**Type:** `connection`  
**Direction:** Server → client (immediate on connect)

```json
{
  "type": "connection",
  "status": "connected",
  "message": "WebSocket connection established",
  "authenticated": true,
  "userType": "admin",
  "vfsPathUuid": "<uuid>",
  "logViewerPathUuid": "<uuid>",
  "timestamp": "..."
}
```

Unauthenticated: `authenticated: false`, no `userType`.

## Heartbeat / ping

Server broadcasts **ping** every ~10 seconds (`modules/websocket.js` → `startPingInterval`):

```json
{
  "type": "ping",
  "timestamp": "...",
  "data": {
    "balance": { "fixedTrainingStepsLeft": 10000, "purchasedTrainingSteps": 500, "totalCredits": 10500 },
    "accountHealth": { "userDataValid": true, "upstreamUnavailable": false },
    "queue_status": { },
    "image_count": 123,
    "server_time": 1719491234567
  }
}
```

Client should respond with **pong** (also a registered handler):

```json
{ "type": "pong", "timestamp": "..." }
```

`ping` is in `CRITICAL_MESSAGE_TYPES` — works without auth.

Client may also send `ping` request; server responds via `pong` handler.

## Long-running requests

For generation, gallery, etc.:

- Server sends **`request_keep_alive`** during processing:

```json
{
  "type": "request_keep_alive",
  "requestId": "req_...",
  "status": "processing",
  "progress": 45,
  "message": "Optional status text",
  "timestamp": "..."
}
```

- Client default timeout: **120 seconds** after last keep-alive (`WebSocketClient.resetRequestTimeout`)
- Generation keep-alive interval: **15s** on server

On timeout client rejects with `Error` code `REQUEST_TIMEOUT`.

## Streaming generation

When `enableStreaming: true` on `generate_image`, `generate_preset`, `expand_image`, etc.:

- Intermediate/progress via `image_generation_progress`, `dynamic_generation_progress_update`
- Final result still on `image_generation_response` (or domain-specific `*_response`)
- Client tracks streaming sessions in `WebSocketClient` (`beginStreamingStepSession`, etc.)

## Server-initiated messages (no requestId)

These are **pushes** — handle asynchronously. Browser handlers live in `public/scripts/ws/handlers/*Inbound.js` when the web client consumes the push directly.

| Type | When sent | Payload (top-level / `data`) |
|------|-----------|------------------------------|
| `connection` | Immediately on WS connect | `status`, `message`, `authenticated`, `userType?`, `vfsPathUuid?`, `logViewerPathUuid?` (admin) |
| `ping` | ~10s interval broadcast | `data.balance`, `data.accountHealth`, `data.queue_status`, `data.image_count`, `data.server_time` |
| `request_keep_alive` | During long WS requests | `requestId`, `status: "processing"`, optional `progress`, `message` |
| `account_data_health_updated` | Account health or balance changed after boot, retry, or periodic refresh | `data` contains account health fields plus optional `balance`; see [ws/account.md](./ws/account.md) |
| `api_service_lock_changed` | Service Key tripwire lock/unlock changed | Admin-only broadcast: `data.service`, `data.label`, `data.lock`; see [ws/admin.md](./ws/admin.md#get_api_key_services) |
| `gallery_updated` | Image add/delete/move/scrap/pin | `data.action` (`add`, `bulk_delete`, `remove`, …), `filename?`, `filenames?`, `viewType?`, `deletedCount?`, `lastGalleryDestructiveAt?` |
| `gallery_scroll_state` | On reconnect (session restore) | Scroll hints per view: `index`, `viewType`, `workspaceId`, `anchorFilename?` |
| `workspace_updated` | Workspace mutation | `data.action` (e.g. `bulk_add_pinned`, `settings_updated`, `files_moved`), `workspaceId`, action-specific counts/fields |
| `workspace_image_added` | New image(s) in workspace | `workspaceId`, `imageFilenames[]` |
| `workspace_activated` | Active workspace changed | `workspaceId`, workspace summary |
| `workspace_restored` | Reconnect session restore | Active workspace id + cached workspace payload |
| `workspace_data` | Full active workspace snapshot | Workspace object (files, scraps, pinned, settings, …) |
| `workspace_desktop_persisted` | Desktop layout saved | `workspaceId`, desktop positions/settings |
| `workspace_css_updated` | Workspace CSS recompiled | `webPath`, `hash` / `sourceHash` |
| `workspace_deleted` | Workspace removed | `workspaceId` |
| `queue_update` | Generation queue changed | Queue depth, processing flags (see `40-appCoreInbound.js`) |
| `preset_updated` / `preset_group_updated` | Preset config changed | Preset name/uuid or group id; clients refresh preset lists |
| `receipt_notification` | NovelAI billing/receipt event | Receipt metadata for balance UI |
| `search_indexing_status` | Connect + index state change | `status`: `idle` \| `indexing` \| `paused`, `message`, `paused`, `indexing` |
| `search_results_update` | File search incremental results | Search id, partial result rows |
| `search_status_update` | File search progress | Status text, counts |
| `search_results_complete` | File search finished | Final result set reference |
| `dynamic_generation_progress_update` | Rentan / dynamic gen | `phase`, `data` (may include `requestId` routing) |
| `image_generation_progress` | Streaming step preview | Step index, preview base64/thumbnail, `requestId` |
| `image_generation_error` | Generation failed (push path) | Error message, `requestId` |
| `image_generation_response` | Some flows push final result | Same shape as request response (also used as correlated reply) |
| `image_upscaling_response` / `image_upscaling_error` | Upscale complete/fail | Result filename or error |
| `image_expansion_response` / `image_expansion_error` | Expansion complete/fail | Result metadata or error |
| `image_expansion_reroll_response` / `image_expansion_reroll_error` | Expansion reroll | Same family as expansion |
| `generation_quips_updated` / `generation_quips_progress` / `generation_quips_status` | Quips DSAP batch job | Progress percent, status text, wiki sync state |
| `chat_message_response` | Chat reply (non-streaming) | Message object |
| `chat_streaming_start` / `chat_streaming_update` / `chat_streaming_complete` | Streaming chat | Token deltas, session id |
| `note_created` / `note_updated` / `note_deleted` / `note_content_updated` | Notes sync | `noteId`, `note` or `updates` |
| `novel_progress` / `novel_updated` / `novel_generate_complete` | Novel manager | `noteId`, phase/result payload |
| `vfs_updated` | VFS tree changed | `{ type, data }` — clients refresh explorer |
| `service_worker_cache_update` | Static manifest changed | Triggers SW re-fetch |
| `runtime_compile_error` / `runtime_compile_progress` / `runtime_compile_complete` / `runtime_compile_logs` | Runtime asset recompile | Progress, log lines, error text |
| `resource_update_available` | Server resource refresh | Notifies clients to refresh options/cache |
| `config_refresh_error` | Config reload failed | Error message |
| `rebuild_metadata_cache_progress` / `rebuild_metadata_cache_response` | Metadata cache rebuild | Progress percent / completion |
| `refresh_server_cache_response` | Cache refresh done | Success/failure summary |
| `desktop_positions_updated` | Desktop icon positions saved | `workspaceId`, `positions` |
| `error` | Generic server error push | `message`, optional `code`, `details` |

Director messages use prefix `director_` (handled in client before inbound registry).

## Reconnection strategy

Web client behavior (`WebSocketClient`):

| Setting | Typical value |
|---------|---------------|
| Initial reconnect delay | 1000 ms |
| Max reconnect attempts | Configurable (`maxReconnectAttempts`) |
| Circuit breaker | Stops auto-reconnect after repeated failures; manual reconnect resets |
| Focus regain | Resets circuit breaker and reconnects when tab visible again |

**After reconnect:**

1. Receive `connection` + session restore messages
2. Run registered refresh callbacks (`registerRefreshCallback`)
3. Re-fetch gallery, workspace, presets as needed
4. Pass `workspaceId` on `request_gallery` if session map may be stale

## Request correlation

Promises keyed by `requestId` in `pendingRequests` Map. Response types:

- Usually `{requestType}_response`
- Generation: `image_generation_response`, not `generate_image_response`
- Errors: same `requestId` on `type: "error"`

Custom callbacks: `setRequestCallback(requestId, fn)` for multi-phase responses.

## Pagination (gallery)

`sendGalleryPaginationRequest` groups requests by `paginationGroupId`. Uses `offset` + `limit` (default chunk 750). Only first request in group increments pending-request UI counter.

## Unauthenticated access summary

| Allowed without session | Blocked |
|-------------------------|---------|
| Connect WS | All non-critical `type` values |
| `ping`, `pong`, `server_status`, `check_updates`, `refresh_server_cache`, `version_check` | Gallery, generation, etc. |
| Application auth: `authenticate_application`, `refresh_application_key`, `request_temp_access_token`, `request_application_authorization`, `check_application_authorization`, `claim_application_authorization` | All other packets |

## Domain documentation

Full packet lists: [ws/](./ws/) directory (275 request types).

## Implementation references

| File | Role |
|------|------|
| `modules/websocket.js` | WS server, session extract, ping, broadcast |
| `modules/websocketHandlers.js` | Route to registry, destructive checks |
| `modules/ws/wsPacketRegistry.js` | Handler registration |
| `public/scripts/websocket.js` | Client `WebSocketClient` |
| `public/scripts/ws/wsInboundRegistry.js` | Inbound push dispatch |
