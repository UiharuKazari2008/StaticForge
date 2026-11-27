# #1414 evidence: AI-generated soft key profiles (Nov 27 2026)

Device: emulator lane `aemu-a53-2` (Android 16, A53-shaped, YouTube 20.10.41 / 1553337840, no Google account, no network sign-in).
Install route: `lane.sh aemu-a53-2 install-release 44` = the server's release 44 (`dsapp_build` job 44, sha256
`3443b06ba98db4d985ef4a13b12fb5efa23593742d1d0389d02d52451069f86a`, source `7d8a6d8`, branches incl. `feat/1414-softkey-ai` 31888aa),
`adb install -r -g` on that emulator only, once. The phone reports versionCode **3632992** (`lane.sh status` appVersionCode, read after
the app restart). Release 43 (3632982, the first build) is what the first probe ran on. The A53 hardware phone was not used (other
sessions report it unreachable); no real phone and not the Fold got this build (lane test devices only).

## What a non-root app can read of another app's activities (measured)

| route | result for YouTube |
| --- | --- |
| `manifest` (APK's AndroidManifest.xml through `getResourcesForApplication(...).assets.openXmlResourceParser(cookie, ...)`) | **works, no shell**: 73 activities, 12 link filters, 1 shortcuts file with 3 static shortcuts (Subscriptions, Shorts, Search) and their intents. `probe-youtube-release44.json` |
| `package-manager` (`getPackageInfo(GET_ACTIVITIES)`, app holds QUERY_ALL_PACKAGES) | works: the 73 activity names + exported flags; **no link filters** (a generic https query matches none of the host-specific filters) |
| `shell` (`dumpsys package`, `dumpsys shortcut`; app's local ADB 5555 / Shizuku) | works as the shell user (`yt-dumpsys-package.txt`, `yt-shortcuts-dumpsys.txt`, `yt-resolve-activity.txt`); only a fallback in the app, not needed |

Release 43's probe returned 0 links and 0 shortcuts: its manifest read used cookie 0, which on the lane answers an overlay's manifest
with no activities (`probe-youtube.json`). Fixed in 31888aa (each cookie tried, the manifest whose `package` is the program's own wins);
release 44 reads the real manifest. **Another app's keyboard shortcut guide cannot be read** (Android gives it to SystemUI only): the
probe says so in `notes` and sends nothing for it; static shortcuts are the closest thing.

## Which targets are reachable from outside, and how the profile says so

- A target reached by a link is stored as `uri:<intent link>` (a new action, `SoftKeys.valid` checks it: intent link that names the
  package, no component / selector / launch flags, only `intent:` and `https:`, 8-600 characters). The server also writes a plain https
  link as an intent link that names the app, so it opens in the app and not whatever handler Android picks.
- A target only reachable by driving the app is `key:` / `combo:`; built-ins are the existing names. The answer of the server lists
  every kept action with `via` = `link` | `keys` | `builtin`, and every refused or unmapped entry in `problems` (shown in the dialog).
- On the lane a first generation with only the PackageManager probe (no link filters, `generate-youtube-activities-only-probe.json`)
  mapped nothing but Home and listed the five other entries as could-not-make with the reason: no dead button was made.
- Never trusted: the server checks every action (key names against the full Android KEYCODE list, links against the probe's own
  filters / shortcuts, `open:` only for the app's own program and only for Home / Open), the phone checks them again with
  `SoftKeys.valid` (`AndroidSoftKeyProbe.check`, `profile-saved-via-bridge.txt`: all ok), and `setConfig` cleans on storing.

## The real generation (release 44 probe -> server -> DeepSeek through TokenRouter)

`generate-youtube-release44.json`: engine tokenrouter, model `deepseek/deepseek-v4.1-flash` (the saved default: this server has no direct
DeepSeek provider, so DeepSeek is TokenRouter's DeepSeek model), pre-design mode (her labels: left Subscriptions; right Home, Shorts,
Watch Later, Search, divider, My Account, History), 22-73 s per run, `problems: []`. Subscriptions / Shorts / Search came from YouTube's own
static shortcuts (`intent:#Intent;action=com.google.android.youtube.action.open.subscriptions;package=...;end`), Watch Later / My Account /
History from the https filter (`intent://www.youtube.com/feed/history#Intent;scheme=https;package=com.google.android.youtube;end`).

## The bar on the lane (real taps)

| file | what it shows |
| --- | --- |
| `b-6-youtube-bar-on.png` | YouTube in front, the soft key bar reads **Subscriptions | tasks | Menu** (the generated profile applied by the program in front) |
| `b-7-left-key-subscriptions.png` | tap on the left key: YouTube is on its **Subscriptions** tab (the page says "Sign in": no account on the lane) |
| `b-8-right-key-menu.png` | tap on Menu: **Home, Shorts, Watch Later, Search, divider, My Account, History** |
| `c-1-menu-search.png` | menu row Search: YouTube's search with the keyboard |
| `c-2-menu-history.png`, `c-2-menu-account.png` | menu rows History / My Account: YouTube's History and account pages (YouTube's own "Couldn't sign in" error: the lane has no account) |
| `profile-after-app-restart.txt` | after `kill-app` + start: the YouTube profile is still stored (left uri, right menu with its 6 rows + divider) |

**Not provable on the lane:** Shorts. The `open.shorts` action is delivered (`am start` says so) but a signed-out YouTube stays where
it is, with the tap and with plain `adb shell am start` alike (`c-0-adb-shorts.png`), so the lane cannot tell the row worked. Watch Later
needs an account the same way. Home (`open:android:com.google.android.youtube`) starts the app on its own screen (and is only accepted for
a Home / Open label). These two rows need the A53 or a phone with a YouTube account.

## The Soft Key Bar manager's Generate dialog

Built and covered by `scripts/test-softkey-generate-ui.js` (28 checks on the real page file) and `scripts/test-softkey-generate.js`
(40 checks), but **not yet seen on a phone**: the page assets were held back by another session's `hold-client-update` (#1408), so the
emulator's page still has the old manager. The steps and the screenshots are the open part.

## Unit tests

`unit-tests/summary.txt`: DSApp `testDebugUnitTest` on Ruiko at 4ad0dea, 725 tests, 0 failures (SoftKeyProbeTest 32); the build of
release 43 / 44 compiled the same sources (plus 31888aa, a manifest-open fix, and 5ec7bb3, the two-line `softDo` branch).
