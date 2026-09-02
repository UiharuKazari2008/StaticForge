# WebSocket: Favorites

Server handler: `modules/ws/handlers/150-favoritesHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `favorites_add` | `favorites_add_response` | admin/destructive | Handler: handleAddFavorite |
| `favorites_get` | `favorites_get_response` | session | Handler: handleGetFavorites |
| `favorites_remove` | `favorites_remove_response` | admin/destructive | Handler: handleRemoveFavorite |

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

---

## Detailed packets

### `favorites_add`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/150-favoritesHandler.js → `handleAddFavorite`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `favoriteType` | Optional |
| `item` | Optional |
| `customName` | Optional |

**Success response:** `favorites_add_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `favorites_get`

**Auth:** Session required

**Handler:** modules/ws/handlers/150-favoritesHandler.js → `handleGetFavorites`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `favoriteType` | Optional |

**Success response:** `favorites_get_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `favorites_remove`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/150-favoritesHandler.js → `handleRemoveFavorite`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `favoriteType` | Optional |
| `itemId` | Optional |

**Success response:** `favorites_remove_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

