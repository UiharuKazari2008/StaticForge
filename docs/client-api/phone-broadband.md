# A phone's hotspot as mobile broadband (DreamOS, #953)

Yukimi, Nov 20 2026: "Also detect if the phone is connected as hotspot and use VZAccess Manager to show its status on
that PC as if it's a mobile broadband card."

When a DreamOS computer's Wi-Fi is on a phone's hotspot, Melaton shows that hotspot the way Vista showed a Verizon card
through VZAccess Manager:

- VZAccess Manager's tray icon and window: signal, network type, Connected with its timer and bytes, Disconnect, and
  the phone's battery.
- A Mobile Broadband Connection in Network Connections. Network and Sharing Center says it is connected through it.
- The Network tray icon. Its look is the mobile one, not the Wi-Fi bars.

The host's half is DreamOS `cafeready/src/wwan.rs`. Its design is in DreamOS `docs/phone-broadband.md`.

## Detection (host)

| Way | Signal |
| --- | --- |
| Instant Hotspot | Its session ([instant-hotspot.md](instant-hotspot.md)), from the request on. |
| Any other join (by hand, saved, hidden) | Android's DHCP option 43 `ANDROID_METERED` in the Wi-Fi lease. Android's tethering DHCP server sends it when the hotspot shares mobile data. |

Nothing polls. The host reads the lease on each network push, once per connection.

## Which phone (server)

The host puts `host.tether { via, ssid, mac, since, phone }` in its ActiveSync status. `modules/phoneTether.js` then
finds the phone. It asks each online partner phone once for `cat /proc/net/arp` (Remote Commands) and looks for the
computer's MAC there.

- **One phone answers so:** that phone's ActiveSync record gets `hotspot: { ssid, computers: [{ deviceId, name, via }],
  how: 'arp' }`.
- **No phone answers so:** if exactly one partner phone with a cellular network is online, it is taken, with
  `how: 'guess'`.

The phone is asked again only when the tether changes.

## Page contract

`window.DreamOSWwan` comes from the shell extension `bridge.js`. The DreamOS `network` provider (`trayProviders.js`)
wraps it:

| Provider | Host | |
| --- | --- | --- |
| `get().mobile` | event `wwan` → `dreamoswwan` | Present while the computer is on a phone's hotspot or can connect to one (see below). Pushed. |
| `wwan()` | `GET /v1/wwan` | The host's state as is (below). |
| `wwanConnect()` | `POST /v1/wwan { op: "connect" }` | Joins the phone network joined last (a hidden one by name) when it is in range or no phone is linked; otherwise asks the linked phone (Instant Hotspot). |
| `wwanDisconnect()` | `POST /v1/wwan { op: "disconnect" }` | Leaves the hotspot. An Instant Hotspot phone turns its hotspot off. A hotspot joined by hand is not joined again by itself until the user connects. |
| `wwanWatch(fn)` | `GET /v1/wwan/watch` (an event stream) | `fn({ rx, tx })`, the session's bytes, every 2 s at most and only when they moved. Hold it only while a window that shows them is seen. It returns the release. |

`get().mobile` (only while the host reports one):

```
{ present: true, connected, on: true, state: 'idle' | 'connecting' | 'connected' | 'disconnecting',
  via: 'instant-hotspot' | 'hotspot', ssid, device, carrier, signalPercent (bars x 25), bars (0-4), generation ('5G',
  'LTE'), roaming, since (ms), bytes: { rx, tx }, ip: [], canConnect,
  phone: { deviceId, name, model, battery, charging, bars, dataType, operator, roaming, number } }
```

Where the phone's facts come from:

- **Instant Hotspot:** the Bluetooth link's `status` frames.
- **Otherwise:** the phone's own ActiveSync status, from the device whose `hotspot.ssid` matches. While the computer is
  not on the hotspot, the phone last found keeps showing.

All of it is pushed: `dreamoswwan`, and `activeSync` `state` (as_peers_updated).

`wwan()` / host state:

```
{ present, connected, state, via, ssid, device, mac, bssid, gateway, ip, ip6, since, signalPercent, metered: true,
  phone: <Instant Hotspot phones[] entry> | null, bytes: { rx, tx } | null, last: { via, ssid } | null, canConnect }
```

## UI

- **VZAccess Manager** (`apps/vzaccess`). The device is the phone:
  - **Networks:** the WWAN row "Verizon Wireless - VZAccess" carries the phone's bars. The hotspot's own SSID is not
    listed as a Wi-Fi network.
  - **Status area:** the Coverage Indicator shows the phone's data class, with Verizon's 5G / 4G LTE marks. The
    timer starts from the host's `since`.
  - **Device box:** the phone's name (LAN). The phone icon's tooltip has its battery. The tray tooltip adds
    "Battery: N%".
  - **Statistics:** draws the pushed bytes (rates between pushes, 0 kbps after 3.5 s of quiet). Its addresses are
    the Wi-Fi link's.
  - **Connect / Disconnect WWAN:** `wwanConnect` / `wwanDisconnect`.
  - **Session Log:** a session is logged with the host's start and its bytes.
  - **WWAN Device Info / About:** list the phone, the hotspot, the network, the signal and the battery.
  - **Tray:** the program starts in the tray when the computer first goes on a phone's hotspot. This follows 7.x's
    Run at Startup (Preferences > Application).
- **Network Connections** (`dreamosWifi.js`): "Mobile Broadband Connection" in the Broadband group, network "Verizon
  Wireless", device "<phone> Mobile Broadband". The Wireless Network Connection still shows the hotspot it is
  joined to.
- **Network icon and flyout** (`dreamosNetTray.js`): the Wi-Fi joined to the phone counts as the mobile link.

## Power

- The page reads nothing on a timer.
- VZAccess Manager's one-second tick only draws its timer, and on DreamOS the graph from what was pushed.
- The host's 2 s byte stream runs only while the window is open and seen. It is released when the window is hidden,
  minimised, closed, or the screen is off.
