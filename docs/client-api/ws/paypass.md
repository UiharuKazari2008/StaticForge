# WebSocket: PayPass Operator (openCreditIC)

Server handler: `modules/ws/handlers/299-paypassHandler.js` (logic in `modules/paypass.js`).
Client: `apps/paypass/client/paypass.js` (Melaton system package `apps/paypass`, Start > AmusementVISION 2024 > PayPass Operator). Yozora #721.

The front-desk program for openCreditIC (github.com/UiharuKazari2008/openCreditIC), the arcade's IC card and
credit system. It ports openCreditIC's Sequenzia interface ("payPass Manager", `web/views/home-seqapp.pug` +
`web/static/js/sideloader.js`).

openCreditIC's API is all GET, with the web key sent as `?key=`. The server holds the key. The client sends an
operation name and its fields; `modules/paypass.js` validates them (customer ID `[A-Za-z0-9._@+-]{1,64}`, card
serial hex, POS MAC, credits > 0, hours) and builds the path.

Every packet is admin only (`admin`, `dev_admin`). A failure comes back in the `_response` as
`data.error: { message, details, code }`, not as an error packet.

## Config

`.cache/packages/.data/paypass/config.json` (not in git; `PAYPASS_DATA_DIR` overrides it in tests):

| Field | |
|---|---|
| `url` | openCreditIC's address, e.g. `http://card-services.nyti.ne.jp:1777` |
| `key` | its `web_key` |
| `currencyRate`, `currencySymbol` | Optional: yen per credit (default 100) and the symbol (default yen). openCreditIC's API does not expose `credit_to_currency_rate`; the rate is used only when its dashboard shows yen. |

## Packets

| Request type | Fields | Reply `data` |
|---|---|---|
| `paypass_info` | none | `{ configured, server }` |
| `paypass_overview` | none | `{ arcade, pos: [{ mac, name }], freePlay, machines, users, pending, currency, at }` |
| `paypass_customer` | `id` or `card` | `{ id, name, contact, notes, credits, locked, freePlay, freePlayUntil, created, cards, history, topups }`. History and top-ups are newest first, at most 200 each. |
| `paypass_action` | `op` + fields (below) | `{ ok, code, message, scan, lookup }` |
| `paypass_wait` | `pos`, `lookup?` | `{ done, customer?, message? }`. The card a scan op asked for, up to 45 s. The wait (`/wait_pending`, or `/wait_data` for a lookup) is started by `paypass_action` the moment it arms the reader: openCreditIC's `/wait_data` refuses once the tap has cleared the pending command, so a wait sent after a quick tap lost the customer. With no card, it cancels the reader's pending command. |

Each `machines[]` entry is `{ mac, name, freePlay, plays, last, session, day, active }`:
- `last`: `{ userName, cost, freePlay, ok, time }`
- `session`: back-to-back plays within an hour, `{ count, start, end, total }`
- `day`: the last 24 h, `{ users, plays, earned }`

Each `users[]` entry is `{ id, name, credits, locked, freePlay, cards, plays, lastPlay }`.
- `id` is null for a customer with no card: `/get/user` has no id field, so the id comes from the cards.

The API has no JSON route for machines or arcade settings. `overview` reads them from openCreditIC's pages:
- `/` gives the arcade name, the POS terminals and whether yen is shown.
- `/get/free_play` gives the machine names and their free-play state.

## Operations (`paypass_action`)

| `op` | Fields | openCreditIC route |
|---|---|---|
| `deposit` | `target: user\|card\|scan`, `id` / `card` / `pos`, `credits` | `/deposit/user\|card\|scan/...` |
| `freeplay` | `target`, `id` / `card` / `pos`, `hours?`, `enable?` | `/set/user\|card/freeplay/.../enable\|disable`, `/scan/freeplay/:pos` |
| `register` | `pos` or `card`, `id?`, `credits?`, `name`, `contact`, `notes`, `cardName`, `cardContact` | `/register/scan/:pos[/:id]`, `/register/new/:id\|NULL/:card` |
| `addcard` | `pos`, `id` | `/register/scan/:pos/:id` |
| `transfer` | `pos` | `/reassign/scan/:pos` (tap the old card, then the new one) |
| `lookup` | `pos` | `/get/scan/:pos`, then `paypass_wait` with `lookup` |
| `updateuser` | `id`, `name`, `contact`, `notes`, `freePlay` | `/update/user/:id` (every field sent) |
| `updatecard` | `card`, `name`, `contact` | `/update/card/:card` (every field sent) |
| `lockuser` / `lockcard` | `id` / `card`, `lock` | `/set/user\|card/lock/.../enable\|disable` |
| `deleteuser` / `deletecard` | `id` / `card` | `/delete/user\|card/...` |
| `arcadefreeplay` | `enable`, `hours?` | `/set/arcade/freeplay/...` |
| `machinefreeplay` | `mac`, `enable`, `hours?` | `/set/machine/freeplay/:mac/...` |
| `revokefreeplay` | none | `/disable_freeplay/user` |
| `cancel` | `pos` | `/cancel_pending/:pos` |

A reply with `scan: true` means the POS reader is armed: the client shows "Scan card now!" and calls
`paypass_wait`.

Fixed from the original client:
- Free play by customer ID or card serial sent `enabled`, which openCreditIC reads as off. This port sends `enable`.
- The update routes delete every field a request leaves out, so this port always sends all of them.

Not ported:
- Books, a dead link in the original.
- Machine cost, discount, cooldown and callback settings, which have no UI in the Sequenzia interface either.
