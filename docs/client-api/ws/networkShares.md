# Network and shared folders (client WS)

Modules: `modules/networkShares.js`, `modules/ws/handlers/317-networkSharesHandler.js` (DreamOS #910, Nov 20 2026).
Client: `public/scripts/comp/explorerNetwork.js` (Explorer's Network folder) and `public/scripts/comp/vistaFileSharing.js`
(the File Sharing wizard, the Sharing tab, Advanced Sharing on a DreamOS computer). The machine side is DreamOS
CaféReady `shares.rs` (the share list, kept on the machine) and the ActiveSync `share` root
([../../activesync-protocol.md](../../activesync-protocol.md#shared-folders-network)).

A DreamOS computer is an ActiveSync device (`platform: 'cafeready'`) but never a portable device, a phone drive or a
Device Center tray line in a page: it is a computer in **Network**, and only the folders it shares are reachable.

| Packet | Direction | Fields | Response `data` |
| --- | --- | --- | --- |
| `net_computers` | client -> server | none | `{ success, self, discovery, computers: [{ deviceId, name, model, os, fileSharing, shares: [{ name, comment, access }] }] }`. Any signed-in socket. From then on the socket is a watcher (until it closes) |
| `net_computers_updated` | server -> client | same shape | Pushed to watchers when their own list changed (a computer came or went, its sharing changed); computed per socket, never on a timer |
| `net_share_call` | client -> server | `{ deviceId, share, op, path?, paths?, name? }` | `{ success, result, access }` or `{ success: false, code, error }` |

**Who sees what** (per socket):

- `self`: the DreamOS computer the page runs on (its socket rides that machine's Miniport, `carrier._dsDevice`), else
  null. It is never in its own list; the page also leaves out `DreamOSShares.deviceId()`.
- `discovery`: that machine's Network discovery. Off: `computers` is empty (it lists nobody), and a machine with
  discovery off is listed to nobody.
- Every online computer with discovery on is listed, whether it shares anything or not (an empty `\\NAME` is an empty
  view). `shares` is filled only while the machine's File sharing is on, and never names a local path.
- `access` is the asking user's: `none | read | change | full`. The user is the session's account: `administrator`
  (an admin session) or `guest` (the guest PIN); administrators are no bypass, shares are user-level. Access = the
  lower of the File Sharing wizard's people level for that account or Everyone (Reader = read, Contributor = change,
  Co-owner / Owner = full; no people at all = no restriction) and Advanced Sharing's permissions (allow minus deny for
  that account or Everyone; deny Read takes everything, deny Change takes Change and Full Control).

**`net_share_call` ops** (relayed to the machine as `storage.<op>` with `{ root: 'share', share, account }`; the machine
checks the same rules again and resolves every path beneath the share's folder):

| `op` | Fields | Needs |
| --- | --- | --- |
| `list` | `path` (inside the share, `/` = its folder) | read |
| `stat` | `path` | read |
| `mkdir` | `path` | change |
| `delete` | `paths: []` | change |
| `rename` | `path`, `name` | change |

Refusals (`code`): `NOT_AUTHENTICATED`, `NOT_FOUND` (not listed for this page: away, discovery off, or the page's own
computer), `DISCOVERY_OFF`, `SHARING_OFF`, `NO_SUCH_SHARE`, `ACCESS_DENIED` (Vista's wording in `error`),
`TOO_MANY_USERS` (Limit the number of simultaneous users: sessions that used the share in the last 10 minutes),
`BAD_OP`, and what the machine answers.

**Files** (modules/activeSyncTransfers.js, any signed-in user the share lets in):

- `GET /api/activesync/file/<deviceId>/share/<share>/<path>[?download=1]` with Range: read access.
- `POST /api/activesync/upload/<deviceId>/begin { root: 'share', dir: '/<share>/<folder>', name, size, conflict, mtime }`,
  then `.../upload/<id>/chunk?offset=N` and `.../upload/<id>/commit {}` from the same session: change access, checked at
  begin and again at commit; never queued or installed.
