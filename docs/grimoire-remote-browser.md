# Alchemy (Grimoire remote browser)

Alchemy is the user-facing name. Code, routes, and the PM2 app keep `grimoire-browser`. A Grimoire window on an `http(s)://` or `chrome://` page shows the Alchemy icon (`alchemy.png`) and the title `Alchemy - <page title>` in the title bar and taskbar, and switches back to Grimoire on Grimoire addresses (`grimoireSyncAlchemyIdentity`). A standalone Alchemy window is titled `<page title> - Alchemy` (the address until the page has a title). The service reports `document.title` changes from an isolated world (`watchTitle` + `Runtime.addBinding` `__alchemyTitle` in world `alchemy`), because Chrome does not send a target update for every title change. It must stay out of the page's own world: a page-visible binding (`page.exposeFunction`) makes Cloudflare Turnstile refuse the click. Start menu Alchemy (`launchId` `alchemy`) opens `ALCHEMY_HOME_URL` in `featureLoader.js` (Bing until the local homepage, Yozora #318).

Grimoire does not iframe the site you open. Modern browsers refuse that (`X-Frame-Options`, CSP `frame-ancestors`). It iframes a browser container we run. Chromium on that container loads the real site. The container streams the picture back and applies mouse, wheel, and keys.

The container is a separate process. It can run on this machine or another host.

The viewer times a ping on the same path as the picture and reports that round trip. The service then keeps about one frame in flight: a short trip stays near 30 fps, and a long trip slows the capture so the image you see is the current one instead of a queue. The slowest pace is about 10 fps, so a long round trip cannot stall the picture until clicks and keys look ignored. A click or a key still sends the next frame immediately, including when the socket is behind.

Mouse moves collapse to the latest point. A press and release stay in order on one queue, and a click is applied ahead of any move that has not started, so a slow link cannot deliver the release before the press or bury the click under a trail of moves.

A page that stops answering, crashes, or loses the stream is replaced by the Grimoire error page, with Reload and Home. A site that opens a new tab or window without an opener (`target="_blank"`, Ctrl-click, middle-click, `noopener`) opens a standalone Grimoire window on that address. The extra Chrome page is closed.

A popup that keeps `window.opener` (OAuth and sign-in windows from `window.open`) stays open in Chromium. The service adopts it as a popup session (`adoptPopup`, `parentId` = the opener's session) and sends the opener's viewers `popup` with `sessionId` and `viewerToken`; the client streams it in a small standalone Alchemy window (`data-alchemy-popup`, 420x680) without creating a new session. When the popup calls `window.close()` the session ends, the service sends `closed`, and the window closes. Closing the window closes the popup page; closing the opener closes its popups. Pages an extension opens itself (sign-in, onboarding) are adopted the same way and open as a normal-size window (`tab`) for the most recently used viewer; one that opens before any viewer is attached (1Password's install welcome opens at launch) waits for the next viewer. Popup sessions have their own cap (`MAX_SESSIONS`).

Page dialogs become Dreamscape dialogs titled Alchemy: `alert` (OK), `confirm` (OK / Cancel), `prompt` (`showInputDialog` with the page default), and leave-page `beforeunload` (Leave / Stay). The service holds one pending dialog per session (`dialog` message, resent when a viewer attaches) and answers it from the viewer `dialog-reply`, which skips the input queue because the click that opened the dialog does not return until it closes. No answer in 5 minutes dismisses it. The page text is escaped. An HTTP Basic or Digest challenge loads the 401 page (headless cancels the challenge), then asks for a username and a password and retries with `page.authenticate`; a wrong password asks again.

The Chrome Web Store "Add extension" prompt is browser UI, not a page dialog. Headless has no browser UI and the DevTools protocol never sees it, so it cannot be bridged. Extensions load by path instead (Yozora #319).

Cloudflare "Verify you are human" (Turnstile) passes with a normal click in the window. Chromium launches with `--disable-blink-features=AutomationControlled` (no `navigator.webdriver`) and every page gets the browser UA with `HeadlessChrome` replaced by `Chrome`; with the stock headless UA the same click is refused. Like Edge's `Edg/`, the UA ends in `Alchemy/<version>` and the Client Hints brands (`Sec-CH-UA`, full version list) are `Not)A;Brand`, `Chromium`, `Alchemy`; Cloudflare still passes with that. Nothing solves the box automatically.

Passkey and other WebAuthn prompts are rejected in the page before Chromium opens the authenticator. Headless Chromium has no authenticator dialog, so leaving the request open locks that tab. Password sign-in is unchanged.

When only part of the page changes, the service compares it with the previous picture and sends those rectangles. A navigation, or a change that covers most of the view, still sends one full JPEG. An unchanged frame is not sent.

guacd is the Guacamole proxy. Its region updates come from VNC or RDP damage events, so Chrome would have to render into an X display, then a VNC server, then guacd, which encodes the image a second time. That extra hop costs more delay than it saves. The rectangles here are taken from the screencast Chrome already produced.

The picture is a JPEG from Chrome’s own `Page.startScreencast` (the same path DevTools uses). PNG is larger. WebP and H.264 are not part of that API. [Browservice](https://github.com/ttalvitie/browservice) renders with CEF and also ships a full JPEG or PNG of the window on each change, aimed at old browsers. Cloning it would mean keeping a CEF build. It would not move keys or clicks any better than the DevTools stream we already have.

## Profile, extensions, and branding

Chromium keeps one persistent profile at `ALCHEMY_PROFILE_DIR` (default `~/.local/share/dreamscape/alchemy-profile`, created 0700). Cookies, site logins, Cloudflare clearance, and extension logins survive a restart. Treat it as a secret: keep it outside the repo and out of any backup that leaves the host. Anyone with Dreamscape admin can drive Alchemy, so set an auto-lock timeout in 1Password.

Extensions load unpacked from `ALCHEMY_EXTENSIONS_DIR` (default `~/.local/share/dreamscape/alchemy-extensions/<id>/`), each with a manifest `key` so the id matches the Web Store id. `node scripts/alchemy-update-extension.js [id ...]` downloads the store CRX for each id (default 1Password, `aeblfdkhhhdcdjpifhhbdiojplfjncoa`), unpacks it, and writes the key. Unpacked extensions never auto-update: re-run the script to update, then Restart browser. With no extensions Chromium runs with `--disable-extensions`.

Headless has no toolbar. The Alchemy menu has Extensions > <name>, which opens that extension's toolbar popup page (`chrome-extension://<id>/<default_popup>`) in a small popup window. The service lists them at `GET /extensions` (Dreamscape: `GET /api/grimoire-browser/extensions`). 1Password's toolbar popup only shows its lock until an account is added: sign in from its welcome page, `chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/app/app.html#/page/welcome`, which it opens itself on first install. 1Password's in-field autofill menu is an iframe in the page, so it already shows in the stream. `chrome-extension://` addresses can also be typed in the address bar.

Alchemy runs windowed, not headless, when Xvfb is installed (`sudo apt-get install -y xvfb`): sites such as X answer a headless login with "we temporarily limited your login". The service starts a private Xvfb display (`-displayfd`, `-nolisten tcp`, a fresh cookie in `~/.local/share/dreamscape/alchemy-xauth`, 0600, so other local users cannot connect and watch pages), launches Chromium on it with `headless: false`, and opens every session in its own window (`Target.createTarget` `newWindow`), because windowed Chrome stops painting background tabs. Covered windows keep painting and running timers (`--disable-backgrounding-occluded-windows`, renderer and timer backgrounding off), and each page gets focus emulation. Screencast, input, popups, and extensions work as before. The display stops with the service. `ALCHEMY_HEADLESS=1`, or no Xvfb, runs headless as before.

Rendering uses the Intel GPU when the service user can open `/dev/dri/renderD128`: ANGLE on Vulkan (Mesa ANV) with GPU rasterization and the blocklist ignored, so WebGL, video, and compositing are hardware accelerated (`chrome://gpu` shows Hardware accelerated). The user needs the `render` and `video` groups (`sudo usermod -aG render,video kanmi`; the PM2 daemon picks them up after its next login). Without the node the service logs it and falls back to SwiftShader so WebGL still works.

On `x.com` and `twitter.com` the session sends the plain Chrome user agent and client hints (no Alchemy brand), because X rate-limits logins from unknown browsers. Other sites keep the Alchemy brand.

A `<select>` never opens Chromium's native popup, because that popup is a separate widget the screencast cannot see. A click on a select (including one in shadow DOM, such as `chrome://settings`) is caught in an isolated world, its options are shown as the Grimoire context menu (option groups as headers, the current choice checked), and the pick is set on the page with `input` and `change` events. Selects inside cross-origin iframes and date or color pickers still use the native widget.

Sound plays in the focused Alchemy window when `pulseaudio` and `ffmpeg` are installed (`sudo apt-get install -y --no-install-recommends pulseaudio pulseaudio-utils`; `ALCHEMY_AUDIO=0` mutes). The service starts a private PulseAudio (socket in a fresh 0700 temp dir, one null sink `alchemy`) and Chromium plays into it instead of running with `--mute-audio`. `GET /sessions/:id/audio` (Dreamscape: `/api/grimoire-browser/sessions/:id/audio`) runs ffmpeg on the sink monitor and streams Ogg Opus (128k, 20ms pages); it is the whole browser's mix, and one listener at a time, so a new listener ends the old stream. The client sends `grimoire-browser-audio` `{ on }` to one viewer: the Alchemy window last clicked (page or window chrome) or last opened. The viewer plays it in an `<audio>` element and skips ahead when it falls more than 0.6s behind. If the WebView blocks autoplay, the next click in the page starts it.

While an Alchemy window is open, a volume icon sits in the tray right of the service worker icon (`#alchemyAudioTrayIcon`). Click it for a volume slider, Play audio (off ends every stream, so ffmpeg stops), and Play in background. These persist in `userGlobalSettings.alchemy` as `audioVolume` (0-100), `audioEnabled`, and `audioBackground`. With background off, audio stops when another window is focused or the app is hidden and resumes when you click back into the Alchemy window. With it on, the last Alchemy window keeps playing. The icon shows muted / low / high.

Pages get `DNT: 1` and `navigator.doNotTrack = '1'`: the service sets the profile pref `enable_do_not_track` before Chromium starts.

WebRTC: ICE (host + STUN) already worked; `getUserMedia` failed because the host has no camera or mic. Chromium now gets fake capture devices, a silent mic (`alchemy-fake-mic.wav`) and a camera showing the Alchemy logo (`alchemy-fake-camera.y4m`), both made with ffmpeg under `~/.local/share/dreamscape/`. Camera and microphone are granted per origin on its first visit (`Browser.setPermission`), because the prompt would open on the invisible display. Screen sharing still prompts, so a page cannot capture the virtual display with the other Alchemy windows. With media granted, Chrome puts the LAN address in host ICE candidates instead of an mDNS name, as it does for any site you allow the camera.

Default extensions: 1Password, uBlock Origin Lite (`ddkjiahejlhfcafbddmgiahcphecmpfh`), and I still don't care about cookies (`edibdbjcniadpccecjdfdjjppcpchdlm`). Full uBlock Origin is Manifest V2 and does not load on Chromium 154.

While a page loads in the main Grimoire window, the address bar fills left to right with a glass tint (`#grimoireAddressBar::before`, width `--alchemy-load`). Chromium has no load percentage, so the service sends `progress` at lifecycle stages: started 10%, commit 30%, DOMContentLoaded 60%, first paint 70%, load 90%, idle or stopped 100%.

The flat grey logo slot (Chromium's monochrome logo) is replaced from `public/static_images/app_icons/alchemy-mono.svg` instead of a greyscale copy of the colour logo.

Alchemy runs a branded copy of the system Chromium when one exists: `node scripts/alchemy-brand-chromium.js` copies `/usr/lib/chromium` to `ALCHEMY_CHROMIUM_DIR` (default `~/.local/share/dreamscape/alchemy-chromium`, binary `alchemy`), renames the product `Chromium` to `Alchemy` in `locales/*.pak` (the credits keep The Chromium Authors and the Chromium open source project), and swaps the product logos in `chrome_100_percent.pak`, `chrome_200_percent.pak`, and `resources.pak` for `alchemy.png`. Logos are found by their pixels (the largest crisp colour logo is the reference), because resource ids change between versions; `alchemy-brand.json` lists what was replaced. No compile. Re-run it after every apt Chromium update: the service picks the newest Chromium and prefers the branded copy only on a version tie, so a stale copy is skipped (with a warning in the log) instead of running an old browser.

## Service

```bash
cd services/grimoire-browser
pnpm install
GRIMOIRE_BROWSER_TOKEN='replace-with-a-long-secret' pnpm start
```

On the Dreamscape host it runs as the PM2 app `grimoire-browser` in `ecosystem.config.js` (127.0.0.1:9330, token from `secure.config.json` `grimoireBrowserToken`). It is in the saved PM2 list, so `pm2-kanmi.service` starts it on boot. `./restart` and `./reload` restart only Dreamscape, so open browser sessions survive a server bounce.

Listens on `0.0.0.0:9330` unless `HOST` / `PORT` are set. Chromium is `CHROME_BIN`, or the newest Chrome under `~/.cache/ms-playwright` or `~/.cache/puppeteer`.

`FRAME_ANCESTORS` is the CSP `frame-ancestors` value (default `*`). Set it to the Dreamscape origin when the service is reachable beyond the LAN, for example `https://staticforge.737.jp.net`.

Dreamscape iframes its own `/api/grimoire-browser/view/...` path and proxies the picture, so the service itself can stay `http://127.0.0.1:9330`.

If the origin or token is missing, or the service cannot be reached, Grimoire shows the existing error page in that display area, titled Web browser unavailable. A second pane uses the same page.

## Point Dreamscape at it

Either environment:

- `GRIMOIRE_BROWSER_ORIGIN` — `http://browser-host:9330` (no trailing slash)
- `GRIMOIRE_BROWSER_TOKEN` — the same secret as the service

Or files:

- `config.json` → `grimoireBrowser.origin`
- `secure.config.json` → `grimoireBrowserToken` (or `config.json` `grimoireBrowser.token`)

Restart Dreamscape after the route code is loaded. The client calls `POST /api/grimoire-browser/sessions`. The response `viewUrl` is a path on Dreamscape (`/api/grimoire-browser/view/...`), so the iframe uses the same scheme and host as the app. Dreamscape proxies the picture to the browser service. The service can still be `http://127.0.0.1:9330` on this machine.

The admin token stays on the server. The iframe only receives a per-session viewer token.

## Use

In Grimoire, enter `https://example.com`, a bare site such as `bing.com` (common endings like `.com`, `.jp`, `.io` open directly; any other ending, such as a typo `x.xom`, asks Go to site or Search wiki, because a tag can contain a dot), any other `http://` / `https://` URL, or a `chrome://` page such as `chrome://version`. The menu button on the address bar can open that site in Alchemy, open a wiki page for it, or search the wiki. `file:` and `javascript:` are rejected. Wiki and `edtx://` / `rdf://` / `dsap://` addresses are unchanged. Refresh reloads the remote page. Home and any non-web address close the session. A click on a `chrome://` link is followed with `Page.navigate`, because headless Chrome does not activate those links itself. Static pages paint once and then go quiet. The last JPEG is kept and sent as soon as a viewer connects, so a page that finished loading before the iframe subscribed is not left black. The address spinner stops on first paint, when the load finishes, or after a few seconds. Typing goes to the remote page when the address field is not focused.

Drag selects text in the remote page. Ctrl/Cmd+C copies that selection, and Ctrl/Cmd+V pastes the local clipboard into the page. Right-click opens the Grimoire menu: Copy, Paste (on a text field; the field is focused so the paste lands there), Copy link, Open link, Copy image, Save image, Download, Open in new window (the link, else the page), and Add to Desktop. Save image, Download, and any file the page itself downloads go into a Downloads folder in the active workspace's VFS (`/Workspaces/<id>/Downloads`, a normal folder made on first use), not the device's downloads: `POST /api/grimoire-browser/sessions/:id/save` with `{ download: <guid> }` or `{ url }`, plus `filename` and `workspaceId`. A toast has Show, which opens the folder in Explorer. While the remote page downloads, a toast shows the name, bytes so far, and a progress bar (service `download-progress`, at most 4 a second), then Saving to Downloads, then the saved toast. A resource is read by the remote page, so an image from another site that does not allow CORS fails with Download failed (open it in its own window and save from there). Copy image still uses the browser.

Add to Desktop creates a `web-page` shortcut (`data.url`, `data.title`, `data.icon`) that opens a standalone Alchemy window. `GET /api/grimoire-browser/sessions/:id/page-icon` asks the service for icon candidates (`/sessions/:id/page-info`: manifest / `apple-touch-icon` / sized `link[rel=icon]` 48px and up, then `og:image`, then small icons, then `/favicon.ico`); an extension's own page puts its largest manifest icon first, fetches them in the page until one is an image, and saves it as `.cache/site-icons/<sha1>.<ext>` (served from `/cache`).

Failure, not-responding, and unavailable pages use the Alchemy name and atom icon and never mention a remote browser or the service.

On a Grimoire tag wiki page, the page right-click menu has Danbooru wiki page and e621 wiki page (`grimoireOnlineWikiUrls`); they open in Alchemy in that window.

The address bar menu button (hamburger) only shows while the window is in Alchemy (CSS on `#tagWikiSearchModal[data-alchemy]` in `grimoire-browser.css`). It has Open in Alchemy, Open wiki page, Search wiki, Bookmarks, Bookmark this page / Remove bookmark, Settings (`chrome://settings`), JPEG quality, Min FPS, Max FPS, Compression (region JPEG quality Low 40 / Medium 60 / High 78), and Restart browser.

Settings and bookmarks are server-side in `config.json` `userGlobalSettings.alchemy` (`get_user_global_settings` / `update_user_global_settings`, normalized by `normalizeAlchemySettings` in `modules/grimoireBrowserBridge.js`). New sessions get them in `POST /sessions` `settings`. A change is pushed to open windows as the viewer `settings` message; a JPEG quality change restarts the screencast. Min/Max FPS bound the RTT pacing below.

Restart browser (`POST /api/grimoire-browser/restart`, service `POST /browser/restart`) sends `restarting` to every viewer, closes every session and Chromium, and launches a new one. Each viewer then reopens its last address instead of showing the failed tab page.

The address bar follows the remote page, including redirects, and the loading spinner stays up until that navigation finishes. Typing a new address stops the current load and opens the new one. Animated pages keep only the newest frame when the connection is behind, so URL updates are not stuck behind a queue of pictures.

`/api/grimoire-browser/` is not handled by the service worker. The viewer, the frame stream, and downloads are live responses. Caching them made the iframe fail with `no-response`.

## Check

```bash
node scripts/test-grimoire-browser.js
```

That starts the service, clicks a local page through the stream, copies a selection, types into the page, saves an image, receives a download, opens `chrome://version`, follows a `chrome://` link, loads `https://example.com`, and checks the Dreamscape bridge returns a same-origin view URL.
