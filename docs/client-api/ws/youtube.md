# WebSocket: Melaton Videos (YouTube, Kick, app notifications)

Server handler: `modules/ws/handlers/308-youtubeHandler.js` (logic in `modules/youtubeService.js`; YouTube Data API v3). Yozora #839.
Client: Melaton Mobile YouTube and its Today items (6.1 / 6.5), `public/scripts/comp/wmYouTube.js`.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

The account is the household admin's. Reads need `admin` or `dev_admin`; signing in or out and every save need `admin`.
Sign-in is Google's device flow with the server's own OAuth client (Service key `youtube`, else the one
VisionCaster holds), scope `youtube.readonly`. Tokens never go to a client.

## Packet index

| Request | Body -> reply |
|---|---|
| `youtube_get` | `{}` -> `{ state }` (what the server holds: the feed items below plus `quota: { used, budget }`) |
| `youtube_signin` | `{}` -> `{ signIn: { userCode, url, expiresAt } }`. Starts the device sign-in; the server waits on Google. Admin. |
| `youtube_signin_cancel` | `{}` -> `{ cancelled }`. Admin. |
| `youtube_signout` | `{}` -> `{ state }`. Forgets and revokes the sign-in; favourites are kept. Admin, destructive. |
| `youtube_subscriptions` | `{ fresh? }` -> `{ channels[] }`, A to Z (kept 6 hours) |
| `youtube_feed` | `{ fresh? }` -> `{ videos[], at, channels, partial, refreshing }`: the newest uploads of every subscribed channel, newest first, the ones marked watched after the rest. Answered at once from what the server holds; when that is older than 10 minutes (2 with `fresh`) a look for new uploads runs behind it (`refreshing: true`) and the status feed's `feed.at` moves when it is done. Cost of a look: the subscriptions pass (1 unit per 50 channels, it carries each channel's video count); only channels whose count moved are read, from YouTube's public channel feeds (no quota; `playlistItems` when the feeds are down). |
| `youtube_watch_later` | `{ fresh? }` -> `{ videos[], unavailable, why, partial }`: the videos added through `youtube_later`, with the account's own list when the server's Alchemy browser can read it (`modules/youtubeAlchemy.js`: a hidden tab, closed again; no cookie leaves the browser). `why`: `browser-signin` (Alchemy is not signed in to YouTube) or `browser-offline`; the list is then only what was added here, and `unavailable` is true when that is nothing. |
| `youtube_import_bell` | `{}` -> `{ why, favourites[], channels, found, added, left, partial }`. Every subscribed channel whose notification bell is set to All becomes a favourite (read in the same browser). Admin. |
| `youtube_kick_add` | `{ name }` -> `{ channel: { slug, name, thumb }, live, channels[] }`. A Kick channel by the name in its address; needs Service key `kick` (a Kick developer app's Client ID and secret; errors `KICK_NO_KEY`, `KICK_KEY`, `KICK_NOT_FOUND`, `KICK_BAD_NAME`). Admin. |
| `youtube_kick_remove` | `{ slug }` -> `{ channels[] }`. Admin. |
| `youtube_apps_save` | `{ apps: [{ package, label }] }` -> `{ apps[] }`: the Android apps whose notifications (relayed by a partnered phone over ActiveSync, `notify.posted`) become feed items. Admin. |
| `youtube_notice_remove` | `{ id }` -> `{ removed }`: takes an imported notification (`app:<n>`) out of the feed. Admin. |
| `youtube_mark` | `{ id, watched }` -> `{ id, watched, youtube }`. Mark as Watched / Unwatched in the account's own YouTube watch history, through the Alchemy browser (watched: the two reports the player makes for a video played to its end; unwatched: the history entry's Remove from watch history). `youtube`: `done`, `failed`, `not-found`, `browser-signin`, `browser-offline`; a mark is kept on the server while the browser cannot be reached. Admin. |
| `youtube_later` | `{ id, on }` -> `{ id, later, youtube }`. Add to / remove from Watch Later: always kept on the server; `youtube` says what happened on the account's own list through the Alchemy browser: `done`, `failed`, `browser-signin`, `browser-offline`. Admin. |
| `youtube_search` | `{ query, page? }` -> `{ query, videos[], channels[], next }` (100 quota units a page; answers kept 10 minutes) |
| `youtube_channel` | `{ id }` -> `{ channel, videos[], favourite, subscribed }` |
| `youtube_favourite` | `{ channel: { id, title, thumb }, on }` -> `{ favourites[] }`. Admin. |
| `youtube_favourites_order` | `{ ids[] }` -> `{ favourites[] }`. Admin. |
| `youtube_settings_save` | `{ settings: { noShorts?, rareFirst?, todayCount? } }` -> `{ settings }`. Admin. |

A video is `{ id, title, channel, channelId, thumb, at, length, live, watched, progress, later }`. `watched` and `progress` come from the account's watch history, read in the Alchemy browser at most every 10 minutes (played 60 % or more = watched; less = `progress` percent). `members: true` marks a members-only video of a channel the account pays a membership on (the Memberships page is read in the Alchemy browser once a day; those channels' members-only lists are read with their public ones). Other fields: (`at` in ms, `length` in seconds or null,
`live`: `''`, `live` or `upcoming`). A channel is `{ id, title, thumb }`.

Errors carry a code: `YOUTUBE_SIGNIN` (not signed in, or Google ended the sign-in), `YOUTUBE_NO_CLIENT`,
`YOUTUBE_BUDGET` (the server's own daily unit budget, `settings.budget`, 6,000), `YOUTUBE_QUOTA` (Google's),
`YOUTUBE_API_OFF`, `YOUTUBE_NOT_FOUND`, `YOUTUBE_NETWORK`, `YOUTUBE_BAD_CHANNEL`, `YOUTUBE_BAD_QUERY`,
`YOUTUBE_FAVOURITES_FULL`.

## Sources beside YouTube (Yozora #861)

Logic in `modules/videosSources.js`. Items look like videos with `source` (`youtube`, `kick`, `app`):

- Kick: `{ id: 'kick:<slug>', source: 'kick', live: 'live', title, channel, thumb, at (stream start), viewers, note (category), url }`,
  only while the channel is live. Kick's published API with the app key, one call for up to 50 channels, at most
  every 3 minutes and only while a phone shows the feed or Today.
- App notifications: `{ id: 'app:<n>', source: 'app', title, channel (the app's name), note (the text), at, package, key, device }`.
  `key` and `device` are set when the phone said the notification `opens` something (DSApp `notify.open` /
  `AndroidActiveSync.openNotification(key)`): on that phone a tap opens what the notification opens; elsewhere it starts the app.

`youtube_feed` answers one list: what is live first (Kick, and YouTube videos that are live), then uploads and
imported notifications by time, watched or read ones after the rest. `youtube_mark` on a `kick:` or `app:` id is
the program's own mark (hide a stream, mark a notification read).

## Watching a Kick stream in the program (Yozora #918)

Logic in `modules/videosKickRelay.js`. The server pulls a listed Kick channel's live stream and serves it as HLS
the program's own player plays (hls.js, `public/dist/hlsjs`): 4 s pieces, the newest 15 kept.

| Request | Body -> reply |
|---|---|
| `youtube_live_modes` | `{}` -> `{ modes: [{ id, label, note, kbit, heavy }] }` |
| `youtube_live_start` | `{ slug, mode }` -> `{ id, url, mode, state, source: { height, fps, kbit }, modes }`. Starts the relay or joins the one running; answers once the list has pieces. Another mode of the same channel replaces its session; at most two streams run. Errors `KICK_NOT_LISTED`, `KICK_OFFLINE`, `KICK_STREAM`, `KICK_PAGE`, `ALCHEMY_OFFLINE`. Admin. |
| `youtube_live_state` | `{ id }` -> `{ state: 'live' \| 'restarting' \| 'ended' \| 'error' \| 'gone', error }`. Admin. |
| `youtube_live_stop` | `{ id }` -> `{ stopped }`. Admin. |

`GET /api/videos/live/<id>/index.m3u8` and `/s<n>.ts` (signed-in session): the stream. A session ends by itself
45 s after the last request. Modes: `480`, `360`, `160` pass Kick's own renditions through (no encoding);
`hw720`, `hw540` are hardware re-encodes at 30 fps; `e480`, `e360` are careful software encodes at a low
bitrate (about two processor threads each); `audio` is one picture a second with full sound.

The stream's address is only on the channel's Kick page: the Alchemy browser reads it in a hidden tab (nothing
is played there). Yukimi allowed that step herself; `scripts/kick-stream-probe.js` is the same read for tests.

## Status feed (pushed, never polled)

`status_subscribe { feed: 'youtube' }` while the Today item or the program is on screen answers
`{ items: { account, favourites, latest, live, sources, settings, feed } }` once; after that `youtube_status { changed }` carries only
the keys that changed (a sign-in starting or finishing, a favourite added, a new upload). `status_unsubscribe`
when the view goes. The feed's one server timer runs only while someone is subscribed; every 15 minutes it asks for the
favourites' video counts (1 unit per 50 channels) and reads only the channels that uploaded.

- `account`: `{ configured, signedIn, account: { id, title, thumb } | null, signIn: { userCode, url, expiresAt } | null, error }`
- `favourites[]`: the channels whose uploads Today shows
- `latest`: `{ videos[], caughtUp }`, the favourites' uploads that are not watched yet, as one list (`settings.todayCount` at most; `caughtUp` when there are uploads but all were watched). With `settings.rareFirst` (default) a video's age counts in units of its channel's usual gap between uploads, so channels that upload seldom come first; off: newest first. Each video also has `gap` (ms since that channel's upload before it, or null).
- `live`: `{ items[] }`, the Kick channels that are live now (Today shows them first)
- `sources`: `{ kickReady, kick: [{ slug, name, thumb, live }], apps: [{ package, label }], seenApps: [{ package, label }] }` (`seenApps`: apps that posted a notification lately, offered for choosing)
- `settings`: `{ noShorts, rareFirst, todayCount, budget }`
- `feed`: `{ at }`, when the subscriptions feed or the watched marks last changed (read `youtube_feed` again when it moves)
