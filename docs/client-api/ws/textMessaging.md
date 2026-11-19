# WebSocket: Text Messaging

Server handler: `modules/ws/handlers/304-textMessagingHandler.js` (logic in `modules/textMessaging.js`; providers `modules/textMessagingBlueBubbles.js` for iMessage and `modules/textMessagingRcs.js` for RCS through `services/rcs-bridge`; local copy and FTS5 search in `.cache/textmessaging.db` via `modules/textMessagingStore.js`). Yozora #779.
Clients: Melaton Mobile Messaging, Melaton Messenger (`apps/messenger`), the message bridge console (`apps/msgbridge`).
HTTP side (attachments, link previews, pairing QR, uploads): [rest-api.md](../rest-api.md#text-messaging-and-imap-mail-accounts).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Every packet is **admin only** (authenticated, `userType === 'admin'`). Others get `{ success: false, code: 'INSUFFICIENT_PERMISSIONS' }` in the `<type>_response`. The request body may be the message itself or `message.data`. Replies are `{ success: true, ... }` or `{ success: false, code, error }`.

## Packet index

| Request | Notes |
|---|---|
| `tm_accounts` | List accounts. |
| `tm_summary` | `{ accounts }` with unread counts. |
| `tm_account_test` | Test an account's settings before saving. |
| `tm_account_save` | Create/update an account -> `{ account }`. Destructive. |
| `tm_account_delete` | `{ id }`. Destructive. |
| `tm_settings_save` | Global settings (e.g. `notifyUnknown`) -> `{ settings }`. |
| `tm_chats` | `{ accountId, folder?, limit?, offset? }`. Unknown chats are the Unknown Senders folder. |
| `tm_chat` | `{ accountId, chatGuid }` -> `{ chat }`. |
| `tm_messages` | `{ accountId, chatGuid, limit? (≤200, default 50), before? }`. |
| `tm_send` | `{ accountId, chatGuid? or addresses[], text, replyTo?, subject?, effect?, tempGuid? }`. |
| `tm_react` / `tm_edit` | Reaction / edit on a message. |
| `tm_unsend` | Destructive. |
| `tm_read` / `tm_unread` | Mark a chat read / unread. |
| `tm_typing` | Typing indicator. |
| `tm_search` | `{ q, accountId?, limit? (≤100, default 40) }`. |
| `tm_delete_chat` | Destructive. |
| `tm_sync_status` / `tm_sync_chats` | Sync state / sync one account's chat list. |
| `tm_resync` | `{ accountId, rebuild? }`. Destructive. |
| `tm_rcs_pair` / `tm_rcs_refresh_qr` | QR pairing for an RCS account (QR via `GET /api/textmessaging/:accountId/pairing-qr.svg`). |
| `tm_rcs_pair_google` | Pair by Google account (sign in at messages.google.com in Alchemy). Destructive. |
| `tm_rcs_unpair` | Destructive. |
| `tm_resolve` | `{ accountId, address }` -> `{ name }`. |
| `tm_android_apps` | -> `{ apps: [{ package, label, at, icon, added }] }`: phone apps that posted a notification lately (#885). |
| `tm_open` | `{ accountId, chatGuid }` -> `{ opened: 'notification' \| 'app' }`: Open in <app> on the phone that posted the conversation (#885). |
| `tm_action` | `{ accountId, chatGuid, action }`: run one of an Android app account's notification actions (`chat.actions[].id`) on the phone (#885). |

## Android app accounts (#885)

`tm_account_save { kind: 'android', package, label?, username?, channels?, enabled?, settings: { notify } }` makes an account from an Android app (Discord = `com.discord`). `channels` (notification channel ids) limits it to those channels; an app can have several accounts this way, at most one without a list (it takes every other channel), and a channel belongs to one account (`CHANNEL_TAKEN`). A new Discord account is two: `app-discord` "Discord" = `directMessages` and `app-discord-servers` "Discord servers" = its server channels (an older single Discord account is split once at start). `username` names the signed-in account (`''` = the app's own, from MessagingStyle's user); the account's `name` is then `<label> (<username>)`. The account also reports `label`, `username`, `ownUsername`, `defaultUsername`, `channels` and `channelChoices` ([{ id, name, seen }]). `modules/textMessagingAndroid.js` takes that app's notifications from the partnered phone (ActiveSync `notify.posted` / `notify.removed`, sent while "Send notifications" is on). Each MessagingStyle conversation (else the notification's title) becomes a chat, and each line becomes a message.

- `tm_send` in such a chat uses the notification's quick reply (device op `notify.reply`). It works only while the phone shows the notification: `chat.canReply` says so, and otherwise the reply is refused with `NO_REPLY`. New conversations, attachments, reactions, edits and threads are not supported.
- Open in <app>: `chat.open { key, device }` is the newest notification's tap target. It is kept after the notification is gone, because the phone keeps the intent too (newest 300). On that phone the page calls `AndroidActiveSync.openNotification(key)`, else `AndroidApps.launch(package)`. Elsewhere it uses `tm_open` (device op `notify.open`, falling back to `apps.manage { action: 'open' }`). The phone's "Conversation with <name>" link and Melaton Messenger's conversation title do this, and so does Menu > Open in <app>.
- `chat.actions: [{ id, title }]` are the notification's other buttons (Mark as read, Mute, ...); run one with `tm_action`.
- `tm_read` runs the app's own Mark as read action, else dismisses the notification. When the notification is removed on the phone, the chat is marked read (`read` event).
- `settings.notify` is off by default because the app's own notification is on the phone already. Events from these accounts carry `native: true` and never go to `tm.notify` or the notification inbox.
- Message pictures: a line's picture from the phone ("Sent a video": MessagingStyle data URI or the big picture, a small JPEG sent once) is the message's attachment (`attachments[0]`, `GET /api/textmessaging/:accountId/attachment/<chat>.<message>.jpg`).
- Pictures: `GET /api/textmessaging/:accountId/avatar/app` is the app's icon and `.../avatar/<chatGuid>` the conversation's picture. `GET /api/textmessaging/android-icon/:package` serves an icon for the app list.

## Events

`tm_event` (admins only): `{ event: 'message'|'updated'|'reaction'|'typing'|'read'|'chat'|'account'|'resync'|'settings'|'reload'|'sync'|'syncprogress'|'pairing'|'signin_lost', accountId, chatGuid, message?, reaction?, targetGuid?, typing?, read?, known?, notify? }`.

Who gets which (#890 round 5, W5):

- `sync` (a reconcile pass) and `syncprogress` (`{ running, done, total }` every 2 s through a catch-up) go to desktop pages only (Messaging Bridge reads them; a DeX window is a desktop page).
- `account` at the end of a catch-up (BlueBubbles every 30 min and on reconnect, an RCS sync) goes to desktop pages always and to phone pages only when what they list changed: the account's status / error or its conversations (`textMessagingStore.fingerprint`: the newest 100 chat rows and the newest message). An `account` from a status change, a save or a delete goes to everyone.
- A sleeping phone page or DeX window (client_dormant): texts, edits, reactions, reads, `chat`, `pairing` and `signin_lost` go at once; `typing` is dropped (an "is typing..." on waking would be stale); `account`, `resync`, `settings`, `sync`, `syncprogress` wait as the newest per account, `reload` as the newest per conversation.

## MCP (Messaging Bridge)

The Tsubame (mailroom) key reaches these conversations through the Messaging Bridge MCP module (`sfapp_messaging_bridge`, `modules/messagingBridgeMcp.js`): `bridge_text_accounts`, `bridge_text_chats`, `bridge_text_chat`, `bridge_text_messages`, `bridge_text_search`, `bridge_text_mark_read`, `bridge_text_mark_unread`, `bridge_text_send` (`confirm: true`), `bridge_text_delete_chat` (`confirm: true`). They call the same `textMessaging.js` functions as the packets above; the packets stay admin-only. See [mcp-connector.md](../mcp-connector.md#messaging-bridge-module-sfapp_messaging_bridge).

## Ingest Controller (new texts)

`onProviderEvent` (`modules/textMessaging.js`) asks the Ingest Controller about each new incoming text before the `tm_event` broadcast (`ingestController.textInbound`, 1.5 s cap, fails open). A text account in **process** mode runs its pipeline: the spam filter (known-spam numbers and a light heuristic) can silence a text (mark read, `notify: false`), and code extraction announces a verification code through the notification inbox instead of the usual New Text Message notice. Accounts default to **bypass**: nothing changes. See [ingest-controller.md](../ingest-controller.md).
