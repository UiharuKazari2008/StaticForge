# Site homepage access gate

When **Site Homepage** is installed (Control Panel → Site Homepage, `dsap://site.dreamscape.jp/`), unauthenticated visitors see a static **cover site** instead of Dreamscape. Access to the real app requires:

1. **Cover phrase** (lookup form field `q`, POST `/lookup`) → sets httpOnly cookie **`dsk`** (the access hash).
2. **Dreamscape PIN** at **Phoenix BIOS** (forced when the gate is on) or in-app **Vista logon / Connect / PIN modal** after boot.

The legacy **PIN page** (`public/index.html` at `/`) is not used when the gate is configured.

## Server

| Piece | Module / route |
| --- | --- |
| Gate middleware | `modules/siteGate.js` (first after `cookieParser` + urlencoded) |
| Access hash | `modules/siteAccess.js` → `secure.config.json` → `siteAccess.pepper`, `siteAccess.hash`, `siteAccess.homepage` |
| Cover files | `.cache/site-homepage/<slug>/` (installed from `resources/site-homepages/`) |
| Admin WS | `get_site_homepage`, `set_site_homepage`, `clear_site_homepage`, `get_site_homepage_preview` |
| Public status | `OPTIONS /status` → `siteAccess: { configured, homepage }` |
| Login sprite | `modules/loginSpriteSheet.js` → 1×1 black JPEG when gate on |
| PIN storage | `modules/pinAuth.js` (scrypt); login regenerates session id (`web_server.js`) |

### Gate exemptions (no `dsk` required)

- `/agent*`, replication sync/assets/maintenance, MCP/Apocrypha UUID mounts, `.well-known/oauth-*`
- `OPTIONS /status`, `POST /` (login/logout/ping), `GET /sw.js`

Everything else (including `OPTIONS /` manifest, `/app`, `/launch`, APIs) needs a valid **`dsk`**, **`X-Dreamscape-Access`**, or `?k=` on GET (sets cookie).

### Logout

`POST /` `action: logout` clears **`connect.sid`** and **`dsk`**. Browser returns to the cover site at `/`.

## Client

| Flag | Source |
| --- | --- |
| `localStorage.dreamscapeSiteGate` | `1` when `siteAccess.configured` from `/status` |

When set:

- Boot skips redirect to `/`; BIOS PIN is required; session miss → `/app` (not PIN page).
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
```

Manual: gate on → no token → cover on `/` and `/app`; phrase → `/launch` → BIOS PIN → desktop; log off → cover; rotate phrase → old `dsk` invalid.

Server code changes need a Dreamscape restart (director idle / Menma or Claude Code). Client changes: `scripts/notify-service-worker-update.sh`, then `update_client` / `restart_client` on the bound tab.
