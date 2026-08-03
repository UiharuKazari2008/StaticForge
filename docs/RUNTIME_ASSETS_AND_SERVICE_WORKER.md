# Runtime Assets and Service Worker Runbook

## Purpose

StaticForge serves web-client CSS and JavaScript through a runtime compilation layer so production clients receive minified assets without changing source paths in `public/`. The service worker cache manifest is built from the bytes the server actually serves, so cache refreshes stay aligned with the optimised files in `.cache/runtime-assets/`.

Use this runbook when changing files under `public/css/`, `public/scripts/`, `public/sw.js`, or the server code that builds service-worker manifests.

## Architecture

| Layer | Source of truth | Role |
|-------|-----------------|------|
| Source assets | `public/css/**/*.css`, `public/scripts/**/*.js` | Editable client source files |
| Runtime compiler | `modules/runtimeAssetCompiler.js` | Scans source assets, minifies CSS with Lightning CSS, minifies JS with Terser, and writes compiled copies |
| Runtime service | `modules/runtimeAssetService.js` | Coordinates compile runs, manifest refreshes, compile status, workspace CSS, and broadcasts |
| Static serving | `web_server.js` final static middleware | Serves optimised bytes before `express.static('public')` when available |
| Service worker | `public/sw.js`, `public/scripts/comp/serviceWorkerManager.js` | Downloads cache-manifest changes and applies safe updates |
| Admin triggers | `modules/ws/handlers/180-cacheHandler.js`, Unix socket CLI | Recompile, refresh hash cache, and notify connected clients |

Compiled assets live in `.cache/runtime-assets/` and keep the same web paths as their sources. For example:

```text
public/css/app.css
  -> .cache/runtime-assets/css/app.css
  -> served at /css/app.css

public/scripts/app.js
  -> .cache/runtime-assets/scripts/app.js
  -> served at /scripts/app.js
```

Do not edit `.cache/runtime-assets/` directly. The compiler rewrites those files and includes a header with the source path and source SHA-256 for skip detection.

## Request and cache flow

1. Server boot enters the `runtime_compile` readiness stage and runs `runtimeAssetService.compileOnBoot()`.
2. `OPTIONS /` returns `503` while `runtimeCompileComplete === false`; `OPTIONS /status` reports `runtimeCompileComplete` and `runtimeCompile`.
3. After compile, `initializeCacheData(true)` scans `public/`.
4. For `/css/` and `/scripts/` entries, `buildServiceWorkerCacheManifest()` hashes the file that will be served to clients: the compiled copy when present, otherwise the source file.
5. Runtime-managed requests are intercepted before `express.static('public')`.
6. Responses include `X-StaticForge-Runtime-Asset: optimized` when the compiled copy is served, or `source` when source is served.
7. Service-worker clients compare the manifest from `OPTIONS /` with their cache and download changed files.

The service worker does not need to know whether a path came from source or `.cache/runtime-assets/`; it receives the normal `/css/...` and `/scripts/...` URLs with hashes from served bytes.

## Compile triggers

| Trigger | Entry point | Broadcasts manifest? | Notes |
|---------|-------------|----------------------|-------|
| Server boot | `runtimeAssetService.compileOnBoot()` in `web_server.js` | No | Blocks `OPTIONS /` until complete. Compile errors keep prior optimised copies when available. |
| Deploy/client edit notification | `bash scripts/notify-service-worker-update.sh` | Yes | Recompile + refresh + broadcast through `/tmp/staticforge_mcp.sock` by default. |
| Restart deploy | `bash scripts/notify-service-worker-update.sh --restart` | Yes | Runs `pm2 flush`, `pm2 reset`, `pm2 restart`, waits for `OPTIONS /status`, then broadcasts. |
| Admin WebSocket | `recompile_runtime_assets` | Yes | Admin-only, destructive packet in `modules/ws/handlers/180-cacheHandler.js`. |
| Legacy/admin cache refresh | `refresh_server_cache` | Yes | Also recompiles runtime assets before refreshing the cache manifest. |
| Auto recompile | `runtimeAssets.autoRecompile: true` | Yes, when a request recompiles a stale file | Checks source hashes on runtime-managed CSS/JS requests. Default is off. |

## Developer workflow after client-side edits

After changing files under `public/css/` or `public/scripts/`, notify the running server:

```bash
bash scripts/notify-service-worker-update.sh
```

If the change also requires a server restart:

```bash
bash scripts/notify-service-worker-update.sh --restart
```

Useful flags and environment variables:

| Option | Purpose |
|--------|---------|
| `--silent` | Broadcast a silent update to connected clients. |
| `--json` | Print script result as JSON. |
| `STATICFORGE_SOCKET_PATH` | Override Unix socket path. Default: `/tmp/staticforge_mcp.sock`. |
| `STATICFORGE_HTTP_PORT` | Port used by `--restart` readiness probe. Default: `9220`. |
| `STATICFORGE_PM2_TARGET` | PM2 process id/name restarted by `--restart`. Default: `12`. |

The notify script always asks the server to recompile runtime assets, refresh hash data, and broadcast the updated manifest. There is no hash-only mode.

## Configuration and debug bypasses

Runtime asset config in `config.json`:

```json
{
  "runtimeAssets": {
    "autoRecompile": false
  }
}
```

`autoRecompile: true` is useful for live development on a running server, but it adds a source-hash check to each runtime-managed CSS/JS request. Keep it off for normal production use and prefer explicit deploy notifications.

Serve source files instead of optimised copies for a request by using one of these debug bypasses:

| Bypass | Example |
|--------|---------|
| Query | `/scripts/app.js?sf_debug=1` or `/scripts/app.js?debug=1` |
| Header | `X-StaticForge-Debug: 1` or `X-StaticForge-Debug: true` |
| Cookie | `staticforge_dev_mode=1` |

## Operational checks

Check server readiness and compile status:

```bash
curl -X OPTIONS http://127.0.0.1:9220/status
```

Expected fields include:

```json
{
  "isReady": true,
  "runtimeCompileComplete": true,
  "runtimeCompile": {
    "complete": true,
    "inProgress": false,
    "failedCount": 0,
    "stats": {
      "totalFiles": 0,
      "compiledFiles": 0,
      "bytesSaved": 0,
      "percentBytesSaved": 0
    }
  },
  "runtimeAutoRecompile": false
}
```

Check whether a request is served from the compiled cache:

```bash
curl -I http://127.0.0.1:9220/css/app.css
```

Look for `X-StaticForge-Runtime-Asset: optimized`. If the header is `source`, either the compiled file is missing, a debug bypass is active, or the source path is not runtime-managed.

## Troubleshooting

### `OPTIONS /` returns 503 with `Runtime assets are compiling`

Use `OPTIONS /status` until `runtimeCompileComplete` is true. During boot, `OPTIONS /` intentionally waits for runtime compilation so service-worker clients do not cache stale hashes.

### Clients do not download updated CSS or JS

Run:

```bash
bash scripts/notify-service-worker-update.sh
```

Boot-time compilation refreshes server-side hash data but does not broadcast an update to already connected clients. The notify script performs the recompile, manifest refresh, and WebSocket broadcast together.

### Compile reports failures

Runtime compile failures are recorded in the `runtimeCompile.errors` status payload and broadcast through `runtime_compile_error`. The server keeps running. Fix the source file listed in the error, then run the notify script again.

Common failure sources:

- CSS syntax errors or unmatched braces.
- Orphaned indented `:hover` blocks at the end of a CSS file.
- JavaScript that minifies but fails the post-minify syntax check.

### Admin Log Viewer streams or PM2 routes are stale

`public/sw.js` intentionally bypasses UUID log-viewer API routes for `/stream`, `/backlog`, `/sources`, and `/pm2/*`. If these responses appear cached, verify the request path matches `/{logViewerPathUuid}/...` and that the current `public/sw.js` is active.

## Source map

| Concern | Source |
|---------|--------|
| Compile roots and output path | `modules/runtimeAssetCompiler.js` |
| Post-compile actions and status shape | `modules/runtimeAssetService.js` |
| Manifest hashing and static-serving interception | `web_server.js` |
| Unix socket notify path | `scripts/service-worker-cache-socket.js` |
| Shell wrapper and PM2 restart workflow | `scripts/notify-service-worker-update.sh` |
| WebSocket admin packets | `modules/ws/handlers/180-cacheHandler.js` |
| Client update UX | `public/scripts/comp/serviceWorkerManager.js` |
| Service-worker cache strategies | `public/sw.js` |
