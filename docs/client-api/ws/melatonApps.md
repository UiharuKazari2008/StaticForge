# WebSocket: Melaton apps

Server handler: `modules/ws/handlers/245-melatonAppsHandler.js`  
Runner: `modules/melatonApps/runner.js`  
Contract: [../melaton-apps.md](../melaton-apps.md)

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `app_launch` | `app_launch_response` | session; admin when the package has a server half | `fileId`, or `archiveFileId` + `entryPath`, or `packageId` |
| `app_opener` | `app_opener_response` | session | `name`, `size`: the installed app that opens such a file, or `null` |
| `app_message` | `app_message_response` | owner tab | `instanceId`, `data` (JSON) to the app's server half |
| `app_terminate` | `app_terminate_response` | owner tab | `instanceId`: the app ended on the client |
| `app_list` | `app_list_response` | admin | Running instances and processes |
| `app_service_stop` | `app_service_stop_response` | admin/destructive | `packageId`: stop its service process |

Only the tab that launched an instance can message or end it (`APP_NOT_OWNER`). When that tab's
WebSocket closes, its instances end (`websocket.js` close calls `onClientClosed`).
`package_uninstall` and `package_set_enabled false` stop the package's running apps.

## Server push (to the launching tab)

| Push type | `data` |
|---|---|
| `app_message` | `{ instanceId, data }` from the server half (`app.send`) |
| `app_exited` | `{ instanceId, packageId, code, signal, fault, reason, log }`. `reason`: `exited`, `not-responding` or the stop reason. `fault` is true for a crash, a hang or a start failure. |

## Detailed packets

### `app_launch`

```json
{ "type": "app_launch", "archiveFileId": "3f61d5cb-...", "entryPath": "SoraTan.exe" }
```

- A `.msaz` (loose, or an archive entry) is unpacked to a run tree and started.
- Any other file starts the installed app whose `opens[]` matches its name and size (`APP_NO_OPENER` otherwise).
- `packageId` starts an installed package by id (`APP_NOT_INSTALLED` when missing or disabled).

Response `data`:

```json
{
    "success": true,
    "instanceId": "app_...",
    "runner": "session",
    "server": true,
    "package": {
        "id": "soratan", "title": "SoraTan", "version": "1.0.0.1", "publisher": "",
        "icon": "/melaton-apps/soratan/assets/soratan-48.png",
        "clientEntry": "/melaton-apps/soratan/client/soratan.js",
        "base": "/melaton-apps/soratan/",
        "runner": "session"
    }
}
```

Errors (`type: "error"`, code in `details`):

- `INSUFFICIENT_PERMISSIONS`: a readonly session and a server half, or no access to the file;
- `APP_NO_OPENER`, `APP_NOT_INSTALLED`, `APP_FILE_NOT_FOUND`, `APP_FILE_SIZE`, `APP_LIMIT`;
- store codes (`PACKAGE_*`) for a bad `.msaz`.

### `app_message`

```json
{ "type": "app_message", "instanceId": "app_...", "data": { "op": "load" } }
```

At most 8 MB per message in either direction. `APP_NO_SERVER` for a client-only app,
`APP_NOT_RUNNING` once it ended.
