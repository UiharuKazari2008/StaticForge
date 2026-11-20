# Media library (client WS)

Module: `modules/ws/handlers/310-mediaLibraryHandler.js` + `modules/mediaLibrary.js` (#956, Nov 19 2026). Melaton Media
Player's library on the server: every music and video file in the VFS (user files of type `audio/*` or `video/*`, not in
the Trash) with its tags (ffprobe) and album art. The file and art routes are in
[../rest-api.md](../rest-api.md#media-library).

| Packet | Direction | Fields | Notes |
| --- | --- | --- | --- |
| `media_library_get` | client -> server | none | Answers `media_library_get_response` `data: { audio[], video[], scannedAt }`. Only files the session may access (`canSessionAccessVfsFile`); rescans first when the index is stale. On failure a `sendError` with the message. |
| `media_library_changed` | server -> client | `data: { changed }` | Broadcast about 10 s after a VFS change, when the library was used recently and the rescan ran. Desktop pages only (`DESKTOP_ONLY_TYPES`); the phone shell does not run Media Player. |

Each `audio[]` / `video[]` item: `id` (VFS file id), `hash` (content hash), `name`, `mime`, `size`, `added` (ms),
`workspaceId`, `title` (falls back to the file name), `artist`, `albumArtist`, `album`, `genre`, `year`, `track`,
`disc`, `composer`, `duration`, `width`, `height` (video), `art` (boolean: `GET .../media/art/:hash` has a picture).
