# Agent session bridge (localhost)

Localhost-only API so Ivory / Menma can drive **one connected Dreamscape Studio tab** (Yukimi's session), not the server gallery.

**Auth:** same as `GET /agent` — direct loopback TCP peer and `enable_dev`, then either an application key or the development key. Ivory / agents on loopback may send `X-StaticForge-App-Key: sfapp_...` or `Authorization: Bearer sfapp_...`. No `loginKey` is required. `Authorization: Bearer <devLoginKey>` (`?auth=` fallback) still works. Existing PIN sessions do **not** qualify. Forwarded address headers are ignored. Remote requests receive `403` even with a valid key.

Loopback application-key checks skip User-Agent match and allow a past `refreshBeforeAt` so a bot UA or an overdue refresh does not 403. Public / gallery auth stays strict. Ivory and Menma must use **loopback + app key or Bearer**, not the public PIN pad. These routes are never exposed on the public UI.

This is not a browser view. I/O is REST against the bound client's running editor (open image, apply studio change JSON, state snapshot including the ungenerated editor as Change-JSON, push that tab to check/apply client updates then restart), plus named-scope packet dispatch that does **not** need a bind.

Out of scope: silent `universal`. Named scopes only (`generation`, `vfs`, `autofill`, plus whatever the key already has). No new chrome.

No new chrome shipped with this API. Share-code UX is waiting on a Yukimi preview — mint a code from the console or have the agent bind by `clientId`.

See also [rest-api.md](./rest-api.md) (Agent section), [ws/agentSession.md](./ws/agentSession.md), and the public Grok facade [mcp-connector.md](./mcp-connector.md) (`/{mcpPathUuid}`, not this loopback stack).

## Bind

1. `GET /agent/clients` — list connected websocket clients (`clientId`, `userType`, `workspaceId`, `connectedAt`, `userAgent` snippet, `bound`).
2. `POST /agent/bind` `{ "clientId": "…" }` — pick one from the list.
3. Or mint a short code from the bound tab (no UI): `await window.agentSessionShareStart()` or `wsClient.sendMessage('session_share_start', {})`. Response type is `session_share_code_response` (`code`, `clientId`, `expiresInSec` ~300). Then `POST /agent/bind` `{ "code": "ABC234" }` claims it. Codes expire in ~5 minutes and are single-use.

Only one client is bound at a time. Binding another unbinds the previous. Share codes and keys are never logged.

## Named scopes (no bind)

Loopback `/agent` honors the application key's named scopes. `GET /agent/scopes` returns the catalog plus the key's scopes. `GET /agent/session/state` echoes `scopes` and, when the key has `vfs` or `universal`, `vfsPathUuid` for the existing UUID VFS REST paths.

`POST /agent/packet` dispatches a registered WS packet through the same handlers Yukimi's session uses. Body is `{ "type": "<packet>", ...fields }` or `{ "type", "data": { ... } }`. No bind required. App keys are limited to packets listed on a scope they hold. `autofill` is Autofill Ranking + Grimoire / tag wiki — not `search`. `generation` and `vfs` are the named generate/VFS packets. `universal` is not granted here.

| Route | Body | Effect |
|-------|------|--------|
| `GET /agent/scopes` | — | `{ scopes, catalog, vfsPathUuid? }` |
| `POST /agent/packet` | `{ type, data? }` | Same handler as WS `type`; returns `{ type, data, reply, replies }` |

## Drive

All four require a live bind (`404` if none).

| Route | Body | Effect |
|-------|------|--------|
| `POST /agent/session/open-image` | `{ "filename" }` | WS `agent_session_command` `open_image` → `openManualModalWithContent({ type: "image", image })` |
| MCP `open_in_lumen` / `open_in_glancewell` | `{ "target", "filenames" }` | Bound `open_viewer` or push `mcp_open_viewer` → Lumen / Glancewell |
| `POST /agent/session/studio` | change JSON or `{ prompt, uc }` plus sibling `autoApply` / `autoGenerate` | Silent apply via `applyStudioChangePayloadSilent` / `applyStudioChangeOps` when `autoApply` is true (no confirm dialog); Studio opens like open-image / `openManualModalWithContent` before apply. After a successful apply, `autoGenerate` clicks Studio Generate on the bound tab |
| `POST /agent/session/update` | — | WS `agent_session_command` `client_update` → mandatory Client Update dialog on the bound tab (15s countdown). Cancel aborts (no apply, no restart). No input at 0 checks for client updates, applies them, then restarts **that client**. Not a server restart. HTTP waits until Cancel or countdown 0. `POST /agent/broadcast` `restart: true` reuses this same dialog on every connected tab (fire-and-forget; countdown from `timeout`, default 15s). |
| `GET /agent/session/state` | — | Snapshot: `workspaceId`, open `filename` (null if ungenerated / no image), `model`, bound `clientId`, plus `change` (Studio editor as Change-JSON v1), `scopes`, and `vfsPathUuid` when the key has `vfs`. No image required. Ivory rewrites `change` and `POST /agent/session/studio`. |

The bound tab replies with `agent_session_result` using the same `requestId`.

`autoApply` and `autoGenerate` are **siblings of `change`**, not fields inside Change-JSON.

| Flag | Default | Effect |
|------|---------|--------|
| `autoApply` | `true` | `true`: silent apply — await `applyStudioChangePayloadSilent` / `applyStudioChangeOps` (no `showStudioChangeDialog`). Studio opens like open-image (`openManualModalWithContent`; empty editor is valid when filename is null). Do not fire-and-forget `tryApplyStudioChangeJsonFromText`. `false`: do not apply. Human paste/dialog still uses `applyStudioChangePayload`. |
| `autoGenerate` | `false` | After a **successful apply**, click the bound tab's existing Generate button (`#manualGenerateBtn` → form submit → `handleManualGeneration` / `generate_image`). Uses Yukimi's bound session, not a server-side generate. The HTTP response does not wait for generation to finish. |

`autoGenerate: true` with `autoApply: false` is `400` (`autoGenerate requires autoApply`), at top level or inside `change` (object or parsed JSON string; on `change` or `change.fields`). It is not a silent no-op. Flags inside `change` that are not siblings of `change` are `400` (`autoApply/autoGenerate must be siblings of change, not inside change`) **before** the bound-client apply — no 504.

When `autoApply` is true, `POST /agent/session/studio` resolves after the silent bound-editor apply (`applyStudioChangePayloadSilent`) completes, success or error. Studio is opened like open-image before ops are written.

`POST /agent/session/update` shows the approved Client Update dialog (classic confirmation / System Update chrome + SMF context/status). The bound tab replies when the user cancels or the countdown hits 0; apply+restart starts after that reply. A second push while the dialog is already counting or applying returns `alreadyShowing` without resetting the countdown.

`POST /agent/broadcast` with `restart: true` (or `display: "restart"`) reuses this same dialog on every connected tab. Countdown comes from `timeout` (default 15000 ms). Cancel still aborts that tab. The HTTP broadcast response does not wait.

`change` is the shared NovelAI/studio Change-JSON v1 (`dreamscape:"change"`, replace+index, no add). Same schema as `POST /agent/session/studio` and [studio-change-json.md](../studio-change-json.md). An empty Studio is still a valid snapshot (`fields` always includes `prompt` and `uc`, even when blank). Filename is not required.

Optional per-character `position` (`{x,y}` and/or `cell` A1–E5) is a sibling of `index` / `name` / `prompt` / `uc` on each `characters[]` entry. It maps to the existing Studio slot dataset (position dialog / V5 freeform centers). `GET /agent/session/state` echoes it when the slot has stored coords. Do not add chrome.

`params.seed` is the **actual seed that was used** (or the specific seed to set). `params.seedLock` is whether the existing Studio sprout lock is on. `seed: "last"` or `seedLock: true` reuses the last seed without scraping `_generated_<seed>.png`. `seedLock: false` unlocks so the next generate rolls a new variation. Copy change JSON echoes the same pair. No new chrome.

## WebSocket packets

| Direction | Type | Notes |
|-----------|------|--------|
| Client → server | `session_share_start` | Returns `session_share_code_response` with `code`, `clientId`, `expiresInSec` |
| Server → bound client | `agent_session_command` | `{ command, … }` + `requestId` |
| Bound client → server | `agent_session_result` | Correlates `requestId` |
| Server → client | `agent_session_bound` / `agent_session_unbound` | Bind flag for the tab |
