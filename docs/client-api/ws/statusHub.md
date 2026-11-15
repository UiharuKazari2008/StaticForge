# Status hub (server-push status feeds) and boot notes

Modules: `modules/ws/statusHub.js`, `modules/ws/handlers/294-statusHubHandler.js`,
`modules/ws/handlers/169-clientBootNoteHandler.js` (Nov 15 2026; rule
`.cursor/rules/server-push-not-polling.mdc`).

Clients do not poll for status on intervals. Each status source is one **feed** with one server
timer, shared by every subscriber. The timer runs only while someone is subscribed, reads the
upstream once per tick, and pushes only the items that changed, only to that feed's subscribers.
Each feed decides who may subscribe (`allow(clientInfo)`).

## `status_subscribe`

Request: `{ type: "status_subscribe", feed: "<name>", requestId }`

Response: `{ type: "status_subscribe_response", requestId, feed, items, data: { feed, items }, timestamp }`
— the feed's current state (sampled now if nothing is kept). `items` beside `data` is kept for
older readers.

Errors: unknown feed → `NOT_FOUND` ("Unknown status feed"); a refused or failed subscribe →
`STATUS_SUBSCRIBE_FAILED` (or the feed's own error code).

## `status_unsubscribe`

Request: `{ type: "status_unsubscribe", feed: "<name>", requestId? }`

Response (only when `requestId` is sent): `{ type: "status_unsubscribe_response", requestId, ok: true }`.
A subscriber also leaves on socket close or a failed send.

## Pushed packet

`{ type: <feed pushType>, feed, changed: { key: value }, removed: [key], timestamp }` — sent only when
an item differs from the last value sent; nothing while nothing changes.

## `client_boot_note` (fire-and-forget)

`{ type: "client_boot_note", shell, entry: { desktopMs, nav, note: { reason, hidden, screenOff, from } | null } }`

A page that just booted reports why (`melatonBootLog` in `public/scripts/comp/modalUtils.js`).
The server writes one `📱 boot …` log line per boot (device guessed from the user agent);
`note: null` means started outside the page (Android app or OS). Authenticated sockets only; no reply.

## `client_dormant` (fire-and-forget)

`{ type: "client_dormant", on: true|false }`

A phone page whose screen went off, or that went behind another app, says so. The server then holds
status pushes nothing is waiting on (`WebSocketServer.setDormant`) and sends them when it wakes.
New mail still goes at once. Authenticated sockets only; no reply.
