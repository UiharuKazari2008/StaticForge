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
| `update_autofill_ranking` | `update_autofill_ranking_response` | admin/destructive | Handler: handleUpdateAutofillRanking. Broadcasts `autofill_ranking_updated` to all clients. |
| `test_autofill_ranking` | `test_autofill_ranking_response` | session | Handler: handleTestAutofillRanking. Runs the live `searchTagsAutofill` pipeline with `includeBreakdown: true`. |

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

## Detailed packets

### `get_autofill_ranking`

**Auth:** Session required

**Handler:** modules/ws/handlers/230-autofillRankingHandler.js → `handleGetAutofillRanking`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_autofill_ranking_response` — `data.ranking` is the fully normalized ranking config (see `modules/autofillRankingSettings.js` `DEFAULT_AUTOFILL_RANKING` for shape: `serverBase`, `serverBonus`, `serverCategory`, `tiers`, `clientTierBonus`, `clientNonTag`, `typeOrder`, `typeWeights`, `rankingVersion`).

### `update_autofill_ranking`

**Auth:** Session required. Admin only (destructive — blocked for readonly and non-admin)

**Handler:** modules/ws/handlers/230-autofillRankingHandler.js → `handleUpdateAutofillRanking`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `ranking` | Required. Partial patch — any subset of `DEFAULT_AUTOFILL_RANKING` groups/keys. Merged via `mergeAutofillRankingPatch`, `rankingVersion` is bumped server-side. |

**Success response:** `update_autofill_ranking_response` — `data.ranking` is the merged/normalized config. Also broadcasts `autofill_ranking_updated` (`data.ranking`) to all connected clients so `public/scripts/comp/autofillRankingConfig.js` can live-update.

**Errors:** `type: "error"` via `sendError()`. `INSUFFICIENT_PERMISSIONS` if not admin.

### `test_autofill_ranking`

**Auth:** Session required

**Handler:** modules/ws/handlers/230-autofillRankingHandler.js → `handleTestAutofillRanking`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `query` | Required (empty query returns `data.results: []`) |
| `limit` | Optional, default 35, clamped 1–100 |

**Success response:** `test_autofill_ranking_response` — `data.results` is the live `tagAutofillSearch.searchTags()` output; each tag includes `rankingBreakdown` (`base`, `usageBonus`, `trainingBonus`, `categoryAdjustment`, `usage`, `novelStrength`, `hasGroups`, `matchTier`, `matchCoverage`, `totalScore`).
