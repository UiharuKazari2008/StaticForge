# WebSocket: Ingest Controller

Server handler: `modules/ws/handlers/314-ingestControllerHandler.js`. Client: `public/scripts/comp/mmcIngest.js`
(Server Manager > Roles > Ingest Controller, also its own window from Administrative Tools). What the pipeline
does: [../ingest-controller.md](../ingest-controller.md).

**Signed-in administrators only** (`admin`, `dev_admin`). A socket signed in with an application key must also
have the `sfapp_messaging_bridge` scope, as on MCP. The writes are in the destructive list
(`modules/websocketHandlers.js`): a read-only user cannot send them.

Every packet is the MCP tool of the same name and runs the same code: `messagingBridgeMcp.runBridgeTool`, the
dispatch, confirms and audit (`exchange_audit`, actor `yukimi` for the administrator's own desktop) the MCP
tools use. Only the fields listed below are passed on; the actor always comes from the socket.

## Packets

| Packet | Fields | Kind |
|--------|--------|------|
| `ingest_list_accounts` | `source?` | read |
| `ingest_list_modules` | `source?`, `accountId?`, `probe?` (pings spamd) | read |
| `ingest_dry_run` | `source`, `accountId`, `ref?` or `message? { from, subject, text, ... }`, `allModules?`, `scoreSpam?` | read (nothing is applied) |
| `ingest_log` | `source?`, `accountId?`, `limit?` (50, at most 200), `before?` (an entry id: the page older than it) | read |
| `ingest_expiry_status` | `source` (`email` / `exchange`), `accountId`, `limit?` | read |
| `bridge_mail_list_rules` | `accountId?` | read |
| `ingest_set_mode` | `source`, `accountId` (or `*`), `mode` (`bypass` / `process`), `applying?`, `confirm?` | write |
| `ingest_configure_module` | `source`, `accountId` (or `*`), `module`, `enabled?`, `settings?`, `position?`, `reset?`, `confirm?` | write |
| `ingest_expiry_sweep` | `source`, `accountId` (or `*`), `dryRun?` (default true), `confirm?` | write |
| `bridge_mail_save_rule` | `id?`, `accountId?`, `name?`, `enabled?`, `position?`, `match?`, `actions?` | write |
| `bridge_mail_delete_rule` | `id`, `confirm` | write |
| `bridge_mail_run_rules` | `accountId`, `folder?`, `limit?`, `ruleId?`, `dryRun?` (default true), `confirm?` | write |

Reply: `<type>_response` with `data` = `{ success: true, ...the tool's result }` (the shapes in
[../ingest-controller.md](../ingest-controller.md) and the MCP tool descriptions), or
`{ success: false, error, code }`. A refusal is a response, never an `error` packet (the desktop shows those as an
unhandled exception). Codes are the tool's: `CONFIRM_REQUIRED`, `NOT_FOUND`, `BAD_SOURCE`, `BAD_MODE`,
`BAD_SETTINGS`, `NO_MODULE`, `NO_MATCH`, `BAD_ACTIONS` ..., and `INSUFFICIENT_PERMISSIONS` for anyone but an
administrator.

`ingest_log` answers `{ entries, more }`: newest first; `more` is true while older entries remain (send the
last entry's `id` as `before` for the next page). MCP's `ingest_log` takes `before` too.

### Confirmations

`confirm: true` is wanted exactly where MCP wants it: switching to process mode, turning on applying, enabling a
module that deletes or forwards (spam to Trash, a routing rule with `delete` / `forwardTo`, expiry), any module
change on an applying account, a sweep with `dryRun: false`, deleting a mail rule, and running the mail rules with
`dryRun: false`. Going back to bypass and dry-run sweeps or previews need none.

The console sends a write without `confirm`; on `CONFIRM_REQUIRED` it asks (a Vista message box) and sends it
again with `confirm: true`, so it asks exactly when the server would. A real sweep, a mail rule delete and a real
run of the mail rules are asked before anything is sent. Stopping applying (back to dry-run) is sent with
`confirm: true` without a question: it only takes power away.

## Feed `ingest_controller`

`status_subscribe { feed: "ingest_controller" }` ([statusHub.md](./statusHub.md)); push type
`ingest_controller_status`. Same gate as the packets. The console subscribes while one of its pages shows and
unsubscribes a second after the last one goes (or when the window closes).

Items:

- `a:<source>|<accountId>`: the account's `ingest_list_accounts` row (`mode`, `applying`, `dryRun`, `pipeline`
  `[{ id, enabled }]` in order, `updated`).
- `x:<source>|<accountId>`: `{ counts, lastSweep, sweepEveryMinutes }` for mail accounts in process mode with
  expiry on (removed when that ends).
- `log`: the newest 8 `ingest_log` entries.
- `rules`: the mail rules (`bridge_mail_list_rules`).

Pushed when something changes: the ingest store's writes (`ingestStore.onChange`: a mode or module change from
MCP or the console, a decision logged as mail arrives, an expiry sweep) and mail rule writes
(`messagingBridgeMcp.onRulesChange`), a burst read once after 400 ms. The feed's own read every 10 minutes only
catches accounts added elsewhere (a new IMAP account, a new mailbox).
