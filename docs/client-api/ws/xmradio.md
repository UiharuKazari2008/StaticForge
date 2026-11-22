# XM Radio (client WS)

The skeuomorphic SiriusXM radio (Yozora #989; `apps/xmradio`, server `modules/xmRadio.js`; its HTTP routes are in [../rest-api.md](../rest-api.md#xm-radio); packets in
`modules/ws/handlers/318-xmRadioHandler.js`). The SiriusXM account is the administrator's. `admin` and `dev_admin`
tabs listen; only admins sign in, sign out or store presets.

## Packets

| Packet | Request | Reply |
| --- | --- | --- |
| `xmradio_get` | `{}` | `{ account }` |
| `xmradio_signin_status` | `{ handle }` | `{ hasPassword, hasPasskey, contacts[{ type, masked }] }` (admins) |
| `xmradio_signin` | `{ handle, password }` | `{ account }` (admins). Signs in and keeps the login as the CardSpace card. |
| `xmradio_signin_card` | `{}` | `{ account }` (admins). Signs in with the CardSpace card (`apiKeyManager` service `siriusxm`). |
| `xmradio_signin_browser` | `{}` | `{ url }` (admins). A one-time sign-in page (10 minutes) for Alchemy, where 1Password can fill it. |
| `xmradio_signin_browser_cancel` | `{}` | `{ account }` (admins) |
| `xmradio_signout` | `{}` | `{ account }` (admins). The card stays in CardSpace; no automatic sign-in until Sign In is chosen. |
| `xmradio_lineup` | `{ fresh? }` | `{ channels[{ id, number, name, sub?, logo? }], presets { A, B, C } }`. Read once a month; `fresh` reads it now. |
| `xmradio_logos` | `{ ids[] }` | `{ logos, backgrounds: { channelId: url } }`. Each channel's logo (transparent PNG) and its genre background picture, read from its channel page when first asked, then kept. |
| `xmradio_presets_set` | `{ presets { A, B, C: [channelId \| null] x10 } }` | `{ presets }` (admins). Shared by every radio. |
| `xmradio_tune` | `{ channelId, quality? }` | `{ sid, url, quality, channel { id, type, logo } }`. `quality` is one of `hi` / `std` / `low` (SiriusXM's 256k / 128k / 32k; our master names only that variant) or `eco24` / `eco16` (Opus re-encoded on the server). Errors: `XMRADIO_SIGNED_OUT`, `XMRADIO_NOT_SUBSCRIBED`. |

`account` is `{ signedIn, expired, handle (masked), since, browserSignIn, card, cardRefused }`. `sub: false` marks a
channel outside the account's plan: a tune of it answered not-entitled.

## Pushes

Status feed `xmradio` (`status_subscribe { feed: 'xmradio' }` while a radio is on, or waiting for a sign-in). It answers
`{ account, lineup { at, n }, 'ch:<channelId>': { a, t, s, ad, i } }` once. After that, `xmradio_status { changed }`
pushes only the items that changed:

- `a`: artist
- `t`: title
- `s`: show
- `ad`: a commercial
- `i`: art URL

It is read from SiriusXM's public lookAround every 20 s while subscribed. Nothing polls from the client.

## The cassette deck

Recordings are made on the server (`modules/xmRadioRecorder.js`), into the workspace's `Recordings` folder, one
folder per tape. They run without a client, for up to 8 hours, at 256 kbit/s, and are finished into the tape when the
server starts again. The deck's SPLIT switch picks the file layout:

- `song`: one tagged `.m4a` per cut (title, artist, album = the channel, the cover), cut at the exact AAC frame where
  lookAround says the cut changed. A cut the recording joined late is marked "(partial)".
- `long`: one `.m4a` with a chapter per cut.

| Packet | Who | Data | Reply |
| --- | --- | --- | --- |
| `xmradio_deck_get` | admin, dev_admin | `{ workspaceId? }` | `{ deck, tapes[] }` |
| `xmradio_deck_set` | admin | `{ tape?, workspaceId?, mode? }` (`song` or `long`) | `{ deck }` |
| `xmradio_tape_tracks` | admin, dev_admin | `{ workspaceId, tape }` | `{ tracks[{ id, name, size, at }] }`, played with `vfs_download_file` |
| `xmradio_rec_start` | admin | `{ channelId, song?, fromStart? }` | `{ rid, channelId, kind, mode, tape, since, until, url, cut }` |
| `xmradio_rec_range` | admin | `{ channelId, from, to, a, t, s, ik }` | `{ rid, queued, position, queue[] }`: queues one song from Recently Played (five-hour buffer) |
| `xmradio_queue_remove` | admin | `{ id }` | `{ queue[] }`: cancel one queued song |
| `xmradio_queue_clear` | admin | `{}` | `{ queue[] }`: cancel every queued song |
| `xmradio_rec_stop` | admin | `{ rid }` | `{ rid, filed }` |
| `xmradio_timers_set` | admin | `{ timers[{ id?, channelId, start 'HH:MM', minutes, days[0-6], date?, mode?, off? }] }` | `{ timers }` |
| `xmradio_alert_add` | admin | `{ kind: 'artist' \| 'song', artist, title?, channelId? }` | `{ alerts }` |
| `xmradio_alert_remove` | admin | `{ id }` | `{ alerts }` |
| `xmradio_terms_set` | admin | `{ terms[{ id?, text, channelId? }] }` | `{ terms }` |

`deck` is `{ tape, workspaceId, mode, recordings[], timers[], alerts[], terms[], queue[] }` and is also the `deck` item
of the `xmradio` status feed (pushed when it changes). A queue entry is
`{ id, channelId, from, to, a, t, s, expiresAt, addedAt }`; the queue runs in expiry order — a song about to leave the
five-hour buffer goes first, ties keep the order they were added — and starts the next entry whenever a recorder slot
frees. It lives in the service's state file, so it survives a recorder restart.

Auto-record:

- Timers start on a single `setTimeout` to the next start, re-armed at most a day ahead.
- Alerts (an artist or a song, set from the radio's MENU > Alert) and search terms (every word must appear in the
  artist, title or show) are matched on every lookAround read. A match records that cut from its first frame (the
  stream keeps 5 hours) into the current tape.
- The server reads lookAround through one timer, only while a recording, an alert or a term exists. It backs off when
  SiriusXM does not answer.

## Phones (Melaton Mobile, `wmXmRadio.js`)

- The phone subscribes to statusHub feed `xmradio_phone` instead of `xmradio`. It carries only:
  - `account { signedIn }` and `lineup { at }`;
  - `rec[{ rid, channelId, kind, since, back, a, t, ad }]` (back: seconds it reached behind live when it started; a / t /
    ad: what it records now) and `queue[{ id, channelId, from, to, a, t, expiresAt, addedAt }]` (the stacked Recently
    Played songs). The phone's status bar tape (`xmrec`) and its popup read the same list; the app's status-bar task
    gets it as the `xmrec` field of `status.snapshot` (modules/phoneStatus.js).
  - The phone radio's `window.wmXmRadio` (recordings, readRecordings, monitoring, monitor, mute, cancel, open) is what
    wmShell's tape popup calls: Monitor plays `/api/xmradio/rec/<rid>/index.m3u8` through the radio's player, Cancel
    sends `xmradio_rec_stop`.
  - `ch:<id> { a, t, s, ad, i, at }` for the presets of every bank and the channels the phone names.
- `xmradio_phone_watch { channels[] }` (up to 12; fire and forget, kept per socket) names those channels: the one it
  plays and Today's pages.
- One-touch Record: `xmradio_rec_start { channelId, song: true, fromStart }`. It records the cut on air into the deck's
  tape, from its first frame when `fromStart` (the stream keeps five hours), and stops when the cut ends. The phone
  always asks first.
- Recently Played's hold menu has Play and Record. Play jumps to the song's start as a tap does; Record is one tap with
  no question and sends `xmradio_rec_range { channelId, from, to, a, t, s, ik }` — that song, from the stream's
  five-hour buffer, tagged with the artist, title, show and art key that came with `xmradio_schedule`. Record queues the
  song rather than starting it on the spot: several can be stacked, in expiry order (soonest expiry first, then added).
  The Recordings tab shows the queue (Queued) with a Cancel for each and a Clear all; `xmradio_queue_remove` and
  `xmradio_queue_clear` cancel them.
- The deck's REC: `xmradio_rec_start { channelId, fromStart }` (no `song`) records the channel until STOP (up to 8 hours),
  from the first frame of the song or show on air when `fromStart`, else from now. The desktop deck and the phone's
  deck ask first.
- The phone program has three tabs: Now Playing, Channels and Recordings.
  - Now Playing uses `xmradio_schedule { channelId }`, which returns
    `{ now { a, t, at, dur, i, s, sa, sd, ik }, played[{ a, t, at, dur, i, s, sa, sd, ik }], shows[] }`.
    It reads liveUpdate for the last hour (it pages about a dozen songs at a time, followed up to now) and the next
    8 hours. Durations are in seconds. Songs are known only once they air; shows appear ahead only where SiriusXM
    schedules them. `s` / `sa` / `sd` are the programme on at the song's start (name, start ms, length s) and `ik` is
    its art key. The panel shows the song's progress, the show on now or up next, and Recently Played: each song row
    names the show beside the artist and can be held for Play / Record.
  - Recordings lists the tapes and their recordings, plays them (`GET /api/xmradio/track/<fileId>`), and manages them
    with `xmradio_tape_new`, `xmradio_tape_rename`, `xmradio_tape_delete`, `xmradio_track_rename`,
    `xmradio_track_delete` and `xmradio_track_move` (see the handler's header). Deleting moves to the Recycle Bin.
- Round 3 adds the following.
  - Replay: `xmradio_tune { back }` starts that many seconds behind live (#EXT-X-START in our copy of the media
    playlists). Recently Played jumps to a song's start (and holds for Play / Record); a last-hour bar seeks; LIVE returns.
  - `xmradio_search { q }` searches what is on now.
  - `xmradio_guide` gives each channel's genre. It is SiriusXM's own where its web player's channel list gives one
    (only that list's first page could be read); otherwise it is placed by the channel's name and description. Pages not
    yet read are filled in the background.
  - `xmradio_deck_get { info: true }` adds each tape's count and length; tape tracks carry `dur`.
  - The app's own player:
    - `GET /api/xmradio/channel/<id>.m3u8?q&back` tunes and redirects, so next / previous work with the page asleep;
    - `GET /api/xmradio/now/<id>` gives the song for its notification, read again when the song is due to end;
    - `AndroidVideos.sleep(min)` is the sleep timer;
    - `AndroidVideos.saveRecording(url, name, tape)` saves a recording to Music/XM Radio/<tape>.
  - Wake to the radio: an alarm whose sound is `xmradio:<channelId>` (Settings > Clock & Alarms). The app plays
    `/api/xmradio/channel/<id>.m3u8` in its player; a page in front sends `xmradio:alarm`.
- Sound: the Dreamscape app's native player (`AndroidVideos`, sound only) plays `/api/xmradio/live/...`,
  `/api/xmradio/eco/...` and `/api/xmradio/track/...` (a progressive .m4a). A page without it plays with hls.js.

## HTTP

- `GET /api/xmradio/live/<sid>/m/<path>`: the tuned stream's folder on SiriusXM's server, mirrored. The playlists'
  relative lines pass through unchanged, and the key line points at `/api/xmradio/key/<sid>/<keyId>`.
- `GET /api/xmradio/key/<sid>/<keyId>`: the AES-128 key (16 bytes), fetched with the account's token.
- `GET /api/xmradio/art?k=<key>&s=<px>[&f=png]`: SiriusXM art (covers, channel logos, backgrounds) at our own origin. `f=png` keeps a logo's transparency.
- `GET /api/xmradio/eco/<rid>/<file>`: the ECO relay. The channel's 128k stream goes through the segment pump (`modules/xmRadioPump.js`: fetched, decrypted, ID3 stripped) into ffmpeg, which writes Opus at 24 or 16 kbit/s as fMP4 HLS (4 s pieces, an hour kept). One relay per channel and rate is shared, and it stops two minutes after nobody asks for it.
- `GET /api/xmradio/rec/<rid>/index.m3u8` and `/api/xmradio/rec/<rid>/s<seq>.aac`: a recording in progress as an
  EVENT playlist that grows, with its decrypted segments. Everything recorded so far can be paused and rewound; the
  radio plays it while the deck records. It answers for 10 minutes after the recording stops.
- `GET|POST /xmradio-signin/<code>`: the one-time sign-in page. It is mounted ahead of the site gate; any other code
  answers 404.

Test: `node scripts/test-xmradio.js`.

## The recorder service

Recordings run in their own process, pm2 app `xmradio-recorder` (`services/xmradio-recorder/server.js`), so a
Dreamscape restart never stops one (Yukimi, Nov 21 2026). `./restart` and `./reload` restart Dreamscape only.

- It runs `modules/xmRadioRecorder.js` in its capture role: the pumps, segments, song splitting, scheduled
  recordings, alerts and search terms, and the state file `.cache/xmradio-recorder.json`.
- Dreamscape (`modules/xmRadioRecorderClient.js`) talks to it over the Unix socket `.cache/xmradio-recorder.sock`
  (mode 0600, one JSON object per line). It sends commands and keeps the deck the service pushes after every change.
  The WebSocket packets above are unchanged.
- SiriusXM refuses a session started from a second process, so the service never signs in. Dreamscape sends it its
  access token (op `auth`) when it connects, before each recording starts, and ten minutes before the token expires.
  The service never writes the account or lineup files.
- Finished files go to the spool `.cache/xmradio-spool/<id>.m4a` + `.json`. Dreamscape files them onto the tape, at
  once or when it is back, because it owns the file store.
- When the service itself restarts, it saves its recordings first. Each one then carries on as the same recording
  from where it left off: the stream keeps five hours, so the gap is read back.
- Playlists of a recording in progress list only segments already on disk, and start players three segments behind
  the edge (`#EXT-X-START`).
- Recordings are always made at High (256k). The quality a radio chooses only changes what that radio plays.

