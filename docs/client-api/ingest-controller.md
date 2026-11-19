# Ingest Controller

One pipeline between the places mail and texts arrive and Yukimi's inboxes (Yukimi, Nov 19 2026; built by Menma for Tsubame, the mailroom bot). It sits in front of three sources:

| source | accounts | hook (new messages only) |
|--------|----------|--------------------------|
| `email` | each IMAP bridge account (iCloud ...), `modules/mailAccounts.js` | `rulesSoon()` after the IDLE fetch / a sync pass that fetched Inbox mail → `onMailArrived(account)`; per-account UID marker `ingestUid` in `mailaccounts.db` |
| `exchange` | each DS Exchange (Dovecote) mailbox | `mailGateway.js` `deliver` → `exchangeInbound(msg)` **before** `dovecoteMail.deliverInboundMail` writes the row, then `after(result)` |
| `sms` | each text account (BlueBubbles / iMessage, RCS, Android), `modules/textMessaging.js` | `onProviderEvent` → `textInbound(account, event)` before the `tm_event` broadcast (1.5 s cap) |

Everything is on MCP (`ingest_*`, scope `sfapp_messaging_bridge`, Tsubame / Yukimi only; see [mcp-connector.md](mcp-connector.md)). There is no WebSocket surface.

## Modes

Per account: **bypass** (default, as today: nothing here touches the message; e-mail accounts still get the older mail rules) or **process**.

Switching to process starts **dry-run**: the intended actions are written to `ingest_log` (`dry: true`) and nothing else happens. `ingest_set_mode { applying: true, confirm: true }` makes them real. Switching to process, enabling applying, and enabling a module that deletes or forwards all need `confirm: true`; going back to bypass does not. Leaving process mode moves the older rules' marker to now, so they never replay what happened in between.

## Pipeline

Per account, an ordered list `[{ id, enabled, settings }]` (default order `spamFilter`, `codeExtraction`, `routing`; the first two start disabled, `routing` enabled with no rules). Modules only **decide**; the actions of the whole pipeline are applied afterwards. A `move` or `delete` stops the later modules (the trace says "stopped by ..."). Codes come before routing so a message about to be filed away still announces its code. A module that throws, times out, or cannot reach spamd is skipped: the message is left alone (fail open).

Actions: `move { to }`, `delete` (into Trash), `markRead`, `flag`, `forward { to }`, `handToAgent { mailbox }`, `silence` (texts: read and no notification), `notify`. Order of application: flags, silence, forward, hand-off, notify, then the move or delete.

Folders: e-mail uses the account's folder paths (`@junk` = its Junk, else Trash; a missing folder such as `Later` is created). Exchange: `inbox`, `spam` (`@junk`), `archive`, `deleted`; any other name is an Archive subfolder (`Later` → Archive / Later). Exchange folder, read and flag are applied at delivery, so a filtered message never raises a New E-mail notification. Texts have no folders.

### spamFilter

* **Mail** (email, exchange): SpamAssassin **spamd** over TCP, spamc protocol (`SYMBOLS SPAMC/1.5`). Defaults `host 192.168.255.1`, `port 783` (LANTIS; Postfix's milter shares it with only two children, so calls are one at a time, `timeoutMs` 4000, 200 KB at most, a queue of 20, then skipped). `threshold` 8 (SpamAssassin's own "required" is 5), `action` `junk` (`trash` deletes and needs confirm). E-mail: the source is fetched from the IMAP server (`mailAccounts.fetchRaw`), else rebuilt from the synced copy. Exchange reuses the relay's own score already stamped on the message (`trustRelayScore`, default true) instead of asking spamd again. `allowFrom` patterns skip the filter. Unreachable, timeout, garbage reply, error code: fail open.
* **Texts**: `spamNumbers` (digit-suffix or glob match) and a light heuristic (short links, bait words, toll / parcel / account scam phrasing, unknown sender with a link); `textThreshold` 3, `textAction` `silence` or `delete` (deletes only an unknown one-to-one conversation). A message that is just a verification code is never spam. Known contacts skip the heuristic.

### codeExtraction

Pulls 4-8 digit codes next to a verification word (`verification code is 482913`, `123 456 is your ... code`, `G-554433`) and sign-in / verify / confirm links, and raises one notice on Yukimi's devices through the notification inbox (`notificationInbox.publish`, class `notification`, 15 minutes). Years, amounts and long numbers are not codes. **A code is never written anywhere else**: not a log line, not `ingest_log`, not `exchange_audit`, not MCP activity (`mcpActivity` redacts them in every argument), not a dry-run result (`text: "[redacted]"`), and not an agent hand-off (the body and subject are redacted). Texts that were announced as a code do not also raise the normal New Text Message notice. Settings: `links` (default true), `markRead` (default false).

### routing

`settings.groups` is `{ name: [patterns] }` (exact address, `@domain`, or `*` globs such as `*@bank.example`). `settings.rules` is an ordered list; the first matching rule applies (`stop: false` keeps going):

```json
{ "name": "everyone else -> Later",
  "match": { "all": [ { "field": "from", "op": "in", "group": "approved", "not": true } ] },
  "actions": { "moveTo": "Later", "markRead": true } }
```

`match` has `all`, `any` and `none` lists of conditions `{ field: from|to|subject|body|header|any, op: contains|equals|startsWith|endsWith|regex|in|exists, value | group, header, not }` (case-insensitive; regex is length-limited and refuses patterns that can blow up). The flat form `{ from, to, subject, body }` (contains) works too. `actions`: `moveTo` or `delete` (not both), `markRead`, `flag`, `forwardTo`, `handTo` (an agent mailbox), `notify`, `silence`. E-mail and Exchange forwards: Exchange forwards stay inside Dovecote (`forwardMail`); e-mail forwards go out through the account's SMTP; texts can only be forwarded to a Dovecote mailbox. `includeLegacyRules` (default true, e-mail) runs the older mail rules (`bridge_mail_save_rule`) first inside the pipeline, with their hit counts, so process mode loses nothing.

### Hand-off to an agent

`handTo` / `handToAgent` delivers Dovecote **system mail** (from `ingest-controller@dream.737.jp.net`, no bot key) to the named mailbox, e.g. `tsubame` (tsubame.ops@dream.737.jp.net): the sender, subject, a pointer to read the original (`bridge_mail_message ...`) and the start of the body, with codes removed. The controller never processes its own hand-offs. Forwards, hand-offs and notices are limited per account (20, 20 and 30 per minute).

## Storage

`.cache/ingest.db`, created the first time an account is configured (nothing is created while every account is in bypass):

* `ingest_accounts (source, account, mode, applying, pipeline JSON, created, updated, updated_by)`
* `ingest_log (id, ts, source, account, ref, dry, sender, subject, actions, stopped_by)` - sender and subject with codes redacted; last ~1000 rows kept.

## Tests

`node scripts/test-ingest-controller.js` (`npm run test:ingest-controller`): a fake spamd on a real socket (score, ham, hang, garbage, error, refused), routing negation and groups, OTP extraction and redaction across logs / audit / activity / hand-offs, fail-open, dry-run by default, confirms, and all three sources (the Exchange part uses the real Dovecote store). `scripts/test-messaging-bridge-mcp.js` keeps passing.
