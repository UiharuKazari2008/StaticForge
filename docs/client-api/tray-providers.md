# Tray providers (#932)

The desktop tray's system icons draw what **one provider per area** reports: Power, Network, Volume, and Bluetooth when it
lands. The same tray runs on:

- DreamOS, through the CaféReady host and the kiosk's shell extension (built in);
- the Android app's desktop shell (DeX / Continuity PC), through DSApp's bridges (the Android agent registers these);
- a plain browser (the Battery Status API for power; for the rest, the tab's own behaviour as before).

The registry is `public/scripts/comp/trayProviders.js`. It loads before `tabVolume.js`, `trayPower.js` and `dreamosNetTray.js`.

```js
melatonTray.register(area, provider)   // area: 'power' | 'network' | 'volume' | 'bluetooth'
melatonTray.provider(area)             // the provider in use: the highest priority whose available() is true
melatonTray.onChange(area, fn)         // fn(state) on each push from the provider in use; returns unsubscribe
```

Every provider has this shape:

```js
{
  id: 'android',            // unique per area; registering the same id again replaces it
  priority: 20,             // DreamOS uses 30; the browser fallback is 0. The highest available provider wins.
  available: () => true,    // false: skipped (e.g. the bridge is missing on this device)
  get: () => state,         // the current state, synchronous (a cached copy; never a network round trip)
  subscribe: (fn) => off,   // fn(state) on every change; returns an unsubscribe function
  // ...the area's actions below
}
```

Rules (`server-push-not-polling`, `phone-power-client`, `installed-boot-zero-wait`):

- Push changes. The tray never polls. `get()` returns what was last pushed.
- Never wait on the server. Everything here is local to the device.
- Register as early as you can. A provider registered later still takes over, because every consumer follows `onChange`.
- `get()` must not throw. Return `null` when the provider knows nothing yet.

## power

The state takes one of two shapes:

```js
// 1. Plain battery (the Android app, any new provider):
{
  present: true,          // false: no battery (with plugged: true, the icon shows "No battery is detected")
  percent: 64,            // 0-100, or null when unknown
  plugged: false,         // on the charger
  charging: false,
  full: false,            // the pack reports full: "Fully charged (100%)"
  protect: false,         // DreamOS battery protection (files can't be saved); others: false
  minutesLeft: 153,       // on battery, or null
  minutesToFull: null,    // while charging, or null
  packs: [{ percent, charging, full }]   // optional, two or more packs: one flyout row each
}
// 2. DreamOS's own hardware snapshot (CaféReady hw.rs): { batteries: [{ percent, status }], ac, protect }
```

Optional actions for the flyout's "Select a power plan":

- `plans()` returns `[{ id, name }]`.
- `activePlan()` returns an id.
- `setPlan(id)` sets it.

Without these, the flyout uses Power Options' plans (melatonRegistry
`HKLM\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes` ActivePowerScheme, event `melaton-power-plan`), or
`window.melatonPowerPlans` (`list` / `active` / `setActive`) when that is loaded.

The UI (`trayPower.js`):

- Vista's battery meter: batmeter.dll bitmaps 303 / 306 in the tray, 301 / 302 in the flyout.
- Balloons at 10 % (low) and 5 % (critical), and for battery protection.

## network

The state follows DreamOS's `window.DreamOSNetwork.get()`:

```js
{
  wifi: {
    present: true, device: 'wlan0', radio: true,
    state: 'connected' | 'connecting' | 'disconnected' | 'off', scanning: false,
    network: { name, security: 'psk'|'open'|'8021x'|'wep', signal, signalPercent: 0-100, known, autoConnect } | null,
    ip: ['192.168.1.20']
  },
  ethernet: [{ name, carrier: true, speedMbps, state, ip: [] }],
  mobile: {                // optional: mobile data, shown as Vista's "Mobile Broadband Connection"
    present: true, on: true, connected: true,
    carrier: 'docomo', generation: 'LTE', signalPercent: 0-100, roaming: false
  },
  online: true             // the device has an address (local reach); internet reach is the page's own check
}
```

The tray shows the first connection it finds, in this order:

1. wired;
2. Wi-Fi;
3. mobile.

When none is connected, it shows the not-connected icon. Its look is limited when a captive portal is up or the browser says it is offline.

Actions (each returns a Promise; `{ error }` when refused):

- `networks()` returns `{ networks: [{ name, security, signalPercent, connected, known, autoConnect }] }`, strongest first.
- `scan()` starts a scan. The list arrives through `onScan(fn)`, which returns an unsubscribe function.
- `connect(ssid, passphrase?)`, `disconnect()`, `forget(ssid)`, `autoConnect(ssid, on)`, `radio(on)`.
- Planned for mobile: `mobileData(on)`. The UI hides the switch when the provider lacks it.
- `can()` (optional) returns `{ connect, disconnect, forget, radio, scan }`. A `false` disables that action in the Wi-Fi
  windows, as Vista greys out what an adapter does not support. When `can()` is missing, every action the provider has is allowed.

Round 2 (#932, Nov 19; DreamOS host branch `tray2`). All optional: the UI hides or greys what a provider lacks.

- State additions:
  - `wifi.mac`, `wifi.ip6: []`;
  - `wifi.network.connectedAt` (ms since the epoch, when this connection came up), `wifi.network.rxBitrateKbps`, `wifi.network.txBitrateKbps`;
  - each `ethernet[]` entry: `mac`, `ip6: []`, and `config: { mode: 'dhcp' | 'static', address, prefix, gateway, dns: [] }` (what is set, not what DHCP gave).
- `stats(iface?)` returns `{ iface, rxBytes, txBytes, rxBitrateKbps, txBitrateKbps, connectedAt, ip: [], ip6: [], gateway, dns: [], dhcp: bool, mac }` for the Wi-Fi adapter (no argument) or a named interface. It is read when asked, never pushed: counters change all the time. The status window reads it once a second, only while it is open and visible (a live view, `server-push-not-polling` "Allowed").
- `known()` returns `{ networks: [{ name, security, autoConnect, lastConnected }] }`: the saved networks in priority order, highest first.
- `order(names)` sets that priority order. The host applies it: it chooses among saved networks in range in this order when it connects by itself.
- `ipConfig(iface, { mode: 'dhcp' } | { mode: 'static', address, prefix, gateway, dns: [] })` sets an interface's IPv4 configuration. DreamOS applies it through systemd-networkd and keeps it on /data. Answers the new state, or `{ error }`.
- `interfaces()` returns `{ interfaces: [{ name, kind: 'wifi' | 'ethernet' | 'mobile', label, mac, enabled }] }`, for Network Connections.
- `enable(iface, on)` turns an adapter on or off (Network Connections' Enable / Disable; for Wi-Fi this is `radio(on)`).
- `can()` gains `order`, `ipConfig`, `enable`.

The UI:

- `dreamosNetTray.js` draws the icon and the tooltip.
- `melatonControlPanel.js` draws the flyout and the Network and Server Center.
- `dreamosWifi.js` draws Connect to a network, Manage wireless networks and the status window.

## volume

The state is `{ present: true, volume: 0-100, muted: false, sink: 'Speakers' | null }`.

Actions: `set({ volume?, muted? })` returns a Promise of the new state.

While a volume provider is in use, `tabVolume.js` works as follows:

- The tray slider and the speaker button act on the device.
- The tab's own gain stays at 1, so audio is not turned down twice.
- Changes made elsewhere, such as the volume keys, come back through `subscribe`.

## audio devices (Control Panel > Sound, #963)

Sound's Playback and Recording tabs, each device's Properties (General / Levels / Advanced) and the tray volume menu's
Playback devices / Recording devices list the computer's own sound devices. The page side is
`public/scripts/comp/audioDevices.js` (`window.melatonAudioDevices`), loaded with Control Panel; it reads the platform's
bridge directly, not through `melatonTray.register`. The platform is asked to push only while the Sound dialog is open.

Android (DSApp `AudioDevicesBridge`, `window.AndroidAudioDevices`):

- `get()` returns JSON `{ v: 1, device: { manufacturer, model, marketName }, outputs: [dev], inputs: [dev],
  media: { id, pct, muted }, comm, micMuted, canComm: [id] }`. Each `dev` is `{ id, type, name, address, channels: [],
  rates: [], encodings: [], btClass }`: AudioManager.getDevices, `type` in HardwareInfoBridge's names
  (`builtin_speaker`, `bluetooth_a2dp`, `hdmi`, ...), `name` the product name (the Bluetooth device's name, the monitor's
  EDID name). `media.id` is the output media plays on (getAudioDevicesForAttributes(USAGE_MEDIA)); `comm` the
  communication device; `canComm` the outputs setCommunicationDevice takes.
- `watch(on)`: while on, AudioDeviceCallback, the communication-device listener and the volume / mute broadcasts push
  `androidaudiodevices` (detail = the same object), only when it changed. Off when the page is off screen (onStop).
- `setCommunicationDevice(id)` (`-1` clears) returns a boolean; `setMedia(pct, muted)` (`-1` keeps) and
  `setMicMute(on)` return the new state.
- Media output (Android 14+, DSApp `MediaOutputRouting`): the state also carries `routes: { allowed, canGrant, granting,
  error, target, items: [{ id, name, type, description, system, selected, state }] }` from MediaRouter2's proxy router,
  the API behind Samsung's Media output panel: the speaker, wired / USB, each connected Bluetooth device, HDMI /
  DisplayPort and the playing app's cast routes. `selectRoute(id)` moves media playback there (transferTo);
  `allowRouting()` allows MEDIA_ROUTING_CONTROL once through the app's shell (appops); `showOutputPanel()` opens the system
  Output Switcher when there is no shell. The page lists connected Bluetooth devices not in use and cast routes (as
  Vista's Remote Audio) beside the AudioManager outputs, puts the check on the selected route, and Set Default moves
  playback there (allowing routing first when needed).

DreamOS (CaféReady `audio.rs`, `window.DreamOSAudio`): the volume state gains `outputs` / `inputs`, PipeWire's sinks and
sources read with `pw-dump`: `{ id, name, description, card, cardLongName, alsaCard, bus: 'pci' | 'usb' | 'bluetooth',
api: 'alsa' | 'bluez5', address, formFactor, port: { name, description, type, available: 'yes' | 'no' | 'unknown' },
isDefault, volume, muted, channels, rate, format, bits, formats: [{ bits, rate }], dsp }`. `devices()` asks for a fresh
read (also done on a `sound` uevent); `setDefault(id)` (`wpctl set-default`); `set({ id, volume?, muted? })` sets one
device; `set({ id, format: { bits, rate } })` sets its Default Format (the ALSA node's audio.format / audio.rate, kept in
a WirePlumber drop-in; Advanced lists `formats`, the ones its hardware offers, and Restore Defaults picks 24 bit or the
deepest offered at 48 kHz).

The MacBook Pro 11,x (#910, DreamOS `speakers.rs`): `dsp: true` marks "Speakers", the filter-chain that splits the sound
between the tweeters and the woofers. Its Properties gain Vista's Enhancements tab (SysFxUI.dll dialog 200 with its
Settings dialogs 201 / 202 / 210): Bass Management (crossover, invert polarity), Bass Boost (frequency, level), Low
Frequency Protection (cutoff), Loudness Equalization (release time) and Disable all enhancements, read from the state's
`speakers` and applied with `set({ speakers: { disableAll, bassManagement: { on, crossover, invert }, bassBoost: { on,
frequency, level }, lowFrequencyProtection: { on, cutoff }, loudness: { on, release } } })`. The card sink under it is
listed as Headphones (its headphone route: Not plugged in without a plug); the jack moves the default between the two.

What the page draws (Vista's names and mmsys.cpl pictures): Speakers / Headphones / Headset Earphone / Headset Microphone
/ Handset / Microphone (Microphone Array for several built-in mics) / Line In / Line Out / Digital Output Device (HDMI or
SPDIF), the hardware under it (the phone's marketing name for built-in devices, the Bluetooth or HDMI device's name,
PipeWire's description), the green check on the default, the level meter on the default output, Not plugged in (a jack
port reports unavailable) and Disconnected (paired Bluetooth audio that is away, shown with the list's Show Disconnected
Devices). Set Default: Android takes it for a headset microphone (setCommunicationDevice) and for a disconnected
Bluetooth device (it connects, and Android plays media on it); with Media output routes (above) Set Default moves
playback to any output but the earpiece. An older app without routes greys it with the reason. A plain browser keeps Built-In Sound Output / Input.

## bluetooth (trayBluetooth.js: one icon for every provider)

Vista shows Bluetooth as a notification icon of its own, left of the system icons, with a right-click menu. The planned state:

```js
{
  present: true, on: true,
  devices: [{ id, name, kind: 'audio'|'input'|'phone'|'other', connected: true, battery: 80 | null }]
}
```

Planned actions:

- `power(on)`;
- `connect(id)` and `disconnect(id)`;
- `openSettings()` (the platform's Bluetooth Devices page).

The icon is placed before the system icons (Power, Network, Volume, then the clock). Desktop tray icons can be dragged elsewhere (`trayOrder.js`).

## Built in

| Area | DreamOS (priority 30) | Browser |
| --- | --- | --- |
| power | `window.DreamOSHardware` + `dreamoshw`, `AndroidHardware.getBattery()` for time left | `navigator.getBattery()` (trayPower.js fallback). A desktop without a battery shows no icon |
| network | `window.DreamOSNetwork` + `dreamosnet` / `dreamosnetscan` | none: websocket.js's globe |
| volume | `window.DreamOSAudio` + `dreamosaudio` (CaféReady `tray` branch) | none: the tab's own volume |
| bluetooth | `window.DreamOSBluetooth` + `dreamosbt` (CaféReady `tray2`, BlueZ): `get`, `power(on)`, `connect(id)`, `disconnect(id)` | none |
