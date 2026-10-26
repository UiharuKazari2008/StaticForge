# WebSocket: Slideshow devices (Melaton SideShow)

Server handler: `modules/ws/handlers/298-slideshowDevicesHandler.js` (logic and storage in `modules/slideshowDevices.js`,
sqlite `.cache/slideshow_devices.db`). Clients: Dreamscape Frame (Android, `jp.net.seventhreeseven.dreamframe`), the
Device Simulator app (`public/scripts/comp/desktop-apps/sideshow/sideshowSimulator.js`, Yozora #655), and Control
Panel's Melaton SideShow pages (`public/scripts/comp/cplPages2.js`). Yozora #654.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Connecting as a device

A device opens its own socket: `wss://<host>/?agentClientId=<deviceId>` with its session (`connect.sid`). `deviceId` is
12 lowercase hex, made once and kept on the device. The socket says it is a device before it identifies, so agent
auto-bind never picks it:

- `X-Dreamscape-Client: DreamscapeFrame/1.1` or `User-Agent: DreamscapeFrame/1.1 (Android)`, or
- `?dreamscapeClient=VirtualSideShow/3.0` on the URL (browsers cannot set socket headers).

Device sockets stay out of agent binding (`bind_session`, nearest / successor / reattach picks). `GET /agent/clients` and
MCP `list_clients` still list them with `kind`, `name`, `deviceId`, `bindable: false`, `desktopReady: false`.

## Device packets (any signed-in session, read-only PIN included)

| Request type | Response | Notes |
|---|---|---|
| `client_identify` | `client_identify_response` | `data: { kind, deviceId, name, app, model, os, display: { width, height, orientation }, settings }` -> `{ success, deviceId, name, settings? }`. Send after every connect. `kind` must be `slideshow` (else error `BAD_DEVICE_KIND`); `deviceId` 12 hex (`BAD_DEVICE_ID`). Strings are clamped to 64 characters. The reply's `settings` holds only what Control Panel changed while the device was offline (apply and persist the keys you know); `name` is the stored name (a Control Panel rename wins). Both are cleared once sent. |
| `client_device_state` | none | `data: { deviceId, state, showing, since }`. Fire-and-forget on every slide and state change. `state`: `showing`, `paused`, `offline_cache`, `signin_needed`, `stopped`. `showing`: one gallery filename, or two for a portrait pair. Send `stopped` when the screensaver ends; the socket's close marks the device offline. Ignored before `client_identify`. |
| `device_command_ack` | none | `{ commandId, data: { ok, error? } }`, the answer to a `device_command`. |
| `device_slideshow_images` | `device_slideshow_images_response` | `{}` -> `{ success, deviceId, total, items: [{ filename, width, height, mtime }] }`: the pictures for this device's stored settings, newest first, at most `poolSize` (`total` counts every match). Workspace pictures follow `viewType`; an Image Search follows its own query; `maxAgeDays` filters both (search results are dated by the filename's leading timestamp). Before `client_identify`: `success: false, code: "NOT_IDENTIFIED"`. Shuffling is the device's job. |

### Settings keys

| Key | Values |
|---|---|
| `viewType` | `images`, `pinned`, `upscaled` |
| `intervalSec` | 5 - 3600 seconds per picture |
| `poolSize` | 1 - 1000 pictures in rotation |
| `shuffle` | boolean |
| `pairPortraits` | boolean |
| `infoOverlay` | `off`, `minimal`, `full` |
| `workspaces` | workspace ids (at most 20); `["*"]` = every workspace; empty = the session's active workspace |
| `maxAgeDays` | 0 (any age) - 3650: only pictures newer than this |
| `search` | an Image Search (the Sidebar Slide Show's omegasearch query: `{ blocks, workspaceId, viewType, filters, promptSource, blockOptions, label }`), or `null` to use the workspaces again |

Unknown keys and out-of-range values are dropped (numbers are clamped). `workspaces`, `maxAgeDays` and
`search` are applied by the server: a device that wants them asks `device_slideshow_images` for its
pictures instead of paging `request_gallery` itself (the Device Simulator does; Dreamscape Frame needs
that change to follow them).

## Server to device

`device_command`: `{ type: "device_command", commandId: "c-...", data: { command, filename?, settings?, name? } }`

| `command` | Extra | Device |
|---|---|---|
| `next` / `previous` | | advance / go back |
| `pause` / `resume` | | freeze or resume the timer |
| `show` | `filename` | show that picture next (pair it if portrait) |
| `refresh` | | re-fetch the gallery |
| `set_settings` | `settings` | apply, persist, refresh |
| `rename` | `name` | persist the new name |

## Control Panel packets (admin)

| Request type | Response | Notes |
|---|---|---|
| `list_devices` | `list_devices_response` | `{}` -> `{ success, devices: [{ deviceId, kind, name, app, model, os, display, online, lastSeen, firstSeen, state, showing, since, settings, pendingSettings, pendingName }] }`. Online first, then by last seen. A device is online while its socket is open and has not reported `stopped`. A non-admin session gets `{ success: false, code: "INSUFFICIENT_PERMISSIONS", devices: [] }` (an answer, not an error packet). |
| `device_send_command` | `device_send_command_response` | `{ deviceId, command, filename?, settings?, name? }` (top level or in `data`) -> `{ success, deviceId, command, commandId?, queued?, error?, code? }`. Online: relays `device_command` and waits up to 6 s for the ack (`ACK_TIMEOUT`). Offline: `set_settings` and `rename` are stored (`queued: true`) for the next identify; other commands fail with `DEVICE_OFFLINE`. Settings and name changes show in `list_devices` at once. Destructive (read-only sessions get `READONLY_RESTRICTED`). |
| `device_preview_images` | `device_preview_images_response` | `{ deviceId?, settings?, limit? }` -> `{ success, total, items, workspaces: [{ id, name }] }`. What a device would show with its stored settings overlaid by `settings` (unsaved form values); `items` is the first `limit` (default 12, max 60). The SideShow settings page's count and thumbnails. Non-admin: `success: false, code: "INSUFFICIENT_PERMISSIONS"`. |
| `device_forget` | `device_forget_response` | `{ deviceId }` -> `{ success, deviceId, removed }`. Deletes the stored device; it comes back the next time it identifies. Destructive. |

## Push

| Type | When | Data |
|---|---|---|
| `devices_updated` | To admin tabs (not device sockets) when a device identifies, reports state, closes, or a command / forget changes it; coalesced to one per 250 ms | `{ devices }`, the `list_devices` shape |

## Application keys

`client_identify`, `client_device_state`, `device_command_ack` and `device_slideshow_images` are in the `gallery` scope
(`modules/applicationAuthManager.js`), next to `request_gallery`.

Test: `node scripts/test-slideshow-devices.js`.
