# WebSocket: Director (SI learning)

Server handler: `modules/ws/handlers/40-directorHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `director_abort` | `director_abort_response` | admin/destructive | Hard-stops the running turn for `sessionId` (agent process tree and a pending resume). `steer: true` keeps the transcript and does not report the turn as stopped. |
| `director_fork_session` | `director_fork_session_response` | admin/destructive | Copies the chat through `messageId` into a new session. The original chat stays. |
| `director_cleanup` | `director_cleanup_response` | admin/destructive | Deletes temp and caches inside `computer/`. Refused with `DIRECTOR_BUSY` while a turn runs. |
| `director_computer_size` | `director_computer_size_response` | admin/destructive | Bytes used by `computer/` (and its `home`) plus `promptGuide` state. |
| `director_computer_status` | `director_computer_status_response` | session | Tray state, computer readiness, the 3 most recent chats, and the agent's live CPU / RSS. |
| `director_create_session` | `director_create_session_response` | admin/destructive | Handler: handleDirectorCreateSession |
| `director_delete_feedback` | `director_delete_feedback_response` | admin/destructive | Handler: handleDirectorDeleteFeedback |
| `director_delete_session` | `director_delete_session_response` | admin/destructive | Handler: handleDirectorDeleteSession |
| `director_get_messages` | `director_get_messages_response` | session | Handler: handleDirectorGetMessages |
| `director_get_models` | `director_get_models_response` | session | Model list for `engine` (`cursor` default, `claude`, `tokenrouter`), grouped by family. `models[]` has `id`, `name`, `short` (single-line picker label, empty when `name` already fits), `provider`, `cost`, `price`, `fast`, and `efforts`. Claude and TokenRouter also return `available`; TokenRouter returns `error` when its catalog is unreachable and there is no saved copy. `force: true` refetches the TokenRouter catalog. |
| `director_custom_providers_get` | `director_custom_providers_response` | admin | `{ providers, presets }`. `providers[]` is each custom engine's public row (`id`, `name`, `baseUrl`, `kind`, `defaultModel`, `monitorUsage`, `hasKey`, `hasManagementKey`, `logo`, and the per-engine tool switches described under [Engines (Wren)](#engines-wren)). Keys are never sent, only `hasKey` / `hasManagementKey`. `presets[]` is the supported hosts the form offers: `{ id, name, baseUrl, defaultModel }` (Google, OpenAI, TokenRouter, OpenRouter, NVIDIA NIM, DeepSeek, DeepInfra). See [Engines (Wren)](#engines-wren). |
| `director_custom_providers_save` | `director_custom_providers_save_response` | admin/destructive | `{ provider }` with the same fields as a `providers[]` row, plus `apiKey`, optional `managementKey`, and optional `logo` (a PNG data URL, `""` removes it). A blank `apiKey` keeps the stored key. Answers `{ provider, providers }` in the `director_custom_providers_get` row shape. |
| `director_custom_providers_balance` | `director_custom_providers_balance_response` | session (admin data) | Balances for the engine pickers and CardSpace. Optional `engine` (`tokenrouter` or `custom:<id>`) asks for one; without it, TokenRouter plus every custom engine. `{ balances: [{ id, engine, name, kind, state, balance, currency, balanceText, title, granted?, toppedUp?, recent?, monthSpend?, limit?, suspended?, freeTier?, rateLimit? }] }`. Restricted users get `balances: []`. See [Provider balances](#provider-balances). |
| `director_get_session` | `director_get_session_response` | session | Handler: handleDirectorGetSession |
| `director_get_sessions` | `director_get_sessions_response` | session | Handler: handleDirectorGetSessions |
| `director_open_workspace` | `director_open_workspace_response` | admin/destructive | Opens the Cursor chat for the current workspace, or creates one. |
| `director_load_feedback` | `director_load_feedback_response` | session | Handler: handleDirectorLoadFeedback |
| `director_load_rules` | `director_load_rules_response` | session | Handler: handleDirectorLoadRules |
| `director_prompt_guide_commit` | `director_prompt_guide_commit_response` | admin/destructive | Commits the extracted tree onto `director-draft` with `message`. |
| `director_prompt_guide_diff` | `director_prompt_guide_diff_response` | admin/destructive | `git diff` of the work clone against `origin/main`. |
| `director_prompt_guide_extract` | `director_prompt_guide_extract_response` | admin/destructive | Stages the work clone tree for `director-draft` (no commit yet). |
| `director_prompt_guide_push` | `director_prompt_guide_push_response` | admin/destructive | Pushes `director-draft` to the Docubase origin. |
| `director_reinstall` | `director_reinstall_response` | admin/destructive | Deletes and rebuilds `computer/`. Aborts running turns. Chats and prompt-guide work survive. |
| `director_rollback_message` | `director_rollback_message_response` | admin/destructive | Handler: handleDirectorRollbackMessage |
| `director_recycle_session` | `director_recycle_session_response` | admin/destructive | Wren only. Next turn starts a fresh Cursor chat with no transcript replay. Refused with `DIRECTOR_BUSY` while a turn runs or a resume is pending. |
| `director_save_feedback` | `director_save_feedback_response` | admin/destructive | Handler: handleDirectorSaveFeedback |
| `director_save_rules` | `director_save_rules_response` | admin/destructive | Handler: handleDirectorSaveRules |
| `director_send_message` | `director_send_message_response` | admin/destructive | Handler: handleDirectorSendMessage. `persona: "xi"` runs the host agent. |
| `director_streaming_ack` | — | session | Client ack of `director_streaming_update.data.seq`. The server holds the next snapshot until this ack or a deadline scaled from client RTT. |
| `ledge_checks` | — | session | `{ sessionId, checked: [itemId] }` from the Ledge desk. Server broadcasts `ledge_state`. |
| `director_tool_diff` | `director_tool_diff_response` | session | `{ sessionId, diffId, persona: "xi" }` → `{ text, name, detail }`. The live trace does not include that body. |
| `director_rentan_agent_get` | `director_rentan_agent_get_response` | session | Rentan's saved default engine and model: `{ default, fallback }`. `default` is `{ engine, model, effort, fast }` or null (then `fallback`, Cursor at medium, applies). See [Rentan engine and model](#rentan-engine-and-model). |
| `director_rentan_agent_set_default` | `director_rentan_agent_set_default_response` | admin/destructive | `{ agent: { engine, model, effort, fast } }` saves the default for every Rentan turn; `{ clear: true }` removes it. Broadcasts `director_rentan_agent_default_changed` with the same `data`. |

## Response envelope

Successful replies usually use:

```json
{
  "type": "<request_type>_response",
  "requestId": "<same as request>",
  "data": { "success": true, ... },
  "timestamp": "<ISO-8601>"
}
```

Errors use `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors).

## Read-only restrictions

Packets marked destructive in `modules/websocketHandlers.js` → `isDestructiveOperation()` return `READONLY_RESTRICTED` for `userType: "readonly"` sessions.

## The Director computer (`modules/cursorDirector.js`)

Every Director turn runs the Cursor CLI agent inside a **bubblewrap (`bwrap`) jail**. There is no host fallback: if `bwrap` is not installed the turn fails with `BWRAP_MISSING`. The jail unshares everything but the network (`--unshare-all --share-net`), clears the environment, and mounts only what is listed below. Host paths never appear inside; the agent sees `/home/director` (home), `/workspace` (project), `/opt/cursor-agent`, and the Playwright browsers.

Host layout under `~/.cache/dreamscape-director/`:

| Path | Kept? | Inside the jail |
|---|---|---|
| `computer/home`, `computer/workspace` | **disposable** — the machine the agent installs into | `/home/director`, `/workspace` (`/tmp` is `home/tmp`) |
| `chats/` | kept — per-chat `inbox/` and `browser/` captures | `/workspace/chats` (rw) |
| `prompt-guide-work/` | kept — writable clone of the prompt guide | `/workspace/knowledge/prompt-guide` (rw) |
| `vfs/` | kept — the user's FUSE mount point, bound when present | `/workspace/vfs` (rw) |
| `index.json`, `key` | kept — chat index and the Director MCP key | not mounted |
| `data/apocrypha`, images, previews, references, reference-previews | host data | `/workspace/knowledge/apocrypha`, `/workspace/images`, … (**read-only**) |

The only host config that enters the jail is the Cursor CLI credential (`~/.config/cursor`).

Maintenance is **user-only** and goes over these WS packets (the Director's tray / window menu). The agent has no MCP tool for any of them.

- **`director_cleanup`** — removes temp and caches inside `computer/` only: `tmp`, `.cache/{npm,pip,uv,yarn}`, `.npm/_cacache`, agent logs, `__pycache__` / `.pytest_cache` / `node_modules/.cache`, `*.tmp` / `*.part` / `*.crdownload` and the browser-profile junk. Installed tools, chats, knowledge mounts, `prompt-guide-work/`, and the vfs mount are untouched. Refused with `DIRECTOR_BUSY` while a turn is running. Reply: `{ freed, size }` (bytes).
- **`director_reinstall`** — deletes `computer/` and rebuilds it. Running turns are SIGTERMed first. `index.json`, `key`, `chats/`, and `prompt-guide-work/` survive; the Cursor-side chat state does not, so every chat is marked for transcript replay on its next turn. Reply: `{ removed, aborted, size, message }`.
- **`director_computer_size`** — `{ bytes, home, path, promptGuide }`, where `promptGuide` is `{ work, cloned, draft, pending }` (`draft` = `director-draft` head sha or null; `pending` = the last extract's `{ tree, files, extractedAt }` or null).

### `director_computer_status` — tray state and resources

Read-only, so it is **not** destructive: the tray icon and tray menu need it. Reply (and the same shape as the server push below):

```json
{
  "state": "idle | working | interrupted | failed | offline",
  "running": false,
  "sessionId": null,
  "sessionName": null,
  "computer": { "ready": true, "code": null, "error": null },
  "last": { "state": "idle", "sessionId": "<chat id>", "error": null, "at": "<ISO-8601>" },
  "sessions": [{ "id": "<chat id>", "name": "…", "created_at": "<ISO-8601>", "current": false }],
  "resources": { "live": true, "sampledAt": "<ISO-8601>", "cpu": 62.4, "rss": 734003200, "count": 5, "processes": [{ "pid": 1234, "name": "cursor-agent", "cpu": 48.1, "rss": 412876800 }] }
}
```

- `state` is `working` while a turn runs, `offline` when the computer is down (`computer.code` is `BWRAP_MISSING`, `CURSOR_MISSING`, `DIRECTOR_NOT_PREPARED`, `DIRECTOR_IDLE_SHUTDOWN`, or the last `prepareDirector` failure), then `interrupted` / `failed` from the last turn, else `idle`.
- After `director.idleShutdownMinutes` with no Director or Wren turn (default 15, `0` disables), the server stops the Director browser process and marks Dreamspace stopped. The next turn starts it again. Dreamscape itself is not restarted.
- At server start, before the computer check, the server runs `cursor-agent update` and `claude update` on the host (each capped at 3 minutes, in parallel), so Wren's jail binds the new builds. The boot log shows each CLI's old and new version. It is skipped while an Xi turn is live, and `director.autoUpdateClis: false` turns it off. A failed update only logs a warning.
- TokenRouter usage (`director_get_cursor_usage` with `engine: "tokenrouter"`): the account's remaining balance as one value, `balance` (number, USD) and `balanceText` (`"$12.34"`), which is TokenRouter's top-up balance plus unexpired vouchers from `GET /api/management/self/wallet`. That route needs the TokenRouter **Personal Management Key** of the same account, entered as the optional second key on the TokenRouter entry in Security Center > Service Keys (`secure.config.json` `tokenrouter.keys[].managementKey`, or `TOKENROUTER_MANAGEMENT_KEY`); the model API key is not accepted there. The badge uses the pair of the selected TokenRouter key. Cached for a minute, failures included (TokenRouter allows 10 calls a minute per key). `limited` is true at or below $0. `autoPercent` / `apiPercent` stay null; the badge shows the wallet mark and the dollar value.
- Claude usage (`director_get_cursor_usage` with `engine: "claude"`, Wren or Xi): the 5-hour and 7-day windows from the last Claude call. Real Wren and Xi turns update it, and `modules/claudeUsageProbe.js` sends a one-line Haiku ping (throwaway HOME, no tools, no MCP) when the figures are 6 hours old. It only pings while a logged-in client is connected or was in the last 4 hours; otherwise the next login triggers it. One ping at a time, and 30 minutes between failed attempts.
- `sessions` is the 3 most recent chats from `index.json`, newest first, with `current` set on the one a turn is running in.
- `resources` measures **the Director's computer, not the Dreamscape host**: the tracked `bwrap` child plus its descendants (`cursor-agent`, `node`, headless chrome), read from `/proc/<pid>/stat` and `/proc/<pid>/task/<pid>/children`. `cpu` is a percent of one core over a 150 ms `utime + stime` delta and `rss` is in bytes; both are the tree total, and `processes` is the top 6 by CPU. With no turn running this is the last live sample with `live: false`, or `null` when there has not been one.

### Server → client: `director_computer_status`

Broadcast with the same `data` shape (minus a fresh CPU sample — `resources` is whatever the last read produced) on **turn start, turn end, abort, and error**. There is no interval: the client also asks with the request packet above each time the tray menu opens.

### Engines (Wren)

`director_send_message` takes `engine`: `cursor` (default), `claude`, `tokenrouter`, or `custom:<id>`. Xi keeps its own runtime choice, picked once at session creation. New Xi drafts default to TokenRouter (`deepseek/deepseek-v4.1-flash`); existing sessions keep the runtime they were created with.

- **`claude`** runs the Claude Code CLI in the same jail, with the OAuth token file bound read-only.
- **`tokenrouter`** (#409) runs the same Claude Code CLI, pointed at a loopback bridge in Dreamscape (`modules/tokenRouterBridge.js`, `127.0.0.1`, random port, per-boot secret). The bridge turns the CLI's Anthropic Messages calls into OpenAI chat completions on TokenRouter (`https://api.tokenrouter.com/v1/chat/completions`, `TOKENROUTER_BASE_URL` overrides) and streams the answer back: text, thinking (`reasoning_content`), and tool calls. Tool images go to the model as a user image message after the tool results. The TokenRouter key never enters the jail; it is the `tokenrouter` service in Security Center > API keys (`secure.config.json` `tokenrouter.keys[]`), with `TOKENROUTER_API_KEY` as the fallback. A turn without a key fails with `TOKENROUTER_KEY_MISSING`.
  - Catalog: TokenRouter's public `/api/pricing`, chat models with the `openai` endpoint type only, saved to `~/.cache/dreamscape-director/tokenrouter-models.json` for when the gateway is down. Prices are new-api ratios (ratio 1 = $2 per million input tokens). The default model is `deepseek/deepseek-v4.1-flash`.
  - `effort` (`low`, `medium`, `high`) becomes `reasoning_effort`. `fast` picks the family's fast sibling (`-fast`, `-highspeed`, `-ultraspeed`) and is offered only where one exists. When a model refuses `reasoning_effort`, `reasoning_content`, images, or `max_tokens`, the bridge sends the request again without that field and remembers it for that model until the server restarts.
- **`custom:<id>`** is another OpenAI-compatible host on that same bridge. The public row lives in `config.json` `customModelProviders[]` (`id`, `name`, `baseUrl`, optional `defaultModel`, optional `monitorUsage`). The bearer token lives in `secure.config.json` `customModelProviders.keys[]`, and the key's `name` is the provider id. A TokenRouter URL may also store `managementKey` on that same key entry. `baseUrl` is `https` only. Dreamscape reads the host from the URL: `api.tokenrouter.com` uses TokenRouter's `/api/pricing` catalog, the request gate, and the management-key wallet; `api.openai.com` and `generativelanguage.googleapis.com` (Gemini's OpenAI path, `{baseUrl}/chat/completions`) are detected the same way; `openrouter.ai` reads `GET {baseUrl}/v1/credits`. Every other host uses `GET {baseUrl}/v1/models` (id and name only; a `_provider` object on that payload is dropped) and `{baseUrl}/v1/chat/completions`. The CLI still speaks Anthropic Messages to the loopback bridge, which posts that chat URL with the header `x-dreamscape-provider`. A missing key fails with `CUSTOM_PROVIDER_KEY_MISSING`. Hosts other than a TokenRouter URL skip the TokenRouter rate gate. `monitorUsage: false` (the default when the field is missing) means the host has no usage cap: `director_get_cursor_usage` returns `hidden: true` and the badge stays hidden. A PNG logo saved from Control Panel → Dreamscape CardSpace replaces the mark (`data/provider-logos/<id>.png`); Google and OpenAI use their own marks when no picture is uploaded. Rentan runs them as an agent turn, the same way it runs Claude. Control Panel → Dreamscape CardSpace has a Custom Model Providers (Director) section: a preset fills Google, OpenAI, TokenRouter, or OpenRouter, then the URL, key, management key, picture, Monitor Usage, default model, Obliterated Memories, and the age tool. Obliterated Memories is per engine: on uses the shared `knowledge_memory_obliterated.db`, off keeps Studio knowledge memories. The age tool off hides `lookup_character_age` from that engine. The Memories applet store switch shows the same database.
- **Supported hosts.** The CardSpace preset list comes from `presets` on `director_custom_providers_response`: Google, OpenAI, TokenRouter, OpenRouter, NVIDIA NIM, DeepSeek, and DeepInfra. A preset fills the id, name, URL, and the model where the host has a default. The key field shows only whether a key is saved (Set / Not set). Besides the hosts above, `integrate.api.nvidia.com` is read as `nvidia` (NVIDIA NIM, build.nvidia.com: `{baseUrl}/v1/models`, `{baseUrl}/v1/chat/completions`) `api.deepseek.com` as `deepseek` (`{baseUrl}/models`, `{baseUrl}/chat/completions`), and `api.deepinfra.com` as `deepinfra` (base URL `https://api.deepinfra.com/v1/openai`, kept as is: `{baseUrl}/models`, `{baseUrl}/chat/completions`). DeepInfra's model list also carries embedding, image, speech, and video models; only the ones with `metadata.pricing.output_tokens` (chat models) are listed, with `input` / `output` in USD per million tokens. A trailing `/v1` on a saved URL is dropped, so `https://integrate.api.nvidia.com/v1` is stored as `https://integrate.api.nvidia.com`. When a row has no `defaultModel`, the host's preset default applies: `deepseek-ai/deepseek-v4.1-flash` on NVIDIA, `deepseek-ai/DeepSeek-V4.1-Flash` on DeepInfra, `deepseek/deepseek-v4.1-flash` on a TokenRouter URL, else the first listed model. `baseUrl` must be a public host: loopback, private, link-local and CGNAT IP literals, `localhost`, single-label names, and `.local` / `.internal` / `.lan` / `.home` / `.arpa` names are refused (saved as no URL). NVIDIA and DeepInfra are opt-in: nothing is added until it is saved in CardSpace. The Director's defaults do not change: the TokenRouter engine with `deepseek/deepseek-v4.1-flash`.
- **402 and 429 from a custom host.** A host outside the TokenRouter gate that answers 429 is tried again up to three times on the bridge: after `Retry-After` when sent, else after 2 s, 4 s, then 8 s (each wait capped at 30 s, and all waits together at 30 s; a wait that would pass that hands the 429 back at once). The engine reply then says `<name> 429: rate limit reached and still limited after waiting. Wait a minute, then send again. (<host message>)`. A 402 is not retried: `<name> 402: insufficient balance. Top up the <name> account, then send again. (<host message>)`, sent to the CLI as 403 so it does not retry either. TokenRouter keeps its own gate and the same message wording.
- Switching engines inside a chat starts a new engine-side session with the kept transcript (handoff). Claude and TokenRouter sessions are separate even though both run the Claude CLI.

### Provider balances

`director_custom_providers_balance` reads each host that has a balance. Each read is cached for 3 minutes per provider, failures included, with one read in flight at a time; TokenRouter's own wallet is cached for a minute. Turns never wait on a balance, and a balance read never holds a turn.

| Host | Source | What shows |
|---|---|---|
| TokenRouter (engine and TokenRouter URLs) | `GET /api/management/self/wallet` with the management key | Top-up plus vouchers, USD. No management key: `state: "error"` and a title saying to add one. |
| OpenRouter | `GET {baseUrl}/v1/credits` | `total_credits - total_usage`, USD. |
| DeepSeek | `GET {baseUrl}/user/balance` | `balance_infos[]`, USD first, else the first currency listed (`balanceText` is `¥8.80` for CNY). `granted` and `toppedUp` carry `granted_balance` and `topped_up_balance`; `is_available: false` is `state: "out"`. |
| NVIDIA NIM | none: the API has no credits endpoint | `state: "free"`, `freeTier: true`, `balanceText: "Free tier"`, title `<name>: free tier, rate-limited`. When a chat response carried `x-ratelimit-limit-requests` / `x-ratelimit-remaining-requests` (or bare `x-ratelimit-*`), `rateLimit` is `{ limit, remaining, resetMs }` from the last one, and the title adds `N of M requests left`. No number is made up when the headers are absent. NVIDIA's `/v1/models` answers without a key, so the key status (wallet tray, CardSpace dot) is `warn` with `Host reachable; key unverified until the first chat succeeds` until a chat on that key returns 2xx (`ok`) or 401/403 (`fail`). A new key starts unverified again. |
| DeepInfra | `GET https://api.deepinfra.com/payment/checklist` and `GET https://api.deepinfra.com/payment/usage?from=current` (both on the API origin, not the `/v1/openai` base) | `balance` is `-(stripe_balance + max(recent, 0))` in USD, the DeepInfra console formula (`stripe_balance`: negative is prepaid funds ready to spend, positive is money owed; `recent` is spend not yet invoiced). `recent` is spend since the last invoice, `limit` the account spending limit (null when none), `monthSpend` the current month's `total_cost` (cents) in USD; the title lists each one that came back. Owed money shows as `$2.00 owed`: `state: "ok"` when a payment method is on file (DeepInfra bills the card), else `out`. `suspended: true` is `state: "out"`, and the title names `suspend_reason`. A failed usage read only drops the month line; a failed checklist read (for example 403, a key without billing access) is `state: "error"` with no number. DeepInfra documents `total_cost` as cents but gives no unit for `stripe_balance` and `recent`; they are read as whole USD, the same way DeepInfra's console and other billing clients read them, through one constant (`DEEPINFRA_CHECKLIST_UNITS_PER_USD = 1` in `modules/customModelProviders.js`). A `limit` of 0 or less is no limit. |
| MiniMax, OpenAI, Google, other hosts | none | `state: "none"`, `balanceText: ""`. |

`state` is `ok`, `low` (at or under 1), `out` (at or under 0, or the host says it cannot be used), `free`, `error` (the read failed; `title` says why), `none`, or `nokey`. `title` is the tooltip text, one fact per line. Keys and URLs are never in a row. The Director's Engine and runtime pickers show `balanceText` beside each engine. CardSpace shows the key as Set or Not set, the balance line, and a status dot (`sec-key-dot`). The wallet tray's custom rows and the usage badge (`director_get_cursor_usage`, `monitorUsage` on) use the same reads.

### Rentan engine and model

Rentan (dynamic generation, `modules/dynagenWren.js`) resolves the scene before every print: Studio, MCP `generate_image` / `generate_preset` / `print_studio` / `apply_studio_changes` `autoGenerate`, and the Director's own prints (#422). Agents do not bake it; they may adjust a resolved scene by sending edited `dg_` expanders with `integrated: true`. The engine and model come from, in order:

1. `dynamic_generation.agent` on the generate request: `{ engine, model, effort, fast }` from the Rentan system menu (Studio `#dynamicCarousel` right-click, **Wren** block). It is saved with the preset and the print like the other Rentan settings.
2. The default saved with **Save as Default** in that menu (`director_rentan_agent_set_default`), stored in `~/.cache/dreamscape-director/rentan-agent.json` (kept across Reinstall).
3. The built-in default (`fallback` on `director_rentan_agent_get`): TokenRouter, `deepseek/deepseek-v4.1-flash`, effort `low`; Cursor at medium when there is no TokenRouter key.

Engines:

- **TokenRouter** resolves on the server (`modules/rentanResolver.js`): one chat-completions call on the `normal` lane of the request gate (#418), with the same scene rules, job lines, and checks as the agent's `deliver_rentan`, and one corrected retry. It has no image review. A failure falls back to the last scene when there is one. The compiled prompt records `resolved_by: { engine, model }` and has no `wren_session_id`. A TokenRouter pick with no key resolves on Cursor instead.
- **Cursor / Claude** run the hidden per-workspace Wren chat as before, including the image review for human Studio prints. They cost subscription usage, not TokenRouter balance. A change of engine, or a heavy chat, starts a fresh engine-side session and sends Rentan's rules again. Only Cursor turns fall back to Auto on a usage limit.

**Reduced Prompt Context** (#432, `dynamic_generation.reduced_context`: `indoor` | `outdoor`): the job carries the context and `Setting: indoor|outdoor` but no prompt, UC, characters, or current expanders, on every engine. Only the returned `dg_` expanders land (`cursorDirector.additionsOnly`); missing `!dg_` tokens are appended to the prompt. The setting is part of `compiled_prompt.controls`, so switching it resolves again.

### Server → client: `director_session_tasks`

Broadcast when the agent changes the chat's task list with `set_session_tasks`, `set_session_task`, or `close_session_tasks` (see [../agent-session.md](../agent-session.md)). The list is stored on the chat in `index.json`, so it survives a reopen and also rides along on `director_get_sessions`, `director_get_session`, `director_open_workspace`, and `director_get_messages` as `tasks`.

```json
{ "type": "director_session_tasks", "data": { "sessionId": "<chat id>", "tasks": [{ "id": "a", "title": "rewrite the prompt", "done": true }] }, "timestamp": "<ISO-8601>" }
```

### Server → client: `director_session_renamed`

Broadcast when the agent names the chat with `set_session_title`.

```json
{ "type": "director_session_renamed", "data": { "sessionId": "<chat id>", "name": "Convert the Rapi set to V5" }, "timestamp": "<ISO-8601>" }
```

### Prompt guide draft flow

`prompt-guide-work/` is seeded from the Docubase clone once (only while empty, so uncommitted edits are never reset). Changes are landed on a `director-draft` branch **without checking that branch out** — objects and a side index live in Docubase's `.git`, so the served Docubase working tree is never touched.

1. `director_prompt_guide_diff` → `{ base, baseSha, diff, truncated, files, empty }` — the work clone against `origin/main` (new files included via intent-to-add; `diff` is cut at 400k chars).
2. `director_prompt_guide_extract` → `{ tree, parent, branch, files, extractedAt, changed, message }` — writes the work tree as a git tree object and records it as pending. `changed: false` means `director-draft` already matches.
3. `director_prompt_guide_commit` `{ message }` → `{ commit, sha, branch, files, commitMessage, message }` — `commit-tree` of the pending tree onto `director-draft` (author `Dreamscape Director`). Errors: missing `message`, no pending extract, or the draft already matches the extracted tree.
4. `director_prompt_guide_push` → `{ branch, commit, output, message }` — pushes `refs/heads/director-draft` to origin, adding the prompt-guide token (`YOZORA_TOKEN` / `NAI_PROMPT_GUIDE_TOKEN` env or the token file) as an `Authorization` header when one is configured. Output is redacted and cut at 2000 chars. Errors when there is no `director-draft` branch.

### Server → client: `director_browser_preview`

Broadcast to **every** connected client (falls back to the requesting socket when no WS server) whenever the agent saves a new `.png` / `.webp` into `chats/<id>/browser/` during a turn (an `fs.watch` on that folder; a watcher failure never touches the turn).

```json
{ "type": "director_browser_preview", "data": { "chatId": "<chat id>", "filename": "shot-1.png" }, "timestamp": "<ISO-8601>" }
```

The client (`public/scripts/comp/director.js` `showBrowserPreview`) only acts when `#directorWindow` is open with the Director docked in it and `chatId` is the current session; it then shows that capture in the window's browser pane (`data.url` if present, otherwise `GET /director/browser/<chatId>/<filename>`). That route is authenticated, allows one path segment for each of `chatId` and `filename`, and serves only png, webp, jpg, or jpeg from `chats/<chatId>/browser/` under the Director home. Other clients and sessions ignore the broadcast.

### Client chrome

Desktop only: `#directorWindow` (the Director chat undocked from the Studio panel; close hides the window while the agent keeps running) and the `#directorTrayIcon` tray icon, which stays hidden until the window has been opened once, a turn starts, or `director_computer_status` reports `working` / `interrupted` / `failed` (`offline` stays hidden — hosts without bubblewrap never use it). Left-click / double-click opens the window. MCP `open_application` `{ "launchId": "director" }` opens the same window; `offer_director_window` only queues the `director_long_job_notice` toast (see [../agent-session.md](../agent-session.md)).

The icon takes the `state` from `director_computer_status` as a class (`working`, `interrupted`, `failed`, `offline`; idle keeps the default tray colour) on the same `.taskbar-tray-icon` / glyph pair as `.runpod-tray-icon`, and the `title` reads `Director — <state in words>` plus the running chat name, the computer error, or the last turn's error. The tray context menu is the state line, Open, "Open current session" while a turn runs, the 3 most recent chats (clicking one opens it in `#directorWindow`, the current one is checked), a **Resources** row showing `<cpu>% CPU · <rss>` with the per-process breakdown in its submenu, and the Cleanup / Reinstall / Prompt guide items above.

The chat's task list renders in `#directorTaskList`, above the messages inside `#directorSessionChat` — one block that serves both the Studio panel and `#directorWindow` because it is the same chat. It is hidden while the list is empty.

## Detailed packets

### `director_create_session`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorCreateSession`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `sessionType` | Optional Wren chat type: `utility` (archive 7 days after last activity), `lowvolume` (15 days, the default for a new chat), or `normal` (30 days). A chat with no stored type is `normal`. `lowvolume` becomes `normal` at 5 user messages. MCP `set_session_type` changes it. The Expand Canvas Director toggle creates `utility`. Sessions echo `sessionType` and `expires_at` |

**Success response:** `director_create_session_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_delete_feedback`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorDeleteFeedback`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_delete_feedback_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_delete_session`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorDeleteSession`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_delete_session_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_get_messages`

**Auth:** Session required

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorGetMessages`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_get_messages_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_get_session`

**Auth:** Session required

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorGetSession`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_get_session_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_get_sessions`

**Auth:** Session required

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorGetSessions`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_get_sessions_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_load_feedback`

**Auth:** Session required

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorLoadFeedback`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_load_feedback_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_load_rules`

**Auth:** Session required

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorLoadRules`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_load_rules_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_rollback_message`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorRollbackMessage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_rollback_message_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_save_feedback`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorSaveFeedback`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_save_feedback_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_save_rules`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorSaveRules`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `director_save_rules_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_send_message`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorSendMessage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `engine` | Optional. `cursor` (default), `claude`, or `tokenrouter`. See [Engines (Wren)](#engines-wren) |
| `effort` | `low`, `medium`, `high`, or `xhigh` (TokenRouter: `low`, `medium`, `high`) |
| `fast` | Optional. When true and the model has a fast variant, the turn uses it |
| `model` | Model family id from `director_get_models` for that engine, such as `grok-4.7` or `moonshotai/kimi-k3` |

**Success response:** `director_send_message_response`

### `director_abort`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js → `handleDirectorAbort`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `sessionId` | Chat to stop |
| `steer` | Optional. When true, the follow-up is sent without marking the turn stopped |

**Success response:** `director_abort_response` with `aborted` true when a running turn was stopped, including when the agent process had not spawned yet, or when a pending resume (usage-limit wait) was cancelled. Deleting a session that is still running uses the same hard stop, then removes the chat.

**Errors:** `type: "error"` via `sendError()` - see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `director_recycle_session`

**Auth:** Session required. Admin only (destructive - blocked for readonly)

**Handler:** modules/ws/handlers/40-directorHandler.js -> `handleDirectorRecycleSession`

**Request fields:**

| Field | Notes |
|---|---|
| `sessionId` | Wren chat to recycle |
| `filename` | Optional. A print already in the session strip; it becomes the session image |
| `requestId` | Optional |

**Success response:** `director_recycle_session_response` with `sessionId` and `filename` (the session image the fresh chat starts from).

The visible history, session image, and task list stay. The next turn opens a new Cursor chat and is prompted like the first turn of a new session.

Visible Director chats never recycle on their own; only this request does it. The hidden per-workspace Rentan chat rotates by itself (40 turns or 70% context).

**Errors:** `DIRECTOR_BUSY`, `SESSION_NOT_FOUND`, or `type: "error"` via `sendError()`.

## Xi

Xi is the host agent, and only from the desktop Director window. The Studio panel is Wren. Opening either one starts on Wren. `persona: "xi"` on the session packets (`director_get_sessions`, `director_create_session`, `director_open_workspace`, `director_get_messages`, `director_send_message`, `director_abort`, `director_delete_session`, `director_rollback_message`, `director_tool_diff`) selects Xi after that. Omit it, or send `wren`, for Dreamspace.

Xi is off unless `config.json` has `xi.enabled: true`. `xi.workspace` empty means this repo. The session list and computer status include `xiEnabled`. Status also includes `xi.running` and `xi.sessionId`.

The turn is a detached `agent` process launched through a short-lived `sh` + `setsid`, so it is not a descendant of the server and PM2 `treekill` does not kill it on restart. A server restart reattaches by tailing the log. A client reload uses the same chat.

Xi reaches Dreamscape MCP through the repo `.cursor/mcp.json` `dreamscape` entry, which reads `${env:DREAMSCAPE_MCP_URL}` and `${env:DREAMSCAPE_MCP_KEY}`. `xiEnv` sets both from a Xi application key stored at `~/.cache/dreamscape-xi/key` (never in git). Other Cursor sessions in this repo see that server as unconfigured. Xi asks questions with `request_form` (`chatId` routes it into the Xi chat). The headless CLI skips `AskQuestion`. Cursor drops an MCP call after about 60s, so one `request_form` call waits at most 45s and then returns `pending: true` with `formId`. Calling `request_form { formId }` keeps waiting on the same open form. An answer that arrives between calls is kept for the next call. The form stays open up to 30 minutes.

`director_streaming_update` rows for an edit, or any tool body over 500 characters, set `hasDiff` and `diffId` and omit `args` / `result`. `director_tool_diff` returns that text for the Diff / Output button.

