# REST API

HTTP routes defined in `web_server.js` and static middleware. Default base: `http://<host>:9220`.

**Authentication:** Unless noted, routes use `authMiddleware` — session cookie, application credentials (`X-StaticForge-App-Key` + matching `User-Agent`, or `X-StaticForge-App-Token`), or legacy `Authorization: Bearer <loginKey>` / `?auth=`. See [authentication.md](./authentication.md).

**Cache headers:** Auth middleware forces no-store on protected JSON routes. Image routes use longer cache (see each route).

---

## Table of contents

1. [Auth & session](#auth--session)
2. [Server status & service worker](#server-status--service-worker)
3. [App shell](#app-shell)
4. [Images & previews](#images--previews)
5. [Cache & static assets](#cache--static-assets)
6. [Preset & generation (HTTP)](#preset--generation-http)
7. [Admin: pending queue](#admin-pending-queue)
8. [Traces](#traces)
9. [Admin log viewer (UUID path)](#admin-log-viewer-uuid-path)
10. [VFS (UUID path)](#vfs-uuid-path)
11. [Android background notification](#android-background-notification)
12. [Miscellaneous](#miscellaneous)
13. [Static files (public/)](#static-files-public)

---

## Auth & session

### `GET /`

Serves login page (`public/index.html`). **No auth.**

### `GET /.login.jpg`

Login background sprite. **No auth.**

### `POST /`

Multi-action JSON endpoint. Body: `{ "action": string, "data": object }`.

| Action | Auth | Description |
|--------|------|-------------|
| `login` | No | PIN login — [authentication.md](./authentication.md) |
| `logout` | Session | Destroy session |
| `ping` | No | Session probe + optional telemetry |

**Invalid action:** 400 `{ "success": false, "error": "Invalid action" }`

### `OPTIONS /app`

Session validation + server version. **Auth required.**

Response fields: `success`, `message`, `timestamp`, `serverVersion`, `versionMessage`, `userType`, `vfsPathUuid`, `logViewerPathUuid` (admin).

### `GET /app`

Serves main app shell (`public/app.html`). **No auth on GET** (app bootstraps auth client-side).

---

## Server status & service worker

### `OPTIONS /status`

**No auth.** Server readiness probe.

**Response:**

```json
{
  "isReady": true,
  "stage": "ready",
  "stageMessage": "...",
  "uptime": 12345,
  "lastUpdate": 1234567890,
  "timestamp": 1234567890123,
  "runtimeCompileComplete": true,
  "runtimeCompile": { },
  "runtimeAutoRecompile": { "autoRecompile": false }
}
```

Use before login if server may still be compiling runtime assets.

### `OPTIONS /`

**No auth.** Returns service worker static file manifest via `buildServiceWorkerCacheManifest()`.

**503** when `runtimeCompileComplete === false`:

```json
{
  "success": false,
  "error": "Runtime assets are compiling",
  "stage": "runtime_compile",
  "stageMessage": "...",
  "uptime": 12345,
  "retryAfter": 5
}
```

---

## App shell

### `GET /launch`

Launch helper page. **No auth.**

### `GET /internal/*`

Service worker cache miss handler. **No auth.**

```json
{
  "success": true,
  "message": "File is missing from client cache",
  "path": "/internal/...",
  "timestamp": 1234567890123
}
```

---

## Images & previews

### `GET /images/:filename`

**Auth required.**

| Query | Description |
|-------|-------------|
| `download=true` | `Content-Disposition: attachment` |
| `stripContext=true` | PNG only — strip dynamic_generation compiled context from Comment chunk |

**Success:** Image bytes (`image/png` or `image/jpeg` by extension)  
**Errors:** 404 `{ "success": false, "error": "Image not found" }`

**Headers:** `Cache-Control: private, max-age=259200`, `Content-Length`, `ETag`, `Last-Modified`

### `GET /image/slim/:filename`

**Auth required.** PNG with metadata stripped via sharp.

| Query | Description |
|-------|-------------|
| `download=true` | Attachment as `{base}_slim.png` |

### `GET /image/opti/:filename`

**Auth required.** Optimized/transcoded variant (see handler in `web_server.js`).

### `GET /previews/:preview`

**Auth required.** Preview from `.previews/` directory.

**404:** `{ "success": false, "error": "Preview not found" }`

---

## Cache & static assets

### `GET /cache/*`

**Auth required.** Static files from `.cache/` (upload, vibe, wiki mirrors, etc.).  
`Cache-Control: public, max-age=259200`

### `GET /naxCache/:gallerySlug/:filename`

**Auth required.** NAX tag preview images.

### `GET /private/wiki/*`

**Auth required.** Cached wiki static content. `maxAge: 7d`

### `GET /temp/*`

**No auth** on static middleware. Temp downloads from `.cache/tempDownload`. Short cache (10s).

Used after `download_url_file` WS upload flows — e.g. `/temp/{tempFilename}`.

---

## Preset & generation (HTTP)

These routes support **webhook-style** generation without WebSocket. Several use `getQueueMiddleware` for scheduled/queued execution.

### `GET /preset/:uuid`

**Auth:** No session required; uses queue middleware + `serverReadinessMiddleware`

Generates from preset UUID (resolved via text replacement / preset registry).

**Query parameters** (optional overrides — validated by `validatePresetQueryParameters`):

| Param | Type | Description |
|-------|------|-------------|
| `workspace` | string | Target workspace id |
| `steps` | int | Override steps |
| `guidance` | float | Override guidance |
| `rescale` | float | Override rescale |
| `seed` | int | Override seed |
| `variety` | bool | `true`/`false` |
| `upscale` | bool or float | Upscale setting |
| `num` | int | For staged/pipeline results — index into `filenames[]` |

**Success:** Image bytes (PNG/JPEG) with headers:

- `X-Generated-Filename`
- `X-Seed`
- `Content-Type`

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Unknown UUID |
| 400 | Invalid query params `{ success, error, details }` |
| 500 | Generation failure |

**Client state:** New image file on server; gallery WS broadcast to connected clients.

### `GET /pending/preset/:uuid`

**Auth:** None (`serverReadinessMiddleware` + queue middleware only — same as public preset webhook).

Queues a preset or preset-group generation; returns immediately with a `request_id` for polling.

| Query | Required | Description |
|-------|----------|-------------|
| `window` | No | If set (seconds ≥ 60), schedules random delay within window; response `success: "pending"`. Without `window`, runs ASAP (`success: "success"`). |
| `name` | No | Named request idempotency key; 409 if same name exists and not yet retrieved |
| `workspace` | No | Target workspace (default: preset's `target_workspace` or `default`) |
| `breakPoint` | No | 2-char hex pipeline stage id (e.g. `3f`) |
| *(preset params)* | Varies | Same query params as `GET /preset/:uuid` — validated by `validatePresetQueryParameters` |

**Success (immediate queue):** `200` JSON

```json
{
  "success": "success",
  "request_id": "<uuid>",
  "scheduled_time": 1719491234567
}
```

When `window` is used, `success` is `"pending"` instead of `"success"`.

**Errors:**

| Status | Body |
|--------|------|
| 401 | `{ "success": "not_possible", "error": "Invalid preset or preset group UUID" }` |
| 400 | `{ "success": "not_possible", "error": "...", "details": [...] }` invalid query/window/breakPoint |
| 409 | `{ "success": "not_possible", "error": "Named request \"…\" already exists..." }` |
| 500 | `{ "success": "failed", "error": "<message>" }` |

**Follow-up:** Poll `GET /pending/retrieval/:request_id` until status is `completed`, then read image bytes.

### `GET /pending/retrieval/:requestid`

**Auth:** None (`serverReadinessMiddleware` only).

Polls a queued preset request. Response shape depends on `request.status`.

| Param | Description |
|-------|-------------|
| `:requestid` | UUID from `/pending/preset`, or `named:<name>` for named requests |

| Query | Description |
|-------|-------------|
| `num` | For staged generations with multiple saved images: numeric index `0…n-1` or 2-char hex `stageId` |
| `optimize=true` | Return JPEG q=75 instead of PNG when completed |
| `download=true` | `Content-Disposition: attachment` when completed |

**Waiting / pending:** `200` JSON

```json
{
  "status": "waiting",
  "scheduled_time": 1719491234567,
  "queue_position": 2
}
```

(`status` may be `"pending"` when scheduled with `window`.)

**Error state:** `200` JSON `{ "status": "error", "error": "<message>" }`

**Completed:** `200` **binary image** (PNG or JPEG if `optimize=true`)

Headers: `Content-Type`, `X-Generated-Filename`, `X-Request-ID`, optional `X-Total-Saved` (staged multi-save count), `Access-Control-Expose-Headers`

**Other errors:** 404 `{ "success": false, "error": "..." }` (unknown id/name); 404 staged `{ "success": false, "error": "Stage ID '…' not found", "available_stage_ids": [...], ... }`; 500 missing filename or server error

**Client state:** First successful completed retrieval sets `retrievedAt` on the server-side pending record (allows named-request overwrite).

### `GET /reroll/:filename`

**Auth required. Admin only** (`userType !== 'admin'` → 403).

Regenerates from existing image metadata.

| Query | Description |
|-------|-------------|
| `workspace` | Workspace id (default `default`) |
| `optimize=true` | Return JPEG q=75 instead of PNG |
| `download=true` | Attachment disposition |

**Response headers:** `X-Generated-Filename`, `X-Seed`, `X-Original-Filename`, `Access-Control-Expose-Headers`

**Errors:** 404 no metadata, 500 generation error

### `POST /test-bias-adjustment`

**Auth:** None — only `serverReadinessMiddleware` (no `authMiddleware`). Unauthenticated clients on the same network can call this endpoint when the server is ready. Intended as an internal/dev image-processing probe, not a public API.

**Body (JSON):**

| Field | Required | Description |
|-------|----------|-------------|
| `image_source` | Yes | `file:{filename}` under images dir, or `cache:{filename}` under upload cache |
| `bias` | Yes | Bias object for dynamic image processing |
| `target_width` / `target_height` | Yes | Output dimensions |

**Success:** `200` `image/png` processed buffer  
**Errors:** 400 missing/invalid source, 404 file not found, 500 processing error (`{ success: false, error }`)

---

## Admin: pending queue

### `GET /pending`

**Auth required. Admin only.**

Lists scheduled/pending preset generation requests.

**Response:**

```json
{
  "success": true,
  "total": 5,
  "queue_length": 2,
  "processing": true,
  "requests": [
    {
      "requestId": "...",
      "name": null,
      "presetUuid": "...",
      "workspaceId": "default",
      "status": "waiting|pending|processing|completed|...",
      "createdAt": 1234567890,
      "startedAt": null,
      "completedAt": null,
      "retrievedAt": null,
      "duration": null,
      "errorMessage": null,
      "files": ["file.png"],
      "breakPoint": null,
      "queuePosition": 1
    }
  ]
}
```

---

## Traces

### `GET /traces`

**Auth required.** Serves `public/traces.html`.

### `GET /traces/list`

**Auth required.**

```json
{ "success": true, "traces": [ /* trace summaries */ ] }
```

### `GET /traces/:id`

**Auth required.**

```json
{ "success": true, "trace": { /* full trace */ } }
```

**404:** `{ "success": false, "error": "Trace not found" }`

### `GET /traces/files/*`

**Auth required.** Static attachments from traces directory.

---

## Admin log viewer (UUID path)

Base path: `/{logViewerPathUuid}` — UUID from login response (admin only). Not guessable.

All routes: **authMiddleware + adminOnlyMiddleware**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/{uuid}/sources` | List log sources and PM2 availability |
| GET | `/{uuid}/pm2/status` | PM2 process status |
| POST | `/{uuid}/pm2/flush` | Flush PM2 logs |
| POST | `/{uuid}/pm2/restart` | Body `{ broom?: boolean }` — returns before async DSS restart runs; `broom` defaults to `true` |
| GET | `/{uuid}/backlog?source=&lines=500` | Tail log file |
| GET | `/{uuid}/stream?source=&offset=` | SSE log stream |

**`/sources` response:**

```json
{
  "success": true,
  "sources": [],
  "groups": [],
  "pm2Available": true
}
```

**SSE `/stream`:** `Content-Type: text/event-stream` — not compressed.

**PM2 restart response:**

```json
{ "success": true, "broom": true, "preparing": true }
```

`404 { "success": false, "error": "PM2 not available" }` means no PM2 log paths/process could be resolved for the current deployment.

---

## VFS (UUID path)

Base path: `/{vfsPathUuid}` from login response.

### `GET /{vfsPathUuid}/files/:fileId`

**Auth required.** Stream VFS blob by database file id.

**404:** `{ "success": false, "error": "File not found" }` or missing blob

### `GET /{vfsPathUuid}/system/:encodedKey`

**Auth required.** Stream a binary System/Cache file. Key is base64url-encoded `systemFileKey` (e.g. `cache:subdir/file.bin`).

**Success:** Binary stream with `Content-Disposition: attachment`

**Errors:** 400 invalid key, 404 not found / blocked path, 413 file exceeds 256 MB download limit

**Notes:** Read-only sessions allowed. Text/image cache files must use `vfs_read_system_file` preview instead.

### `GET /{vfsPathUuid}/previews/:fileId`

**Auth required.** Image preview for VFS file.

### `GET /{vfsPathUuid}/images/:filename`

**Auth required.**

| Query | Required | Description |
|-------|----------|-------------|
| `ws` | Yes | Workspace id — file must be in workspace files/scraps |

**Success:** PNG stream  
**Errors:** 400 missing ws, 403 access denied, 404 not found

---

## Android background notification

### `GET /android/background-notification`

**Auth required.** For Android WebView `AndroidBackgroundRefresh` polling.

**Response:**

```json
{
  "free": "120",
  "paid": "3400",
  "daysLeft": "14"
}
```

`daysLeft` may be `""` if subscription expiry unknown.

**500:** `{ "error": "Failed to load notification status" }`

See [docs/ANDROID_BRIDGE.md](../ANDROID_BRIDGE.md).

---

## Miscellaneous

### `GET /characters.json`

**Auth:** None — served by `express.static('public')` after route handlers. Not listed in `isProtectedResource()` (`web_server.js`); no session required.

Static character name list for the character search modal.

**Client:** `public/scripts/comp/characterSearchModal.js` (also used by WS `search_characters` flow for live search).

### `GET /protected/t5_tokenizer.json`

**Auth:** Required — path matches `isProtectedResource()` (`/protected/` prefix). `securityMiddleware` runs before static file serving and returns `403 { success: false, error: "Authentication required", code: "AUTH_REQUIRED" }` when `req.session.authenticated` is false.

Served from `public/protected/t5_tokenizer.json` via static middleware once authenticated.

**Client:** `public/scripts/appInitSteps.js` fetches during app init (after login cookie is present).

---

## Static files (public/)

`express.static('public')` serves CSS, JS, fonts, `sw.js`, etc.

Runtime assets may be transparently served from `.cache/runtime-assets/` at normal `/css/` and `/scripts/` URLs when not in dev mode.

**Auth:** Static files generally **unauthenticated** except routes registered before static middleware with auth.

---

## Error shape conventions

| Pattern | Example |
|---------|---------|
| JSON error | `{ "success": false, "error": "message" }` |
| Auth | `{ "error": "Authentication required" }` status 401 |
| Rate limit | 429 with `RATE_LIMIT_EXCEEDED` |

---

## REST vs WebSocket

| Prefer REST | Prefer WebSocket |
|-------------|------------------|
| Download image bytes | Generate, gallery list, metadata |
| Preset webhook `/preset/:uuid` | Interactive UI sync |
| Log SSE stream | Real-time gallery/workspace updates |
| SW manifest `OPTIONS /` | Everything else |

Most app features require WebSocket for parity.
