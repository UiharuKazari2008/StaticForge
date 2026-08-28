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
| `enhance_image` | `enhance_image_response` | session | Handler: handleEnhanceImage |
| `expand_image` | `image_expansion_response` | admin/destructive | Handler: handleImageExpansion |
| `generate_image` | `image_generation_response` | admin/destructive | Handler: handleImageGeneration |
| `max_enhance_image` | `max_enhance_image_response` | session | Handler: handleMaxEnhanceImage |
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

**Auth:** Session required

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleCancelGeneration`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `cancelledRequestIds` | Optional |

**Success response:** `cancel_generation_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

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

### `enhance_image`

**Auth:** Session required

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleEnhanceImage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Required |
| `scale` | `1`, `1.5`, `2`, or `max` (Max keeps source WxH and sets `upscaled_enhance`) |
| `workspace` | Optional |
| `strength` | Optional img2img strength; default `0.5` (magnitude 3.0) |
| `noise` | Optional img2img noise; default `0` |
| `steps` | Optional override |
| `guidance` | Optional override |
| `rescale` | Optional override |
| `sampler` | Optional override |
| `noiseScheduler` | Optional override |
| `seed` | Optional; random when omitted |
| `model` | Optional override |

**Success response:** `enhance_image_response`

Additional response/push types from handler:
- `enhance_image_error`

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

### `generate_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleImageGeneration`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `enableStreaming` | Optional |
| `...data` | Optional |

**Success response:** `image_generation_response`

Additional response/push types from handler:
- `image_generation_intermediate`
- `image_generation_error`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `max_enhance_image`

**Auth:** Session required

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleMaxEnhanceImage`

Compatibility alias for `enhance_image` with `scale: "max"`. Prefer `enhance_image`.

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Required |
| `workspace` | Optional |
| `strength` | Optional; same as `enhance_image` |
| `noise` | Optional |
| `steps` | Optional |
| `guidance` | Optional |
| `rescale` | Optional |
| `sampler` | Optional |
| `noiseScheduler` | Optional |
| `seed` | Optional |
| `model` | Optional |

**Success response:** `max_enhance_image_response`

Additional response/push types from handler:
- `max_enhance_image_error`

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
| `text_replacements_seed` | Optional |

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

