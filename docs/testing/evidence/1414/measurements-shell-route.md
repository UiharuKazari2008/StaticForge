# #1414 measurements on lane aemu-a53-2 (Android 16, YouTube 20.10.41 / 1553337840), Nov 27 2026

Taken as the shell user over the lane's adb (`lane.sh aemu-a53-2 adb`). This is what the SHELL route (the app's local ADB on 5555 or
Shizuku) can read. What the app itself (no shell) reads is measured separately with the app's probe bridge (see README.md).

- `dumpsys package com.google.android.youtube` (yt-dumpsys-package.txt, 644 lines): the Activity Resolver Table lists every intent
  filter with its activity. The VIEW + BROWSABLE filter of `.UrlActivity` takes http/https for youtube.com, www.youtube.com,
  m.youtube.com, youtu.be with path glob `.*` (AutoVerify=true) - so any path is accepted by the filter and the generator has to
  supply the right path; the filters alone do not say which paths are real pages.
- `cmd package resolve-activity --brief -a VIEW -c BROWSABLE -d https://www.youtube.com/feed/subscriptions <pkg>` ->
  `com.google.android.youtube/.UrlActivity` (yt-resolve-activity.txt).
- `dumpsys shortcut` (yt-shortcuts-dumpsys.txt): YouTube's static shortcuts with their intents:
  Subscriptions = `act=com.google.android.youtube.action.open.subscriptions`, Shorts = `...action.open.shorts`, Search (search-shortcut).
  These are in the app's own manifest shortcuts XML (readable by any app from the APK) and are the app's own, named entry points.
- `am start 'intent:#Intent;action=com.google.android.youtube.action.open.subscriptions;package=com.google.android.youtube;end'`
  started YouTube on its Subscriptions tab (yt-history-via-https.png shows the Subscriptions tab selected in the bottom bar; the lane
  has no Google account, so the page itself says "Couldn't sign in": pages that need an account cannot be shown on the lane).
