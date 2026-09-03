# WebSocket: Menma progress (Cake Pantry)

Server handler: `modules/ws/handlers/165-menmaHandler.js`

Payload builder: `modules/menmaStatus.js` → `buildMenmaStatus()`, `buildAllAccountsStatus()`.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Cake pantry state from SQLite (`tag_wiki.db` via `menmaStatus.js`). Supports accounts: `menma`, `hoshino`, `ivory`, `pyra`, `chiyo`. One-shot import per account from `.{account}/` files into SQLite; after import all reads and writes use SQLite only (fail-closed). Does **not** expose `secure.config`, PIN, or keys. Breakfast images remain `GET /images/:filename` (existing gallery auth). If the tag database is unavailable, returns `available: false` instead of 500.

The web applet (`public/scripts/comp/menmaDsapApplet.js`) calls `window.wsClient.sendMessage('get_menma_state', {})`. Response includes:
- Root-level Menma fields (backward compat)
- `accounts` object with status for all five accounts (menma, hoshino, ivory, pyra, chiyo)

The applet displays all accounts in a clickable grid; selecting an account shows its ledger, work pile, and cake log.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `get_menma_state` | `get_menma_state_response` | session | Handler: menma |

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

Packets marked destructive in `modules/websocketHandlers.js` → `isDestructiveOperation()` return `READONLY_RESTRICTED` for `userType: "readonly"` sessions. `get_menma_state` is **not** destructive.

---

---

## Detailed packets

### `get_menma_state`

**Auth:** Session required

**Handler:** modules/ws/handlers/165-menmaHandler.js → `menma`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_menma_state_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

