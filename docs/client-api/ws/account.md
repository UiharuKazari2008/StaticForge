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
| `set_account_name` | `set_account_name_response` | admin | Rename an account (User Accounts' Change the account name; destructive) |
| `get_claude_accounts` | `get_claude_accounts_response` | admin | Claude accounts (CardSpace's Claude keys) and the host's Remote Control. Handler `modules/ws/handlers/313-claudeAccountsHandler.js` (owner `claudeAccounts`); [Claude accounts](#claude-accounts) |
| `switch_claude_account` / `link_claude_account_login` / `unlink_claude_account_login` / `claude_remote_control` | `*_response` | admin | Switch the engine's account (reconnects Remote Control), link / unlink a Remote Control login, reconnect / start / stop Remote Control (destructive) |
| `claude_account_login` | `claude_account_login_response` | admin | Add an account by signing in on the host: sign-in link + pasted code, two steps (destructive); [Add Account](#claude-add-account) |
| `get_claude_sessions` / `claude_session_action` | `*_response` | admin | Every Claude session on the host; Reconnect one into Remote Control / Disconnect it (the action is destructive); [Sessions](#claude-sessions) |

## Server push (no request)

| Push type | When | Client handler |
|---|---|---|
| `account_data_health_updated` | Account health fields change (including after balance/subscription sync) | `public/scripts/ws/handlers/40-appCoreInbound.js` |
| `account_pictures_changed` | An administrator changed an account picture or name | `public/scripts/comp/cplUserAccounts.js` (`wsClient.on`) |
| `claude_remote_control_status` | Claude Remote Control reconnecting / connected / error (admins) | `public/scripts/comp/wmClaudeAccounts.js` (`wsClient.on`) |
| `claude_account_login_status` | Add Account sign-in state (link, step, done / error; admins) | `public/scripts/comp/wmClaudeAccounts.js` (`wsClient.on`) |

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
| `chatModel` | string\|null | Chat persona model id on DeepInfra (config `chatModel`, else the provider default). `defaultGrokModel` is no longer sent (Yozora #738). |

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
| `claude` | object \| null | `{ at, status, resetsAt, fiveHour: { percent, resetsAt }, sevenDay: { percent, resetsAt }, accounts: [row] }`: the windows from the last Claude turn (Director `claude-usage.json`; a window whose `resetsAt` passed has reset since) and `accounts`, every Claude account's plan usage (see [`claude_usage` feed](#claude-usage-feed)). `refresh` / `fresh` read the accounts again (20 s floor). `null` when Claude Code is not installed and no Claude account exists |
| `tokenrouter` | object \| null | `{ managementKey: false }` without a management key, else `{ managementKey: true, remaining, topUp, vouchers, spent }` (USD, `tokenRouterBridge.wallet`) |
| `runpod` | object \| null | `{ pods: [{ id, name, status, costPerHr, lastStartedAt, gpuName, error }], running, balance, spendPerHr, spendLimit }`; balance from GraphQL `myself { clientBalance currentSpendPerHr spendLimit }` |
| `custom` | object \| null | `{ providers: [{ id, name, kind, host, defaultModel, monitorUsage, hasKey, api: { state, message, status, ms, models, checkedAt }, balance }] }`, one per custom Director engine (`customModelProviders.js`); `null` when none is configured. `api` is one authenticated read (`apiStatus`: `{baseUrl}/v1/models`, Google `{baseUrl}/models`, OpenRouter `{baseUrl}/v1/key`; TokenRouter through `tokenRouterGate`), shown whether or not the host reports usage. `state` follows Security Center's key dots: `ok`, `fail` (key refused), `warn` (outage, rate limit, network), `off` (no key, no call); the key is scrubbed from `message`. `balance` (`balanceInfo`) is `{ balance, title, topUp?, vouchers? }` for TokenRouter (management key) and OpenRouter (credits), `balance: null` when it could not be read, and `null` for other hosts. Cached 60 seconds per provider, also on `fresh` |
| `keys` | object | Read on every request (not cached): `{ locks: [{ service, label, failureCount, lastStatus, lastMessage, lockedAt }], failed: [{ service, label, slot, index, keyName, message, checkedAt }] }`. `locks` = services the key tripwire stopped calling (`apiKeyManager`; the wallet's Unlock sends `unlock_api_service`), `failed` = keys Security Center's check refused (`apiKeyHealth`, state `fail`). Grok is left out |

**Response (session user):** `{ "success": true, "restricted": true }`; the wallet shows NovelAI and the RunPod pods only.

---

### `claude_usage` feed

<a id="claude-usage-feed"></a>Plan usage of **every** Claude account (Security Center's Claude keys), each read with its own claude.ai login: `modules/claudeUsage.js`, `modules/ws/handlers/315-claudeUsageHandler.js`. The Account Manager tray (`walletTray.js`, while the window is seen) and Melaton Mobile's Accounts (`wmAccounts.js`, while its page is shown) subscribe with `status_subscribe { feed: 'claude_usage' }` (admins only); the server reads every 5 minutes while someone is subscribed and pushes `claude_usage_status { changed, removed }` only when a row changed. No client timer.

- Source: `GET https://api.anthropic.com/api/oauth/usage` (`anthropic-beta: oauth-2025-04-20`), the call the CLI's `/usage` makes. The account on the host uses `~/.claude/.credentials.json`; any other the fresher of its linked login and its parallel-session config dir.
- An idle non-host login whose access token ran out is renewed with its own refresh token (`platform.claude.com/v1/oauth/token`, the CLI's client id) and the rotated login is saved back as the linked login and into its config dir. Never done for the host's login, a login a running CLI holds (`CLAUDE_CONFIG_DIR` of a live `~/.claude/sessions/<pid>.json` process), or during an account switch: those wait for their CLI. A refused renewal asks for a sign-in (10-minute back-off).
- An account without a linked login (setup token only, which cannot read the endpoint) shows the last Claude turn's windows when it is the engine's account, else `needsLogin`.

Items: `_meta { at, error }` and one per account id:

| Field | Description |
|-------|-------------|
| `id`, `index`, `name` | CardSpace account (`claudeAccountHost.listAccounts`) |
| `email`, `organization` | of its linked login |
| `engine`, `onHost` | the Director's account; the login Remote Control runs on |
| `plan` | `Max 5x`, `Max 20x`, `Pro`, ... (`rateLimitTier` / `subscriptionType`) |
| `source`, `at` | `login` (its own login) or `turns` (last Claude turn); when read |
| `limits` | `[{ kind: session \| weekly_all \| weekly_scoped \| five_hour..., label: 'Current session' \| 'Weekly (all models)' \| 'Weekly (<model>)', short, percent, resetsAt (ms), severity, active }]` |
| `extra` | `{ enabled, used, limit, currency, decimals, percent, limitReached }` when extra usage is on, else `null` |
| `needsLogin`, `error` | no usable login / why the figures are missing or old (last good figures are kept) |

No token is ever in a row, a push or a log line.

### Claude accounts

The Claude accounts the Director's Claude engine signs in with (Wren, Xi, Rentan) and the Claude Remote Control on the server. The accounts are CardSpace's Claude service keys (`apiKeyManager` service `claude`, a `claude setup-token` OAuth token each); the desktop changes them in CardSpace, the phone in **Claude Accounts** (`public/scripts/comp/wmClaudeAccounts.js`, Programs; styles `wm-accounts.css` + `wm-claude-accounts.css`). One backend: `modules/claudeAccountHost.js`, handler `modules/ws/handlers/313-claudeAccountsHandler.js` (owner `claudeAccounts`). Admin only, as Security Center's Cursor accounts; the writes are destructive (refused to read-only clients) and have no application-key scope. There is no REST route (the Cursor accounts have none either).

- **Engine account**: selecting a key (`update_api_key_selections` from CardSpace's *Use this account*, or `switch_claude_account`) writes the selected token to `.cache/secrets/claude.oauth` (`syncClaudeTokenFile`), which every Claude CLI launch reads first (`xiLaunch.resolveClaudeTokenFile`).
- **Remote Control** (`claude remote-control --name Dreamscape`, systemd user unit `claude-remote.service`, tmux session `claude-rc`) needs the full claude.ai login of `~/.claude/.credentials.json` (+ `oauthAccount` in `~/.claude.json`), not the setup token. Each account can carry a **linked login**: a copy of the host's claude.ai login taken with `link_claude_account_login` (kept 0600 in `.cache/secrets/claude-accounts/<id>/`, `<id>` = 16 hex of the setup token's SHA-256; a login belongs to one account at a time).
- **Every selection reconnects Remote Control** (CardSpace's too), in the background: stop the unit, save the live login back into the account it belongs to (its refresh token rotates), put the new account's linked login in place (an account without one leaves the host signed in as before and says so), start the unit, then wait up to 45 s for the pane to say *Connected*. Restarting Remote Control ends the sessions it is running (the phone asks first and shows how many).
- **Permissions are shared, never per account.** The rules and mode live once on the host: `~/.claude/settings.json` (`permissions.allow` / `deny` / `ask`, `defaultMode`, `skipDangerousModePermissionPrompt`), a project's `.claude/settings.json` / `settings.local.json`, `~/.claude.json` `projects[*].allowedTools` / `hasTrustDialogAccepted`, and Remote Control's own `--permission-mode` on the unit's ExecStart (Remote Control's spawned sessions take that flag, not `defaultMode`). A switch replaces only `.credentials.json`'s `claudeAiOauth` (the file's other keys, e.g. MCP logins, stay) and `~/.claude.json`'s `oauthAccount`. A linked login (and Add Account's result) stores `credentials.json` = `{ claudeAiOauth }` and `account.json` = `{ oauthAccount, linkedAt }` only; older ones holding more are cut down on first load. The switch compares a fingerprint of all of the above before and after (`status.permissionsKept`). `host.permissions` is the Host tab's summary.
- **Bring over** (`carry`): a restart ends every Remote Control session: the server's children and `rc-*` ones (they hold the old login, and a token refresh from one would write the old login back). `switch_claude_account` / `claude_remote_control` (reconnect, start) take `carry: [session id]` from `host.sessions`; once Remote Control says *Connected* each picked one is started again under the new login with `claude --resume <id> --fork-session --remote-control <title> --permission-mode <unit's mode>` in its own folder (a copy with the whole history: the old claude.ai session belongs to the old account), as tmux `rc-<id8>` on claudeSessions' own socket (`tmux -L dreamscape-claude-carry`, never the default socket the unit's Type=forking tmux uses). The pane is watched for */remote-control is active* (nudged once with `/remote-control` if the CLI could not reattach); the result and link land in `status.carry`. CardSpace's *Use this account* brings none over.
- Transcripts (`~/.claude/projects/<cwd with non-alphanumerics as ->/<id>.jsonl`) are one set for the host: no account has its own `CLAUDE_CONFIG_DIR`, so a switch loses none.
- No packet, push or log carries a token. The pane text is cut to its status line, `Capacity: n/m` and an error line, with links and long ids removed.

| Request type | Typical response | Notes |
|---|---|---|
| `get_claude_accounts` | `get_claude_accounts_response` | `{ accounts, host }` (below) |
| `switch_claude_account` | `switch_claude_account_response` | `{ index, carry? }`: make that key the engine's account (CardSpace's selection) and reconnect Remote Control; the active account again only reconnects. Answers at once with `{ accounts, host }` (status `reconnecting`); the end comes as `claude_remote_control_status` |
| `link_claude_account_login` | `link_claude_account_login_response` | `{ index }`: link the host's current claude.ai login to that account (moved off any other account) |
| `unlink_claude_account_login` | `unlink_claude_account_login_response` | `{ index }`: forget that account's linked login (the host login stays) |
| `claude_remote_control` | `claude_remote_control_response` | `{ action: 'reconnect' \| 'start' \| 'stop', carry? }`; stop ends only the unit's own sessions (rc-* ones keep running); reconnect / start put the active account's linked login in place first |

Adding, renaming and deleting an account are CardSpace's own `add_api_key` / `update_api_key` / `delete_api_key` with `service: 'claude'`.

**`accounts[]`:** `{ index, id, name, fingerprint, active, remoteLogin, onHost }`; `fingerprint` is the key manager's masked key, `remoteLogin` `null` or `{ email, displayName, organization, accountUuid, plan, rateLimitTier, expiresAt, remoteControlCapable, linkedAt }`, `onHost` true when the host is signed in with that linked login.

**`host`:** `{ hostname, cliVersion, engine: { account: { index, name } | null, tokenFile }, login (as remoteLogin, the host's own, or null), remoteControl: { unit, installed, active, sub, pid, since, restarts, sessionName, pane: { state, statusLine, sessions, capacity, errorLine, tail, attached }, status, permissionMode, workingDirectory }, sessions: [{ id, pid, origin: 'server' | 'rc', title, name, cwd, folder, status, link, tmuxSession, startedAt, lastActivity, resumable }], permissions: { shared: true, mode, remoteControlMode, skipBypassPrompt, allow, deny, ask, projectAllow, project, trustedFolders, projectAllowedTools, fingerprint } }`.

**Push `claude_remote_control_status`** (admins; phone-only class, a sleeping phone keeps the last): `data: { state: 'reconnecting' | 'connected' | 'error' | 'stopped' | 'unknown', message, at, account: { index, name } | null, attempt, carry: { selected: [{ id, title, folder, origin, status }], ending: [...], results: [{ id, title, folder, state: 'carried' | 'started' | 'failed', link, tmuxSession, message }] }, permissionsKept }`.

<a id="claude-add-account"></a>
**Add Account by signing in** (`claude_account_login`, `modules/claudeAccountLogin.js`). The phone's *Add Account* (button under the list, or Menu) signs a new account in with the host's `claude` CLI, run in a pty (`script`, 1000 columns) with `HOME` and `CLAUDE_CONFIG_DIR` set to a fresh owner-only `.cache/secrets/claude-accounts/pending-<8 hex>/` and an environment built from scratch (no server token or session variables, `BROWSER=true`), so the host's own login, Remote Control and the Claude agents are never touched. Two steps, each showing its sign-in link (copyable field, **Copy**, **Open in Alchemy** via `openGrimoireUrl`) and a **Paste code** field for the code claude.ai shows:

1. `claude auth login --claudeai`: the full claude.ai login (with `user:sessions:claude_code`) that becomes the account's linked Remote Control login.
2. `claude setup-token`: the long-lived engine token that becomes the CardSpace Claude key (`apiKeyManager.addApiKey`, named as given or after the login's email).

The account is saved only when both are done. One sign-in at a time (a second *start* returns the running one; `restart: true` replaces it); each step times out after 10 minutes; cancel / timeout / error kill the CLI's process group and remove the pending dir (a server restart sweeps leftovers). A read-only instance (`DREAMSCAPE_CLAUDE_RC_READONLY=1`) runs the flow but saves nothing.

| `action` | Extra fields | Does |
|---|---|---|
| `status` | | The current sign-in |
| `start` | `name?`, `restart?` | Starts step 1 (or returns the running sign-in) |
| `code` | `code`, `name?` | Types the pasted code into the waiting CLI |
| `retry` | | After an error: redoes the failed step (step 1's login is kept) |
| `name` | `name` | Sets the new account's name |
| `cancel` | | Ends the sign-in and removes its files |

Answer `data: { login, accounts }`; `login` = `{ state: 'idle' }` or `{ id, state: 'starting' | 'waiting_code' | 'verifying' | 'done' | 'error', step: 'login' | 'token', stepNumber, steps: 2, stepTitle, url, name, message, signedInAs: { email, plan, ... } | null, account: { index, name, email, plan, linked } | null, startedAt, expiresAt }`. **Push `claude_account_login_status`** (admins; phone-only class, a sleeping phone keeps the last) carries the same `login`. No token or code is ever sent, logged or broadcast (`url` is the OAuth authorize link: no secret; CLI text shown in `message` is cleaned of links, the code and anything token-shaped).

<a id="claude-sessions"></a>
**Sessions** (`get_claude_sessions`, `claude_session_action`; `modules/claudeSessions.js`, shared with the desktop's Claude Accounts). The phone's Sessions tab lists every transcript on the host, newest first: `{ offset?, limit? (30, ≤100) }` → `data: { total, offset, limit, sessions: [{ id, title, firstPrompt, lastPrompt, lastPromptAt, lastActivity, cwd, folder, messages, userMessages, sizeBytes, live, status, origin: 'server' | 'rc' | 'tmux' | 'terminal' | '', remoteControl, link, tmuxSession, canDisconnect }] }`. `title` is a given name, else the transcript's custom / AI title, else its first prompt; `messages` counts typed prompts + replies (tool results are not messages); counts are cached per file and a growing transcript is read on from where the last scan stopped. Live = a running `claude` (`~/.claude/sessions/<pid>.json`, pid alive); `link` = `https://claude.ai/code/<bridgeSessionId>` when it is in Remote Control.

| `action` | Does |
|---|---|
| `reconnect` `{ id }` | Already in Remote Control: `{ state: 'live', link }`, nothing started. Running without it: refused (type `/remote-control` there). Else `claude --resume <id> --remote-control <title> --permission-mode <unit's mode>; sleep 3600` (no fork) in the transcript's folder as tmux `rc-<id8>` on the own socket, then waits up to 60 s for */remote-control is active* and reads the claude.ai/code link back: `{ state: 'connected' \| 'started' \| 'failed', link, tmuxSession, message }` |
| `disconnect` `{ id }` | Kills its `rc-*` tmux session (own socket first, else an `rc-*` session started by hand on the default socket). Remote Control's own children end only with the server. The conversation is kept |

Answer: `{ result, ...the list }`. A read-only instance refuses both.

Test: `npm run test:claude-accounts` (sandboxed home, store, sessions, transcripts and a fake systemctl / tmux; never touches the host's Remote Control). A dev or preview instance sets `DREAMSCAPE_CLAUDE_RC_READONLY=1` so it can show the unit but never stop or start it.

---

<a id="claude-accounts-desktop"></a>
### Claude Accounts on the desktop (sessions, steering, coordination)

**Claude Accounts** (`apps/claudedesk`, a system package: Start > Administrative Tools, Control Panel > Administrative Tools) is an MMC console (`mmcConsole.js`) over the same accounts and host as the phone, plus every Claude session on the host and the agents' coordination. It uses the packets above for accounts, Remote Control and Add Account, and these (handler `modules/ws/handlers/314-claudeDeskHandler.js`, owner `claudeDesk`; admin only; `claude_desk_session` and `claude_desk_coord` are destructive):

| Request type | Fields | Answer `data` |
|---|---|---|
| `claude_desk_sessions` | `offset`, `limit` (max 100) | `claudeSessions.listAll` (`{ total, offset, limit, sessions }`, the phone's Sessions list) with `account: { index, name } \| null` (from the transcript's last `session-owner` line, or the launch record), `agentId`, `task` per row |
| `claude_desk_transcript` | `id`, `before?` (byte offset), `limit?` (80) or `since` | `{ id, messages, start, end, more }` (`modules/claudeTranscript.js`): newest last; `start` is passed as `before` for earlier ones. A message is `{ at, uuid, time, role: user \| assistant \| tool \| system, kind: text \| tool_use \| tool_result \| command \| notice, text, tool?, error?, origin?, sidechain }`; thinking, attachments and wrappers are left out, texts capped, anything token-shaped masked |
| `claude_desk_watch` / `claude_desk_unwatch` | `id`, `from?` | One transcript per socket: its new messages are pushed to that socket as `claude_desk_transcript_append { id, messages, end }` (fs.watch, 400 ms debounce) |
| `claude_desk_session` | `action`: `start` (`cwd`, `prompt?`, `title?`, `account?`, `mode?`), `resume` (`id`, `account?`, `mode?`), `steer` (`id`, `text`), `interrupt` (`id`), `screen` (`id`), `disconnect` (`id`) | `{ result }`: start / resume answer `{ id, state: connected \| live \| started \| failed, link, tmuxSession, account, message }` |
| `claude_desk_coord` | `action`: `list` (`limit?`, `agentId?`), `post` (`to`, `body`, `kind`), `release` (`claimId`) | `{ agents, claims, lastMessageId, messages }`, `{ sent }`, or the lists after a release |

**Launching** (`modules/claudeSessionLauncher.js`, sharing `modules/claudeSessions.js` with the phone's Sessions tab: same tmux socket, same `rc-<id8>` names). A session is `claude --session-id <new uuid>` (start) or `--resume <uuid>` (resume, never `--fork-session`) with `--remote-control <title> --permission-mode <mode>` (default `bypassPermissions`) and `--mcp-config ~/.local/state/dreamscape-agents/launch-mcp.json` (the agent-coord server), then `; sleep 3600`, in a detached tmux session on the socket `dreamscape-claude-carry`. That tmux server is started by `systemd-run --user --scope` with `exit-empty off` (`ensureServer`, also at server start), so it lives in its own user scope: not a child of Dreamscape, not in `pm2-kanmi.service`'s or `claude-remote.service`'s cgroup, and a Dreamscape / pm2 / Remote Control restart leaves the sessions running. `env -u` keeps `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` out of a session. **Steering** types into the session's own tmux pane (found from its `~/.claude/sessions/<pid>.json` pid on either socket): one line with `send-keys -l`, several as a bracketed paste, then Enter; Claude Code takes it as the next prompt, or as steering for the turn it is working on. `interrupt` sends Esc. A session inside Remote Control's own process (`claude-rc`) cannot be typed into: steer it from claude.ai/code.

**Two accounts at once** (`modules/claudeAccountRuntime.js`). The account on the host runs on `~/.claude`. Any other account with a linked login runs with `CLAUDE_CONFIG_DIR=.cache/secrets/claude-accounts/<id>/config` (0700): its `.credentials.json` (0600, the fresher of the linked login and the copy there), a `.claude.json` with onboarding done, its `oauthAccount` and the host's per-project trust / allowed tools / MCP servers, and symlinks to `~/.claude/{projects,sessions,settings.json,CLAUDE.md,skills,plugins,agents,commands}`: one set of transcripts and live records for the host, so both accounts' sessions list as one. The CLI rotates the refresh token as it runs: a newer login written into a config dir is copied back into the account's linked login (fs.watch on the config dir, and at server start), so a switch that puts the account on the host signs in with the current token. Do not switch the host to an account whose own sessions run for long: its login would then be held twice (the console warns).

**Status feeds** (`status_subscribe`, statusHub; subscribed while the window is open): `claude_desk` (30 s, and at once when `~/.claude/sessions` changes or an action ran) `{ host, accounts, live, coord }` pushed as `claude_desk_status`; `claude_desk_flux` (2 s, memory only) `{ rc, login }` pushed as `claude_desk_flux` (Remote Control's reconnect and the sign-in move fast; their own pushes are phone-only). Both go only to the subscribed socket.

<a id="agent-coord"></a>
**Coordination: the agent-coord MCP server** (`modules/agentCoord/mcpServer.js`, stdio, no dependencies besides `better-sqlite3`; store `modules/agentCoord/store.js`, one WAL SQLite file for the host at `~/.local/state/dreamscape-agents/coord.db`, `AGENT_COORD_DB` overrides). Every session launched here gets it. Tools: `coord_hello`, `coord_agents`, `coord_set_task`, `coord_claim` (paths relative to the repo, folders and globs; exclusive by default, `shared` with other shared claims; 45 min lease, max 8 h; a conflicting path is not granted and the answer names its holder and task), `coord_release`, `coord_check`, `coord_claims`, `coord_post` (to an agent id / name or `all`; `steer` also types it into a Claude session's tmux pane), `coord_inbox`. Every answer ends with the caller's unread count. A Claude session is identified from the process tree (`~/.claude/sessions/<pid>.json`: `claude-<first 8 of the session id>`); claims are per repo (named by the git common dir, so worktrees share them) and lapse when released, when the lease ends, or when the agent's process is gone. Any other MCP client joins with:

```json
{ "mcpServers": { "agent-coord": { "command": "node", "args": ["/home/kanmi/staticforge/modules/agentCoord/mcpServer.js"],
  "env": { "AGENT_COORD_KIND": "cursor", "AGENT_COORD_NAME": "Cursor - <task>", "AGENT_COORD_ID": "cursor-<name>" } } } }
```

Test: `node scripts/test-claude-desk.js` (temp home, account store, coordination DB and a fake tmux / systemd-run; never touches a real account folder, login, tmux server or session).

### `get_account_pictures` / `set_account_picture`

Account pictures for Melaton's two accounts (`modules/accountPictures.js`): Administrator (the admin
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

Every account row also carries `name`: the account's name (`config.json` `accountNames`, else
Vista's built-in `Administrator` / `Guest`).

```json
{ "type": "set_account_name", "account": "administrator", "name": "Yukimi" }
{ "type": "set_account_name_response", "data": { "success": true, "accounts": { "administrator": { "picture": "fireworks", "url": "...", "name": "Yukimi" }, ... } } }
```

`set_account_name` is admin only. The name is trimmed, 1-20 characters, none of
`" / \ [ ] : ; | = , + * ? < > @`, and not the other account's name (`BAD_NAME`, `NAME_TAKEN`).
The built-in name again removes the stored one. The server pushes `account_pictures_changed`
afterwards. `/status` carries `logonName` (the Administrator's name) for the Welcome screen.

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
