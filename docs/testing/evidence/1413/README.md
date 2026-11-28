# StaticForge #1413: the light on the Today glass band - lane evidence

Device: emulator lane `aemu-a53-1` (A53 shape, 1080x2400, Android 16, app release 3632992), Melaton Mobile 6.5, Today.
Date: Nov 27 2026. Script: `scripts/aemu-lane/tests/accept-1413.sh` (steps in `accept-1413.js` beside it).

```
COORD_AGENT_ID=<your id> scripts/aemu-lane/tests/accept-1413.sh aemu-a53-1 --install --out <DIR>
```

Nothing is put into the page: the client takes new files through its own Install path
(`serviceWorkerManager.installUpdates()`, what Install Now does), and every reading is the shipped client.

## Result

`final/summary.txt`: **59 PASS, 0 FAIL** on the build of commit `03dc8688d`
(`wm-titanium.css` 38537 bytes with `is-drift` and the 110 degree ray; `wmTitanium.js` with the damping counted in time).

| What the issue asks | Reading (files in `final/`) |
| --- | --- |
| Leaning the phone moves the light | Accelerometer poses from a 45 degree hold. `--wm-ti-sx` / `--wm-ti-sk`: 0 deg 0.00 px / 0.0 deg; +9 deg 8.38 px / -1.0 deg; -9 deg -10.29 px / 1.2 deg; +18 deg 16.00 px / -2.0 deg; -18 deg -20.19 px / 2.4 deg. The computed `transform` matrix carries both at every pose (`e` = the slide, `c` = tan of the slant), so the light's place and its angle move. Pixels: the rays alone (shot with the light on minus off) sit 67 device px apart between +9 and -9, 65 expected from the two readings (correlation 0.80). `B-poses.json`, `B-pixel-shift.json`, `band-*.png` |
| ... damped ("too reactive to gyro") | A step straight to +18 deg reaches 63 % after 0.81 s and 95 % after 2.02 s (`B-damping.txt`; the emulator's sensor fusion adds its own lag, the light's own time constant is 0.55 s by the clock, not by frames) |
| Rays at visibly different widths | 7 gradients, 25.2 / 32.9 / 46.6 / 59.5 / 82.7 / 104.8 / 146.3 CSS px across (5.8 x), peaks 0.05 to 0.11 white, angles 101 to 110 degrees. Pixels (on minus off, `rays-diff.png`): 6 peaks on the clear row, width at half height 27.8 to 83.7 device px (3.0 x); steepest ramp 0.69 alpha-percent per device px. `C-ray-widths.json`, `C-pixel-peaks.json` |
| The idle drift settles and stops | Touch at 19:32:23.4. `--wm-ti-dr` 0 % at +25 s; from +31 s one `translate` transition runs (computed 0.68 %, 1.08 %, 1.196 %), at +40 s and +45 s it is at 1.2 % with no animation. Class `is-drift` only from the idle's start. `D-timeline.json` |
| Ended state, measured | 20 s window 19:33:09.6 to 19:33:29.8: **0 frames drawn** by the app (control: 411 frames in the 8.7 s drift window), **0 running animations**, **0 DOM changes** (observer), the light's values unchanged, Android's sensor service `game fusion(no mag) disabled (0 clients)`, the page's sensor registration ended at 19:32:53 (touch + 29.6 s). `D-settled.json` |
| The #890 peek | One registration at 19:34:00 and its end at 19:34:01 (one second each minute while Today rests on screen), 28 frames across it. `D-minute-boundary.json` |
| Nothing moving with a program in front | Android Settings in front, from the settled state and from a held lean: first reading with the page hidden (0.9 s / 0.8 s after the command) already has slide 0, slant 0, drift 0, no `is-drift`, no running animation; 0 frames over the next 8 s; no sensor registration; a lean set meanwhile changes nothing. A Melaton program (Calculator) in front inside the page: the same. `E1-*.json`, `E3-settled.json` |
| ... with the screen off | The same at 1.5 s, 4.7 s, 10.7 s and 18 s; 0 frames; no peek at 19:37:00 with the screen off. `E2-settled.json` |
| Back on Today | The sensor is registered again each time (`game fusion(no mag) enabled (1 clients)`) |

Screens: `final/today-rest.png` (Today at rest), `final/band-0.png`, `band-plus9/minus9/plus18/minus18.png` (the glass
band at each pose, full resolution), `final/rays-diff.png` (the rays alone, amplified; red = the middle row, green = the
row measured). `before-fix/band-0.png` is the first look (four hairlines) that Yukimi called "too sharp, too thin and
consistent".

## The other folders

- `01-install-window.png`: the page's own install window ("Installing Melaton Mobile update ...") when the lane first took
  the new files. The lane page had never "failed to pick the update up": it runs the default update mode `notify`, which
  only counts updates until Install is pressed.
- `before-fix/`: the same script on the first build (commit `99bd959a7`): the defect. With the drift settled and Android
  Settings in front, a `translate` transition was still running on the hidden page 0.7 s and 4.3 s after
  (`FAIL (expected before the fix)` in its summary). It used the first version of the script.
- `new-build-first-run/`: the first run on the soft rays (commit `d71f6999a`), 49 PASS and 2 FAIL, both from the script:
  the rest offset after a chain of leans (the tilt's resting hold follows the pose, by design) and 2 frames in the
  settled window, which `D-frames-diagnosis.txt` and a later observer run traced to the status bar's icons and Today's
  data rows, not to the light. The script was then changed to judge the light itself (observer on its layer) and to
  switch the weather effect off while it counts frames.

## Reading the numbers

- On the emulator a still sensor sends no `deviceorientation` events, so a pose keeps its offset. On a phone the tilt's
  resting hold re-centres within seconds (1 % per reading, `onOrient`), which is why a full 18 degree lean reads 16 to 20 px
  here and not the full 24.7 px.
- Every DevTools attach (each `lane.sh eval`) while the page listens makes Chromium end and start its sensor registration in
  the same second. Those `-` / `+` pairs in the sensor log are the test's probes, not the page.
- The weather effect (#1109) animates its clouds for as long as Today is seen: 612 frames in 10 s with it on
  (`D-weather-on.json`). That is its own behaviour and was left as it is; step D switches it off the way Settings does
  so the frame counter reads the light.

## Steps that failed on the way

- A run at 18:53 was disturbed: a dialog page of the shell (`wm-op`) took Today's place for about 30 s after another
  session's server restart and client update. The script now waits for Today and repeats the step.
- A run at 19:08 never started: the emulator had been up 1 h 48 min under several test runs, its load average was 19 and
  Android showed "DreamScape isn't responding" during the page's install. `lane.sh aemu-a53-1 reboot`, then the run above
  (the install took 14 s).
