# WebSocket: Slideshow devices (Melaton SideShow)

Server handler: `modules/ws/handlers/298-slideshowDevicesHandler.js` (logic and storage in `modules/slideshowDevices.js`,
sqlite `.cache/slideshow_devices.db`). Clients: Dreamscape Frame (Android, `jp.net.seventhreeseven.dreamframe`), the
Device Simulator app (`public/scripts/comp/desktop-apps/sideshow/sideshowSimulator.js`, Yozora #655), and Control
Panel's Melaton SideShow pages (`public/scripts/comp/cplPages2.js`). Yozora #654.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Architecture and workflow

- Device records live in `.cache/slideshow_devices.db`. Each row stores the last identified device
  metadata, current settings, last state, and any pending `set_settings` / `rename` change waiting for
  the next reconnect.
- The live online list is derived from open WebSocket client info, not a second registry. When a
  device socket closes, the row stays installed and `lastSeen` is updated.
- Device sockets identify themselves with `client_identify`, then keep Control Panel current with
  `client_device_state` reports. Admin tabs receive debounced `devices_updated` pushes; device sockets
  never receive that push.
- Image selection is server-side for modern devices. `device_slideshow_images` applies the stored
  workspace, age-limit, view-type, pool-size, and Image Search settings before returning filenames.
  Devices only shuffle, pair portrait images, time slides, and render overlays.
- Devices are visible in `GET /agent/clients` / MCP `list_clients` for awareness, but have
  `bindable: false` and `desktopReady: false`, so agent auto-bind and manual bind never target them.

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

## Control Panel and simulator runbook

Melaton SideShow is managed from Control Panel's SideShow pages in `cplPages2.js`.

1. Open **Melaton SideShow**. The home page sends `list_devices`, renders one column per installed
   device, and stays fresh with `devices_updated`.
2. Click a device name to view connection state, reported model / OS, the Dreamscape Slideshow gadget
   link, rename, and uninstall. Rename is sent as `device_send_command` `rename`; forget calls
   `device_forget`.
3. Open **Dreamscape Slideshow settings** to pick the picture source:
   - Workspaces: selected ids, `["*"]` for all workspaces, or empty for the device session's active
     workspace.
   - Image Search: launched through the Image Search DSAP with `frame=sideshow:<deviceId>`; saving
     persists the sanitized search object.
   - Age limit, pool size, per-slide interval, shuffle, portrait pairing, and info overlay.
4. While the settings page is open, `device_preview_images` recomputes the unsaved form state after a
   short debounce and returns the matching count, preview strip, and workspace list.
5. Remote buttons (`previous`, `pause` / `resume`, `next`, `refresh`) require an online device and wait
   for the device ack. `set_settings` and `rename` are also written to the stored row immediately; if
   the device is offline, they are queued and included once in its next `client_identify_response`.

The desktop Device Simulator is a real SideShow client, not a mock of the Control Panel. Launch
**Simulator (Landscape mode)** or **Simulator (Portrait mode)** from the Start menu, or use Run aliases
`virtualsideshow.exe`, `sideshow simulator`, or `device simulator`. It connects with
`?dreamscapeClient=VirtualSideShow/3.0`, keeps its per-mode `deviceId` / settings in localStorage, sends
the same identify and state packets as an external Dreamscape Frame, requests `device_slideshow_images`,
and acks `device_command`.

## Application keys

`client_identify`, `client_device_state`, `device_command_ack` and `device_slideshow_images` are in the `gallery` scope
(`modules/applicationAuthManager.js`), next to `request_gallery`.

## Troubleshooting notes

- `client_identify` errors are usually `BAD_DEVICE_KIND` (only `slideshow`) or `BAD_DEVICE_ID` (not
  12 lowercase hex).
- `device_slideshow_images` returns `NOT_IDENTIFIED` until the socket has identified on this connect.
- `device_send_command` returns `DEVICE_OFFLINE` for remote navigation commands when no live socket is
  available; only `set_settings` and `rename` can queue offline.
- `ACK_TIMEOUT` means the command was relayed but the device did not send `device_command_ack` within
  6 seconds.
- Search-backed slides are ordered by the timestamp prefix in gallery filenames before size metadata
  is looked up. Undated search results may still appear, but age filtering can drop them.

Test: `node scripts/test-slideshow-devices.js`.
