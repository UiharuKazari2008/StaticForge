# LANTIS Relay API

Versioned JSON HTTP API the Dreamscape Exchange Server calls on the LANTIS
mail host (Postfix + filters + OCI Email Delivery). The sysadmin implements
this service on LANTIS. Dreamscape only consumes it.

## Reachability

- Bound on the LANTIS WireGuard address (suggested `192.168.255.1`).
- Reachable **only** from `192.168.255.0/24`. Do not publish on the WAN.
- TLS optional on the WG mesh; Dreamscape still sends `Authorization`.
- JSON request and response bodies only. No HTML.

## Auth

Two Bearer tokens, stored separately on Dreamscape as
`secureConfig.mailExchange.relayReadToken` and
`secureConfig.mailExchange.relayAdminToken` (env fallbacks
`MAIL_EXCHANGE_RELAY_READ_TOKEN` / `MAIL_EXCHANGE_RELAY_ADMIN_TOKEN`).
**Never** send either token to a browser, log, or audit detail.

| Token | Used for |
|---|---|
| Read | Every `GET` |
| Admin | `PUT /v1/toggles` and any future mutation |

Send `Authorization: Bearer <token>`. A GET with the admin token may be
accepted; a mutation with the read token must be `403`.

Dreamscape includes an `actor` field on every mutating body (mailbox owner:
`yukimi`, `sala`, or `tsubame` / Tsubame; `mailroom` is the role alias). The relay **must audit-log**
every mutation: actor, action, target, time. No secrets in that log.

## Timeouts and errors

- Clients time out (Dreamscape default 5s). Slow Postfix queries should
  return a partial payload plus `degraded: true` rather than hang.
- Error body: `{ "error": "<message>", "code": "<MACHINE>" }` with 4xx/5xx.
- Unknown version prefix (`/v2/...` before it exists) → `404`.

## Endpoints

Base path `/v1`. Suggested listen `:8787` on the WG address.

### `GET /v1/status`

Intake-adjacent health for the Exchange dashboard.

```json
{
  "postfix": { "up": true, "pid": 1234 },
  "filters": {
    "spamassassin": "up",
    "opendmarc": "up",
    "opendkim": "up",
    "unbound": "up"
  },
  "wireguard": { "up": true, "interface": "wg0", "peer": "192.168.255.2" },
  "oci": {
    "sender": "dreamscape@dream.737.jp.net",
    "dkim": "ok"
  }
}
```

`filters.*` values: `up` | `down` | `unknown`. `oci.dkim`: `ok` | `missing` |
`fail` | `unknown`.

### `GET /v1/queue`

```json
{
  "active": 0,
  "deferred": 0,
  "hold": 0,
  "oldest_age": 0
}
```

`oldest_age` is seconds, or `null` when the queue is empty.

### `GET /v1/blocklists`

Per-list test-point lookup plus SpamAssassin rules freshness.

```json
{
  "lists": {
    "zen": { "ok": true, "listed": false, "checked_at": "2026-10-19T21:00:00Z" },
    "spamcop": { "ok": true, "listed": false, "checked_at": "2026-10-19T21:00:00Z" },
    "barracuda": { "ok": true, "listed": false, "checked_at": "2026-10-19T21:00:00Z" },
    "psbl": { "ok": true, "listed": false, "checked_at": "2026-10-19T21:00:00Z" }
  },
  "sa_rules_updated": "2026-10-18T04:12:00Z"
}
```

Test points are the list operator's documented never/always-listed probes,
not a scan of live mail. `ok: false` means the lookup itself failed.

### `GET /v1/rejects?since=&limit=`

Recent SMTP rejects (RBL, DMARC, recips, size). `since` is ISO-8601;
`limit` default 50, max 200.

```json
{
  "rejects": [
    {
      "at": "2026-10-19T20:15:01Z",
      "from": "spammer@example.net",
      "to": "kazari.ops@dream.737.jp.net",
      "code": "554",
      "reason": "blocked by zen.spamhaus.org"
    }
  ]
}
```

Do not include message bodies or AUTH secrets.

### `GET /v1/senders`

OCI Email Delivery approved senders, plus Postfix submission logins and the
From addresses each login may use. Yukimi's public From is
`kazari.ops@dream.737.jp.net` (aliases `kazari@`, `yukimi.kazari@`).

```json
{
  "oci": {
    "approved": [
      {
        "email": "dreamscape@dream.737.jp.net",
        "dkim": "ok",
        "state": "approved"
      }
    ]
  },
  "submission": [
    {
      "login": "dreamscape@dream.737.jp.net",
      "from": [
        "kazari.ops@dream.737.jp.net",
        "kazari@dream.737.jp.net",
        "yukimi.kazari@dream.737.jp.net",
        "sala.ops@dream.737.jp.net",
        "tsubame.ops@dream.737.jp.net",
        "mailroom.ops@dream.737.jp.net"
      ]
    }
  ]
}
```

### `GET /v1/toggles`

Global inbound/outbound plus per-mailbox and per-service entries.

```json
{
  "inbound": true,
  "outbound": true,
  "mailboxes": {
    "yukimi": { "inbound": true, "outbound": true },
    "sala": { "inbound": true, "outbound": true },
    "tsubame": { "inbound": true, "outbound": true }
  },
  "services": {
    "yozora": { "outbound": true }
  }
}
```

Omitted mailbox/service keys mean "inherit global". Dreamscape also stores
these locally and enforces them on intake/outbound even when the relay is
unreachable.

### `PUT /v1/toggles`

Admin token required. Body is the GET shape plus `actor` (required) and
optional `confirm: true` (Dreamscape always sends confirm on mutations).

```json
{
  "actor": "yukimi",
  "confirm": true,
  "inbound": true,
  "outbound": false,
  "mailboxes": {
    "yukimi": { "inbound": true, "outbound": false }
  },
  "services": {
    "yozora": { "outbound": false }
  }
}
```

Response is the resulting toggle document (same as GET, without `actor`).
Audit on the relay: `{ actor, action: "toggles", target: "global"|mailbox|service, time }`.

## Dreamscape client

- Module: `modules/lantisRelayClient.js`
- Mock for tests: `modules/lantisRelayMock.js`
- Off until `config.mailExchange.enabled` is true.
- Unreachable relay: Exchange dashboard shows degraded; local toggles and
  mailbox CRUD still work.
