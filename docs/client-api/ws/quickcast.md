# WebSocket: QuickCast (OBS live launcher)

Server handler: `modules/ws/handlers/300-quickcastHandler.js` (logic in `modules/quickcast.js`).
Client: `apps/quickcast/client/quickcast.js` (Melaton system package `apps/quickcast`, Start > AmusementVISION 2024 > QuickCast). Yozora #734.

One-click YouTube live for an arcade cabinet through OBS Studio on Ruiko. The server talks to obs-websocket v5
(`ws://192.168.100.12:4455`). The client names a cabinet id from the config, never a scene or a request type.

Going live uses OBS's **QuickCast** profile (a copy of Standard60: 1080p60 NVENC, stream track 6, no YouTube
account) and YouTube's persistent stream key. OBS's own YouTube account blocks a remote Start Streaming until
Manage Broadcast is clicked on Ruiko, so it is not used. The key is written into the profile's stream service
right before each start.

When OBS is not running, `quickcast_prepare` / `quickcast_golive` / `quickcast_launch` start it with the
on-demand Ruiko task `\AmusementVISION\QuickCast OBS` (`obs64.exe --profile "QuickCast" --collection "Remote Play"
--disable-shutdown-check`, no trigger), run over SSH as `ssh ruiko schtasks /Run /TN ...`.

Every packet is admin only (`admin`, `dev_admin`). A failure comes back in the `_response` as
`data.error: { message, details, code }`, not as an error packet.

## Config

`.cache/packages/.data/quickcast/config.json` (0600, not in git; `QUICKCAST_DATA_DIR` overrides it in tests).
Every field is optional:

| Field | Default |
|---|---|
| `obs.host`, `obs.port`, `obs.password` | `192.168.100.12`, `4455`, none |
| `profile` | `QuickCast` |
| `collection` | `Remote Play` |
| `youtube.streamKey` | none: set it in the program (Stream > Stream Key...). Never sent to the client. |
| `youtube.server`, `youtube.service` | `rtmps://a.rtmps.youtube.com:443/live2`, `YouTube - RTMPS` |
| `youtube.watchUrl` | none (Stream > Open Watch Page) |
| `cabinets` | `[{ id, name, scene, icon, short }]` (`short`: the 3-letter badge): Chunithm / Chuni, WACCA / WACCA, Nostalgia / Nosta, Chunithm H2H / Chuni H2H |
| `launch.ssh`, `launch.task` | `ruiko`, `\AmusementVISION\QuickCast OBS` |

## Packets

| Request type | Fields | Reply `data` |
|---|---|---|
| `quickcast_status` | - | `{ busy, obs: { state: online/offline/launching, version, error, launchingFor }, cabinets: [{ id, name, scene, icon, short, present }], key: { set, hint }, watchUrl, want: { profile, collection }, collection, profile, program, programCabinet, stream: { active, reconnecting, timecode, durationMs, congestion (%), kbps, skipped, frames }, video: { base, output, fps, activeFps, cpu, renderSkipped, renderTotal }, inputs: [{ name, muted, mag[], peak[] }], master: { mag: [L, R], peak: [L, R] } }`. Levels are dBFS (-100 = silence), peaks since the last read. Inputs are what the stream hears with the program scene: its enabled items (nested scenes and groups too) and the global audio devices, less monitor-only inputs and inputs off the stream track. Polled ~5 Hz; keeps the OBS connection open (closed 60 s after the last poll). |
| `quickcast_preview` | `cabinet`, `width` (160-1280, default 640) | `{ cabinet, image: "data:image/jpg;base64,...", at }`: the cabinet's scene, rendered by OBS |
| `quickcast_prepare` | `cabinet`, `confirmed` | Starts OBS when needed, switches to the collection and the profile (never while streaming; the profile not while recording), puts the scene on program. While live, a scene change without `confirmed` returns `{ needsConfirm: true }`. Else `{ ok, cabinet, steps: ['collection', 'profile', 'scene'], live }`. |
| `quickcast_golive` | `cabinet` | Key into the profile's stream service, scene on program, StartStream; waits up to 15 s for OBS. `{ ok, cabinet }` / `{ ok, already }`. Refused without a key, or while recording in another profile. |
| `quickcast_stop` | - | StopStream and wait. `{ ok }` / `{ ok, already }` |
| `quickcast_launch` | - | Start OBS on Ruiko. `{ ok }` |
| `quickcast_setkey` | `key` (omit to keep), `watchUrl` | `{ ok, key: { set, hint }, watchUrl }`. Key `[A-Za-z0-9_-]{8,128}`; watch URL must be youtube.com. |
| `quickcast_info` | - | `{ host, port, profile, collection, server, launchTask }` |

One prepare / go-live / stop runs at a time; another gets `QUICKCAST_BUSY`.

## Test

`node scripts/test-quickcast.js` runs the module against a fake obs-websocket on loopback. Never test against the
real OBS with a key set: GO LIVE is public.
