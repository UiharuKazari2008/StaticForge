# WebSocket: Plaid bank balances

Server handler: `modules/ws/handlers/177-plaidHandler.js` (logic in `modules/plaidBank.js`). Yozora #1123.
Client: the Wallet's bank balance (Spectra Federal Credit Union and the other linked accounts).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

Admin only: a session user (and any non-`admin` client) gets `{ success: true, restricted: true }`.
The Plaid client keys are the Service key `plaid` (secret as the key, `clientId` as its field). The linked
items are kept in secure config `plaidItems`. An access token never leaves the server.

Only Plaid's free calls are made: `/accounts/get` (Plaid's cached balances, never the billed
`/accounts/balance/get`), `/item/get`, `/institutions/get_by_id`, `/link/token/create`, `/link/token/get`,
`/item/public_token/exchange`. No timer reads balances: a read happens only when a client asks with `refresh`.

## Packet index

| Request | Body -> reply |
|---|---|
| `plaid_status` | `{ requestId, refresh? }` -> `plaid_status_response` `{ requestId, data }` |
| `plaid_link_start` | `{ requestId, itemId? }` -> `plaid_link_start_response` `{ requestId, data }` |
| `plaid_link_cancel` | `{ requestId }` -> `plaid_link_cancel_response` `{ requestId, data: { success: true } }` |

## plaid_status

`data`: `{ success, configured, items[] }` (`configured` is false until the Plaid service key has both parts).

`items[]`: `{ itemId, institutionName, label, status, errorCode?, fetchedAt, accounts[] }`

- `status`: `ok`, `login_required` (the bank wants the sign-in again: re-link with `plaid_link_start` and this `itemId`) or `error` (`errorCode` is Plaid's `error_code`)
- `fetchedAt`: when the balances were last read (null while none was)
- `accounts[]`: `{ accountId, name, officialName, mask, type, subtype, available, current, isoCurrencyCode }` (`available` / `current` are numbers or null)

Without `refresh` the reply comes from what the server holds. With `refresh: true` the items last checked more
than 30 minutes ago are read first: one refresh runs at a time and concurrent callers share it. The reply
waits for it for 12 s at most and otherwise (or when Plaid fails) answers from the saved values.
An item answering `login_required` keeps its last balances.

## plaid_link_start

`data`, on success: `{ success: true, hostedLinkUrl, expiration }`. The phone opens `hostedLinkUrl` (Plaid Hosted
Link, no SDK) in the browser. On failure: `{ success: false, error }` (`NOT_CONFIGURED`, `UNKNOWN_ITEM`,
`NETWORK`, `TIMEOUT` or Plaid's `error_code`).

- With `itemId`: update mode for that item (its access token, no products).
- Without: a new item. This Plaid client is enabled for the products `liabilities` and `transactions` only
  (`auth` answers `INVALID_PRODUCT`), so a new item is created with `liabilities` (then `transactions` when that is refused).
- If Plaid ever refuses `hosted_link` itself, the reply is `{ success: true, hostedLinkUrl: null, linkToken, expiration, hostedLinkError }` and
  the page opens the Link SDK with `linkToken`. The server does not watch that session.

After creating the link the server watches only that session: `/link/token/get` every 5 s until it is finished or
closed, or 30 minutes have passed (one watcher per item; a new start for the same item replaces it). When it
finishes: update mode refreshes that item; a new item has its `public_token` exchanged and is stored. The result
arrives as a `plaid_balances` push.

## plaid_link_cancel

Stops every running link watcher. `data`: `{ success: true }`.

## Broadcast (admin clients, mobile shell)

- `plaid_balances` `{ data }`: `data` is the `plaid_status` object. Sent when a refresh changed a balance, a status
  or the item list, and when a link finished (even if nothing moved). A sleeping phone gets only the newest on waking
  (`DORMANT_HOLD` `last`).
