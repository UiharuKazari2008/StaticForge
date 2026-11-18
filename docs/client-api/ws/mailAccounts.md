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

`ma_event` (admins): `{ event: 'new'|'flags'|'removed'|'folders'|'account'|'sync'|'progress', accountId, folder, uids?, message?, notify?, changed?, progress? }`.

Who gets which (#890 round 5, W6):

- `progress` (at most every 2 s while a sync runs) goes to desktop pages only (CardSpace and Messaging Bridge read it).
- `sync` at the end of each sync (every 10 min) carries `changed`: true when the worker reported changes (the same ones that went as `folders`) or the sync's error line came or went. Desktop pages get every one; phone pages only `changed: true`, so a phone re-reads `ma_accounts` only on a real change.
- A sleeping phone page waits for everything but `new` as the newest per event and account (`DORMANT_HOLD`).

## Mail rules and MCP (Messaging Bridge)

The same functions are on MCP for the Tsubame (mailroom) key as the Messaging Bridge module (`sfapp_messaging_bridge`, `modules/messagingBridgeMcp.js`): `bridge_mail_*` tools, documented in [mcp-connector.md](../mcp-connector.md#messaging-bridge-module-sfapp_messaging_bridge). The packets here stay admin-only.

Mail rules (`modules/mailAccountsRules.js`, table `rules` in `.cache/mailaccounts.db`) are only on MCP for now (`bridge_mail_list_rules`, `bridge_mail_save_rule`, `bridge_mail_delete_rule`, `bridge_mail_run_rules`). `mailAccounts.js` runs them on the Inbox after new mail is fetched by IDLE and after a sync pass that fetched Inbox mail. Each account keeps a watermark in `state` (`rulesUid`, `rulesUidValidity`), so a rule touches only mail that arrives after it; a rebuilt Inbox (new UIDVALIDITY) restarts the watermark rather than re-running rules over old mail. Rule moves, flags and deletes go through `move` / `setFlags` / `remove` and emit the usual `ma_event`s.
