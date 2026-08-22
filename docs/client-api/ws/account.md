# WebSocket: Account & App Bootstrap

Server handlers: `modules/ws/handlers/160-quipsHandler.js` (packets registered with owner `app`)

Account data is fetched from NovelAI `image.novelai.net` at server startup and on refresh:

| Server function | Upstream path | Purpose |
|-----------------|---------------|---------|
| `getUserData()` | `GET /user/data` | Full account payload (subscription, priority, information, …) |
| `getBalance()` | `GET /user/subscription` | Anlas balance + subscription fields (merged on periodic refresh) |

Validation: `modules/accountDataHealth.js` → stored on `globalResources.accountDataHealth`.

Client bootstrap: `public/scripts/comp/appBootstrap.js`, `accountDataBootstrap.js`.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `get_app_options` | `get_app_options_response` | session | Full app config + account health |
| `retry_account_data` | `retry_account_data_response` | session | Force upstream account refresh |

## Server push (no request)

| Push type | When | Client handler |
|---|---|---|
| `account_data_health_updated` | Account health fields change (including after balance/subscription sync) | `public/scripts/ws/handlers/40-appCoreInbound.js` |

Periodic **ping** payloads include `balance`, `opusUsage`, and `accountHealth` — see [infrastructure.md](./infrastructure.md#ping-server-push-fields).

---

## Account health fields

Present on `get_app_options_response.data`, `retry_account_data_response.data`, ping `accountHealth`, and `account_data_health_updated.data`:

| Field | Type | Description |
|-------|------|-------------|
| `userDataValid` | boolean | `true` when subscription has a usable tier (0–3), subscription is active (or in grace period), and account is not banned |
| `userDataError` | string\|null | Human-readable failure when `userDataValid` is false |
| `accountStanding` | string | `ok`, `banned`, `restricted`, `incomplete`, or `unavailable` |
| `banMessage` | string\|null | Ban/suspension detail when standing is `banned` or `restricted` |
| `upstreamUnavailable` | boolean | Upstream unreachable, API key missing, or service tripwire locked |
| `subscriptionRenewalFailed` | boolean | `true` when server detected a prior active subscription that is now inactive (renewal failure); client shows a one-time-per-session notice |
| `accountSubscriptionLastRefreshAt` | string\|null | ISO timestamp of the last upstream subscription snapshot refresh on the server |

Inactive subscriptions (`subscription.active === false`) are treated as invalid unless `subscription.isGracePeriod` is true (standing `restricted`, error *NovelAI subscription is not active*).

The server persists subscription snapshots in `.cache/account_subscription_snapshot.json` and sets `subscriptionRenewalFailed` when a previously active subscription becomes inactive (not in grace period). The flag clears automatically when the subscription is active again.

Health is re-evaluated when:

- Server boot — `initializeAccountData()` (full `/user/data`) then `refreshBalance(true)` (boot balance sync even with no WS clients)
- Client `retry_account_data` (forces `/user/data` then `/user/subscription`)
- Periodic `refreshBalance()` (after `/user/subscription` merge)

---

## `get_app_options_response.data` schema

Top-level `ok` is always `true` when the WS handler succeeds (app config loaded). Account validity is expressed via health fields above, not by failing the packet.

### Account & health

| Field | Type | Description |
|-------|------|-------------|
| `user` | object | NovelAI account payload (see below) |
| `balance` | object | Anlas summary (see below) |
| `opusUsage` | object\|null | V5 Opus allowance `{ percent, isNegative, timeUntilNextPercent }` from `/user/subscription` |
| `userDataValid` | boolean | Account health |
| `userDataError` | string\|null | Account health |
| `accountStanding` | string | Account health |
| `banMessage` | string\|null | Account health |
| `upstreamUnavailable` | boolean | Account health |
| `subscriptionRenewalFailed` | boolean | Persisted renewal-failure notice flag |
| `accountSubscriptionLastRefreshAt` | string\|null | Last server subscription snapshot refresh |
| `bootCycleId` | string\|null | Server boot id (status incident inhibit scope) |
| `novelaiStatus` | object\|null | Cached [NovelAI status page](https://status.novelai.net/) snapshot (see below) |

### App configuration (abbreviated)

| Field | Type | Description |
|-------|------|-------------|
| `presets` | array | Preset summaries |
| `models` | object | Model id → display name |
| `modelsShort` | object | Short display names |
| `samplers` | object | Sampler id → label |
| `noiseSchedulers` | object | Noise scheduler id → label |
| `resolutions` | object | Resolution preset id → label |
| `actions` | object | Action id → label |
| `datasets` | array | Dataset config entries |
| `quality_presets` | object | Per-model quality presets |
| `uc_presets` | object | Per-model UC presets |
| `nsfw_presets` | object | NSFW preset config |
| `textReplacements` | object | Text expander map |
| `text_tags` | object | Text tag config |
| `preset_token_counts` | object | Cached token counts |
| `queue_status` | number | Queue state (0 idle, 1 processing, 2 blocked) |
| `image_count` | number | Total generated image count |
| `activeWorkspace` | object\|null | `{ id, data }` for session workspace |
| `defaultGrokModel` | string | Default Grok model id |

---

## `user` object (`optionsData.user`)

Mirrors server `getAccountData()` / NovelAI `/user/data` (plus server `ok` / error wrappers when invalid).

| Field | Type | When present | Description |
|-------|------|--------------|-------------|
| `ok` | boolean | always | `true` when last full `/user/data` fetch validated |
| `error` | string | invalid fetch | Error message |
| `reason` | string | invalid fetch | e.g. `missing_api_key`, `service_locked` |
| `subscription` | object | usually | Subscription + Anlas (see below) |
| `priority` | object | valid fetch | NovelAI priority queue data |
| `keystore` | object | valid fetch | Keystore entries |
| `settings` | string | valid fetch | Client settings blob |
| `information` | object | valid fetch | Account identity; may include ban fields |

### `user.subscription`

| Field | Type | Description |
|-------|------|-------------|
| `tier` | number | `0` Paper, `1` Tablet, `2` Scroll, `3` Opus |
| `active` | boolean | Subscription active |
| `expiresAt` | number | Unix seconds |
| `perks` | object | Tier perks (text + normalized image free limits) |
| `trainingStepsLeft` | object | Anlas balances (see `balance`) |
| `paymentProcessorData` | object | Billing metadata |
| `isGracePeriod` | boolean | Grace period flag |

### `user.subscription.trainingStepsLeft` / `balance`

| Field | Type | Description |
|-------|------|-------------|
| `fixedTrainingStepsLeft` | number | Free / subscription Anlas |
| `purchasedTrainingSteps` | number | Paid Anlas |
| `totalCredits` | number | Sum (only on `balance` top-level object) |

Client `optionsData.balance` shape:

```json
{
  "fixedTrainingStepsLeft": 10000,
  "purchasedTrainingSteps": 500,
  "totalCredits": 10500
}
```

When the user chose **Continue** without valid account data, client sets `accountDataDeferred: true` and displays `---` for balances.

---

## `novelaiStatus` object

From `modules/novelAiStatusMonitor.js`:

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Last fetch succeeded |
| `bootCycleId` | string\|null | Matches top-level `bootCycleId` |
| `fetchedAt` | string\|null | ISO timestamp |
| `stale` | boolean | Serving cached data |
| `fetchError` | string\|null | Last fetch error |
| `overall` | object\|null | Page-wide status summary |
| `components` | array | Monitored components (Image Generation, Login, Website, Payments) |
| `activeIncident` | object\|null | Highest-priority open incident |
| `imageGenerationBlocked` | boolean | `true` when Image Generation status ≥ partial outage |

---

## Client-only flags

| Field | Location | Description |
|-------|----------|-------------|
| `accountDataDeferred` | global + `optionsData.accountDataDeferred` | User continued without valid upstream account data |

---

## Response envelope

Successful replies use:

```json
{
  "type": "<request_type>_response",
  "requestId": "<same as request>",
  "data": { "ok": true, ... },
  "timestamp": "<ISO-8601>"
}
```

Errors use `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors).

---

## Detailed packets

### `get_app_options`

**Auth:** Session required

**Handler:** `handleGetAppOptions`

**Request fields:** `requestId` (optional)

**Success response:** `get_app_options_response` with `data` per schema above.

**Client state after:** Stored as `window.optionsData`. Invalid health triggers blocking dialog in `accountDataBootstrap.js` before `appDataLoaded`.

### `retry_account_data`

**Auth:** Session required

**Handler:** `handleRetryAccountData`

Forces `initializeAccountData(true)` on the server.

**Success response:** `retry_account_data_response`

`data` fields:

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Handler success (always `true` on success) |
| `userDataValid` | boolean | Health |
| `userDataError` | string\|null | Health |
| `accountStanding` | string | Health |
| `banMessage` | string\|null | Health |
| `upstreamUnavailable` | boolean | Health |
| `subscriptionRenewalFailed` | boolean | Renewal-failure notice flag |
| `accountSubscriptionLastRefreshAt` | string\|null | Last subscription snapshot refresh |
| `user` | object | Updated account data |
| `balance` | object | Updated Anlas summary |

**Client:** `WebSocketClient.retryAccountData()`

### `account_data_health_updated` (server push)

**Payload:** Account health fields + optional `balance`.

**Client:** `applyAccountHealthFieldsToOptions()` syncs `optionsData` and tray/Data Management UI; prompts restart when deferred user receives valid data; shows subscription renewal-failure dialog once per client session when `subscriptionRenewalFailed` is true.

---

## Subscription renewal failure notice

When the NovelAI subscription transitions from **active** to **inactive** (and not in grace period), the server sets `subscriptionRenewalFailed: true` and persists that state in:

```
.cache/account_subscription_snapshot.json
```

The client shows a dialog on startup (or when the flag becomes true mid-session via ping / `account_data_health_updated`). The dialog is shown **once per client restart** — reloading the page shows it again until the server flag is cleared.

### Clearing the renewal notice (server)

The flag clears automatically on the next successful refresh when the subscription is active again.

If you intentionally cancelled NovelAI and no longer want the notice (or need to reset a stale flag):

1. Stop the Dreamscape server (or ensure no concurrent writes).
2. Either **delete** `.cache/account_subscription_snapshot.json`, or edit the file and set `"renewalFailedPendingNotice": false` (and optionally remove `renewalFailedDetectedAt`).
3. Restart the server.

After deletion, the next account refresh writes a fresh snapshot from the current upstream subscription state without the pending notice (unless a new active→inactive transition is detected).

---

## Source of truth

| Concern | Module |
|---------|--------|
| Health evaluation | `modules/accountDataHealth.js` |
| Subscription snapshot + renewal notice | `modules/accountSubscriptionSnapshot.js` |
| Stored account + health | `modules/globalResources.js` |
| Upstream fetch | `web_server.js` → `getUserData`, `getBalance` |
| Client gate | `public/scripts/comp/accountDataBootstrap.js` |
