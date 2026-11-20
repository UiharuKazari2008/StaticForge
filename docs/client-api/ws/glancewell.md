# Glancewell library (client WS)

Modules: `modules/glancewellStore.js`, `modules/ws/handlers/316-glancewellHandler.js` (Yozora #446, Nov 20 2026).
Glancewell is Windows Photo Gallery. This store holds what the gallery keeps about a picture beyond the
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

## `glancewell_changed` (server push, every signed-in client)

`{ type: "glancewell_changed", data: { what, ... } }`

| `what` | Extra fields | Sent after |
| --- | --- | --- |
| `meta` | `items: [meta]`, `tags: true` when the edit created a tag | an edit |
| `meta` | `forgot: [{ source, key }]` | `glancewell_forget` |
| `tags` | | a tag edit |
| `watched` | | a watched-list edit |

Clients update what they show from the push. Nothing polls.

Test: `node scripts/test-glancewell-store.js`.
