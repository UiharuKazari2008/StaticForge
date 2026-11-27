# #1309 / #1312 part F - lane proofs on aemu-fold-2 (Nov 27 2026)

| folder | proof | result |
| --- | --- | --- |
| `accept-1272/` | the #1272 example acceptance (`tests/accept-1272.sh`) | 7 PASS; shade shots read |
| `reboot-1/`, `reboot-2/` | `tests/reboot-recovery.sh` twice | run 1: 5 PASS + the outdated Android-copy check; run 2: 6 PASS (`reset.json` = the `reset` after it) |
| `p1/` | first Restart Now on release 3632075 (Shizuku access was off in the golden): `installing via adb`, silent | log + proof text |
| `p1b/` | Restart Now with Shizuku allowed: `via shizuku (stream)`, 3632075 -> 3632092 | `logcat.txt`, `proof.txt`, `2-after.png` |
| `p2/` | the update waits (Shizuku off, local ADB off), shows nothing, installs by itself after `shizuku start` + an app process restart, 3631954 -> 3632120 | `restart-now-34.txt`, `server-delivery-waiting.txt`, `logcat-install.txt`, `3-waiting-34.png`, `4-after-install.png` |

Written down in `docs/testing/emulator-lane.md` (Status, Gotchas "Update proofs").
