# WebSocket: Autofill Ranking

Server handler: `modules/ws/handlers/230-autofillRankingHandler.js`

Global (shared, not per-user) tunable ranking config for prompt tag autofill/SmartText,
stored in `config.autofillRanking` (`modules/autofillRankingSettings.js`). Applied to:

- `modules/tag-lookup.js` `searchTagsAutofill()` — server-side candidate scoring
- `public/scripts/comp/autocompleteUtils.js` `calculateComprehensiveRanking()` + sort comparator — client-side scoring/tie-breaking

Admin UI: DSAP-SMF applet at `dsap://autofill.dreamscape.jp/` (`public/scripts/comp/autofillConfigDsapApplet.js`).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `get_autofill_ranking` | `get_autofill_ranking_response` | session | Handler: handleGetAutofillRanking |
| `test_autofill_ranking` | `test_autofill_ranking_response` | session | Handler: handleTestAutofillRanking |
| `update_autofill_ranking` | `update_autofill_ranking_response` | admin/destructive | Handler: handleUpdateAutofillRanking |

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

`update_autofill_ranking` is marked destructive in `modules/websocketHandlers.js` → `isDestructiveOperation()` and returns `READONLY_RESTRICTED` for `userType: "readonly"` sessions. It also requires `clientInfo.userType === 'admin'`.

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

## Detailed packets

### `get_autofill_ranking`

**Auth:** Session required

**Handler:** modules/ws/handlers/230-autofillRankingHandler.js → `handleGetAutofillRanking`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_autofill_ranking_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `test_autofill_ranking`

**Auth:** Session required

**Handler:** modules/ws/handlers/230-autofillRankingHandler.js → `handleTestAutofillRanking`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `query` | Optional |
| `autofillSettings` | Optional |
| `model` | Optional |

**Success response:** `test_autofill_ranking_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `update_autofill_ranking`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/230-autofillRankingHandler.js → `handleUpdateAutofillRanking`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `ranking` | Optional |

**Success response:** `update_autofill_ranking_response`

Additional response/push types from handler:
- `autofill_ranking_updated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

