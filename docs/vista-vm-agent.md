# Vista VM agent (design reference)

Yukimi's throwaway Windows Vista Ultimate SP2 VM (Aero on, 1920x1200) is the 1:1 reference for
the MeletonFX desktop. A small HTTP agent inside it lets any coding agent run commands, move
files, take lossless screenshots and rip icons without touching the RDP window. Nothing of value
is on the VM: install tools freely, make test folders, change settings.

This document is for other agents (Cursor, Claude Code, Grok). The Dreamscape client bridge
(`/agent/...` on the Dreamscape server) is a different thing: see
[client-api/agent-session.md](client-api/agent-session.md).

## Where it is

- The VM runs on Ruiko (`192.168.100.12`) under VMware. Its address moves: it was
  `192.168.110.39`, then `192.168.100.243` (2026-10-13). When the helper times out, scan the /24
  for port **8790** and fix `B=` in the helper:

  ```bash
  for i in $(seq 1 254); do (echo >/dev/tcp/192.168.100.$i/8790) 2>/dev/null && echo 192.168.100.$i; done
  ```

- The agent is `C:\agent\agent.exe` (C# .NET 2.0, source `C:\agent\agent.cs`, built in the VM
  with `C:\Windows\Microsoft.NET\Framework\v2.0.50727\csc.exe /r:System.Drawing.dll /r:System.Windows.Forms.dll agent.cs`).
  It listens on port 8790 and checks the `X-Token` header on every request.
- Token: `~/.secrets/vista-vm-agent.token` on the dev box (mode 0600). Read it at call time; never
  echo, print, paste or commit it. A copy of the agent source without the token is at
  `~/.config/vista-vm/agent.cs`.
- Helper: `~/.config/vista-vm/vm.sh` wraps every endpoint with curl and the token:

  ```bash
  vm.sh run "<cmd>" [timeoutSec]        # cmd.exe /c <cmd>; stdout+stderr, then "[exit N]" or "[timeout]"
  vm.sh get <vmpath> <local>            # download a file
  vm.sh put <local> <vmpath>            # upload a file (an existing name gets " (2)" etc.)
  vm.sh shot <out.png> [x y w h delayms] # lossless PNG of the composed desktop
  vm.sh icon <file> <index> <size> <out.png>  # one icon frame from an exe/dll/cpl
  vm.sh iconcount <file>                # number of icons in a file
  ```

  Paths with backslashes or spaces: quote them, and when reading them from a list use
  `IFS='|' read -r` (plain `read` eats the backslashes).

## Endpoints

All `GET` unless noted; query values are URL-encoded; the body of `/run` and `/put` is raw.

| Route | Params | Returns |
|-------|--------|---------|
| `/ping` | — | `pong <machine> <WxH>` |
| `POST /run?t=<sec>` | body = command line | `cmd.exe /c <body>` output, then `[exit N]`; killed after `t` seconds (default 60) with `[timeout]` |
| `/get?path=` | VM path | the file bytes |
| `POST /put?path=` | VM path, body = bytes | `ok <bytes> <path written>` (never overwrites: a taken name gets ` (2)`) |
| `/list?path=` | directory (empty = drives) | one entry per line |
| `/exists?path=` | file or directory | `1` / `0` |
| `/shot?x=&y=&w=&h=&delay=` | optional region and delay (ms) | PNG, `image/png` |
| `/icon?file=&index=&size=` | PE file, icon index, pixel size | PNG with alpha (PrivateExtractIcons) |
| `/iconcount?file=` | PE file | the count |

Notes

- `/run` is a plain `cmd.exe`. Redirects, `&`, `dir /b`, `reg query`, `cscript //nologo x.vbs`,
  `powershell -NoProfile -ExecutionPolicy Bypass -File x.ps1` (PowerShell 2 is installed) all work.
  `<` in a command is eaten by cmd unless quoted; write files with `echo ... > file` or `/put`.
- `/shot` region shots at 2560x1440 came back black once; take a full shot and crop locally. The
  agent build running since 2026-10-13 afternoon throws `CopyPixelOperation` on `/shot`
  (someone swapped `agent.exe`; the `.bak-20261013` next to it is the previous build). Until it
  is rebuilt, screenshot through PowerShell instead:

  ```bash
  vm.sh run 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\agent\shot.ps1' 60   # writes C:\agent\psshot.png
  vm.sh get 'C:\agent\psshot.png' shot.png
  ```

- Do not hot-swap the agent from its own `/run`: killing `agent.exe` from inside took it down
  (2026-10-12). Put the new build next to it (`agent2.exe`) and ask Yukimi to run
  `copy /y C:\agent\agent2.exe C:\agent\agent.exe & C:\agent\agent.exe` in the console.
- If the agent stops answering it may be the VM asleep or the RDP session; ask before assuming
  it died. Standby, hibernate, monitor and disk timeouts are set to never (2026-10-13).
- Input: the agent has no mouse/keyboard endpoint; use `wintool.exe` below, or computer-use on
  the RDP window "Ruiko.nyti.ne.jp - Remote Desktop Connection" (typing goes through the VMware
  clipboard and lags; prefer `/run`). Screenshots through computer-use minimise Yukimi's other
  windows: ask first.

## Tools in C:\agent

All compiled in the VM from the `.cs` next to them (`build.cmd`).

- `wintool.exe` — windows and input, run through `/run`:
  - `list` — every top-level window as `x,y WxH  title`
  - `front <title>` — restore + bring to front (substring match on the title)
  - `move <title> <x> <y> [w h]` — move / resize and bring to front
  - `cursor <x> <y>` / `down <x> <y>` / `up <x> <y>` — move the pointer, press, release
    (a click is `down` then `up`; clicks miss when another window overlaps or has focus:
    `move` the others out of the way, `front` the target, re-check with a shot)
  - `key <vk>` — press a virtual key code (e.g. 13 Enter, 27 Esc, 119 F8)
  - `flash <title>` — FlashWindowEx (taskbar flash)
- `iconsheet.exe <file> <size> <out.png> [cols]` — a numbered contact sheet of every icon in a PE
  file at one size; the quickest way to find an index.
- `dumpres.exe <file> <outdir> [1 [min max]]` — dumps PE resources (PNG/BMP, language neutral),
  with an optional byte-size filter. `wmploc.dll` needs the filter (`1 8 600`) or it crashes.
- `aero.exe on|query` — toggle / query DWM composition (the VM sometimes drops to Vista Basic;
  Personalization > Window Color turns Aero back on).
- `shot.ps1` — the PowerShell screenshot above. `lnk.vbs` prints every Start menu shortcut with
  its target and `IconLocation`; `mklnk.vbs` makes test shortcuts.

## Finding the real icon for something

Vista's own choice, not a lookalike:

1. Start menu shortcuts: `vm.sh run 'cscript //nologo C:\agent\lnk.vbs'` lists
   `name | target | file,index`. A negative index is a resource ID (`imageres.dll,-27`); pass it to
   `/icon` as is, the agent resolves both.
2. Shell objects and file types: `reg query "HKCR\<progid>\DefaultIcon"` (`txtfile`, `pngfile`,
   `InternetShortcut`, `rtffile`...) and `reg query "HKCR\CLSID\{...}\DefaultIcon"` for Control
   Panel items and folders (Recycle Bin empty/full = `imageres.dll,-55` / `-54`).
3. Apps: the exe's icon 0 (`explorer.exe`, `calc.exe`, `mstsc.exe`, `wmplayer.exe`,
   `WindowsPhotoGallery.exe`, `Journal.exe`, `SnippingTool.exe`, `migwiz.exe`).
4. To see how Explorer renders a file type (thumbnail frame, overlay, badge), copy samples into
   `C:\Users\Public\thumbtest`, `start explorer.exe C:\Users\Public\thumbtest`, `wintool move`
   it to `0 0 1000 700`, and shoot.

Sizes: `/icon` gives any size Windows has (16, 24, 32, 48, 256 are real frames; others are scaled
by Windows). Rip 256 for app icon masters (`public/static_images/app_icons/vista-*.png`; the
runtime compiler makes the sized variants) and the real 16/32 frames for chrome.

Art from `.msstyles` (via `dumpres`) is **premultiplied** alpha: un-premultiply before use
(`convert in.png -channel RGB -fx "a==0?0:min(1,u/a)" +channel PNG32:out.png`). `ieframe.dll`
bitmaps and `MsMpRes.dll` / `wmploc.dll` PNGs are straight alpha.

## Bulk transfer

`makecab /f list.ddf` in the VM, then `vm.sh get` the `.cab` and `7z x` it locally; one `/get`
per file is slow for hundreds of files.

## Known sources (so far)

- Explorer chrome: `aero.msstyles` (orbs 933/935/937), `MsMpRes.dll` PNG 281 (the travel-band
  gutter), `ieframe.dll` (stop/refresh 2_3215, favorites-add 2_216, loading ring 2_624).
- Tray: `pnidui.dll` (network 19/24-32/35), `imageres.dll` 166 search / 26 hard drive,
  `user32.dll` 1 warning 3 error 4 info, `explorer.exe` 18 Switch between windows.
- Windows CardSpace (Control Panel DefaultIcon): `icardres.dll,-4096` (16/32 tray, 32/48 Control Panel).
- Shields: `imageres.dll` 98-101, UAC 72; key 76; users 73; info 75; shortcut arrow
  `shell32.dll` 29; folder `shell32.dll` 3 / `imageres.dll` 3; blank file `imageres.dll` 1;
  Messenger (Welcome Center) `oobefldr.dll` 4; User Accounts `usercpl.dll` 0; Taskbar and Start
  Menu `imageres.dll` -80; Mouse / Keyboard `main.cpl` 0 / 1; Sound `mmsys.cpl` 0; Event Viewer
  `miguiresource.dll` 0; Indexing `srchadmin.dll` 0; Windows Defender `MSASCui.exe` 0 (the wall).
- Wallpapers: `C:\Windows\Web\Wallpaper`; account pictures:
  `C:\ProgramData\Microsoft\User Account Pictures\Default Pictures`; sample media under
  `C:\Users\Public`.
