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

## Server-initiated

| Type | When | Data |
|------|------|------|
| `agent_session_command` | Loopback REST drive of the bound tab | `requestId` + `data.command` (`open_image` / `apply_studio` / `get_state` / `get_editor` / `client_update`). `apply_studio` also carries sibling `autoApply` (default true) and `autoGenerate` (default false). `client_update` shows the mandatory 15s Client Update dialog; Cancel aborts, 0 applies then restarts that tab. |
| `agent_session_bound` | After `POST /agent/bind` | `data.clientId` |
| `agent_session_unbound` | Previous bind replaced | `data.clientId` |

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
snapshot; no image required).

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

## Read-only restrictions

Neither packet is destructive.
