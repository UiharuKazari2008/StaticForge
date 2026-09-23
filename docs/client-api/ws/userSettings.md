# WebSocket: User Global Settings

Server handler: `modules/ws/handlers/200-userSettingsHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `get_user_global_settings` | `get_user_global_settings_response` | session | Handler: handleGetUserGlobalSettings. Includes `remoteAccess` (`defaultGenerationMethod`, `autoGenerate`, `openGeneratedImages`). |
| `update_user_global_settings` | `update_user_global_settings_response` | admin/destructive | Handler: handleUpdateUserGlobalSettings. Desktop **Remote Access Settings** patches `settings.remoteAccess`. |

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

### `get_user_global_settings`

**Auth:** Session required

**Handler:** modules/ws/handlers/200-userSettingsHandler.js → `handleGetUserGlobalSettings`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `get_user_global_settings_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `update_user_global_settings`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/200-userSettingsHandler.js → `handleUpdateUserGlobalSettings`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `settings` | Optional |

**Success response:** `update_user_global_settings_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.


### `userGlobalSettings.imageGeneration`

NAI Image Generation prefs parity (Desktop Settings + Studio). Persisted under `config.userGlobalSettings.imageGeneration`. Normalized by `modules/imageGenerationSettings.js` on `get_user_global_settings` / `update_user_global_settings` (and any path that goes through `normalizeUserGlobalSettings`).

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `streamImageGeneration` | boolean | `true` | Stream generation progress |
| `showStreamedImagesUnprocessed` | boolean | `true` | Show raw streamed frames |
| `simpleOutputViewer` | boolean | `false` | Simplified output viewer |
| `lockOutputViewerCamera` | boolean | `false` | Lock output viewer camera |
| `reducedMotion` | boolean | `false` | Reduce motion in generation UI |
| `transparencyBackground` | string | `checker-dark` | `checker-dark`, `checker-light`, `white`, `black`, `gray`, `red`, `green`, `blue`, `custom` |
| `transparencyCustomColor` | string | `#808080` | Hex `#rgb` / `#rrggbb` when background is `custom` |
| `hideQuickstartGallery` | boolean | `false` | Hide Quickstart Gallery empty-state preview (PR #210) |
| `persistHistory` | boolean | `true` | Persist generation history |
| `imageFormat` | string | `png` | `png` or `webp` |
| `automaticDownload` | boolean | `false` | Auto-download finished images |
| `alphaMode` | string | `straight` | `straight` or `premultiplied` |

Patch via `update_user_global_settings` with `settings.imageGeneration` (partial object OK — merge uses `mergeImageGenerationSettingsPatch`). Desktop Settings UI wires these prefs (PR #211).
