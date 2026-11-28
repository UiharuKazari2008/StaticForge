# Fleet MCP identity (#1199)

The Remote Access notice (desktop tray and phone) says `Your session was accessed by "<actorName>"`. `actorName` used to be the
application key's name, and every Claude session, Yukimi's own and each Fleet one, used the one key "Claude Code", so the notice could not
tell them apart. Fleet sessions now have MCP keys of their own and a header that names the session; the server turns both into a label.

Code: `modules/fleetMcpIdentity.js`. Test: `node scripts/test-fleet-mcp-identity.js`.

## The two keys

| Key (app name) | Used by |
|---|---|
| `Fleet` | a Claude session started in Fleet |
| `Fleet work items` | a Claude session working a Supervisor work item |

- Minted by `ensureFleetKey(gr, kind)` (`kind` is `fleet` or `item`) when Fleet launches a session. The model is `ensureAppKey` in
  `modules/cursorDirector.js`: it validates the key in the file, refreshes it when a refresh is due, mints one otherwise, heals missing
  scopes onto the same row (the secret stays), and retires older active keys of the same name and user agent (`DreamscapeFleet/1.0`).
  One in-process promise per kind, so two sessions launched together never mint two keys. It answers `{ kind, label, keyFile }`, never the
  key. The startup scope migrations (`widenDirectorApplicationKeys`) do not touch these keys.
- User agent of the key: `DreamscapeFleet/1.0`. Claude Code connects with `claude-code/2.x (sdk-cli)`; the MCP auth middleware accepts
  an application key whose user agent differs (`unknownUserAgentBypass`), so the key authenticates as it does for the "Claude Code" key.
- Scopes: `FLEET_MCP_SCOPES` in `modules/directorAppKeyScopes.js` = the Wren / Xi tool scopes without `sfapp_dovecote`. Never `universal`;
  no Plaud, Claude fleet, mail exchange, Messaging Bridge or Alchemy browser scope. `FLEET_KEY_TARGETS` lists the two labels.
- Key files (paths only; mode 0600, directory 0700; the state directory is `$DREAMSCAPE_CLAUDE_DESK_STATE` or
  `~/.local/state/dreamscape-agents`):
  - `<state>/fleet-mcp/fleet.key`
  - `<state>/fleet-mcp/fleet-items.key`

## The session's MCP config (`modules/claudeSessionLauncher.js`)

- A Fleet launch on the Dreamscape host writes `<state>/fleet-mcp-sessions/<session id>.json` (0600, directory 0700) and passes it as
  `--mcp-config` (never `--strict-mcp-config`, so the other user / project servers stay). It holds one server, `dreamscape`
  (`type: http`, `url` = `mcpUrl(gr)`, the server's loopback MCP address), plus `agent-coord` only when that is not registered at user
  scope. A `--mcp-config` server overrides the project-scope `dreamscape` entry of the same name that every account's `.claude.json`
  carries (the "Claude Code" key), checked on Claude Code 2.1.332 (init lists it with source `dynamic`).
- No key is in that file, the arguments or the environment: the entry has `headersHelper` =
  `node scripts/fleet-mcp-headers.js <key file> <session id>`, which Claude Code runs when it connects; it prints the two headers below
  from the 0600 key file (nothing on stdout and exit 1 on any error, never the key on stderr).
- Kind: `sessionKind(id, workId)`: `item` when the Supervisor starts it for a work item (`workId`) or a `supervisor_work` row names the
  session, else `fleet`.
- Which launches: `start()` (every new Fleet session, work item or not); `resume()` only of a session Fleet started (its file exists, or
  it is an item session); `takeover()` of a claude.ai Remote Control session never (Yukimi's session keeps "Claude Code").
- When the key or the MCP address is not available the launch goes on the old way (one `console.warn`), never a failed start.
- Sessions on Fat Misaka (`modules/misakaSessions.js`) get no Dreamscape MCP at all (they work on their replica), unchanged.
- Test: `node scripts/test-fleet-session-mcp.js`.

## The header

A Fleet session's MCP config sends `Authorization: Bearer <Fleet key>` and `X-Fleet-Session: <claude session uuid>`
(`modules/claudeSessionLauncher.js` writes the config; `FLEET_SESSION_HEADER` is `x-fleet-session`). The header counts only on one of the
two Fleet keys and only as a lowercase UUID. On any other key it is ignored. It is a display aid, not a credential.

## Labels

`actorLabel(req)` (`resolveActorLabel` in `modules/agentClientBridge.js`):

| Request | Label |
|---|---|
| `Fleet` key + valid header | `Fleet access "<title>"` |
| `Fleet work items` key + valid header | `Fleet access, work item #<id> "<title>"` |
| Fleet key, no or invalid header | `Fleet access` / `Fleet access, work item` |
| any other key (including "Claude Code") | the raw app name, as before (or none) |

- Title: for a work item the item's title (the `supervisor_work` row whose `session_id` is the session); otherwise the agent-coord name
  of `claude-<first 8 of the session id>` (the Fleet title); otherwise the first 8 characters of the session id. Double quotes and control
  characters are removed, the title is cut at 60 characters. A work item key with no row yet reads `Fleet access, work item "<title>"`.
- Titles are cached per session id for 30 seconds (it runs on every `tools/call`); a work item session whose row is not found yet is
  looked up again after 3 seconds (the Supervisor writes `session_id` only after the launch returns). It never throws; a failing lookup gives the generic label.
- Yukimi's own sessions (Remote Control sessions she starts, her terminal) keep the key "Claude Code" and the label "Claude Code".

## Label or raw name

The label is for display. Identity and ownership decisions keep the raw key name (`resolveActorName`).

| Uses the label (`resolveActorLabel`) | Uses the raw name (`resolveActorName`) |
|---|---|
| `bindClient` / `autoBindNearest` from the REST routes in `agentClientBridge.js` (`/agent/bind`, `open-image`, and the other session routes) | Dovecote owner (`dovecoteIdentity`), Plaud (`plaudMcp`), Claude fleet (`claudeFleetMcp`) |
| MCP `autoBindIfNeeded` and `bind_session` (`mcpAgentFacade.js`) | `tools/list` (`appName`), tool owner gating, `generationCaller`, MCP request log |
| MCP `tools/call`: `beginCall` and every `recordActivity` (the `mcp_activity` broadcast the notice shows) | `PRIORITY_EXEMPT_ACTORS` meaning (see below) |

`agent_session_bound` and `agent_session_notice` carry the bound actor name, which is the label that was passed at bind.

## Bind key

A Fleet session binds on its own tab: `resolveBindKey(req)` answers `appkey:<applicationKeyId>:fleet:<sessionId>` when
`fleetSessionOf(req)` is set (Fleet key plus valid header). Two Fleet agents share one key and must not share one bound tab. Every other
request keeps `appkey:<applicationKeyId>`. The key is only ever compared for equality (bind sessions, pending reattach, studio checkpoints,
pending apply jobs, memory session images); nothing parses it. A Fleet key without a valid header keeps the plain `appkey:<id>` bind.

## Priority client

`PRIORITY_EXEMPT_ACTORS` (`Dreamscape Director`, `Xi`, `Wren`) is compared with the name a bind carries. The "Claude Code" key was not
exempt, so Fleet labels are not exempt either (a label always starts with `Fleet access`, so it can never equal an exempt name). The labels
of the exempt keys are their raw names, so they stay exempt.
