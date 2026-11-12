# ActiveSync protocol

How a phone running the Dreamscape app for Android talks to the desktop (Yozora #747). The packets are in
[client-api/ws/activeSync.md](./client-api/ws/activeSync.md); this page is what a second speaker (the app's background
service in DSApp-Kotlin) needs to know to join.

## One protocol, two speakers on the phone

- **WebView** (`speaker: "webview"`): `public/scripts/comp/activeSyncAgent.js` inside the app, while the app is open.
  It can ask the user things, so `partnership.propose`, trash, restore and opening a file are its alone.
- **Service** (`speaker: "service"`): the app's own foreground service on its own socket, with the same session cookie
  and the same device id. It keeps the device reachable while the WebView is gone. It lists only the operations it
  serves itself (`status.*`, `storage.*`, `stream.*`, `device.ring`, ...). It never answers `partnership.propose`.

Both say `as_hello` with the same `id`. The server treats them as one device: one connection state, one permission
set; a call goes to the service when it lists the operation (it keeps running while the WebView is paused), else to
the WebView.

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
kept by the app, and `getDeviceName()` the phone's own name (optional). `ring()` is the native find-my-device ring,
`setSession(session)` takes the page's connection state. The WebView uses them when the bridge exists,
so both speakers and a reinstalled WebView profile stay one device. Without the bridge the WebView keeps its own id in
`localStorage.activeSyncPeerId`.

## Staying connected

The background link is a partner's. The server refuses a service's `as_hello` for a device without a partnership
(`NOT_PARTNER`), and drops the service's socket as a device when its partnership ends; a guest is connected only while
its app is open. The page tells the app how it is connected (`AndroidActiveSync.setSession(session)`), and the app
runs the link only while it is bonded.

For a bonded phone with "Stay connected to the desktop" on (the app's Settings, on by default) the foreground service
and its link outlive the app's window and start again with the phone (`ActiveSyncBootReceiver`), until the service's
notification is closed.

## Rules

- Never guess a status field: leave it out when the platform does not say.
- File contents never travel in `as_call` arguments (1 MB cap): they go through the HTTP endpoints in [client-api/ws/activeSync.md](./client-api/ws/activeSync.md#file-bodies-http). A service answers `stream.send` by posting the file in ordered chunks of about 1 MB and stops on a 410; it answers `stream.receive` by fetching `.../data` in ranges and writing them.
- A guest connection ends with the last socket of the device; only a partnership survives a reconnect.

## Clipboard and links

`public/scripts/comp/activeSyncClipboard.js` registers the same two operations on both kinds of peer
(permission group "Clipboard and links"):

| Operation | Arguments | Does |
| --- | --- | --- |
| `clipboard.set` | `{ text }` (200,000 characters at most) | puts the text on the receiver's clipboard |
| `open.url` | `{ url }` (http or https only) | opens it: Internet Explorer on the phone, an Alchemy tab on the desktop |

A browser lets only the window in use write the clipboard, so a desktop that is not in front keeps the
text and writes it at the next click, key or focus. A computer may queue both for an offline partner.
Device Center lists them under Programs and Services; the phone's ActiveSync program has Send Clipboard
and Send Link... in its Menu.
