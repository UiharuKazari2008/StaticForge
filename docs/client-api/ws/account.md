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
| `get_app_options` | `get_app_options_response` | session | Full app config + account health; `lean: true` leaves out the on-demand chunks |
| `get_app_options_chunk` | `get_app_options_chunk_response` | session | One on-demand part of the app config (`text_replacements`, `presets`) |
| `retry_account_data` | `retry_account_data_response` | session | Force upstream account refresh |
| `wallet_status` | `wallet_status_response` | admin (session: `restricted`) | Wallet tray: usage and balance of the other accounts and API keys. Handler `modules/ws/handlers/176-walletHandler.js` (owner `wallet`) |
| `get_account_pictures` | `get_account_pictures_response` | session | Administrator and Guest account pictures (Control Panel User Accounts, start menu). Handler `modules/ws/handlers/270-accountPicturesHandler.js` (owner `accountPictures`) |
| `set_account_picture` | `set_account_picture_response` | admin | Change one account's picture: a default name or `custom` with a 128x128 PNG data URL (destructive) |

## Server push (no request)

| Push type | When | Client handler |
|---|---|---|
| `account_data_health_updated` | Account health fields change (including after balance/subscription sync) | `public/scripts/ws/handlers/40-appCoreInbound.js` |
| `account_pictures_changed` | An administrator changed an account picture | `public/scripts/comp/cplUserAccounts.js` (`wsClient.on`) |

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

**Request fields:** `requestId` (optional), `lean` (optional boolean, Yozora #517)

With `lean: true` (the web client) the response leaves out `textReplacements` and
`preset_token_counts.expanders`, sends `activeWorkspace` as `{ id, data: { name } }`, and adds
`lazyChunks: ["text_replacements", "presets"]`. Without it (other clients) the payload is unchanged.
On the live config that is ~9 KB on the wire instead of ~42 KB (190 KB of JSON).

**Success response:** `get_app_options_response` with `data` per schema above.

**Client state after:** Stored as `window.optionsData`. Invalid health triggers blocking dialog in `accountDataBootstrap.js` before `appDataLoaded`. After the logon nothing replaces or reloads the object: chunks are merged into it (`ensureAppOptionsChunk` / `refreshAppOptionsChunk` in `public/scripts/comp/appBootstrap.js`, event `appOptionsChunkLoaded`, `optionsData._cacheVersion` bumped).

### `get_app_options_chunk`

**Auth:** Session required

**Handler:** `handleGetAppOptionsChunk` (`modules/ws/handlers/160-quipsHandler.js`)

**Request fields:** `chunk`: `text_replacements` or `presets`; `requestId` (optional)

**Success response:** `get_app_options_chunk_response`, `data`:

| `chunk` | `data` fields | Client merge |
|---|---|---|
| `text_replacements` | `textReplacements` (wildcard map), `expanders` (token count per wildcard) | `optionsData.textReplacements`, `optionsData.preset_token_counts.expanders`. Loaded when Studio opens, when Run, autocomplete or the token counter needs it, and in idle time after the desktop; refreshed after a wildcard save / create / delete |
| `presets` | `presets` (same rows as `get_app_options`) | `optionsData.presets`; refreshed after a preset save, rename, delete or `preset_update` |

An unknown `chunk` is an error (`Unknown app options chunk`).

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

### `wallet_status`

Usage and balance of every connected account and API key except NovelAI, and the API status of each custom Director engine, for the taskbar wallet flyout (`public/scripts/comp/walletTray.js`, Yozora #430; NovelAI comes from `optionsData`). Built by `modules/walletStatus.js`, cached 2 minutes; `refresh: true` (the flyout opening) re-reads anything older than 20 seconds, `fresh: true` (after a Cursor login finished, `cursor_account_login_complete`) always collects again. The wallet also asks again on `api_service_lock_changed` and `api_key_status_changed`. Each service fails on its own: its block carries `error` instead of failing the packet. A service that is not set up is `null`. OpenAI is not included: it gives API keys no balance (`/dashboard/billing/credit_grants` needs a browser session key).

**Request:** `{ "type": "wallet_status", "refresh": true, "fresh": false }`

**Response (admin):**

| Field | Type | Description |
|-------|------|-------------|
| `fetchedAt` | number | ms epoch |
| `cursor` | object \| null | `{ accounts: [{ id, name, email, color, personas: ['Wren'\|'Xi'], plan, percent, autoPercent, apiPercent, limited, daysLeft, costLabel, needsLogin, error }] }` from `cursorUsage.getCursorUsageForAccount` per saved profile; `null` with no profiles and no host login. `needsLogin` follows Security Center's Login button (never logged in, or the usage error says the login expired / is missing); the wallet then offers `login_cursor_account` |
| `claude` | object \| null | `{ at, status, resetsAt, fiveHour: { percent, resetsAt }, sevenDay: { percent, resetsAt } }` from the last Claude turn (Director `claude-usage.json`); a window whose `resetsAt` passed has reset since. `null` when Claude Code is not installed |
| `tokenrouter` | object \| null | `{ managementKey: false }` without a management key, else `{ managementKey: true, remaining, topUp, vouchers, spent }` (USD, `tokenRouterBridge.wallet`) |
| `runpod` | object \| null | `{ pods: [{ id, name, status, costPerHr, lastStartedAt, gpuName, error }], running, balance, spendPerHr, spendLimit }`; balance from GraphQL `myself { clientBalance currentSpendPerHr spendLimit }` |
| `custom` | object \| null | `{ providers: [{ id, name, kind, host, defaultModel, monitorUsage, hasKey, api: { state, message, status, ms, models, checkedAt }, balance }] }`, one per custom Director engine (`customModelProviders.js`); `null` when none is configured. `api` is one authenticated read (`apiStatus`: `{baseUrl}/v1/models`, Google `{baseUrl}/models`, OpenRouter `{baseUrl}/v1/key`; TokenRouter through `tokenRouterGate`), shown whether or not the host reports usage. `state` follows Security Center's key dots: `ok`, `fail` (key refused), `warn` (outage, rate limit, network), `off` (no key, no call); the key is scrubbed from `message`. `balance` (`balanceInfo`) is `{ balance, title, topUp?, vouchers? }` for TokenRouter (management key) and OpenRouter (credits), `balance: null` when it could not be read, and `null` for other hosts. Cached 60 seconds per provider, also on `fresh` |
| `keys` | object | Read on every request (not cached): `{ locks: [{ service, label, failureCount, lastStatus, lastMessage, lockedAt }], failed: [{ service, label, slot, index, keyName, message, checkedAt }] }`. `locks` = services the key tripwire stopped calling (`apiKeyManager`; the wallet's Unlock sends `unlock_api_service`), `failed` = keys Security Center's check refused (`apiKeyHealth`, state `fail`). Grok is left out |

**Response (session user):** `{ "success": true, "restricted": true }`; the wallet shows NovelAI and the RunPod pods only.

---

### `get_account_pictures` / `set_account_picture`

Account pictures for MeletonFX's two accounts (`modules/accountPictures.js`): Administrator (the admin
PIN) and Guest (the user PIN). A picture is one of Vista's defaults
(`public/static_images/account-pictures/<name>.png`) or an uploaded one.

```json
{ "type": "get_account_pictures" }
{ "type": "get_account_pictures_response", "data": { "success": true,
  "accounts": { "administrator": { "picture": "kitten", "url": "/static_images/account-pictures/kitten.png" },
                "guest": { "picture": "custom", "url": "data:image/png;base64,..." } },
  "defaults": ["music", "starfish", "leaf", "robot", "fish", "bonsai", "sports", "dog", "chess", "kitten", "fireworks", "guest", "user"] } }

{ "type": "set_account_picture", "account": "guest", "picture": "custom", "dataUrl": "data:image/png;base64,..." }
{ "type": "set_account_picture_response", "data": { "success": true, "accounts": { ... } } }
```

`set_account_picture` is admin only. `picture` is a default name or `custom`; `custom` needs `dataUrl`,
a PNG of at most 256 KB (the client draws the upload into 128x128). Stored in `config.json`
`accountPictures` and `data/account-pictures/<account>.png`. After a change the server pushes
`account_pictures_changed` (`data.accounts`) to every client.

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
