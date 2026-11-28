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

## The Soft Key Bar manager's Generate dialog (lane `aemu-a53-3`, release 44 = 3632992, real taps)

Settings > Personal > Buttons > Soft Key Bar > Add YouTube > **Generate with AI...**:

| file | what it shows |
| --- | --- |
| `e-0-buttons.png`, `e-1-add-combo.png`, `e-2-youtube-profile.png` | the manager; Add: YouTube; the new **Generate with AI...** button next to Remove Program |
| `e-3-generate-dialog.png` | the dialog: wish text, "Design it myself first", Engine (TokenRouter) and Model (`deepseek/deepseek-v4.1-flash`, the saved default), "Make this my default", Generate / Close |
| `e-4-design-mode.png`, `e-5-typing.png`, `e-6-design-filled.png` | design mode: Left / Center / Right names and the right key's menu (one item per line, `-` divider), typed on the phone |
| `e-7-generating.png` | Generate pressed: progress lines inside the dialog ("Reading the program on the phone...", "Asking TokenRouter deepseek/deepseek-v4.1-flash..."), controls disabled |
| `e-8-result.png` | the proposal: Left Subscriptions (opens by link), Center Running Programs, Right Menu (6 items), each row's way (by link / starts the app) and the AI's reason; soft keys Use / Close |
| `e-9-used.png` | **Use**: the manager holds the profile and it is editable: Left = `<Open a Link>` with its link and name, Right = Menu (6 items) |
| `f-0-hand-edit.png`, `f-1-saved-by-ok.txt` | hand edit (left key renamed "Subscriptions feed"), OK: stored in the app's Bars config (left label, left link, menu rows) |
| `f-2` / `f-3-youtube-bar-saved.png`, `f-4-left-key-subscriptions.png` | YouTube in front: bar reads **Subscriptions feed | Menu**, the left key opens the Subscriptions tab |

Notes: the lane's page did not have the new manager yet (a client update did not reach this instance: the page's own Melaton Update stayed
on "Getting the server ready"; the test device has no way to run the server's cache refresh). For this test I loaded the current compiled
`wmSettingsPersonal.js` (served by the server, source sha 5478efd1, same file the update ships) and `softkeys_generate` into the running
page once (`lane.sh eval`); everything after that is the shipped page code driven by taps, the real bridge, the real server and a real
model call. A shipped client update (sw-notify) still has to reach phones for the button to show on them.
Bars over programs needed the lane's `enabled` + "Extend Status Bar" settings switched on by hand (`AndroidBars.setConfig`, `wmCameraExtendBar`).

## Unit tests

`unit-tests/summary.txt`: DSApp `testDebugUnitTest` on Ruiko at 4ad0dea, 725 tests, 0 failures (SoftKeyProbeTest 32); the build of
release 43 / 44 compiled the same sources (plus 31888aa, a manifest-open fix, and 5ec7bb3, the two-line `softDo` branch).

## The A53 hardware phone (Nov 27 2026, 19:0x-19:3x, `h-*` and `i-*`)

The A53 (192.168.100.233:5555 through Ruiko's adb, release 44 = 3632992, Android 16, 3 Google accounts) **has no YouTube app** (only YT Music;
`pm list packages | grep youtube`), and YouTube cannot be put on it from the lane image: that APK is x86_64
(`INSTALL_FAILED_NO_MATCHING_ABIS`, nothing installed or changed). So Shorts / Watch Later / My Account with a signed-in YouTube could not
be shown on it. What the A53 hardware did show, with a program it has (Discord, a stub test app `com.discord`):

| file | what it shows |
| --- | --- |
| `h-2`..`h-5` | Start > Settings > Personal > Buttons > Soft Key Bar on the A53 (6.5 look) |
| `h-9`, `h-10` | **Generate with AI...** is on the A53's page (the client update reached it) |
| `h-11`, `h-12` | first run with a big probe: "TokenRouter did not answer within 90 s" shown as plain text in the dialog (the prompt listed hundreds of activities); fixed in `6f5d2eb85` (only the activities other programs can start, at most 40; 100 s) |
| `h-13` | the run after the fix: proposal from Discord's own link filters (Home, a 3-item menu, by link) and a visible "Could not make" list (Notifications, Settings: no link declared) |
| `i-1`..`i-3` | a second run, Use, OK: the bar over Discord reads **Discord / Menu** |
| `i-4` | after `am force-stop` + restart of the app: the bar still reads Discord / Menu and the Menu lists the generated rows (Quick settings, Show/hide keyboard, divider, Back, Home, Recents, divider, Screenshot, Flashlight) |
| `i-8` | the manager still holds the stored profile after the restart (Left: Discord, Right: Menu, 8 items) |
| `i-9` | the test profile removed again (the A53 is left as it was) |

Wart seen: for a left key that is `open:android:<package>` the manager's "Program:" combo shows empty (its list holds `android:<package>/<activity>` ids); the key works and shows its name.
The first row of the right menu (Notifications) drew no text in `i-4` (a rendering oddity of that run, not looked into).

## Do the stored YouTube links start YouTube? (lane `aemu-a53-2`, `links-resolve-yt.txt`)

`am start -W` of each stored link: all six answer `Status: ok` with a YouTube activity: Subscriptions (via the permission dialog first run), Shorts ->
`watchwhile.MainActivity`, Watch Later / My Account / History -> `Shell_UrlActivity`, Search -> `watchwhile.MainActivity`. What the pages then show needs an account.

## YouTube on the A53 hardware phone (ARM build from Aurora Store, signed out; Nov 27 2026 19:2x-19:4x, `j-*`, `k-*`, `m-*`)

The A53 got YouTube 21.47.483 through its own Aurora Store (anonymous; `j-0`..`j-3`; Android's own installer confirmed; no Google account of
Yukimi's was used and YouTube stayed **signed out**, so no personal data is in these shots). Release 44 (3632992) is the app on the phone.

| file | what it shows |
| --- | --- |
| `k-3-a53-youtube-proposal.png` | Generate with AI... for YouTube, design mode with her labels; first proposal (shortcut actions for Subscriptions / Shorts / Search) |
| `k-4`, `k-5` | the bar over YouTube: **Subscriptions \| Menu**, the Menu |
| `k-7-a53-shorts-by-intent-cold.png` | the same `open.shorts` shortcut action from a cold start with plain `adb am start`: a Short plays |
| `k-8-a53-left-key-subscriptions.png` | the left key: YouTube's Subscriptions tab |
| **finding** | the Shorts row (shortcut action) did nothing while YouTube was already open - and plain `adb am start` of that action does nothing either (Android: "delivered to currently running top-most instance"): the app ignores the action when it is on screen. The https link `https://www.youtube.com/shorts` through `Shell_UrlActivity` works warm and cold. |
| fix | the generator prompt now prefers a declared https link over a shortcut action when the target has a web address, and says why (`softKeyGenerate.js`). |
| `m-2-a53-youtube-proposal-links.png` | the new proposal: every entry "by link" through the app's own https filter (UrlActivity) |
| `m-3`, `m-4-a53-menu-shorts-works.png` | the menu; **Shorts**: a Short plays with YouTube already open |
| `m-5-a53-menu-wl.png` | **Watch Later**: YouTube's playlist page (empty: "No results found", signed out) |
| `m-5-a53-menu-acct.png` | **My Account**: Google's sign-in for YouTube in Chrome (the account page needs an account; nothing was typed) |
| `m-6-a53-menu-history.png` | **History**: YouTube's signed-out gate ("Don't miss new videos / Sign in") |
| `m-7-a53-menu-home-row.png` | **Home** (first row): from a Short, back to YouTube's home feed |

What a signed-in account would add is the content of Watch Later, History and My Account, not whether the links work: each reaches the YouTube (or Google sign-in) screen
that asks for the account. That last step is the only thing not seen.

Defect found on the way and handed on (Fleet work 263): in the 6.5 look the first row of a soft key's menu is drawn with no visible text (`m-3`, `k-5`); it works when tapped.
The YouTube test profile was removed from the manager afterwards (the program list is back to the phone's own Chrome / Discord / My Files); YouTube itself stays installed, signed out.
