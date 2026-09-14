# WebSocket: Melaton packages

Server handler: `modules/ws/handlers/240-melatonPackageHandler.js`  
Store: `modules/melatonPackageStore.js`  
Contract: [../melaton-packages.md](../melaton-packages.md)

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `package_list` | `package_list_response` | session | Installed rows from `.cache/packages/index.json` |
| `package_install` | `package_install_response` | admin/destructive | `base64`, `bytes`, or `vfsFileId` (+ optional `fileName`) |
| `package_uninstall` | `package_uninstall_response` | admin/destructive | `id` |
| `package_set_enabled` | `package_set_enabled_response` | admin/destructive | `id`, `enabled` boolean |

## Server push

| Push type | When |
|---|---|
| `packages_updated` | After install, uninstall, enable, or disable. `data.reason` + `data.package` |

## Response envelope

```json
{
  "type": "<request_type>_response",
  "requestId": "<same as request>",
  "data": { "success": true },
  "timestamp": "<ISO-8601>"
}
```

Errors use `type: "error"` via `sendError()`. `error` is a Melaton store code when validation fails (`PACKAGE_TYPE`, `PACKAGE_LAUNCH_RESERVED`, `PACKAGE_CSS`, …).

## Detailed packets

### `package_list`

**Auth:** session

**Response `data`:** `{ success, packages: [<index row>] }`

### `package_install`

**Auth:** admin / destructive

**Fields:**

| Field | Notes |
|-------|--------|
| `base64` | Zip bytes, standard base64 |
| `bytes` | Raw Buffer / number array (same zip) |
| `vfsFileId` | User VFS file id; blob from `.cache/userFiles/<content_hash>` |
| `fileName` | Optional. If it ends `.mapz` / `.msaz`, must match `manifest.format` |

Exactly one of `base64` / `bytes` / `vfsFileId` is required.

**Response `data`:** `{ success, package: <index row> }`

Then broadcast `packages_updated` with `reason: "install"`.

### `package_uninstall`

**Auth:** admin / destructive

**Fields:** `id` (or `packageId`)

**Response `data`:** `{ success, id, removed: true }`

### `package_set_enabled`

**Auth:** admin / destructive

**Fields:** `id`, `enabled` (boolean)

Does not unload Node handlers. Disable + bounce is #187.

## How to verify

1. Build a zip with `manifest.json` (`type` + `format` + `launchId` + `id` + `client/index.js`).
2. Admin WS `package_install` with `base64`.
3. `package_list` includes the row; `.cache/packages/<id>/` exists.
4. Missing `type`, reserved `launchId` (`studio`), or `client.styles` → error, nothing extracted.
5. Readonly session cannot `package_install`.
