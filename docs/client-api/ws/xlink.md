# WebSocket: XLink Operator Console

Server handler: `modules/ws/handlers/297-xlinkHandler.js` (logic in `modules/xlink.js`).
Client: `apps/xlink/client/xlink.js` (Melaton system package `apps/xlink`, Start > XLink Operator Console). Yozora #719.

The console replaces the AVS-Menu web app ("XLink Global Management", github.com/UiharuKazari2008/AVS-Menu):
the arcade cabinets' control menu. The cabinets are HTTP boxes on the LAN, so every request to them is
made by the server. The client names a device, an item path and an operation; URLs come only from
`menu.json`, never from the packet.

See [WebSocket protocol](../websocket.md) for envelope format and auth. Every packet is admin only
(`admin`, `dev_admin`); anyone else gets `type: "error"`, code `INSUFFICIENT_PERMISSIONS`. A failure past
that comes back in the normal `_response` as `data.error: { message, details, code }`, not as an error
packet, so a cabinet that is off does not raise the desktop's Mainframe exception dialog.

## Files

In `.cache/packages/.data/xlink/` (`XLINK_DATA_DIR` overrides it in tests). They are read again whenever their
mtime changes.

| File | Holds |
|---|---|
| `menu.json` | `{ devices: { <key>: Device } }`, AVS-Menu's format unchanged |
| `config.json` | `{ captures: <server folder of .png screenshots>, all_captures: bool }` |

## Packet index

| Request type | Fields | Reply `data` |
|---|---|---|
| `xlink_info` | none | `{ dataDir, devices, problem, captures }` |
| `xlink_devices` | none | `{ devices: [{ key, name, icon, badges, status, items }] }`: devices sorted by `position`, each with its own status. No item polling. |
| `xlink_device` | `device`, `force?` | `{ key, name, icon, badges, status, items: [Item], polledAt, log, cached? }`: the device, every item and child polled in parallel, cached 4 s unless `force` |
| `xlink_action` | `device`, `path: [i, childIndex?]`, `op: send \| toggle \| slider`, `value?`, `confirmed?` | `{ confirm: { header, message, ok, icon, iconColor }, log }` when a warning applies and `confirmed` is not set; otherwise `{ ok, code, failure, log, snapshot }` (`snapshot` is the device polled again) |
| `xlink_captures` | none | `{ folder, all, configured, missing?, reason?, files: [{ name, mtime, size }] }`: `*.png`, newest first, at most 100, the last 7 days unless `all_captures` |
| `xlink_save` | `name: menu.json \| config.json`, `text` | `{ saved }`: File > Import in the console. The text must parse, and menu.json must have `devices`. |

`Item` = `{ text, icon, badges: [{ text, color, textColor }], append, status, kind, toggle, warning, endpoints, children: [Item] }`
- `status`: `null`, or `{ text, color, failed?, gated? }`.
- `kind`: `toggle`, `slider`, `button`, `folder` or `info`.
- `toggle`: `[{ label, icon, bg, color, active }]`.
- `warning`: true when the item has a usable warning.

`log` lines are `{ t, verb: POLL | CHECK | SEND | SET, url (host+path), code, ms, ok, error, body }`.

`GET /xlink/captures/<name>[?thumb=1]` (auth, admins) serves a capture, or a 240 x 160 JPEG thumbnail
(sharp, kept in memory).

## menu.json semantics (as AVS-Menu's server.js)

| Field | Behaviour |
|---|---|
| `status` + `replace` | `replace` rows are `[match, text, colour]`. A row matches when `match` is in the response body (case-insensitive substring); the **last** matching row wins. With no match the raw body is shown (trimmed). A non-200 answer or a transport error shows `FAILURE` in red. Timeout 10 s. |
| `pre_status` | `{ url, match, replace }`. If the pre body does not contain `match` (case-sensitive), the item shows the pre body (through `pre_status.replace`) and its `status` is not asked at all. |
| `toggle` | Each entry is `{ text, icon, url, bg, color, match: [{ str, text, icon, bg, color }] }` or a bare URL. The **first** entry with a `match[].str` found in the status text (after replace, case-insensitive) is lit. If the item has a status, some entry has `match`, and nothing matched, the **last** button is lit. A lit button takes its label, background and colour from the matching `match` first, then from the entry. Labels fall back to `I` / `O` with two buttons, else to the index. |
| `slider` | GET `slider + value`, value 0..100. The status is the trackbar position; `append` is the unit. |
| `children` | One level deep in AVS-Menu. Here any depth; `path` walks it. |
| `warning` | `{ header, message, ok, check, match, always, icon, icon_color }`. Shown when GET `check` contains `match` (case-insensitive, 3 s), or always when `always` is set. A failed check does **not** warn. It is asked for toggles and plain buttons; a child with no warning of its own uses its parent's (Game Select's discs, Network Config). |
| `badges` | `[{ text, color, text_color }]` |
| `position` | Device order |

Changes from AVS-Menu:
- `replace` is case-insensitive everywhere. In AVS-Menu, only the background scan was.
- A lit button's `match.color` sets its text colour. AVS-Menu wrote `match.bg` there.
- A toggle inside a folder asks its own warning first.
- Top-level plain buttons ask their warning too. AVS-Menu never did.
- All text is escaped.
- Polling: there is no 60 s background scan on the server. The open console polls the selected cabinet
  every 60 s (View > Auto Poll), and after each command.
- Icons: menu.json's Font Awesome names are drawn as Vista 16 px art (`ICONS` in the client); unknown
  names get the application icon.
