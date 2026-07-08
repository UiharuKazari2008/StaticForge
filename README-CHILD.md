# StaticForge Child Node Guide

Operational guide for running a **replicated child**, **ephemeral**, or freshly **bootstrapped** Dreamscape node that pairs with a master instance. For the main application overview, see [README.md](./README.md). For HTTP/WebSocket API details, see [docs/client-api/ws/replication.md](./docs/client-api/ws/replication.md).

---

## 1. Overview

Replication lets one **master** Dreamscape server own the canonical gallery, changelog, and configuration while **child** nodes generate locally and sync changes back.

| Role | Purpose | Full changelog sync | Upsert to master | Export cargo |
|------|---------|---------------------|------------------|--------------|
| **standalone** | Default — no replication | — | — | — |
| **master** | Canonical hub; creates separation bundles; receives upserts/imports | Coordinates child sync | Receives | Can import cargo |
| **child** | Long-lived paired replica (laptop, second PC) | Yes (`Sync`) | Yes | Yes |
| **ephemeral** | Phone, travel, temporary node | No | Yes | Yes |

**Connectivity** (`secure.config.json` → `replication.connectivity`):

| Mode | Master HTTP/WS | Peer TCP (`:9221`) | Delegated wiki/autocomplete |
|------|----------------|--------------------|-----------------------------|
| **normal** | Used for assets, sync, upsert | Used for fast cargo when reachable | Proxied via `masterWsUrl` when not cloned |
| **airgapped** | Not used at runtime | Not used | Unavailable — local clone only |
| **delegated-only** | WS delegation only | — | Same as normal for delegated packets |

Config lives in **`secure.config.json`** under the `replication` object (not `config.json`). The server auto-normalizes missing fields on boot via `replicationService.ensureReplicationConfig()`.

---

## 2. Prerequisites

### Software

| Requirement | Notes |
|-------------|-------|
| **Node.js** | Same major version as master (see repo `.nvmrc` if present) |
| **pnpm** | `pnpm install` from repo root |
| **tar** + **zstd** | Separation bundles and compressed cargo (`tape-stream-compressed`) |
| **PM2** (recommended) | `ecosystem.config.js` — process name `Dreamscape`, script `web_server.js` |

### Network

| Port | Service |
|------|---------|
| **9220** | HTTP + WebSocket (default; override in `config.json` → `port`) |
| **9221** | Replication peer TCP for bulk cargo (default; override `replication.masterPeerPort` on master) |

Ensure the child can reach the master's **9220** (HTTPS/WSS if terminated) and **9221** when using normal connectivity and peer upsert.

### Configuration files

| File | Replication fields |
|------|-------------------|
| `config.json` | `port`, `loginPin`, `apiKey` (NovelAI), etc. — shared operational config |
| `secure.config.json` | `replication.*` — role, tokens, URLs, clone profile |

Minimal child `secure.config.json` replication block (normally applied by bootstrap, not hand-edited):

```json
{
  "replication": {
    "role": "child",
    "connectivity": "normal",
    "instanceId": "<uuid>",
    "displayName": "my-laptop",
    "masterAccessUrl": "https://master.example:9220",
    "masterWsUrl": "wss://master.example:9220",
    "masterPeerHost": "master.example",
    "masterPeerPort": 9221,
    "replicationToken": "<hex-from-separation-manifest>",
    "cloneProfile": { "wikiData": true, "autoComplete": true, "previewCache": true, "imageMetadata": true },
    "transferMode": "tape-stream-compressed",
    "gallerySharedDefault": "manual"
  }
}
```

### Process management

```bash
# Install dependencies
pnpm install

# Start (foreground)
node web_server.js

# Or via PM2 (matches ecosystem.config.js)
pm2 start ecosystem.config.js
pm2 save
```

Access the UI at `http://<host>:9220` (or your configured port).

---

## 3. Connectivity modes — decision tree

```
Start: How will this node reach the master?
│
├─ Never online with master (USB transfer only)
│   └─ connectivity: airgapped
│       • Clone wiki/autocomplete in separation bundle
│       • Use Export cargo → manual transfer → master Import
│       • No shared remote gallery, no delegation
│
├─ Online sometimes; only need tag/wiki from master
│   └─ connectivity: delegated-only (or normal with minimal clone)
│       • Omit wikiData/autoComplete in clone → masterWsBridge delegates
│
└─ Regular LAN/VPN access to master
    └─ connectivity: normal
        • Prefer peer :9221 for Upsert cargo
        • gallerySharedDefault controls remote gallery merge
        • Full Sync available for child role only
```

---

## 4. First-time setup via DSAP (no shell)

Use the web **Data Management** DSAP applet (`data.mgmt.dreamscape.jp/replication`) — admin session required.

### On the master

1. Open **Data Management → Replication**.
2. **Create separation bundle** — pick clone profile flags, transfer mode, child display name.
3. Wait for job completion (writes locked during tar build — maintenance ticker).
4. Download **archive** (`.tar` or `.tar.zst`) and **manifest** JSON from the completion dialog links.

### Transfer to child machine

Copy both files via USB, SCP, or any file transfer. Airgapped setups stop here until the child is online with the files.

### On the child (blank install)

1. Install Dreamscape (clone repo, `pnpm install`, create `config.json` with NovelAI key and PINs).
2. Open **Data Management → Replication → Separation Bootstrap** panel (`replicationDsapSeparation.js`), or use the registration wizard in the Replication tab after first login.
3. Select **manifest.json** and **archive**.
4. Preview shows clone profile and entry counts.
5. Enter **confirm token** from manifest (`replicationToken` field).
6. **Apply bundle** — maintenance wraps apply; `secure.config.json` is written with `role: child`.

Alternatively, after bootstrap files are on disk:

- **Register as child** in the Replication tab: paste `masterAccessUrl`, `masterWsUrl`, peer host/port, and token from the manifest.

### Verify

- `GET /replication/status` or WS `replication_status` → `role: child`, `enabled: true`.
- Delegation section shows `wikiData` / `autoComplete` as `local` or `delegated`.
- Generate a test image; gallery shows local entries.

---

## 5. First-time setup via CLI

### Master: create separation bundle

Interactive clone matrix TUI:

```bash
node scripts/replication-separate.js
```

Non-interactive example:

```bash
node scripts/replication-separate.js \
  --child-name "travel-laptop" \
  --transfer-mode tape-stream-compressed \
  --set wikiData=1 \
  --set autoComplete=1 \
  --set previewCache=1 \
  --set workspaceImages=0 \
  --output-dir ./separation-out \
  --non-interactive
```

| Flag | Purpose |
|------|---------|
| `--live` | Initialize server stack; enter maintenance and broadcast progress |
| `--yes` | Skip blocks-mode slow-path prompt |
| `--set KEY=0\|1` | Clone profile toggle (see table §6) |

Outputs: `dreamscape-separation-<childInstanceId>.tar.zst` (or `.tar`) + sidecar manifest JSON in `--output-dir`.

HTTP equivalent: `POST /replication/separation/prepare` (admin session).

### Child: apply separation bundle

```bash
node scripts/replication-bootstrap.js \
  -i ./separation-out/dreamscape-separation-<uuid>.tar.zst \
  -m ./separation-out/dreamscape-separation-<uuid>.manifest.json \
  --root /path/to/dreamscape \
  --live
```

| Flag | Purpose |
|------|---------|
| `-t, --token` | Override confirm token (default: read from manifest) |
| `--live` | Broadcast maintenance to connected WS clients during apply |

HTTP/WS equivalent: `replication_separation_bootstrap_preview` then `replication_separation_bootstrap_apply`.

---

## 6. Clone profile reference

Separation **clone profile** flags control what is copied into the bundle. Contract defaults are in `modules/replication/replicationContracts.js` (`DEFAULT_CLONE_PROFILE`); separation adds `referenceBlobs` and `vfsUserFiles`.

| Key | Default | Contents | Notes |
|-----|---------|----------|-------|
| `workspaceImages` | false | `images/*.png` full gallery blobs | Large; usually master-served via shared gallery |
| `previewCache` | true | `.previews/`, `.cache/preview/` | WebP thumbnails |
| `imageMetadata` | true | `metadata.db` | **Auto-enabled** when `previewCache` is on and `workspaceImages` is off |
| `referenceBlobs` | false | `.cache/upload/`, `.cache/vibe/` | Reference library binaries |
| `vfsUserFiles` | false | `.cache/userFiles/` | VFS user uploads |
| `wikiData` | true | `tag_wiki.db`, `.cache/wiki/` | Tag wiki / Grimoire data |
| `wikiMedia` | false | Cached wiki images | Optional; increases bundle size |
| `autoComplete` | true | `tag_search.db`, dataset tag JSON, tag caches | Autocomplete service |

### Preview / metadata coupling

When **`previewCache: true`** and **`workspaceImages: false`** (typical child):

- `imageMetadata` is forced **true** so gallery rows reference previews that exist locally.
- Full PNGs are fetched from master via `GET /replication/assets/gallery-image/...` when shared gallery is on.
- Gallery `request_gallery` marks remote rows `storage: "remote"`; `assetUrlResolver.js` builds master URLs.

When **`workspaceImages: true`**:

- Child has local PNGs; shared gallery optional for images generated on other nodes.

---

## 7. Daily operation

### Generate

Works normally on child/ephemeral. Changelog hooks record workspace/metadata changes for later sync or upsert.

### Upsert (incremental cargo to master)

**Roles:** `child`, `ephemeral` (not `standalone`).

**Connectivity:** `normal` only (disabled in airgapped — use Export cargo).

1. **Data Management → Replication → Cargo → Upsert**, or:
   - `POST /replication/cargo/upsert/begin`
   - `POST /replication/cargo/upsert/send` (peer or HTTP stream)
   - `POST /replication/cargo/upsert/complete`
2. Child enters maintenance during export/send; master may enter maintenance during import.
3. Master merges changelog rows from cargo.

### Sync (full changelog pull — child only)

**Roles:** `child` only (`canRunReplicationAutoSync`).

1. **Data Management → Replication → Sync → Run**, or:
   - WS `replication_sync_begin` / `POST /replication/sync/begin`
   - Master partner routes: `/replication/sync/partner/begin` … `/complete` (token auth)
2. Poll `replication_sync_status` or `GET /replication/sync/status`.
3. On completion, server pushes `replication_sync_complete`.

Ephemeral nodes **never** run full auto-sync; use Upsert or Export cargo instead.

---

## 8. Ephemeral / phone workflow

Set `replication.role` to `ephemeral` (via config editor or DSAP). Typical flow:

1. **Generate** images locally on the phone/laptop.
2. **Export cargo** — DSAP Cargo panel or:
   ```bash
   node scripts/replication-export-cargo.js --out ./my-cargo.tar.zst
   ```
3. **Transfer** file to master network (USB, cloud, etc.).
4. **Master import** — DSAP Import or:
   ```bash
   node scripts/replication-import-cargo.js --archive ./my-cargo.tar.zst
   ```

No background sync; each export is an explicit handoff.

---

## 9. Transfer modes

| Mode | Description | Default |
|------|-------------|---------|
| `tape-stream-compressed` | Single `.tar.zst` stream | **Yes** |
| `tape-stream` | Uncompressed `.tar` | |
| `blocks` | Per-file JSON manifest — very slow for large galleries | Requires confirmation |

**Blocks confirmation** — exact string required as `blocksAck` in API body/query:

> Transforming cargo as Blocks (file-by-file) may be extremely slow for large galleries. Prefer Tape Stream (Compressed) unless you need a single file.

Surfaces:

| Surface | Behavior |
|---------|----------|
| DSAP cargo/sync panels | Confirmation dialog before selecting Blocks |
| CLI `replication-separate.js` | Prompt `SLOW` unless `--yes` |
| API | `GET /replication/cargo/blocks-warning`, `GET /replication/sync/blocks-warning` |

**Peer TCP** (`modules/replicationPeerServer.js`): `REPL_TAR_BEGIN` → raw bytes → `REPL_TAR_END` with SHA-256. Authenticated with `replicationToken` (cargo-write scope). Faster than HTTP PUT streaming on LAN.

**HTTP resumable stream**: `GET/PUT /replication/cargo/stream/:manifestId` with `Range` / `X-Cargo-Offset` headers.

---

## 10. Shared gallery

`replication.gallerySharedDefault` in `secure.config.json`:

| Value | Behavior |
|-------|----------|
| `manual` (default) | User toggles per session; preference in `localStorage` key `galleryShowSharedRemote` |
| `always` | Merge master gallery entries on every `request_gallery` |
| `never` | Local generations only |

### UI toggle

Right-click or long-press **gallery toolbar** (`#galleryToggleGroup`) → context menu icon **Show shared gallery** (cloud icon). Wired in `mainMenuManager.js`; visible when `isReplicationSharedGalleryMenuAvailable()` — any role with `masterAccessUrl` configured (including **standalone** with master access path) and not `airgapped`.

Admin can change default in **Data Management → Replication** (shared gallery dropdown).

### Client flow

1. `request_gallery` sends `galleryShowSharedRemote: true|false` (`assetUrlResolver.getGalleryReplicationRequestOptions()`).
2. Server (`120-galleryHandler.js`) merges remote metadata when enabled.
3. Response includes `replicationContext` and optional `replicationWarning`.
4. `replicationGalleryBanner.js` shows banner when master unreachable (child/ephemeral + normal only).

Remote image bytes: `GET {masterAccessUrl}/replication/assets/{kind}/{key}?token=...`

---

## 11. Delegated services

When clone profile omits local data, the child proxies reads to the master:

| Service | `cloneProfile` key | Delegated WS packets |
|---------|-------------------|---------------------|
| Wiki | `wikiData: false` | `search_tag_wiki`, `get_tag_wiki_page`, `resolve_grimoire_url`, `get_wiki_home`, `get_static_wiki_site_index`, `get_static_wiki_page` |
| Autocomplete | `autoComplete: false` | `search_tags`, `get_tag_autofill`, `search_characters`, `fetch_autofill_wiki_previews` |

**Client bridge:** `public/scripts/comp/masterWsBridge.js`

1. Fetches `GET /replication/delegation/bridge-config` at init.
2. Opens read-only WS to `masterWsUrl` via `authenticate_replication` + `replicationToken`.
3. Wraps `wsClient.sendMessage` to delegate allowed packets.
4. Reports state via `replication_delegation_status`.

**Server proxy:** `replication_delegate` packet (optional path when bridge runs server-side).

Set **`masterWsUrl`** explicitly when master WSS differs from HTTP origin (reverse proxy, TLS termination).

`connectivity: airgapped` → delegation status `unavailable`; clone required data in separation bundle.

---

## 12. Maintenance during operations

Both nodes may enter **replication maintenance** — writes blocked, status/progress pushes allowed.

| Operation | Who enters maintenance | `operation` value |
|-----------|------------------------|-------------------|
| Separation (bundle build) | Master | `separation` |
| Separation bootstrap | Child | `separation` / bootstrap apply |
| Full sync | Child + master (partner routes) | `sync` |
| Upsert export | Child | `upsert` |
| Upsert import | Master (if import owns lock) | `upsert-import` |
| Cargo import (HTTP) | Master | `import` |

**Blocked while active:**

- Destructive WS packets (`REPLICATION_DESTRUCTIVE_WS_PACKETS`)
- `configManager` saves
- HTTP cargo writes (except import stream owning the lock)

**Client UI:** WS push `replication_maintenance` → full-width ticker: *"Replication in progress — writes disabled"* (`130-replicationInbound.js`).

**Progress:** `replication_progress` push with `phase`, `current`, `total`, optional `path`.

---

## 13. Troubleshooting

### Gallery banner rules

Banner appears only when **all** of:

- Role is `child` or `ephemeral`
- `connectivity` is `normal` (not `airgapped`)
- `replicationWarning` present in gallery response (master unreachable)
- Hidden for `standalone`, `master`, and `airgapped`

Text format: `{masterDisplayName} is currently inaccessible — showing N local generation(s) only (M remote hidden)`.

### `REPLICATION_ASSET_UNAVAILABLE`

HTTP **404** from `GET /replication/assets/:kind/:key`:

- Asset not on master disk (deleted, never synced, or `workspaceImages` not cloned and file never upserted).
- Wrong `kind` (`gallery-image`, `gallery-preview`, `reference-preview`, `reference-upload`).
- Fix: run Upsert/Sync from child, or enable shared gallery after master has the file.

### Peer vs HTTPS

| Symptom | Check |
|---------|-------|
| Upsert hangs on send | Firewall on master **9221**; `masterPeerHost`/`masterPeerPort` match |
| Peer fails, HTTP works | Token mismatch; peer server not started (starts with replication stack) |
| Assets 403 | `X-Replication-Token` or `?token=` must match `replicationToken` |
| Delegation fails | `masterWsUrl` reachable; token valid; `authenticate_replication` allowed (critical WS) |
| Sync 401 on partner routes | `X-Replication-Token` header on `/replication/sync/export`, `/ack`, `/partner/*` |

### Maintenance stuck

Restart server after failed operation. Check logs for uncaught errors in `replicationCargoService` / `replicationSync`. `replication_sync_status` includes `maintenance` object.

### Role mismatch errors

`REPLICATION_ROLE_MISMATCH` — e.g. running Sync on ephemeral, or separation prepare on a child node.

---

## 14. Security

### Replication token

Generated at separation (32-byte hex). Stored in `secure.config.json` on child and listed in master's `replication.children[]`.

| Scope | Usage |
|-------|-------|
| **read** | `GET /replication/assets/*`, `GET /replication/gallery/workspace-files`, status probes with `X-Replication-Token` or `replicationReadToken` |
| **wiki** / **autocomplete** | `authenticate_replication` bridge to master WS |
| **cargo-write** | Peer TCP `:9221`, `POST /replication/sync/export`, `/ack`, `/partner/*` |

Same token value is used for all scopes today when `replicationReadToken` is omitted. Set optional `replicationReadToken` on the child for read-only asset/gallery browse while keeping `replicationToken` for cargo-write routes.

### Session vs token routes

| Auth | Routes |
|------|--------|
| Admin **session** (cookie / Bearer loginKey) | `/replication/cargo/*`, `/replication/sync/begin`, `/replication/separation/*` |
| **Replication token** | Partner sync, asset GET (without session), peer TCP |
| **Read-only session** | Cannot run destructive replication WS packets (`READONLY_RESTRICTED`) |

### Operational hygiene

- Treat `replicationToken` like a password — do not commit `secure.config.json`.
- Child bootstrap strips `sessionSecret` and `apiKeys` from master secure config copy; re-add NovelAI keys on child `secure.config.json` as needed.
- Use PIN login on both nodes; replication token does not grant admin UI access.
- Prefer HTTPS/WSS for `masterAccessUrl` / `masterWsUrl` when crossing networks.

---

## Related documentation

| Document | Contents |
|----------|----------|
| [docs/client-api/ws/replication.md](./docs/client-api/ws/replication.md) | WebSocket packets and pushes |
| [docs/client-api/rest-api.md](./docs/client-api/rest-api.md) | HTTP replication routes |
| [docs/client-api/feature-map.md](./docs/client-api/feature-map.md) | Feature → API matrix |
| [modules/replication/replicationContracts.js](./modules/replication/replicationContracts.js) | Source of truth for constants |
