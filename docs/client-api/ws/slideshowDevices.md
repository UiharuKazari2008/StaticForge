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
| `client_identify` | `client_identify_response` | `data: { kind, deviceId, name, app, model, os, display: { width, height, orientation }, settings, deviceConfig?, gadgets? }` -> `{ success, deviceId, name, settings? }`. Send after every connect. `kind` must be `slideshow` (else error `BAD_DEVICE_KIND`); `deviceId` 12 hex (`BAD_DEVICE_ID`). Strings are clamped to 64 characters. The reply's `settings` holds only what Control Panel changed while the device was offline (apply and persist the keys you know); `name` is the stored name (a Control Panel rename wins). Both are cleared once sent. `deviceConfig` / `gadgets`: see [Device-specific settings and gadgets](#device-specific-settings-and-gadgets); device settings Control Panel changed while the device was offline follow the reply as a `set_device_config` command. |
| `client_device_state` | none | `data: { deviceId, state, showing, since, mode?, face?, scheduleEntry? }`. Fire-and-forget on every slide and state change. `state`: `showing`, `paused`, `offline_cache`, `signin_needed`, `stopped`. `showing`: one gallery filename, or two for a portrait pair. Send `stopped` when the screensaver ends; the socket's close marks the device offline. Ignored before `client_identify`. A gadget device adds `mode` (`slideshow` or `clock`, what is on screen), `face` (the clock face while `mode` is `clock`, else `null`) and `scheduleEntry` (the active time frame's index, or `null`); it sends the state again whenever a time frame starts or ends, and the stored `gadgets` follow it. |
| `client_device_config` | none | `data: { deviceId, deviceConfig, gadgets }`. Fire-and-forget whenever the device's own values change (a command, the device's own settings page, a restart). Replaces the stored copy and refreshes Control Panel (`devices_updated`). Ignored before `client_identify` or for another device's id. |
| `client_device_preview` | none | `data: { deviceId, version, model, width, height, frame, mask, screen: { x, y, width, height, sourceWidth, sourceHeight }, shape? }`. Fire-and-forget, once per connection after `client_identify`. See [Device preview](#device-preview-physical-representation). |
| `client_device_screen` | none | `data: { deviceId, format: "jpeg", image, width, height, at }`. Fire-and-forget live capture of the whole device screen (~480 px long side, 20-40 KB); after slide / mode changes and every 30 s while a clock shows. |
| `device_command_ack` | none | `{ commandId, data: { ok, error? } }`, the answer to a `device_command`. For `set_device_config` / `set_mode`: `{ ok, applied: [keys], rejected: { key: reason }, restarting }` (`ok` false if anything was rejected; `restarting`: a non-live key changed, the device reconnects in about a second). |
| `device_slideshow_images` | `device_slideshow_images_response` | `{ offset?, limit?, seed? }` -> `{ success, deviceId, total, offset, items: [{ filename, width, height, mtime }] }`: one page (default 500, max 2000) of the pictures for this device's stored settings. Newest first; with a `seed` (any integer the device keeps until it reloads) the same seeded shuffle every call, so a device pages through a stable random order. `total` counts the whole rotation. No pool limit unless `poolSize` is set. The server keeps the resolved list 2 minutes per settings; names and sizes only, the device loads each picture (`/previews/<base>.webp` or `/images/<filename>`) as it shows it. Workspace pictures follow `viewType`; an Image Search follows its own query; `maxAgeDays` filters both (search results are dated by the filename's leading timestamp). Before `client_identify`: `success: false, code: "NOT_IDENTIFIED"`. |

### Settings keys

| Key | Values |
|---|---|
| `viewType` | `images`, `pinned`, `upscaled` |
| `intervalSec` | 5 - 86400 seconds per picture (Control Panel enters it in seconds, minutes or hours) |
| `poolSize` | 0 (default) = every matching picture; otherwise only the newest N (up to 1000000) |
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

## Device-specific settings and gadgets

Protocol v1 (the Windows Dreamscape SlideShow, `DS-SlideShow-win64/docs/DEVICE_CONFIG_PROTOCOL.md`; the Device Simulator
implements a small one). The server never knows these fields: it stores what each device declares, validates changes
against that, and Control Panel draws its forms from it. A device that sends neither (Dreamscape Frame on Android) has
none, and the page shows nothing extra.

- `deviceConfig`: `{ version: 1, schema: [field...], values: { key: value } }`. A field is `{ key, label, group, type,
  options?, min?, max?, step?, unit?, maxLength?, help?, live?, item?, maxItems? }`; `type` is `bool`, `int`,
  `number`, `string`, `enum` (`options: [{ value, label }]`) or `list` (an array of objects, each described by the
  `item` descriptors, at most `maxItems`). List items may also use `time` (`"HH:mm"`, 24 h) and `days` (weekday
  numbers 0 = Sunday ... 6; empty = every day). `live` fields apply at once; others make the device restart its
  slideshow. Unknown descriptor properties are kept; an unknown `type` is shown read-only. Stored: at most 500 fields
  and 256 KB; values for keys outside the schema are dropped.
- `gadgets`: `{ mode, face, selectedMode, selectedFace, scheduleEntry, available: [{ id, name, faces? }] }`;
  `available` lists `slideshow` and `clock` (`faces: [{ id, name, kind: "analog" | "digital" }]`); `selectedMode` /
  `selectedFace` are the manual choice, `mode` / `face` what is on screen.
- Clock time frames are ordinary settings: `schedule.enabled` (bool) and `schedule.entries` (list of `{ start, end,
  days, mode, face }`). The device evaluates them itself; the first frame covering its local time wins, `end` before
  `start` runs past midnight.

Server-side validation of `set_device_config` (`device_send_command`): every key must be in the stored schema
(`unknown setting`), `bool` a boolean, `int` a whole number and `int` / `number` within `min` / `max`, `string` text
within `maxLength`, `enum` one of `options`' values, `list` an array within `maxItems` whose items' known keys pass their
descriptors (`time`, `days` included; unknown item keys are dropped). Any bad key fails the whole command with
`code: "BAD_DEVICE_CONFIG"` and `rejected: { key: reason }`, and nothing is sent. A device without a stored
`deviceConfig` gets `NO_DEVICE_CONFIG`. `set_mode` needs the gadget in `available` (`BAD_MODE`) and `face` among the
clock's faces (`BAD_FACE`).

## Device preview (physical representation)

Wire format: section 4 of `DS-SlideShow-win64/docs/DEVICE_CONFIG_PROTOCOL.md`. A device (the WACCA cabinet's Windows
Dreamscape SlideShow, the Device Simulator) sends a front-on picture of itself so Control Panel can draw it as it looks.

- `client_device_preview`: `frame` and `mask` are base64 PNGs (a `data:` URL prefix is accepted), the same size,
  at most 4 MB each decoded; `frame` is transparent where the screen is, `mask`'s alpha is where the capture shows.
  `width` / `height` (1 - 8192, whole px) are the frame size and every other number is in those units. `screen` is
  where the **whole** screen capture goes (it already carries the offsets / scale that put the visible part behind
  the opening). `shape` is optional: `{ type: "circle", cx, cy, r }` or `{ type: "rect", x, y, width, height }`.
  Not PNGs or a missing / non-finite `screen` field: ignored. Ignored before `client_identify` or for another
  device's id. Stored: the PNGs as files in `slideshow_previews/<deviceId>/` next to the sqlite, the geometry in its
  `preview` column; a new preview replaces the old one, `device_forget` deletes them. Refreshes Control Panel
  (`devices_updated`).
- `client_device_screen`: JPEG only, at most 512 KB decoded. Kept in memory, the latest one per device (lost on a
  server restart; dropped once a device has been offline for 6 hours). `at` is the device's clock (the server's
  receipt time if missing or more than a day off). Admin tabs get `device_screen_updated { deviceId, at }`, at
  most one per device per second (the newest `at`).

Both are read-only-PIN safe (not destructive) and in the `gallery` application-key scope.

Images, **administrators only** (`userType: "admin"`; anything else gets 403 `INSUFFICIENT_PERMISSIONS`), behind the
normal session auth:

| `GET` | Type | Caching |
|---|---|---|
| `/api/sideshow/devices/:deviceId/preview/frame.png` | `image/png` | `private, no-cache` + `ETag` (revalidated, 304 when unchanged) |
| `/api/sideshow/devices/:deviceId/preview/mask.png` | `image/png` | `private, no-cache` + `ETag` |
| `/api/sideshow/devices/:deviceId/preview/screen.jpg` | `image/jpeg` | `private, no-store` |

404 `NOT_FOUND` when the device sent no preview (frame / mask) or no capture yet (screen). Control Panel adds
`?v=<preview.updatedAt>` / `?v=<preview.screenAt>` so a new image is a new URL.

Control Panel (Melaton SideShow, `cplPages2.js` `ssPhysicalHtml`) draws: a layer with `mask-image: url(mask.png)` /
`mask-size: 100% 100%` holding the capture absolutely positioned at `screen` as percentages of `width` / `height`,
then `frame.png` over it. Without a capture it shows the picture on screen (`/previews/<base>.webp`, `object-fit:
cover`) in the same place; without a preview, the old icon / bezel drawing.

## Server to device

`device_command`: `{ type: "device_command", commandId: "c-...", data: { command, filename?, settings?, name?, config?, mode?, face? } }`

| `command` | Extra | Device |
|---|---|---|
| `next` / `previous` | | advance / go back |
| `pause` / `resume` | | freeze or resume the timer |
| `show` | `filename` | show that picture next (pair it if portrait) |
| `refresh` | | re-fetch the gallery |
| `set_settings` | `settings` | apply, persist, refresh |
| `rename` | `name` | persist the new name |
| `set_device_config` | `config` | `{ key: value }`, only the keys to change; validate against the device's own schema, apply the valid ones, ack with `applied` / `rejected` / `restarting`, then send `client_device_config` |
| `set_mode` | `mode`, `face?` | the same as `set_device_config` `{ mode, clockFace }`; always live; sets the manual choice (an active time frame still wins) |

## Control Panel packets (admin)

| Request type | Response | Notes |
|---|---|---|
| `list_devices` | `list_devices_response` | `{}` -> `{ success, devices: [{ deviceId, kind, name, app, model, os, display, online, lastSeen, firstSeen, state, showing, since, settings, pendingSettings, pendingName, preview }] }`. `preview` is `null` until the device sends `client_device_preview`, then `{ version, model, width, height, screen, shape, updatedAt, hasScreen, screenAt, screenWidth, screenHeight }` (metadata only; the images are on the HTTP routes above). Online first, then by last seen. A device is online while its socket is open and has not reported `stopped`. A non-admin session gets `{ success: false, code: "INSUFFICIENT_PERMISSIONS", devices: [] }` (an answer, not an error packet). Devices that declare them also carry `deviceConfig`, `gadgets` and `pendingDeviceConfig` (the keys queued for the next connect, or `null`); the last-known config stays while the device is offline. |
| `device_send_command` | `device_send_command_response` | `{ deviceId, command, filename?, settings?, name?, config?, mode?, face? }` (top level or in `data`) -> `{ success, deviceId, command, commandId?, queued?, applied?, rejected?, restarting?, error?, code? }`. Online: relays `device_command` and waits up to 6 s for the ack (`ACK_TIMEOUT`). Offline: `set_settings` and `rename` are stored (`queued: true`) for the next identify, `set_device_config` and `set_mode` (as `{ mode, clockFace }`) are merged into `pendingDeviceConfig` and sent as one `set_device_config` right after the next identify reply (queued again should the device not answer); other commands fail with `DEVICE_OFFLINE`. `set_device_config` / `set_mode` pass the ack's `applied`, `rejected` and `restarting` through (`success` is the ack's `ok`), or fail validation as above. Settings and name changes show in `list_devices` at once. Destructive (read-only sessions get `READONLY_RESTRICTED`). |
| `device_preview_images` | `device_preview_images_response` | `{ deviceId?, settings?, limit? }` -> `{ success, total, items, workspaces: [{ id, name }] }`. What a device would show with its stored settings overlaid by `settings` (unsaved form values); `items` is the first `limit` (default 12, max 60). The SideShow settings page's count and thumbnails. Non-admin: `success: false, code: "INSUFFICIENT_PERMISSIONS"`. |
| `device_forget` | `device_forget_response` | `{ deviceId }` -> `{ success, deviceId, removed }`. Deletes the stored device; it comes back the next time it identifies. Destructive. |

## Push

| Type | When | Data |
|---|---|---|
| `devices_updated` | To admin tabs (not device sockets) when a device identifies, reports state or its own settings (`client_device_config`), sends a preview, closes, or a command / forget changes it; coalesced to one per 250 ms | `{ devices }`, the `list_devices` shape |
| `device_screen_updated` | To admin tabs when a device sends a `client_device_screen`; at most one per device per second | `{ deviceId, at }`; fetch `screen.jpg` again (the list's `preview.hasScreen` / `screenAt` follow) |

## Application keys

`client_identify`, `client_device_state`, `client_device_config`, `client_device_preview`, `client_device_screen`, `device_command_ack` and `device_slideshow_images` are in the `gallery` scope
(`modules/applicationAuthManager.js`), next to `request_gallery`.

Test: `node scripts/test-slideshow-devices.js`.
