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

## Events

`tm_event` (admins only): `{ event: 'message'|'updated'|'reaction'|'typing'|'read'|'chat'|'account'|'resync'|'settings', accountId, chatGuid, message?, reaction?, targetGuid?, typing?, read?, known?, notify? }`.
