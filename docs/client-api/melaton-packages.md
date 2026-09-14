# Melaton packages

Installable Dreamscape software archives. Parent plan: Yozora #179. This document is the **store + manifest** contract (slice #180). Start menu, Control Panel, UI Lab, and `server.entry` load are later issues.

| File | Role | On disk after install |
|------|------|------------------------|
| `.mapz` | Melaton Application Package | `.cache/packages/<id>/` |
| `.msaz` | Melaton Standalone Application | Same tree once **installed**. Portable Run-from-VFS is #186. |

Same zip body. The extension is placement (`format` in the manifest must match the filename when a name is provided).

Client files of an installed package are already HTTP-reachable as `GET /cache/packages/<id>/...` (authenticated `/cache` mount).

## `manifest.json` (v1)

Required:

| Field | Values |
|-------|--------|
| `id` | `[a-z][a-z0-9-]{1,62}` — directory name under `.cache/packages/` |
| `version` | string, max 64 |
| `title` | string, max 80 |
| `launchId` | `[a-z][a-z0-9-]{1,62}` — must not collide with builtins or another installed package |
| `format` | `mapz` \| `msaz` |
| `type` | `dsap` \| `native` — **required**. One type per package |

Optional / defaulted:

| Field | Default | Notes |
|-------|---------|-------|
| `cssPolicy` | `locked` | Only `locked` is accepted until Yukimi opens the store |
| `load` | `onDemand` | `onDemand` \| `startup` (startup load is #185 / #187) |
| `startMenuLocation` | `all-apps` | `all-apps` \| `tools` |
| `client.entry` | `client/index.js` | Must exist in the zip |
| `client.html` | `client/index.html` | Path only in v1; not opened by this slice |
| `client.styles` | — | **Forbidden**. Rejected at install |
| `url` / `aliases` / `surfaces` | — | Required `url` when `type` is `dsap`. `surfaces[]`: `controlPanel` \| `launcher` \| `domain` \| `shortcut` |
| `server.entry` | — | Optional. If set, `server.packets[]` is required |
| `server.packets[]` | — | Each name must be `pkg.<id>.<suffix>` and must not already be registered |

`type: native` cannot declare DSAP `surfaces`. Need both a Control Panel page and a tool window → two packages.

Install rejects reserved builtin `launchId`s and reserved DSAP hosts (lists in `modules/melatonPackageStore.js`).

## Archive

```
manifest.json
client/          html + js (no package CSS in v1)
server/          optional Node entry + declared packets
```

Zip limits: 32 MiB, 400 entries. Paths with `..` or absolute names are rejected. `manifest.json` must sit at the archive root.

Class-allowlist scanning of markup is #181 (`docs/client-api/melaton-package-ui.md` when that slice lands).

## Index

`.cache/packages/index.json`:

```json
{
  "version": 1,
  "packages": {
    "example-tool": {
      "id": "example-tool",
      "version": "1.0.0",
      "title": "Example Tool",
      "launchId": "example-tool",
      "format": "mapz",
      "type": "dsap",
      "enabled": true,
      "installedAt": "<ISO-8601>",
      "updatedAt": "<ISO-8601>",
      "dir": "packages/example-tool",
      "manifest": {}
    }
  }
}
```

Reinstalling the same `id` replaces the tree and keeps `installedAt` / `enabled`.

Uninstall deletes the directory and the index row. Packets from `server.entry` are **not** unrequired — bounce after disable (#187).

## Auth

| Operation | Who |
|-----------|-----|
| `package_list` | Any session |
| `package_install` / `package_uninstall` / `package_set_enabled` | Admin; readonly blocked (`isDestructiveOperation`) |

Trusted-admin, not a public store. Same-origin package JS and optional Node `require` are later slices.

## Source

- Store: `modules/melatonPackageStore.js`
- WS: `modules/ws/handlers/240-melatonPackageHandler.js`
- Packets: [ws/melatonPackages.md](./ws/melatonPackages.md)
