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

## bluetooth (reserved; no UI yet)

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
