# Review of DSApp 9085c00 (tmp/1331-bars-heal-2) against 2174205, StaticForge #1371 / #1331

Independent read, Nov 27 2026. Read-only: nothing was compiled, run or installed. Line numbers are at 9085c00
(`git show 9085c00:<path>`). "Verified" means read in the code; "assumed" marks Android / Shizuku behaviour I recall
but could not check here.

## Verdict

**No BLOCKER for device testing on the lane and the A53. Fix the SHOULD-FIX items before the Fold.** The main path is
sound. That covers a fresh start, screen on with a live token, an adbd restart on an ADB-started holder, and an update
with the new holder started first and the old one killed after it answers. The commit's failure paths still have three
ways to end with no navigation or with visible buttons (S1, S2, S3), plus a 20 s window with no navigation after any
crash (S4).

---

## 1. The 7 SHOULD-FIX items of the earlier review

| # | Status | Where (9085c00) |
|---|---|---|
| 1 retry chain can end with the row visible | **Partly fixed** | MelatonBars.kt:949-952, 987, 991, 853-861 |
| 2 stuck in the fallback (backTried, fallbackSwitched) | **Fixed, but brings S1 and S2** | :1008-1011, :763, :701, :711, :1020 |
| 3 slow start counted as a failure | **Mostly fixed**; see S3 and N1 | :925-928, :934, :1123, :1132; NavRoomPolicy.kt:69 |
| 4 Shizuku 15 s latch lengthens the gap | **Not fixed** (and S5) | :1125-1133 unchanged; ShizukuControl.kt:94-130 |
| 5 navRoomActive true in the fallback | **Fixed** | :1075-1078; callers checked in section 2.6 |
| 6 token dead on arrival | **Fixed** | :791-801 |
| 7 deaths in a row not capped; own kills counted | **Fixed, but the end state is S1** | :838-842, :918-919, :924 |

1. Both fallback failure branches now go on with the chain:
   `if (!listOk) { ...; retryHold(app); return@execText }` (:987) and
   `if (!ok) { ...; retryHold(app); return@exec }` (:991). The old `retryAfterFailure` gate is gone. The chain is
   now `else retryHold(app)` (:952), capped at RETRY_CAP. Two parts are still open:
   - The LocalAdb blindness was not touched (LocalAdb.kt:151-153 `|| lastAuthorized == null) { lastAuthorized = false`,
     and MelatonBars.kt:1083 `LocalAdb.status(ctx).opt("authorized") != false`). See S6.
   - The commit says that after the cap "the next screen on, service connect or Shizuku binder starts a new chain".
     Screen on and service connect are real (verified):
     - Screen on: `Intent.ACTION_SCREEN_ON -> ... relockIfLost()` (:1680) -> `relock()` or `MelatonBars.navRoom(...)`
       (:1951-1952) -> `navBlankKeep(app, true)` (:692). `navBlank` is false after a failure, so `skipKeepExec`
       (NavRoomPolicy.kt:41) does not skip, and :907 resets `holdRetries`.
     - Service connect: `barsUp` -> `relock()` (:1918) -> `navRoom` (:1929).
     - Also tray close (:2436), SystemUI restart (:1964) and configChanged (:1970).
     - The Shizuku trigger is mostly dead (N2).
2. `backTried` is replaced by `backTriedAt` plus `BACK_GAP_MS` (:1010-1011). `fallbackCleared()` clears `fallbackSwitched`
   at every place the pref is removed (:701, :711, :1020). After a reboot the way back is tried again on any event
   60 s or more later. The new defects are S1 (the way back still runs once the fallback cap is spent) and S2 (a way back
   fires right after every first switch).
3. Three changes:
   - The wait is now 7.8 s.
   - `startOk(shellOk, tokenAlive, tokenIsNew)` (:934) takes a token that arrives during the command.
   - `run()` stops before the next route when that token arrived (:1123, :1132). `kill $old` runs only after an OK
     (:928), so a second route can no longer kill a holder that was starting correctly.

   Still open: a token that arrives **after** the callback. The failure stays counted, `holderOwned` stays false, and
   in the gesture fallback that holder is never killed (S3).
4. `latch.await(15, TimeUnit.SECONDS)` (:1130) is unchanged. On top of that:
   - LocalAdb.shell itself runs the same command through Shizuku with a **60 s** latch when dadb throws
     (LocalAdb.kt:324-331).
   - The worst case blocks the single `MelatonBars-shell` thread for about 15 + 3 + 60 s. Every `exec` waits behind it,
     including the fallback and `lock(false)`.
   - S5 covers a queued Shizuku command that runs after the app gave up.
5. `navRoomActive = navRoomSaved && !navFallback` (:1078). The fallback logic now uses `navRoomSaved` (:619, :846,
   :951, :984).
6. Dead on arrival now posts `markNavBlank(false)` and `reholdLater(1500L)` (:795-800). If the shell still says OK,
   `holderOwned` becomes true with `tok == null` and the log reads "nolink". The 1.5 s rehold then runs (the reuse check
   finds no pid) and starts a holder, so the 15-minute blind trust does not come back.
7. Three parts:
   - Five young deaths in a row (`deathLoop`) give up the holds and try gestures (:839-841).
   - A replacement of a holder this process did not own drops its death link first (`dropHolderLink`, :918-919).
   - An owned live holder takes the reuse shortcut and is not killed (:924).

   What happens once the cap is spent is S1.

---

## 2. New defects

### BLOCKER
None found.

### SHOULD-FIX

**S1. Once FALLBACK_CAP is spent the way back still runs, and the next failure leaves Android's buttons visible.**
At MelatonBars.kt:1008-1011, `navBackFromFallback` checks only `tryBackNow(inFallback, bound, backTriedAt, now)`
(NavRoomPolicy.kt:83-84). It does not check `fallbackSwitches`. `fallbackOpen` / `fallbackSpent` (:766, :846) then
refuse any further switch, and `onHolderDied` does `if (loop) { if (fallbackOpen(app)) navFallbackStart(app) }` (:841)
with nothing in the else branch.

Scenario (one process; the death loop is the clearest case, and three failed-start episodes give the same result):
1. The holder keeps dying young (for example adbd restarting repeatedly on an ADB-route holder).
2. Five deaths: fallback #1. The way back succeeds on an event 60 s later. Five more deaths: #2. The same again: #3.
3. The next way back (60 s later, screen on): the holder answers OK and the 3-button overlay is switched on.
4. The holder dies: `deathLoop` is true, `fallbackOpen` is false, so there is no rehold and no fallback.

Result: Android's Back/Home/Recents are visible until the next event. Each later screen on gives a hold that dies
again and changes nothing. In the failed-start variant, the 4th episode keeps the row visible through the whole retry
chain (about 3-5 minutes; see N6), because `fallbackDue` is false once the cap is spent (:951).

Smallest fix: the last switch stands for the process. Add `fallbackAllowed(fallbackSwitches)` to the way-back gate
(`if (holderBusy || !NavRoomPolicy.fallbackAllowed(fallbackSwitches) || !tryBackNow(...)) return`), or better, a
`tryBackNow` parameter with a unit test.

**S2. Every first switch to gestures is followed at once by a way back.**
`navFallbackStart` succeeds and calls `service?.configChanged()` (:998). That runs `relock()` (:1970), then
`MelatonBars.navRoom(on)` (:1929), then `navBackFromFallback` (:691). `backTriedAt` is still 0 in a process that has
not tried a way back yet, so `tryBackNow` is true and the holder is started again (forced) seconds after it was given up.

Scenario: three failed starts, then gestures, then an immediate forced hold.
- If the failures were transient, the phone flips gestures to 3-button within about 1-8 s. That is two overlay switches
  and two relayouts of the program in front.
- In the death-loop case the way back nearly always succeeds right away, so each of the three fallbacks lasts seconds.
  That is how S1's cap is used up quickly.
- If the hold fails, the cost is one more 7.8-23 s start.

Smallest fix: set `backTriedAt = SystemClock.uptimeMillis()` next to `fallbackSwitches++` (:993). The first way back then
waits BACK_GAP_MS like the later ones. The unbound-service case still works: the service connecting more than 60 s
later is a fresh event.

**S3. In the gesture fallback a late holder is never killed: the phone has no Back or Home gestures and no Melaton
edges.**
At :1012-1016, `navBackFromFallback`'s callback does `if (holderOk) navBlankKeep(app, false)` and nothing when
`!holderOk`. `holderToken`'s post (:807-811) marks the row held without asking whether a hold is wanted.

Scenario:
1. In the fallback, an event 60 s or more later starts the way back (:1012).
2. The holder is slow: no OK within 7.8 s, so the command exits 1 and `startOk` is false (no token yet). The callback:
   `holdFailures++`, `retryHold` returns (`navHoldWanted` is false in the fallback), and `after(false)` does nothing.
3. At about 9 s the holder hands over its token: `holderToken` links it and `markNavBlank(true)`.

Result: the no-hint gesture overlay is on, and DISABLE_HOME|BACK|RECENT is held, which takes the gestures (the code's own
comment at :978 and :1005). `navRoomActive` is false, so `edges()` and the home strip are off (:2793, :2800). The user
has only the soft key bar's keys until the next way back, 60 s or more later on an event.

Smallest fix: in the way back's `!switchBackDue` branch call `navBlankKeep(app, false)` whether or not `holderOk` is
true. Its kill runs on the same single io thread after the start command, so it also catches a holder still starting.
Add the same guard in `holderToken`'s main post: `if (!navHoldWanted(app) && !holderBusy) navBlankKeep(app, false)`.

**S4. GRACE_MS = 20 s: after any crash, force stop, LMK kill or uninstall, the phone has no navigation at all for 20 s.**
NavBlankShell.kt:41 and :144-148:
`binder.linkToDeath({ runCatching { Thread.sleep(GRACE_MS) }; System.exit(0) }, 0)`.

Scenario:
1. Dreamscape's process dies for any reason other than an update: a crash in the bars, Settings > Force stop, an LMK
   kill, `am kill`, or an uninstall.
2. The bars die with the process (single process; the manifest has no `android:process`, verified).
3. Android does not rebind a crashed accessibility service (assumed; heal()'s own comment at :593-595 says so).

Result: the holder keeps Back/Home/Recents disabled and nothing of Melaton is drawn, so the user cannot leave the
program for 20 s. Before 9085c00 the buttons came back at once. The class doc still says "a crashed bars service or an
uninstalled app must not leave the phone with an empty row and nothing of ours over it" (:13-14). 20 s is also far more
than an update needs: the Fold showed the new holder answering 1.2-1.5 s after the old one died.

Smallest fix: set GRACE_MS to about 5 s, based on the measured old-death-to-new-OK time under update (checklist D4)
plus margin, and keep the comment in step.
- Optional and better: in the death notice, check the package through IPackageManager. If the package is gone
  (uninstall), exit at once. If its `sourceDir` is the one the holder was started from (a crash or force stop, not a
  replace), exit at once. Wait only when the APK path changed. (Assumed: at the old process's kill during an update,
  `sourceDir` already points at the new path. Verify on the lane before relying on it.)
- The sleep itself is harmless. app_process starts a binder thread pool (assumed, AppRuntime::onStarted), there is
  only one death link so only one notice, and SIGTERM from `kill $(pidof ...)` (navRoom off, :969) ends the process
  during the sleep.

**S5. A Shizuku command queued past the 15 s latch runs later and can start a holder after the app has given up the
hold.**
MelatonBars.kt:1128-1132: the latch times out and `run()` moves on. ShizukuControl.exec (:117-130) has already queued
the command in `waiting` (:99). It runs whenever `bindUserService` finally connects (:33-37). Nothing cancels it, and
`holderBusy` is already false by then.

Scenario:
1. The user-service bind hangs (item 4).
2. Three starts time out in a row, the fallback switches to gestures, and `navBlankKeep(false)` kills all holders.
3. The bind then completes and up to three queued holder commands run. Each starts `melaton_navblank`, and its token is
   linked (:807-811).

Result: the same state as S3 (gestures taken, no edges), or after navRoom off, an empty row with no soft keys over it.

Smallest fix: give ShizukuControl.exec a deadline. Record the time a command is queued and drop it with `done(-1, ...)`
if the service connects after the deadline (15 s for the holder). Optional: for the holder, use the Shizuku route only
when `service` is already bound, kicking a bind for the next time.

**S6. (carried over from item 1, not in the diff) The ADB route can stay blind for the whole process.**
LocalAdb.kt:151-153: in a process whose first ADB attempt fails (5555 up but adbd still settling after a reboot or
restore), `lastAuthorized` becomes false for any error. `adbUsable` (MelatonBars.kt:1083) is false from then on, so
neither the holder chain nor the fallback can use ADB until some other caller's withAdb succeeds.
- On the A53 (no Shizuku) after a reboot: the 3-button overlay persists, the room is wanted, and every retry and
  fallback attempt reports "no shell route". The row stays visible until something else succeeds with ADB.
- Smallest fix: treat `authorized == false` as usable when `PREF_AUTHORIZED_ONCE` is set and the error was not an auth
  refusal. Better: drop `|| lastAuthorized == null` for errors that are not about auth.

### NOTES

- **N1. A late token after a counted failure (not in the fallback) leaves the counters stale.** The row is held
  correctly (reholdRun sees the live token at :746 and stops). But `holdFailures` stays raised and `holderOwned` false
  (:942-943), so a later death plus two slow starts reaches the fallback early. Fix: in `holderToken`'s post, when no
  start is running, set `holdFailures = 0`, `holdRetries = 0` and `holderOwned = true`.
- **N2. The "Shizuku coming back" trigger (:867-880) mostly cannot fire.** DSApp's own 13326f5 (Shizuku 13.6 server log)
  established that the server sends its binder to an app only when the app's uid starts. A server started while
  Dreamscape runs gives this process no binder. The sticky listener fires at registration or at a process start, not
  when a route comes back. Harmless, but do not count on it: after the cap, the real triggers are screen on, service
  connect, tray close and SystemUI restart (verified above).
- **N3. The holder is never moved off ADB.** A holder started through ADB because P2's Shizuku binder had not arrived
  yet stays an adbd child for the life of the process. That is exactly the #1331 cause: every later adbd restart, such
  as the app's own 5555 restore after an update, shows the row for 1.5 s plus the start time. Now that the start
  command is gap-free (new holder first, `kill $old` after its OK), a re-hold through Shizuku when the current holder
  came through ADB and Shizuku is usable would close it. Log the route that started the holder: today no log line tells
  ADB from Shizuku.
- **N4. The rehold waits are visible time.** Each death leaves the row visible for `reholdDelayMs` (1.5 s, 5 s, 15 s,
  ...) plus the start time (:842). This is unchanged from 2174205. With Shizuku usable, the first rehold could be
  immediate.
- **N5. navBlankKeep(off) does not cancel a start already running** (:957-970 against :930-956). If off runs on main
  while a start is in flight, the start's callback later sets `holderOwned = true` and `markNavBlank(true)` after the
  hold was given up. The off kill runs after it on the same io thread, so no holder stays alive. But if the token
  arrived before off (off unlinked it), `navBlank` stays true. Only cosmetic in the fallback, and fixed on the next
  forced start. A generation counter in navBlankKeep would close it.
- **N6. The unit test `theChainIsAboutTwoMinutesAtMost` counts only the delays (126.5 s).** The real chain adds up to
  7.8 s per start (ADB), or 15 s latch + 7.8 s + up to 60 s with Shizuku and LocalAdb's inner fallback: about 3.5 to 6+
  minutes of visible row with no route.
- **N7. unboundCheck is still armed only from heal() through MainActivity** (old note 8). After an update where no
  activity starts and the service is not rebound, the old holder now exits 20 s after the old process. From then the
  row stays visible with nothing drawn, and no fallback timer runs. fix/1340's BarsServiceWatch.check runs at every
  process start and could arm unboundCheck too. Also with 1340 merged: re-enabling the service at every process start
  defeats Android's crashed-service stop. With S4's grace, a crash loop in the bars path could keep the row empty with
  nothing drawn for as long as the loop runs. Worth one line in 1340's review.
- **N8. Thread.sleep is assumed to run on awake time.** If ART's sleep uses CLOCK_MONOTONIC, the 20 s grace stretches
  while the phone is suspended. No power cost, and an uninstall with the screen off lasts until wake. Not verified.
- **Power (phone-power-native, server-push-not-polling): no violation found.**
  - Every new timer is a one-shot `postDelayed` (`reholdRun` through `reholdLater` :892-895; `unboundCheck` :590).
  - No AlarmManager, no wake lock, no repeating timer.
  - The Shizuku listener is event-driven.
  - The only loop is the shell's bounded 26 x 0.3 s wait, inside a command that runs only on events.
  - The holder sleeps once on one binder thread and wakes nothing.
  - Chains are capped at 10; new chains come only from user or system events.
  - Deaths of a holder that lives 60 s or more re-hold without a cap. Each one is a death event, so that is not polling.
- **Compile risk (never compiled).**
  - Nothing found. The smart cast of the captured local `val before` (:946) is legal.
  - `return@post` labels match `main.post`. The non-local `return` inside `synchronized` is inline and allowed.
  - `addBinderReceivedListenerSticky` exists in Shizuku api 13.1.5 (libs.versions.toml:17).
  - The removed `retryAfterFailure` and `backTried` have no other callers at 9085c00 (git grep).

### 2.1 Answers to the specific questions

- **GRACE_MS and Thread.sleep**
  - Binder threads: one pool thread sleeps. The holder has no other incoming calls, so there is no starvation (assumed
    pool max 15).
  - A second notice: none. There is one link, and death notices are delivered once.
  - navRoom off: the SIGTERM kill works during the sleep (:969 `kill \$(pidof $n)`).
  - Uninstall: 20 s with no navigation (S4). The already-mapped dex keeps working; `kotlin.Result` is loaded in `main`
    before the notice.
  - Crash loop: see S4 and N7.
  - An update where the new process comes after more than 20 s (screen off, service not rebound): the row shows from
    second 20 until the service binds. This is not worse than 2174205 (which showed it from second 0), and no fallback
    timer runs without heal() (N7).
- **Two holders at once**
  - Assumed AOSP StatusBarManagerService behaviour: `manageDisableListLocked` keys DisableRecords by (token, userId), and
    the net flags are the OR over all records (`gatherDisableActionsLocked`). So while T2's record stands, T1's
    binderDied removes only T1's record and the net state does not change.
  - Not verified for Samsung's build: if a vendor keys records by package, both tokens share `com.android.shell`
    and T1's death would clear the row. Checklist D4 decides this.
  - `old=$(pidof $n)` runs before the launch (:925), so the new pid is never in it.
  - With a second, concurrent command (S5 or a second route), one run's list can hold the other run's holder. But every
    kill comes only after an OK in the current output file, so some holder with flags set exists at every kill. The
    invariant holds.
  - ERR or a timeout: `exit 1`, no kill (:928). The old holder lives until its own grace ends; P2's retries and its
    fallback after three failures follow.
  - `holderOwned` and the reuse shortcut with two holders: it exits 0 and leaves both. This is harmless: off kills
    all pids, and a later full start kills both after its own OK.
- **Shell wait 7.8 s against route timeouts**
  - Shizuku's 15 s latch includes the bind, so the route gives up mid-command only when the bind takes more than 7.2 s.
    Then the ADB route runs the command concurrently. The kill-after-OK invariant keeps the row held.
  - dadb's 65 s socket timeout cannot cut it.
  - LocalAdb.shell's inner Shizuku fallback (60 s) can run the command a third time, sequentially.
  - None of these can kill a starting holder before another one is up. The leftover risk is S5.
- **Threading (verified)**
  - `execRoute` and `execText` results go through `main.post` (:1101, :1112).
  - The app-side death recipient posts to main (:784).
  - The dead-on-arrival branch posts (:795).
  - The Shizuku listener posts (:872). ShizukuControl.exec callbacks run on main (ShizukuControl.kt:118-126).
  - `navRoom` callers are on main (:1929 and :1952 from the service; :504 inside `main.post`).
  - `holdRetries`, `retryFromTimer`, `reholdWaiting`, `backTriedAt`, `holderBusy` and `holderOwned` are touched only on
    main.
  - `retryFromTimer` is set and consumed in the same call (:749 to :905-906), so no other call can consume it.
  - `reholdWaiting` is cleared at the end of every start callback (:954) and in off (:963).
  - No lost or doubled retry: `reholdLater` always removes the pending one (:893).
- **Retry chain**
  - Bounded by RETRY_CAP, and reachable. It cannot spin: the only things that reset `holdRetries` are events and
    successes.
  - It can end with the row visible while a hold is wanted when there is no route at all (unavoidable), after S1, or
    with S6 on ADB-only phones.
  - FALLBACK_CAP is reachable, but does not do what its comment says ("never flips back and forth without end"): after
    it, the way back still runs (S1).
  - DEATH_CAP is reachable and does what it says.
  - BACK_GAP_MS works, except for the immediate first try (S2).
- **The gesture fallback and the way back**
  - The row is never visible on either path: the holder answers before the 3-button overlay is switched on, and
    gestures are switched on before the holder is killed.
  - Flips: S2 (fast), S1 (back to visible).
  - Stuck without gestures: S3 and S5.
  - About 0.3-1 s with gestures disabled while the way-back holder's flags stand before the overlay switch. Negligible.

### 2.6 Callers of navRoomActive (git grep at 9085c00, origin/main d0b7d70, origin/fix/1340-bars-service-heal a6b10d5, origin/feat/1327-output-panel 5950385, origin/feat/1298-notify-sound e20a37a)

All refs have the same caller set and no new caller. The fallback-logic uses at main's :619, :846 and :874 are exactly
the ones 9085c00 changes to `navRoomSaved`. The merge base of 9085c00 and main is 2174205, and main's MelatonBars
changes since then are outside this region (2174205..d0b7d70 touches the notice and keyboard code). A hand-merged
conflict must not bring back `navRoomActive(app)` in unboundCheck, fallbackDue or navFallbackStart: there it would be
false in the fallback, which would block nothing but would also be the wrong meaning.

In the fallback (false now):

| Caller | Effect in the fallback | Verdict |
|---|---|---|
| MainActivity hide-nav (9085c00 :757, :768, :3864, :3874; main :679, :690, :3745, :3755) | Android's bar is no longer hidden by the app | Right: no-hint gestures |
| MainActivity :2762 | Status bar visibility no longer re-applied | Right |
| `navPx` :541 | 0 | Right; the page refreshes its soft height only when it next asks for state() |
| `softHeightPx` :1167 | 0 | The bar is drawn at its own height over the program's bottom, the pre-#1017 gesture look; accepted for a fallback |
| `navUnshortcut` :1037 | No-op | Right; no holder |
| `floatSoft` :2784, `homeStrip` :2793, `edges` :2800, `placeOverKeyboard` :2828, HomeSwipe :4214, `dsSoftNow` :5077 | Off | Right: Android's own gestures do Back and Home |

Assumed: Android's gesture input monitor still takes a swipe that starts on the soft key bar's window.

None of them gets a wrong answer. Not in the fallback (room active), values are the same as before.

---

## 3. Unit tests (NavRoomPolicyTest.kt)

Covered: the pure functions and constants (`retryAllowed`, `deathLoop`, `fallbackAllowed`, `startOk`, `tryBackNow`
with its gap, `reholdDelayMs`). Most of the new tests assert constants (`RETRY_CAP == 10`, `DEATH_CAP == 5`,
`FALLBACK_CAP == 3`, `BACK_GAP_MS == 60_000`).

Not covered (no test, and in MelatonBars, so not testable on the JVM as written):
- the state machine around `holdRetries`: the reset on non-timer calls, `retryFromTimer` and `reholdWaiting`
- `fallbackSpent` / `fallbackOpen`
- the death-loop branch in `onHolderDied`
- the dead-on-arrival rehold
- `dropHolderLink` and the re-link on failure
- the `holderTokenFresh` short-circuit in `run()`
- the `navRoomActive` / `navRoomSaved` split and the `fallbackFlag` cache
- the shell command order (kill after OK)
- GRACE_MS
- the interaction behind S1: the way back allowed after the cap. A pure `tryBackNow(..., switchesSoFar)` would make it
  testable.
- the immediate way back after a switch (S2)
- the "late token in the fallback" decision (S3)
- `theChainIsAboutTwoMinutesAtMost` does not model the command time (N6)

Suggestion: move the three decisions behind S1, S2 and S3 into NavRoomPolicy so they get tests.

---

## 4. Device test checklist (lane emulators with Shizuku = Fold-shaped; A53 = ADB only). Never on the Fold.

Common commands:
- `R`: `dumpsys statusbar | grep "pkg=com.android.shell token"` (the records)
- `H`: `dumpsys statusbar | grep "displayId=0 pkg=com.android.shell"` (the history)
- `P`: `pidof melaton_navblank`
- `O`: `cat /data/local/tmp/melaton_navblank.out`
- `L`: `logcat -v time -s MelatonBars NavBlankProvider`

Sample R and P every 200 ms from the host during the timed cases. A screenshot proves nothing (memory #335).

| # | Do | Proof |
|---|---|---|
| D0 | Build; `:app:testDebugUnitTest --tests *NavRoomPolicyTest*` | Compiles, all tests pass |
| D1 | Fresh start with room on | L `holder token linked (#1331)`; O exactly `OK` (never `OK nolink`); one pid in P; R one record `what1=0x03600000` |
| D2 | Screen off/on x5 with a live token | No new `melaton_navblank` start in L (no "shell failed", no new pid); P unchanged |
| D3 | A53: `adb tcpip 5555` (adbd restart) | H `CLEAR tag=binderDied` then `BACK HOME RECENT SEARCH`, gap 1.5 s + start (about 2.5 s, previously 2.2 s); L `holder died after N s (#1 in a row): holding again`. Lane with Shizuku: the holder survives the adbd restart: same pid, no CLEAR row. Record which route started it (`ps -o pid,ppid`, `/proc/<pid>/cgroup`) |
| D4 | **Update over a running build**: install build N+1 over N through the app's own silent update path, on the lane (Shizuku) and on the A53 (ADB); also once with `adb install -r` | (a) P shows the old and the new pid at the same time, then only the new one. (b) R is never empty in any 200 ms sample from install start to 30 s after. (c) H: the new token's `BACK HOME RECENT SEARCH` row is timestamped before the old token's `CLEAR tag=binderDied`, or there is no CLEAR at all if the history logs net state only. **No CLEAR row followed by a later BACK row (a gap) is allowed.** (d) L in the new process: `holder token linked`, with the time from the old process's death (logcat `ActivityManager: Killing <pid>:jp.net...`) to the new OK, to size GRACE_MS (S4). (e) On the lane, confirm the Shizuku-started old holder survives its ShellService going away. (f) Repeat with the screen off during the install |
| D5 | Update where the service is not rebound (lane: remove the service from enabled_accessibility_services before the update) | The old holder exits GRACE_MS after the old process died: H CLEAR about 20 s after the kill. Documents N7 |
| D6 | Crash / force stop: `am force-stop`, `kill -9 <app pid>` (lane) | H CLEAR comes GRACE_MS after the kill, and the screen has no bars meanwhile (screenrecord). This is S4's regression; record the numbers |
| D7 | Uninstall (lane only) | The same 20 s, then CLEAR; the 3-button overlay stays (known) |
| D8 | Failed starts without a code hook: `adb shell mkdir /data/local/tmp/melaton_navblank.out`, so the redirect fails, no OK or ERR appears, and the start times out, then kill the holder | L: #1 and #2 failures; at #3 `gesture fallback on (<pkg>)`. Then the immediate way-back try (S2: expect one more start right after the switch). `cmd overlay list` shows the no-hint overlay `[x]`; R no shell record; no Melaton side edges (`dumpsys window` lists no edge windows) |
| D9 | Way back: `rmdir` the directory, wait 60 s or more, screen off/on | L `gesture fallback off: the 3-button room is back, the row held`; H `BACK HOME RECENT SEARCH` timestamped before the overlay change (`cmd overlay list` shows threebutton `[x]`); R one record |
| D10 | Retry chain with no route (lane: deny Shizuku and stop 5555, then kill the holder) | L retries at +1.5 s, +5 s, +15 s, then every 15 s, each plus the command time; `gesture fallback: no shell route ...` from #3 on; after 10, `holds in a row failed, no more until the next event`; then silence (no shell lines for 10 min); a screen on starts a new chain |
| D11 | Death loop: `adb shell kill $(pidof melaton_navblank)` after each re-hold, 5 times within 60 s | L `(#5 in a row): giving up the holds`, then `gesture fallback on`. Repeat until fallback #3 and its way back to show S1 (expect visible buttons: an empty R while the room is on). Proves the fix once S1 is fixed |
| D12 | Shizuku trigger: stop the Shizuku server with the chain capped, then start it (lane) | Expect NO `Shizuku's binder arrived` in the running process (N2) |
| D13 | Reboot in the fallback (lane) | First way back at service connect; if it fails, the next one on a screen on 60 s or more later. On the A53, ADB-only reboot: watch for S6 (`no shell route` while 5555 listens) |
| D14 | Power, 10 min idle with the screen off and a live holder | `dumpsys alarm` shows no new alarm from the package; `dumpsys power` shows no wake lock from it; no MelatonBars shell lines in L; the holder's `/proc/<pid>/status` voluntary_ctxt_switches stays the same |

These cannot be shown on a device without a test hook (a debug-only delay before `println("OK")`, a debug flag that
hangs the Shizuku bind, or one that fails `linkToDeath`):
- a slow start past 7.8 s and the late token (item 3, S3, N1)
- the Shizuku bind hanging past 15 s with a late queued command (item 4, S5)
- a token dead on arrival (item 6)

Other gaps:
- The crash-loop case needs a crashing build.
- The Fold's own Samsung StatusBarManagerService behaviour for two shell tokens can be inferred only from a Samsung
  device. The A53 is One UI, so run D4 there too; the lane is AOSP.

---

## Re-review of bd91633 (origin/fix/1331-bars-heal-2 = origin/tmp/1331-bars-heal-3)

Read-only, Nov 27 2026. Verified: 069fc5a and 9085c00 have the same `git patch-id --stable` (a8365192...). Line numbers
are bd91633's.

**Verdict: safe for the device run. If D0-D14 pass (D4, D6 and D8-D11 especially), safe for the owner's phone. No
BLOCKER and no SHOULD-FIX in bd91633.** S5 and S6 from the first review are still open and were not in this commit's
scope.

### 1. S1-S4 against what was meant

- **S1: fixed.** NavRoomPolicy.kt:90-91 adds
  `inFallback && serviceBound && fallbackAllowed(switchesSoFar) && (...)`, and MelatonBars.kt:1021 passes
  `fallbackSwitches`. That is the only `tryBackNow` caller (git grep). The tests cover 0-2 switches (allowed) and
  3, 4 and 10 (refused). A fallback inherited from an earlier process starts at 0 switches, so the next process tries
  again. That is intended.
- **S2: fixed.** `backTriedAt = SystemClock.uptimeMillis()` (:1004) is set before `configChanged()` (:1009), so the
  `navRoom` that follows at once is refused by the 60 s gap. Side effect: after the unbound-service fallback (unboundCheck),
  a service that binds within 60 s no longer takes the way back at connect. It waits for the next event 60 s or more
  later (screen on, tray, SystemUI). That is gestures, not visible buttons. NOTE R3.
- **S3: fixed.**
  - (a) :1024-1027 now always calls `navBlankKeep(app, false)`. A slow way-back holder whose token arrives after the
    callback is then caught by (c): the token is linked after (a)'s unlink, `holderTokenBinder === binder`, the hold is
    not wanted, no start is busy and `backSwitching` is false, so it is given up.
  - (c) :811-817 covers the same for S5's late queued command, when it arrives outside a start and outside the way
    back's overlay switch.
- **S4: fixed as specified (10 s, NavBlankShell.kt:45).** One correction to the reason given: the recorded data is
  1.2-1.5 s after an install on both the Fold and the A53 (memory #336: "Proven on the real A53: ... 1.2-1.5 s after an
  install"). So "a slower phone needs several seconds" is not backed by a measurement here. 10 s is still a defensible
  margin; D4 settles it. See 5 for how it relates to the 7.8 s wait.

### 2. Does guard (c) ever give up a holder that is wanted?

No. The reason is ordering, verified:
- The holder calls NavBlankProvider before it prints OK (NavBlankShell `handOff`, then `println`). `holderToken`
  posts the guard runnable A to the main looper at that moment.
- The start's callback B is posted only after the shell has seen OK and `run()` has returned. On the Shizuku route its
  result first passes through ShizukuControl's own main post, which is posted later still.
- One looper runs these in FIFO order, so A always runs before B. While A runs, `holderBusy` is still true.

Walk-through:
- **Normal start in a fresh process:** wanted, and also busy. The row is marked held.
- **Re-hold after a death:** `reholdRun` starts only when `navHoldWanted` (:747). The token arrives while busy. Held.
- **Way back, token before the start's callback:** busy, so held. Then the overlay switch runs with `backSwitching`.
- **Way back, token between the callback and the overlay's answer:** only a token from a holder other than this
  start's, such as an S5 late command. `backSwitching` is true, so it is marked held. The overlay's answer then either
  makes the hold wanted (ok) or kills every holder (:1039, not ok). Correct both ways.
- **Way back, after the overlay answered ok:** `backSwitching = false`, the pref removal and `fallbackCleared()` run in
  the same callback (:1031-1034) with no main-thread gap between them. From then the hold is wanted. Held.
- **Way back, after the overlay answered not ok:** not wanted, so the holder is given up. Right: in the fallback a
  holder would take the gestures.
- **Way back answered late (shell exit 1, token after B):** given up, as intended (S3).
- **First-time room setup (:701):** `apply()` updates the in-memory prefs at once and `fallbackCleared()` sets the
  cache to 0, so the hold is wanted when `navBlankKeep(force)` runs. The token arrives while busy anyway.
- **Shizuku-binder listener (:885):** checks `navHoldWanted` before starting. Busy at arrival.
- **A start made while the user switches the feature off:** the token arrives while busy, so it is marked held. Off's
  kill runs on the same io thread after the start command. The holder's linked death then clears `navBlank`, and the
  hold is not wanted, so nothing restarts. If the token arrived after the callback, (c) gives it up. Correct.
- **The failure path's re-link `holderToken(before)` (inside B, after `holderBusy = false`):** wanted on the normal
  path, so held. In a way back there is no `before` (the fallback killed it). If there were one, giving it up would be
  correct.

**The planner's claim is confirmed.** Outside the way back, every start site is reached only when the hold is wanted:
- :692 takes `on = c.enabled && c.softkeys && c.room` (:1929, :1952) and checks `saved != null && !navFallback`.
- :701 runs right after `navOrig` is written and the fallback cleared.
- :751 (`reholdRun`) and :885 (the Shizuku listener) check `navHoldWanted` themselves.

One caveat: "wanted" is read at the call. A config change during the command makes the hold unwanted while busy, and
the off path in `navRoom`, not the guard, handles it.

### 3. What navBlankKeep(app, false) inside the post resets

- **Reset:** `navBlankAt` (to 0), `holderOwned`, `holdFailures`, `holdRetries`, `retryFromTimer`, `reholdWaiting`,
  `holderDeaths`. It also removes `reholdRun`, unlinks the token (`holderTokenBinder` and its recipient to null),
  calls `markNavBlank(false)` and queues `kill $(pidof)` plus `rm` (:966-978).
- **Not reset:** `holderBusy`. The guard needs it to be false already.
- **Safe for a start that begins right after:** the kill and any later start run on the single
  `MelatonBars-shell` thread, and `run()` blocks until each command returns. The kill therefore finishes before the new
  start's `old=$(pidof)`, so it cannot hit the new holder.
- **The end state is right:** no token, `navBlank` false, and the given-up holder's death is not heard. The reset
  counters do not matter while the hold is not wanted.
- **One exception (NOTE R1):** if the kill goes over Shizuku and the 15 s latch times out, the command can run later
  (S5). It could then kill a wanted holder started in between. That holder's death is linked, so the app re-holds
  after 1.5 s. This is S5's root cause and is fixed with S5.

### 4. Can backSwitching stay true?

No, not for good. `exec` goes to `execRoute`, which always posts its result to main (:1101 at 9085c00, unchanged).
`run()` is bounded:
- Shizuku latch: 15 s.
- dadb socket timeout: 65 s.
- LocalAdb.shell's inner Shizuku latch: 60 s.
- No uncaught throw: `adbUsable` and `LocalAdb.shell` are wrapped in `runCatching`, and the io executor is never shut
  down.

The worst case is about 80 s true. While it is true, a late unwanted holder is marked held for at most that long. Then
the overlay answer either makes it wanted or kills every holder. If it ever stayed true (hypothetical), guard (c) would
be off and S3 would come back, but (a) still covers the slow way back. Nothing would be worse than at 9085c00.

### 5. GRACE_MS 10 s on the update path

Nothing breaks compared with 20 s.
- **If P2 answers more than 10 s after P1's death:** H1 exits at 10 s, and the row is visible from then until P2's OK.
  `kill $old` with an exited pid fails quietly. The late token is still taken by `startOk`.
- **Consistency with the 7.8 s wait:** a gap-free update needs this:
  P2's start command begins within `GRACE_MS - answer time` after P1 dies.
  With the worst allowed answer (7.8 s), that means P2's service must connect and the command start within about
  2.2 s.
- **Measured case:** connect to OK is about 1-1.5 s, so there is a large margin. Only a slow first start after an update
  combined with a slow holder could flash. NOTE R2: measure both times in D4 and keep `GRACE_MS` at least connect time
  plus answer time, plus margin.

### 6. New defects in bd91633

- **BLOCKER:** none. **SHOULD-FIX:** none.
- **R1 (NOTE):** the kill from the guard and from (a) can be delayed by S5's Shizuku queue, as in 3. Fixed with S5.
- **R2 (NOTE):** the grace against the 7.8 s answer, as in 5.
- **R3 (NOTE):** S2's `backTriedAt` also delays the way back after an unbound-service fallback until an event 60 s or
  more later. The phone stays on gestures (no visible buttons). Acceptable; mention it in D13.
- **R4 (NOTE):** `navBlankKeep(false)`'s kill is not retried if no shell route answers. The same is true of every off
  path (pre-existing). A holder that survives in the fallback is replaced at the next way back.
- **Tests:** they cover the new `tryBackNow` argument only. Guard (c), `backSwitching` and the always-off branch (a)
  have no unit test; they live in MelatonBars. D8 and D9 exercise the fallback, but only a debug delay before
  `println("OK")` can show the late-token give-up and its log line `a holder arrived that is not wanted: given up
  (#1331)` on a device.
