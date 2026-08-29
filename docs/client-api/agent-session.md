# Agent session bridge (localhost)

Localhost-only API so Ivory / Menma can drive **one connected Dreamscape Studio tab** (Yukimi's session), not the server gallery.

**Auth:** same as `GET /agent` — direct loopback TCP peer and `enable_dev`, then either an application key or the development key. Ivory / agents on loopback may send `X-StaticForge-App-Key: sfapp_...` or `Authorization: Bearer sfapp_...`. No `loginKey` is required. `Authorization: Bearer <devLoginKey>` (`?auth=` fallback) still works. Existing PIN sessions do **not** qualify. Forwarded address headers are ignored. Remote requests receive `403` even with a valid key.

Loopback application-key checks skip User-Agent match and allow a past `refreshBeforeAt` so a bot UA or an overdue refresh does not 403. Public / gallery auth stays strict. Ivory and Menma must use **loopback + app key or Bearer**, not the public PIN pad. These routes are never exposed on the public UI.

This is not a browser view. I/O is REST against the bound client's running editor (open image, apply studio change JSON, state snapshot including the ungenerated editor as Change-JSON).

Out of scope: `workspace_list` / `workspace_move_files` / `request_gallery` / the `:9220` gallery websocket.

No new chrome shipped with this API. Share-code UX is waiting on a Yukimi preview — mint a code from the console or have the agent bind by `clientId`.

See also [rest-api.md](./rest-api.md) (Agent section) and [ws/agentSession.md](./ws/agentSession.md).

## Bind

1. `GET /agent/clients` — list connected websocket clients (`clientId`, `userType`, `workspaceId`, `connectedAt`, `userAgent` snippet, `bound`).
2. `POST /agent/bind` `{ "clientId": "…" }` — pick one from the list.
3. Or mint a short code from the bound tab (no UI): `await window.agentSessionShareStart()` or `wsClient.sendMessage('session_share_start', {})`. Response type is `session_share_code_response` (`code`, `clientId`, `expiresInSec` ~300). Then `POST /agent/bind` `{ "code": "ABC234" }` claims it. Codes expire in ~5 minutes and are single-use.

Only one client is bound at a time. Binding another unbinds the previous. Share codes and keys are never logged.

## Drive

All three require a live bind (`404` if none).

| Route | Body | Effect |
|-------|------|--------|
| `POST /agent/session/open-image` | `{ "filename" }` | WS `agent_session_command` `open_image` → `openManualModalWithContent({ type: "image", image })` |
| `POST /agent/session/studio` | change JSON or `{ prompt, uc }` plus sibling `autoApply` / `autoGenerate` | Silent apply via `applyStudioChangePayloadSilent` / `applyStudioChangeOps` when `autoApply` is true (no confirm dialog); Studio opens like open-image / `openManualModalWithContent` before apply. After a successful apply, `autoGenerate` clicks Studio Generate on the bound tab |
| `GET /agent/session/state` | — | Snapshot: `workspaceId`, open `filename` (null if ungenerated / no image), `model`, bound `clientId`, plus `change` (Studio editor as Change-JSON v1). No image required. Ivory rewrites `change` and `POST /agent/session/studio`. |

The bound tab replies with `agent_session_result` using the same `requestId`.

`autoApply` and `autoGenerate` are **siblings of `change`**, not fields inside Change-JSON.

| Flag | Default | Effect |
|------|---------|--------|
| `autoApply` | `true` | `true`: silent apply — await `applyStudioChangePayloadSilent` / `applyStudioChangeOps` (no `showStudioChangeDialog`). Studio opens like open-image (`openManualModalWithContent`; empty editor is valid when filename is null). Do not fire-and-forget `tryApplyStudioChangeJsonFromText`. `false`: do not apply. Human paste/dialog still uses `applyStudioChangePayload`. |
| `autoGenerate` | `false` | After a **successful apply**, click the bound tab's existing Generate button (`#manualGenerateBtn` → form submit → `handleManualGeneration` / `generate_image`). Uses Yukimi's bound session, not a server-side generate. The HTTP response does not wait for generation to finish. |

`autoGenerate: true` with `autoApply: false` is `400` (`autoGenerate requires autoApply`), at top level or inside `change` (object or parsed JSON string; on `change` or `change.fields`). It is not a silent no-op. Flags inside `change` that are not siblings of `change` are `400` (`autoApply/autoGenerate must be siblings of change, not inside change`) **before** the bound-client apply — no 504.

When `autoApply` is true, `POST /agent/session/studio` resolves after the silent bound-editor apply (`applyStudioChangePayloadSilent`) completes, success or error. Studio is opened like open-image before ops are written.

`change` is the shared NovelAI/studio Change-JSON v1 (`dreamscape:"change"`, replace+index, no add). Same schema as `POST /agent/session/studio` and [studio-change-json.md](../studio-change-json.md). An empty Studio is still a valid snapshot (`fields` always includes `prompt` and `uc`, even when blank). Filename is not required.

## WebSocket packets

| Direction | Type | Notes |
|-----------|------|--------|
| Client → server | `session_share_start` | Returns `session_share_code_response` with `code`, `clientId`, `expiresInSec` |
| Server → bound client | `agent_session_command` | `{ command, … }` + `requestId` |
| Bound client → server | `agent_session_result` | Correlates `requestId` |
| Server → client | `agent_session_bound` / `agent_session_unbound` | Bind flag for the tab |
