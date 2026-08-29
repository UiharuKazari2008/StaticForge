# WebSocket: Similar-image review

Server handler: `modules/ws/handlers/125-similarImageHandler.js`

Group query: `modules/metadataDatabase.js` → `listSimilarImageGroupsForWorkspace()` / `listSimilarGroupMemberFilenames()`.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Ivory's similar-image keep/scrap applet (`public/scripts/comp/similarImageDsapApplet.js`) lists near-duplicate groups already tagged on `image_search_facets` (`consecutive_seed_group_id`, optionally `refine_group_id`). It does **not** run a perceptual-hash or full-gallery scan. Thumbs use existing `GET /previews` (fallback `GET /images`). Scrap delegates to `delete_images_bulk`.

The web applet calls `window.wsClient.sendMessage('get_similar_image_groups', { workspaceId })` and `sendMessage('scrap_similar_images', { workspaceId, groupId, groupKind, filenames })`. Keep is client-only (localStorage `similarImageReviewedGroups`) — images stay on disk.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `get_similar_image_groups` | `get_similar_image_groups_response` | session | Handler: handleGetSimilarImageGroups |
| `scrap_similar_images` | `delete_images_bulk_response` | session | Destructive. Validates group membership then wraps `delete_images_bulk`. |

## Response envelope

Successful list replies use:

```json
{
  "type": "get_similar_image_groups_response",
  "requestId": "<same as request>",
  "data": { "success": true, "...": "..." },
  "timestamp": "<ISO-8601>"
}
```

`scrap_similar_images` reuses the existing bulk-delete handler, so the matching `requestId` resolves with `delete_images_bulk_response` (`data.successful`, `data.results`, `data.errors`). It also broadcasts `gallery_updated`.

Errors use `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors).

## Read-only restrictions

Packets marked destructive in `modules/websocketHandlers.js` → `isDestructiveOperation()` return `READONLY_RESTRICTED` for `userType: "readonly"` sessions. `scrap_similar_images` **is** destructive. `get_similar_image_groups` is **not**.

---

## Detailed packets

### `get_similar_image_groups`

**Auth:** Session required

**Handler:** modules/ws/handlers/125-similarImageHandler.js → `handleGetSimilarImageGroups`

**Request fields:**

| Field | Required | Notes |
|---|---|---|
| `workspaceId` | no | Defaults to the session's active workspace, then `default`. |
| `includeRefine` | no | Default `true`. Also surface `refine_group_id` groups of 2+ after consecutive-seed groups. |
| `groupLimit` | no | Cap groups (default 50, max 100). |
| `itemLimit` | no | Cap items per group (default 24, max 48). |

**Success response:** `get_similar_image_groups_response`

`data` shape:

```json
{
  "success": true,
  "workspaceId": "default",
  "groups": [
    {
      "groupId": "ab12cd34",
      "kind": "consecutive_seed",
      "seed": "123456789",
      "count": 4,
      "latestMtime": 1710000000000,
      "truncated": false,
      "items": [
        {
          "filename": "foo.png",
          "seed": "123456789",
          "previewUrl": "/previews/foo.webp",
          "imageUrl": "/images/foo.png",
          "mtime": 1710000000000,
          "width": 1024,
          "height": 1024
        }
      ]
    }
  ],
  "groupCount": 1,
  "capped": false,
  "indexImages": { "consecutiveSeed": 12, "refine": 0 }
}
```

Groups with fewer than 2 workspace members are omitted. `indexImages` is a cheap count of facet rows that have a group id (not a full `metadata.db` walk). Empty `groups` with `indexImages.consecutiveSeed === 0` means the seed-chain index has not tagged pairs on this host yet — the packets still succeed.

**Errors:** `type: "error"` via `sendError()`.

### `scrap_similar_images`

**Auth:** Session required (blocked for readonly)

**Handler:** modules/ws/handlers/125-similarImageHandler.js → `handleScrapSimilarImages` → `delete_images_bulk`

**Request fields:**

| Field | Required | Notes |
|---|---|---|
| `filenames` | yes* | Images to delete. |
| `keepFilenames` | no | If set with `groupId`, scrap is `group members − keepFilenames` (overrides `filenames`). |
| `groupId` | no | When set, every scrap filename must belong to this group in the workspace. |
| `groupKind` | no | `consecutive_seed` (default) or `refine`. |
| `workspaceId` | no | Same default as the list packet. |

**Success response:** `delete_images_bulk_response` (same `requestId`) — see [gallery.md](./gallery.md#delete_images_bulk).

**Push side effects:** `gallery_updated`

**Errors:** missing filenames, filenames not in the group, or delete errors via `sendError()`.
