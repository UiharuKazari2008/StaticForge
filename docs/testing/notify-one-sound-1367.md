# One sound per phone notice (StaticForge #1367)

A Dreamscape notice on the phone sounds exactly once, whatever state the page is in, and the sound settings hold with the
page asleep. The Android app decides who makes each sound (`AndroidInbox.takeSound`); the contract is in
`docs/client-api/ws/notificationInbox.md` and DSApp-Kotlin `docs/ANDROID_BRIDGE.md`.

## Automatic (silent)

```
node scripts/test-wm-note-one-sound.js          # defects 1 and 2, page side: resume, late claim, asleep page, stopping the app's repeat
node scripts/test-wm-note-sounds-table.js       # defect 4: the table the app plays from is silent exactly where the page is
node scripts/test-notify-sound-picker.js        # defect 4: "Notification sound:" is disabled under No Sounds (check 16)
node scripts/test-wm-inbox-news-only.js         # defect 7: a box sounds only for a notice published as news
node scripts/test-notification-alert-at.js      # the server's alertAt and its one-time column (database in memory only)
node scripts/test-wm-producer-notice-ids.js     # programs that raise their own note pass the inbox notice's id
```

Each takes the path of an older copy of the file it tests, to show it fails there.

DSApp-Kotlin (`testDebugUnitTest`, on Ruiko): `NoteSoundArbiterTest` (defects 1 and 2: every order of the two claims),
`NoteRepeaterTest` (defect 3), `NoteSoundChoiceTest` (defect 5), `NoticeDeliveryTest`.

Before and after for all of them: `docs/testing/evidence/1367/page-tests-before-after.txt` and
`app-unit-tests-before-after.txt`.

## On a lane emulator

```
COORD_AGENT_ID=<id> scripts/aemu-lane/tests/accept-1367.sh aemu-a53-2
```

It needs an app build with `AndroidInbox.takeSound`. It refuses an emulator that has audio, sends soft test-lane notices to
that one device, and reads the app's `NoteAlerts` lines, the page's own sound log and every call the page makes on the
bridge. Output and the per-scenario JSON: `docs/testing/evidence/1367/device/`.

Two things that make such a run prove nothing, both handled by the script:

- **The page caches Android's sound levels for up to 30 s**, and a ringer change made from a shell sends it no event. A
  page started under the lane's silent ringer stays silent. Set the ringer, then stop and start the app, and check
  `wmShell.sounds.silent()` is false.
- **The test lane is one queue for every lane emulator.** Another instance's page that is on screen marks a test notice
  seen at once, and this page then does not draw it again on resume. A reminder (`cls: reminder`, id `rem:...`) is drawn
  again on resume until it is dismissed, so the resume scenario uses one.

## The 6.5.1 Play key

`docs/testing/evidence/1367/651-play/`: on the 6.5.1 look a lone Play beside a combo box was 3.52 units wide (the combo took
the row's free space first). It keeps 64.5 x 35 units now. No row grew, and the Play / Stop pair of a phone event was right.
