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
| `youtube_feed` | `{ fresh? }` -> `{ videos[], at, channels, partial, refreshing }`: the newest uploads of every subscribed channel, newest first, the ones marked watched after the rest. Answered at once from what the server holds; when that is older than 10 minutes (2 with `fresh`) a look for new uploads runs behind it (`refreshing: true`) and the status feed's `feed.at` moves when it is done. Cost of a look: the subscriptions pass (1 unit per 50 channels, it carries each channel's video count); only channels whose count moved are read, from YouTube's public channel feeds (no quota; `playlistItems` when the feeds are down). |
| `youtube_watch_later` | `{ fresh? }` -> `{ videos[], unavailable, why, partial }`: the videos added through `youtube_later`, with the account's own list when the server's Alchemy browser can read it (`modules/youtubeAlchemy.js`: a hidden tab, closed again; no cookie leaves the browser). `why`: `browser-signin` (Alchemy is not signed in to YouTube) or `browser-offline`; the list is then only what was added here, and `unavailable` is true when that is nothing. |
| `youtube_import_bell` | `{}` -> `{ why, favourites[], channels, found, added, left, partial }`. Every subscribed channel whose notification bell is set to All becomes a favourite (read in the same browser). Admin. |
| `youtube_mark` | `{ id, watched }` -> `{ id, watched, youtube }`. Mark as Watched / Unwatched in the account's own YouTube watch history, through the Alchemy browser (watched: the two reports the player makes for a video played to its end; unwatched: the history entry's Remove from watch history). `youtube`: `done`, `failed`, `not-found`, `browser-signin`, `browser-offline`; a mark is kept on the server while the browser cannot be reached. Admin. |
| `youtube_later` | `{ id, on }` -> `{ id, later, youtube }`. Add to / remove from Watch Later: always kept on the server; `youtube` says what happened on the account's own list through the Alchemy browser: `done`, `failed`, `browser-signin`, `browser-offline`. Admin. |
| `youtube_search` | `{ query, page? }` -> `{ query, videos[], channels[], next }` (100 quota units a page; answers kept 10 minutes) |
| `youtube_channel` | `{ id }` -> `{ channel, videos[], favourite, subscribed }` |
| `youtube_favourite` | `{ channel: { id, title, thumb }, on }` -> `{ favourites[] }`. Admin. |
| `youtube_favourites_order` | `{ ids[] }` -> `{ favourites[] }`. Admin. |
| `youtube_settings_save` | `{ settings: { noShorts?, rareFirst?, todayCount? } }` -> `{ settings }`. Admin. |

A video is `{ id, title, channel, channelId, thumb, at, length, live, watched, progress, later }`. `watched` and `progress` come from the account's watch history, read in the Alchemy browser at most every 10 minutes (played 60 % or more = watched; less = `progress` percent). Other fields: (`at` in ms, `length` in seconds or null,
`live`: `''`, `live` or `upcoming`). A channel is `{ id, title, thumb }`.

Errors carry a code: `YOUTUBE_SIGNIN` (not signed in, or Google ended the sign-in), `YOUTUBE_NO_CLIENT`,
`YOUTUBE_BUDGET` (the server's own daily unit budget, `settings.budget`, 6,000), `YOUTUBE_QUOTA` (Google's),
`YOUTUBE_API_OFF`, `YOUTUBE_NOT_FOUND`, `YOUTUBE_NETWORK`, `YOUTUBE_BAD_CHANNEL`, `YOUTUBE_BAD_QUERY`,
`YOUTUBE_FAVOURITES_FULL`.

## Status feed (pushed, never polled)

`status_subscribe { feed: 'youtube' }` while the Today item or the program is on screen answers
`{ items: { account, favourites, latest, settings, feed } }` once; after that `youtube_status { changed }` carries only
the keys that changed (a sign-in starting or finishing, a favourite added, a new upload). `status_unsubscribe`
when the view goes. The feed's one server timer runs only while someone is subscribed; every 15 minutes it asks for the
favourites' video counts (1 unit per 50 channels) and reads only the channels that uploaded.

- `account`: `{ configured, signedIn, account: { id, title, thumb } | null, signIn: { userCode, url, expiresAt } | null, error }`
- `favourites[]`: the channels whose uploads Today shows
- `latest`: `{ videos[] }`, the favourites' uploads as one list (`settings.todayCount` at most). With `settings.rareFirst` (default) a video's age counts in units of its channel's usual gap between uploads, so channels that upload seldom come first; off: newest first. Each video also has `gap` (ms since that channel's upload before it, or null).
- `settings`: `{ noShorts, rareFirst, todayCount, budget }`
- `feed`: `{ at }`, when the subscriptions feed or the watched marks last changed (read `youtube_feed` again when it moves)
