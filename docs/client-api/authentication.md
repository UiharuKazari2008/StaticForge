# Authentication

StaticForge supports **session-based authentication** (express-session + cookie store) and **application keys** for third-party clients (Discord-style client-to-account access). There is **no passkey/WebAuthn** flow. PIN codes are compared server-side against values in `config.json`.

## Session cookie

| Property | Value |
|----------|-------|
| Cookie name | `connect.sid` (default express-session) |
| `httpOnly` | `true` |
| `secure` | `true` when `NODE_ENV === 'production'` |
| `sameSite` | `strict` |
| `maxAge` | 7 days |

Clients must persist and replay this cookie on all authenticated HTTP requests and on the WebSocket upgrade.

---

## Application keys (third-party clients)

Application keys let desktop tools, scripts, and integrations authenticate **without** a browser cookie jar. Keys are **User-Agent locked**, **scope limited**, and support **periodic refresh** without extending the original expiration.

### Key properties

| Property | Description |
|----------|-------------|
| Format | `sfapp_` + base64url secret (shown once at creation/claim) |
| Expiration | Optional (`expiresAt`); `null` = perpetual |
| Refresh deadline | `refreshBeforeAt` — client must call `refresh_application_key` before this date |
| Refresh behavior | Issues a **new** key and invalidates the old one; **does not** extend `originalExpiresAt` |
| After expiration | Client must re-authorize (admin approval or Security Center) |
| Scope | Feature scopes (e.g. `gallery`, `generation`) or `universal` |
| User-Agent | Exact string declared at registration; validated on every REST/WS use |
| User type | `admin` or `readonly` (same destructive restrictions as PIN sessions) |

### REST authentication

**Preferred headers:**

| Header | Use |
|--------|-----|
| `X-StaticForge-App-Key` | Application key |
| `X-StaticForge-App-Token` | Temporary access token (no UA check) |
| `User-Agent` | Must match registered UA when using application key |

**Bearer alternative:** `Authorization: Bearer sfapp_…` or `Bearer sftok_…` (application/temp tokens only — legacy `loginKey` uses plain Bearer without `sfapp_` prefix).

**Example:**

```http
GET /images/example.png HTTP/1.1
Host: localhost:9220
X-StaticForge-App-Key: sfapp_xxxxxxxx
User-Agent: MyApp/1.0 (StaticForge)
```

**Errors:**

| Status | Code | Meaning |
|--------|------|---------|
| 401 | — | No credentials |
| 403 | `INVALID_KEY` | Unknown/revoked key |
| 403 | `USER_AGENT_MISMATCH` | UA does not match registration |
| 403 | `KEY_EXPIRED` | Past `expiresAt` — re-authorize |
| 403 | `REFRESH_REQUIRED` | Past `refreshBeforeAt` — refresh key first |
| 403 | `INVALID_TOKEN` | Bad/expired temp token |

### WebSocket authentication (required for applications)

Applications **must** use WebSocket as their primary API transport.

1. Open WebSocket to `ws://host:9220/` (no session cookie required initially).
2. Send **`authenticate_application`** with the application key and declared User-Agent.
3. On success, receive **`application_authenticated`** with `userType`, `scopes`, `expiresAt`, `refreshBeforeAt`, `vfsPathUuid`.
4. Use normal WS packets; scope-limited keys receive `INSUFFICIENT_SCOPE` for out-of-scope packets.

**Authenticate request:**

```json
{
  "type": "authenticate_application",
  "requestId": "req_1",
  "applicationKey": "sfapp_…",
  "userAgent": "MyApp/1.0 (StaticForge)"
}
```

**Success:**

```json
{
  "type": "application_authenticated",
  "requestId": "req_1",
  "data": {
    "success": true,
    "userType": "admin",
    "scopes": ["gallery", "generation"],
    "expiresAt": null,
    "refreshBeforeAt": 1750000000000,
    "originalExpiresAt": null,
    "vfsPathUuid": "<uuid>"
  }
}
```

**Failure:** `auth_error` with `code`: `INVALID_KEY`, `USER_AGENT_MISMATCH`, `KEY_EXPIRED`, `REFRESH_REQUIRED`.

### Refresh flow

Before `refreshBeforeAt`:

```json
{
  "type": "refresh_application_key",
  "requestId": "req_2",
  "applicationKey": "sfapp_…",
  "userAgent": "MyApp/1.0 (StaticForge)"
}
```

**Success:** `application_key_refreshed` with new `applicationKey` in `data` — replace stored key immediately.

If `expiresAt` has passed, refresh fails with `KEY_EXPIRED`; user must re-authorize via Security Center.

### Authorization request flow (Discord-style)

1. App (unauthenticated WS) sends **`request_application_authorization`** with `appName`, `userAgent`, `scopes`, optional `expiresAt`, `refreshIntervalDays`.
2. Server returns `application_authorization_requested` with `requestId` and human **`requestCode`** (6 hex chars).
3. Administrator approves in **Security Center → Application Keys** (or WS `approve_application_auth_request`).
4. App polls **`check_application_authorization`** until `status: "approved"`.
5. App sends **`claim_application_authorization`** once to retrieve `applicationKey` (single claim).
6. App calls **`authenticate_application`** and proceeds.

### Temporary access tokens

For wget, browser image open, or other contexts where the app cannot set its registered User-Agent:

```json
{
  "type": "request_temp_access_token",
  "requestId": "req_3",
  "applicationKey": "sfapp_…",
  "userAgent": "MyApp/1.0 (StaticForge)",
  "maxUses": 1,
  "ttlSeconds": 300,
  "scopes": ["gallery"]
}
```

**Response:** `temp_access_token_response` with `token` (`sftok_…`).

Use on REST only via `X-StaticForge-App-Token: sftok_…` (no UA check). Tokens inherit parent key expiration and scope limits.

### Available scopes

| Scope | Access |
|-------|--------|
| `universal` | All WS packets (subject to user type) |
| `gallery` | Gallery list/metadata/bulk ops |
| `generation` | Generate, upscale, expand, dynamic generation |
| `workspace` | Workspace CRUD, desktop shortcuts |
| `search` | Tag/file search, index admin |
| `vfs` | Virtual file system packets |
| `presets` | Preset/spellbook management |
| `chat` | Director/persona chat |
| `references` | References and vibes |
| `wiki` | Tag wiki / Grimoire |
| `infrastructure` | ping, status, version |

List via WS `get_application_auth_scopes` (admin).

### Admin management (Security Center / WS)

| Packet | Auth | Description |
|--------|------|-------------|
| `list_application_keys` | admin | All keys (active, expired, revoked, replaced) |
| `create_application_key` | admin | Issue key directly |
| `revoke_application_key` | admin | Revoke by `keyId` |
| `list_application_auth_requests` | admin | Pending authorization requests |
| `approve_application_auth_request` | admin | Approve pending request |
| `deny_application_auth_request` | admin | Deny pending request |
| `get_application_auth_scopes` | admin | Scope catalog |

Security Center DSAP: `security.dyna.dreamscape.jp/appkeys` tab.

### Critical WS packets (no prior auth)

These work on an unauthenticated WebSocket connection:

`ping`, `pong`, `server_status`, `check_updates`, `refresh_server_cache`, `version_check`, `authenticate_application`, `refresh_application_key`, `request_application_authorization`, `check_application_authorization`, `claim_application_authorization`, `request_temp_access_token`

---

## Login flow (web / PIN)

### 1. POST `/` — action `login`

**Auth required:** No  
**Content-Type:** `application/json`  
**Middleware:** `serverReadinessMiddleware` (503 if runtime compile incomplete)

**Request body:**

```json
{
  "action": "login",
  "data": {
    "pin": "123456"
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `action` | Yes | Must be `"login"` |
| `data.pin` | Yes | Admin PIN (`config.loginPin`) or read-only PIN (`config.readOnlyPin`) |

**Success (200):**

Admin PIN:

```json
{
  "success": true,
  "message": "Login successful",
  "userType": "admin",
  "logViewerPathUuid": "<uuid>",
  "vfsPathUuid": "<uuid>"
}
```

Read-only PIN:

```json
{
  "success": true,
  "message": "Login successful",
  "userType": "readonly",
  "vfsPathUuid": "<uuid>"
}
```

**Client state after success:**

- Store session cookie (mandatory)
- Optionally mirror to localStorage (web app pattern): `userType`, `logViewerPathUuid` (admin), `vfsPathUuid`, `loginTimestamp`
- Proceed to WebSocket connect or `OPTIONS /app`

**Errors:**

| Status | Body | Meaning |
|--------|------|---------|
| 400 | `{ "error": "PIN code is required" }` | Missing pin |
| 401 | `{ "success": false, "error": "Invalid PIN code" }` | Wrong PIN |
| 403 | `{ "success": false, "error": "User PIN login is disabled...", "code": "USER_PIN_DISABLED" }` | Read-only login disabled |
| 403 | `{ "success": false, "error": "Too many failed login attempts...", "code": "IP_BLOCKED" }` | 3+ failures from public IP |
| 503 | Runtime compile payload | Server not ready |

Failed attempts from **non-private IPs** are tracked; private IP failures are logged but not counted toward block.

### 2. OPTIONS `/app` — session validation

**Auth required:** Yes (`authMiddleware` — session, application key, temp token, or legacy Bearer)

**Success (200):**

```json
{
  "success": true,
  "message": "Session Valid",
  "timestamp": 1234567890123,
  "serverVersion": "1.0.2",
  "versionMessage": "A new version is available...",
  "userType": "admin",
  "vfsPathUuid": "<uuid>",
  "logViewerPathUuid": "<uuid>"
}
```

Admin-only fields omitted for read-only users.

**Errors:**

| Status | Body |
|--------|------|
| 401 | `{ "error": "Authentication required" }` |
| 403 | `{ "error": "Invalid authentication token" }` (bad Bearer/loginKey) |

**Follow-up:** Custom clients should call this on startup and periodically; on 401, re-prompt for PIN or refresh application key.

### 3. POST `/` — action `ping`

Used by login page and service worker for session probe + telemetry.

**Request (optional telemetry in `data`):**

```json
{
  "action": "ping",
  "data": {
    "userAgent": "...",
    "platform": "...",
    "screen": {},
    "timezone": "...",
    "cookieEnabled": true,
    "onLine": true
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Pong",
  "authenticated": true,
  "userType": "admin",
  "redirect": "/app",
  "vfsPathUuid": "<uuid>",
  "logViewerPathUuid": "<uuid>"
}
```

When unauthenticated: `authenticated: false`, `redirect: null`.

## Logout

### POST `/` — action `logout`

**Auth required:** Session cookie (destroyed even if expired)

**Request:**

```json
{ "action": "logout" }
```

**Success (200):**

```json
{ "success": true, "message": "Logged out successfully" }
```

Server clears `connect.sid` cookie. Client should disconnect WebSocket and clear cached auth state.

## Legacy Bearer / query token (loginKey)

When `config.loginKey` is set (non-null), `authMiddleware` accepts:

- Header: `Authorization: Bearer <loginKey>`
- Query: `?auth=<loginKey>`

On match:

- `req.userType = 'admin'`
- Session marked authenticated if present

Useful for headless clients without cookie jars. When `loginKey` is **null**, middleware skips token check and only session auth applies.

**Note:** Do not pass `sfapp_` / `sftok_` tokens as legacy Bearer on routes expecting `loginKey` — use application headers instead.

**Errors:** 403 `{ "error": "Invalid authentication token" }`

## WebSocket authentication (browser session)

WebSocket shares the HTTP server. On connect, server parses session from the upgrade request cookie (`modules/websocket.js` → `extractSession`).

| State | Behavior |
|-------|----------|
| Authenticated session | Full WS API; welcome `connection` message includes `userType`, `vfsPathUuid`, optional `logViewerPathUuid` |
| Application key (post-`authenticate_application`) | Full WS API within scopes |
| No session / key | Connection allowed; only `CRITICAL_MESSAGE_TYPES` processed |
| Unauthenticated request | `auth_error` with `code: "AUTH_REQUIRED"` |

**Critical message types (no auth):** See [Application keys](#application-keys-third-party-clients) above.

After login via HTTP, **reconnect WebSocket** (or connect for first time) so upgrade carries the new cookie.

## Read-only vs admin on WebSocket

Read-only sessions receive for destructive packets:

```json
{
  "type": "error",
  "message": "Non-Administrator Login: This operation is not allowed for read-only users",
  "code": "READONLY_RESTRICTED",
  "timestamp": "..."
}
```

Destructive list: `modules/websocketHandlers.js` → `isDestructiveOperation()`.

Application keys with `userType: readonly` follow the same rules.

## Rate limiting (unauthenticated HTTP)

| Middleware | Scope | Notes |
|------------|-------|-------|
| `limiter` | All routes | Skipped for authenticated sessions and application credentials |
| `speedLimiter` | All routes | Skipped for authenticated sessions and application credentials |

Unauthenticated clients hitting rate limit receive **429**:

```json
{
  "success": false,
  "error": "Too many requests",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": <seconds>
}
```

## Security headers on auth routes

`authMiddleware` sets aggressive no-cache headers on protected responses.

## Development auth

`createDevAuthMiddleware` in `modules/auth.js` requires the request's direct TCP
peer (`req.socket.remoteAddress`) to be loopback, requires `enable_dev` to be
true, and validates `devLoginKey` from secure config on every request. It accepts
`Authorization: Bearer …` or `?auth=` matching the development key. Existing
admin and `dev_admin` sessions do not bypass the key check.

`GET /agent` and `POST /agent/broadcast` mount this middleware for loopback
requests only. Successful `GET /agent` auth persists the `dev_admin` session and
returns a bootstrap page that unregisters workers, preloads app-shell CSS/JS,
then opens `/app?agent=1`. The preferred client sends the key in an
`Authorization` header and removes that header after the redirect; `?auth=` is a
fallback for browser tools that cannot set headers. Agent mode unregisters
existing service workers, clears Cache Storage, and skips service-worker
registration and startup cache downloads. `POST /agent/broadcast` uses the same
key-every-request gate and pushes `agent_notice` to all connected WebSocket
clients. A successful call may persist a `dev_admin` session as a side effect of
that middleware; the response is JSON, not a bootstrap page.

`GET /agent/assets.json` and `GET /agent/assets.zip` keep the loopback and
`enable_dev` gates but accept either the development key **or** an existing
`dev_admin` session. That session exception exists so the `/agent` bootstrap can
fetch the catalog without embedding the key in HTML. PIN `admin` sessions and
forwarded client-address headers still do not qualify.

The loopback gate ignores `X-Forwarded-For`, `X-Real-IP`, and other forwarded
headers. A remote peer cannot gain access by spoofing those headers or by using a
stolen development key. SSH local forwarding to server-side
`127.0.0.1:9220` remains supported because Dreamscape sees the tunnel's direct
peer as loopback; development mode and key validation still apply.

This path requires both `"enable_dev": true` in `config.json` and `devLoginKey`
in `secure.config.json`. Never place the development key in source, docs, or
committed configuration.

All authentication values (`devLoginKey`, `loginKey`, `loginPin`,
`readOnlyPin`, and `sessionSecret`) belong in gitignored `secure.config.json`.
Only the non-secret `enable_dev` and `userPinLoginEnabled` switches belong in
`config.json`. A missing development key returns
`DEV_LOGIN_KEY_NOT_CONFIGURED` without logging or returning key material.

## Client implementation checklist

### Web app (browser)

1. Cookie jar / WebView cookie sync for `connect.sid`
2. Login before WS (or handle `auth_error` → login → `forceReconnect`)
3. Store `vfsPathUuid` for VFS REST paths (`/{vfsPathUuid}/files/:fileId`)
4. Store `logViewerPathUuid` (admin) for log viewer REST
5. Send `userType` to UI to hide admin-only features
6. On logout: POST logout, close WS, clear local auth cache
7. Optional: `fetchWithAuth` pattern from `public/scripts/comp/connectionManager.js`

### Third-party application

1. **Always** connect WebSocket first
2. Send `authenticate_application` with key + fixed User-Agent
3. Store `refreshBeforeAt`; schedule `refresh_application_key` before deadline
4. On `KEY_EXPIRED`, run authorization flow again
5. REST: set `X-StaticForge-App-Key` + matching `User-Agent` on every request
6. For browser/wget downloads: `request_temp_access_token` → `X-StaticForge-App-Token`
7. Handle `INSUFFICIENT_SCOPE` and `READONLY_RESTRICTED`

## No CSRF token

The app does **not** use a separate CSRF token. Session cookie + sameSite strict is the primary CSRF mitigation. Cross-origin clients must handle cookies explicitly.

## Storage

Application keys are stored in SQLite: `.cache/databases/application_auth.db` (hashed at rest; plaintext shown once at create/claim/refresh).
