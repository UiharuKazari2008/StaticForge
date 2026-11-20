# Sync Center partnerships (#976)

Everything the desktop syncs is a Sync Center partnership, as on Vista. One page-side registry,
`public/scripts/comp/syncCenter.js` (`window.melatonSyncCenter`), feeds:

- Control Panel > Sync Center (`cplPages2.js`): the partnerships list (status, category, the progress bar in the row,
  Sync / Sync All), the conflicts view (Resolve), and the sync results;
- Sync Center's tray icon (`#nightshadeSyncTrayIcon`, SyncCenter.dll's art): the green arrows turning while any
  partnership syncs, then conflict, error or done for all of them together; right-click Open Sync Center, Sync All,
  View sync conflicts, View sync results;
- Sync Center's balloons (SyncCenter.dll.mui 6980-6987): "<name> is now set up to sync" (a partnership's first completed
  sync on this computer, once), "Sync conflicts have occurred", "Sync errors have occurred".

Partnerships today: `nightshade-profile` (the user's profile on the domain controller, `nightshadeProfileSync.js`).
`offline-files` is reserved for Offline Files (CaféReady's client-side caching on DreamOS); while it is not registered,
Sync Center shows its older Offline Files row (the server's replicas, #945).

`syncCenter.js` loads from `app.html` before the partnerships' own scripts. A script that loads later (a feature, a
segment) registers when it loads; everything follows.

## Registry

```js
melatonSyncCenter.register(p)   // add, or replace the one with the same p.id; returns an unregister function
melatonSyncCenter.list()        // the partnerships, in the order registered
melatonSyncCenter.get(id)       // one partnership, or null
melatonSyncCenter.changed()     // something a partnership shows changed: tray, balloons and an open Sync Center
                                // redraw (once a frame at most). Not needed when the partnership has on(fn).
melatonSyncCenter.syncAll()     // p.syncNow() on every partnership that has one (Sync All)
melatonSyncCenter.open(view)    // Control Panel > Sync Center: '' (partnerships) | 'conflicts' | 'results'
```

## A partnership

```js
{
  id: 'offline-files',                 // unique and stable
  partnership: () => ({                // synchronous, from memory: never a request (it is read on every redraw)
    name: 'Offline Files',             // the row's name, the balloons' "<name> is now set up to sync"
    status: 'Last sync on 11/20/2026 2:30 AM',   // Vista's words: 'Ready for first sync', 'Sync in progress',
                                       //   'Sync completed with 1 conflict', 'Sync failed with 1 error', 'Last sync on %1'
    busy: false,                       // a sync is running: the tray's arrows turn, the row shows its bar
    percent: 0,                        // 0-100 while busy (the row's bar, 5 % steps)
    marquee: false,                    // while busy with no measurable progress yet (the bar's marquee)
    stalled: false,                    // optional: busy but no step for a while (the arrows stop; still "in progress")
    category: 'Folders',
    last: { at: 1795157701146, result: 'ok' | 'conflict' | 'error' } | null,
                                       // the last finished sync; a non-error last makes the partnership "set up"
    conflicts: 0,                      // count; a rise raises the conflicts balloon
    errors: 0,                         // count; a rise raises the errors balloon (keep 0 for quiet background failures)
    icon: '/static_images/vista-sync/sync-center-16.png',   // 16 px; Sync Center tries the same name with -48 for
                                       //   the details pane
    detail: 'Camera Roll, available offline on this computer.'   // optional: the details pane's line
  }),
  conflicts: () => [{                  // optional; the conflicts view
    id: 'c1',                          // unique within the partnership
    name: 'IMG_0412.jpg',
    path: 'Camera Roll',
    detail: 'Both versions have been updated since the last sync.',
    localAt: 1795157641146,            // ms or null
    serverAt: 1795157701146            // ms or null
  }],
  results: () => [{                    // optional; newest first; Sync Center merges every partnership's by time
    at: 1795157701146,
    kind: 'info' | 'warning' | 'error' | 'conflict',
    item: 'Camera Roll',               // the Name column
    text: 'Synced 12 files.'           // the Details column
  }],
  syncNow: () => Promise,              // optional: Sync / Sync All; show your own progress (window, row)
  resolve: (conflictId) => {},         // optional: open the partnership's own Resolve Conflict (Vista's: shell32's
                                       //   conflict dialog; nightshadeProfileSync.js has one to follow)
  clearResults: () => {},              // optional: Sync results' Delete
  on: (fn) => off                      // optional but preferred: call fn() whenever partnership(), conflicts() or
                                       //   results() change; return an unsubscribe function
}
```

Rules (`installed-boot-zero-wait`, `server-push-not-polling`, `phone-power-client`):

- Nothing here waits on the server. `partnership()`, `conflicts()` and `results()` answer from memory.
- Push changes through `on(fn)` (or `changed()`); Sync Center never polls a partnership.
- What a partnership reports when it registers is taken as the state of things: balloons only come from later changes.
- Keep `busy` true only while the sync really runs: the tray's arrows turn for as long as it is (a CSS animation).
- Desktop pages only (Melaton Mobile has no Sync Center).
