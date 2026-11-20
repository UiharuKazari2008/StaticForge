# Offline Files on CaféReady clients (#910)

Vista's Offline Files (Client-Side Caching) for installed clients. Yukimi, Nov 20 2026: Melaton Camera's pictures go to
the workspace's **Camera Roll** (Pictures is the generated images' gallery) and videos to **Camera Roll\Camcorder**;
Camera Roll is an offline folder set to "don't store files offline" and "send files to the server using Offline
Files"; a recording's length is the host's free space, since it is written on the device until it is complete and
synced down.

Three parts:

| Part | Where | Does |
| --- | --- | --- |
| Host | DreamOS: `cafeready/src/offline.rs` (DreamOS repo). Android: DSApp's CaféReady (to build, same interface) | The cache on the device's disk, the write-back queue, downloads for "Always available offline", conflicts. Runs with no page (rule `cafeready-background`). |
| Server | `modules/offlineFilesRoute.js` | Folder settings, chunked resumable uploads verified by md5 (the VFS content hash), downloads, conflict detection at commit. |
| Page | `public/scripts/comp/offlineFiles.js` (`window.melatonOfflineFiles`) | Writes into offline folders through the host, Explorer's overlays and offline listings, the Sync Center partnership, Resolve Conflict, Offline Settings, Control Panel > Offline Files. |

## Folders and their policy

A folder is named by its **name path** with the workspace id: `/Workspaces/<ws>/Camera Roll/Camcorder` (the server's
`vfs_list_directory` answers carry it as `offlinePath`). Its policy:

- `caching` - the server's Offline Settings (filemgmt.dll dialog 239's words): `manual` "Only the files and programs that
  users specify will be available offline", `auto` "All files and programs that users open from the share will be
  automatically available offline" (+ `optimized` "Optimized for performance"), `none` "Files or programs from the share
  will not be available offline".
- `writeBack` - Melaton's: files written on a client are stored on it first and sent to the server by Offline Files.
- `pinned` - the client's own "Always Available Offline" (per folder or file, inherited by what is inside).

The nearest folder with a server setting decides; else the rule: a workspace's `Camera Roll` (and inside it) is
`none` + `writeBack` (known to the host with no server); else `manual`. A host takes writes for a folder that is
write-back or pinned. A write-back file in a folder not kept offline leaves the device once the server verified it.

## Server API (`/api/offline-files`, the browser's session, admin)

    GET  settings                        { folders: { <path>: { caching, writeBack, optimized } }, rules }
    POST settings                        { path, caching, writeBack, optimized } | { path, reset: true }
    GET  folder?path=                    { path, display, files: [{ id, name, md5, size, mime, updated }], folders: [{ id, name }] }
    POST upload/begin                    { folder, name, size, md5, base, id, mime, computer } -> { id, received, chunkSize }
    POST upload/:id/chunk?offset=N       raw bytes, in order (409 OFFSET { received })
    POST upload/:id/commit               { keep?: 'local' | 'both' } -> { file, renamed? } | 409 CONFLICT { kind, error, server } | 422 HASH
    DELETE upload/:id
    GET  file/:id                        the bytes (Range)

`id` is chosen by the client (32 hex) and kept with the queued file, so a restarted client resumes at `received`.
`base` is the server copy's md5 the client last saw (null = created on the client). CONFLICT `kind`:
`created-exists` / `both-changed`; the client finds `deleted-server` itself. `keep: 'both'` stores the client's copy as
`<name> (<computer> v1).<ext>` (cscui's naming).

## Host interface (`window.AndroidOfflineFiles`)

The DreamOS shell extension gives it from the CaféReady bridge (`/v1/offline*`). DSApp gives the same names:

    call(json) -> json        synchronous; json.op:
        state                 the summary (below)
        space                 { free, reserve, writable, disk }  (writable = free - reserve: what a recording may use)
        policy { path }       { path, caching, writeBack, pinned, optimized, source: server|rule|default, takes, enabled }
        open { folder, name, mime }   -> { handle, path, name (made unique), writable } | { error: 'not offline' | 'full' }
        close { handle, discard? }    -> the item (state pending; the queue starts)
        list { path }         { path, items: [item], folders: [name], policy, online }
        stat { path }         item | { error }
        pin { path, on }      "Always Available Offline"
        set { path, caching, writeBack, optimized } | { path, reset }   the server setting, known at once
        sync                  Sync now (the queue and the pinned folders)
        resolve { path, keep: local | server | both }
        delete { path }       a file deleted before the server had it
        remove { path }       Delete Offline Copy (refused while unsynced)
        limits { all, temp }  bytes;  enable { on }
    endpoint() -> json | null { base, token } for binary writes as fetch bodies (DreamOS). DSApp: null.
    write(handle, offset, base64) -> json   { size, writable } | { error: 'offset', size } | { error: 'full' }
    fileUrl(path) -> string   a URL the page can show / play the local copy from (Range)
    event 'cafeofflinefiles'  on window, detail = the summary, whenever it changed (never polled)

An item: `{ path, folder, name, mime, size, local, state: writing|pending|uploading|synced|conflict|error, md5,
serverId, modified, created, sent, error, conflict }`.

The summary: `{ enabled, online, status, busy: { op: hash|upload|download, name, path, done, total, file, files } |
null, pending, pendingBytes, conflicts: [{ id, path, name, folder, kind, detail, localAt, localSize, serverAt,
serverSize }], errors: [{ id, path, name, folder, error }], lastSync, lastError, usage: { used, temp, limitAll,
limitTemp, disk, free, reserve, writable }, folders: { <path>: { caching, writeBack, pinned, optimized, source } },
files, rev }`.

Rules for a host: a write never waits on the server; the queue survives reboots and host restarts (resume from the
server's `received`); a file cut by a crash is closed as it is; uploads only while the link is up (kicked by link-up,
a closed file, Sync now, a retry's time - no polling); md5 of the whole file before begin; the commit's answer decides
(synced / conflict / retry with back-off 5 s, 15 s, 1 min, 5 min, 15 min, 30 min).

## What DSApp needs (not built yet)

- A `CafeOfflineFiles` store in filesDir (or app-specific external storage for size) with the same item states and a
  WorkManager / foreground-service upload worker started on link-up (Miniport) and on close; chunked POSTs with the
  page's session cookie (as CafeTasks fetches task code).
- `AndroidOfflineFiles` @JavascriptInterface with `call`, `write` (base64; or a WebView `shouldInterceptRequest` route
  for binary bodies and `endpoint()`), `fileUrl` (an `appassets`-style URL served with Range from the store).
- `space` from `StatFs` on the store's volume; the camera's limit is its `writable`.
- Events: evaluate `window.dispatchEvent(new CustomEvent('cafeofflinefiles', { detail }))` when the summary changes.
