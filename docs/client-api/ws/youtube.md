# WebSocket: YouTube

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
| `youtube_feed` | `{ fresh? }` -> `{ videos[], at, channels, partial }`: the newest uploads of every subscribed channel, newest first (kept 20 minutes; 1 quota unit a channel) |
| `youtube_watch_later` | `{ fresh? }` -> `{ videos[], unavailable, why, partial }`. The Data API does not give this list and YouTube's app interface refuses the OAuth sign-in, so the ids are read in the server's Alchemy browser (`modules/youtubeAlchemy.js`: a hidden tab, closed again; no cookie leaves the browser). `why`: `browser-signin` (Alchemy is not signed in to YouTube) or `browser-offline`. |
| `youtube_import_bell` | `{}` -> `{ why, favourites[], channels, found, added, left, partial }`. Every subscribed channel whose notification bell is set to All becomes a favourite (read in the same browser). Admin. |
| `youtube_search` | `{ query, page? }` -> `{ query, videos[], channels[], next }` (100 quota units a page; answers kept 10 minutes) |
| `youtube_channel` | `{ id }` -> `{ channel, videos[], favourite, subscribed }` |
| `youtube_favourite` | `{ channel: { id, title, thumb }, on }` -> `{ favourites[] }`. Admin. |
| `youtube_favourites_order` | `{ ids[] }` -> `{ favourites[] }`. Admin. |
| `youtube_settings_save` | `{ settings: { noShorts?, todayCount? } }` -> `{ settings }`. Admin. |

A video is `{ id, title, channel, channelId, thumb, at, length, live }` (`at` in ms, `length` in seconds or null,
`live`: `''`, `live` or `upcoming`). A channel is `{ id, title, thumb }`.

Errors carry a code: `YOUTUBE_SIGNIN` (not signed in, or Google ended the sign-in), `YOUTUBE_NO_CLIENT`,
`YOUTUBE_BUDGET` (the server's own daily unit budget, `settings.budget`, 6,000), `YOUTUBE_QUOTA` (Google's),
`YOUTUBE_API_OFF`, `YOUTUBE_NOT_FOUND`, `YOUTUBE_NETWORK`, `YOUTUBE_BAD_CHANNEL`, `YOUTUBE_BAD_QUERY`,
`YOUTUBE_FAVOURITES_FULL`.

## Status feed (pushed, never polled)

`status_subscribe { feed: 'youtube' }` while the Today item or the program is on screen answers
`{ items: { account, favourites, latest, settings } }` once; after that `youtube_status { changed }` carries only
the keys that changed (a sign-in starting or finishing, a favourite added, a new upload). `status_unsubscribe`
when the view goes. The feed's one server timer runs only while someone is subscribed and re-reads a
favourite channel's uploads when they are older than 15 minutes.

- `account`: `{ configured, signedIn, account: { id, title, thumb } | null, signIn: { userCode, url, expiresAt } | null, error }`
- `favourites[]`: the channels whose uploads Today shows
- `latest`: `{ videos[] }`, the favourites' newest uploads, newest first (`settings.todayCount` at most)
- `settings`: `{ noShorts, todayCount, budget }`
