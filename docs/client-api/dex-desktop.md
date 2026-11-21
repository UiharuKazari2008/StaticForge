# The DeX desktop: Android programs, windows and notifications (#1005)

The desktop page also runs in the Dreamscape app's window on the Samsung DeX display (the "DeX window",
`AndroidDisplay.isDesktop()` true with the desktop shell). There it lists the phone's programs, shows the Android windows
on the taskbar and the phone's notifications in the tray. Each part is its own file, loaded only in the desktop shell
(`<template data-shell="desktop">` in `app.html`), and does nothing unless its DSApp bridge is in the window.

| Part | File | DSApp bridge | Events |
| --- | --- | --- | --- |
| All Programs > Android Programs, Start Search, pins, Quick Launch | `androidDesktopPrograms.js` | `AndroidApps` | `androidapps` |
| Android windows on the taskbar | `androidTaskbar.js` | `AndroidWindows` | `androidwindows`, `androidwindowsresult` |
| The tray's Bell and its notifications flyout | `androidNotificationsTray.js` | `AndroidPhoneNotifications` | `androidnotifications` |
| Volume keys, wheel, output button, Windows Ding | `tabVolume.js` ([tray-providers.md](tray-providers.md#volume)) | `AndroidVolume`, `AndroidAudioDevices` | `androidvolume`, `androidvolumekey` |

Rules they follow: nothing is read from a bridge or the server on the start path (`installed-boot-zero-wait`); synchronous
bridge calls are made on a change event or when a view opens, never on a timer (`phone-power-client`); every page listener
carries its owner's signal (`app-scope-ownership`).

## Android Programs

`window.melatonAndroidPrograms`: `items()`, `tree()`, `find(launchId)`, `isAndroidId(id)`, `launch(id)`,
`iconFor({ id?, package, icon? }, px)` -> `{ src, srcset }`.

- **Icons and names as on the phone's Start menu** (Yukimi, Nov 21): a program with a Windows Mobile icon in the Program
  Icons store (#773; Melaton Mobile's localStorage `wmAndroidIconStore`, the same storage in the app; refreshed from
  `GET /api/wm-program-icons/manifest` once the desktop is idle) is drawn with it: the small set (16 / 32 / 64 px files)
  up to 20 CSS px, the `-lg` set (32 / 64 / 128) above (`modalUtils.js renderAppIconImg`, Quick Launch's `appIconSrc`).
  Others use Android's icon at the size the screen needs. The name the user gave a program (`wmAndroidNames`) is its name
  here; programs cleared in Remove Programs > Android (`wmAndroidHidden`) are left out. The taskbar and the Bell draw
  programs through `iconFor`.

- Launch ids are `android:<package>/<activity>` (a work profile's program keeps the app's `@u<serial>` suffix).
- The list kept from the last session (localStorage `melatonDexAndroidPrograms`) draws the menu at boot; the phone's own
  list (`AndroidApps.list()`) is read once the desktop is up (`desktopBootDone`) and idle, and again on `androidapps`.
- All Programs gets an **Android Programs** folder (after Administrative Tools), the programs by name and a **Work** folder
  for a work profile's. `modalUtils.js` takes the entries into `collectStartMenuLaunchableDescriptors`, so Start Search,
  Pin to Start Menu, Add to Quick Launch, Add to Desktop and the most-used list work as for any program.
- Pins and Quick Launch are kept on the server for every desktop: another desktop (no bridge) leaves `android:` entries out.
- `AndroidApps.launch(id)` from the DeX window starts the program on the DeX display; when it answers false, Vista's
  "Windows cannot find" message box.

## Taskbar: `AndroidWindows`

The app's bridge (DSApp `claude/dex-desktop-shell`). The page codes against:

```js
AndroidWindows.list()   // JSON string, from the app's cache:
{
  ok: true, displayId: 2,
  access: { service: true, shell: true },          // the Melaton accessibility service is bound; Shizuku / local ADB usable
  can: { activate: true, minimize: true, close: true },
  focusedId: 't12' | null,                          // null: the Dreamscape window (or nothing) has focus
  windows: [{ id, taskId, package, appId, label, title, icon, focused, minimized, profile }]   // the order they opened
}
AndroidWindows.activate(id, req) / minimize(id, req) / close(id, req)   // true: accepted; the outcome comes as
// 'androidwindowsresult' { id: req, result: { ok, error? } }
AndroidWindows.requestAccess()   // turns the accessibility service on (through the shell), or opens Android's settings
```

`androidwindows` carries the `list()` object on every change (coalesced, only while the page is seen).

`window.melatonAndroidTaskbar`: `hasFocus()`, `windows()`, `activate(id)`.

- Each window is a `.taskbar-window-item.taskbar-android-item` with `data-android-window` in `#taskbarWindows`, after the
  buttons there when it opened. `updateTaskbarWindows` keeps it (`taskbarItemShouldExist`).
- A click activates the window; the focused one is minimised instead (Vista's buttons). Right-click: Restore, Minimize,
  Close, greyed by `can`.
- While an Android window has focus no Dreamscape button is pressed (`isModalActiveForTaskbar`).
- The first time the list says the service is off and the shell can turn it on, `requestAccess()` is called once
  (localStorage `melatonDexWindowsAccessAsked`).
- Not yet: thumbnails over Android buttons, Flip 3D, Alt+Tab and Show Desktop for Android windows.

## The Bell

`#androidNotifyTrayIcon`, Windows Calendar's reminder bell (WinCal.exe icon 116, `static_images/vista-dlg/wincal-116-16.png`)
while a notification has come that the flyout has not shown yet (`data-state="new"`), and the same bell without its six
lines (`wincal-116-seen-16.png`, every DPI tier beside the original's) once every one has been seen (`data-state="seen"`).
Seen = shown in the flyout: localStorage `melatonDexNotifySeen` `{ key: post time }` (a notification posted again with
new content is new again). The list is read once the desktop is up and idle and on each `androidnotifications`.
It is in `TRAY_DEFAULT_SHOW` (`trayRegistry.js`): shown unless Customize Notification Icons hides it. Only the DeX window
creates it, so other desktops do not list it.

The flyout (`#androidNotifyFlyout`, the network flyout's frame): the phone's notifications by app, the app with the newest
first, each app with its icon (as above), name, count (Android's `number`) and an X that clears its notifications. A row
draws every part the bridge gives: the large icon (else the app's) at 32 px, the conversation name or title, its time
(`when`, hidden when `showWhen` is false) or a running clock (`chronometer {base, countDown}`, ticking once a second only
while the flyout shows it), sub / info text, the body (`shortText` collapsed and `text` expanded, inbox `lines`, chat
`messages` with each sender's `avatar` and picture messages), the kit progress bar (Vista's marquee when indeterminate),
the big `picture` and `summaryText` when expanded, Vista's expando when there is more to show (the newest notification
opens expanded), its buttons and the reply box. Pictures come from `image(id)`, kept by id (at most 80, dropped when no
notification shows them). A row opens its notification (`open(key)`, falling back to `AndroidApps.launch(package)`); the X dismisses it; its
buttons run `action(key, index, null)`; a Reply action opens a box whose Send (or Enter) runs `action(key, index, text)`.
**Clear all** dismisses every clearable one. With notification access off the flyout offers `requestAccess()`.

The list is read when the flyout opens and on `androidnotifications` while it shows (a change while a reply is being
typed waits until the box loses focus); with the flyout shut a change only marks it stale, and the tooltip's count is
read when the pointer reaches the icon. Delivering notifications stays the app's native work (`cafeready-background`).

**Groups and stacks** (Yukimi, Nov 21): one group per app, the group with the newest notification first and each group
newest first. A group of several is stacked as Android stacks it and starts collapsed every time the flyout opens: its
newest notification, then up to two one-line peeks over the stack's two edges and "+N more"; a click on the stack, its
heading or the heading's expando opens it.

**Right-click** a notification or a group: Open (default), Dismiss / Clear These Notifications, **Hide This Notification
Group** (the app), Hide "<channel>" Notifications, Manage Channels.... The Bell's own menu: Open, Manage Channels...,
Clear All. The flyout's links: Clear all, Manage channels (with how many are hidden).

**Manage Notification Channels** (the shared Vista dialog, `showConfirmationDialog` + the kit tree list): every program
with notification channels on the phone (`requestChannelNames()` / `channelNames()`, asked once per visit when the
flyout first opens) and every program and channel seen here, each with a **Show in the Bell** check box; OK keeps the
choice. localStorage `melatonDexNotifyFilter` `{ apps: { pkg: false }, channels: { 'pkg|channel': false }, known: { pkg:
{ app, channels: [id] } } }`. A hidden notification is not listed and does not ring the bell; it stays on the phone.

**Size**: the flyout grows from its top and left edges and top-left corner (its bottom-right stays at the tray), between
300 x 220 px and the screen; the size is kept in localStorage `melatonDexNotifySize` `{ w, h }`.

`window.melatonAndroidNotifications`: `open()`, `close()`, `manageChannels()`.
