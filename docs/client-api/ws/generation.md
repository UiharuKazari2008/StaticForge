# WebSocket: Generation & Image Operations

Server handler: `modules/ws/handlers/60-generationHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `apply_tendai_preview` | `apply_tendai_preview_response` | admin/destructive | Handler: handleApplyTendaiPreview |
| `cancel_generation` | `cancel_generation_response` | session | Handler: handleCancelGeneration |
| `compile_dynamic_generation` | `compile_dynamic_generation_response` | admin/destructive | Handler: handleCompileDynamicGeneration |
| `dynamic_generation_progress` | `dynamic_generation_progress_response` | session | Handler: handleDynamicGenerationProgress |
| `expand_image` | `image_expansion_response` | admin/destructive | Handler: handleImageExpansion |
| `generate_image` | `image_generation_response` | admin/destructive | Handler: handleImageGeneration |
| `preview_expand_image_prompt` | `expand_image_prompt_preview_response` | admin/destructive | Handler: handlePreviewExpandImagePrompt |
| `reroll_expanded_image` | `image_expansion_reroll_response` | admin/destructive | Handler: handleImageExpansionReroll |
| `reroll_image` | `image_reroll_response` | admin/destructive | Handler: handleImageReroll |
| `resolve_dynamic_context` | `resolve_dynamic_context_response` | session | Handler: handleResolveDynamicContext |
| `resolve_text_replacements` | `resolve_text_replacements_response` | admin/destructive | Handler: handleResolveTextReplacements |
| `upscale_image` | `image_upscaling_response` | admin/destructive | Handler: handleImageUpscaling |

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

All generation packets except `cancel_generation` and `dynamic_generation_progress` are **destructive** — blocked for `userType: "readonly"`.

Implementation: `modules/ws/handlers/generationImpl.js`

---

## Detailed packets

### `apply_tendai_preview`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleApplyTendaiPreview`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `apply_tendai_preview_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `cancel_generation`

**Auth:** Session required. **Not destructive** — allowed for `userType: "readonly"` (absent from `isDestructiveOperation()` list).

**Handler:** `modules/ws/handlers/generationImpl.js` → `handleCancelGeneration`

**Purpose:** Acknowledge client-side cancellation of in-flight generation(s). Server marks request IDs cancelled and stops keep-alive intervals; does not undo completed images.

**Request fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `requestId` | Yes | Correlation id for this cancel message |
| `cancelledRequestIds` | Yes* | `string[]` of generation `requestId` values to cancel. Also read from `message.data.cancelledRequestIds` if top-level omitted |

**Success:** `cancel_generation_response`

```json
{
  "type": "cancel_generation_response",
  "requestId": "...",
  "data": { "success": true, "message": "Generation cancellation acknowledged" },
  "timestamp": "..."
}
```

**Client:** `WebSocketClient` sends `{ cancelledRequestIds: [originalRequestId] }` when user aborts generation.

**Errors:** `type: "error"` on handler failure.

---

### `generate_image`

**Auth:** Session required. Admin only (destructive).

**Request fields** (top-level on message; subset — full set mirrors manual modal / NovelAI API body):

| Field | Required | Description |
|-------|----------|-------------|
| `requestId` | Yes | Correlation id |
| `model` | Yes* | Model identifier |
| `resolution` | Yes* | e.g. `normal_portrait` |
| `workspace` | Recommended | Target workspace id |
| `enableStreaming` | No | If true, step previews via `image_generation_progress` |
| `allow_paid` | No | Allow paid credits |
| `steps`, `guidance`, `sampler`, `seed`, … | Varies | Standard generation params |
| `dynamic_generation` | No | Dynamic gen config object |

\*Required for successful generation; server logs unknown model/resolution.

**Success:** `image_generation_response`

```json
{
  "type": "image_generation_response",
  "requestId": "...",
  "data": {
    "image": "<base64 PNG or null if streaming-only path>",
    "filename": "generated_....png",
    "seed": 12345,
    "metadata": { },
    "contentLength": 1234567,
    "compiled_prompt": { },
    "text_replacements_seed": { },
    "stage_seeds": [],
    "total_stages": 1
  },
  "timestamp": "..."
}
```

**Side effects:** `gallery_updated` broadcast; keep-alive every 15s until complete.

**Follow-up:** Fetch image via `GET /images/{filename}` if base64 omitted; refresh gallery with `request_gallery`.

**Errors:** `type: "error"`; may also receive `image_generation_error` push.

When the NovelAI Service Key tripwire is locked, generation fails before calling NovelAI with an error similar to `NovelAI is temporarily locked after repeated API errors...`. Admin recovery is in [admin.md](./admin.md#get_api_key_services): fix/select the key or send `unlock_api_service`, then retry generation.

### `compile_dynamic_generation`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleCompileDynamicGeneration`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `compile_dynamic_generation_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `dynamic_generation_progress`

**Auth:** Session required

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleDynamicGenerationProgress`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `phase` | Optional |
| `data` | Optional |

**Success response:** `dynamic_generation_progress_response`

**Push side effects:**
- `dynamic_generation_progress_update`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `expand_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleImageExpansion`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `enableStreaming` | Optional |
| `...data` | Optional |

**Success response:** `image_expansion_response`

Additional response/push types from handler:
- `image_generation_intermediate`
- `image_expansion_error`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `preview_expand_image_prompt`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/60-generationHandler.js → `handlePreviewExpandImagePrompt`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `...data` | Optional |

**Success response:** `expand_image_prompt_preview_response`

Additional response/push types from handler:
- `expand_image_prompt_preview_error`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `reroll_expanded_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleImageExpansionReroll`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `enableStreaming` | Optional |
| `...data` | Optional |

**Success response:** `image_expansion_reroll_response`

Additional response/push types from handler:
- `image_expansion_reroll_error`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `reroll_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleImageReroll`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Optional |
| `workspace` | Optional |
| `allow_paid` | Optional |

**Success response:** `image_reroll_response`

Additional response/push types from handler:
- `image_reroll_error`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `resolve_dynamic_context`

**Auth:** Session required

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleResolveDynamicContext`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `dynamicConfig` | Optional |

**Validation errors:**
- Dynamic config is required

**Success response:** `resolve_dynamic_context_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `resolve_text_replacements`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleResolveTextReplacements`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `text` | Optional |
| `presetName` | Optional |
| `model` | Optional |
| `periodKey` | Optional |

**Success response:** `resolve_text_replacements_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `upscale_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleImageUpscaling`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `...data` | Optional |

**Success response:** `image_upscaling_response`

Additional response/push types from handler:
- `image_upscaling_error`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

