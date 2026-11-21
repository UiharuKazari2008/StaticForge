# ActiveSync direct link (LAN)

Yukimi, Nov 21 2026: "on the ActiveSync Fetch and Streaming, can you also have the phone return all its IP addresses and
subnets/routes so that clients can detect if they can directly connect to the phone over the LAN via a port the
CafeReady interface has open for it to communicate with. Must be authenticated and encrypted between the clients.
Possibly have the client say hello, they say hello, the client asks the server for a auth token for that device or
phone, phone validates it, persistent local link is open for all data transfers that are done client side."
Transport chosen by Yukimi: a **WebRTC data channel** (DTLS, browser-native, peer to peer on the LAN).

Today every phone file a computer shows (Explorer, Photo Gallery, Media Player, copies both ways) goes phone -> server ->
computer over HTTP (`modules/activeSyncTransfers.js`), even when both sit on the same Wi-Fi. The direct link carries
the same calls and file bodies straight across the LAN; the server only introduces the two ends and vouches for both.
Everything falls back to the server path the moment the link is not there.

## 1. The phone's networks (`as_status.net`)

The app (DSApp `NetIfaces`, its Android source: no shell needed) adds `net` to its ActiveSync status. Pushed when
Android reports a link change (`NetLinks` callbacks), never polled; also in the status it sends with every hello.

```json
"net": {
  "at": 1795260000000,
  "interfaces": [
    { "name": "wlan0", "type": "wifi", "up": true,
      "v4": [{ "addr": "192.168.1.42", "prefix": 24 }],
      "v6": [{ "addr": "fd12:3456::42", "prefix": 64, "scope": "global" }] }
  ],
  "routes": [ { "dst": "0.0.0.0/0", "gw": "192.168.1.1", "dev": "wlan0" }, { "dst": "192.168.1.0/24", "dev": "wlan0" } ],
  "link": { "ready": true, "max": 4 }
}
```

- `type`: `wifi`, `ethernet`, `cellular`, `vpn`, `usb`, `bluetooth`, `other` (from the network agent where known).
- At most 16 interfaces, 8 addresses each, 32 routes. Loopback and link-local IPv6 (`fe80::/10`) are left out.
- `link.ready`: the app can take direct links now (WebRTC loaded, storage sharing on). `max`: links it keeps at once.

The server keeps `net` in the device's status (`sanitizeStatus`, `modules/activeSync.js`) and lists it with the device.

## 2. Who tries

A computer tab tries a link to a phone when all of these hold:

1. the phone is connected (guest or partner) with the `files` permission and `status.net.link.ready`;
2. the phone has a private address (RFC 1918 IPv4, or IPv6 ULA / global) on a `wifi`, `ethernet` or `usb` interface;
3. no recent failure for this phone on this network (a failed attempt backs off: 2 s, 10 s, 60 s, then only on the
   next change of the phone's `net`).

The server's answer carries `sameNetwork` as a hint only (the two ends' sockets come from the same address, or the
computer's address is inside one of the phone's subnets). Both ends often reach the server through the Nightshade
Network with addresses of their own, so it cannot be a gate: a host-only ICE attempt costs about a second on a LAN and
nothing elsewhere, and its result is what counts.

ICE then has the last word: the offer carries host candidates only (no STUN, no TURN), so a link only ever forms across
a LAN path; it never goes out to the internet.

## 3. Signalling and the token (`as_link_offer`)

Over the computer's existing, signed-in ActiveSync socket (an administrator, the phone allows `files`):

```
computer -> server   as_link_offer { deviceId, sdp }                 (the complete offer: ICE gathered, host only)
server               checks the session and the device, reads the offer's a=fingerprint (sha-256),
                     mints the link token, then asks the phone:
server -> phone      as_request link.offer { sdp, token, nonce, client: { id, name } }
phone                verifies the token (signature, device, expiry, fingerprint == the offer's), answers:
phone -> server      { sdp, sig }        (the complete answer; sig: section 4)
server -> computer   { success, sdp, sig, nonce, phoneKey, sameNetwork, expiresAt }
```

**The link token** (compact, JWS-like: `base64url(header).base64url(payload).base64url(signature)`):

- header `{"alg":"ES256","typ":"aslink","kid":"<key id>"}`
- payload `{"v":1,"d":"<device id>","c":"<client id>","n":"<nonce>","fp":"<client DTLS sha-256, upper hex with colons>","iat":<s>,"exp":<s>}`
- signed (ECDSA P-256, raw r||s) with the server's **link key**: `~/.secrets/dreamscape-aslink.key` (made on first use,
  0600, never logged; `DREAMSCAPE_ASLINK_KEY_DIR` moves it). Life: 120 s (it only opens the link; the link then lives on).
- The phone learns the public key from the server's answer to its `as_hello` (`linkKey: { kid, spki }`, SPKI base64)
  over its own authenticated socket and keeps the last one it was given.

The phone refuses (`{ code }` errors): `BAD_TOKEN` (signature, header, version), `WRONG_DEVICE`, `EXPIRED`,
`FINGERPRINT` (the offer's fingerprint is not the token's), `BUSY` (already `max` links: the oldest idle one is closed
first if there is one), `NOT_READY`.

## 4. The phone proves itself

`sig` = the phone's client certificate key (Android Keystore, StrongBox where present; `ClientCert.kt`) signing, ECDSA
P-256 / SHA-256, DER, base64, the UTF-8 text

```
aslink-v1
<nonce>
<client fingerprint>
<phone fingerprint>      (the answer's a=fingerprint sha-256)
```

The server returns `phoneKey` (SPKI base64) from the phone's live certificate in Key Manager
(`client_certificates`: kind android, this device id, not revoked). The computer verifies `sig` with WebCrypto and
checks that both fingerprints are the ones in its offer and in the answer. WebRTC itself then enforces that the DTLS
peer holds the answer's certificate. So:

- the phone knows the computer is one the server signed in (token, bound to the computer's DTLS certificate);
- the computer knows it reached that phone (its Keystore key, vouched for by the server);
- everything on the link is encrypted (DTLS / SCTP).

## 5. On the link (data channel `aslink`, ordered, reliable)

Text messages are JSON control frames; binary messages are data: a 4-byte big-endian stream id, then the bytes.
Data messages are at most 64 KiB. Both ends watch `bufferedAmount` and pause above 1 MiB (resume under 256 KiB).

| Frame | Meaning |
| --- | --- |
| `{t:"hello", v:1, name}` | computer -> phone, first frame. |
| `{t:"hello", v:1, id, name, ops:[...], features:{...}}` | phone -> computer: the ops it serves on the link (the same `storage.*` names as ActiveSync, `features` as `storage.hello`). |
| `{t:"call", id, op, args}` | a call, as `as_call` would carry it (`storage.list`, `storage.mediaList` ...). The phone checks the same permissions as for a server call. |
| `{t:"result", id, result}` / `{t:"error", id, code, message}` | its answer. |
| `{t:"get", id, root, path, range?, thumb?, jpeg?, media?}` | a file body (as `stream.send`; `media` for `root:"media"`, `jpeg` = the app's JPEG of a picture the browser cannot decode). |
| `{t:"head", id, status, type, length, range?, mtime}` | then binary frames for `id`, then `{t:"end", id}`. |
| `{t:"put", id, root, dir, name, size, conflict, mtime?, mkdirs?}` | a file to the phone (as `stream.receive`). Phone answers `{t:"ready", id}` (or an error), takes binary frames for `id`, then `{t:"putEnd", id}` -> `{t:"result", id, result: <entry>}`. |
| `{t:"cancel", id}` | either side stops a get or put; partial uploads are deleted. |
| `{t:"ping"}` / `{t:"pong"}` | only when nothing else moved for 60 s (keeps NAT-less LAN paths and the SCTP association honest). |

Stream ids: odd from the computer. At most 8 gets and 2 puts at once per link; more wait their turn.

## 6. Life of a link

- Opened by the computer when it first needs the phone's storage (a drive, a gallery, a player) and the conditions in
  section 2 hold; kept while used; closed after 10 minutes with no frame (power: `phone-power-*`), reopened on the next
  need (about 0.3 s on a LAN).
- Closed at once when the phone's certificate is revoked, the device leaves (`as_peers_updated` without it), the phone's
  network changes (its `net` differs), or ICE disconnects. The computer falls back to the server path and tries again
  with the back-off of section 2.
- The phone side runs in the app's service (`cafeready-background`): never in a WebView page.

## 7. Computer side

`public/scripts/comp/activeSyncDirectLink.js` holds the links (one per phone) and exposes `call`, `get`, `put`.

- `activeSyncRemoteStorage.js` uses the link for calls and uploads when it is up, the server otherwise.
- File URLs stay `/api/activesync/file/<device>/<root>/<path>`: the service worker answers those for a page that has a
  live link to that device by asking the page for the body (a `MessageChannel`): the page acknowledges at once when it
  has the link, then answers with the head and a transferable `ReadableStream`. No acknowledgement within 250 ms, a
  "no", or a phone error goes to the network as before. Images, video
  (Range), thumbnails and downloads all move to the LAN without any caller changing.
