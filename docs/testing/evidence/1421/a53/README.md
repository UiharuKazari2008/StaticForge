# #1421 on the A53 hardware phone: first row of a soft key's menu after the fix (Nov 27 2026, 19:40-19:47 EST)

Phone: A53 R5CT71TSEMZ at 192.168.100.233:5555 (serial checked), leased through coord (lease 319). App versionCode **3632992**
(release 44). Look: `data-wm-version` = **6.5** (`data-wm-rev` not set). Nothing was installed, rebooted, locked or slept.

## The page runs the new client
`new-client-proof.txt`. The page first held the OLD client in memory (`menuSample` first row `wm-popup-item is-hot`) although its
service-worker cache already held the fixed wmShell.js. I took the update by the app's own restart (`am force-stop` of the app; it
started itself again, as in the #1414 README "app restart"; no `location.reload()`, no APK). After that:
`firstHot:false`, first row class `wm-popup-item`, second `wm-popup-item`, version 6.5.

## Shots (real taps on the visible Menu key at 876,2338; every PNG read)
| file | rows read, top to bottom | highlighted row | result |
| --- | --- | --- | --- |
| `youtube-bar-before-tap.png` | bar reads Subscriptions / tasks / Menu over YouTube's feed | n/a | context |
| `youtube-own-menu.png` | **Home**, Shorts, Watch Later, Search, divider, My Account, History (dark red text on the white menu) | none | **PASS** (a): "Home" is readable (before: blank, `m-3`) |
| `soft-key-menu.png` | **Task Manager**, All Notifications, Quick Settings, Maximize, Minimize, Close (My Files in front, its right key = Menu, the general Soft Key Menu) | none | **PASS** (b): first row readable |
| `youtube-before-home-tap.png` / `youtube-home-after-tap.png` | YouTube on a Short, then Menu > Home: back on YouTube's home feed | n/a | row still works (c) |

## What differs from the brief, and why
- (b) shows "Task Manager" as the first row, not "Notifications": the phone's Soft Key Menu list is Task Manager, All Notifications,
  Quick Settings, Maximize, Minimize, Close; the "Notifications" in `i-4` was a generated Discord profile that no longer exists on the phone.
- The YouTube profile had been removed after #1414, so I put it back through the same bridge call the manager's OK makes
  (`AndroidBars.setConfig({softProfiles})` then `melatonBars.kitChanged()`), with the #1414 rows (Subscriptions | tasks | Menu; Home,
  Shorts, Watch Later, Search, divider, My Account, History). Not made through the Generate dialog (no model call). The menu drawing
  under test is the same (`softKeyMenus` kit).
- First try of the Home row used `open:android:com.google.android.youtube`; that action took the phone to Melaton's Today, not to
  YouTube (the #1414 final proposal uses an https link). I switched the row to the https link `https://www.youtube.com/` (as the
  m-2 proposal) and redid (a) and (c); the earlier shots were deleted. Not a regression of the fix, only my own profile choice.
- Not looked into: the "Menu of its own" and general menu rows in the 6.1 / 6.5.1 looks (lane covers them).

## Left as found
The test YouTube profile was removed again (profiles: default, chrome, myfiles, discord - as before), YouTube force-stopped, phone awake
on Today (6.5), no menu open. It had been on Settings when I took it. A real "New Text Messages" balloon arrived on the phone at the
end; its screenshot was deleted, not kept (personal text).
