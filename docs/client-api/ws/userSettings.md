# WebSocket: User Global Settings

Server handler: `modules/ws/handlers/200-userSettingsHandler.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `get_user_global_settings` | `get_user_global_settings_response` | session | Handler: handleGetUserGlobalSettings. Includes `remoteAccess` (`defaultGenerationMethod` studio \| detached \| auto, `autoGenerate`, `openGeneratedImages` ledge \| lumen \| glancewell \| disabled, `minPrintsPerTurn`, `maxPrintsPerTurn`). |
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

## `userGlobalSettings.remoteAccess`

Remote Access preferences are stored under `config.userGlobalSettings.remoteAccess` and normalized by `modules/remoteAccessSettings.js`. The Desktop **Remote Access** Control Panel page and its legacy modal fallback both patch this object through `update_user_global_settings`; MCP tools read the normalized object through `readRemoteAccessSettings()`.

| Field | Type | Default | Normalization / effect |
|-------|------|---------|------------------------|
| `defaultGenerationMethod` | string | `studio` | `studio`, `detached`, or `auto`. `detachedrequest` / `generateimage` also normalize to `detached`; unknown values fall back to `studio`. MCP instructions use this to decide whether agents should prefer bound-Studio apply or server-side `generate_image`. |
| `autoGenerate` | boolean | `false` | When `apply_studio_changes` omits `autoGenerate`, the MCP facade uses this value. `true` requires `autoApply`; otherwise the call is rejected before touching Studio. |
| `openGeneratedImages` | string | `ledge` | `ledge`, `lumen`, `glancewell`, or `disabled`. `off` / `none` normalize to `disabled`. After server-side generation, `disabled` skips client opening, `ledge` ingests prints into the shared Ledge desk, and `lumen` / `glancewell` require an available client viewer. |
| `minPrintsPerTurn` | number | `1` | Rounded and clamped to `1..8`. |
| `maxPrintsPerTurn` | number | `8` | Rounded and clamped to `1..8`; raised to `minPrintsPerTurn` when lower. `generate_image`, `generate_preset`, `apply_studio_changes` with auto-generate, and `print_studio` clamp requested `n` through these bounds. |

Example patch:

```json
{
  "type": "update_user_global_settings",
  "requestId": "remote-access-1",
  "settings": {
    "remoteAccess": {
      "defaultGenerationMethod": "auto",
      "autoGenerate": true,
      "openGeneratedImages": "ledge",
      "minPrintsPerTurn": 2,
      "maxPrintsPerTurn": 4
    }
  }
}
```

The response returns the full normalized `settings` object. Clients that only need to change one field should send a partial `remoteAccess` patch; the server merges it with the existing normalized settings.

**UI pitfall:** the print-count inputs also handle mouse wheels in `public/scripts/comp/modalUtils.js`. That handler only persists trusted wheel events while the legacy Remote Access modal is visible; closed-modal and synthetic wheels are ignored. Automation and tests should call `update_user_global_settings` instead of dispatching wheel events.

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


### `userGlobalSettings.desktop.useApplicationImageIcon`

Taskbar and Start Menu checkbox. Persisted under `config.userGlobalSettings.desktop`. Normalized by `normalizeUserGlobalSettings` (`false` when missing).

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `useApplicationImageIcon` | boolean | `false` | Taskbar buttons use the application picture when the program has one. The Orb start button does this on its own; the checkbox does the same for Luna and Workspace. |

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

Patch via `update_user_global_settings` with `settings.imageGeneration` (partial object OK — merge uses `mergeImageGenerationSettingsPatch`). Studio menus wire these prefs (settings button left of token usage, preview Transparent Background submenu, Generate Image Format / Automatic Download).
