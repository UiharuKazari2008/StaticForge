# #1338 device pass, round 3 (the planner's own run)

Instance `aemu-a53-1` (A53 shape, 1080x2400, devicePixelRatio 2.625, Android 16, `-no-audio`), Nov 27 2026,
06:01-06:21 UTC. Device times in this file are EST (UTC - 5). Rounds 1 and 2 are `device-pass.md` and `device2-pass.md`.

## Why rounds 1 and 2 saw no native bar and no car glyph

| What | As found on the golden instance | What a phone that uses Melaton Mobile as its home screen has |
| --- | --- | --- |
| App release | 20 (3631778, before the #1340 fix) | current |
| Page version (`localStorage.wmVersion`) | unset = 6.1 (no picture holder) | 6.5 / 6.5.1 |
| `AndroidBars.getState().config.enabled` | false | true (`wmPrograms.js` applyLauncherDefaults) |
| `localStorage.wmCameraExtendBar` | unset: the bars stand down, logcat `Android's bar given back: extend-off` | `1` |

Set for this run, all on this one emulator, all device-local: release 30 (3632021) by `lane.sh install-release 30` once
(build gate 250); `wmVersion` = `6.5.1` and `wmCameraExtendBar` = `1` with the page's own restart
(`serviceWorkerManager.forceRestart()`, what Settings > Melaton Update > Version does); `AndroidBars.setConfig({enabled:true,
softkeys:true, room:true})`. After that: `melatonBars.unsupported()` = `''`, `enabled / running / service / elevated` all true.

The car was forced with the page-local event only
(`window.dispatchEvent(new CustomEvent('androidcarkey', {detail:{cars:[{key:'lane-1338', car:'Lane Test Car'}]}}))`).
The drive state was NOT forced: the app's car-presence task would tell the live server "in the car" (`lapis_presence`).

On the upright Today screen the car's glyph folds into the "..." (class `wm-shed`): the fit rule keeps the icon row in the
bar's right half (`public/scripts/tasks/status-fit.js`). With the screen turned (2400 px wide) every icon fits.

## 1. The car on the black bar, drawn by the page

Melaton's Calculator in front, screen turned, car forced. From the DOM:
`title: "Calculator", barBg: "rgb(0, 0, 0)"`, icons (role@x,y width, device px):
`notify@1560,21 64`, `carkey@1644,21 64`, `mail@1728,21 64`, `received@1811,21 64`, `bluetooth@1895,21 64`,
`data@1979,21 64`, `signal@2062,21 64`, `volume@2146,21 64`, `battery@2230,21 64`.

- `device3-01-page-bar-car-on-black.png`, `device3-01-page-bar-car-on-black-crop.png` (the bar's right part, 2x).
- Read: a white car seen from the front, second in the row after the notification bubble, on a pure black bar. Pixels of
  the bar's background: (0,0,0). The car's 64x64 box: 1192 of 4096 pixels brighter than 200, maximum 255.
- It is the art of `wm61/status-traffic` (a car since `d0e87006c` / #795, the Car item's glyph since `6f50f8e6b` / #902). It
  is not a road with a traffic light and not the key with radio waves (`status-carkey`).

## 2. The car on the app's own (native) bar

Android Settings in front, upright. The bar on top is drawn by the app (accessibility overlay windows `MelatonBar`).

- `device3-02-native-bar-car.png`, `device3-02-native-bar-car-crop.png`.
- Read: "Android Settings", then notification bubble, the white car, mail, sync arrows, Bluetooth, data, signal, volume
  off, battery, X. The car is the same glyph as in the page.
- The app's own file `files/melaton_bars/status.json` at that moment:
  `[{"role":"notify","art":"/static_images/wm61/status-notify-many"},{"role":"carkey","art":"/static_images/wm61/status-traffic"},{"role":"mail",...},{"role":"received",...},{"role":"bluetooth","atlas":"bluetooth"},{"role":"volume","atlas":"volume-off"}]`
- logcat: `MelatonBars: bar tap: notify [start:0-129 notify:825-963 carkey:963-1047 mail:1047-1131 received:1131-1215 ...]`.
- Round 2 hashed the app's copy `art/..._wm61_status-traffic_4x.png`: `6fa19ba65175ff97...` = the repo's
  `wm61/status-traffic@4x.png`.

## 3. The car's picture in the app's own (native) holder

A tap on the notification bubble of the native bar (525,52); logcat `MelatonBars: bubble notetray drawn here`.

- `device3-03-native-holder-car.png`, `device3-03-native-holder-car-crop.png`.
- Read: four notice bubbles, then the bright silver car, the e-mail envelope and the sync icon, on the dark strip under the
  bar. The car is sharp, not clipped, as wide as its neighbours and lower (its shape).
- Measured in the screenshot: the strip behind it is RGB 83,89,92; the car's bright pixels average luminance 202.
- Nothing in the holder was tapped; closed with the same tap.

(The page's own 6.5.1 status drawer with the car is round 2: `device2-03-page-drawer-car-crop.png`.)

## 4. The app's own copy of the picture

`/data/data/jp.net.seventhreeseven.dreamscape/files/melaton_bars/art/staticforge.737.jp.net_static_images_wm65_holder-car_4x.png`

- sha256 `58778e4cf1f19b7cfa32e339bb4ba91642ddcc9ded5e1ed30fb170630428d410`, 20051 bytes, written 01:10:27: the fixed
  picture (repo `wm65/holder-car@4x.png`, same hash).
- Kept validators in `shared_prefs/melaton_bars.xml`: `etag:art/...holder-car_4x.png` = `W/"4e53-1a21aefb847"` (the
  server's current ETag), `hash:art/...` = `58778e4c...`.

## 5. A phone that still holds the old black picture: replaced at the next app start

The app looks at a picture's server copy once per app process (`NativeBar.kt` loadArtFile / fetchNewer). The stale state
was built by hand: the old black car (`git show 8b238f9a7:public/static_images/wm65/holder-car@4x.png`, sha256
`b9f3e9fb...`, 9466 bytes) written into the app's file, `hash:art/...` set to `b9f3e9fb...`, `etag:art/...` set to a stale
tag, and the app process killed in the same root script (owner `u0_a217` and SELinux label unchanged). Output:

```
T0 before seed:  01:19:01.073 pid=9062 file=58778e4cf1f1/20051 etag=W/"4e53-1a21aefb847" hash=58778e4cf1f1
T1 seeded+killed 9062: 01:19:01.329 pid= file=b9f3e9fba799/9466 etag=W/"24fa-stale1338" hash=b9f3e9fba799
+2s 01:19:03 pid= file=b9f3e9fba799/9466 etag=W/"24fa-stale1338" hash=b9f3e9fba799
+4s 01:19:05 pid=9284 file=b9f3e9fba799/9466 etag=W/"24fa-stale1338" hash=b9f3e9fba799
+8s 01:19:09 pid=9284 file=58778e4cf1f1/20051 etag=W/"4e53-1a21aefb847" hash=58778e4cf1f1
new process started: 2026-11-27 01:19:05.441
```

The new process (pid 9284) replaced the old picture with the fixed one about 4 seconds after it started, and kept the new
validators. A first, uncontrolled try gave the same result (the app had restarted itself after `stop-app` before the seed
and had replaced the seeded copy 20 s later).

What this does not cover: an app process that is already running and has already drawn the old picture keeps it until
that process ends (once per process). Filed as #1381.

## Found on the way (filed, not fixed here)

- The page does not tell the app about status items it folded itself (`wmShell.js` barsStatusCollect skips `wm-shed`
  icons), so with the page awake the app's native holder leaves out a folded car that the page's own drawer lists. Seen
  here: first native holder shot had four notices and Update, no car, while the page's drawer listed the car. Filed as #1380.
- `wmShell.js:4554` still says "the key (status-carkey)"; the Car item has drawn the car since #902.

## Left as found

Forced car removed (`cars: []`, `wmCarKey.forget`), no `Lane Test Car` in localStorage, the two empty car-key entries the
test made removed; `wmVersion`, `wmBars651`, `wmCameraExtendBar` removed and the page restarted (6.1 again); bars config
`enabled:false, softkeys:false`; rotation auto; `/data/local/tmp/hc-before.png` and `mb.xml` deleted; Melaton Mobile in
front. Not as found: the instance now runs release 30 instead of 20 (the golden snapshot is untouched). No sound, no test
notice, no tap inside the car's pop-up or on a household box.

## Not done

- The A53 phone: granted at 06:12 UTC and released unused, the emulator had started to give the evidence and three
  sessions were waiting for it.
- A native holder screenshot after the stale-copy restart (the car folded again on the upright Today screen; the file
  hash above is the proof).
- The status drawer inside a program with the black bar (it did not open from the signal icon there; not followed up).
