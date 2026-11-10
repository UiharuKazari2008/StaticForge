# WebSocket: VisionCaster (video mixer remote, was QuickCast)

Server handler: `modules/ws/handlers/300-quickcastHandler.js` (logic in `modules/quickcast.js`).
Client: `apps/quickcast/client/quickcast.js` (Melaton system package `apps/quickcast`, Start > AmusementVISION 2024 > VisionCaster; ids, packet names and the data dir keep "quickcast"). Yozora #734.

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
| `youtube.apiKey` | none: a Google API key (reads chat without sign-in, with `youtube.channelId`) |
| `youtube.oauth.clientId`, `.clientSecret` | none: an OAuth client of type "TVs and Limited Input devices" (device-flow sign-in, scope `youtube`) |
| `youtube.token`, `youtube.channel` | written by the sign-in |
| `youtube.last` | the broadcast settings that pre-fill the next stream: `title, description, privacy, categoryId, latency, dvr, madeForKids` |
| `youtube.broadcast` | QuickCast's current broadcast `{ id, videoId, liveChatId, title, createdAt }` |
| `youtube.accounts` | every signed-in channel `{ <channelId>: { channel, token } }`; `token` / `channel` are the active one |
| `cabinets` | `[{ id, name, scene, icon, short, xlink }]` (`short`: the 3-letter badge; `xlink`: the XLink device key, default the id, H2H uses `chuni`, `false` for none): Chunithm / Chuni, WACCA / WACCA, Nostalgia / Nosta, Chunithm H2H / Chuni H2H |
| `launch.ssh`, `launch.task` | `ruiko`, `\AmusementVISION\QuickCast OBS` |

## Packets

| Request type | Fields | Reply `data` |
|---|---|---|
| `quickcast_status` | - | `{ busy, obs: { state: online/offline/launching, version, error, launchingFor }, cabinets: [{ id, name, scene, icon, short, present }], key: { set, hint }, watchUrl, want: { profile, collection }, collection, profile, program, programCabinet, stream: { active, reconnecting, timecode, durationMs, congestion (%), kbps, skipped, frames }, video: { base, output, fps, activeFps, cpu, renderSkipped, renderTotal }, inputs: [{ name, muted, mag[], peak[] }], master: { mag: [L, R], peak: [L, R] }, youtube: { account, last, broadcast: { id, title, watchUrl, shortUrl, studioUrl }, live: { viewers, likes, at } } }`. `live` (concurrent viewers) is read every 30 s while streaming. Levels are dBFS (-100 = silence), peaks since the last read. Inputs are what the stream hears with the program scene: its enabled items (nested scenes and groups too) and the global audio devices, less monitor-only inputs and inputs off the stream track. Polled ~5 Hz; keeps the OBS connection open (closed 60 s after the last poll). |
| `quickcast_preview` | `cabinet`, `width` (160-1280, default 640) | `{ cabinet, image: "data:image/jpg;base64,...", at }`: the cabinet's scene, rendered by OBS |
| `quickcast_prepare` | `cabinet`, `confirmed` | Starts OBS when needed, switches to the collection and the profile (never while streaming; the profile not while recording), puts the scene on program. While live, a scene change without `confirmed` returns `{ needsConfirm: true }`. Else `{ ok, cabinet, steps: ['collection', 'profile', 'scene'], live }`. |
| `quickcast_golive` | `cabinet`, `settings` (optional, e.g. `{ title }`) | Key into the profile's stream service, scene on program; signed in to YouTube: a new broadcast with the settings (auto start / stop) bound to the key's stream; then StartStream, waiting up to 15 s for OBS. `{ ok, cabinet, broadcast }` / `{ ok, already }`. Refused without a key, or while recording in another profile. |
| `quickcast_stop` | - | StopStream and wait. `{ ok }` / `{ ok, already }` |
| `quickcast_launch` | - | Start OBS on Ruiko. `{ ok }` |
| `quickcast_setkey` | `key` (omit to keep), `watchUrl` | `{ ok, key: { set, hint }, watchUrl }`. Key `[A-Za-z0-9_-]{8,128}`; watch URL must be youtube.com. |
| `quickcast_encoder` | - | `{ bitrate, rateControl, audioBitrate, height, fps, heights[], audioRates[] }`: streamEncoder.json of the QuickCast profile (read over SSH) and the stream track's audio bitrate |
| `quickcast_setencoder` | `bitrate` (500-51000), `rateControl` (CBR/VBR), `audioBitrate`, `height` (720/900/1080/1440), `fps` (30/60) | Not while streaming or recording. Writes streamEncoder.json, the audio bitrate and the video settings, then reloads the profile. `{ ok, videoPending, encoder }`: `videoPending` when an always-on output (DistroAV NDI Main Output) keeps the resolution / fps from applying until OBS restarts. |
| `quickcast_yt_account` | - | `{ account: { apiKey, client, clientId (shortened), signedIn, channel, channelId }, last, signIn }` |
| `quickcast_yt_credentials` | `apiKey`, `clientId`, `clientSecret`, `channelId` (omit to keep, `-` clears) | `{ ok, account }` |
| `quickcast_yt_signin` | - | Starts Google's device flow: `{ userCode, url, expiresAt }`; the server polls Google |
| `quickcast_yt_signin_state` | - | `{ signIn: { state: none/waiting/done/failed, userCode, url, error }, account }` |
| `quickcast_yt_signout` | `all` | Signs the active channel out (another saved one becomes active), or every channel |
| `quickcast_yt_settings` | `title`, `description`, `privacy`, `categoryId`, `latency`, `dvr`, `madeForKids`, `applyLive` | Saves `last`; with `applyLive` while QuickCast's broadcast exists, also `videos.update` (title, description, category). `{ ok, last, updatedLive }` |
| `quickcast_chat` | `since` (seq) | `{ messages: [{ seq, id, at, type, text, author, avatar, owner, mod, member, verified, amount }], seq, problem, nextInMs, canReply, canRead, broadcast }`. Polling keeps the server's chat reader running (20 s lease); it reads at YouTube's pollingIntervalMillis, at least 5 s apart. |
| `quickcast_chat_send` | `text` (1-200 chars) | Posts to the live chat as the signed-in channel. `{ ok }` |
| `quickcast_mute` | `name`, `muted` | Mutes / unmutes an input, only one the stream hears with the program scene (`QUICKCAST_NO_INPUT` otherwise). `{ ok, name, muted }` |
| `quickcast_cabinet` | `cabinet`, `force` | The cabinet's XLink controls from its menu.json device (modules/xlink.js snapshot, cached 4 s): `{ cabinet, available, device: { key, name, status }, video: { path, buttons: [{ n, label, active }], resetPath }, power: { path, buttons, status, warning }, game: { path, status, warning, options: [{ path, text }] } }`. Matched by item text: VISION Control (AUTO shown as GAME), its Reset Encoder child, Power Switch, Game Select. |
| `quickcast_cabinet_action` | `cabinet`, `path`, `op` (`toggle`/`send`), `value`, `confirmed` | Only those controls (anything else: `QUICKCAST_XLINK_DENIED`), through `xlink.action`, so XLink's own warnings come back first as `{ confirm: { header, message, ok } }`. Else `{ ok, failure, controls }`. |
| `quickcast_yt_profile` | `force` | Refreshes the active channel's profile (every 10 min at most unless forced): `{ account }` with `profile: { id, title, handle, avatar, subscribers, videos }` and `channels[]` |
| `quickcast_yt_select` | `channelId` | Makes another signed-in channel the active one |
| `quickcast_info` | - | `{ host, port, profile, collection, server, launchTask }` |
| `quickcast_obs_off` | - | Shuts the satellite's encoder engine down with the on-demand task `launch.stopTask` (taskkill without /F in the logged-on session). Refused while on air or recording. `{ ok }` / `{ ok, already }` |
| `quickcast_live_ticket` | `cabinet`, `width` | `{ ticket, url }`: a one-time ticket for the REALTIME preview, an MJPEG stream of the cabinet's layout at `GET /quickcast/live/<ticket>` (up to 25 fps, from the satellite only) |
| `quickcast_osd_key` | `target` (`sat` / `cab`), `cabinet`, `key` (`up down left right ok menu diag info exit`) | A remote key for the unit (modules/avOsd.js). Keys queue per unit; a backlog over 2 is dropped. Returns the OSD view `{ box: { id, name, maker, line, model, type, theme }, open, info, page: { title, crumbs, rows[], cursor, first, total, hint }, strip, post, toast }` |
| `quickcast_osd_view` | `target`, `cabinet` | The unit's current OSD view (for the remote's display) |

Quota (10,000 units a day by default): a go-live ~150 units, a chat read 5, a reply 50.

One prepare / go-live / stop / encoder change runs at a time; another gets `QUICKCAST_BUSY`.


The window's preview runs REALTIME (`quickcast_live_ticket`) by default; OFF / 1 / 2 / 5 fps use `quickcast_preview`. Timing / clock bars live in the units' own OSD (TIMING, VIDEO CLOCK), not in the window.

`quickcast_status` also carries `satellite: { name, model, kind, host }`, `diag: { columns, input, output, verdict }` (modules/quickcastDiag.js: the cabinet mixer and satellite pipeline rows; `input.captures[]`, `input.align`) and `faults: [{ unit, box, kind, machine, at, items: [{ label, type, detail, cabs }], overridden }]`: latched self-test faults on the units this cabinet goes through. They are advisory: the client lists them before LIVE; going live is never refused for them.

### Units, OSD and self test

- Each unit draws its menus in its own video output: browser source "AV OSD Overlay" in scene "AV OSD" (nested on top of program only while needed), page `GET /av-osd/<box>?k=<token>` with events at `/av-osd/<box>/events` (Server-Sent Events). Tokens are per unit in `osd.json` (0600). `?card=systest` / `?card=slate&cab=<id>` draw the live System Test card / standby slate (installed from the unit's SYSTEM page as "AV Live Card" / "AV Live Slate <cab>").
- Power on / reset (the satellite's engine start, a mixer whose frame counter restarts) runs the boot screen and power-on self test: device PRESENT, video LOCK, camera RATE on the unit's clock, for inputs enabled somewhere. Any alarm latches a FAULT, shown on the unit's self-test card (DO NOT AIR) and its front panel ALARM led, until a technician re-tests clean or overrides in the unit's menu. Advisory: it does not block LIVE.
- Config: `satellite: { name }`, `units: { "<NAME>": { maker, line, model, kind, theme, sw, hw, fw } }` (defaults: satellite = AmuVISION Satellite iSVE-20D, mixers = TAKAO iUHD-4DX), `muxes: { "<NDI machine>": { host, port, password } }`, `osd: { baseUrl, alarmHoldS }`.

## Test

`node scripts/test-quickcast.js` runs the module against a fake obs-websocket and a fake Google / YouTube API on loopback. Never test against the
real OBS with a key set: GO LIVE is public.
