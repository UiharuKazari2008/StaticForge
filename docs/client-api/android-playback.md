# Android playback bridge (`window.AndroidVideos`)

The Dreamscape app has **one native player** (DSApp `videos/VideoPlayback.kt`, media3 in a media session service).
It is how sound keeps going with the screen off and with the page paused, reloaded or killed (StaticForge #1322).
Three phone programs share it: XM Radio (`wmXmRadio.js`), Melaton Videos (`wmYouTube.js`) and Melaton Media
(`wmMedia.js`). No server messages are involved.

The page never relies on running while it sleeps: whatever must carry on with the screen off is either handed to this
player, or the page declares an awake hold for as long as its own player makes the sound.

## Methods

All are synchronous and answer at once. Do not call them from a timer, a render or a per-message handler
(rule `phone-power-client`); the page calls them on user actions, player events and screen or visibility events.

| Method | What it does |
| --- | --- |
| `watching(json)` | The stream the page's player shows now (below). `""` or null: nothing. A report starts nothing by itself. |
| `handOff()` | Starts the player with what **this window** reported. `false` when this window has no report. |
| `popOut()` | The same, in Android's picture-in-picture window (Videos). `"handed"` follows. |
| `stop()` | Ends whatever the player has. `"stopped"` follows. |
| `isActive()` | The player has a stream. |
| `state()` | `off` \| `buffering` \| `playing` \| `paused` \| `retrying`. |
| `position()` | The player's place in the stream (ms), `-1` when it plays nothing. |
| `at(ms, playing)` | A video through the server: where the page's picture is, so a hand-off starts there. |
| `sleep(minutes)` / `sleepAt()` | XM Radio's sleep timer in the player (0: off) / when it stops the sound (epoch ms, 0: none). |
| `saveRecording(url, name, folder)` | Downloads an XM Radio tape recording into `Music/XM Radio/<tape>/`. |
| `musicSupported()` | The player takes a music queue. Absent or `false` (an older app): Melaton Media reports nothing. |
| `musicState()` | `{"index","positionMs","playing"}` while the player holds a **music queue**, else `""`. `playing` means it is meant to play (buffering and retries included). Answers from the moment `"handed"` is sent. |

## `watching(json)`

Common fields: `{ "url", "title", "subtitle", "audioOnly" }`.

- **Videos:** a live relay (`/api/videos/live/…`) or a YouTube video through the server (`/api/videos/yt/…`, sent with
  `vod: true`; its place comes from `at()`).
- **XM Radio:** `/api/xmradio/{live,eco,track,channel}/…`, with `radio: { channels: [{ id, title }], index, q, back }`
  so next / previous work from the media notification with the page asleep.
- **XM Radio Monitor** (a recording in progress): `/api/xmradio/rec/<rid>/index.m3u8`, no `radio` list, so no next /
  previous. The app clears the report when a Monitor ends by itself, and ends it when the playlist stays 404 / 410 for
  2 minutes (an app older than 1.0.3631988 rejects the address and the page's player plays it).
- **Melaton Media:** `audioOnly: true` and
  `music: { items: [{ url, title, artist, album, art }], index, positionMs, repeat, volume }`.
  `url` is `items[index].url`. `items` are **in play order** (the page applies shuffle). Addresses are absolute and are
  either the server's (the page's own origin) or the phone media library's (`AndroidMediaLibrary.baseUrl()`); `art` is
  such an address or `""`, never a `data:` string. A queue is taken whole or not at all. `volume` is 0..100.
  `positionMs` is the place at the time of the call; the app counts on from it.

## Who takes over, and when

- The app takes over by itself when the window that reported pauses on the phone's screen (screen off, or another
  Android app): it starts the player with the report and sends `"handed"`. It does nothing if the player is already
  active, so a program that starts a sound in the page must see that no other program's stream stays on the player.
- XM Radio calls `handOff()` as soon as it tunes, so it plays natively from the start.
- Videos calls `handOff()` when the program is left inside the shell, and `popOut()` from its pop-out key.
- Only sound is carried for music; `onHostStopped` (a minimised DeX window) never takes a music queue.

## News: the `dreamscape:videos` window event

`event.detail` is an object (the page also accepts a JSON string). `"handed"` is about the report the app holds; all
other news is about the stream the player has, and goes to that window. News can be lost while the page is frozen, so
every program reads `state()` / `musicState()` again when the page comes in front.

| `state` | Meaning |
| --- | --- |
| `handed` | The app took over what was reported. The page pauses its own player; it does **not** call `watching("")` or `stop()`. |
| `buffering`, `playing`, `paused`, `retrying` | The player's own state. |
| `track` (`index`) | Music: another item of `music.items` plays now. |
| `channel` (`id`) | XM Radio: next / previous on the player changed channel. |
| `open` | The picture-in-picture window was expanded. |
| `stopped`, `ended` | The player let the stream go (`lost` is also accepted by the page). |

## Sharing the one player

The app keeps the report per window, not per program, so the page does that bookkeeping itself.

| `localStorage` key | Value |
| --- | --- |
| `wmNativeSlot` | Which program made the report the app holds: `media`, `videos`, `xmradio`. |
| `wmNativePlayer` | Which program's stream the player was last given. |

The DeX window's desktop Videos uses `wmNativeSlotDesk` / `wmNativePlayerDesk` (the same origin, another window).

Rules:

1. A program calls `watching("")` only while the slot is its own.
2. It calls `handOff()` / `popOut()` only while the slot is its own.
3. It calls `stop()` only for a stream that is its own, and it reads player news only then. `"handed"` is read only by
   the program that owns the slot.
4. Two window events keep the programs in step:
   - `wmnativeplayer { owner }`: that program's stream is on the player now. The others forget theirs, without
     `stop()` or `watching("")`.
   - `wmphonesound { by }`: that program starts a sound. The others stop theirs (their own native stream included).
     Sent only in the Dreamscape app, never for a muted picture.

## Melaton Media's hand-off

- Reported only while the page's player really plays a song: play, a new song, a seek, queue / Repeat / volume changes
  (coalesced, 150 ms; never on `timeupdate`). A pause, a stop, an error, a video or a song the app cannot have clears
  the report at once.
- The list is at most 200 songs of the play order around the playing one (up to 50 behind). Building it makes no
  request: videos, other sites' addresses and items whose address needs a request are left out. With Shuffle the songs
  after the playing one are shuffled, and that order stays until the queue changes.
- On `"handed"` the page pauses its element, clears `AndroidMediaLibrary` Now Playing (one media notification), drops
  its awake hold and shows the song as playing. `wmMedia.now()` then answers `playing` with `native: true`, which
  `melatonContinuity` does not count as media in the page.
- **Take-back:** the page coming in front (visible, screen on, not behind an Android program) or a control used there
  reads `musicState()`, calls `stop()`, then sets its own player to that song and place and plays if it was playing.
  A control from somewhere else (the DeX window's Transfer) may only stop the player and keep the place.
- **A fresh page:** what was reported is kept in `wmMediaNative`. While `musicState()` answers, `melatonContinuity`
  loads Melaton Media (it is a load-on-demand program) and it shows the queue and its Stop works. Only the reported
  window of songs is known to the new page.

## The page's own player and awake holds

With the screen off the app pauses the page's timers unless something holds it
(`melatonContinuity.holdAwake(reason, on)`). Each program holds exactly while its own page player is the sound,
including buffering, reconnecting and the gap between two songs, and never for what was handed over:

| Reason | Held while |
| --- | --- |
| `media-page` | Melaton Media's element opens or plays a song (not muted). |
| `xmradio-page` | XM Radio plays in the page's hls.js / audio element (tuning included). |
| `videos-live` | Videos' own player is heard, in any mode, YouTube's embedded player included. |

The screen going off pauses nothing that is heard. A paused or muted Videos picture may stop fetching.

Without the native player (an older app, a browser), leaving the Videos program inside the shell still stops its
picture, as does leaving it with YouTube's embedded player, which cannot be handed over.

## Test

`node scripts/test-phone-playback-handoff.js` (the page side against a stubbed bridge).
