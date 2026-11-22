# DreamOS updates (client WS)

Module: `modules/ws/handlers/312-dreamosUpdatesHandler.js` (#910, Nov 19 2026). The REST side (channels, objects,
publishing) is in [../rest-api.md](../rest-api.md#dreamos-updates).

A DreamOS desktop (its shell bridge gives the page `window.DreamOSUpdates`) asks to be told when a firmware release is
published, instead of asking the channel on a timer (rule: server push, not polling).

| Packet | Direction | Fields | Notes |
| --- | --- | --- | --- |
| `dreamos_channel_watch` | client -> server | none | Signed-in sockets only; fire-and-forget (no answer). Once per socket; the watch ends when the socket closes. |
| `miniport_update_channel` | server -> Miniport carrier | `channel` (or `null`), `released`, `sha256` | Not a page packet: sent on a DreamOS host's Miniport that connected with `?device=`, at connect, on a publish of its channel and on a new assignment (`PUT /api/dreamos/assign/:device`, Nov 20). CaféReady `firmware.rs` repoints and offers the release. |
| `dreamos_channel` | server -> client | `data: { channel }` | Sent to watching sockets only, when `modules/dreamosUpdates.js` emits `channel` (a publish). The page hands it to its system agent (CaféReady `firmware.rs`), which then checks `GET /api/dreamos/channel/:channel`. |
