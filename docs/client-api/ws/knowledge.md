# WebSocket: Knowledge / Memories

Server handler: `modules/ws/handlers/220-knowledgeHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `count_knowledge_memories_by_filter` | `count_knowledge_memories_by_filter_response` | session | Handler: handleCountKnowledgeMemoriesByFilter |
| `delete_knowledge_memories_bulk` | `delete_knowledge_memories_bulk_response` | admin/destructive | Handler: handleDeleteKnowledgeMemoriesBulk |
| `delete_knowledge_memories_by_filter` | `delete_knowledge_memories_by_filter_response` | admin/destructive | Handler: handleDeleteKnowledgeMemoriesByFilter |
| `delete_knowledge_memory` | `delete_knowledge_memory_response` | admin/destructive | Handler: handleDeleteKnowledgeMemory |
| `get_knowledge_memory` | `get_knowledge_memory_response` | session | Handler: handleGetKnowledgeMemory |
| `list_knowledge_memories` | `list_knowledge_memories_response` | session | Handler: handleListKnowledgeMemories |
| `update_knowledge_memory` | `update_knowledge_memory_response` | admin/destructive | Handler: handleUpdateKnowledgeMemory |

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

### `count_knowledge_memories_by_filter`

**Auth:** Session required

**Handler:** modules/ws/handlers/220-knowledgeHandler.js → `handleCountKnowledgeMemoriesByFilter`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filterType` | Optional |

**Validation errors:**
- Filter type is required

**Success response:** `count_knowledge_memories_by_filter_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_knowledge_memories_bulk`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/220-knowledgeHandler.js → `handleDeleteKnowledgeMemoriesBulk`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `names` | Required |

**Validation errors:**
- Memory names array is required and must not be empty

**Success response:** `delete_knowledge_memories_bulk_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_knowledge_memories_by_filter`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/220-knowledgeHandler.js → `handleDeleteKnowledgeMemoriesByFilter`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filterType` | Optional |

**Validation errors:**
- Filter type is required

**Success response:** `delete_knowledge_memories_by_filter_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `delete_knowledge_memory`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/220-knowledgeHandler.js → `handleDeleteKnowledgeMemory`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `name` | Required |

**Validation errors:**
- Memory name is required

**Success response:** `delete_knowledge_memory_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `get_knowledge_memory`

**Auth:** Session required

**Handler:** modules/ws/handlers/220-knowledgeHandler.js → `handleGetKnowledgeMemory`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `name` | Required |

**Validation errors:**
- Memory name is required

**Success response:** `get_knowledge_memory_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `list_knowledge_memories`

**Auth:** Session required

**Handler:** modules/ws/handlers/220-knowledgeHandler.js → `handleListKnowledgeMemories`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `limit` | Optional |
| `offset` | Optional |
| `search` | Optional |
| `category` | Optional |
| `page` | Optional |
| `perPage` | Optional |

**Success response:** `list_knowledge_memories_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `update_knowledge_memory`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/220-knowledgeHandler.js → `handleUpdateKnowledgeMemory`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `name` | Required |
| `updates` | Required |

**Validation errors:**
- Memory name is required
- Updates object is required

**Success response:** `update_knowledge_memory_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

