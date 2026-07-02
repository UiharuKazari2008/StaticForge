# WebSocket: Admin / Security Center

Server handler: `modules/ws/handlers/190-adminHandler.js`

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

