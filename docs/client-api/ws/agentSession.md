# WebSocket: Agent session

Server handler: `modules/ws/handlers/168-agentClientHandler.js`

Registry: `modules/agentClientBridge.js`

Client: `public/scripts/comp/agentClientBridge.js`

See [agent-session.md](../agent-session.md) for the localhost REST surface. Ivory / Menma should use loopback + Bearer, not the PIN pad. Share codes and keys are never logged.

These packets are **not** gallery / workspace list APIs.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `session_share_start` | `session_share_start_response` | session | Mint a 6-character share code (~5 min). Optional `userAgent` snippet. |
| `agent_session_result` | (none) | session | Client reply to `agent_session_command`. Fire-and-forget. |

## Server-initiated

| Type | When | Data |
|------|------|------|
| `agent_session_command` | Loopback REST drive of the bound tab | `requestId` + `data.command` (`open_image` / `apply_studio` / `get_state`) |
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

**Success response:** `session_share_start_response`

```json
{
  "success": true,
  "clientId": "a1b2c3d4e5f6",
  "code": "AB3K7Q",
  "expiresInSec": 300
}
```

Do not log `code`. Control Panel → Share session shows it in a dialog.

### `agent_session_result`

**Auth:** Session required

**Handler:** modules/ws/handlers/168-agentClientHandler.js → `handleAgentSessionResult`

**Request fields:** standard envelope `requestId` plus `data` snapshot / `{ ok, error }`.

Ignored when no matching pending command, the sender is not the bound client, or the client is not bound.

**Errors:** none (no response packet).

## Read-only restrictions

Neither packet is destructive.
