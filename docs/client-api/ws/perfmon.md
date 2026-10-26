# WebSocket: Reliability and Performance Monitor

Server handler: `modules/ws/handlers/296-perfmonHandler.js` (data from `modules/perfmonSnapshot.js` and `modules/reliabilityRecords.js`).
Client: `apps/perfmon/client/perfmon.js` (Melaton app `apps/perfmon`). Yozora #632.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Both packets are admin only and read-only. A non-admin session gets `type: "error"` with code `INSUFFICIENT_PERMISSIONS`.

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `perfmon_snapshot` | `perfmon_snapshot_response` | admin | `{}` -> `{ host, cpu, cpuCount, memory, adapters, disk: { bytesPerSec, activeTime }, hardFaults, processes, connections: [{ pid, image, address, send, recv, total }] }`. The host's Resource View figures. Sampled at most every 450 ms (a sooner request gets the last sample); per-process and per-connection rates are per minute, and a process or connection gone for a minute leaves the lists. Failure = error `Failed to read the system`. |
| `perfmon_reliability` | `perfmon_reliability_response` | admin | `{}` -> `{ first, now, events: [{ t, cat, type, name?, detail?, version }] }`. Reliability Monitor's records for the System Stability Chart. `cat` is `software` (Melaton package install / update / uninstall, a new git HEAD at server start), `app` (fault reports in `data/fault-reports`, each one "Stopped working"), `windows` (the server exiting non-zero, "OS Stopped working"), `misc` (a start whose previous run never exited, "Disruptive Shutdown", dated at its last heartbeat) or `hardware` (none on Linux). Kept in `data/reliability/events.jsonl` and `data/reliability/state.json`. Failure = error `Failed to read the reliability records`. |
