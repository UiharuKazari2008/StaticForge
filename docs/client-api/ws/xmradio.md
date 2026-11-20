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

## HTTP

- `GET /api/xmradio/live/<sid>/m/<path>`: the tuned stream's folder on SiriusXM's server, mirrored. The playlists'
  relative lines pass through unchanged, and the key line points at `/api/xmradio/key/<sid>/<keyId>`.
- `GET /api/xmradio/key/<sid>/<keyId>`: the AES-128 key (16 bytes), fetched with the account's token.
- `GET /api/xmradio/art?k=<key>&s=<px>[&f=png]`: SiriusXM art (covers, channel logos, backgrounds) at our own origin. `f=png` keeps a logo's transparency.
- `GET /api/xmradio/eco/<rid>/<file>`: the ECO relay. The channel's 128k stream goes through the segment pump (`modules/xmRadioPump.js`: fetched, decrypted, ID3 stripped) into ffmpeg, which writes Opus at 24 or 16 kbit/s as fMP4 HLS (4 s pieces, an hour kept). One relay per channel and rate is shared, and it stops two minutes after nobody asks for it.
- `GET|POST /xmradio-signin/<code>`: the one-time sign-in page. It is mounted ahead of the site gate; any other code
  answers 404.

Test: `node scripts/test-xmradio.js`.
