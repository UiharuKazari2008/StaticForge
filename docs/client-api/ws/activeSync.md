# WebSocket: ActiveSync (Melaton Mobile Device Center)

Server handler: `modules/ws/handlers/301-activeSyncHandler.js` (logic and storage in `modules/activeSync.js`, sqlite
`.cache/activesync.db`). Clients: every tab's peer (`public/scripts/comp/activeSyncAgent.js`, `window.activeSync`), the
desktop's tray icon (`activeSyncTray.js`) and Melaton Mobile Device Center (`apps/activesync`), the phone's ActiveSync
program (`public/scripts/comp/wmActiveSync.js`). Yozora #747. Test: `node scripts/test-activesync.js`.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Peers

A socket says what it is with `as_hello`: a **device** (a phone running the Dreamscape app for Android: its WebView,
and the app's background service speaking the same packets) or a **computer** (a desktop tab). A peer id is 16 to 32
lowercase hex digits, made once and kept by the peer. The live state sits on the socket (`clientInfo.as`); devices and
their partnerships persist.

Only a partner may hold the service's socket: its `as_hello` is refused with `NOT_PARTNER` for any other device.

A **DreamOS machine** (#910) is a device too: its CaféReady host says hello as speaker `host` with `platform:
'cafeready'`, only over its Miniport's light sub `activesync`, signed in as an administrator, for the device id its
Miniport connected with (else `NOT_PERMITTED` / `BAD_ID`). It is partnered by that sign-in (`files`, `control`), never
the primary device, and reads no peer list. Device descriptions carry `platform` (`android` | `cafeready`); a machine's
`status.host` has its base, slot, CaféReady version, update channel, addresses, interfaces, power source, the server
address it uses and `allow { commands, screenshots, killSwitch }`. Its `host.*` operations are the server's
(`/api/activesync/host/...`, admin, audited); `as_call` refuses them. See
[activesync-protocol.md](../../activesync-protocol.md), "DreamOS machines".

A device is `pending` from its hello until a computer chose how to connect and the phone's user agreed: `guest` (this
connection only) or `partner` (stored; later hellos connect at once). Several sockets of one device share that state.

Permissions a phone grants (an operation's group is the part before its first dot):

| Permission | Operation groups |
| --- | --- |
| (none needed) | `status.*` |
| `files` | `storage.*`, `stream.*` |
| `session` | `studio.*` |
| `clipboard` | `clipboard.*`, `open.*` |
| `control` | `device.*`, `host.*` (a DreamOS machine, through the server only) |
| `notify` | `notify.*` |
| `screen` | `screen.*` |
| `sync` (partners only) | `sync.*` |

A device may ask a computer for `status.*`, `studio.*`, `clipboard.*`, `open.*` and `notify.*`.

## Packets

Signed-in sessions (read-only PIN included):

| Request type | Response | Notes |
| --- | --- | --- |
| `as_hello` | `as_hello_response` | `{ kind, id, name?, ops[], speaker: 'webview' \| 'service' \| 'host', platform?, model?, os?, app?, status? }`. `ops` are the operations this socket answers (`storage.list`, or `storage.*`). Returns `{ success, kind, id, name, session, permissions, device, devices, computers }`; a refusal is `{ success: false, code, error }`. A computer without a `name` is named after the host. Only administrators get other peers in the lists. A partner's queue goes out after its hello |
| `as_status` | none | Device only, fire-and-forget: `{ status: { battery { level, charging, plugged, saver }, wifi { enabled, connected, level 0-4, ssid }, cellular { present, operator, level, dataType, roaming, airplane }, active, storage [{ id, name, total, free }], foreground, shell '6.1' \| '6.5', program { name, kind melaton \| android }, screen inner \| cover, foldable } }`. Unknown fields stay null. Device descriptions also carry `lastSync` (a partner's data relayed or its queue delivered, at most once a minute) and `wallpapersAt` (#827) |
| `as_reply` | none | The answer to an `as_request`: `{ callId, ok, result }` or `{ callId, ok: false, error: { code, message } }` |
| `as_event` | none | A peer's news for the other kind: `{ event: 'group.name', detail }` (the payload is `detail`, never `data`). A device's events need the group's permission and reach administrators' computers |
| `as_synced` | `as_synced_response` | `{ deviceId?, summary? }`: stamps the device's last sync (a device stamps itself) |
| `as_log` | `as_log_response` | `{ deviceId?, limit? }` -> `{ entries: [{ at, level, text }] }`, newest first; a device reads its own |

Administrators (also refused for read-only sessions as destructive: `as_call`, `as_partnership`, `as_forget`, `as_notify_settings_set`, `as_set_primary`):

| Request type | Response | Notes |
| --- | --- | --- |
| `as_list` | `as_list_response` | `{ devices, computers }` |
| `as_call` | `as_call_response` | `{ to, op, args?, timeoutMs?, queue? }` relays one request to the other kind and returns `{ success, result }`. `queue: true` keeps a queueable operation (`studio.setSession`, `clipboard.set`, `open.item`, `notify.show`, `stream.receive`) for an offline partner: `{ success, queued: true }`. Codes: `UNKNOWN_DEVICE`, `OFFLINE`, `NOT_CONNECTED` (still pending), `NOT_PERMITTED`, `UNSUPPORTED` (no socket lists the op), `UNKNOWN_OP`, `TOO_LARGE` (1 MB of args; 256 KB queued), `QUEUE_FULL` (50), `TIMEOUT`, `DISCONNECTED`, or the other side's own code |
| `as_partnership` | `as_partnership_response` | `action: 'propose'` `{ deviceId, mode: 'partner' \| 'guest', name?, syncItems? }` asks the phone (`partnership.propose`, up to 2 minutes) -> `{ accepted, device }`; `'update'` `{ deviceId, name?, syncItems?, settings? }` (a device updates its own `permissions`); `'end'` `{ deviceId }` (a device ends its own). `NAME_IN_USE` when another partner has the name |
| `as_forget` | `as_forget_response` | `{ deviceId }`: an offline device's record, queue and log |
| `as_notify_settings` | `as_notify_settings_response` | `{ deviceId, compact? }` (#979, `modules/activeSyncNotifyFilter.js`): the partnership's notification settings `{ apps: [{ package, app, icon, kind: 'noise' \| 'handled' \| 'real', why, handledBy, keep, def: { send, tray }, send, tray, lastSeen, channels: [{ id, name, importance, kind, why, handledBy, def, send, tray, posts, lastSeen }] }], v }`; `compact: true` -> `{ eff: { v, apps: { <package>: { s, t, ch: { <channel>: [s, t] } } } } }` (channel values already include the app's) |
| `as_notify_settings_set` | `as_notify_settings_set_response` | `{ deviceId, apps: { <package>: { send, tray, ch: { <channel>: { send, tray } } } } }`: the user's choices (stored as differences from the defaults), a partner only; returns the settings as above and pushes the new filter to the phone and the computers |
| `as_set_primary` | `as_set_primary_response` | `{ deviceId }` (`''` clears) -> `{ primary }` (#979): the owner's primary device, a partner only (`NOT_PARTNER`); device descriptions carry `primary: true`. Ending the partnership or forgetting the device clears it |

Pushed by the server:

| Type | Notes |
| --- | --- |
| `as_request` | `{ callId, from: { kind, id, name, queuedAt? }, op, args }`: answer with `as_reply` |
| `as_event` | `{ from, event, detail }`; from kind `server`: `notify.filter` `{ deviceId, eff }` to administrators' computers when a partnership's notification map changed (#979); `partnership.changed` `{ session, permissions, name, syncItems }` to the device; to a partnered device's service socket, `inbox.notice` (a notification inbox notice plus `user`, `pageConnected`) and `inbox.cleared { id }` ([notificationInbox.md](./notificationInbox.md), #876) |
| `as_peers_updated` | `{ devices, computers }` to administrators that said hello, coalesced (250 ms), only when something other than the clocks changed. A phone's sockets get it only when something its own page reads changed (another peer, or its own session, permissions or name: its own status report does not come back to it, #890); the app's background link never gets it |
| `as_credits` | To the app's background link (speaker `service`) only (#890): `{ free, paid, daysLeft }`, all strings (`daysLeft` `''` when unknown): free and paid Anlas and the subscription's days left, the values of `GET /android/background-notification`. Once right after its `as_hello`, then whenever they change (checked with the server's 10 s status read). The app need not ask over HTTP while its link is up |

## File bodies (HTTP)

`modules/activeSyncTransfers.js`, test `node scripts/test-activesync-transfers.js`. Chunked both ways; a device's
requests must come from the session of one of its open sockets.

| Request | Who | Notes |
| --- | --- | --- |
| `GET /api/activesync/file/:deviceId/:root/<path>[?thumb=N][&download=1]` | administrator | The phone is asked `stream.send { transferId, root, path, thumb, range }` and the response stays open. `Range` is passed on (206 when the phone answers with one). Served with `Content-Security-Policy: sandbox`. 6 streams per device at a time, the rest wait |
| `POST /api/activesync/transfer/:id/chunk?seq=N[&end=1]` | the device | The file in order, at most 8 MB a chunk; `seq=0` carries `x-as-status`, `x-as-type`, `x-as-length`, `x-as-range`, `x-as-mtime`. Answered once the desktop took the chunk. 409 `OUT_OF_ORDER { expected }`, 410 when the desktop went away |
| `POST /api/activesync/upload/:deviceId/begin` | administrator | `{ root, dir, name, size, conflict, mtime, id?, mkdirs? }` -> `{ id, chunkSize }`. `mkdirs`: the phone makes `dir` when it is missing (a queued copy cannot make it ahead) |
| `POST /api/activesync/upload/:id/chunk?offset=N` | administrator | Raw bytes in order -> `{ received }`; a wrong offset answers 409 with `received` (resume from there) |
| `POST /api/activesync/upload/:id/commit` | administrator | `{ queue?, install? }`. The phone is asked `stream.receive { transferId, root, dir, name, size, conflict, mtime, mkdirs?, temp? }` and pulls the file; answers `{ entry }`, or `{ queued: true }` for an offline partner with `queue` (kept up to 7 days, removed when delivered, refused or the partnership ends). `install` (an `.apk`): the server's ADB first; else `temp: true` puts the file in the app's temporary folder under the transfer id, `apps.install { temp, name, root, path }` follows and the app deletes the file once the install ended (never left in Download or the received folder). An app build without the temporary folder saves it in `root` / `dir` and installs from `path` |
| `POST /api/activesync/install/:deviceId` | administrator | `{ root, path }` (an `.apk` on the phone's storage) or `{ temp, name }` (a program still in the app's temporary folder: Received Items' Install), `queue?` -> `{ install }` |
| `GET /api/activesync/transfer/:id/data` | the device | The committed file, with `Range` |
| `DELETE /api/activesync/upload/:id` | administrator | Gives up an upload that was not committed |

Uploads (#890): a chunk is taken only while no other chunk of the same upload is being written; one sent meanwhile (a
resend racing its first copy) answers 409 `OFFSET` with `received`, so a chunk is never written twice. After a server
restart `received` is what the data file holds, so resuming from the answer is always exact.

The phone reports its writing as `as_event` `stream.progress { transferId, written, total }`.

## Operations in use

Device: `status.get`, `partnership.propose`, `storage.hello|list|stat|mkdir|rename|delete|trash|trashList|restore|move|copy|open|handlers|defaults|watch|unwatch`
(the app's background service link, DSApp `ActiveSyncLink` / `ActiveSyncFiles`, alone since #981: never the phone's
page, so they work with the screen off; `hello` without a local `baseUrl`; events `storage.changed`, `storage.config`;
see [activesync-protocol.md](../../activesync-protocol.md#one-protocol-two-speakers-on-the-phone); Open With, #954: `handlers` lists the phone's apps for a file or type with
their icons as `iconData`, `open { component, action }` opens it in one of them, `defaults` shows Android's own default-apps
page; the app's service link answers these three itself when its `storage.hello` says `features.openWith`), `stream.send`, `stream.receive`, `studio.getSession`, `studio.setSession { session }`,
`clipboard.set { text }`, `device.ring`.

Device, notifications (permission `notify`; the app's notification listener, DSApp-Kotlin
`activesync/ActiveSyncNotifications.kt`, when "Send notifications to the desktop" is on and Android's notification
access was allowed): `notify.list` -> `{ notifications: [{ key, package, app, title, text, time, category?, icon? }] }`,
`notify.dismiss { key }`; events `notify.posted` (one such object) and `notify.removed { key }`. `icon` is a 48 px PNG
data URL sent once per app and connection. Ongoing notifications, group summaries and the app's own are left out. The
desktop keeps a list per device and shows a tray popup (`public/scripts/comp/activeSyncNotifications.js`); a removal
drops it from the list and closes its popup.

Computer: `studio.getSession`, `studio.setSession { session }`.

On a desktop `window.phoneStorage` is `public/scripts/comp/activeSyncRemoteStorage.js`: the bridge's interface over these
operations and the file endpoints, so Explorer's phone drive (`explorerPhoneDrive.js`) shows a connected device's
storage unchanged, and Send To copies files into its received folder: `ActiveSync` at the root of internal storage
(`phoneStorage.receivedDir`, made when missing; Yukimi, Nov 18). Device Center's File Management ("Open the folder of
files sent to your device"), the tray icon's menu (Open Received Files) and the phone's ActiveSync Menu (Received Files)
open it in Explorer / File Explorer (`phoneStorage.openReceived(deviceId)` on a desktop).

## Wallpapers kept for Device Center (#827)

`modules/activeSyncWallpapers.js`. The phone's page posts its wallpapers once per connection and when they change; Device Center and the Sidebar's Mobile Device gadget read them, also while the phone is away.

| Route | Who | Body / answer |
| --- | --- | --- |
| `POST /api/activesync/wallpapers/:deviceId` | the phone (its own session) | `{ inner, cover, external, screen }`, each a same-site path or an image data URL (2 MB max) -> `{ success, wallpapers }` |
| `GET /api/activesync/wallpapers/:deviceId` | admin or the phone | `{ success, wallpapers: { inner, cover, external, screen, at } }` (URLs, null when none) |
| `GET /api/activesync/wallpapers/:deviceId/:kind` | admin or the phone | the stored picture (immutable; the URL carries its stamp) |
| `GET /api/activesync/wallpapers/:deviceId/hashes` | admin or the phone | `{ success, hashes: { <kind>: sha1 hex of the stored file's bytes, or "path:<path>" for a kind stored as a path } }` (#890): every stored kind; `{}` when the server holds none for the device |

Re-uploads (#890): the page compares each picture's sha1 (of the decoded bytes; `"path:<path>"` for a path) with `/hashes`
(once per connection) and with what it sent last, and posts only the kinds that differ. A kind whose picture is another
kind's (in the same post, or the one stored) goes as `"same:<kind>"`. A picture whose bytes are unchanged is not written
again, and an unchanged set neither rewrites `index.json` nor moves its stamp (Device Center is not told of a change). The
POST answer adds `unchanged: [kinds sent that were unchanged]`. Kinds: `inner`, `cover`, `external`, `innerLock`,
`coverLock`, `externalLock` (the page) and `androidInner`, `androidCover`, `androidExternal` (the app's service); a kind
not sent keeps what it had, `null` clears it.

