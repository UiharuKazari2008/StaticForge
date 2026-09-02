# WebSocket: Character Database

Server handler: `modules/ws/handlers/235-characterDbHandler.js`

SQLite store: `.cache/characters.db` (import from `characters.json` via `scripts/import-characters-json.js`).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `character_db_delete` | `character_db_delete_response` | admin/destructive | Handler: handleCharacterDbDelete |
| `character_db_delete_copyright` | `character_db_delete_copyright_response` | admin/destructive | Handler: handleCharacterDbDeleteCopyright |
| `character_db_rename_copyright` | `character_db_rename_copyright_response` | admin/destructive | Handler: handleCharacterDbRenameCopyright |
| `character_db_upsert` | `character_db_upsert_response` | admin/destructive | Handler: handleCharacterDbUpsert |
| `get_character_db` | `get_character_db_response` | session | Handler: handleGetCharacterDb |

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

## Detailed packets

### `character_db_delete`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/235-characterDbHandler.js → `handleCharacterDbDelete`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `name` | Optional |

**Success response:** `character_db_delete_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `character_db_delete_copyright`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/235-characterDbHandler.js → `handleCharacterDbDeleteCopyright`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `copyright` | Optional |

**Success response:** `character_db_delete_copyright_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `character_db_rename_copyright`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/235-characterDbHandler.js → `handleCharacterDbRenameCopyright`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `oldCopyright` | Optional |
| `newCopyright` | Optional |

**Success response:** `character_db_rename_copyright_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `character_db_upsert`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/235-characterDbHandler.js → `handleCharacterDbUpsert`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `character` | Optional |
| `oldName` | Optional |

**Success response:** `character_db_upsert_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_character_db`

**Auth:** Session required

**Handler:** modules/ws/handlers/235-characterDbHandler.js → `handleGetCharacterDb`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_character_db_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

