# Link speed (client WS)

Module: `modules/ws/handlers/303-linkSpeedHandler.js` (#952, Nov 19 2026). A client measures how fast this server's
answer reaches it (the Café Miniport / Nightshade adapter's Speed in its status window), at connect and every 30
minutes, and reports the result so the server knows a slow link.

| Packet | Direction | Fields | Notes |
| --- | --- | --- | --- |
| `link_speed_probe` | client -> server | `data: { bytes }` | Answers `link_speed_probe_response` `data: { bytes, payload }`: `payload` is random base64 (so permessage-deflate cannot shrink it). `bytes` is rounded to KB and clamped to 16 KB - 256 KB (default 128 KB). |
| `link_speed_report` | client -> server | `data: { kbps, rttMs }` | Answers `link_speed_report_response` `data: { ok: true }`. A finite `kbps` between 0 and 10,000,000 is kept on the connection (`ws._melatonLinkSpeed` `{ kbps, rttMs, at }`); anything else is ignored. |
