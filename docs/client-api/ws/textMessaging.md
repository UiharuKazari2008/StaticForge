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

`tm_account_save { kind: 'android', package, label?, enabled?, settings: { notify } }` makes an account from an Android app (Discord = `com.discord`); one account per app. `modules/textMessagingAndroid.js` takes that app's notifications from the partnered phone (ActiveSync `notify.posted` / `notify.removed`, sent while "Send notifications" is on). Each MessagingStyle conversation (else the notification's title) becomes a chat, and each line becomes a message.

- `tm_send` in such a chat uses the notification's quick reply (device op `notify.reply`). It works only while the phone shows the notification: `chat.canReply` says so, and otherwise the reply is refused with `NO_REPLY`. New conversations, attachments, reactions, edits and threads are not supported.
- Open in <app>: `chat.open { key, device }` is the newest notification's tap target. It is kept after the notification is gone, because the phone keeps the intent too (newest 300). On that phone the page calls `AndroidActiveSync.openNotification(key)`, else `AndroidApps.launch(package)`. Elsewhere it uses `tm_open` (device op `notify.open`, falling back to `apps.manage { action: 'open' }`). The phone's "Conversation with <name>" link and Melaton Messenger's conversation title do this, and so does Menu > Open in <app>.
- `chat.actions: [{ id, title }]` are the notification's other buttons (Mark as read, Mute, ...); run one with `tm_action`.
- `tm_read` runs the app's own Mark as read action, else dismisses the notification. When the notification is removed on the phone, the chat is marked read (`read` event).
- `settings.notify` is off by default because the app's own notification is on the phone already. Events from these accounts carry `native: true` and never go to `tm.notify` or the notification inbox.
- Pictures: `GET /api/textmessaging/:accountId/avatar/app` is the app's icon and `.../avatar/<chatGuid>` the conversation's picture. `GET /api/textmessaging/android-icon/:package` serves an icon for the app list.

## Events

`tm_event` (admins only): `{ event: 'message'|'updated'|'reaction'|'typing'|'read'|'chat'|'account'|'resync'|'settings', accountId, chatGuid, message?, reaction?, targetGuid?, typing?, read?, known?, notify? }`.
