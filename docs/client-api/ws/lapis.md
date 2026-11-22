# WebSocket: Lapis Remote

Server handler: `modules/ws/handlers/293-lapisHandler.js` (logic in `modules/lapisService.js`; Hyundai BlueLink through `modules/bluelinkClient.js`). Yozora #835.
Client: Melaton Mobile Lapis Remote and its Today items (6.1 / 6.5), `public/scripts/comp/wmLapis.js`.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

The car is the household admin's. Reads need `admin` or `dev_admin`; commands, Refresh and every save need `admin`.
The server reads the car on its own clock and pushes what changed. Clients do not poll.

## Packet index

| Request | Body -> reply |
|---|---|
| `lapis_get` | `{}` -> `{ state }` (what the server holds; no call to the car) |
| `lapis_refresh` | `{ locate? }` -> `{ state }`. Wakes the car for a fresh report. Admin. |
| `lapis_command` | `{ kind: 'lock'|'unlock'|'start'|'stop', options? }` -> `{ command }`. Admin, destructive. |
| `lapis_history` | `{ range: 'week'|'month'|'quarter'|'year'|'all' }` -> series, days, trips, fill-ups |
| `lapis_vehicles` | `{}` -> `{ vehicles }`. Admin. |
| `lapis_settings_save` | `{ settings }`, merged into config `lapis` -> `{ settings }`. Admin, destructive. `settings.notify` switches: `unlocked`, `lowFuel`, `refuel`, `service`, `health` (all five health alerts), `battery12`, `tire`, `brake`, `washer`, `key`. |
| `lapis_service_done` | `{ id }` marks a maintenance item done now -> `{ settings }`. Admin, destructive. |
| `lapis_picture_get` | `{}` -> `{ picture, dataUrl? }` |
| `lapis_picture_save` | `{ dataUrl }` (PNG, JPEG or WebP, 900 KB at most) or `{ dataUrl: null }` for the built-in picture. Admin, destructive. |

`start` options: `{ auto?, temp, minutes, defrost, heating, seat, passengerSeat }`. With `auto` not false and
automatic climate on, the server takes its own climate pick; any given field overrides it. Temperatures are
sent inside the car's 62-82 °F range (its LO / HI ends). `heating`: 0 off, 3 steering wheel, 4 wheel, rear
glass and mirrors. `seat`: 0 off, 6-8 heat low to high, 3-5 cool low to high.

## State

`{ configured, vehicle, status, seenAt, location, parkedSince, climate, usage, maintenance, alerts, command, error, nextReadAt, limits, settings }`

- `status`: `{ at, locked, engine, climate, defrost, setTemp, fuel, fuelLow, range, odometer, battery12, doors, windows, trunk, hood, tireLow, washerLow, brakeFluidLow, keyBatteryLow }` (miles, °F)
- `location`: `{ lat, lon, heading, at, readAt, place }` (`place` is `Home`, `Work` or null)
- `climate`: the remote start pick `{ outdoorF, interiorF, solarGainF, temp, defrost, heating, seat, mode, reason[] }`
- `usage`: `{ today, refuel: { day, daysLeft, milesLeft, perDay[], beyond }, perPct, weekday, commute, miles7 }`
- `maintenance[]`: `{ id, label, everyMiles, everyMonths, lastOdo, lastDate, milesLeft, daysLeft, due, soon }`
- `command`: `{ id, kind, state: 'sent'|'success'|'failed'|'unconfirmed', at, detail?, runsUntil?, startOdo?, ended?, endedAt? }`. A start's `runsUntil` is cleared and `ended` set (`driving`, `off`, `timeout`) when the server sees the car move, the engine go off, or the time run out (a cached read every 3 minutes during the run).

## Broadcasts (admin clients)

- `lapis_updated` `{ state }` after every read, command step and settings change
- `lapis_notice` `{ id, kind, title, text, actions[] }`; `kind`: `unlocked` (action `lock`), `low-fuel`, `refuel`, `service`, `command`, `health` (the vehicle alerts, Nov 21 2026: one notice for every alert a read raised plus those still holding, `key` `alerts`, `stamp` `<item>=<step>,...`, `count` when more than one; one alert keeps its own title and text, several are titled `<car> needs attention` with a short line each; low fuel is one of them. Alerts wait while the engine runs and for 30 minutes after the car was last seen running; the unlocked reminder does not. Every alert is in `state.alerts` until a report clears it, whatever is switched off), `service` notices carry `key` `maintenance` (the day's items in one), `run-left` (with `minutes` 5 / 3 / 2 / 1 and `until`: a remote start on its timer is nearly over). Every notice carries a `stamp` naming the condition and period (Nov 22 2026, #1061): the inbox id is stable per kind (`lapis:<kind>` or `lapis:<kind>:<key>`: `lapis:refuel`, `lapis:unlocked`, `lapis:command`, `lapis:run-left`, `lapis:health:alerts`, `lapis:service:maintenance`) and keeps the stamp, so a notice is never said twice (not after a restart, not after it was dismissed) and a new stamp replaces it on the phones. Today's refuel reminder goes into the low-fuel alert while that holds (the alert's title becomes the reminder's, its fuel line ends `: get gas today`, `refuel` names the reminder's stamp)
