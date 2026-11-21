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

`window.melatonAndroidPrograms`: `items()`, `tree()`, `find(launchId)`, `isAndroidId(id)`, `launch(id)`.

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

`#androidNotifyTrayIcon`, Windows Calendar's reminder bell (WinCal.exe icon 116, `static_images/vista-dlg/wincal-116-16.png`).
It is in `TRAY_DEFAULT_SHOW` (`trayRegistry.js`): shown unless Customize Notification Icons hides it. Only the DeX window
creates it, so other desktops do not list it.

The flyout (`#androidNotifyFlyout`, the network flyout's frame): the phone's notifications by app, the app with the newest
first. A row opens its notification (`open(key)`, falling back to `AndroidApps.launch(package)`); the X dismisses it; its
buttons run `action(key, index, null)`; a Reply action opens a box whose Send (or Enter) runs `action(key, index, text)`.
**Clear all** dismisses every clearable one. With notification access off the flyout offers `requestAccess()`.

The list is read when the flyout opens and on `androidnotifications` while it shows (a change while a reply is being
typed waits until the box loses focus); with the flyout shut a change only marks it stale, and the tooltip's count is
read when the pointer reaches the icon. Delivering notifications stays the app's native work (`cafeready-background`).

`window.melatonAndroidNotifications`: `open()`, `close()`.
