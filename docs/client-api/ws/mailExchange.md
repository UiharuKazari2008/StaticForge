# WebSocket: Dreamscape Exchange Server

Server handler: `modules/ws/handlers/255-mailExchangeHandler.js`.
Logic: `modules/mailExchange.js`. Client: `public/scripts/comp/desktop-apps/exchange.js`.
DSAP: `dsap://exchange.dreamscape.jp` (Control Panel DSAP page, All Apps, admin Tools). Relay: [docs/lantis-relay-api.md](../../lantis-relay-api.md).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Every packet is identity-gated to **Yukimi, Sala, or Tsubame (mailroom)**. Application keys also need the `sfapp_mail_exchange` scope (granted per key — Tsubame's mailroom key is given it, other bot keys are not). Anyone else gets `type: "error"` with code `FORBIDDEN` or `INSUFFICIENT_SCOPE`. Off until `config.mailExchange.enabled` is true — mutations then return `DISABLED`. Relay tokens never appear in responses or audit details.

Mailbox owners and intake addresses live in the Exchange DB (seeded from code defaults). `config.mailGateway.mailboxes` / secureConfig overlay that table; they do not replace it wholesale. Creating a mailbox or adding an address is live — no restart.

Yukimi's public From is `kazari.ops@dream.737.jp.net` (aliases `kazari@`, `yukimi.kazari@`, `yukimi@`).

Destructive packets need `confirm: true`. Soft-delete also needs `confirmText: "DELETE"`. Mailbox keys are shown once; only a SHA-256 hash is stored.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `exchange_list_mailboxes` | `exchange_list_mailboxes_response` | exchange admin | `{ mailboxes: [...] }` |
| `exchange_get_mailbox` | `exchange_get_mailbox_response` | exchange admin | `{ owner }` → `{ mailbox }` including extra intake addresses and stored `inboundEnabled` / `outboundEnabled`. If LANTIS reports a different inbound/outbound, `relayInboundEnabled` / `relayOutboundEnabled` are included |
| `exchange_create_mailbox` | `exchange_create_mailbox_response` | exchange admin / destructive | `{ owner, dept, displayName?, confirm }` → `{ mailbox }` mapped to `name.dept@dream.737.jp.net`. Live immediately |
| `exchange_update_mailbox` | `exchange_update_mailbox_response` | exchange admin / destructive | `{ owner, displayName?, dept?, newOwner?, confirm }` |
| `exchange_disable_mailbox` | `exchange_disable_mailbox_response` | exchange admin / destructive | `{ owner, enabled, confirm }` |
| `exchange_delete_mailbox` | `exchange_delete_mailbox_response` | exchange admin / destructive | Soft-delete. Cannot delete Yukimi. |
| `exchange_add_address` | `exchange_add_address_response` | exchange admin / destructive | `{ owner, localPart, confirm }` extra intake local-part. Never an external domain |
| `exchange_remove_address` | `exchange_remove_address_response` | exchange admin / destructive | `{ localPart, confirm }`. Cannot remove the primary address |
| `exchange_issue_key` | `exchange_issue_key_response` | exchange admin / destructive | `{ owner, confirm }` → `{ owner, key, shownOnce }` (the secret is shown once; the hash stays on the server) |
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
| `exchange_set_toggles` | `exchange_set_toggles_response` | exchange admin / destructive | `PUT /v1/toggles` first (admin token + `actor`, no `confirm` on the wire). Local store is written only after the relay accepts. Per-mailbox inbound/outbound also writes through to that `exchange_mailbox` row. Relay `400` codes `UNKNOWN_MAILBOX` / `UNKNOWN_SERVICE` / `BAD_BODY` / `ACTOR_REQUIRED` come back on `relay` with a friendly message |
| `exchange_dashboard` | `exchange_dashboard_response` | exchange admin | Intake listener, Postfix, queue, filters, OCI senders+DKIM, WireGuard, blocklists, rejects. `degraded` when the relay is down |
| `exchange_resync_recipients` | `exchange_resync_recipients_response` | exchange admin / destructive | Replace LANTIS `virtual_known` with the full active mailbox/alias/list set (`PUT /v1/recipients`). Endpoint is pending approval — `404` fails soft and is logged (`RELAY_ENDPOINT_MISSING`). `{ confirm }` |
| `exchange_list_spam` | `exchange_list_spam_response` | exchange admin | Tsubame: all mailboxes. Yukimi/Sala: Yukimi Spam-only |
| `exchange_spam_move` | `exchange_spam_move_response` | exchange admin / destructive | Rescue/purge via mailroom tools; never Yukimi |
| `exchange_audit` | `exchange_audit_response` | exchange admin | `{ audit: [{ ts, actor, action, target, detail, success }] }` |

HTTP surface: [rest-api.md — Dreamscape Exchange Server](../rest-api.md#dreamscape-exchange-server).
MCP tools (`role: exchange`, scope `sfapp_mail_exchange`): `exchange_list_mailboxes`, `exchange_get_mailbox`, `exchange_create_mailbox`, `exchange_update_mailbox`, `exchange_disable_mailbox`, `exchange_delete_mailbox`, `exchange_add_address`, `exchange_remove_address`, `exchange_mailbox_key`, `exchange_aliases`, `exchange_signatures`, `exchange_toggles`, `exchange_status`, `exchange_resync_recipients`, `exchange_spam`, `exchange_set_mailbox_notify_forward`, `exchange_get_mailbox_notify_forward`, `exchange_clear_mailbox_notify_forward`.

Per-mailbox notify-forward (own-mailbox MCP + `/dovecote/mailbox/notify-forward`, admin variants above): [rest-api.md — Dovecote mailbox notify-forward](../rest-api.md#dovecote-mailbox-notify-forward). Inbox delivery emits `mailbox_new_mail`; the dispatcher consumes that event stream.
