# Ledge desks (client WS)

Modules: `modules/ledgeDesk.js`, `modules/ws/handlers/309-ledgeHandler.js` (Nov 16 2026). The same
desks the MCP tool `ledge` writes (see mcp-connector.md). Desks belong to the signed-in user (admin = the
household) and one workspace; a user never sees another user's desks. Every request needs a signed-in
client, else `AUTH_REQUIRED` ("Sign in first").

A desk is shown only on its **owner client**: the tab or phone the Director session that writes to it
belongs to (the client its MCP key is bound to). Changes made from any client go to that one socket as
`ledge_state`; the asking client gets the `_response`.

A desk head is `{ sessionId, name, workspaceId, kind ("prints"|"desk"), chatId, count, rev, updatedAt, checked }`.

| Request | Fields | Response `data` |
| --- | --- | --- |
| `ledge_list` | `workspaceId?`, `all?` (true = every workspace) | `{ success, workspaceId, sessions: [head] }` (defaults to the client's active workspace) |
| `ledge_get` | `sessionId` | `{ success, session }` the full desk (`items`, `checked`) |
| `ledge_checks` | `sessionId`, `checked: [itemId]` | `{ success, session: head }`; pushes `ledge_state` reason `checks` |
| `ledge_remove` | `sessionId`, `itemId` or `index` | `{ success, removed: { index, id }, session: head }`; `LEDGE_NO_ITEM` if none; pushes `remove` |
| `ledge_clear` | `sessionId` | `{ success, session: head }`; pushes `clear` |
| `ledge_rename` | `sessionId`, `name` | `{ success, session: head }`; `LEDGE_NAME` if empty; pushes `rename` |
| `ledge_dispose` | `sessionId` | `{ success, disposed: true, sessionId }`; pushes `dispose` |

`ledge_remove`, `ledge_clear` and `ledge_dispose` are marked destructive in the packet registry.
An unknown desk answers `{ success: false, error: "Unknown Ledge session", code: "LEDGE_UNKNOWN" }`.

## `ledge_state` (server push, owner client only)

`{ type: "ledge_state", data, timestamp }`. Every `data` carries `reason, sessionId, name, workspaceId,
kind, chatId, rev, count, ownerClientId, present` (`present: true` = bring the desk on screen).
A full desk (`reason` `open` or `sync`) adds `items [{ index, id, filename, text, checked, src, addedAt }]`
and `checked [itemId]`. Deltas carry `baseRev`, the rev the client must hold, else it asks `ledge_get`:
`add` (`added`, `trimmed`), `remove` (`removed`), `checks` (`checked`), `clear`, `rename`, `dispose` (`disposed: true`).

Director prints land on one desk per chat (`prints_<chatId>`, named after the chat, newest 200 kept; a chat
rename renames the desk). Desks persist in `.cache/ledge/<user>.json`.
