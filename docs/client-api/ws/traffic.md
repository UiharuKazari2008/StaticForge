# WebSocket: Traffic

Server handler: `modules/ws/handlers/292-trafficHandler.js` (logic in `modules/trafficService.js`). Yozora #795.
Client: Melaton Mobile Traffic and its Today items (6.1 / 6.5).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Home, Work and the route are the household admin's commute. Reads need `admin` or `dev_admin`; `traffic_settings_save` needs `admin`.

## Packet index

| Request | Body -> reply |
|---|---|
| `traffic_get` | `{ have? }` -> `{ settings, latest: { work, home }, providers, hash }`. `hash` is `'<work report hash>\|<home report hash>'` (`''` for a missing report). `have` (#890 round 5, W4): that string, or `{ work, home }` report hashes the page holds; when both match, `{ same: true, settings, providers, hash }` without `latest`. |
| `traffic_check` | `{ direction: 'work'|'home', force?, origin? }` -> `{ report, providers }`, a fresh report. `origin { lat, lon }` (home only): To Home from the phone's position (rounded to ~110 m, no preferred streets); the report then has `fromHere: true` and `origin`. The asking socket gets the report here only, not again as `traffic_updated`. |
| `traffic_advise` | `{ direction, force? }` -> the leave advisor (Google only) |
| `traffic_settings_save` | `{ settings }`, merged into config `traffic`. Admin, destructive. |

## Broadcasts (admin phone pages)

All three are phone-only (`modules/websocket.js` PHONE_ONLY_TYPES: Traffic loads in the mobile shell only).

- `traffic_updated` `{ direction, report }` after every check, to everyone but the page that asked; a
  sleeping page gets the newest per direction when it wakes
- `traffic_report` `{ kind: 'scheduled'|'go', direction, report, advice?, error? }` (a notification: never held)
- `traffic_settings_changed` `{ settings }` (newest only for a sleeping page)

## Reports on the wire (#890 round 5, W4)

The server keeps the full report (`.cache/traffic-latest.json`); every reply and broadcast carries
`trafficService.wireReport(report)`:

- `preferredIndex` (number, always): the preferred route's index in `routes`. `preferred` is left out when
  it is `routes[0]` (the same route twice); read `report.preferred || report.routes[report.preferredIndex || 0]`.
- Routes other than the preferred one carry no `line` (the map strip and the drive watch draw the
  preferred route's); `steps` stay on every route (Directions).
- `hash`: the stored report's sha1, for `traffic_get { have }`.
