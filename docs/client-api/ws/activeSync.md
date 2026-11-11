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

A device is `pending` from its hello until a computer chose how to connect and the phone's user agreed: `guest` (this
connection only) or `partner` (stored; later hellos connect at once). Several sockets of one device share that state.

Permissions a phone grants (an operation's group is the part before its first dot):

| Permission | Operation groups |
| --- | --- |
| (none needed) | `status.*` |
| `files` | `storage.*`, `stream.*` |
| `session` | `studio.*` |
| `clipboard` | `clipboard.*`, `open.*` |
| `control` | `device.*` |
| `notify` | `notify.*` |
| `screen` | `screen.*` |
| `sync` (partners only) | `sync.*` |

A device may ask a computer for `status.*`, `studio.*`, `clipboard.*`, `open.*` and `notify.*`.

## Packets

Signed-in sessions (read-only PIN included):

| Request type | Response | Notes |
| --- | --- | --- |
| `as_hello` | `as_hello_response` | `{ kind, id, name?, ops[], speaker: 'webview' \| 'service', model?, os?, app?, status? }`. `ops` are the operations this socket answers (`storage.list`, or `storage.*`). Returns `{ success, kind, id, name, session, permissions, device, devices, computers }`; a refusal is `{ success: false, code, error }`. A computer without a `name` is named after the host. Only administrators get other peers in the lists. A partner's queue goes out after its hello |
| `as_status` | none | Device only, fire-and-forget: `{ status: { battery { level, charging, plugged, saver }, wifi { enabled, connected, level 0-4, ssid }, cellular { present, operator, level, dataType, roaming, airplane }, active, storage [{ id, name, total, free }], foreground } }`. Unknown fields stay null |
| `as_reply` | none | The answer to an `as_request`: `{ callId, ok, result }` or `{ callId, ok: false, error: { code, message } }` |
| `as_event` | none | A peer's news for the other kind: `{ event: 'group.name', detail }` (the payload is `detail`, never `data`). A device's events need the group's permission and reach administrators' computers |
| `as_synced` | `as_synced_response` | `{ deviceId?, summary? }`: stamps the device's last sync (a device stamps itself) |
| `as_log` | `as_log_response` | `{ deviceId?, limit? }` -> `{ entries: [{ at, level, text }] }`, newest first; a device reads its own |

Administrators (also refused for read-only sessions as destructive: `as_call`, `as_partnership`, `as_forget`):

| Request type | Response | Notes |
| --- | --- | --- |
| `as_list` | `as_list_response` | `{ devices, computers }` |
| `as_call` | `as_call_response` | `{ to, op, args?, timeoutMs?, queue? }` relays one request to the other kind and returns `{ success, result }`. `queue: true` keeps a queueable operation (`studio.setSession`, `clipboard.set`, `open.item`, `notify.show`, `stream.receive`) for an offline partner: `{ success, queued: true }`. Codes: `UNKNOWN_DEVICE`, `OFFLINE`, `NOT_CONNECTED` (still pending), `NOT_PERMITTED`, `UNSUPPORTED` (no socket lists the op), `UNKNOWN_OP`, `TOO_LARGE` (1 MB of args; 256 KB queued), `QUEUE_FULL` (50), `TIMEOUT`, `DISCONNECTED`, or the other side's own code |
| `as_partnership` | `as_partnership_response` | `action: 'propose'` `{ deviceId, mode: 'partner' \| 'guest', name?, syncItems? }` asks the phone (`partnership.propose`, up to 2 minutes) -> `{ accepted, device }`; `'update'` `{ deviceId, name?, syncItems?, settings? }` (a device updates its own `permissions`); `'end'` `{ deviceId }` (a device ends its own). `NAME_IN_USE` when another partner has the name |
| `as_forget` | `as_forget_response` | `{ deviceId }`: an offline device's record, queue and log |

Pushed by the server:

| Type | Notes |
| --- | --- |
| `as_request` | `{ callId, from: { kind, id, name, queuedAt? }, op, args }`: answer with `as_reply` |
| `as_event` | `{ from, event, detail }`; from kind `server`: `partnership.changed` `{ session, permissions, name, syncItems }` to the device |
| `as_peers_updated` | `{ devices, computers }` to administrators that said hello, coalesced (250 ms) |

## File bodies (HTTP)

`modules/activeSyncTransfers.js`, test `node scripts/test-activesync-transfers.js`. Chunked both ways; a device's
requests must come from the session of one of its open sockets.

| Request | Who | Notes |
| --- | --- | --- |
| `GET /api/activesync/file/:deviceId/:root/<path>[?thumb=N][&download=1]` | administrator | The phone is asked `stream.send { transferId, root, path, thumb, range }` and the response stays open. `Range` is passed on (206 when the phone answers with one). Served with `Content-Security-Policy: sandbox`. 6 streams per device at a time, the rest wait |
| `POST /api/activesync/transfer/:id/chunk?seq=N[&end=1]` | the device | The file in order, at most 8 MB a chunk; `seq=0` carries `x-as-status`, `x-as-type`, `x-as-length`, `x-as-range`, `x-as-mtime`. Answered once the desktop took the chunk. 409 `OUT_OF_ORDER { expected }`, 410 when the desktop went away |
| `POST /api/activesync/upload/:deviceId/begin` | administrator | `{ root, dir, name, size, conflict, mtime, id? }` -> `{ id, chunkSize }` |
| `POST /api/activesync/upload/:id/chunk?offset=N` | administrator | Raw bytes in order -> `{ received }`; a wrong offset answers 409 with `received` (resume from there) |
| `POST /api/activesync/upload/:id/commit` | administrator | `{ queue? }`. The phone is asked `stream.receive { transferId, root, dir, name, size, conflict, mtime }` and pulls the file; answers `{ entry }`, or `{ queued: true }` for an offline partner with `queue` (kept up to 7 days, removed when delivered, refused or the partnership ends) |
| `GET /api/activesync/transfer/:id/data` | the device | The committed file, with `Range` |
| `DELETE /api/activesync/upload/:id` | administrator | Gives up an upload that was not committed |

The phone reports its writing as `as_event` `stream.progress { transferId, written, total }`.

## Operations in use

Device: `status.get`, `partnership.propose`, `storage.hello|list|stat|mkdir|rename|delete|trash|trashList|restore|move|copy|open|watch|unwatch`
(the app's phone storage bridge, #698, loaded by the peer when Explorer never was; `hello` without its local `baseUrl`;
events `storage.changed`, `storage.config`), `stream.send`, `stream.receive`, `studio.getSession`, `studio.setSession { session }`,
`clipboard.set { text }`, `device.ring`.

Computer: `studio.getSession`, `studio.setSession { session }`.

On a desktop `window.phoneStorage` is `public/scripts/comp/activeSyncRemoteStorage.js`: the bridge's interface over these
operations and the file endpoints, so Explorer's phone drive (`explorerPhoneDrive.js`) shows a connected device's
storage unchanged, and Send To copies files into its Download folder.
