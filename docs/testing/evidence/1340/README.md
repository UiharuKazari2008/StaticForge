# #1340 acceptance: Melaton Bars' accessibility service comes back by itself (StaticForge #1396)

Build: release 37, 1.0.3632181 (build/latest c4980a2), carrying DSApp `fix/1340-bars-service-heal` 3483207. Nov 27 2026.
DSApp main 17af0aa merges the branch at 44c6e81. 44c6e81 is 3483207 plus ONE diagnostic label in the fault report
("shell access set up (cached, not a live check)"); that last commit was compiled and unit-tested (348 tests, 0 failures),
not run on a device.

Sheets: `sheet-a53.png`, `sheet-lane.png`. All files: `a53/`, `lane/`.

## A53 (SM-A536U1, Android 16), `a53/`
Real A19 case: `am crash`, "Close app", home set to another app, Android Settings in front, nothing touched; no Dreamscape
window was started. Times are seconds after the tap.

| run | result |
|---|---|
| A1 direct route | bound 16.4 s (verify logged 19.7 s), bars and one WM notice box in the 18.8 s screenshot: PASS |
| A2 shell route (permission revoked, local ADB) | bound 16.6 s, box 16.8 s; permission granted again afterwards: PASS |
| A3 no route at all | 3 attempts failed, gave up at 40.2 s, one `BarsServiceUnbound` report (fault_fa58499c5f55): PASS. Android's 3 buttons back; **its status bar stays blank** (below) |

## Lane aemu-fold-2 (Android 17, Fold-shaped, Shizuku), `lane/`
| run | result |
|---|---|
| L1 direct | bound 16.8 s, bars back: PASS. A notice sent 0.2 s after the bind got **no box** (below) |
| L1b direct, notice 3 s after the bind | bound 16.2 s, box in the 21.7 s screenshot: PASS |
| L2 shell (Shizuku) | bound 17.0 s, box 22.5 s: PASS |
| L3 cap across processes (5 stamps written with root) | no attempt, no write, the "keeps going unbound ... 5 times within 30 minutes" report, gesture fallback at the 30 s deadline; with old stamps the next process healed: PASS |
| L4 no route | 3 attempts, give-up, report, 3 stamps stored: PASS. Status bar blank and locked (below) |
| L5 `kill -9` | Android rebinds by itself, no attempt: PASS |

Not run: a boot younger than 2 minutes (the case R6 matters most in). R6's rule is covered by unit tests only.

## Found, not fixed here
- With every shell route gone, Android's status bar stays blank (and by its flags the shade stays disabled): the lock is
  `cmd statusbar send-disable-flag`, and removing it needs the same shell. DSApp main's old `heal()` fallback had the same
  limit. Fleet work item 242.
- A notice arriving about 0.2 s after a service bind gets no box and stays held (seen once); the notice box and soft key
  bar layout on the 1968 px display (box not resting on the bar, black strip below). Fleet work item 243.
- At the cap, the bottom row stays empty with no Melaton bar until the 30 s not-bound deadline switches to gestures (about
  26 s after the give-up). That is the #1371 deadline working as built.

## Unit tests
`BarsHealPolicyTest` 62, `NavRoomPolicyTest` 31; the whole suite 348, 0 failures (compile and tests on Ruiko, on the branch
and on the merge result).
