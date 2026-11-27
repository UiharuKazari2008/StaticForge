# #1392 step 2 on the A53: NOT MEASURED, the phone cannot be reached (Nov 27 2026)

Lease `a53` held by claude-974b3227 (coord lease 276, about 15:01 local), released after the attempt. Nothing was
installed or changed on the phone: no command reached it. This is neither a pass nor a fail.

`A53_AGENT=claude-974b3227 scripts/aemu-lane/a53/a53.sh status`, then `up` (the whole recovery ladder):

| step | result |
| --- | --- |
| status | `ip=192.168.100.236 serial=192.168.100.236:5555 adb=none hostPing=no`, no TLS port |
| rung 1, adb over Wi-Fi at 192.168.100.236:5555 | none |
| rung 3, ping, then the phone's own mDNS name `adb-R5CT71TSEMZ` | no answer; not on the LAN |
| rung 4, Custodian over Bluetooth, `wifi_enable --device dev` | `LinkDown: phone 'Marine' not reachable ... Custodian service not found on A8:79:8D:F7:CC:69`, SDP query failed (WSA 10108) |
| rung 5, Custodian ensure-adb and unlock over Bluetooth | the same `LinkDown` |
| end | `up: FAILED, adb is none` (exit 1) |

The ladder's line `screen unlocked over Bluetooth` is wrong here: the call before it failed with `LinkDown`. That
false success in `a53.sh` is already reported by #1379 (with their Fleet item 249).

Also tried: ping of the phone's other known address 192.168.100.240 (down), `adb mdns services` (no A53 entry).
The one other device in `adb devices` is not the A53 and was not touched.

**Why** (read from records by #1379, `../../1379/a53/README.md`; it cannot be confirmed without the phone): the last
ActiveSync status at 09:25:49 reported battery 0, not charging, and ActiveSync disconnected at 09:27:00.
`docs/testing/emulator-lane.md` names a flat battery as the one case no software covers (it needs the power button).

## Other real-phone evidence looked for

The server's stored fault reports (`data/fault-reports/`, read only) hold no report that names `getWindows`,
`scanWindows` or `ensureWindowsAvailable`. A 10 s block of a background service raises no ANR by itself, so this says
nothing either way. The Fold was not touched.

## What to run once the A53 is back

One display (1080x2400), no Shizuku: the holder goes through local ADB. Release with the #1392 fix, and first, if the
phone still has an older release, one start of that one for the before figure.

1. Display off (`input keyevent KEYCODE_SLEEP`; `a53.sh unlock` brings it back).
2. `adb install -r` of the SAME installed APK, once (it replaces the process as an update does; the A53 gives no root,
   so there is no `kill -9`).
3. From logcat, against ActivityManager's `Start proc`: the first `MelatonBars` line, `holder token linked`, any
   `Choreographer: Skipped`, and (new builds) `window read took N ms` and `first window look applied after N ms`.
   An older build with this fault shows a main-thread gap of about 5 s per read on this one-display phone (inferred
   from the 5 s per display in Android 17's `ensureWindowsAvailableTimedLocked`; the A53 runs Android 16).
4. Screen on, unlock: the bars are right.
