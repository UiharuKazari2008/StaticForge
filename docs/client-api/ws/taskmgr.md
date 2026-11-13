# WebSocket: Task Manager

Server handler: `modules/ws/handlers/295-taskManagerHandler.js` (data from `modules/taskManagerSnapshot.js`; live push via `modules/ws/snapshotStream.js`).
Client: `apps/taskmgr/client/taskmgr.js`.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

All packets are admin only and read-only; a non-admin session gets `type: "error"` with code `INSUFFICIENT_PERMISSIONS`.

## Packet index

| Request | Response | Notes |
|---|---|---|
| `taskmgr_snapshot` | `taskmgr_snapshot_response` | One snapshot. |
| `taskmgr_subscribe` | `taskmgr_subscribe_response` | `{ intervalMs?, services? }`. Starts pushes of `taskmgr_snapshot_push`; one sampler serves every open window, each at its own rate (63563ab2). |
| `taskmgr_unsubscribe` | `taskmgr_unsubscribe_response` | `{ ok: true }`. Stops the pushes for this socket. |
