# Grimoire remote browser

Grimoire does not iframe the site you open. Modern browsers refuse that (`X-Frame-Options`, CSP `frame-ancestors`). It iframes a browser container we run. Chromium on that container loads the real site. The container streams the picture back and applies mouse, wheel, and keys.

The container is a separate process. It can run on this machine or another host.

The viewer times a ping on the same path as the picture and reports that round trip. The service then keeps about one frame in flight: a short trip stays near 30 fps, and a long trip slows the capture so the image you see is the current one instead of a queue. The slowest pace is about 10 fps, so a long round trip cannot stall the picture until clicks and keys look ignored. A click or a key still sends the next frame immediately, including when the socket is behind.

Mouse moves collapse to the latest point. A press and release stay in order on one queue, and a click is applied ahead of any move that has not started, so a slow link cannot deliver the release before the press or bury the click under a trail of moves.

A page that stops answering, crashes, or loses the stream is replaced by the Grimoire error page, with Reload and Home. A site that opens a new tab or window (`window.open`, `target="_blank"`, Ctrl-click, or middle-click) opens a standalone Grimoire window on that address. The extra Chrome page is closed.

Passkey and other WebAuthn prompts are rejected in the page before Chromium opens the authenticator. Headless Chromium has no authenticator dialog, so leaving the request open locks that tab. Password sign-in is unchanged.

Extensions are not loaded (`--disable-extensions`). A toolbar popup is Chrome’s own window, not part of the page, so the screencast would not show it even if extensions were on. A page that opens a window is the case above, and that becomes a standalone Grimoire window.

When only part of the page changes, the service compares it with the previous picture and sends those rectangles. A navigation, or a change that covers most of the view, still sends one full JPEG. An unchanged frame is not sent.

guacd is the Guacamole proxy. Its region updates come from VNC or RDP damage events, so Chrome would have to render into an X display, then a VNC server, then guacd, which encodes the image a second time. That extra hop costs more delay than it saves. The rectangles here are taken from the screencast Chrome already produced.

The picture is a JPEG from Chrome’s own `Page.startScreencast` (the same path DevTools uses). PNG is larger. WebP and H.264 are not part of that API. [Browservice](https://github.com/ttalvitie/browservice) renders with CEF and also ships a full JPEG or PNG of the window on each change, aimed at old browsers. Cloning it would mean keeping a CEF build. It would not move keys or clicks any better than the DevTools stream we already have.

## Service

```bash
cd services/grimoire-browser
pnpm install
GRIMOIRE_BROWSER_TOKEN='replace-with-a-long-secret' pnpm start
```

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

In Grimoire, enter `https://example.com`, a bare site such as `bing.com`, any other `http://` / `https://` URL, or a `chrome://` page such as `chrome://version`. The book button on the address bar can open that site in the browser, open a wiki page for it, or search the wiki. `file:` and `javascript:` are rejected. Wiki and `edtx://` / `rdf://` / `dsap://` addresses are unchanged. Refresh reloads the remote page. Home and any non-web address close the session. A click on a `chrome://` link is followed with `Page.navigate`, because headless Chrome does not activate those links itself. Static pages paint once and then go quiet. The last JPEG is kept and sent as soon as a viewer connects, so a page that finished loading before the iframe subscribed is not left black. The address spinner stops on first paint, when the load finishes, or after a few seconds. Typing goes to the remote page when the address field is not focused.

Drag selects text in the remote page. Ctrl/Cmd+C copies that selection, and Ctrl/Cmd+V pastes the local clipboard into the page. Right-click opens the Grimoire menu: Copy, Copy link, Open link, Copy image, Save image, and Download. A file the page itself downloads is saved through Dreamscape.

The address bar follows the remote page, including redirects, and the loading spinner stays up until that navigation finishes. Typing a new address stops the current load and opens the new one. Animated pages keep only the newest frame when the connection is behind, so URL updates are not stuck behind a queue of pictures.

`/api/grimoire-browser/` is not handled by the service worker. The viewer, the frame stream, and downloads are live responses. Caching them made the iframe fail with `no-response`.

## Check

```bash
node scripts/test-grimoire-browser.js
```

That starts the service, clicks a local page through the stream, copies a selection, types into the page, saves an image, receives a download, opens `chrome://version`, follows a `chrome://` link, loads `https://example.com`, and checks the Dreamscape bridge returns a same-origin view URL.
