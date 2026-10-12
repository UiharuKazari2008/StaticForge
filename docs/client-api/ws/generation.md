# WebSocket: Generation & Image Operations

Server handler: `modules/ws/handlers/60-generationHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `apply_tendai_preview` | `apply_tendai_preview_response` | admin/destructive | Handler: handleApplyTendaiPreview |
| `animate_image` | `image_animation_response` | admin/destructive | Ruiko image-to-video; no Anlas or paid fallback |
| `cancel_generation` | `cancel_generation_response` | session | Handler: handleCancelGeneration |
| `compile_dynamic_generation` | `compile_dynamic_generation_response` | admin/destructive | Handler: handleCompileDynamicGeneration |
| `dynamic_generation_progress` | `dynamic_generation_progress_response` | session | Handler: handleDynamicGenerationProgress |
| `enhance_image` | `enhance_image_response` | admin/destructive | Handler: handleEnhanceImage |
| `emotion_current_job` | `emotion_current_job_response` | session | Last eMotion job for this session |
| `expand_image` | `image_expansion_response` | admin/destructive | Handler: handleImageExpansion |
| `generate_image` | `image_generation_response` | admin/destructive | Handler: handleImageGeneration |
| `local_animate_status` | `local_animate_status_response` | session | Ruiko animate health/backends |
| `local_upscale_status` | `local_upscale_status_response` | session | Ruiko upscale health/models |
| `max_enhance_image` | `max_enhance_image_response` | admin/destructive | Handler: handleMaxEnhanceImage |
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

Destructive packets are blocked for `userType: "readonly"`: `generate_image`, `reroll_image`,
`upscale_image`, `animate_image`, `expand_image`, `enhance_image`, `max_enhance_image`,
`preview_expand_image_prompt`, `reroll_expanded_image`, `compile_dynamic_generation`,
`apply_tendai_preview`, and `resolve_text_replacements`.

Non-destructive session packets include `cancel_generation`,
`dynamic_generation_progress`, `resolve_dynamic_context`, `local_upscale_status`,
`local_animate_status`, and `emotion_current_job`.

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

### `animate_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** `modules/ws/handlers/60-generationHandler.js` -> `handleImageAnimation`

Runs a gallery still through the Ruiko worker's `animate` job type and saves the
GIF as the gallery file, with WebM/MP4/WebP sidecar outputs when the worker
returns them. This path is local-only: it does not call NovelAI, spend Anlas, or
have a paid fallback.

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Required gallery image filename |
| `workspace` | Optional workspace id for the saved animated result |
| `motion_prompt` / `motionPrompt` | Required. Passed to Ruiko verbatim. Worker limit: 2000 characters |
| `backend` / `mode` | Optional: `ltx` (default), `loop`, or `wan` |
| `frames` | Optional. Worker accepts 8-32; default 16 |
| `fps` | Optional. Worker accepts 4-24; default 8 |
| `loop` | Optional boolean. Defaults to `true` |

**Backend constraints:**

| Backend | Notes |
|---------|-------|
| `ltx` | Default true image-to-video backend and the practical option on Ruiko's 8 GB GPU |
| `loop` | Faster AnimateDiff-style loop seeded from the still; not a scene-continuing image-to-video backend |
| `wan` | True image-to-video, but currently impractical on the 8 GB Ruiko card; kept for future hardware/model changes |

**Success response:** `image_animation_response`

```json
{
  "type": "image_animation_response",
  "requestId": "req_...",
  "data": {
    "filename": "source_animate_0123abcd.gif",
    "formats": {
      "webm": "source_animate_0123abcd.webm",
      "gif": "source_animate_0123abcd.gif",
      "mp4": "source_animate_0123abcd.mp4",
      "webp": "source_animate_0123abcd.webp"
    },
    "metadata": {},
    "jobId": "ruiko-job-id",
    "backend": "ltx",
    "motionPrompt": "hair and clothing sway in the wind",
    "frames": 16,
    "fps": 8,
    "loop": true
  },
  "timestamp": "..."
}
```

**Progress push:** `image_animation_progress`

Progress is monotonic per request. `previewBase64` is a JPEG filmstrip and is
only included when a new preview is available.

```json
{
  "type": "image_animation_progress",
  "requestId": "req_...",
  "data": {
    "status": "running",
    "sourceFilename": "source.png",
    "workspace": "default",
    "backend": "ltx",
    "frames": 16,
    "fps": 8,
    "loop": true,
    "progress": 42,
    "stage": "generating",
    "step": 8,
    "totalSteps": 20,
    "message": "Generating 8/20",
    "previewSeq": 3,
    "previewBase64": "<jpeg-base64>"
  }
}
```

**Error response:** `image_animation_error`

```json
{
  "type": "image_animation_error",
  "requestId": "req_...",
  "data": {
    "jobId": "ruiko-job-id",
    "code": "LOCAL_WORKER_OFFLINE",
    "fallbackBackend": "nai"
  },
  "error": "Local (Ruiko) upscaler is offline or not configured. ...",
  "timestamp": "..."
}
```

`fallbackBackend` can be present because the shared Ruiko client builds the
offline error, but `animate_image` has no NovelAI retry path; surface the error
instead of retrying as a paid operation.

### `cancel_generation`

**Auth:** Session required

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleCancelGeneration`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `cancelledRequestIds` | Optional |

**Success response:** `cancel_generation_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors).

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

Rentan (`modules/dynagenWren.js`) also pushes during a Studio generate: `image_generation_progress` with `hasDynamicGen: true`, `phase` `thinking` then `streaming` (`reasoning` is one Wren thought, `status` the overlay line), and `dynamic_generation_progress_update` with `phase: "wren_change"` and `data: { change, compiled_prompt }`. The client stores `compiled_prompt` and applies `change` (Change JSON: `expanders`, `prompt`, `uc`, `characters`) to an open Studio silently. A failed Wren turn pushes `phase: "error"` and the generate fails.

Every Studio Rentan print is reviewed before it is saved. Wren calls hidden tools `await_rentan_attempt` and `finish_rentan` (or `deliver_rentan` again to reprint). The overlay status line is `Wren is reviewing attempt N/5` (`phase: "reviewing"`) and each attempt's preview is `imageData` on `image_generation_progress`. At most 5 attempts. Approving, or picking one at the cap, is the only `wren_change` Studio applies. MCP `generate_image`, pipelines, and preview-only builds skip the review. A dynagen turn uses a 2 minute idle cap and a 3 minute hard cap (8 minutes while a review is open), and the child process is killed when that expires, so it cannot hold the generation FIFO for the Director chat's 30 minutes.

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors).

### `enhance_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleEnhanceImage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Optional |
| `scale` | Optional |
| `workspace` | Optional |
| `strength` | Optional. An explicit `0` is kept, same as `noise` |
| `noise` | Optional. An explicit `0` is kept (img2img no longer replaces 0 with the default); omit the field for the default |
| `steps` | Optional |
| `guidance` | Optional |
| `rescale` | Optional |
| `sampler` | Optional |
| `noiseScheduler` | Optional |
| `seed` | Optional |
| `model` | Optional |

**Success response:** `enhance_image_response`

Additional response/push types from handler:
- `enhance_image_error`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `emotion_current_job`

**Auth:** Session required. Not destructive.

**Handler:** `handleEmotionCurrentJob`

Returns the current or most recent eMotion job for the session. The server keeps
this state in memory for reconnect/reload resume; finished/failed jobs expire
after six hours and a server restart forgets the resume state. Saved gallery
files remain on disk.

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `knownPreviewSeq` | Optional. If supplied, `previewBase64` is omitted unless the server has a newer preview |

**Success response:** `emotion_current_job_response`

```json
{
  "type": "emotion_current_job_response",
  "requestId": "req_...",
  "data": {
    "job": {
      "requestId": "req_...",
      "status": "running",
      "sourceFilename": "source.png",
      "workspace": "default",
      "backend": "ltx",
      "frames": 16,
      "fps": 8,
      "loop": true,
      "progress": 42,
      "stage": "generating",
      "step": 8,
      "totalSteps": 20,
      "message": "Generating 8/20",
      "previewSeq": 3
    }
  },
  "timestamp": "..."
}
```

`job` is `null` when no resume state exists for the session.

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

**Character prompt names:** Studio `chara_name` on each enabled character maps to NovelAI `parameters.characterPrompts[i].name` (`modules/characterPromptApiFormat.js`). Default/blank labels omit `name` so captions stay prompt-only. Renamed characters keep their custom label on the API payload.

Studio `generate_image`, `generate_preset`, and `reroll_image` enqueue on the same **global generation FIFO** as MCP (`modules/generationJobQueue.js`). One NovelAI generate at a time. After a job finishes, the next waits a semi-random 8–20s gap. While waiting, the handler pushes `image_generation_progress` with `phase: "queued"`, `jobId`, `position`, and `delayMs` (existing toast; no new chrome). `skipGenerationQueue` is set only when MCP already submitted the job (`async: true`).

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `enableStreaming` | Optional |
| `n` | Optional print count (2–8). Server runs the existing generate path that many times and emits print-level `stage_complete` / `complete`. Omitted or `1` is a single generate |
| `...data` | Optional |

**Success response:** `image_generation_response`

Additional response/push types from handler:
- `image_generation_intermediate`
- `image_generation_error`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `max_enhance_image`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/60-generationHandler.js → `handleMaxEnhanceImage`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `filename` | Optional |
| `workspace` | Optional |
| `strength` | Optional. An explicit `0` is kept, same as `noise` |
| `noise` | Optional. An explicit `0` is kept (img2img no longer replaces 0 with the default); omit the field for the default |
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

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors).

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
| `filename` | Gallery PNG to upscale |
| `workspace` | Optional workspace id |
| `backend` | `nai` (default, NovelAI, spends Anlas) or `local` (Ruiko GPU, free). Alias of `upscaler`. `nai` is also accepted as `novelai`. |
| `upscaler` | `novelai`, `esrgan`, or `local` |
| `model` / `localUpscaleModel` | Local model id when `backend` is `local`: `RealESRGAN_x4plus`, `RealESRGAN_x4plus_anime_6B`, `4x-UltraSharp` |
| `scale` / `localUpscaleScale` | Local scale `2` or `4`. NovelAI ignores scale and returns 2x. |
| `...data` | Optional |

Local upscales do not check or spend Anlas. The success payload includes `jobId` from the worker. If Ruiko is offline or `localWorker.url` / `localWorker.key` are missing from `secure.config.json`, the error text names `backend="nai"` as the paid fallback and does not call NovelAI.

**Success response:** `image_upscaling_response` (`filename`, `metadata`, `jobId` for local)

### `local_upscale_status`

**Auth:** Session required. Not destructive.

**Handler:** `handleLocalUpscaleStatus`

Returns `{ online, configured, reason, gpu, version, queueLength, models }`. `models` is the worker `/models` list when Ruiko is up, otherwise the three built-in ids. Studio and Enhance use this to fill the model picker.

**Success response:** `local_upscale_status_response`

Additional response/push types from handler:
- `image_upscaling_error`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors).

### `local_animate_status`

**Auth:** Session required. Not destructive.

**Handler:** `handleLocalAnimateStatus`

Checks the same `secure.config.json` `localWorker.url` / `localWorker.key`
configuration used for local upscales, then returns Ruiko's available animate
backends. The health response is cached briefly by `modules/localUpscaleWorker.js`
(15 seconds) to avoid hammering the worker from picker refreshes.

**Success response:** `local_animate_status_response`

```json
{
  "type": "local_animate_status_response",
  "requestId": "req_...",
  "data": {
    "online": true,
    "configured": true,
    "reason": null,
    "gpu": "NVIDIA GeForce RTX 2070 SUPER",
    "version": "0.2.0",
    "queueLength": 0,
    "backends": ["loop", "wan", "ltx"],
    "loaded": ["ltx"]
  },
  "timestamp": "..."
}
```

When Ruiko is offline or unconfigured, `online` is `false`, `reason` explains
the failure, and `backends` falls back to the built-in `loop`, `wan`, `ltx`
catalog so clients can still render the picker.

