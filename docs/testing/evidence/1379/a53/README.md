# #1379 item 1 on the A53: BLOCKED, not tested (Nov 27 2026)

The Galaxy A53 could not be reached by Wi-Fi adb, mDNS, Custodian over Bluetooth or ActiveSync. Release 40
(versionCode 3632839) was not installed. This is neither a pass nor a fail of the fix. Times and output: `log.txt`.

| Acceptance point | Result | Measured |
| --- | --- | --- |
| APK is the named build | PASS | sha256 8606dbf4...57aa75 matches |
| Baseline (navigation_mode, overlay, holder, shell record, Shizuku, local ADB, 3-button room) | NOT RUN | phone unreachable |
| Install release 40 once, row held | NOT RUN | no install attempted |
| Reboot 1: row held within about 30 s | NOT RUN | none |
| Reboot 2: row held within about 30 s | NOT RUN | none |
| Reboot 3: row held within about 30 s | NOT RUN | none |
| S6: failed first local-ADB attempt, then recovery | NOT RUN | no logcat from this run |
| adbd restart: holder held again, no Shizuku move line | NOT RUN | none |
| Final state: row held, release 40, unlocked, Home | NOT MET | state unknown |

## Probable cause: the battery ran out

This is read from records. It cannot be confirmed without the phone.

- 05:56: the phone was not charging (AC, USB and wireless all false), 52% -> 49% (`../../1327/a53/NOTES.md`).
- 09:25:49: its last ActiveSync status reported battery level 0, not charging.
- 09:27:00: ActiveSync disconnected. It had not been seen again at 14:30:42.
- 14:24-14:30: no ping at either known address, no mDNS entry, and Bluetooth cannot find the Custodian service
  (the Custodian PC itself answers ssh).

`docs/testing/emulator-lane.md` names this as the one case no software covers: a battery at 0% needs the power
button. The same page says the phone sits on AC, which the 05:56 reading contradicts, so the charger, cable or
socket needs a look too.

## To run once the phone is back

All the steps above, from the baseline. First check `dumpsys battery` shows a powered source and enough charge for
one install and three reboots. The version last reported by the phone was 3632251.
