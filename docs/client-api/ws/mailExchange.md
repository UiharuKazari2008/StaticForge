# WebSocket: Dreamscape Exchange Server

Server handler: `modules/ws/handlers/255-mailExchangeHandler.js`.
Logic: `modules/mailExchange.js`. Client: `public/scripts/comp/desktop-apps/exchange.js`.
DSAP: `dsap://exchange.dreamscape.jp` (admin Tools menu). Relay: [docs/lantis-relay-api.md](../../lantis-relay-api.md).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Every packet is identity-gated to **Yukimi, Sala, or Tsubame (mailroom)**. Anyone else gets `type: "error"` with code `FORBIDDEN`. Off until `config.mailExchange.enabled` is true — mutations then return `DISABLED`. Relay tokens never appear in responses or audit details.

Yukimi's public From is `kazari.ops@dream.737.jp.net` (aliases `kazari@`, `yukimi.kazari@`, `yukimi@`).

Destructive packets need `confirm: true`. Soft-delete also needs `confirmText: "DELETE"`. Mailbox keys are shown once; only a SHA-256 hash is stored.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `exchange_list_mailboxes` | `exchange_list_mailboxes_response` | exchange admin | `{ mailboxes: [...] }` |
| `exchange_create_mailbox` | `exchange_create_mailbox_response` | exchange admin / destructive | `{ owner, dept, displayName?, confirm }` → `{ mailbox }` mapped to `name.dept@dream.737.jp.net` |
| `exchange_disable_mailbox` | `exchange_disable_mailbox_response` | exchange admin / destructive | `{ owner, enabled, confirm }` |
| `exchange_delete_mailbox` | `exchange_delete_mailbox_response` | exchange admin / destructive | Soft-delete. Cannot delete Yukimi. |
| `exchange_issue_key` | `exchange_issue_key_response` | exchange admin / destructive | `{ owner, confirm }` → `{ owner, key, keyHash, shownOnce }` |
| `exchange_rotate_key` | `exchange_rotate_key_response` | exchange admin / destructive | Replaces the hash; new secret shown once |
| `exchange_revoke_key` | `exchange_revoke_key_response` | exchange admin / destructive | |
| `exchange_list_aliases` | `exchange_list_aliases_response` | exchange admin | `{ aliases, lists }`. `mailroom.ops` catch-all to Tsubame |
| `exchange_upsert_alias` | `exchange_upsert_alias_response` | exchange admin / destructive | Loops rejected (`ALIAS_LOOP`) |
| `exchange_delete_alias` | `exchange_delete_alias_response` | exchange admin / destructive | |
| `exchange_upsert_list` | `exchange_upsert_list_response` | exchange admin / destructive | Distribution list; loops rejected |
| `exchange_delete_list` | `exchange_delete_list_response` | exchange admin / destructive | |
| `exchange_get_signature` | `exchange_get_signature_response` | exchange admin | `{ owner }` → `{ owner, html, address }` |
| `exchange_set_signature` | `exchange_set_signature_response` | exchange admin / destructive | HTML sanitized; appended to outbound |
| `exchange_get_toggles` | `exchange_get_toggles_response` | exchange admin | `{ toggles: { inbound, outbound, mailboxes, services } }` |
| `exchange_set_toggles` | `exchange_set_toggles_response` | exchange admin / destructive | Local store + `PUT /v1/toggles` on LANTIS with admin token and `actor` |
| `exchange_dashboard` | `exchange_dashboard_response` | exchange admin | Intake listener, Postfix, queue, filters, OCI senders+DKIM, WireGuard, blocklists, rejects. `degraded` when the relay is down |
| `exchange_list_spam` | `exchange_list_spam_response` | exchange admin | Tsubame: all mailboxes. Yukimi/Sala: Yukimi Spam-only |
| `exchange_spam_move` | `exchange_spam_move_response` | exchange admin / destructive | Rescue/purge via mailroom tools; never Yukimi |
| `exchange_audit` | `exchange_audit_response` | exchange admin | `{ audit: [{ ts, actor, action, target, detail, success }] }` |

HTTP surface: [rest-api.md — Dreamscape Exchange Server](../rest-api.md#dreamscape-exchange-server).
MCP tools (`role: exchange`, scope `sfapp_mail_exchange`): `exchange_list_mailboxes`, `exchange_create_mailbox`, `exchange_disable_mailbox`, `exchange_delete_mailbox`, `exchange_mailbox_key`, `exchange_aliases`, `exchange_signatures`, `exchange_toggles`, `exchange_status`, `exchange_spam`.
