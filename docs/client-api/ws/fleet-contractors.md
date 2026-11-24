# WebSocket: Fleet Contractors

Server: `modules/fleetContractors.js` (store, contractor socket, relay), `modules/ws/handlers/317-fleetContractorsHandler.js`
(admin packet). Agent: `scripts/contractor/agent.js`; installers `scripts/contractor/install.sh` (Linux) and
`scripts/contractor/install.ps1` (Windows). Test: `node scripts/test-fleet-contractors.js`. Yozora #1154.

A **Contractor** is another machine (Linux or Windows) that runs Claude Code work for Fleet on its own projects. It
runs a small headless agent that connects **out** to this server (no inbound port on the contractor), reports its
sessions and takes commands. Fleet shows each one as a top-level **Contractor** node in its sidebar, with its
sessions under it.

See [WebSocket protocol](../websocket.md) for the admin envelope format, auth and errors.

## Admin packet (Fleet)

One request type, by `action`; admin (`admin` / `dev_admin`) only, otherwise `INSUFFICIENT_PERMISSIONS`. The
answer is `claude_fleet_contractors_response` with `data: { success: true, action, ... }`; a failure is the usual
error envelope with code `FLEET_CONTRACTORS_FAILED` and the reason in `error`.

| `action` | Fields | `data` |
|----------|--------|--------|
| `list` | | `{ contractors: [Contractor], invites: [Invite] }` |
| `invite` | `name`, `serverUrl?` (the page's origin) | `{ invite: { id, name, code, createdAt, expiresAt }, install: { linux, windows, note } }` |
| `revoke` | `id` (`ctr_...` or an open invite's `inv_...`) | `{ revoked }` / `{ invite }` |
| `remove` | `id` | `{ removed }` (revokes first) |
| `installer` | `os: 'linux' \| 'windows'`, `serverUrl?` | `{ filename, text }`: the installer with the agent inside, to save and copy over |
| `sessions` | `id` | `{ id, live: [Session], recent: [Session] }` (recent = the newest 20 ended transcripts in the project folders) |
| `transcript` | `id, sessionId, before?, limit?, show?, item?` | `claudeTranscript.readPage`'s shape `{ messages, start, end, more }` (or `{ item }`), masked, same `show` view as `claude_desk_transcript` |
| `start` | `id, cwd, prompt, title, model?, effort?, mode?` | `{ id, sessionId, link, state }` (`link` = claude.ai/code page when Remote Control is on, Linux) |
| `steer` | `id, sessionId, text` | `{ id, sent: true }` |
| `interrupt` | `id, sessionId` | `{ id, interrupted: true }` |
| `stop` | `id, sessionId` | `{ id, stopped: true }` |

A request to a contractor that is not connected fails at once (`That contractor is not connected`); one that gets
no answer fails after 30 s (`start`: 120 s).

**Contractor**: `{ id, name, online, revoked, createdAt, revokedAt, connectedAt, lastSeenAt, address, hello, sessions }`
where `hello` is the last hello (kept across restarts) `{ agentVersion, name, hostname, os ('linux' | 'win32' | 'darwin'),
osRelease, arch, node, claudeVersion, runner ('tmux' | 'pipe'), accounts: [{ email, organization, displayName, plan }],
projects: [{ path, name }] }` and `sessions` the live sessions while online (`[]` otherwise).

**Session**: `{ id, title, cwd, status ('busy' | 'idle' | ... | 'ended'), live, managed (started by the agent: may be
steered), runner, link, pid, mode, model, startedAt, updatedAt }`.

**Invite**: `{ id, name, createdAt, expiresAt }` (the code is only ever in the `invite` answer).

### Push

`claude_fleet_contractors_status` to admin sockets, only on a change, 250 ms debounce per contractor:

- `{ reason, reasons, contractor: Contractor }`: `reason` is the last of `reasons` (`paired`, `connected`, `hello`,
  `sessions`, `disconnected`, `revoked`); merge by `contractor.id`. `{ reason: 'removed', contractor: { id, removed: true } }`
  drops one.
- `{ reason: 'invites', invites: [Invite] }` when an invite is made, used, cancelled.

The Fleet UI: a `Contractors` top-level node (or one top-level node per contractor, as Yukimi asked: "Contractor" items),
each with its sessions (`contractor.sessions`, live; `sessions` action for ended ones); online state from `online`.
Read `list` when Fleet opens, then apply pushes; no polling.

## Contractor protocol

`GET /fleet/contractor` with `Upgrade: websocket` and `X-Dreamscape-Client: fleet-contractor/<version>`. No query
string. JSON text frames.

| Direction | Frame | |
|-----------|-------|---|
| agent -> server | `{ type: 'pair', code, agentVersion }` | first frame only: redeems a pairing code |
| server -> agent | `{ type: 'paired', id, name, secret, pingMs }` | the credential, once; the socket is then authenticated |
| agent -> server | `{ type: 'auth', id, secret, agentVersion }` | first frame only |
| server -> agent | `{ type: 'welcome', id, name, pingMs }` | |
| agent -> server | `{ type: 'hello', agentVersion, name, hostname, os, osRelease, arch, node, claudeVersion, runner, accounts, projects, sessions }` | after welcome / paired |
| agent -> server | `{ type: 'sessions', sessions }` | the live list, when it changed |
| server -> agent | `{ type: 'request', id, action, args }` | `action`: `list_sessions`, `transcript`, `start`, `steer`, `interrupt`, `stop` |
| agent -> server | `{ type: 'response', id, ok, data \| error }` | |

Close codes: `4401` unauthorised (bad / used / expired code, unknown or revoked credential, any other first frame, a
first frame over 4 KB, no first frame within 10 s), `4403` revoked while connected (the agent exits and does not come
back), `4409` replaced by a newer connection of the same contractor.

Liveness: the server sends a WebSocket ping every 45 s (under the 737.jp.net proxy's 60 s idle cut) from one timer
that runs only while a contractor is connected, and drops a contractor that missed the last pong. The agent never asks
the server anything on a timer: it reconnects (1 s doubling to 5 min, plus jitter; 15-30 min after a refused
credential) when the socket closes or has been silent for 130 s.

## Security model

- **Pairing code**: 12 Crockford base32 characters (60 bits) shown as `XXXX-XXXX-XXXX`, 15 minutes, single use, only
  its SHA-256 stored. Typed case-insensitively; `O`/`I`/`L` read as `0`/`1`. Asked for at the installer's prompt or
  read from `FLEET_PAIR_CODE`; never a command-line argument; children never inherit it.
- **Credential**: `ctr_<16 hex>` + a 256-bit random secret, returned once in `paired`, stored by the agent in
  `credential.json` (0600; on Windows the folder's ACL is the user and SYSTEM only). The server stores only its
  SHA-256 and compares in constant time. It is no admin key and opens nothing but this socket. It travels only in the
  first frame; never in a URL, header, log line or process argument.
- **The door**: the path is a deliberate, narrow exception in front of the site gate (`fleetContractors.attach`
  wraps the HTTP server's upgrade listeners at boot, after siteGate / Guacamole / Alchemy's viewer). Without the knock,
  with a query string, a non-GET, while there is neither an active contractor nor an open invite, or after 10
  failures from one address in an hour, it answers the cover's 404 page. Plain HTTP on the path is the cover as before.
  The main app socket's session / gate checks are untouched; nothing else is reachable through this path.
- **Revocation** marks the row and closes the live socket (4403); a revoked credential is refused from then on.
- **On the contractor** every command stays inside the configured project folders (`config.json` `projects`, real
  paths): `start` only with a `cwd` inside one; `transcript` / `steer` / `interrupt` / `stop` only for a session whose
  live record or transcript `cwd` is inside one; sessions elsewhere are not even reported. Steering, interrupting and
  stopping only reach sessions the agent started (tmux `fc-<id8>` / its own child processes). Transcripts are masked
  (claudeTranscript's token masks) on the contractor before they leave it. The machine's own Claude login never leaves
  it; only the account's email / organisation / plan from `~/.claude.json` are reported. API-key variables are
  stripped from the sessions' environment.

## Running sessions on a contractor

- **tmux runner** (Linux, macOS; where tmux exists): `claude --session-id <new uuid> --remote-control <title>
  --permission-mode <mode> [--model] [--effort] [prompt]` in tmux session `fc-<id8>` on socket `fleet-contractor`, in
  the project folder. The claude.ai/code link is read from the live record or the pane (`link`). Steer = typed text +
  Enter, interrupt = Esc, stop = kill the tmux session. Sessions survive an agent restart.
- **pipe runner** (Windows; or `FLEET_CONTRACTOR_RUNNER=pipe`): `claude -p --input-format stream-json
  --output-format stream-json --verbose --session-id <uuid> --permission-mode <mode>` as a hidden child process whose
  stdin the agent keeps. The prompt and each steer are `{"type":"user","message":{"role":"user","content":[{"type":"text","text":...}]}}`
  lines; interrupt is `{"type":"control_request","request_id":...,"request":{"subtype":"interrupt"}}`; stop closes
  stdin (then kills). Status follows stdout (`assistant` = busy, `result` = idle). No Remote Control link (print mode
  has none). These sessions end with the agent (its stdin goes); the transcript stays and shows under `recent`.

## Work queue hook

`require('modules/fleetContractors').startOn(contractorId, { cwd, prompt, title, model?, effort?, mode?, remoteControl? })`
resolves `{ sessionId, link, state }` (agentSupervisor can run a queue item on a contractor with it). `sessions`,
`transcript`, `steer`, `interrupt`, `stop`, `isOnline`, `list`, `onStatus(fn)` are exported too.

## Install

1. Fleet: Contractors > Invite (name) shows the code (15 minutes) and the install line; Get installer saves
   `fleet-contractor-install.sh` / `.ps1` (`installer` action: the generic installer with the agent and
   `claudeTranscript.js` inside, the server URL filled in). Copy it to the machine.
2. Linux (needs Node >= 20, the `claude` CLI logged in, tmux):
   `sh fleet-contractor-install.sh --server https://<server> --name "<name>" --project ~/src/app [--project ...]`
   installs to `~/.local/share/fleet-contractor`, pairs (asks for the code), writes `~/.config/fleet-contractor/`
   `config.json` + `credential.json` (0600) and a `fleet-contractor.service` systemd --user unit (enabled, started,
   `loginctl enable-linger` tried). `--dry-run --prefix <dir>` checks and writes only the files under the prefix;
   `--no-service`; `--uninstall` removes the unit, the agent and the credential.
3. Windows (Node >= 20, `claude.exe` logged in): `powershell -ExecutionPolicy Bypass -File fleet-contractor-install.ps1
   -Server https://<server> -Name "<name>" -Project C:\src\app` installs to `%LOCALAPPDATA%\FleetContractor` (config
   and credential there too, owner-only ACL), pairs, and registers the scheduled task "Fleet Contractor" (at logon,
   hidden through `conhost --headless`, restarted on failure, log `agent.log`). `-DryRun`, `-NoTask`, `-Uninstall`.
4. Project folders later: `node <install dir>/agent.js projects --add <folder>` (or `--remove`), then restart the
   service / task.
