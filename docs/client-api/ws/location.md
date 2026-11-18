# Location (client WS)

Modules: `modules/locationService.js`, `modules/ws/handlers/310-locationHandler.js` (Yozora #907, Nov 17 2026).
This is the one place Melaton keeps Home / Work and turns typed places and points into places. Traffic and Weather
read Home / Work from here. Until a place is saved here, the older config (`traffic.home/work`, `weather.places`)
stands in.

Reading needs `admin` or `dev_admin`; `location_places_save` needs `admin`. Any other client gets
`INSUFFICIENT_PERMISSIONS` ("Admin access required"). A failed lookup answers `sendError` with the service's code
(`BAD_POINT`, `AUTH_FAILED`, `PROVIDER_ERROR`) or `LOCATION_ERROR`.

**Specificity**, finest first: `exact` (an address or building), `approximate` (a street, neighbourhood or postal
code), `city`, `county`, `state`, `country`. `max` is the finest an app wants: a finer answer is cut down to it (name,
components and point coarsened). `min` is the coarsest it can use: a coarser answer is left out.

A place is `{ label, address, lat, lon, specificity, components: { number?, street?, neighborhood?, city?, county?,
state?, stateCode?, postal?, country?, countryCode? }, source ("google"|"openmeteo") }`. Saved places also carry `typed`.

| Request | Fields | Response `data` |
| --- | --- | --- |
| `location_places_get` | none | `{ places: { home, work }, specificities: [..] }` |
| `location_places_save` | `home?`, `work?` (a place, or `null` to clear; a key you leave out stays as it is) | `{ places }`. Admin only, marked destructive. Broadcasts `location_places_changed` |
| `location_resolve` | `query` (2-200 chars), `min?`, `max?`, `limit?` (1-10, default 5), `near?` `{ lat, lon }` | `{ results: [place] }` |
| `location_reverse` | `lat`, `lon`, `specificity?` (default `city`) | `{ place }` or `{ place: null }` |

`location_resolve` uses Google Geocoding with the `googlemaps` service key. Without a key, or when Google finds
nothing, it falls back to Open-Meteo's geocoder, which only knows towns (`city`). Results are cached for 30 days by
query. `location_reverse` needs the Google key (no key gives `null`). It is cached on a grid sized to the specificity,
so a coarse ask shares one answer across a wide area.

## `location_places_changed` (broadcast)

`{ type: "location_places_changed", data: { places: { home, work } } }`. Sent after a save, and when an older
Traffic / Weather place is first adopted.
