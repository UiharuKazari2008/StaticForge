# WebSocket: Director (AI learning)

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
| `director_get_models` | `director_get_models_response` | session | Live Cursor model list, grouped by family. `models[]` has `id`, `name`, `short` (single-line picker label, empty when `name` already fits), `fast`, and `efforts`. |
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

- `state` is `working` while a turn runs, `offline` when the computer is down (`computer.code` is `BWRAP_MISSING`, `CURSOR_MISSING`, `DIRECTOR_NOT_PREPARED`, or the last `prepareDirector` failure), then `interrupted` / `failed` from the last turn, else `idle`.
- `sessions` is the 3 most recent chats from `index.json`, newest first, with `current` set on the one a turn is running in.
- `resources` measures **the Director's computer, not the Dreamscape host**: the tracked `bwrap` child plus its descendants (`cursor-agent`, `node`, headless chrome), read from `/proc/<pid>/stat` and `/proc/<pid>/task/<pid>/children`. `cpu` is a percent of one core over a 150 ms `utime + stime` delta and `rss` is in bytes; both are the tree total, and `processes` is the top 6 by CPU. With no turn running this is the last live sample with `live: false`, or `null` when there has not been one.

### Server → client: `director_computer_status`

Broadcast with the same `data` shape (minus a fresh CPU sample — `resources` is whatever the last read produced) on **turn start, turn end, abort, and error**. There is no interval: the client also asks with the request packet above each time the tray menu opens.

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
| `effort` | `low`, `medium`, `high`, or `xhigh` |
| `fast` | Optional. When true and the model is Grok 4.7, the turn uses the fast parameter |
| `model` | Model family id from `director_get_models`, such as `grok-4.7` |

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

