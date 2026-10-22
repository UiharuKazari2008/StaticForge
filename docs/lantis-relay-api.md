# LANTIS Relay API

Versioned JSON HTTP API the Dreamscape Exchange Server calls on the LANTIS
mail host (Postfix + filters + OCI Email Delivery). The sysadmin implements
this service on LANTIS. Dreamscape only consumes it.

## Reachability

- Bound on the LANTIS WireGuard address `192.168.255.1`.
- Base URL `http://192.168.255.1:8787` (Dreamscape `DEFAULT_BASE_URL`); paths
  are under `/v1`. Reachable **only** from `192.168.255.0/24`. Do not publish
  on the WAN.
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
| Admin | `PUT /v1/toggles`, `PUT /v1/recipients` |

Send `Authorization: Bearer <token>`. A GET with the admin token may be
accepted; a mutation with the read token must be `403`.

Dreamscape includes an `actor` field on every mutating body (mailbox owner:
`yukimi`, `sala`, or `tsubame` / Tsubame; `mailroom` is the role alias). The
relay **must audit-log** every mutation: actor, action, target, time. No
secrets in that log. `confirm` is Dreamscape-client-only and is **not** part
of the relay body.

## Timeouts and errors

- Clients time out (Dreamscape default 5s). Slow Postfix queries should
  return a partial payload plus `degraded: true` rather than hang.
- Error body: `{ "error": "<message>", "code": "<MACHINE>" }` with 4xx/5xx.
- Unknown version prefix (`/v2/...` before it exists) → `404`.

## Endpoints

Base path `/v1`. Listen `:8787` on `192.168.255.1`.

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
    "sender": "kazari.ops@dream.737.jp.net",
    "dkim": "ok"
  }
}
```

`filters.*` values: `up` | `down` | `unknown`. `oci.dkim`: `ok` | `missing` |
`fail` | `unknown`. `oci.sender` is the OCI Email Delivery approved sender
(`kazari.ops@dream.737.jp.net`). `dreamscape@dream.737.jp.net` is a Postfix
submission login only, not an OCI sender.

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
not a scan of live mail.

- `ok: true` — the test-point **answered correctly** (the lookup itself
  succeeded). `ok: false` means the lookup failed; `listed` is then
  untrusted.
- `listed: true` — **our IP is listed** on that blocklist. `listed: false`
  means the test-point said we are not listed.

Label both fields separately in any UI. Do not treat `ok` as “not listed”.

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

OCI Email Delivery approved senders (a snapshot with `refreshed_at`) plus
Postfix submission logins and the From addresses each login may use.
Yukimi's public From is `kazari.ops@dream.737.jp.net` (aliases `kazari@`,
`yukimi.kazari@`). `dreamscape@dream.737.jp.net` is the submission login,
not an OCI sender.

`submission.from` may be long: Postfix can expand a wildcard
(`*@dream.737.jp.net`) into many addresses. Clients must render a compact,
collapsible list rather than dumping the array.

```json
{
  "refreshed_at": "2026-10-19T21:00:00Z",
  "oci": {
    "approved": [
      {
        "email": "kazari.ops@dream.737.jp.net",
        "dkim": "ok",
        "state": "approved"
      }
    ]
  },
  "submission": [
    {
      "login": "dreamscape@dream.737.jp.net",
      "from": [
        "*@dream.737.jp.net",
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

`refreshed_at` is ISO-8601 UTC for the whole senders snapshot. Show its age
in the UI.

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

Admin token required. Semantics are **PATCH-like**, not replace:

- A missing `inbound` or `outbound` field is left **unchanged**. The server
  does not default a missing field to `true`.
- `mailboxes` and `services` merge **per key**. Omitted keys stay.
- JSON `null` for a mailbox or service key **deletes** that entry.
- Unknown mailbox name → `400`
  `{ "error": "Unknown mailbox nova", "code": "UNKNOWN_MAILBOX" }`.
- Unknown service name → `400`
  `{ "error": "Unknown service smtp", "code": "UNKNOWN_SERVICE" }`.
- A present `inbound`/`outbound` that is not a boolean → `400`
  `{ "error": "inbound must be a boolean", "code": "BAD_BODY" }`.
- Missing or empty `actor` → `400`
  `{ "error": "actor is required", "code": "ACTOR_REQUIRED" }`.
- Response is the **full** toggle document after the change (GET shape, no
  `actor`).
- `confirm` is not a relay field (Dreamscape prompts before calling).

```json
{
  "actor": "yukimi",
  "outbound": false,
  "mailboxes": {
    "yukimi": { "inbound": false },
    "sala": null
  },
  "services": {
    "yozora": { "outbound": false }
  }
}
```

In that example global inbound is untouched, global outbound becomes false,
`yukimi.inbound` is set and `yukimi.outbound` is untouched, the `sala`
override is removed, and Yozora outbound is set false.

Mailbox/service objects merge the same way: a missing `inbound`/`outbound`
on that key is left unchanged.

Audit on the relay:
`{ actor, action: "toggles", target: "global"|mailbox|service, time }`.

### `PUT /v1/recipients`

**Pending approval.** The LANTIS HTTP service does not expose this path yet.
Dreamscape still PUTs after every mailbox, address, alias, or list change
(and on the Exchange admin resync). A `404` is the expected answer until
the endpoint is approved. The client **fails soft** (`RELAY_ENDPOINT_MISSING`)
and **logs**; local Exchange/intake stay up. Intake recovery still files
trusted catch-all mail whose relay `X-Original-To` names an active mailbox
(never To/Cc, lists, or aliases; peer must be the relay IP).

LANTIS SMTP already accepts **any** `@dream.737.jp.net` address. Addresses
that are **not** in the Postfix `virtual_known` rewrite map are rewritten
by a catch-all pcre to `mailroom.ops@dream.737.jp.net`. This PUT replaces
`virtual_known` with the full set of **active** mailbox addresses, aliases,
and distribution lists so those locals are not rewritten.

Admin token required. `confirm` is Dreamscape-client-only and is **not**
part of the relay body.

```json
{
  "actor": "yukimi",
  "recipients": [
    {
      "local": "kazari.ops",
      "address": "kazari.ops@dream.737.jp.net",
      "mailbox": "yukimi",
      "kind": "mailbox"
    },
    {
      "local": "kazari",
      "address": "kazari@dream.737.jp.net",
      "mailbox": "yukimi",
      "kind": "mailbox"
    },
    {
      "local": "helpdesk",
      "address": "helpdesk@dream.737.jp.net",
      "mailbox": "tsubame",
      "kind": "alias"
    },
    {
      "local": "ops-all",
      "address": "ops-all@dream.737.jp.net",
      "members": ["yukimi", "sala"],
      "kind": "list"
    },
    {
      "local": "mailroom.ops",
      "address": "mailroom.ops@dream.737.jp.net",
      "mailbox": "tsubame",
      "kind": "catchall"
    }
  ]
}
```

- `actor` is required (same as toggles).
- `recipients` is the **full** `virtual_known` set. Replace, do not merge.
  Each `address` / `local` is a rewrite-map key. Disabled or deleted
  mailboxes are omitted. `mailroom.ops` stays in the set (the catch-all
  destination).
- `kind`: `mailbox` | `alias` | `list` | `catchall`.
- `mailbox` is the Dovecote owner for mailbox/alias/catchall rows.
- `members` is present on lists (mailbox names or local-parts).
- Response: `{ "ok": true, "count": 42 }` (accepted row count).
- Until implemented: `404` `{ "error": "Not found", "code": "NOT_FOUND" }`.
- Missing or empty `actor` → `400` `{ "error": "actor is required", "code": "ACTOR_REQUIRED" }`.
- `recipients` not an array → `400` `{ "error": "recipients must be an array", "code": "BAD_BODY" }`.

Audit on the relay (once the path exists):
`{ actor, action: "recipients", target: "virtual_known", time }`.

## Dreamscape client

- Module: `modules/lantisRelayClient.js`
- Mock for tests: `modules/lantisRelayMock.js`
- Off until `config.mailExchange.enabled` is true.
- Unreachable relay: Exchange dashboard shows degraded; local toggles and
  mailbox CRUD still work.
