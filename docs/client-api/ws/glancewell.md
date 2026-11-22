# Melaton Photo Gallery library (client WS)

Modules: `modules/glancewellStore.js`, `modules/ws/handlers/316-glancewellHandler.js` (Yozora #446, Nov 20 2026).
Melaton Photo Gallery is Windows Photo Gallery. This store holds what the gallery keeps about a picture beyond the
picture's own store: the user's tags (nested), captions, a moved date taken (Change Time Taken), the Pictures
root's Favorites, and the Folders root's watched VFS folders. It lives in its own database, `glancewell.db`.

Every request needs a signed-in admin or dev-admin client. Otherwise the reply is an error, "Not allowed".

A picture is `{ source, key }`.

| `source` | `key` |
| --- | --- |
| `prints` | the print's filename |
| `refs` | the reference hash |
| `pictures` | the phone or host picture's path |
| `folders` | the VFS file id |
| `device:<deviceId>` | a path on an ActiveSync phone |

References keep their own tags and comment (`update_reference_metadata`, ws/references.md). The References
root reads those, so `refs` rows here only hold what that store has no column for.

| Request | Fields | Response `data` |
| --- | --- | --- |
| `glancewell_tags` | `source?` | `{ success, tags: [{ id, name, parentId, count }] }`. `count` covers one source when `source` is given |
| `glancewell_tag_edit` | `op` (`create` `name` `parentId?` / `rename` `id` `name` / `delete` `id` / `merge` `id` `into` / `move` `id` `parentId`) | `{ success, id }`. A rename onto a name its parent already has answers `{ success, conflict: true, id }` and the client offers the merge (WPG 1808) |
| `glancewell_tag_items` | `tagIds` (or `tagId`), `source?` | `{ success, items: [{ source, key }] }`. Sub-tags are included |
| `glancewell_meta_get` | `items: [{ source, key }]` (at most 5000) | `{ success, items: [{ source, key, caption, tags: [id], taken, favorite }] }`. `taken` is unix seconds, or null when unchanged |
| `glancewell_meta_set` | `items`, `change` | `{ success, items: [meta] }`. See below |
| `glancewell_source_index` | `source` | `{ success, tagged: [{ key, tags }], captions: [{ key, caption }], favorites: [key], taken: [{ key, taken }] }`. One source's tags, captions, favorites and moved dates, used for Not Tagged, caption search and the Favorites node |
| `glancewell_favorites` | `source?` | `{ success, items: [{ source, key, added }] }`, newest first |
| `glancewell_watched` | | `{ success, folders: [{ folder, name, added }] }` |
| `glancewell_watched_set` | `add?: [{ folder, name }]`, `remove?: [folder]` | `{ success, folders }` |
| `glancewell_forget` | `items` | `{ success, forgot }`. Call it when a picture is deleted for good |

## Options and Import

| Request | Fields | Response `data` |
| --- | --- | --- |
| `glancewell_settings` | | `{ success, settings: { tooltips, originalsDays, updateNotes, import: { folder, folderName, fileName, promptTag, erase, rotate, openAfter } } }` |
| `glancewell_settings_set` | `change` (any of the above) | `{ success, settings }`. Unknown keys are dropped. `originalsDays` is one of 0 (Never), 1, 7, 30, 182, 365. `folderName` is one of `dateImportedTag`, `dateTakenTag`, `dateRangeTag`, `tagDateImported`, `tagDateTaken`, `tagDateRange`, `tag`, `none`. `fileName` is one of `tag`, `original`, `originalFolders`. Pushes `glancewell_changed` `{ what: "settings" }` and removes kept Fix originals older than `originalsDays` |
| `glancewell_settings_set` (view) | `view` (the gallery's view: `size`, `sort`, `sortDir`, `group`, `groupDir`, `view`, `toc`, `expanded`, `node`, `pos` per folder `{ id, off }`, `at` ms) | `{ success, ok }`. Kept whole (at most 64 KB) as `settings.view`; no `glancewell_changed` push. A client adopts it at open when its `at` is newer than its own |
| `glancewell_import_record` | `items` | `{ success, batch }`. One import's pictures; the last 20 batches are kept. Pushes `{ what: "imports" }` |
| `glancewell_recent_imports` | | `{ success, batch, at, items }`. The last import, for Recently Imported |

The server removes kept Fix originals older than Options' "Move originals to Recycle Bin after" at start and once a day.

## Fix (`modules/glancewellFix.js`)

Photo Gallery's Fix pane saves a fixed print through these packets. VFS files go through `vfs_replace_file` /
`vfs_upload_file`, and phone pictures through the phone's own storage.

| Request | Fields | Response `data` |
| --- | --- | --- |
| `glancewell_fix_save` | `filename` (a print), `mode` (`overwrite` / `copy`), `data` (the fixed PNG, base64), `workspaceId?` | `{ success, filename, mode, hasOriginal }`. Either way the print's PNG text chunks (prompt, seed, parameters) carry over. `overwrite` keeps the first original in `<cache>/glancewell-originals` for Revert to Original. `copy` adds `<name>_fixed.png` to the workspace. Pushes `gallery_updated` |
| `glancewell_fix_revert` | `filename`, `workspaceId?` | `{ success, filename }`. The kept original goes back over the print and the kept copy is removed |
| `glancewell_fix_original` | `filename` | `{ success, hasOriginal }` |

`glancewell_fix_save` and `glancewell_fix_revert` are marked destructive. Rotation in the gallery and the viewer
uses `glancewell_fix_save` `overwrite` with the turned picture. Test: `node scripts/test-glancewell-fix.js`.

`change` in `glancewell_meta_set` applies the same edit to every picture in `items`:

| Field | Effect |
| --- | --- |
| `caption` | Sets the caption. `''` clears it |
| `addTags` | Takes tag names or ids. A new name makes the tag |
| `removeTags` | Takes tag ids |
| `clearTags` | `true` is Remove All Tags |
| `taken` | Sets the date taken, in unix seconds |
| `takenShiftHours` | Change Time Taken, an integer from -24 to +24. Put each picture's current date in `items[i].taken` |
| `favorite` | `true` or `false` |

Tag names may not contain `/` or `;`; the error text is WPG's own.

`glancewell_tag_edit` and `glancewell_forget` are marked destructive in the packet registry.

## Videos (`public/scripts/comp/glancewellVideo.js`)

Melaton Photo Gallery plays videos in its viewer with Photo Gallery's controls: Play / Pause, Stop, a seek bar, and the keys H, K and Home. It uses no packets of its own:

- A **Folders** video has no VFS preview. When a listed folder holds videos, the client sends `media_library_get` once (Media Player's library, [mediaLibrary.md](./mediaLibrary.md)). Each video's `art` frame becomes the thumbnail, and its `width` / `height` / `duration` fill Info. The file plays from `<vfsPath>/media/file/<id>`, which answers HTTP Range so the viewer can seek. `/files/` streams without Range.
- A **phone or partner device** video plays from its storage URL (`/api/activesync/file/...` passes the Range header to the device). The entry's `duration` (ms) is the length shown.
- Only the video on screen has a source. Neighbouring slides make no requests, and a video left behind gives up its connection.

## `glancewell_changed` (server push, every signed-in client)

`{ type: "glancewell_changed", data: { what, ... } }`

| `what` | Extra fields | Sent after |
| --- | --- | --- |
| `meta` | `items: [meta]`, `tags: true` when the edit created a tag | an edit |
| `meta` | `forgot: [{ source, key }]` | `glancewell_forget` |
| `tags` | | a tag edit |
| `settings` | | Options saved |
| `imports` | | an import recorded |
| `watched` | | a watched-list edit |

Clients update what they show from the push. Nothing polls.

Test: `node scripts/test-glancewell-store.js`.
