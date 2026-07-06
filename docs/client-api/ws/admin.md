# WebSocket: Admin / Security Center

Server handlers: `modules/ws/handlers/190-adminHandler.js` (Security Center, IP, rate-limit, Service Key packets) and `modules/ws/handlers/195-applicationAuthHandler.js` (application-key authorization packets)

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `add_api_key` | `add_api_key_response` | admin/destructive | Handler: handleAddApiKey |
| `approve_application_auth_request` | `approve_application_auth_request_response` | session | Handler: handleApproveApplicationAuthRequest |
| `authenticate_application` | `authenticate_application_response` | critical | Handler: handleAuthenticateApplication |
| `cancel_pending_requests` | `cancel_pending_requests_response` | admin/destructive | Handler: handleCancelPendingRequests |
| `cancel_session_pending_requests` | `cancel_session_pending_requests_response` | admin/destructive | Handler: handleCancelSessionPendingRequests |
| `check_application_authorization` | `check_application_authorization_response` | critical | Handler: handleCheckApplicationAuthorization |
| `claim_application_authorization` | `claim_application_authorization_response` | critical | Handler: handleClaimApplicationAuthorization |
| `clear_known_bad_paths` | `clear_known_bad_paths_response` | admin/destructive | Handler: handleClearKnownBadPaths |
| `create_application_key` | `create_application_key_response` | session | Handler: handleCreateApplicationKey |
| `delete_known_bad_path` | `delete_known_bad_path_response` | admin/destructive | Handler: handleDeleteKnownBadPath |
| `deny_application_auth_request` | `deny_application_auth_request_response` | session | Handler: handleDenyApplicationAuthRequest |
| `export_ip_to_gateway` | `export_ip_to_gateway_response` | admin/destructive | Handler: handleExportIPToGateway |
| `get_api_key_services` | `get_api_key_services_response` | admin/destructive | Handler: handleGetApiKeyServices |
| `get_application_auth_scopes` | `get_application_auth_scopes_response` | session | Handler: handleGetApplicationAuthScopes |
| `get_blocked_ips` | `get_blocked_ips_response` | session | Handler: handleGetBlockedIPs |
| `get_ip_blocking_reasons` | `get_ip_blocking_reasons_response` | session | Handler: handleGetIPBlockingReasons |
| `get_known_bad_paths` | `get_known_bad_paths_response` | session | Handler: handleGetKnownBadPaths |
| `get_pin_settings` | `get_pin_settings_response` | session | Handler: handleGetPinSettings |
| `get_rate_limiting_stats` | `rate_limiting_stats_response` | session | Handler: handleGetRateLimitingStats |
| `get_session_rate_limiting_stats` | `session_rate_limiting_stats_response` | session | Handler: handleGetSessionRateLimitingStats |
| `get_telemetry` | `get_telemetry_response` | session | Handler: handleGetTelemetry |
| `list_application_auth_requests` | `list_application_auth_requests_response` | session | Handler: handleListApplicationAuthRequests |
| `list_application_keys` | `list_application_keys_response` | session | Handler: handleListApplicationKeys |
| `refresh_application_key` | `refresh_application_key_response` | critical | Handler: handleRefreshApplicationKey |
| `request_application_authorization` | `request_application_authorization_response` | critical | Handler: handleRequestApplicationAuthorization |
| `request_temp_access_token` | `temp_access_token_response` | critical | Handler: handleRequestTempAccessToken |
| `revoke_application_key` | `revoke_application_key_response` | session | Handler: handleRevokeApplicationKey |
| `set_admin_pin` | `set_admin_pin_response` | admin/destructive | Handler: handleSetAdminPin |
| `set_user_pin` | `set_user_pin_response` | admin/destructive | Handler: handleSetUserPin |
| `set_user_pin_login_enabled` | `set_user_pin_login_enabled_response` | admin/destructive | Handler: handleSetUserPinLoginEnabled |
| `unblock_ip` | `unblock_ip_response` | admin/destructive | Handler: handleUnblockIP |
| `unlock_api_service` | `unlock_api_service_response` | admin/destructive | Handler: handleUnlockApiService |
| `update_api_key` | `update_api_key_response` | admin/destructive | Handler: handleUpdateApiKey |
| `update_api_key_selections` | `update_api_key_selections_response` | admin/destructive | Handler: handleUpdateApiKeySelections |

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

Packets marked destructive in `modules/websocketHandlers.js` → `isDestructiveOperation()` return `READONLY_RESTRICTED` for `userType: "readonly"` sessions.

---

## Detailed packets

### `add_api_key`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleAddApiKey`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `service` | Required |
| `name` | Required |
| `apiKey` | Optional |

**Validation errors:**
- Service ID is required
- Service Key Name is required
- Service Key or Contract ID is required

**Success response:** `add_api_key_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `approve_application_auth_request`

**Auth:** Session required

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleApproveApplicationAuthRequest`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Validation errors:**
- requestId is required

**Success response:** `approve_application_auth_request_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `authenticate_application`

**Auth:** Critical (no session required)

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleAuthenticateApplication`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `applicationKey` | Optional |
| `userAgent` | Optional |
| `clientUserAgent` | Optional |

**Validation errors:**
- applicationKey is required
- userAgent is required

**Success response:** `authenticate_application_response`

Additional response/push types from handler:
- `auth_error`
- `application_authenticated`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `cancel_pending_requests`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleCancelPendingRequests`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `cancel_pending_requests_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `cancel_session_pending_requests`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleCancelSessionPendingRequests`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `model` | Optional |

**Success response:** `cancel_session_pending_requests_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `check_application_authorization`

**Auth:** Critical (no session required)

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleCheckApplicationAuthorization`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `userAgent` | Optional |
| `clientUserAgent` | Optional |

**Validation errors:**
- requestId is required
- userAgent is required

**Success response:** `check_application_authorization_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `claim_application_authorization`

**Auth:** Critical (no session required)

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleClaimApplicationAuthorization`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `userAgent` | Optional |
| `clientUserAgent` | Optional |

**Validation errors:**
- requestId is required
- userAgent is required

**Success response:** `claim_application_authorization_response`

Additional response/push types from handler:
- `auth_error`
- `application_authorization_claimed`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `clear_known_bad_paths`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleClearKnownBadPaths`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `clear_known_bad_paths_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `create_application_key`

**Auth:** Session required

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleCreateApplicationKey`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `appName` | Optional |
| `userAgent` | Optional |
| `scopes` | Optional |
| `userType` | Optional |
| `perpetual` | Optional |
| `expiresInDays` | Optional |
| `refreshIntervalDays` | Optional |

**Validation errors:**
- appName and userAgent are required

**Success response:** `create_application_key_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_known_bad_path`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleDeleteKnownBadPath`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `path` | Required |

**Validation errors:**
- Path is required

**Success response:** `delete_known_bad_path_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `deny_application_auth_request`

**Auth:** Session required

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleDenyApplicationAuthRequest`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Validation errors:**
- requestId is required

**Success response:** `deny_application_auth_request_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `export_ip_to_gateway`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleExportIPToGateway`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `ip` | Required |

**Validation errors:**
- IP address is required

**Success response:** `export_ip_to_gateway_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_api_key_services`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleGetApiKeyServices`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_api_key_services_response`

`data.services[]` comes from `modules/apiKeyManager.js` → `listServiceSummaries()`:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Service id, e.g. `novelai` or `grok` |
| `label` / `description` / `icon` | string | Security Center display metadata |
| `requiresRestart` | boolean | `true` when changing the selected key restarts/reconnects service clients |
| `selectedIndex` | number | Active key index in the service key list |
| `selectedName` / `selectedFingerprint` | string\|null | Active key display label and masked secret |
| `missingKeys` | boolean | `true` when no key exists for the service |
| `keys[]` | array | `{ index, name, fingerprint }` for each configured key |
| `lock` | object\|null | Tripwire state for services that support locking |

`lock` is `null` for services without a tripwire. For `novelai` and `grok`:

| Field | Type | Notes |
|-------|------|-------|
| `service` | string | Service id |
| `locked` | boolean | Outbound guarded calls fast-fail while true |
| `failureCount` | number | Consecutive qualifying API failures |
| `threshold` | number | Lock threshold (`3`) |
| `lastStatus` | number\|null | Last counted HTTP status |
| `lastMessage` | string\|null | Last counted error text |
| `lockedAt` / `updatedAt` | number\|null | Millisecond timestamps |

Tripwire behavior:

- Only `novelai` and `grok` are tripwire services.
- Consecutive HTTP `400`, `401`, `402`, and `403` failures count. Network errors, `429`, and `5xx` do not lock the service.
- A successful guarded call resets `failureCount`.
- Updating the active key or changing the selected key clears that service lock.

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_application_auth_scopes`

**Auth:** Session required

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleGetApplicationAuthScopes`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_application_auth_scopes_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_blocked_ips`

**Auth:** Session required

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleGetBlockedIPs`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `page` | Optional |
| `limit` | Optional |

**Success response:** `get_blocked_ips_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_ip_blocking_reasons`

**Auth:** Session required

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleGetIPBlockingReasons`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `ip` | Required |

**Validation errors:**
- IP address is required

**Success response:** `get_ip_blocking_reasons_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_known_bad_paths`

**Auth:** Session required

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleGetKnownBadPaths`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `page` | Optional |
| `limit` | Optional |
| `search` | Optional |

**Success response:** `get_known_bad_paths_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_pin_settings`

**Auth:** Session required

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleGetPinSettings`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_pin_settings_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_rate_limiting_stats`

**Auth:** Session required

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleGetRateLimitingStats`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `rate_limiting_stats_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_session_rate_limiting_stats`

**Auth:** Session required

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleGetSessionRateLimitingStats`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `model` | Optional |

**Success response:** `session_rate_limiting_stats_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_telemetry`

**Auth:** Session required. Admin only

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleGetTelemetry`

Lists captured telemetry events for Security Center diagnostics.

**Request fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `requestId` | No | Correlation id |
| `page` | No | Page number, default `1` |
| `limit` | No | Page size, default `15` |
| `search` | No | Text filter |
| `eventType` | No | Event type filter |

**Success response:** `get_telemetry_response`

Returns `data: { success: true, events, pagination }`.

**Errors:** `type: "error"` via `sendError()`; `get_telemetry` detail when the telemetry database is unavailable.

### `list_application_auth_requests`

**Auth:** Session required

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleListApplicationAuthRequests`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `status` | Optional |

**Success response:** `list_application_auth_requests_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `list_application_keys`

**Auth:** Session required

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleListApplicationKeys`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `list_application_keys_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `refresh_application_key`

**Auth:** Critical (no session required)

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleRefreshApplicationKey`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `applicationKey` | Optional |
| `userAgent` | Optional |
| `clientUserAgent` | Optional |

**Validation errors:**
- applicationKey is required
- userAgent is required

**Success response:** `refresh_application_key_response`

Additional response/push types from handler:
- `auth_error`
- `application_key_refreshed`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `request_application_authorization`

**Auth:** Critical (no session required)

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleRequestApplicationAuthorization`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `appName` | Optional |
| `userAgent` | Optional |
| `scopes` | Optional |
| `userType` | Optional |
| `expiresAt` | Optional |
| `refreshIntervalDays` | Optional |

**Validation errors:**
- appName and userAgent are required

**Success response:** `request_application_authorization_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `request_temp_access_token`

**Auth:** Critical (no session required)

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleRequestTempAccessToken`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `applicationKey` | Optional |
| `userAgent` | Optional |
| `maxUses` | Optional |
| `ttlSeconds` | Optional |
| `scopes` | Optional |
| `clientUserAgent` | Optional |

**Validation errors:**
- applicationKey is required
- userAgent is required

**Success response:** `temp_access_token_response`

Additional response/push types from handler:
- `auth_error`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `revoke_application_key`

**Auth:** Session required

**Handler:** modules/ws/handlers/195-applicationAuthHandler.js → `handleRevokeApplicationKey`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `keyId` | Optional |

**Validation errors:**
- keyId is required

**Success response:** `revoke_application_key_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `set_admin_pin`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleSetAdminPin`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `pin` | Required |

**Validation errors:**
- Admin PIN is required

**Success response:** `set_admin_pin_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `set_user_pin`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleSetUserPin`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `pin` | Required |

**Validation errors:**
- User PIN is required

**Success response:** `set_user_pin_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `set_user_pin_login_enabled`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleSetUserPinLoginEnabled`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `enabled` | Optional |

**Success response:** `set_user_pin_login_enabled_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `unblock_ip`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleUnblockIP`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `ip` | Required |

**Validation errors:**
- IP address is required

**Success response:** `unblock_ip_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `unlock_api_service`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleUnlockApiService`

Clears a Service Key tripwire lock without changing the key. Use after verifying the configured key/contract is valid.

**Request fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `requestId` | No | Correlation id |
| `service` | Yes | Tripwire service id (`novelai` or `grok`) |

**Validation errors:**
- `MISSING_SERVICE`
- `UNSUPPORTED_SERVICE`

**Success response:** `unlock_api_service_response`

```json
{
  "type": "unlock_api_service_response",
  "requestId": "req_1",
  "data": {
    "success": true,
    "service": "novelai",
    "lock": {
      "service": "novelai",
      "locked": false,
      "failureCount": 0,
      "threshold": 3,
      "lastStatus": null,
      "lastMessage": null,
      "lockedAt": null,
      "updatedAt": 1719491234567
    }
  },
  "timestamp": "..."
}
```

**Push side effects:** `api_service_lock_changed` is broadcast to admin clients when the locked state changes.

### `update_api_key`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleUpdateApiKey`

Updates a Service Key label and/or secret at an existing index. If the edited key is selected, the service tripwire is cleared.

**Request fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `requestId` | No | Correlation id |
| `service` | Yes | Service id |
| `index` | Yes | Existing key index |
| `name` | No | Replacement display name |
| `apiKey` | No | Replacement API key / contract id |

**Validation errors:**
- `MISSING_SERVICE`

**Success response:** `update_api_key_response`

Returns `data: { success: true, service, key }`, where `key` is the updated masked key summary.

### `update_api_key_selections`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/190-adminHandler.js → `handleUpdateApiKeySelections`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `updates` | Optional |

**Success response:** `update_api_key_selections_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

