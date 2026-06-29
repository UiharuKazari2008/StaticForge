# Runtime Assets and Service Worker Updates

## Overview

StaticForge serves optimized JavaScript and CSS at the same URLs used by the
source files. The server compiles files from `public/css/` and
`public/scripts/` into `.cache/runtime-assets/`, serves those compiled bytes in
production mode, refreshes the service worker manifest hashes, and broadcasts
cache updates to connected clients.

The service worker does not know about the compiled output directory. It only
receives normal public URLs such as `/css/app.css` or
`/scripts/comp/serviceWorkerManager.js` and compares the hashes in the manifest
against its static cache.

## Codepath map

| Layer | Files | Responsibility |
|---|---|---|
| Compiler | `modules/runtimeAssetCompiler.js` | Scans managed roots, minifies CSS with Lightning CSS, minifies JavaScript with Terser, writes `.cache/runtime-assets/` files with source-hash headers. |
| Service wrapper | `modules/runtimeAssetService.js` | Runs boot compiles, refreshes server hash cache, updates stylesheet `?sha=` links, broadcasts compile progress/errors/completion. |
| Server routes and serving | `web_server.js` | Gates `OPTIONS /` while boot compile is running, builds the service worker manifest, serves optimized assets before `express.static`, and exposes the Unix socket command. |
| Admin WebSocket | `modules/websocketHandlers.js`, `public/scripts/websocket.js` | Handles `recompile_runtime_assets`, `refresh_server_cache`, and runtime compile status broadcasts for admin clients. |
| Service worker client | `public/scripts/comp/serviceWorkerManager.js` | Checks manifests, downloads changed static files, applies CSS/apply-safe updates, and prompts for restart when scripts or route assets changed. |
| Admin UI | `public/scripts/comp/logViewerApplet.js`, `public/scripts/comp/serverManagement.js` | Shows runtime asset status, progress, compile logs, and the browser's source/optimized asset mode. |
| Operations script | `scripts/notify-service-worker-update.sh`, `scripts/service-worker-cache-socket.js` | Recompiles runtime assets, refreshes hashes, and broadcasts a service worker cache update through the server Unix socket. |

## Managed assets

The compiler manages only these public roots:

- `public/css/**/*.css`
- `public/scripts/**/*.js`
- Generated workspace CSS served as `/css/workspaces.css`

Compiled files are written under `.cache/runtime-assets/`, which is ignored by
Git. Do not edit files in that cache; they are regenerated from source.

Each compiled file starts with a block comment containing:

- `DO NOT EDIT, READ ONLY OPTIMISED VERSION`
- source path
- compile time
- SHA-256 hash of the source file

The source hash is used for compiler skip detection. The service worker
manifest uses hashes of the bytes actually served, so production manifests track
optimized output while developer-mode manifests track source output.

## Runtime flow

### Server boot

1. `web_server.js` starts the HTTP server early so `/status` can report boot
   progress.
2. The `Runtime Asset Compilation` boot step calls
   `runtimeAssetService.compileOnBoot(...)`.
3. `runtimeAssetCompiler.compileRuntimeAssets(...)` scans managed files and
   recompiles stale assets.
4. `runtimeAssetService.postCompileActions(...)` refreshes the server-side cache
   data and updates CSS `?sha=` links in `public/app.html` and
   `public/launch.html`.
5. `OPTIONS /` returns `503` with `stage: "runtime_compile"` until boot compile
   completes; after that it returns the service worker cache manifest.

Boot compilation does not broadcast an update to already connected clients. Use
the notify script after client-side edits or deploys.

### Serving requests

`web_server.js` installs the optimized asset middleware before `express.static`.
For `GET` and `HEAD` requests under the managed paths:

1. Debug/source mode is detected from `?sf_debug=1`, `?debug=1`,
   `X-StaticForge-Debug: 1`, or the `staticforge_dev_mode=1` cookie.
2. If `runtimeAssets.autoRecompile` is enabled and the request is not in debug
   mode, the server checks whether that asset needs recompiling.
3. `runtimeAssetService.resolveServedPath(...)` returns the compiled file when
   available, otherwise the source file.
4. The response includes `X-StaticForge-Runtime-Asset: optimized` or
   `X-StaticForge-Runtime-Asset: source`.

## Developer and deploy workflow

After changing client-side files under `public/css/`, `public/scripts/`,
`public/app.html`, `public/launch.html`, `public/sw.js`, or public static assets,
run:

```bash
bash scripts/notify-service-worker-update.sh
```

This sends `recompile_runtime_assets` to the server Unix socket, then the server:

1. recompiles runtime CSS and JavaScript;
2. refreshes the server hash cache used by `OPTIONS /`;
3. broadcasts `service_worker_cache_update` to connected clients;
4. clients download changed files through `CACHE_STATIC_FILES`.

If the server itself must restart, use:

```bash
bash scripts/notify-service-worker-update.sh --restart
```

`--restart` restarts PM2, waits until `/status` reports both `isReady: true` and
`runtimeCompileComplete: true`, then runs the same recompile/refresh/broadcast
step. The default readiness port is `9220`.

Useful flags and environment variables:

| Option | Purpose |
|---|---|
| `--silent` | Suppresses normal client update prompts where supported. |
| `--json` | Prints the Unix socket response as JSON. |
| `STATICFORGE_SOCKET_PATH` | Overrides the Unix socket path, default `/tmp/staticforge_mcp.sock`. |
| `STATICFORGE_SOCKET_TIMEOUT_MS` | Socket request timeout, default `120000`. |
| `STATICFORGE_HTTP_PORT` | Readiness probe port for `--restart`, default `9220`. |
| `STATICFORGE_PM2_TARGET` | PM2 process id or name for `--restart`, default `12`. |

There is no hash-only update mode. Recompile, refresh, and broadcast are kept
together so the manifest matches the bytes clients will download.

## Admin controls and observability

Admin clients can trigger the same workflow from WebSocket actions:

| Message | Handler | Notes |
|---|---|---|
| `recompile_runtime_assets` | `handleRecompileRuntimeAssets` | Admin-only compile action, returns compile counts, errors, and stats. |
| `refresh_server_cache` | `handleRefreshServerCache` | Admin-only cache refresh path; also recompiles runtime assets before returning manifest data. |
| `set_runtime_assets_auto_recompile` | `handleSetRuntimeAssetsAutoRecompile` | Persists `config.runtimeAssets.autoRecompile`. |

Runtime compile status is visible in the in-app Log Viewer/Event Viewer uptime
popover. The UI consumes:

- `runtime_compile_progress`
- `runtime_compile_complete`
- `runtime_compile_error`
- `runtime_compile_logs`

The same UI exposes a per-browser source/optimized toggle. Source mode stores
`staticforge_dev_mode=true` in local storage and sets the `staticforge_dev_mode=1`
cookie so the server serves source assets for that browser.

## Configuration

`config.json` supports:

```json
{
  "runtimeAssets": {
    "autoRecompile": false
  }
}
```

When `autoRecompile` is `false`, compilation runs on server boot and explicit
requests only. When it is `true`, managed asset requests can trigger stale-file
recompiles before serving optimized bytes.

Keep `autoRecompile` disabled for normal production deployments unless realtime
source edits need to be reflected without running the notify script.

## Client update behavior

When a client receives `service_worker_cache_update`:

1. `public/scripts/websocket.js` queues the update until the service worker boot
   gate is complete.
2. `serviceWorkerManager.updateStaticCache(...)` compares the pushed manifest
   against `static-cache-v1`.
3. Changed files are sent to the active service worker with `CACHE_STATIC_FILES`.
4. CSS-only and apply-safe updates can be applied without a restart.
5. Script or route updates trip the pending-update fuse and prompt for an app
   restart after download.

If no connected clients receive the broadcast, they still fetch the latest
manifest on their next normal service worker update check.

## Troubleshooting

| Symptom | Check |
|---|---|
| `OPTIONS /` returns `503` with `runtime_compile` | Boot compilation is still running. Check `OPTIONS /status` for `runtimeCompileComplete` and progress details. |
| Notify script cannot connect | Confirm the server is running and `STATICFORGE_SOCKET_PATH` matches the server socket, default `/tmp/staticforge_mcp.sock`. |
| Clients still load old CSS or JavaScript | Run `bash scripts/notify-service-worker-update.sh`; then check the browser response header `X-StaticForge-Runtime-Asset` and service worker update UI. |
| A compile succeeds but clients do not update | Verify the WebSocket broadcast occurred and that the manifest hash for the asset changed. The service worker updates by manifest hash, not file timestamp. |
| Compile errors appear | Check runtime compile logs in the Log Viewer/Event Viewer. The server keeps previous optimized copies when possible and reports failed files in `runtime_compile_error`. |
| Need unminified assets for debugging | Enable source mode in the admin runtime asset UI, or request assets with `?sf_debug=1` / `?debug=1`. |

