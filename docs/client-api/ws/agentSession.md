# WebSocket: Agent session

Server handler: `modules/ws/handlers/168-agentClientHandler.js`

Registry: `modules/agentClientBridge.js`

Client: `public/scripts/comp/agentClientBridge.js` (inbound handler only; no applet)

See [agent-session.md](../agent-session.md) for the localhost REST surface. Ivory / Menma should use loopback + Bearer, not the PIN pad. Share codes and keys are never logged.

These packets are **not** gallery / workspace list APIs. No share-code chrome is shipped; mint from console via `window.agentSessionShareStart()` or `session_share_start`.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `session_share_start` | `session_share_code_response` | session | Mint a 6-character share code (~5 min). Optional `userAgent` snippet. |
| `agent_session_result` | (none) | session | Client reply to `agent_session_command`. Fire-and-forget. |
| `agent_session_unbind` | `agent_session_unbind_response` | session | Tray Unbind. Releases every application-key bind on this tab. |

## Server-initiated

| Type | When | Data |
|------|------|------|
| `agent_session_command` | Loopback REST / MCP drive of this key's bound tab | `requestId` + `data.command` (`open_image` / `apply_studio` / `get_state` / `get_windows` / `get_editor` / `get_physics` / `client_update`). `get_windows` returns open Lumen / Glancewell / Grimoire / gallery / Studio with current data. `apply_studio` also carries sibling `autoApply` (default true) and `autoGenerate` (default false). Silent apply sets `skipAutofill` on field writes. `get_physics` returns the tab's dynamic-button config; the server compiles location/tod/date/weather/season. `client_update` shows the mandatory 15s Client Update dialog; Cancel aborts, 0 applies then restarts that tab. `POST /agent/broadcast` `restart: true` reuses that same dialog on every connected tab (not this bound command). |
| `agent_session_bound` | After this key binds the tab | `data.clientId` — tray popup |
| `agent_session_unbound` | This key rebound / idle 15 min / tray Unbind and no other key remains | `data.clientId`, `data.reason` |
| `agent_session_notice` | Physics used (and similar tray cues) | `data.action` (`physics`) |

## Detailed packets

### `session_share_start`

**Auth:** Session required

**Handler:** modules/ws/handlers/168-agentClientHandler.js → `handleSessionShareStart`

**Request fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `userAgent` | No | Short UA snippet stored on the connection for `GET /agent/clients` |

**Success response:** `session_share_code_response`

```json
{
  "success": true,
  "clientId": "a1b2c3d4e5f6",
  "code": "AB3K7Q",
  "expiresInSec": 300
}
```

Do not log `code`. No dialog is shown; the requesting console / agent receives the payload.

### `agent_session_result`

**Auth:** Session required

**Handler:** modules/ws/handlers/168-agentClientHandler.js → `handleAgentSessionResult`

**Request fields:** standard envelope `requestId` plus `data` snapshot / `{ ok, error }`.

`get_state` / `get_editor` reply `data` includes `ok`, `workspaceId`, `filename`
(null if ungenerated), `model`, `clientId`, and `change` (Change-JSON v1 editor
snapshot; no image required). `change.params.seed` is the actual seed used;
`change.params.seedLock` is the existing Studio sprout lock.

`apply_studio` command `data` includes `change` / `prompt` / `uc` / `payload`
plus `autoApply` (default `true`) and `autoGenerate` (default `false`). Those
two bools are siblings of `change`, not Change-JSON fields. `autoApply: true`
awaits silent `applyStudioChangePayloadSilent` on the bound tab (Studio opens
like open-image; no confirm dialog). After a successful apply,
`autoGenerate: true` clicks `#manualGenerateBtn` (existing Studio Generate
path / `generate_image`) on Yukimi's bound session. The client reply does not
wait for generation. `autoGenerate` without `autoApply` is rejected at REST
(`400`).


Ignored when no matching pending command or the sender is not the bound client.

**Errors:** none (no response packet).

### `agent_session_unbind`

**Auth:** Session required

**Handler:** modules/ws/handlers/168-agentClientHandler.js → `handleAgentSessionUnbind`

Tray Unbind. Releases every application-key bind on this tab and pushes
`agent_session_unbound` `{ reason: "tray" }`.

**Success response:** `agent_session_unbind_response` `{ success, unbound, clientId }`

## Read-only restrictions

None of these packets are destructive.
