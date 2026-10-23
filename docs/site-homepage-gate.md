# Site homepage access gate

When **Site Homepage** is installed (Control Panel → Site Homepage, `dsap://site.dreamscape.jp/`), unauthenticated visitors see a static **cover site** instead of Dreamscape. Access to the real app requires:

1. **Cover phrase** (lookup form field `q`, **POST** body only to the site's door action from `manifest.json`) → on success, **`dsk`** cookie plus redirect to **`/launch?k=<access-hash>`**. The plaintext phrase must never appear in a URL, query string, or referrer; the **access hash** may (`?k=`, PWA `start_url`, bookmarks).
2. **Dreamscape PIN** at **Phoenix BIOS** (only when the gate is on and there is no valid **`connect.sid`**) or in-app **Vista logon / Connect / PIN modal** after boot.

The legacy **PIN page** (`public/index.html` at `/`) is not used when the gate is configured.

## Server

| Piece | Module / route |
| --- | --- |
| Gate middleware | `modules/siteGate.js` (after `express-session` + approved-IP auto-login; honors **`connect.sid`** and refreshes **`dsk`**) |
| Access hash | `modules/siteAccess.js` → `secure.config.json` → `siteAccess.pepper`, `siteAccess.hash`, `siteAccess.homepage` |
| Cover files | `resources/site-homepages/<slug>/` (static; `secure.config.json` `siteAccess.homepage` picks the active slug) |
| Admin WS | `get_site_homepage`, `set_site_homepage`, `clear_site_homepage` |
| Admin preview (Alchemy) | `mint_site_homepage_preview_url` WS -> `grimoireOpenStandaloneWindow(origin + path)` (same as a desktop web shortcut; not `openGrimoireUrl` / main Grimoire `navigate`); `GET /site-homepage-preview/:slug/*` with `?t=` then `sprev` cookie |
| Public status | `OPTIONS /status` (client knock, key or session) → see Client protocol |
| Login sprite | `modules/loginSpriteSheet.js` → 1×1 black JPEG when gate on |
| PIN storage | `modules/pinAuth.js` (scrypt); login regenerates session id (`web_server.js`) |

### Gate exemptions (no `dsk` required)

- `/agent*`: loopback only
- replication sync/assets/maintenance: only with a replication token that matches a configured one
- MCP UUID mount and `.well-known/oauth-*`: on every host, or only on `mcp_public_hostname` when that is set
- Apocrypha UUID mount
- `OPTIONS /status`, `POST /` (login/logout/ping/gateway), `GET /sw.js`: only with the client knock (below)

Without an exemption, a key or a session, the cover answers like nginx serving a static site:
no Helmet headers, nginx ETags and mime types, 405 for other methods and for POST to a file,
301/403 for directories, the site's `404.html` for anything else, 404 for WebSocket upgrades.

## Client protocol (PWA, DSApp-Win, DSApp-Kotlin)

| Step | Request | Answer |
| --- | --- | --- |
| Knock | header `X-Dreamscape-Client: <app>/<version>` (DSApp-Win's `DreamscapeShell/` user agent is accepted as legacy) | unlocks the three endpoints above |
| Detect | `OPTIONS /status` + knock (+ `X-Dreamscape-Access: <key>` if saved) | JSON with boolean `isReady` = Dreamscape. Gate on, not through: `{ isReady, stage, progressPercent, siteAccess: { configured: true, passed: false } }`. Through: full status, `siteAccess.passed: true` |
| Key check | same request with a key (header, `?k=` or `dsk` cookie) | `hor` (Hash OK Return): `true` valid, `false` stale (keys rotate) |
| Phrase → key | `POST /` + knock, `{"action":"gateway","data":{"password":"<phrase>"}}` | 200 `{ success: true, k }` + `dsk` cookie; 401 `GATEWAY_DENIED`; 429 `GATEWAY_LOCKED` (10 failures/IP/hour, shared with the door) |
| Legacy phrase | `POST /lookup` `q=<phrase>` + knock | 303 `/launch?k=<key>` |
| PIN | `POST /` + knock, `{"action":"login","data":{"pin":"<pin>"}}` | as before |

`/manifest.json` without a valid key is a neutral manifest in the cover site's name: identify the
server with `OPTIONS /status`, not the manifest. The service worker keeps the last gate-passed
`/launch` (`X-Melaton-Shell`) and boots it when the network answers with the cover; the BIOS then
asks for the **Gateway Password** (the phrase) before the PIN.

## Cover site door (manifest.json `door`)

| Key | Meaning |
| --- | --- |
| `action` | endpoint the search form POSTs to (not a file); `/lookup` is not answered for visitors |
| `resultPage` | page rendered for the POST and for GET `resultPage` / `action` `?<field>=` (public lookup, never the phrase) |
| `field` | form field name (default `q`) |
| `records` | `{ "<id>": "<html>" }`: ids the site lists, rendered in place of `<!--door:none-->…<!--/door:none-->`; `<!--door:q-->` echoes the query |

`forms`: `{ "<endpoint>": "<sent page>" }` for contact forms (a static file takes no POST).

Everything else (including `OPTIONS /` manifest, `/app`, `/launch`, APIs) needs a valid **`connect.sid`**, **`dsk`**, **`X-Dreamscape-Access`**, or `?k=` on GET (sets cookie). Successful PIN login also sets **`dsk`** while the gate is on.

### Logout

`POST /` `action: logout` clears **`connect.sid`** and **`dsk`**. Browser returns to the cover site at `/`.

## Client

| Flag | Source |
| --- | --- |
| `localStorage.dreamscapeSiteGate` | `1` when `siteAccess.configured` from `/status` |

When set:

- Boot skips redirect to `/`; BIOS PIN only when **`OPTIONS /app`** says login required; session miss → `/app` (not PIN page).
- Service worker skips **login-critical** precache (`serviceWorkerManager.js`).
- Shell routes (`/`, `/app`, `/launch`, `/manifest.json`) are network-only (`public/sw.js`, cache `static-cache-v2`).

## PWA manifest

With a valid token, `GET /manifest.json` returns JSON with `id: "/?app=dreamscape"` and `start_url: "/launch?k=<hash>"`. Static manifest is not pinned in the SW install manifest.

## Security notes

- **`/graphify-out`**: session auth + dedicated static mount (`web_server.js`); not world-readable.
- **`/temp`**, **`/replication/gallery/remote`**: require auth.
- **PINs**: stored as scrypt (`scrypt$…`); plaintext in config still verifies until next successful login or admin PIN change.

## Verify

```bash
node scripts/test-pin-auth.js
node scripts/test-site-homepage-preview.js
```

Manual: gate on → no token → cover on `/` and `/app`; phrase → `/launch` → BIOS PIN → desktop; log off → cover; rotate phrase → old `dsk` invalid.

Server code changes need a Dreamscape restart (director idle / Menma or Claude Code). Client changes: `scripts/notify-service-worker-update.sh`, then `update_client` / `restart_client` on the bound tab.
