# XM Radio (client WS)

The skeuomorphic SiriusXM radio (Yozora #989; `apps/xmradio`, server `modules/xmRadio.js`, packets in
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
| `xmradio_rec_stop` | admin | `{ rid }` | `{ rid, filed }` |
| `xmradio_timers_set` | admin | `{ timers[{ id?, channelId, start 'HH:MM', minutes, days[0-6], date?, mode?, off? }] }` | `{ timers }` |
| `xmradio_alert_add` | admin | `{ kind: 'artist' \| 'song', artist, title?, channelId? }` | `{ alerts }` |
| `xmradio_alert_remove` | admin | `{ id }` | `{ alerts }` |
| `xmradio_terms_set` | admin | `{ terms[{ id?, text, channelId? }] }` | `{ terms }` |

`deck` is `{ tape, workspaceId, mode, recordings[], timers[], alerts[], terms[] }` and is also the `deck` item of the
`xmradio` status feed (pushed when it changes).

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
    ad: what it records now). The phone's status bar tape (`xmrec`) and its popup read the same list; the app's
    status-bar task gets it as the `xmrec` field of `status.snapshot` (modules/phoneStatus.js).
  - The phone radio's `window.wmXmRadio` (recordings, readRecordings, monitoring, monitor, mute, cancel, open) is what
    wmShell's tape popup calls: Monitor plays `/api/xmradio/rec/<rid>/index.m3u8` through the radio's player, Cancel
    sends `xmradio_rec_stop`.
  - `ch:<id> { a, t, s, ad, i, at }` for the presets of every bank and the channels the phone names.
- `xmradio_phone_watch { channels[] }` (up to 12; fire and forget, kept per socket) names those channels: the one it
  plays and Today's pages.
- One-touch Record: `xmradio_rec_start { channelId, song: true, fromStart }`. It records the cut on air into the deck's
  tape, from its first frame when `fromStart` (the stream keeps five hours), and stops when the cut ends. The phone
  always asks first.
- The deck's REC: `xmradio_rec_start { channelId, fromStart }` (no `song`) records the channel until STOP (up to 8 hours),
  from the first frame of the song or show on air when `fromStart`, else from now. The desktop deck and the phone's
  deck ask first.
- The phone program has three tabs: Now Playing, Channels and Recordings.
  - Now Playing uses `xmradio_schedule { channelId }`, which returns `{ now { a, t, at, dur }, played[], shows[] }`.
    It reads liveUpdate for the last hour (it pages about a dozen songs at a time, followed up to now) and the next
    8 hours. Durations are in seconds. Songs are known only once they air; shows appear ahead only where SiriusXM
    schedules them. The panel shows the song's progress, the show on now or up next, and Recently Played.
  - Recordings lists the tapes and their recordings, plays them (`GET /api/xmradio/track/<fileId>`), and manages them
    with `xmradio_tape_new`, `xmradio_tape_rename`, `xmradio_tape_delete`, `xmradio_track_rename`,
    `xmradio_track_delete` and `xmradio_track_move` (see the handler's header). Deleting moves to the Recycle Bin.
- Round 3 adds the following.
  - Replay: `xmradio_tune { back }` starts that many seconds behind live (#EXT-X-START in our copy of the media
    playlists). Recently Played jumps to a song's start; a last-hour bar seeks; LIVE returns.
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
