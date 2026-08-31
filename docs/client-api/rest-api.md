# REST API

HTTP routes defined in `web_server.js` and static middleware. Default base: `http://<host>:9220`.

**Authentication:** Unless noted, routes use `authMiddleware` — session cookie or `Authorization: Bearer <loginKey>` / `?auth=`. See [authentication.md](./authentication.md).

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
10. [Public MCP / Grok connector (UUID path)](#public-mcp--grok-connector-uuid-path)
11. [VFS (UUID path)](#vfs-uuid-path)
12. [Android background notification](#android-background-notification)
13. [Miscellaneous](#miscellaneous)
14. [Replication](#replication)
15. [Static files (public/)](#static-files-public)

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

### `GET /agent`

**Auth:** Development auth. Every request requires a direct loopback TCP peer
and `enable_dev`. Accepts an application key (`X-StaticForge-App-Key: sfapp_...`
or `Authorization: Bearer sfapp_...`) **or** `Authorization: Bearer <devLoginKey>`
(`?auth=` fallback). No `loginKey` is required. Loopback application-key
validation skips User-Agent match and allows a past `refreshBeforeAt`.
Existing PIN sessions do not bypass these checks. Forwarded client-address
headers are ignored. Remote peers still receive `403`.

Creates a persisted `dev_admin` session and returns a no-store bootstrap page.
The bootstrap unregisters existing workers, fetches `GET /agent/assets.json`,
preloads the app-shell CSS/JS URLs into the browser HTTP cache (parallel
`fetch`, eight at a time, 45s cap), then replaces the location with
`/app?agent=1`. The fresh agent page then deletes Cache Storage. This ordering
also handles browsers still controlled by an older Dreamscape worker without
deleting caches during its final navigation. Remote requests receive `403`, even
with a valid key or a spoofed loopback `X-Forwarded-For`; missing development
configuration returns `404` or `500`; missing or invalid credentials return
`401` or `403`.

When `enable_dev` is true but `secure.config.json:devLoginKey` is absent, the
`500` response includes `code: "DEV_LOGIN_KEY_NOT_CONFIGURED"` and the expected
config path. It never includes the configured or supplied credential.

SSH local forwarding to server-side `127.0.0.1:9220` remains compatible because
the tunnel connection appears as a direct loopback peer on the Dreamscape host.

The redirected app session disables service-worker registration and clears
existing Cache Storage before normal application boot. App-shell CSS/JS for
that `dev_admin` session use `private, max-age=120` so the bootstrap preload
can stick.

### `GET /agent/assets.json`

**Auth:** Loopback + `enable_dev`, then either a `dev_admin` session cookie
(created by `GET /agent`) **or** the development key (`Authorization: Bearer`
preferred, `?auth=` fallback). Existing PIN `admin` sessions do not qualify.
`GET /agent` itself still requires the key on every request.

**Success:** JSON catalog of the service-worker asset list plus app-shell boot
URLs parsed from `public/app.html` (`<script src>` and `rel=stylesheet`).

```json
{
  "success": true,
  "hash": "<sha256 of url+hash rows>",
  "count": 890,
  "bootCount": 210,
  "bytes": 12345678,
  "boot": ["/css/app.css?sha=…", "/scripts/comp/fatalErrorBootstrap.js"],
  "files": [{ "url": "/scripts/comp/foo.js", "hash": "…", "size": 1234, "boot": true }]
}
```

`boot` is the exact URL list the `/agent` page preloads (including stylesheet
`?sha=` query strings so HTTP cache keys match `app.html`).

### `GET /agent/assets.zip`

**Auth:** Same as `GET /agent/assets.json`.

**Success:** `200 application/zip` named `dreamscape-assets.zip`. Entry paths are
web paths without a leading slash (plus `agent-assets.json` mapping `path` →
`url` / `hash`). Bytes are the files actually served (optimised runtime assets
when compiled). `ETag` is the catalog hash. Intended for tools that want one
download; the `/agent` bootstrap does **not** unzip this in the browser because
Cache Storage cannot satisfy `<script src>` without a service worker.

### `POST /agent/broadcast`

**Auth:** Same as `GET /agent` — loopback + `enable_dev`, then application
key (`X-StaticForge-App-Key` / Bearer `sfapp_`) or `devLoginKey`. Existing
PIN sessions do not bypass these checks. Forwarded client-address headers are
ignored.

Broadcasts a notice to every connected WebSocket client so a local agent can
warn users before a restart or other disruptive action. Clients render it as a
glass toast or a confirmation dialog.

**Inputs:** JSON body.

| Field | Required | Description |
|-------|----------|-------------|
| `message` | Yes | Plain-text body. Max 2000 characters. HTML (`<` / `>`) is rejected. |
| `title` | No | Dialog/toast title. Default `Agent`. Max 120 characters. Plain text. |
| `display` | No | `toast` (default) or `dialog`. Aliases: `mode`, and `popup` / `window` → dialog. |
| `level` | No | `info`, `warning` (default), `error`, or `success`. Alias: `type`. |
| `timeout` | No | Milliseconds, or `false` / `"persist"` to keep it until dismissed. Toast default `10000`. Dialog default stays until OK. Max 300000. |

**Success:** `200`

```json
{
  "success": true,
  "id": "<uuid>",
  "display": "dialog",
  "level": "warning",
  "title": "Agent",
  "timeout": false,
  "clients": 2
}
```

`clients` is the current WebSocket connection count (0 if the socket server is
not up yet). The push type is `agent_notice`.

**Errors:** `400` validation (`{ "success": false, "error": "…" }`); `401` /
`403` / `404` / `500` from development auth (same as `GET /agent`); `500`
`{ "success": false, "error": "Failed to broadcast notice" }` if publish fails.

**Client state after:** Connected web clients show a toast (`showGlassToast`) or
an OK confirmation dialog (`showConfirmationDialog`).

**Follow-up:** None. The notice is fire-and-forget; the HTTP response does not
wait for users to dismiss the UI.

### `GET /agent/clients`

**Auth:** Same as `GET /agent` — direct loopback TCP peer, `enable_dev`, and
either `X-StaticForge-App-Key: sfapp_...` / Bearer `sfapp_` or
`Authorization: Bearer <devLoginKey>` (`?auth=` fallback). No `loginKey`
required. Existing PIN sessions do not qualify. Forwarded address headers are
ignored.

Lists currently connected WebSocket clients so a localhost agent can pick
Yukimi's Studio tab. Ivory / Menma should use loopback + application key or Bearer, not the PIN
pad. This is not a public UI route.

**Success:** `200`

```json
{
  "success": true,
  "boundClientId": "a1b2c3d4e5f6",
  "clients": [
    {
      "clientId": "a1b2c3d4e5f6",
      "userType": "admin",
      "workspaceId": "default",
      "connectedAt": "2026-08-29T08:00:00.000Z",
      "userAgent": "Mozilla/5.0 ...",
      "bound": true,
      "authenticated": true
    }
  ]
}
```

`boundClientId` is `null` when nothing is bound. Share codes are never returned
or logged.

**Errors:** `401` / `403` / `404` / `500` from development auth (same as
`GET /agent`).

### `POST /agent/bind`

**Auth:** Same as `GET /agent`.

Binds the localhost agent to one connected Studio client. Only one bind at a
time; a new bind unbinds the previous tab (`agent_session_unbound`).

**Inputs:** JSON body — one of:

| Field | Required | Description |
|-------|----------|-------------|
| `clientId` | one of | Id from `GET /agent/clients` |
| `code` | one of | 6-character share code from `session_share_start` / `session_share_code_response` (console or agent; no UI) |

**Success:** `200` `{ "success": true, "clientId", "bound": true, "userType", "workspaceId" }`

**Errors:** `400` missing `clientId`/`code`; `404` unknown client or expired
code; development-auth errors as `GET /agent`.

**Client state after:** Bound tab receives `agent_session_bound`. Previous bound
tab receives `agent_session_unbound`.

### `GET /agent/scopes`

**Auth:** Same as `GET /agent`. No bind required.

Returns the named-scope catalog and the current key's scopes. Development-key
auth is treated as `universal`. When the key has `vfs` or `universal`, also
returns `vfsPathUuid` for `/{vfsPathUuid}/…` REST.

**Success:** `200`

```json
{
  "success": true,
  "scopes": ["gallery", "workspace", "search", "infrastructure", "generation", "vfs", "autofill"],
  "catalog": [{ "id": "autofill", "label": "Autofill / Grimoire", "description": "…" }],
  "vfsPathUuid": "6f418b0a-b8b5-4dcf-8565-c455d81ed7e9"
}
```

Do not log the application key. `autofill` is ranking + Grimoire / tag wiki, not `search`.

### `POST /agent/packet`

**Auth:** Same as `GET /agent`. No bind required.

Dispatches a registered WebSocket packet through the same server handlers as a
Yukimi session. App keys may only call packets listed on a scope they hold
(`generation`, `vfs`, `autofill`, `search`, …). Unscoped packets require
`universal`. Not a silent universal grant.

**Inputs:**

| Field | Required | Description |
|-------|----------|-------------|
| `type` | yes | WS packet name (`get_autofill_ranking`, `search_tag_wiki`, `generate_image`, `vfs_list`, …) |
| `data` | no | Fields merged onto the packet (same as WS body) |
| other keys | no | Treated as packet fields (same as WS) |

**Success:** `200` `{ "success": true, "type": "<response type>", "data", "reply", "replies", "requestId" }`

**Errors:** `400` missing `type`; `403` `INSUFFICIENT_SCOPE` / `READONLY_RESTRICTED`;
`404` unknown packet; `503` handlers not ready; development-auth errors as
`GET /agent`.

**Follow-up:** Ranking / wiki / generate / VFS use this. VFS blobs stay on
`GET /{vfsPathUuid}/files/:fileId` when the key has `vfs`.

### `POST /agent/session/open-image`

**Auth:** Same as `GET /agent`. Requires a live bind.

**Inputs:** `{ "filename": "<gallery filename>" }`

Sends `agent_session_command` `open_image` to the bound client. The tab opens
Studio via `openManualModalWithContent({ type: "image", image })`.

**Success:** `200` `{ "success": true, "ok": true, "filename" }`

**Errors:** `400` missing filename; `404` no bound client; `504` client did not
reply; development-auth errors as `GET /agent`.

### `POST /agent/session/studio`

**Auth:** Same as `GET /agent`. Requires a live bind.

Applies a studio change on the bound tab using the existing change helper
(`dreamscape:"change"`, `v:1`; characters always replace+index).

**Inputs:** JSON body — one of `change` / `prompt`+`uc` / the body itself as a
studio change payload, plus two **sibling** bools (not inside Change-JSON):

| Field | Required | Description |
|-------|----------|-------------|
| `change` | one of | Studio change object or JSON string |
| `prompt` / `uc` | one of | Wrapped into a replace-fields change JSON |
| body itself | one of | A studio change payload (`dreamscape:"change"`) |
| `autoApply` | no | Default `true`. `true`: silent apply — bound tab awaits `applyStudioChangePayloadSilent` (no confirm dialog; Studio opens like open-image) then returns. `false`: do not apply. |
| `autoGenerate` | no | Default `false`. After a successful apply, click the bound tab's existing Generate button (`#manualGenerateBtn`). Uses Yukimi's bound session. Not a server-side generate. HTTP does not wait for generation. |

`autoGenerate: true` with `autoApply: false` is `400`
(`autoGenerate requires autoApply`) at top level or inside `change`
(object or parsed JSON string; on `change` or `change.fields`).
Flags inside `change` that are not siblings of `change` are `400`
(`autoApply/autoGenerate must be siblings of change, not inside change`)
before `sendBoundCommand` (no client apply, no 504).

**Success:** `200` `{ "success": true, "ok": true, "applied": true, "autoApply": true, "autoGenerate": false }` — plus `generateStarted` when `autoGenerate` was true.

**Errors:** `400` no change/prompt/uc, or `autoGenerate` without `autoApply`;
`404` unbound; `504` no reply; development-auth errors as `GET /agent`.

### `POST /agent/session/update`

**Auth:** Same as `GET /agent`. Requires a live bind.

Pushes the **bound Dreamscape tab** to check for client/app updates, apply them, then restart **that client**. Not a server-side restart. Not `POST /agent/broadcast` (that is a notice to every connected socket).

The bound tab shows a mandatory Client Update dialog (classic confirmation / System Update chrome): 15 second countdown, Cancel aborts (no apply, no restart), no input at 0 applies then restarts. Close stays disabled.

**Inputs:** empty JSON body (`{}`) is fine.

**Success:** `200`

```json
{ "success": true, "ok": true, "cancelled": false, "applying": true, "applied": true, "restart": true }
```

Cancel before 0:

```json
{ "success": true, "ok": true, "cancelled": true, "applied": false, "restart": false }
```

A second push while the dialog is already counting or applying:

```json
{ "success": true, "ok": true, "alreadyShowing": true, "cancelled": false, "applying": false }
```

The HTTP response waits until Cancel or countdown 0 (about 20s). Apply+restart starts after the bound tab replies.

**Errors:** `404` unbound; `504` no reply; development-auth errors as `GET /agent`.

**Client state after:** Bound tab shows the dialog. On apply, that tab checks the service-worker manifest, downloads, and reloads.

**Follow-up:** None. Consume from loopback with the existing app key.

### `GET /agent/session/state`

**Auth:** Same as `GET /agent`. Requires a live bind.

Asks the bound client for a session snapshot. Includes the **ungenerated Studio
editor** as Change-JSON v1 in `change` so Ivory can rewrite it and
`POST /agent/session/studio`. No open image / filename is required.

**Success:** `200`

```json
{
  "success": true,
  "workspaceId": "default",
  "filename": null,
  "model": "v5",
  "clientId": "a1b2c3d4e5f6",
  "bound": true,
  "change": {
    "dreamscape": "change",
    "v": 1,
    "params": {},
    "fields": [
      { "id": "prompt", "action": "replace", "chunks": [{ "name": "Prompt", "text": "" }] },
      { "id": "uc", "action": "replace", "chunks": [{ "name": "UC", "text": "" }] }
    ]
  }
}
```

`change` keys (omit unused): `dreamscape`, `v`, `title`, `params`, `fields`,
`characters`, `expanders`, `vibes`. `fields` always includes `prompt` and `uc`
(empty text when the editor is blank). Characters are replace+index (no add).
Optional per-character `position` (`{x,y}` and/or `cell` A1–E5) is echoed when
the Studio slot has stored coords. `params.seed` is the actual seed that was
used; `params.seedLock` is the existing Studio sprout lock (`true` = reuse last
seed, `false` = roll a new variation). `seed: "last"` is the same as
`seedLock: true`. Filename `_generated_<seed>.png` is not a contract. Same
contract as
[studio-change-json.md](../studio-change-json.md). Also echoes `scopes` (the
app key's named scopes; development key is `["universal"]`) and `vfsPathUuid`
when the key has `vfs`. Do not log live prompt/uc text.

If the tab does not reply in time, the server still returns `200` with
`partial: true` and the server-known `workspaceId` / `clientId` (`filename`,
`model`, and `change` may be null).

**Errors:** `404` unbound; development-auth errors as `GET /agent`.

**Follow-up:** Rewrite `change` and `POST /agent/session/studio`. See
[agent-session.md](./agent-session.md).

### `OPTIONS /app`

Session validation + server version. **Auth required.**

Response fields: `success`, `message`, `timestamp`, `serverVersion`, `versionMessage`, `userType`, `vfsPathUuid`, `logViewerPathUuid` (admin).

### `GET /app`

Serves main app shell (`public/app.html`). **No auth on GET** (app bootstraps auth client-side).
With `?agent=1`, the HTML response receives explicit no-store headers and the
client starts in browser-agent mode (no service worker). CSS/JS requested
during that `dev_admin` session may use a 120-second private HTTP cache after
`/agent` preload.

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
| `variety` | bool | V4.5 Variety+ only (`skip_cfg_above_sigma`). Ignored when `model-features.json` `varietyPlus` is false (V5 Full/Curated). |
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
| POST | `/{uuid}/pm2/restart` | Body `{ broom?: boolean }` — async DSS restart |
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

---

## Public MCP / Grok connector (UUID path)

Base path: `/{mcpPathUuid}` from `secure.config.json` (auto-generated on first boot). Unlisted. Not `vfsPathUuid` or `logViewerPathUuid`. Not `/mcp` on the public root.

Full contract: [mcp-connector.md](./mcp-connector.md).

**Auth:** `createMcpAuthMiddleware` — per-agent `sfapp_` Bearer /
`X-StaticForge-App-Key` **or** OAuth `Bearer mcoat_…`. Exact UA is preferred
for static app keys; unknown UA is **bypassed + captured** in
`application_user_agents_seen`. No PIN / `loginKey` / `devLoginKey` / temp
`sftok_…` / query auth for MCP calls. Dedicated rate limit. CORS locked.

OAuth discovery lives at the domain root and points back to UUID-prefixed
authorization endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/oauth-protected-resource` | Protected resource metadata (`resource`, `authorization_servers`, supported/recommended scopes) |
| GET | `/.well-known/oauth-authorization-server` | Authorization server metadata (`issuer`, authorize/token/register endpoints, `S256` PKCE) |

The MCP endpoint's 401 response includes:

```http
WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource"
```

| Method | Path | Description |
|--------|------|-------------|
| POST | `/{uuid}` | Streamable HTTP JSON-RPC (`initialize`, `tools/list`, `tools/call`) |
| POST | `/{uuid}/mcp` | Same handler |
| OPTIONS | same | CORS preflight |
| GET | same | `405` |

OAuth endpoints:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/{uuid}/oauth/register` | Dynamic client registration; optional `application_key` binding |
| GET | `/{uuid}/oauth/authorize` | Consent page; requires `response_type=code`, `client_id`, registered `redirect_uri`, and `code_challenge` |
| POST | `/{uuid}/oauth/authorize` | PIN gate, key pick/create, approve/deny |
| POST | `/{uuid}/oauth/token` | `authorization_code` + PKCE exchange or `refresh_token` grant |

Tools wrap existing `/agent/packet`, `/agent/clients`, `/agent/bind`, `/agent/session/studio`. Named scopes. No parallel generate API.

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

### `GET /protected/qwen35_tokenizer.def`

**Auth:** Required — same `/protected/` session/application authentication as the T5 asset.

Returns NovelAI's raw-deflate Qwen BPE definition. The server downloads it from the versioned upstream tokenizer URL on first use, validates it with `fflate`, and caches it under `.cache/tokenizers/`.

**Success:** `200 application/octet-stream`; private browser cache for seven days.

**Errors:** `502 { error: "Qwen tokenizer asset is unavailable" }` when the upstream asset cannot be fetched or validated.

**Client:** `public/protected/qwen-tokenizer.js` loads this asset only when a model with `tokenizer: "qwen"` is selected.

### `GET /protected/fflate.js`

**Auth:** Required. Serves the installed `fflate` browser build used to decode tokenizer definitions.

---

## Replication

Routes registered by `modules/replication/registerRoutes.js` from `modules/replication/routes/*.js`. Operational guide: [README-CHILD.md](../../README-CHILD.md). WS mirror: [ws/replication.md](./ws/replication.md).

Config domain: `secure.config.json` → `replication` (see `modules/replication/replicationContracts.js`).

### `GET /replication/status`

**Auth:** session (admin or readonly)

**Success:** `{ success: true, data: { enabled, role, connectivity, instanceId, displayName, maintenance, delegation, cloneProfile, … }, timestamp }`

Same payload as WS `replication_status` → `data` field.

---

### Separation (`20-separationRoutes.js`)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/replication/separation/prepare` | admin session | Body: `cloneProfile`, `transferMode`, `childDisplayName`, `childInstanceId`, `masterAccessUrl`, `masterWsUrl`, `masterPeerHost`, `masterPeerPort`, `connectivity`, `outputDir` → **202** `{ jobId }` |
| `GET` | `/replication/separation/status/:jobId` | session | Job progress object |
| `GET` | `/replication/separation/manifest/:manifestId` | session | Manifest JSON |
| `GET` | `/replication/separation/download/:manifestId` | admin session | Tar/tar.zst attachment stream |
| `POST` | `/replication/separation/bootstrap/preview` | admin session | Body: `{ manifestPath, archivePath }` → preview |
| `POST` | `/replication/separation/bootstrap/apply` | admin session | Body: `{ manifestPath, archivePath, confirmToken }` — destructive |

**Errors:** `409` + `REPLICATION_MAINTENANCE` when maintenance already active.

---

### Assets (`30-assetRoutes.js`)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `OPTIONS` | `/replication/assets/:kind/:key(*)` | none | CORS preflight |
| `HEAD` | `/replication/assets/:kind/:key(*)` | session **or** `X-Replication-Token` | Asset metadata |
| `GET` | `/replication/assets/:kind/:key(*)` | session **or** token / `?token=` | Binary asset |

**Kinds:** `gallery-image`, `gallery-preview`, `reference-preview`, `reference-upload`

**404:** `{ success: false, code: "REPLICATION_ASSET_UNAVAILABLE", error, kind, key }`

CORS echoes `Origin` on asset routes only.

---

### Gallery (`35-galleryRoutes.js`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/replication/gallery/workspace-files` | session, application key/temp token, or `X-Replication-Token` with `read` scope | Local/master filename list for one workspace/view |
| `GET` | `/replication/gallery/remote` | none locally; proxy request to master uses configured read token | Child-side proxy to the configured master's workspace file list |

Query fields on both routes:

| Field | Default | Values |
|-------|---------|--------|
| `workspaceId` | `default` | Any configured workspace id |
| `viewType` | `images` | `images`, `scraps`, `pinned` |

`workspace-files` responds with:

```json
{
  "success": true,
  "data": {
    "workspaceId": "default",
    "workspaceName": "Default",
    "viewType": "images",
    "files": ["123_generated.png"]
  },
  "timestamp": "<ISO-8601>"
}
```

`remote` requires `replication.masterAccessUrl`, blocks `airgapped`
connectivity, probes the master first, then calls the master's
`/replication/gallery/workspace-files` endpoint.

---

### Cargo (`40-cargoRoutes.js`)

**Auth:** admin session for all routes below.

| Method | Path | Body / query | Purpose |
|--------|------|--------------|---------|
| `GET` | `/replication/cargo/transfers` | — | Active transfers + peer sessions |
| `POST` | `/replication/cargo/export` | `operation`, `transferMode`, `blocksAck` | Start export → `manifestId`, `streamUrl` |
| `GET` | `/replication/cargo/stream/:manifestId` | `Range`, `X-Cargo-Offset` | Download cargo bytes (**206** partial) |
| `PUT` | `/replication/cargo/stream/:manifestId` | raw bytes, `X-Cargo-Offset` | Upload cargo chunk |
| `POST` | `/replication/cargo/import/begin` | `transferMode`, `blocksAck`, `operation` | Start import |
| `POST` | `/replication/cargo/import/complete` | `manifestId`, `streamSha256?` | Finalize import |
| `POST` | `/replication/cargo/upsert/begin` | `partnerInstanceId?`, `transferMode`, `blocksAck` | Start upsert |
| `POST` | `/replication/cargo/upsert/send` | `transferMode`, `blocksAck` | Send to master (peer/HTTP) |
| `POST` | `/replication/cargo/upsert/complete` | — | Exit upsert maintenance |
| `DELETE` | `/replication/cargo/transfer/:manifestId` | — | Cancel transfer |
| `GET` | `/replication/cargo/blocks-warning` | — | `{ confirmation: "<blocks string>" }` |

**Maintenance:** `PUT` stream returns **423** + `REPLICATION_MAINTENANCE` when write-blocked (except import owning lock).

---

### Sync (`50-syncRoutes.js`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/replication/sync/status` | session | Sync phase + maintenance snapshot |
| `POST` | `/replication/sync/begin` | admin session | Begin full sync (`transferMode`, `blocksAck`) — **child role** |
| `POST` | `/replication/sync/export` | `X-Replication-Token` | Master: export changelog for `childInstanceId`, `sinceLsn` |
| `POST` | `/replication/sync/ack` | token | Master: apply ack from child `changes[]` |
| `POST` | `/replication/sync/partner/begin` | token | Master enters partner maintenance |
| `POST` | `/replication/sync/partner/complete` | token | Master completes partner sync (`maxLsn`) |
| `GET` | `/replication/sync/blocks-warning` | session | Blocks confirmation string |

Token header: `X-Replication-Token` (or body/query `replicationToken`).

---

### Delegation (`60-delegationRoutes.js`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/replication/delegation/bridge-config` | session | `masterWsUrl`, `replicationToken`, `cloneProfile`, `gallerySharedDefault` for client bridge |
| `GET` | `/replication/delegation/status` | session | Bridge snapshot + `delegation` status |

---

### Peer TCP (not HTTP)

Default port **9221** — `modules/replicationPeerServer.js`. Token auth; `REPL_TAR_BEGIN` / stream / `REPL_TAR_END`. Used by upsert send when peer reachable.

---

## Static files (public/)

`express.static('public')` serves CSS, JS, fonts, `sw.js`, etc.

Runtime assets may be transparently served from `.cache/runtime-assets/` at normal `/css/` and `/scripts/` URLs when not in dev mode.

**Auth:** Static files generally **unauthenticated** except routes registered before static middleware with auth.

**Cache-Control:** default is no-store. `dev_admin` sessions (`GET /agent`) receive
`private, max-age=120` on those static CSS/JS/image responses so the `/agent`
preload can populate the browser HTTP cache before `/app?agent=1` runs. The
`/app` HTML document itself stays no-store when `?agent=1`.

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
