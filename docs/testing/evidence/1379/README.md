# #1379: the nav-row review findings left open after #1371

DSApp-Kotlin: `899d9b5` (shell layer), `f0fe4c1` (nav row), `b0afbc1` (two comments corrected after the device run),
on `main` as `763cc1f` (Nov 27 2026). Server: `modules/deviceAdb.js` (screen ops fall back on the phone's `ADB` error).

| item | what | proof |
| --- | --- | --- |
| 1 / 10, S6 | a trusted key's non-auth error no longer marks it unauthorized (`LocalAdbPolicy`) | lane, no Shizuku: held after a failed first attempt (release 40), release 39 shows the bug; two reboots held 15.5 s and 23.1 s after boot. **Real A53: NOT TESTED (unreachable)**, Fleet 249 |
| 2, N3 | an ADB-started holder moves to Shizuku; the route is logged | lane: moved with no gap (twice). **Survives `adb tcpip 5555`: FAIL on the plain lane setup**, PASS only with `shizuku_server` outside adbd's cgroup |
| 3, S5 | a queued Shizuku command past its deadline is never run | unit tests, all callers read; no device case |
| 4, N1 | a late token clears the failure counts | unit tests of the decision; no device case (needs a test hook) |
| 5, N6 | the retry chain's real length in comment and test | unit test |
| 6, R5 | the unbound check looks once more | lane: switched on the second look; with the route left closed exactly one extra look |
| 7, 8, R6, R7 | already fixed on main by `3483207` (#1396) | read in the code; `BarsHealPolicyTest` |
| 9, R8 | the unbound check gives Android's status bar back | lane TEST 3 |
| 11 | the 30 s not-bound fallback with the heal blocked | lane TEST 3 (release 40); earlier also #1340 L3/L4/A3 |

Files: `unit-tests.txt` (631 branch, 638 with every unmerged branch, 693 on the merge to main), `aemu-fold-2/`,
`aemu-fold-2-s6/`, `a53/`.

Found and handed on: Fleet 249 (A53 proof; three quick failed starts can ask for the gesture fallback; `a53.sh bt`
reports success on a failed command), 250 (splash badge with no name), 251 (no route and no Bars service: the row
stays empty with no bar).

The accepted mark was NOT raised: no household phone gets a release from this work.
