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

## The link (#890)

- **Keep-alive.** The reverse proxy in front of the server cuts a connection after about 60 s with nothing sent towards the
  client. The server therefore never stays silent towards a socket for more than 35 s: when nothing else went out it sends
  a protocol ping (the app's WebSocket answers it by itself). Anything the app sends counts as alive, so the server pings
  a silent background link (or Miniport carrier) only after 180 s; two unanswered pings end the link.
- **Link probing.** When a device says hello again on a new socket (a Wi-Fi / cellular handover can leave the old one
  open on the server), its older links are probed at once: pinged, 10 s grace, then ended if no frame came. Until a probed
  link answers, what it last reported (on screen, in front, connected) is not relied on.
- **Credits.** The service's link gets `as_credits { free, paid, daysLeft }` (strings: free and paid Anlas and the
  subscription's days left) once after its `as_hello` and again whenever they change; `GET
  /android/background-notification` answers the same values from the server's cached balance. No polling while the link
  is up.
- **Peer list.** The service's link gets no broadcasts at all (`as_peers_updated` included); a phone's page gets the peer
  list only when something it reads changed, never its own status report back.
- **Wallpapers.** `GET /api/activesync/wallpapers/<device>/hashes` -> `{ hashes: { <kind>: sha1 of the stored bytes |
  "path:<path>" } }` lists every stored kind; send only what differs, `"same:<kind>"` for a picture another kind has, and
  read `unchanged: [...]` in the POST answer. See [client-api/ws/activeSync.md](./client-api/ws/activeSync.md#wallpapers-kept-for-device-center-827).

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
- File contents never travel in `as_call` arguments (1 MB cap): they go through the HTTP endpoints in [client-api/ws/activeSync.md](./client-api/ws/activeSync.md#file-bodies-http). A service answers `stream.send` by posting the file in ordered chunks of about 1 MB and stops on a 410; it answers `stream.receive` by fetching `.../data` in ranges and writing them. `mkdirs: true` makes `dir` first when it is missing (files sent to the phone go to `/ActiveSync` at the root of internal storage); `temp: true` (a program to install) writes the file to the app's own temporary folder (`externalCacheDir/activesync-install/<transferId>/<name>`) instead of `root` / `dir`, needs only the `control` permission and answers `{ temp: true, name, size }`.
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

## Remote viewer

View only. `public/scripts/comp/activeSyncScreen.js`, `modules/activeSyncScreen.js`, and in the app
`activesync/ActiveSyncScreen.kt` (permission group "Remote screen").

| Operation (to the phone's page) | Does |
| --- | --- |
| `screen.start` | the app shows Android's screen-capture prompt (every time); `{ started: true }` once allowed, `DENIED` otherwise |
| `screen.stop` | ends the capture |

Event `screen.state { state: 'stopped', reason }` when it ends on the phone. Frames do not ride the
socket: the app posts JPEGs (long edge 960, about 7 a second at most, only when the screen changes) to
`POST /api/activesync/screen/<device>/frame` in the page's session, and the desktop window reads
`GET /api/activesync/screen/<device>/stream` (multipart/x-mixed-replace). With no reader for 8 s the
server answers `{ stop: true }` and the phone stops. The page must be open on the phone to be asked;
once allowed the capture lives in the foreground service and follows the user into other programs.

## Text Messaging notifications (Yozora #779)

The server's Text Messaging accounts (iMessage through BlueBubbles, RCS through the Google Messages
pairing, `modules/textMessaging.js`) notify on the phone even while the app is in the background.
Since #908, a new text reaches the phone only as its notification inbox notice
(`inbox.notice` with id `sms:<account>:<chatGuid>`; see "Notices and status" below). That notice is delivered,
confirmed and sent again until confirmed. Its `data` carries `{ kind: 'sms', accountId, chatGuid, guid,
title, sender, address, text, isGroup, date, service, account }`, and the app renders it as a MessagingStyle
notification per `accountId + chatGuid` on the "Text messages" channel. It has quick reply (RemoteInput) and
Mark as read. Tapping it opens the app at that conversation (`dreamscape://textmessaging/<accountId>/<chatGuid>`;
the page calls `wmTextMessaging.openChat`). `tm.notify`, a second copy of the same text, is no longer sent.

| event | detail | the app does |
| --- | --- | --- |
| `tm.dismiss` | `{ accountId, chatGuid }` | cancels that conversation's notification (read elsewhere, or you answered from another device) |

The app answers with ordinary packets on the same socket (it holds the page's session):

- quick reply: `{ type: 'tm_send', requestId, data: { accountId, chatGuid, text } }` -> `tm_send_response`
  `{ success, tempGuid, chatGuid }` or `{ success: false, code, error }`. On success the app adds the
  reply to the notification as "You" and keeps it quiet; on failure it shows "Not sent: <error>".
- Mark as read: `{ type: 'tm_read', requestId, data: { accountId, chatGuid } }`, then cancels the notification.

Google Messages stays the phone's default messaging app (RCS needs it); Yukimi turns its own
notifications off so a message does not ring twice.

## Notifications for Messaging's Android app accounts (Yozora #885)

`notify.posted` (device -> computers, and server taps via `activeSync.onDeviceEvent`) also carries, when the app gives it:
`sub` (sub text), `conv { title, group, shortcut }`, `messages [{ text, time, sender, senderKey, me }]` (MessagingStyle lines, newest 12; `me` = the user's own line), `actions [{ i, title, reply, semantic }]` (`reply` = takes typed text) and `avatar` (64 px PNG data URL, sent again only when it changed).

| Op (computer/server -> device) | Args | Does |
|---|---|---|
| `notify.reply` | `{ key, action, text }` | fills every free-form RemoteInput of action `action` with `text` and sends its intent (the notification's quick reply) |
| `notify.action` | `{ key, action }` | sends action `action`'s intent (Mark as read, Mute, ...); refused for an action that takes text |

Both need the `notify` permission and a notification the phone still shows (`gone` otherwise). Older apps do not advertise them (`UNSUPPORTED`).

## Programs (Yozora #795)

An Android program (`.apk`) sent from the computer is offered to Android's package installer. Android always asks
the user to confirm; the app only opens that prompt.

| Operation (to the service) | Arguments | Does |
| --- | --- | --- |
| `apps.install` | `{ temp, name, root, path }` (a program in the app's temporary folder, `temp` = the transfer id of its `stream.receive`) or `{ root, path }` (an `.apk` in shared storage) | local ADB or Shizuku when allowed; else a PackageInstaller session whose confirmation opens when the app is on screen, else posts "<app> <version> is ready to install" (tap opens it); without permission to install from Dreamscape, Android's Install unknown apps page first. A temporary file is deleted once the install ended (installed, failed or the prompt dismissed); one left behind (the app updated itself) goes at the next link start, as does any older than a day. Answers `{ state: prompted \| notified \| needs_permission \| installing \| installed, package, version, label, via? }`. Needs `control` (and `files` for a `path` in shared storage); queueable for a partner that is away (after its `stream.receive`). |

From the desktop: Melaton Mobile Device Center > Programs and Services > Install a program on your device. From
an agent (application key, admin): upload as for any file (`POST /api/activesync/upload/:deviceId/begin`, chunks,
then `commit` with `{ install: true, queue: true }`; the file lands under its own name, replacing an older copy),
or `POST /api/activesync/install/:deviceId { root, path }` for an `.apk` already on the phone.


## Notices and status (StaticForge #908, rule cafeready-background)

Server -> the partnered phone's **service** socket:

| event | detail | the app does |
| --- | --- | --- |
| `inbox.notice` | a notification inbox notice `{ id, app, cls, title, text, actions, data, createdAt, alert, catchUp?, resent?, pageConnected }` | posts it, and always confirms with `inbox.posted`. With Melaton Mobile in front, the page must call `AndroidInbox.shown(id)` within 4 s, or the app posts it itself. `sms:` notices become the text's conversation notification. `rem:` notices get Snooze (5 min) and Dismiss buttons |
| `inbox.cleared` | `{ id }` | cancels it (and an `sms:` notice's conversation) |
| `status.snapshot` | `{ full, fields: { mail, sms, chat, director, prints, weather, lapis, traffic, notices, prefs, received } }` | hands it to the CaféReady `status-bar` task, which works out the status icons with the page asleep (`modules/phoneStatus.js`). Only changed fields are sent; the whole snapshot is sent after a hello |

The phone -> the server:

- `as_event inbox.posted { id, how: 'posted' | 'page' | 'dup' | 'cleared' }`: the notice is delivered. Until this
  arrives, the server sends the notice again after 15 s, 45 s, 2 min and 5 min, and on every hello. The
  confirmation goes to no computer.
- `reminder_snooze { id, minutes }` / `reminder_dismiss { id }` as ordinary packets (fields in `data`), from a
  reminder's notification buttons.

## Media sharing (StaticForge #956)

A paired computer's Media Player lists the phone's music and videos as one of Windows Media Player 11's other
libraries (the navigation pane's node for the phone, its views page and its views) and plays a song or a video
streamed from the phone to the one computer tab that asked. The service answers it with no WebView (rule
cafeready-background); the group is `media` and needs the `files` permission, plus Android's own media
permission (no All files access).

- `media.hello` -> `{ version: 1, access, volumes: [{ id, generation }] }`
- `media.list { kind: 'audio' | 'video', volume, offset, limit <= 1000 }` -> `{ kind, volume, generation, total,
  offset, items }`; a song: `id, title, artist, albumArtist, album, albumId, genre, composer, track, disc, year,
  duration (ms), size, mime, added (ms)`; a video: `id, title, artist, duration, width, height, size, mime, added,
  folder`. Nothing is copied: the computer pages through the tags.
- `stream.send` with `root: 'media'`: `/audio/<volume>/<id>` or `/video/<volume>/<id>` (the file, with the
  `Range` it was asked for), with `thumb`: `/album/<volume>/<albumId>` (the cover, else a song's own picture) or
  `/video/<volume>/<id>` (a frame), JPEG. The computer asks through
  `GET /api/activesync/file/:deviceId/media/<path>` like any phone file.
- event `media.changed { volume, generation }`: MediaStore changed (a ContentObserver, 2 s after the last change);
  a computer showing that library reads it again. No polling.
- The device description says `media: true` when a socket of the phone answers `media.list`; a phone whose app
  does not yet (DSApp branch `claude/media-share`) shows "needs an update" in Media Player.
