# WebSocket: Menma progress

Server handler: `modules/ws/handlers/165-menmaHandler.js`

Payload builder: `modules/menmaStatus.js` → `buildMenmaStatus()`.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Menma ledger / breakfast state from `.menma/` (cake log, work pile). Does **not** expose `secure.config`, PIN, or keys. Breakfast images themselves remain `GET /images/:filename` (existing gallery auth).

The web applet (`public/scripts/comp/menmaDsapApplet.js`) calls `window.wsClient.sendMessage('get_menma_state', {})`. `sendMessage` resolves to the response `data` object (same JSON shape as the former REST `GET /menma/state` body).

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `get_menma_state` | `get_menma_state_response` | session | Handler: handleGetMenmaState |

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

## Detailed packets

### `get_menma_state`

**Auth:** Session required

**Handler:** modules/ws/handlers/165-menmaHandler.js → `handleGetMenmaState`

**Request fields:** none beyond the standard envelope (`type`, optional `requestId`).

**Success response:** `get_menma_state_response`

`data` shape (from `buildMenmaStatus()`):

```json
{
  "success": true,
  "updated_at": "ISO-8601",
  "available": true,
  "character_name": "Menma",
  "current_kg": 55.4,
  "baseline_kg": 54.0,
  "slices_eaten_total": 13,
  "pending_slices": 0,
  "overtime_hours_total": 0,
  "cake_type": "matcha roll",
  "favorite_cake": "matcha roll",
  "cake_ratings": {},
  "chair": null,
  "last_before": "….png",
  "last_after": "….png",
  "last_look": "….png",
  "last_meal": { "at": "ISO-8601", "slices": 8, "cake_type": "matcha roll", "before": "….png", "after": "….png" },
  "work_pile": { "open": [], "done_since_breakfast": [], "last_breakfast_at": "ISO-8601", "updated_at": "ISO-8601" },
  "cake_log": [ { "at": "ISO-8601", "loop": "3pm-meal", "slices": 8, "named_for": [] } ]
}
```

`available` is `false` when `.menma/state.json` is missing; `success` is still `true`.

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors).
