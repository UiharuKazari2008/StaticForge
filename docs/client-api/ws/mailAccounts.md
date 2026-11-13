# WebSocket: IMAP mail accounts

Server handler: `modules/ws/handlers/305-mailAccountsHandler.js` (logic in `modules/mailAccounts.js`, `mailAccountsImap.js`, `mailAccountsStore.js`, `mailAccountsSyncWorker.js`). Yozora #789.
Clients: Dovecote Express and Melaton Mobile Messaging (IMAP accounts), CardSpace e-mail account cards.
HTTP side (attachments, uploads): [rest-api.md](../rest-api.md#text-messaging-and-imap-mail-accounts).

This is the user's own external IMAP/SMTP accounts (Gmail, iCloud, Outlook.com, … presets), separate from the Dreamscape Exchange Server ([mailExchange.md](./mailExchange.md)).

Every packet is **admin only**; others get `{ success: false, code: 'INSUFFICIENT_PERMISSIONS' }`. Replies are `{ success: true, ... }` or `{ success: false, code, error }`.

## Packet index

| Request | Body -> reply |
|---|---|
| `ma_accounts` | `{}` -> `{ accounts, presets }` |
| `ma_account_test` | `{ email, displayName, imap, smtp, password, smtpPassword?, id? }` |
| `ma_account_save` | `{ id?, email, displayName, imap, smtp, password?, smtpPassword?, enabled, settings }` -> `{ account }`. Destructive. |
| `ma_account_delete` | `{ id }`. Destructive. |
| `ma_folders` | `{ accountId }` -> `{ folders: [{ path, name, special, total, unseen, synced }] }` |
| `ma_messages` | `{ accountId, folder='INBOX', limit, before, unseenOnly }` -> `{ messages, more, cursor }` |
| `ma_message` | `{ accountId, folder, uid, markSeen=true }` -> `{ message }` (HTML sanitized, attachments carry a `url`) |
| `ma_flags` | `{ accountId, folder, uids, add, remove }` |
| `ma_move` | `{ accountId, folder, uids, to }` |
| `ma_delete` | `{ accountId, folder, uids }`: into Trash; in Trash, for good. Destructive. |
| `ma_send` | `{ accountId, to, cc, bcc, subject, text, html, attachments: [uploadId], reply?: { folder, uid, kind }, forwardFrom?: { folder, uid, parts? }, draftUid? }` |
| `ma_save_draft` | `{ accountId, to, cc, bcc, subject, text, html, attachments, forwardFrom?, replaceUid? }` -> `{ folder, uid }` |
| `ma_search` | `{ q, accountId?, limit }` -> `{ results }` |
| `ma_sync_status` | `{}` |
| `ma_resync` | `{ accountId, rebuild? }`. Destructive. |

## Events

`ma_event` (admins): `{ event: 'new'|'flags'|'removed'|'folders'|'account'|'sync', accountId, folder, uids?, message?, notify? }`.
