# Agent session bridge (localhost)

Localhost-only API so Ivory / Menma can drive **one connected Dreamscape Studio tab** (Yukimi's session), not the server gallery.

**Auth:** same as `GET /agent` — direct loopback TCP peer, `enable_dev`, and `Authorization: Bearer <devLoginKey>` (`?auth=` fallback). Existing PIN sessions do **not** qualify. Forwarded address headers are ignored. Remote requests receive `403` even with a valid key.

Ivory and Menma must use **loopback + Bearer**, not the public PIN pad. These routes are never exposed on the public UI.

This is not a browser view. I/O is REST against the bound client's running editor (open image, apply studio change JSON, small state snapshot).

Out of scope: `workspace_list` / `workspace_move_files` / `request_gallery` / the `:9220` gallery websocket.

See also [rest-api.md](./rest-api.md) (Agent section) and [ws/agentSession.md](./ws/agentSession.md).

## Bind

1. `GET /agent/clients` — list connected websocket clients (`clientId`, `userType`, `workspaceId`, `connectedAt`, `userAgent` snippet, `bound`).
2. `POST /agent/bind` `{ "clientId": "…" }` — pick one from the list.
3. Or the user clicks **Share session** on Control Panel (`dsap://dreamscape.jp/`). The tab sends `session_share_start` and shows a 6-character code (~5 minutes). Then `POST /agent/bind` `{ "code": "ABC234" }` claims it.

Only one client is bound at a time. Binding another unbinds the previous. Share codes are never logged.

## Drive

All three require a live bind (`404` if none).

| Route | Body | Effect |
|-------|------|--------|
| `POST /agent/session/open-image` | `{ "filename" }` | WS `agent_session_command` `open_image` → `openManualModalWithContent({ type: "image", image })` |
| `POST /agent/session/studio` | change JSON or `{ prompt, uc }` | Apply via existing studio change helper (`dreamscape:"change"`, `v:1`; characters always replace+index) |
| `GET /agent/session/state` | — | Small snapshot: `workspaceId`, open `filename` if any, `model`, bound `clientId` |

The bound client ignores commands until it receives `agent_session_bound`, and ignores `agent_session_result` request ids that do not match.

## WebSocket packets

| Direction | Type | Notes |
|-----------|------|--------|
| Client → server | `session_share_start` | Returns `session_share_start_response` with `code`, `clientId`, `expiresInSec` |
| Server → bound client | `agent_session_command` | `{ command, … }` + `requestId` |
| Bound client → server | `agent_session_result` | Correlates `requestId`; ignored if unbound / wrong id |
| Server → client | `agent_session_bound` / `agent_session_unbound` | Bind flag for the tab |
