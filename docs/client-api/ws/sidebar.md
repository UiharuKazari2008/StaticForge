# WebSocket: Windows Sidebar

Server handler: `modules/ws/handlers/290-sidebarHandler.js` (helpers in `modules/sidebarGadgets.js`).
Client: `public/scripts/comp/vistaSidebar.js`, `public/css/vista-sidebar.css`. Yozora #486.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Every packet is admin only. A non-admin session gets `type: "error"` with code `INSUFFICIENT_PERMISSIONS`.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `sidebar_get` | `sidebar_get_response` | admin | `{ workspaceId? }` -> `{ workspaceId, sidebar, saved }`. No id = the session's active workspace. `saved: false` = never saved (the client seeds Clock, Slide Show, Mail on first start). |
| `sidebar_save` | `sidebar_save_response` | admin/destructive | `{ workspaceId?, sidebar }` -> `{ success, workspaceId, sidebar }` (sanitized). Stored at `workspaces[id].sidebar`. Bad shape = error `INVALID_SIDEBAR_STATE`. |
| `sidebar_random_image` | `sidebar_random_image_response` | admin | `{ workspaceId?, source: "images"\|"pinned", offset?, search? }` -> `{ workspaceId, total, index, item }`. `pinned` = favorites. Integer `offset` walks newest-first (wraps); no offset = random. A Slide Show `search` (below) replaces `source`: the same full-text block search as `omegasearch_query`, its filename list cached per search for 5 minutes, `offset` then walks result order. `item` is `{ base, original, upscaled, width, height }` or null. |
| `sidebar_weather` | `sidebar_weather_response` | admin | `{}` -> `{ available, location: { city, region, country, source }, current: { tempC, feelsC, code, isDay }, daily: [{ date, code, maxC, minC, feelsMaxC, feelsMinC, rainChance, uvMax }] }`. Location comes from the client IP (the same lookup and cache as dynamic generation). LAN / private IPs and failed lookups use the configured location in `secure.config` (`source: "configured"`); never the host's own IP. Codes are WMO (Open-Meteo). |
| `sidebar_host_metrics` | `sidebar_host_metrics_response` | admin | `{}` -> `{ cpu, ram }` percent, the host figures Periscope shows (`pm2Service.getHostMetrics`). |
| `sidebar_system_info` | `sidebar_system_info_response` | admin | `{}` -> `{ cpu: { name, mhz, cores: [percent], total }, memory: { totalBytes, freeBytes }, uptimeSec, disks: [{ letter, label, mount, totalBytes, freeBytes, readBps, writeBps, busy }], network: [{ name, rxBps, txBps, rxBytes, txBytes, speedBps, ip, mac }], processes: [{ pid, name, cpu, memBytes }], at }`. The server's own machine for hosted gadgets (System.Machine, System.Shell.drive, WMI). Sampled at most once a second (`modules/sidebarSystemInfo.js`); disks are mounted block devices lettered from C: (the root); processes are the top 12 by CPU, every 3 s. |
| `sidebar_fx` | `sidebar_fx_response` | admin | `{ from, to }` ISO codes from the ECB set -> `{ available, from, to, date, rate }`. `rate` converts 1 `from` into `to` (Frankfurter, cached a few hours). |
| `sidebar_quotes` | `sidebar_quotes_response` | admin | `{ symbols }` up to 4 (`A-Z`, digits, `.`, `^`, 12 chars) -> `{ quotes: [{ symbol, name, price, prev, currency, available }] }`. Yahoo chart, cached a few minutes. |
| `sidebar_feed` | `sidebar_feed_response` | admin | `{ url }` https only -> `{ available, title, items: [{ title, link, date }] }` (at most 12). Private, link-local, and single-label hosts are refused. Redirects are re-checked. Body cap 256 KB. Cached 10 minutes. |

## Push

| Type | When | Data |
|---|---|---|
| `sidebar_updated` | After a `sidebar_save`, to every other admin session | `{ workspaceId, sidebar }` |

## Sidebar state

```json
{
  "enabled": true,
  "closed": false,
  "side": "right",
  "onTop": false,
  "gadgets": [
    { "id": "g1", "type": "clock", "docked": true, "x": 0, "y": 0, "onTop": false, "opacity": 100, "settings": {} }
  ]
}
```

- `enabled`: the Sidebar runs (tray icon shown). `closed`: the pane is hidden; desktop gadgets stay.
- `docked` gadgets are in the pane in array order; detached ones sit at `x`, `y` with `onTop` and `opacity` (20, 40, 60, 80, 100).
- At most 24 gadgets and 64 KB per workspace. Unknown types and duplicate ids are dropped.

| Type | Settings |
|---|---|
| `calendar` | `view`: `day` \| `month` |
| `clock` | `theme` 0-7, `name` (30 chars), `timeZone` (IANA, empty = computer time), `seconds` |
| `hero` | same as `clock`, `theme` 0-11 (HTC Hero faces, then Vista Orb Clock's globe, globe2, acw) |
| `calculator` | `color` (`grey`, `pink`, `yellow`), `historyOn`, `entry`, `acc`, `op`, `fresh`, `memory`, `history` (up to 8 lines) |
| `deskcalc` | `color` (`plain`, `aqua`, `black`, `blue`, `green`, `pink`, `red`, `white`, `yellow`) plus the same arithmetic fields as `calculator`. Scientific keys show when the gadget is undocked |
| `timer` | `endAt` (ms, 0 = not running), `mins` (0-60), `secs` (0-59), `ringing` |
| `clipboard` | `items` (up to 16 strings, 160 chars). Filled from copies inside Dreamscape |
| `contacts` | `cards` (up to 8 of `name` 40, `email` 80, `phone` 24), `current`. Stored on the gadget; Dreamscape has no address book |
| `cpu` | none |
| `currency` | `amount` (0 to 1e12), `from`, `to` (ECB codes: USD, EUR, GBP, JPY, and the rest of the Frankfurter set) |
| `feed` | `url` (https, 300 chars), `count` (3, 4, 5, 6) |
| `mail` | `unreadOnly`, `count` (3, 4, 5, 6) |
| `outlook` | `unreadOnly`. Same Dovecote Inbox as Mail, drawn on the Sidebar Outlook skin |
| `notes` | `color`, `font`, `size` (px), `notes` (up to 10 x 1000 chars), `current`, `noteId` (Notion note id or `''`; when set the gadget reads and writes that note through `notes_get` / `notes_save_content` and refreshes on `note_content_updated`, `note_updated`, `note_deleted`) |
| `puzzle` | `source`, `base` (picture), `tiles` (16-permutation or null), `seconds` |
| `slideshow` | `source`, `seconds` (5, 10, 15, 30, 60, 120, 300), `transition` (`none`, `random`, `fade`, `wipe`, `iris`, `slide`, `push`), `shuffle`, `shape` (`landscape` 4:3, `square`, `portrait` 3:4), `scale` (1 to 2.5, undocked size from the corner grip), `search` (null, or an Image Search saved with "Show in photo frame": `{ blocks, workspaceId, viewType, promptSource, filters, blockOptions: { defaultMatchMode }, label }`, the `omegasearch_query` fields, at most 4 KB). The Image Search DSAP shows that button only when opened with `frame=<gadget id>` (`dsap://ispy.dreamscape.jp/?...&frame=g1`). |
| `stocks` | `symbols` (up to 4, 12 chars, `A-Z` `0-9` `.` `^`) |
| `weather` | `unit` (`F`, `C`), `feelsLike` (apparent temperature for current, today and forecast), `hidePlace`, `placeAlt` (shown instead of the place when hidden: `none`, `hilo`, `rain` = today's chance %, `condition`, `uv` = today's peak with its level) |

Mail reads Dovecote with the existing `dovecote_list_mail` / `dovecote_list_mailboxes` packets (`modules/ws/handlers/250-dovecoteHandler.js`).
