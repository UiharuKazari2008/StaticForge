# ActiveSync protocol

How a phone running the Dreamscape app for Android talks to the desktop (Yozora #747). The packets are in
[client-api/ws/activeSync.md](./client-api/ws/activeSync.md); this page is what a second speaker (the app's background
service in DSApp-Kotlin) needs to know to join.

## One protocol, two speakers on the phone

- **WebView** (`speaker: "webview"`): `public/scripts/comp/activeSyncAgent.js` inside the app, while the app is open.
  It can ask the user things, so the server sends it `partnership.propose` and prefers it for every operation it lists.
- **Service** (`speaker: "service"`): the app's own foreground service on its own socket, with the same session cookie
  and the same device id. It keeps the device reachable while the WebView is gone. It lists only the operations it
  serves itself (`status.*`, `storage.*`, `stream.*`, `device.ring`, ...). It never answers `partnership.propose`.

Both say `as_hello` with the same `id`. The server treats them as one device: one connection state, one permission
set; a call goes to the WebView when it lists the operation, else to the service.

## A service's life

1. Open `wss://<host>/` with the app's session cookie.
2. Send `{ "type": "as_hello", "requestId": "...", "kind": "device", "id": "<32 hex>", "speaker": "service", "ops": [...], "name", "model", "os", "app", "status": {...} }`.
3. Read `as_hello_response.data`: `session` is `pending`, `guest` or `partner`, `permissions` what the user granted.
4. On `as_request { callId, from, op, args }`: check the permission for the operation's group again (the phone has the
   last word), run it, answer `{ "type": "as_reply", "callId", "ok": true, "result": ... }` or
   `{ "ok": false, "error": { "code", "message" } }`. Unknown operations answer `UNSUPPORTED`.
5. On `as_event` from kind `server`, event `partnership.changed`: take the new `session` and `permissions`.
6. Send `as_status` when the battery, the network or the storage changes (at most every 5 seconds), and every 2 minutes.
7. Reconnect with backoff and say hello again; a partner's waiting items arrive as `as_request`s right after.

The app owns the device id: `window.AndroidActiveSync.getDeviceId()` returns 32 lowercase hex digits made once and
kept by the app, and `getDeviceName()` the phone's own name (optional). The WebView uses them when the bridge exists,
so both speakers and a reinstalled WebView profile stay one device. Without the bridge the WebView keeps its own id in
`localStorage.activeSyncPeerId`.

## Rules

- Never guess a status field: leave it out when the platform does not say.
- File contents never travel in `as_call` arguments (1 MB cap): they go through the HTTP endpoints in [client-api/ws/activeSync.md](./client-api/ws/activeSync.md#file-bodies-http). A service answers `stream.send` by posting the file in ordered chunks of about 1 MB and stops on a 410; it answers `stream.receive` by fetching `.../data` in ranges and writing them.
- A guest connection ends with the last socket of the device; only a partnership survives a reconnect.
