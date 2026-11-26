# WebSocket: Daily weather pictures

Server handler: `modules/ws/handlers/294-notificationInboxHandler.js` (logic in `modules/weatherDaily.js`). Yozora #1126.
Client: the Weather app's workspace picture setting.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling. `admin` or `dev_admin`.

Once a day at `time` (server local clock, default `07:30`) the server reads the forecast of each configured place (`weatherService.getForecast`), builds a brief (place, the place's own weekday, season and conditions in words, no readings; the picture prompt carries `!dg_time, !dg_season, !dg_weather` and `generate_image` gets `dynamicGeneration { enabled, tod, weather, season, location: "<lon>_<lat>" }`) and starts a Yozora director session that draws one picture with `generate_image` into that workspace. Source `weather-daily:<workspace>:<date>` dedupes a rerun. Config `weatherDaily` in `config`: `{ enabled, time, places: [{ workspace, name, lat, lon }] }`, one place per workspace. The timer is armed at boot (when enabled) and re-armed on every change; `WEATHER_DAILY_OFF=1` disables it.

## Packet index

| Request | Body -> reply |
|---|---|
| `weather_daily_get` | `{}` -> `{ ok, enabled, time, places, status }`. `status`: `{ armed, nextAt, lastRun }` (`lastRun`: `{ at, results[] }`). |
| `weather_daily_set` | `{ workspace, name, lat, lon, on, time? }` -> same as `weather_daily_get`. `on: true` (default) adds or replaces the workspace's place; `on: false` removes it (`name`, `lat`, `lon` ignored). `time` `"HH:MM"` changes the shared daily time. `enabled` follows whether any place remains. `workspace`: non-empty string, at most 200 characters, kept as sent (the active workspace id); `lat` -90..90, `lon` -180..180. Error `INVALID_PARAMS` otherwise. Saves the config and re-arms the timer. Destructive. |
| `weather_daily_run` | `{ workspace? }` -> `{ ok, results, at }`. Runs now (only that workspace's place when given; an unknown workspace runs nothing) and answers once the sessions are started. `results[]`: `{ workspace, sessionId }` or `{ workspace, error }`. For testing. |
