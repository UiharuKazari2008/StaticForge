# WebSocket: Server Manager

Server handler: `modules/ws/handlers/307-serverManagerHandler.js`. Client: `public/scripts/comp/mmcServerManager.js`
(the Server Manager console's root page, Server Summary). Yozora #831 slice 5.

Admin only (`admin`, `dev_admin`); read only.

## `server_manager_summary`

Request: `{}`.

Reply `data`: `{ success, host, platform, version, osUptimeSec, processUptimeSec, startedAt, clients, frontGate }`

- `host`: the server's host name; `platform`: `os.type() os.release()`; `version`: package.json's version.
- `osUptimeSec`: the machine's uptime; `processUptimeSec` / `startedAt`: the Dreamscape process's.
- `clients`: open sockets now: `{ sessions (all), signedIn, desktops (signed-in tabs that are not phones or
  devices), phones (Melaton Mobile tabs), devices (slideshow / SideShow devices) }`.
- `frontGate`: `{ enabled, cover }` (the cover site's slug), or `null` when it could not be read.

On failure: `{ success: false, error, details }`.
