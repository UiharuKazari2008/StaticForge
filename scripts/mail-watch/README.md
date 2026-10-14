# mail-watch

Standalone cron poller. It is not part of any bot process. Each run asks Dreamscape for unread inbox mail and, only when that bot has unread ids the state file has not recorded, POSTs the bot's webhook.

The script does not know office hours. The cron example decides how often it runs.

## Run

```bash
node scripts/mail-watch/mail-watch.js --config /etc/mail-watch/config.json
node scripts/mail-watch/mail-watch.js --config /etc/mail-watch/config.json --dry-run
node scripts/mail-watch/mail-watch.js --config /etc/mail-watch/config.json --bot rook
node scripts/mail-watch/mail-watch.js --help
```

`--dry-run` still calls `list_mail`. It prints what would wake and does not POST or write state.

Exit 0 when every selected bot succeeded. Exit 1 if config or state cannot be used, or any bot failed. A failure is caught per bot; the rest still run.

## Config

See `config.example.json`. Paths and URLs there are placeholders.

| Field | Meaning |
|---|---|
| `apiBaseUrl` | Dreamscape origin plus the unlisted `/{mcpPathUuid}` prefix. The script POSTs `{apiBaseUrl}/mcp`. |
| `webhookKeyFile` | Sender key sent as the webhook `Authorization` header. A bare token is sent as `Bearer <token>`. A single line that already starts with `Bearer` or `Basic` is sent as-is. |
| `stateFile` | JSON file of mailbox ids already woken. The parent directory must exist. |
| `timeoutMs` | Optional per-request timeout (default 20000, max 120000). |
| `entries[]` | `{ bot, keyFile, webhookUrl }`. `webhookKeyFile` on an entry overrides the global sender key. |

`keyFile` is that bot's Dreamscape application key (`sfapp_…`), used only as `Authorization: Bearer` on `list_mail`. Keys stay in those files. Do not put them in the JSON config.

`bot` is the mailbox name (`rook`, `menma`, …). `list_mail` returns `owner` even when `mail` is empty; the poller refuses the bot when `owner` is missing or is a different mailbox.

## Dreamscape read

`POST {apiBaseUrl}/mcp` with JSON-RPC `tools/call`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "list_mail",
    "arguments": { "folder": "inbox", "unreadOnly": true, "limit": 200 }
  }
}
```

That is the summary read (ids and subjects, no message body). `read_mail` is not called, so the poll does not mark mail read. The webhook body is only the ids that were not already in state:

```json
{ "bot": "rook", "count": 1, "ids": ["…"], "subjects": ["…"] }
```

A 2xx records those ids. Ids no longer unread are dropped when the unread list is complete (fewer than 200). A full page of 200 is treated as truncated: new ids are added and nothing is pruned, so a capped page cannot forget mail and wake it again later.

The same unread id is not posted twice while it remains in the state file.

## State

```json
{ "version": 1, "bots": { "rook": ["message-id"] } }
```

Writes go to a temp file in the same directory, then `rename` onto `stateFile`. `--bot` updates only that mailbox and leaves the other keys in the file.

## Schedule

`mail-watch.cron.example` is an `/etc/cron.d` example (`CRON_TZ=America/New_York`) with placeholder user `mailwatch` and placeholder paths. It uses `flock -n` so a slow run does not overlap the next one. Installing that file is a separate step; this repo does not install it.

Weekday 09:00–20:55 every five minutes, plus 21:00. Saturday 09:00 through Sunday 02:00, and Sunday 09:00 through Monday 02:00, on the same five-minute grid with a final `:00` tick. Every other hour runs once at `:00`. Hours that already fire at `:00` are left out of the hourly lines so those minutes run once.

## Logs

Stdout is one line per bot (`would wake`, `woke`, `no new mail`). Stderr is the bot name and a short failure. Keys, `Authorization` values, and full URLs are not written. A webhook or API URL that contains a token must not be used; config URLs reject userinfo.
