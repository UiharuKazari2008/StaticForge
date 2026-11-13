# WebSocket: Traffic

Server handler: `modules/ws/handlers/292-trafficHandler.js` (logic in `modules/trafficService.js`). Yozora #795.
Client: Melaton Mobile Traffic and its Today items (6.1 / 6.5).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Home, Work and the route are the household admin's commute. Reads need `admin` or `dev_admin`; `traffic_settings_save` needs `admin`.

## Packet index

| Request | Body -> reply |
|---|---|
| `traffic_get` | `{}` -> `{ settings, latest: { work, home }, providers }` |
| `traffic_check` | `{ direction: 'work'|'home', force? }` -> a fresh report |
| `traffic_advise` | `{ direction, force? }` -> the leave advisor (Google only) |
| `traffic_settings_save` | `{ settings }`, merged into config `traffic`. Admin, destructive. |

## Broadcasts (admin clients)

- `traffic_updated` `{ direction, report }` after every check
- `traffic_report` `{ kind: 'scheduled'|'go', direction, report, advice?, error? }`
- `traffic_settings_changed` `{ settings }`
