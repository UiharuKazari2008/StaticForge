# Melaton apps

Programs that run from the VFS. Opening a `.msaz` in Explorer, or a file an installed app opens
(its manifest's `opens[]`), starts the app on **both sides**: its client half runs in the tab, and
its server half runs on the server in a sandboxed Node process of its own. Closing the app ends
both. Yozora #638; the package format is the Melaton package contract (#179,
[melaton-packages.md](./melaton-packages.md)), with `.msaz` v2 defined here.

| Part | File |
| --- | --- |
| Client runtime | `public/scripts/comp/melatonApps.js` (loads with Explorer) |
| Explorer hook | `public/scripts/comp/vfsPrograms.js` (`explorerApplet.openItem`, `explorerArchive.openEntry`) |
| WS packets | `modules/ws/handlers/245-melatonAppsHandler.js`, [ws/melatonApps.md](./ws/melatonApps.md) |
| Runner and sandbox | `modules/melatonApps/runner.js`, `sandboxPreload.js`, `sandboxBootstrap.js` |
| Client files | `GET /melaton-apps/<id or run sha>/...` (`modules/melatonApps/static.js`, behind auth) |
| Store | `modules/melatonPackageStore.js` (`prepareRun`, `findOpener`, `installFromDirectory`) |
| System packages | `apps/<id>/` in the repo, installed into `.cache/packages/<id>/` on first use |
| Tests | `node scripts/test-melaton-apps.js`, `node scripts/test-soratan.js` |

## `.msaz` v2

A zip with `manifest.json` at the root:

```json
{
    "id": "soratan",
    "version": "1.0.0.1",
    "title": "SoraTan",
    "publisher": "",
    "format": "msaz",
    "type": "native",
    "icon": "assets/soratan-48.png",
    "client": { "entry": "client/soratan.js" },
    "server": { "entry": "server/main.js", "runner": "session", "memoryMB": 96 },
    "opens": [{ "name": "SoraTan.exe", "size": 999424 }]
}
```

| Field | Notes |
| --- | --- |
| `id`, `version`, `title`, `format: "msaz"`, `type: "native"` | As in [melaton-packages.md](./melaton-packages.md). `launchId` defaults to `id`. |
| `icon` | `.png` / `.webp` / `.ico` in the package: caption, taskbar and tray. Without one, Vista's application icon. |
| `client.entry` | Same-origin script. It calls `melatonApps.define(id, start)`. |
| `server` | Optional. `entry` exports `start(app)`. `runner`: `session` (default) or `service`. `memoryMB` 16..512 (default 96). No `packets`: a runner talks over `app_message`. |
| `opens[]` | VFS files the app runs for, by exact name (case-insensitive) and byte size, at most 32. Only installed (or system) packages answer `opens`. |

Package CSS stays locked (#179): no stylesheets, no `<style>`. An app sets the styles it needs
inline, on top of the desktop's kit (`css/melaton-apps.css` gives the overlay layer and tray icon).

A `.mapz` may use the same `server.runner` fields instead of v1 `packets`.

## Lifetime

| Runner | Process | Ends when |
| --- | --- | --- |
| none (client only) | none | its last window closes, or `app.exit()` |
| `session` | one per launch | the app ends on the client: last window closed, `app.exit()`, or the tab disconnects or reloads |
| `service` | one per package, shared by its launches | `app_service_stop`, package uninstall or disable, or a server stop. Windows closing or tabs leaving only detach. |

An app with an overlay or a tray icon (SoraTan) is not ended by closing windows; it calls
`app.exit()` (its Exit menu). If the server half crashes, hangs (no answer to the runner's ping for
45 s) or fails to start, the client half ends too and the desktop shows "<app> has stopped working"
with Close program / Restart (`programFaults.presentApp`).

Only **admin** sessions can start an app with a server half. Readonly sessions can run client-only
apps.

## The client half

```js
melatonApps.define('example', async (app) => {
    const win = app.openWindow({ title: 'Example', width: 420, height: 260 });
    win.body.textContent = 'Hello';
    app.server.onMessage((data) => { win.body.textContent = JSON.stringify(data); });
    await app.server.send({ op: 'hello' });
});
```

| `app.` | |
| --- | --- |
| `instanceId`, `packageId`, `title`, `version`, `publisher`, `icon`, `launchFile` | About this launch |
| `url(rel)` | A file of the package (`client/`, `assets/`); never `server/` |
| `signal` | An AbortSignal that aborts when the app ends: pass it to listeners and fetches |
| `server.send(data)` / `server.onMessage(fn)` / `server.available` | The server half. Data is JSON; send bytes as base64. |
| `openWindow({ title, width, height, minWidth, resizable, icon })` | A desktop window (the modal shell, image icon, taskbar button). Returns `{ modal, body, setTitle, close }`. |
| `overlay()` | A layer over the windows, under the taskbar. It takes no pointer input; the app's elements opt in. |
| `tray({ title, icon, onClick, menu })` | A notification-area icon (`menu`: a contextMenu.js config) |
| `onExit(fn)` / `exit()` | Ending the app (both halves) |

Everything the app made through the context (windows, overlay, tray icon, listeners on `signal`) is
removed when it ends.

## The server half

```js
module.exports = function start(app) {
    app.onMessage(async (data, instance) => {
        const files = await app.callFor(instance, 'listLaunchFolder');
        app.send({ files }, instance);
    });
};
```

| `app.` | |
| --- | --- |
| `id`, `runner`, `packageDir`, `dataDir` | `dataDir` (`.cache/packages/.data/<id>/`) is the only place it can write |
| `onMessage(fn(data, instance))`, `send(data, instance?)` | Client messages; without `instance`, to every attached launch |
| `onAttach(fn(instance, launch))`, `onDetach(fn)`, `instances()`, `launchOf(instance)` | Launches coming and going (a service sees several) |
| `call(method, ...)` / `callFor(instance, method, ...)` | Host services for one launch: `listLaunchFolder()` and `readLaunchFile(name)` |
| `onStop(fn)` | Runs before the runner stops the process (2 s grace, then SIGTERM, then SIGKILL) |
| `log(...)`, `console.*`, `exit(code)` | Logs go to the server log as `[app <id>]` |

**Launch folder.** The host reads files next to the launched file: the other files in the same VFS
folder, or the other entries in the same archive folder (SoraTan.iso's root for SoraTan.exe). It
works by name only, with no paths. This is how an app opens its data the way a Windows program
reads `.\*`.

**Sandbox.** The process runs under Node 20's permission model:

- it can read only its package and the runner files;
- it can read and write only its data dir;
- it cannot spawn processes, start workers or load addons.

The preload goes further:

- it blocks `net`, `http(s)`, `http2`, `tls`, `dns`, `dgram`, `child_process`, `worker_threads`,
  `cluster`, `vm`, `inspector` and `v8`;
- it removes `fetch`, `WebSocket` and `process.binding`;
- `process.kill` works only for the process itself.

The environment holds only `NODE_ENV`, `LANG` and `TZ`, so no server secrets. The only way out is
IPC to the runner. Node 20's permission model does not cover the network, which is why that part is
done by the preload. This is defence in depth for admin-run packages, not a boundary for hostile code.

## Run from the VFS

A `.msaz` is unpacked into `.cache/packages/.run/<sha256>/`. That tree is content-addressed and
shared by every launch of the same bytes. Trees no running app uses are swept after a day.
Installing (`package_install`) still copies a package into `.cache/packages/<id>/`.

## EXE containers (#640)

An app can be shipped as a real Windows program: a small PE32 stub with the `.msaz` appended.

```
[ PE32 stub (apps/_stub/MelatonStub.cs) ][ the package zip ]
```

On a normal PC the stub shows "This application can only run on Melaton OS." (a message box, the
app's title as the caption) and exits. On Melaton OS the desktop reads the appended package and runs
the app, exactly as a `.msaz` — the store slices the file to the overlay (`modules/melatonApps/
exeContainer.js`), so launch, `opens[]` and install all accept an `.exe` that carries a package.
7-Zip and other tools open the file through their self-extracting-archive handling.

The app's icon lives in **both** the manifest (used on Melaton OS) and the stub's Win32 resources
(so the file shows the app's icon on a normal PC), with the app's version and publisher in the
stub's version resource. When a Melaton `.exe` is uploaded to the VFS, Explorer shows that icon
(the uploader reads it from the appended package: `vfsManager._melatonExeIcon`).

Build one with the app's icon, title and version compiled in:

```
node scripts/build-melaton-app.js apps/<id> --exe <out.exe>   # compiles the stub on the Vista VM
node scripts/build-melaton-app.js apps/<id> --exe <out.exe> --stub <prebuilt.exe>   # no VM
node scripts/build-melaton-app.js apps/<id> --zip <out.msaz>  # the plain package
```

The stub is a real compiled program (`csc /target:winexe /win32icon /win32manifest`, .NET 3.5 on the
VM); nothing generates executable code. The container (`modules/melatonApps/exeContainer.js`) only
joins and reads the two parts, and `modules/melatonApps/ico.js` builds the `.ico` from the icon
images. Test: `node scripts/test-melaton-exe.js`.

## Not in v1

- Network access for server halves (a host-brokered fetch with an allowlist, like `/gadget-proxy`).
- A consent dialog before a package's first run: admin-only instead.
- Start menu rows for apps (#185) and a package manager UI (#182 / #183, ui-review).
