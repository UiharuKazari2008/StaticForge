# WebSocket: Weather

Server handler: `modules/ws/handlers/291-weatherHandler.js`. Every weather read goes through
`modules/weatherService.js` (Yozora #780): cache, rate limits, provider choice. Clients: Melaton
Mobile's Weather (`public/scripts/comp/wmWeather.js`), the alert notifications
(`public/scripts/comp/weatherAlerts.js`), the Sidebar's Weather (through `sidebar_weather` /
`sidebar_live`, [sidebar.md](sidebar.md)).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Provider

Apple Weather (WeatherKit REST) when an **Apple Weather** service key is saved (Dreamscape CardSpace >
Service keys, `apiKeyManager` service `appleweather`): the key value is the `.p8` private key, the
entry's fields are `teamId`, `serviceId`, `keyId`. The status dot signs a token and asks WeatherKit's
availability endpoint (`apiKeyHealth` `PROBES.appleweather`). Config `weather.provider: "openmeteo"`
turns Apple off without deleting the key; `weather.appleDailyBudget` (default 15000) caps Apple calls a
day. Open-Meteo answers otherwise, and whenever an Apple request fails (`fallbackFrom: "apple"`).

US alerts come from the National Weather Service when Apple's alerts are not in the reply.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `weather_forecast` | `weather_forecast_response` | signed in | `{ lat, lon, lang? }` -> the forecast model (below) plus `available: true`. `{ here: true }` (admins) uses the Sidebar's place (client IP, then the configured home) and adds `here: { name, region, country, lat, lon }`. |
| `weather_geocode` | `weather_geocode_response` | signed in | `{ name, count? }` -> `{ results: [{ name, region, country, countryCode, lat, lon }] }` (Open-Meteo geocoding, cached 7 days). |
| `weather_radar` | `weather_radar_response` | signed in | `{}` -> `{ frames: [{ time, id, nowcast }], maxZoom: 7, radarTile, baseTile, styles, attribution }`. Tiles: `GET /weather/tile/radar/<id>/<z>/<x>/<y>.png` (RainViewer, z ≤ 7, cached 30 min) and `GET /weather/tile/base/<style>/<z>/<x>/<y>.png` (Esri basemaps `dark`, `light`, `streets`, `labels`, `dark-labels`; z ≤ 16, cached 7 days). Both need the session cookie. |
| `weather_alert` | `weather_alert_response` | signed in | `{ id, lang? }` -> `{ id, title, area, severity, source, text, detailsUrl }`, the full text of an Apple Weather alert. |
| `weather_alerts_active` | `weather_alerts_active_response` | signed in | `{}` -> `{ place, alerts, source, checkedAt }` for the primary location (the configured home, secure config `location`). |

Errors carry the service's code: `BAD_COORDINATES`, `RATE_LIMITED`, `BUDGET_EXCEEDED`, `UNREACHABLE`, `AUTH_FAILED`, `HTTP_ERROR`, `NO_ACCOUNT`.

## Push

| Type | When | Data |
|---|---|---|
| `weather_alert_issued` | A new alert for the primary location (polled every 5 min), once per alert across restarts (`.cache/weather-alerts-seen.json`), to every signed-in client | `{ alert, place: { lat, lon, name, region, country }, source }` |
| `weather_alerts_changed` | The primary location's active list changed | same as `weather_alerts_active` |

## Forecast model

Times are the place's wall clock `YYYY-MM-DDTHH:MM`; `offset` is its UTC offset in seconds now, `tz`
its zone. °C, km/h, hPa, metres, mm (mm/h for intensity), percent.

```text
{ provider, attribution: { name, url, linkText, logoLight?, logoDark?, ... }, tz, offset, fetchedAt, stale?,
  current: { time, tempC, feelsC, dewC, humidity, code, text, conditionCode?, isDay, windKmh, windDir,
             gustKmh, pressure, pressureTrend, visibilityM, uv, cloud, precipMmH },
  minutely: null | { source, stepMinutes (1 Apple, 15 Open-Meteo), summary, periods, minutes: [{ time, rain, mmh }] },
  hourly: [{ time, tempC, feelsC, dewC, code, text, isDay, rain, precipMm, snowMm, humidity, windKmh,
             windDir, gustKmh, uv, pressure, visibilityM, cloud }],          // about 72 hours
  daily:  [{ date, code, text, maxC, minC, feelsMaxC, feelsMinC, rain, precipMm, snowMm, uv, windKmh,
             windMaxKmh, gustKmh, windDir, humidity, sunrise, sunset, dawn, dusk, solarNoon, moonrise,
             moonset, moonPhase, daylightSec, day: <part>, night: <part> }],   // 10 days
  alerts: [{ id, title, headline?, area, severity, urgency, certainty, source, issued, effective, expires,
             onset, ends, text?, instruction?, detailsUrl, provider? }], alertsSource? }
```

`code` is a WMO weather code (Apple's `conditionCode` mapped to the nearest one); `text` is the
provider's own words. Apple's attribution terms: show `attribution.logoDark` / `logoLight` and link
`attribution.url`.
