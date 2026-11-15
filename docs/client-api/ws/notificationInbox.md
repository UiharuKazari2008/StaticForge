# WebSocket: Notification inbox

Server handler: `modules/ws/handlers/294-notificationInboxHandler.js` (logic in `modules/notificationInbox.js`). Yozora #845.
Client: `public/scripts/comp/wmNotificationInbox.js` (Melaton Mobile catch-up on resume); producers are Lapis Remote and Traffic (more to follow).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling. `admin` or `dev_admin`; each user type has its own queue.

A durable store of the notices producers raise, so a phone that was not connected shows them when it opens, the shell shows on resume what was not cleared or acted on elsewhere, and the DSApp foreground service can post them as Android notifications while the WebView is paused. Producers call `notificationInbox.publish()` as well as their own live broadcast; a notice keeps a stable `id` so a later one of the same id supersedes it, and a short-lived one (a run countdown) carries `expiresAt`.

## Packet index

| Request | Body -> reply |
|---|---|
| `inbox_list` | `{ since?, includeCleared? }` -> `{ notices }` (newest first, not expired; cleared ones left out unless asked) |
| `inbox_ack` | `{ id, state: 'seen'|'acted'|'cleared', device? }` -> `{ ok }`. State never steps back. Destructive. |

A notice: `{ id, app, cls, title, text, actions[], data, createdAt, expiresAt, state, actedBy }`. `cls` is the wmShell notification class (sound and icon); `data.open` names the app layer / direction to open; `state` is `new` -> `seen` -> `acted`, or `cleared`.

## Broadcast (same user type's clients)

- `inbox_updated` `{ reason: 'new', notice }` when a notice is published, or `{ reason: 'ack', id, state, device }` when its state changes (so a notice cleared or acted on one device clears on the others).
