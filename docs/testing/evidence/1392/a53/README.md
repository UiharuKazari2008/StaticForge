# #1392 step 2 on the A53: measured once; the 5 s wait did not happen on it

Nov 27 2026, about 19:00 local (coord lease 303 on `a53`, build gate 352). Galaxy A53, Android 16 / SDK 36, one display
(1080x2400), no Shizuku server, `MelatonBarService` bound. App: release 44 = versionCode 3632992, which has the fix
(built from `7d8a6d8`, contains `7bfd4d9e`). #1405 had installed it earlier the same evening.

**The start** (`measure.sh`, one run): screen switched off with `KEYCODE_SLEEP`, then **one** `adb install -r` of the APK
already installed (same sha256 as the phone's `base.apk`), which replaces the process as an update does. The A53 gives no
root, so there is no `kill -9` and no `debuggerd`.

| from ActivityManager's `Start proc` | A53 |
|---|---|
| first `MelatonBars` line (`early hold at process start`) | +1.33 s |
| first window look applied | +1.79 s; the app's own figure for it: **430 ms, 1 window** |
| `holder token linked` (over local ADB) | **+2.83 s** |
| `window read took` (logged above 1000 ms) | no line |
| ANR or crash of the app | none |

Both acceptance times are inside 5 s. After the wake (+61.19 s) Melaton's lock cover was drawn by +61.43 s; after the
unlock both app bars were there (`bars-after-unlock.jpg`: cropped to the two bars, the rest of the picture showed unread
counts).

## What this says, and what it does not

- **The screen never went fully off.** The phone reported `Dozing`, and the display alternated between `DOZE` and
  `DOZE_SUSPEND` from before the install until the wake (`start-log.txt`). On the emulator lane the displays were `OFF`.
- The first window look had a window to report, so the condition for Android's wait (a display with **no window list**
  for a new accessibility connection) evidently did not hold. That the doze state is why is **inferred**.
- The release has the fix, so this run could not have shown a main-thread stall either way. What it measures is how long
  the first read itself took on a real phone: at most 430 ms, so **no 5 s wait**.
- **So the stall has not been shown on any real phone.** The blocking call is Android's own accessibility code, not
  something the emulator's translation adds, and the app no longer waits for it on main wherever it occurs. Whether it
  occurs on a phone whose screen goes fully off was **not** tested.
- Not done: a run on a release without the fix on this phone (going back to one would need an uninstall, which would wipe
  the app's data), a second run, a run with the always-on or doze behaviour changed. The Fold was not touched.

The server's stored fault reports (`data/fault-reports/`, read only, searched earlier that day) held none naming
`getWindows`, `scanWindows` or `ensureWindowsAvailable`. A 10 s block of a background service raises no ANR by itself,
so this says nothing either way.

## Files

- `start-log.txt`: cut from logcat (the app's bar lines, CaféReady's start, the lock cover, display, wake and keyguard
  lines). The full log stayed outside the repository and was deleted.
- `run.txt`: what `measure.sh` printed. The phone's MAC and Wi-Fi address lines and a battery history the script printed
  by mistake are left out (the script's battery line was narrowed afterwards; that edit has not run on the phone).

## The earlier attempt the same day

About 15:01 local (lease 276) the phone could not be reached: Wi-Fi adb, ping, its own mDNS name, and Custodian over
Bluetooth all failed (`LinkDown: phone 'Marine' not reachable`). #1379 read that the battery was probably flat
(`../../1379/a53/README.md`). `a53.sh up` also printed `screen unlocked over Bluetooth` after that failure; that false
success is reported by #1379.
