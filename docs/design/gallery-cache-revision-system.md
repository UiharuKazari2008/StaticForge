# Gallery load & session sync

**Status:** Client IndexedDB gallery-list cache **removed**. Server revision counters (`headSeq` / `bodyRev` / `pinnedRev` / `blockRev`) **removed** (2026-07-10).  
**Goal:** Fast read-only gallery load with session memory reuse — no revision machinery.

---

## Current model (canonical)

| Layer | Role |
|--------|------|
| **Server SQL** | Source of truth (`gallery_workspace_items`, ownership, pins, `total_items` in index meta) |
| **Client memory** | `allImages` + `galleryImagesSyncState` (session only) |
| **Client IDB** | Per-image `metadata` / `thumbnails` only — **not** the gallery list |
| **Load path** | Probe → optional session hit → optional incremental head fetch → sequential server block fetch (750) with keyset cursors |

**Do not reintroduce** IndexedDB gallery-list caching or server revision counters.

---

## Principles

1. **SQL is source of truth** for gallery membership.
2. **Pins are an overlay** (`gallery_workspace_pins`), not a membership bucket.
3. **Validation = total + `lastGalleryDestructiveAt`** — not content hash or revision counters.
4. **Gallery load is a read** — no full filesystem scans or block-meta writes on the request path.
5. **Show after block 0** while remaining blocks sync.

---

## Session validity

- Reuse `allImages` when probe `total` matches `galleryImagesSyncState.total` and `lastGalleryDestructiveAt` is not newer than the stamped session value.
- Append-only head sync when total grew (delta ≤ 500), destructive stamp is unchanged, and overlap check passes; otherwise full block fetch.
- Admin coarse invalidation: `lastGalleryDestructiveAt` on workspace settings (also clears session via `invalidate_sync`).

Legacy SQL columns `head_seq` / `body_rev` / `gallery_workspace_block_meta.block_rev` may still exist in the schema but are unused (written as 0 / never read).

---

## Client load flow

1. Meta probe (`limit: 0`) — returns `totalItems`, `lastGalleryDestructiveAt`, `blockSize`.
2. If `galleryImagesSyncState` matches probe → reuse `allImages`.
3. Else if append-only delta ≤ 500 and memory base exists → head chunk fetch + overlap check.
4. Else fetch all blocks from server (`galleryBlockFetch` + `afterCursor` keyset).
5. Finalize into memory; **no** IDB block persist.

IDB version **5** deletes legacy `galleryMeta` / `galleryBlocks` / `galleryPins` / `gallerySnapshots` stores on upgrade.

---

## Server notes

- Block serve: read-only SQL, keyset pagination; no writes on gallery load.
- Index meta refresh updates **`total_items` only**.
- Delete: targeted metadata/ownership updates — never `syncWorkspaceFiles()` on the delete path.
- Metadata open: dedicated read connection; do not full-read img2img source files for dimensions.
