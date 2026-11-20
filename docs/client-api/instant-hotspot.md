# Instant Hotspot (DreamOS, #910)

A phone that is Bluetooth-bonded with a DreamOS machine and runs the Dreamscape app lends its mobile data as a Wi-Fi
hotspot. The CaféReady host keeps a small-data link with the phone over Bluetooth RFCOMM. Through it, the host learns
the phone's battery, signal and mobile data, asks the phone to turn its hotspot on, gets that session's key, joins,
and leaves when it no longer needs the hotspot. The page only shows the phone and passes on the user's choice.

The full design is in DreamOS `docs/instant-hotspot.md`: transport, frames, trust, security and power. The phone's
half is DSApp `hotspot/InstantHotspot.kt` and `hotspot/HotspotShell.kt`.

## Page contract

`window.DreamOSHotspot` (shell extension `bridge.js`) is wrapped by the `network` tray provider
(`trayProviders.js`). Page code goes through the provider:

| Provider | Host | |
| --- | --- | --- |
| `hotspot()` | `GET /v1/hotspot` (the last push) | `{ present, phones: [Phone], auto, error: { code, message } \| null }` |
| `onHotspot(fn)` | event `hotspot` → `dreamoshotspot` | Pushed when anything in that state changes. Never polled. |
| `hotspotConnect()` | `POST /v1/hotspot { op: "connect" }` | Asks the phone for its hotspot, then joins it. The answer is the state plus `ok`; the result comes as pushes. |
| `hotspotDisconnect()` | `POST /v1/hotspot { op: "disconnect" }` | Leaves the network, forgets it, and the phone turns its hotspot off. No automatic join until the machine has been online again or the user asks. |

`Phone` fields:

| Field | Meaning |
| --- | --- |
| `id` | The phone's Bluetooth address. |
| `name` | The phone's Device ID name. |
| `linked` | The link is up now. When the link is down, the last values stay shown. |
| `battery` | 0-100, or null. |
| `charging` | true while charging. |
| `bars` | Cellular bars, 0-4 (null without a SIM). |
| `network` | `5G`, `LTE`, `3G`, ... or null. |
| `operator` | The carrier's name. |
| `data` | The phone has a cellular network with internet. |
| `enabled` | The phone's own Instant Hotspot switch. |
| `state` | `idle`, `requesting`, `joining` or `connected`. |
| `ssid` | The hotspot's network name while `joining` or `connected`. |
| `metered` | Always true: the phone's mobile data is metered. |

`error.code` values:

| Code | When |
| --- | --- |
| `LINK` | The phone is out of range. |
| `TIMEOUT` | The phone did not answer within 45 s. |
| `JOIN` | No connection within 60 s. |
| `DENIED` | Instant Hotspot is off on the phone. |
| `NO_SHELL` | The phone has neither local ADB nor Shizuku, so it cannot switch tethering. |
| `FAILED`, `UNSUPPORTED` | The phone could not turn the hotspot on. |

The host also joins by itself when the machine has had no network for 30 s and a linked phone has mobile data and
battery of 20 % or more (or is charging). `auto` reports this setting. It leaves after 10 minutes with no traffic,
when a cable comes up, when iwd moves to a saved network, or when the phone stops the hotspot.

## UI (ui-standard: Vista or nothing)

- **Connect to a network** (`dreamosWifi.js` `hotspotRows`): the phone is a row in the wireless group, and the
  phone's own SSID from the scan is folded into it.
  - Left: the wireless icon. Middle: "Instant Hotspot" (or "Connecting...", or Connected). Right: the cellular bars on
    Vista's five-bar art.
  - Tooltip: battery, signal, and "Uses the phone's mobile data (metered)".
  - Connect / Disconnect use the wizard's Connecting… / connected / failed pages. The connected page hides "Save this
    network" because a hotspot session is never saved.
- **Network flyout** (`melatonControlPanel.js` `dreamosFlyoutHtml`):
  - Not connected: "<phone> can share its mobile data (Instant Hotspot)." plus "Connect to <phone>", which opens
    Connect to a network.
  - Connected through the phone: "Instant Hotspot: mobile data (metered), battery N%".
- **Manually connect to a wireless network:** "Connect even if the network is not broadcasting" is enabled. It
  passes `{ hidden: true }` to `connect`.

Without `DreamOSHotspot` (a browser, the phone, the Android desktop), the provider has no `hotspot*` methods and
nothing is shown.

## VZAccess Manager

While the computer is on a phone's hotspot (an Instant Hotspot session or any other join), VZAccess Manager and Network
Connections show it as a mobile broadband card. See [phone-broadband.md](phone-broadband.md).
