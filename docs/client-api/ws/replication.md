# WebSocket: Replication

Server handlers: `modules/ws/handlers/200-replicationHandler.js` plus route-registered packets in `modules/replication/routes/*.js`.

Shared contracts: `modules/replication/replicationContracts.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `replication_status` | `replication_status_response` | session | Role, maintenance, delegation |
| `replication_sync_begin` | `replication_sync_begin_response` | admin session | Child role only; blocks during non-sync maintenance |
| `replication_sync_status` | `replication_sync_status_response` | session | Poll sync phase + maintenance |
| `replication_sync_apply` | `replication_sync_apply_response` | session | Destructive; apply remote changelog rows |
| `replication_separation_prepare` | `replication_separation_prepare_response` | admin | Start separation job |
| `replication_separation_status` | `replication_separation_status_response` | session | Job progress |
| `replication_separation_bootstrap_preview` | `replication_separation_bootstrap_preview_response` | admin | Bootstrap dry-run |
| `replication_separation_bootstrap_apply` | `replication_separation_bootstrap_apply_response` | admin | Apply separation bundle |
| `replication_delegate` | `replication_delegate_response` | session | Server proxy to master WS |
| `replication_delegation_status` | `replication_delegation_status_response` | session | Client reports bridge state |
| `authenticate_replication` | `replication_authenticated` | critical (token) | Master read-only bridge auth |
| `replication_request_remote_gallery` | `replication_request_remote_gallery_response` | session | Fetch master gallery filenames for shared remote browse |

## Server push (no request)

| Push type | When | Client inbound |
|---|---|---|
| `replication_maintenance` | `enterMaintenance` / `exitMaintenance` | `public/scripts/ws/handlers/130-replicationInbound.js` |
| `replication_progress` | Cargo pack/transfer/apply | `130-replicationInbound.js` |
| `replication_sync_status` | Sync phase changes | DSAP sync panel |
| `replication_sync_complete` | Full sync finished | DSAP sync panel |

## Response envelope (`replication_status`)

Successful replies use:

```json
{
  "type": "replication_status_response",
  "requestId": "<same as request>",
  "data": {
    "success": true,
    "enabled": false,
    "role": "standalone",
    "connectivity": "normal",
    "instanceId": "<uuid>",
    "displayName": "",
    "maintenance": { "active": false },
    "delegation": {
      "wikiData": "local",
      "autoComplete": "local",
      "wikiMedia": "local",
      "masterWsConnected": false
    },
    "changelogReady": true
  },
  "timestamp": "<ISO-8601>"
}
```

## Maintenance mode

During separation, Upsert, Sync, or cargo import both participating servers call `enterMaintenance()` / `exitMaintenance()` in pairs:

| Operation | Initiator maintenance | Partner maintenance |
|---|---|---|
| Separation (bundle) | Master during tar build | — (child not live yet) |
| Separation bootstrap | Child during apply | — |
| Full sync | Child + master (`/sync/partner/begin` … `/complete`) | Master for duration |
| Upsert (peer) | Child during export/send | Master during peer import only if import owns the lock |
| Cargo import (HTTP) | Master when import owns the lock | — |

- **Blocked:** destructive WS packets (`REPLICATION_DESTRUCTIVE_WS_PACKETS`), config saves (`configManager`), and HTTP cargo writes while `isWriteBlocked()`.
- **Allowed:** non-destructive reads plus packets in `REPLICATION_MAINTENANCE_ALLOWED_PACKETS` (status, `replication_sync_status`, `replication_separation_status`, ping, etc.).
- **Client UI:** `replication_maintenance` push shows a full-width ticker: “Replication in progress — writes disabled”.

Errors during maintenance use:

```json
{
  "type": "error",
  "code": "REPLICATION_MAINTENANCE",
  "message": "Replication in progress — writes disabled"
}
```

## Read-only restrictions

Destructive replication WS packets return `READONLY_RESTRICTED` for `userType: "readonly"` sessions (including `authenticate_replication` bridge clients).

`authenticate_replication` scopes: `read`, `wiki`, `autocomplete` — **not** `cargo-write`.

## Token scopes (`replicationToken`)

| Scope | Surfaces |
|---|---|
| `read` | `GET /replication/assets/*`, `GET /replication/status` (with `X-Replication-Token`) |
| `wiki` / `autocomplete` | Delegated WS reads on master via bridge |
| `cargo-write` | Peer TCP `:9221`, `POST /replication/sync/export`, `/ack`, `/partner/*` (same token value today) |

Session-authenticated admin routes (`/replication/cargo/*`, `/replication/sync/begin`) do not use the replication token.

## Ephemeral role

`ephemeral` nodes may **Upsert** and **Export cargo** but never run **full changelog sync** (`canRunReplicationAutoSync` → child only). No background auto-sync runs for any role.

## Blocks transfer mode

Blocks mode requires the exact confirmation string `BLOCKS_SLOW_PATH_CONFIRMATION` in `replicationContracts.js` as `blocksAck` (body/query).

| Surface | Warning |
|---|---|
| DSAP cargo/sync panels | Confirmation dialog before selecting Blocks |
| CLI `replication-separate.js` | Prompt `SLOW` unless `--yes` |
| API | `GET /replication/cargo/blocks-warning`, `GET /replication/sync/blocks-warning` |

## HTTP mirror

| Route | Notes |
|---|---|
| `GET /replication/status` | Same payload as `replication_status` WS |
| `GET /replication/gallery/workspace-files` | Master-side filename list for one workspace/view |
| `GET /replication/gallery/remote` | Child-side proxy to the configured master gallery list |
| `GET /replication/delegation/bridge-config` | Client bridge bootstrap |
| Route modules `10`–`60` under `modules/replication/routes/` | Auto-registered; no collisions with legacy `web_server.js` paths |

CORS (`Access-Control-Allow-Origin` echo) is applied **only** on `30-assetRoutes.js` (`OPTIONS`/`GET`/`HEAD /replication/assets/*`).

## Boot order

`globalResources.initialize()` → `initializeReplicationStack()` → `replicationService.initialize()`:

1. `replicationMaintenance`
2. `replicationChangelog`
3. `replicationJournal`
4. `replicationAssetRegistry`
5. `replicationSeparation`

Cargo/sync register later when `registerReplicationRoutes()` loads `40-cargoRoutes` and `50-syncRoutes` (after journal is ready). Delegation (`60-delegationRoutes`) defers `getReplicationService()` to request time.

## Delegation packets

When `cloneProfile` omits a service, these packets proxy to master (see `getReplicationDelegatedPacketMap()`):

- Wiki: `search_tag_wiki`, `get_tag_wiki_page`, `resolve_grimoire_url`, `get_wiki_home`, `get_static_wiki_site_index`, `get_static_wiki_page`
- Autocomplete: `search_tags`, `get_tag_autofill`, `search_characters`, `fetch_autofill_wiki_previews`

Client bridge: `public/scripts/comp/masterWsBridge.js` (read-only packet allowlist).

## Service APIs

- `modules/replicationService.js` — facade, `getStatus()`, delegation patch
- `modules/replicationMaintenance.js` — `enterMaintenance`, `exitMaintenance`, `isWriteBlocked`
- `modules/replicationChangelog.js` — `recordChange`, `withReplicationApply`
- `modules/replicationCargoService.js` — tar cargo, peer receive
- `modules/replicationSync.js` — full sync, changelog merge

---

## Packet details

Handler registration split:

| Packet | Registered in |
|--------|---------------|
| `replication_status` | `modules/ws/handlers/200-replicationHandler.js` |
| `replication_request_remote_gallery` | `modules/ws/handlers/200-replicationHandler.js` |
| `replication_sync_*` | `modules/replication/routes/50-syncRoutes.js` |
| `replication_separation_*` | `modules/replication/routes/20-separationRoutes.js` |
| `authenticate_replication`, `replication_delegate`, `replication_delegation_status` | `modules/replication/routes/60-delegationRoutes.js` |

### `replication_status`

**Auth:** session (admin or readonly)

**Request:** `{ type, requestId }`

**Response:** `replication_status_response` — see envelope above (`enabled`, `role`, `maintenance`, `delegation`, …).

**HTTP mirror:** `GET /replication/status`

---

### `replication_request_remote_gallery`

**Auth:** session

**Request fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `workspaceId` | No | Workspace id; defaults to `default` |
| `viewType` | No | `images` (default), `scraps`, or `pinned` |

**Response:** `replication_request_remote_gallery_response`

```json
{
  "success": true,
  "workspaceId": "default",
  "viewType": "images",
  "files": ["123_generated.png"]
}
```

**Purpose:** fetches filenames from the configured master via
`modules/replicationGalleryProxy.js` and the master's
`GET /replication/gallery/workspace-files` route. It returns filenames only;
gallery metadata and image bytes still use the normal gallery/API paths.

**Constraints:** requires `masterAccessUrl`, rejects `airgapped` connectivity,
and probes the master before issuing the remote read.

**Errors:** `REPLICATION_CONFIG`, `REPLICATION_CONNECTIVITY_BLOCKED`,
`REPLICATION_ASSET_UNAVAILABLE`, or a generic fetch failure from the proxy.

**HTTP mirror:** `GET /replication/gallery/remote`

---

### `replication_sync_begin`

**Auth:** admin session

**Request fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `transferMode` | No | `tape-stream-compressed` (default), `tape-stream`, `blocks` |
| `blocksAck` | When `blocks` | Exact `BLOCKS_SLOW_PATH_CONFIRMATION` string |

**Role:** child only (server rejects other roles).

**Response:** `replication_sync_begin_response` — `{ success, phase, manifestId?, … }`

**Errors:** `REPLICATION_MAINTENANCE`, `INSUFFICIENT_PERMISSIONS`

**HTTP mirror:** `POST /replication/sync/begin`

---

### `replication_sync_status`

**Auth:** session

**Response:** `replication_sync_status_response` — sync state + `maintenance` snapshot.

**HTTP mirror:** `GET /replication/sync/status`

**Push:** server may also broadcast `replication_sync_status` (no `requestId`) on phase changes.

---

### `replication_sync_apply`

**Auth:** session (destructive)

**Request:** `{ changes: [...], partnerInstanceId? }`

**Response:** `replication_sync_apply_response` — applied row counts, `maxLsn`.

---

### `replication_separation_prepare`

**Auth:** admin session (destructive)

**Request (`data` or top-level):** `cloneProfile`, `transferMode`, `childDisplayName`, `childInstanceId`, `masterAccessUrl`, `masterWsUrl`, `masterPeerHost`, `masterPeerPort`, `connectivity`, `outputDir`

**Response:** `replication_separation_prepare_response` — `{ success, jobId }`

**Push:** `replication_progress` during tar build; `replication_maintenance` while active.

**HTTP mirror:** `POST /replication/separation/prepare` → **202**

---

### `replication_separation_status`

**Auth:** session

**Request:** `jobId` (top-level or `data.jobId`)

**Response:** `replication_separation_status_response` — `{ success, job }` (phase, manifestId, error, …)

**HTTP mirror:** `GET /replication/separation/status/:jobId`

---

### `replication_separation_bootstrap_preview`

**Auth:** admin session

**Request:** `{ manifestPath, archivePath }` or `{ manifest }` object for in-memory preview

**Response:** `replication_separation_bootstrap_preview_response` — `{ success, preview }` (clone profile, entry counts, token hint)

---

### `replication_separation_bootstrap_apply`

**Auth:** admin session (destructive)

**Request:** `manifestPath`, `archivePath`, `confirmToken`; optional `archiveBase64`, `manifest`, `archiveName`

**Response:** `replication_separation_bootstrap_apply_response` — `{ success, result }`

**Maintenance:** child enters maintenance for duration of apply.

---

### `authenticate_replication`

**Auth:** critical — **no session**; `replicationToken` in message

**Request:** `{ type, requestId?, replicationToken | token }`

**Success:** `replication_authenticated` — `{ readOnly: true, scopes: ["read","wiki","autocomplete"] }`

**Errors:** `auth_error` + `REPLICATION_TOKEN_INVALID`

Used by child `masterWsBridge.js` for read-only master WS connection.

---

### `replication_delegate`

**Auth:** session on child server

**Request:** `delegateType` (or `packetType`), `delegatePayload`

**Response:** `replication_delegate_response` — proxied master packet in `data.response`, or `{ ackless: true }` for `search_characters` / `fetch_autofill_wiki_previews`

**Errors:** `DELEGATION_FORBIDDEN`, `DELEGATION_NOT_REQUIRED`, `DELEGATION_FAILED`

---

### `replication_delegation_status`

**Auth:** session

**Request:** patch object in `data` — `wikiData`, `autoComplete`, `wikiMedia`, `masterWsConnected` (string/boolean status values)

**Response:** `replication_delegation_status_response` — updated `delegation` block

Client bridge calls after master WS connect/disconnect.

---

## Server push payloads

### `replication_maintenance`

```json
{
  "type": "replication_maintenance",
  "data": {
    "active": true,
    "operation": "upsert",
    "partnerInstanceId": "<uuid>",
    "reason": "Replication in progress — writes disabled",
    "transferMode": "tape-stream-compressed",
    "startedAt": "<ISO-8601>"
  },
  "timestamp": "<ISO-8601>"
}
```

When `active: false`, client hides maintenance ticker.

### `replication_progress`

```json
{
  "type": "replication_progress",
  "data": {
    "phase": "separation",
    "current": 2,
    "total": 4,
    "path": "optional/detail"
  },
  "timestamp": "<ISO-8601>"
}
```

### `replication_sync_complete`

```json
{
  "type": "replication_sync_complete",
  "data": {
    "success": true,
    "applied": 42,
    "maxLsn": 1234
  },
  "timestamp": "<ISO-8601>"
}
```

---

## Structured error codes

| Code | When |
|------|------|
| `REPLICATION_MAINTENANCE` | Write blocked during maintenance |
| `REPLICATION_ASSET_UNAVAILABLE` | Master asset GET 404 |
| `REPLICATION_ROLE_MISMATCH` | Wrong role for operation |
| `REPLICATION_CONNECTIVITY_BLOCKED` | Airgapped / connectivity guard |
| `REPLICATION_TOKEN_INVALID` | Token auth failure |
| `REPLICATION_TRANSFER_ABORTED` | Cargo/sync transfer failure or missing blocks ack |

